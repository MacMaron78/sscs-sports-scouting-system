import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clearSessionCookie, requireAuth, requireRole, setSessionCookie } from "./auth.js";
import { normalizeAgencyUpdate, normalizeAthleteUpdate, normalizeRegistration, normalizeSearch } from "./validation.js";

const schema = process.env.PGSCHEMA || "sscs_api";
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("PGSCHEMA must be a lowercase PostgreSQL identifier.");
const db = `"${schema}"`;

const projection = `
    u.id AS user_id, u.username,
    u.profile_photo IS NOT NULL AS has_profile_photo,
    u.verification_status,
    p.id, p.first_name, p.last_name, p.sport, p.position, p.age, p.location,
    p.is_discoverable, p.competition_level, p.bio, p.video_link, p.career_history, p.performance_stats, p.updated_at
`;
const profileJoin = `FROM ${db}.athlete_profiles p JOIN ${db}.users u ON u.id = p.user_id`;

function apiError(response, status, message) {
    return response.status(status).json({ error: message });
}

function requireVerifiedScout(request, response, next) {
    if (request.user?.role === "admin") return next();
    if (request.user?.role !== "scout" || request.user.verification_status !== "verified") {
        return apiError(response, 403, "Only administrator-reviewed Scout/Agency accounts can access athlete profiles.");
    }
    return next();
}

function parseId(value) {
    if (!/^[1-9]\d*$/.test(String(value))) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}

function createResetCode() {
    const code = randomBytes(32).toString("base64url");
    return {
        code,
        hash: createHash("sha256").update(code).digest("hex"),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
}

function hashResetCode(code) {
    return createHash("sha256").update(code).digest("hex");
}

function setUpdatedFields(fields, startIndex = 1) {
    const entries = Object.entries(fields);
    return {
        clause: entries.map(([column], index) => `${column} = $${startIndex + index}`).join(", "),
        changedClause: entries.map(([column], index) => `${column} IS DISTINCT FROM $${startIndex + index}`).join(" OR "),
        values: entries.map(([column, value]) => (
            ["career_history", "performance_stats"].includes(column) ? JSON.stringify(value) : value
        )),
    };
}

export function createApp(databasePool) {
    const app = express();

    app.set("trust proxy", 1);

    const frontendOrigin = process.env.FRONTEND_ORIGIN || process.env.RENDER_EXTERNAL_URL || "http://localhost:5173";
    const allowedFrontendOrigins = new Set([frontendOrigin]);
    if (process.env.NODE_ENV !== "production") {
        const configuredOrigin = new URL(frontendOrigin);
        const localHostAlias = {
            localhost: "127.0.0.1",
            "127.0.0.1": "localhost",
        }[configuredOrigin.hostname];
        if (localHostAlias) {
            configuredOrigin.hostname = localHostAlias;
            allowedFrontendOrigins.add(configuredOrigin.origin);
        }
    }

    app.disable("x-powered-by");
    app.use(helmet());
    app.use(cors({
        origin(origin, callback) {
            callback(null, !origin || allowedFrontendOrigins.has(origin));
        },
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
    }));
    app.use(express.json({ limit: "64kb" }));
    app.use(cookieParser());

    app.use((request, response, next) => {
        if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
            const origin = request.get("origin");
            if (origin && !allowedFrontendOrigins.has(origin)) {
                return apiError(response, 403, "Request origin is not allowed.");
            }
        }
        return next();
    });

    app.get("/api/health", async (request, response, next) => {
        try {
            await databasePool.query("SELECT 1");
            return response.json({ status: "ok", database: "connected" });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/public/summary", async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT
                    (SELECT COUNT(*)::int FROM ${db}.athlete_profiles WHERE is_discoverable = TRUE) AS athlete_count,
                    (SELECT COUNT(*)::int FROM ${db}.agency_profiles) AS agency_count`,
            );
            return response.json(result.rows[0]);
        } catch (error) {
            return next(error);
        }
    });

    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 30,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "Too many sign-in attempts. Please wait and try again." },
    });
    const passwordResetRequestLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 5,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "Too many reset requests. Please wait and try again." },
    });
    const passwordResetCompletionLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "Too many reset attempts. Please wait and try again." },
    });
    app.post("/api/auth/register", authLimiter, async (request, response, next) => {
        let registration;
        try {
            registration = normalizeRegistration(request.body);
        } catch (error) {
            return apiError(response, 400, error.message);
        }

        const client = await databasePool.connect();
        try {
            await client.query("BEGIN");
            const passwordHash = await bcrypt.hash(registration.password, 12);
            const created = await client.query(
                `INSERT INTO ${db}.users (username, email, password_hash, role)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, username, email, role`,
                [registration.username, registration.email, passwordHash, registration.role],
            );
            const user = created.rows[0];
            const p = registration.profile;

            if (registration.role === "athlete") {
                await client.query(
                    `INSERT INTO ${db}.athlete_profiles
                        (user_id, first_name, last_name, sport, position, age, location, competition_level, bio,
                         video_link, career_history, performance_stats)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
                    [
                        user.id, p.firstName, p.lastName, p.sport, p.position, p.age,
                        p.location, p.competitionLevel, p.bio, p.videoLink, JSON.stringify(p.careerHistory),
                        JSON.stringify(p.performanceStats),
                    ],
                );
            } else {
                await client.query(
                    `INSERT INTO ${db}.agency_profiles
                        (user_id, agency_name, country, contact_phone, contact_details)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [user.id, p.agencyName, p.country, p.contactPhone, p.contactDetails],
                );
            }
            await client.query("COMMIT");
            setSessionCookie(response, user);
            return response.status(201).json({ user });
        } catch (error) {
            await client.query("ROLLBACK");
            if (error.code === "23505") return apiError(response, 409, "That username or email is already registered.");
            return next(error);
        } finally {
            client.release();
        }
    });

    app.post("/api/auth/login", authLimiter, async (request, response, next) => {
        const email = String(request.body.email ?? request.body.username ?? "").trim();
        const password = String(request.body.password ?? "");
        const expectedRole = request.body.expectedRole;
        if (!email || !password) return apiError(response, 400, "Enter your email address and password.");
        if (expectedRole !== undefined && !["athlete", "scout", "admin"].includes(expectedRole)) {
            return apiError(response, 400, "Choose a valid login portal.");
        }

        try {
            const result = await databasePool.query(
                `SELECT id, username, email, role, is_active, password_hash,
                        token_version, profile_photo IS NOT NULL AS has_profile_photo
                 FROM ${db}.users
                 WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
                 ORDER BY CASE WHEN LOWER(email) = LOWER($1) THEN 0 ELSE 1 END
                 LIMIT 1`,
                [email],
            );
            const user = result.rows[0];
            const validPassword = user && await bcrypt.compare(password, user.password_hash);
            if (!validPassword || !user.is_active) {
                return apiError(response, 401, "Email or password is incorrect.");
            }
            if (expectedRole && user.role !== expectedRole) {
                const portal = expectedRole === "athlete" ? "Scout" : expectedRole === "scout" ? "Athlete" : "Administrator";
                return apiError(response, 403, `Please use the ${portal} login portal.`);
            }
            setSessionCookie(response, user);
            const { password_hash: _passwordHash, ...safeUser } = user;
            return response.json({ user: safeUser });
        } catch (error) {
            return next(error);
        }
    });

    app.post("/api/auth/password-reset-requests", passwordResetRequestLimiter, async (request, response, next) => {
        const email = String(request.body?.email ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            return apiError(response, 400, "Enter a valid account email address.");
        }

        let client;
        let transactionStarted = false;
        try {
            client = await databasePool.connect();
            await client.query("BEGIN");
            transactionStarted = true;
            const account = await client.query(
                `SELECT id FROM ${db}.users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE LIMIT 1`,
                [email],
            );
            if (account.rows[0]) {
                await client.query(
                    `UPDATE ${db}.password_reset_requests
                     SET status = 'superseded', reset_code_hash = NULL, reset_code_expires_at = NULL
                     WHERE user_id = $1 AND status = 'approved'`,
                    [account.rows[0].id],
                );
                const requestRecord = await client.query(
                    `INSERT INTO ${db}.password_reset_requests (user_id)
                     VALUES ($1)
                     ON CONFLICT (user_id) WHERE status = 'pending'
                     DO UPDATE SET requested_at = NOW()
                     RETURNING id`,
                    [account.rows[0].id],
                );
                await client.query(
                    `INSERT INTO ${db}.password_reset_audit
                        (reset_request_id, user_id, event_type)
                     VALUES ($1, $2, 'requested')`,
                    [requestRecord.rows[0].id, account.rows[0].id],
                );
            }
            await client.query("COMMIT");
            transactionStarted = false;
            return response.status(202).json({
                message: "If an active account matches that email, a reset request has been sent to an administrator for review.",
            });
        } catch (error) {
            if (transactionStarted) await client.query("ROLLBACK");
            return next(error);
        } finally {
            client?.release();
        }
    });

    app.post("/api/auth/password-reset", passwordResetCompletionLimiter, async (request, response, next) => {
        const email = String(request.body?.email ?? "").trim().toLowerCase();
        const code = String(request.body?.code ?? "").trim().slice(0, 256);
        const password = String(request.body?.password ?? "");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            return apiError(response, 400, "Enter a valid account email address.");
        }

        let client;
        let transactionStarted = false;
        try {
            client = await databasePool.connect();
            await client.query("BEGIN");
            transactionStarted = true;
            const requestResult = await client.query(
                `SELECT r.id, r.user_id, r.reset_code_hash, r.failed_attempts
                 FROM ${db}.password_reset_requests r
                 JOIN ${db}.users u ON u.id = r.user_id
                 WHERE LOWER(u.email) = LOWER($1) AND u.is_active = TRUE
                   AND r.status = 'approved' AND r.reset_code_expires_at > NOW()
                   AND r.failed_attempts < 5
                 ORDER BY r.requested_at DESC
                 LIMIT 1
                 FOR UPDATE OF r, u`,
                [email],
            );
            const resetRequest = requestResult.rows[0];
            const suppliedHash = hashResetCode(code);
            const storedHash = resetRequest?.reset_code_hash;
            const validCode = typeof storedHash === "string"
                && storedHash.length === suppliedHash.length
                && timingSafeEqual(Buffer.from(storedHash), Buffer.from(suppliedHash));
            if (!validCode) {
                if (resetRequest) {
                    const failedAttempts = Number(resetRequest.failed_attempts) + 1;
                    const attemptLimitReached = failedAttempts >= 5;
                    await client.query(
                        `UPDATE ${db}.password_reset_requests
                         SET failed_attempts = failed_attempts + 1,
                             reset_code_hash = CASE WHEN failed_attempts + 1 >= 5 THEN NULL ELSE reset_code_hash END,
                             reset_code_expires_at = CASE WHEN failed_attempts + 1 >= 5 THEN NULL ELSE reset_code_expires_at END
                         WHERE id = $1`,
                        [resetRequest.id],
                    );
                    await client.query(
                        `INSERT INTO ${db}.password_reset_audit
                            (reset_request_id, user_id, event_type, details)
                         VALUES ($1, $2, $3, $4::jsonb)`,
                        [
                            resetRequest.id,
                            resetRequest.user_id,
                            attemptLimitReached ? "code_locked" : "code_attempt_failed",
                            JSON.stringify({ failedAttempts }),
                        ],
                    );
                    await client.query("COMMIT");
                } else {
                    await client.query("ROLLBACK");
                }
                transactionStarted = false;
                return apiError(response, 400, "The reset code is invalid or expired.");
            }
            if (password.length < 10 || password.length > 128) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return apiError(response, 400, "Password must be between 10 and 128 characters.");
            }

            const passwordHash = await bcrypt.hash(password, 12);
            await client.query(
                `UPDATE ${db}.users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
                [passwordHash, resetRequest.user_id],
            );
            await client.query(
                `UPDATE ${db}.password_reset_requests
                 SET status = 'completed', reset_code_hash = NULL, reset_code_expires_at = NULL,
                     completed_at = NOW()
                 WHERE id = $1`,
                [resetRequest.id],
            );
            await client.query(
                `INSERT INTO ${db}.password_reset_audit
                    (reset_request_id, user_id, event_type)
                 VALUES ($1, $2, 'reset_completed')`,
                [resetRequest.id, resetRequest.user_id],
            );
            await client.query("COMMIT");
            transactionStarted = false;
            return response.json({ message: "Your password has been updated. Please sign in with your new password." });
        } catch (error) {
            if (transactionStarted) await client.query("ROLLBACK");
            return next(error);
        } finally {
            client?.release();
        }
    });

    app.post("/api/auth/logout", (request, response) => {
        clearSessionCookie(response);
        return response.status(204).end();
    });

    const authenticate = requireAuth(databasePool);
    app.get("/api/auth/me", authenticate, (request, response) => response.json({ user: request.user }));

    app.get("/api/profile-photos/:id", authenticate, async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid profile photo identifier.");
        try {
            const result = await databasePool.query(
                `SELECT u.id, u.role, u.verification_status, u.profile_photo, u.profile_photo_type,
                        ap.is_discoverable AS athlete_is_discoverable
                 FROM ${db}.users u
                 LEFT JOIN ${db}.athlete_profiles ap ON ap.user_id = u.id
                 WHERE u.id = $1 AND u.is_active = TRUE`,
                [id],
            );
            const photo = result.rows[0];
            if (!photo?.profile_photo) return apiError(response, 404, "Profile photo not found.");
            const canViewAthletePhoto = photo.role !== "athlete"
                || request.user.role === "admin"
                || String(request.user.id) === String(photo.id)
                || (request.user.role === "scout"
                    && request.user.verification_status === "verified"
                    && photo.athlete_is_discoverable);
            if (!canViewAthletePhoto) return apiError(response, 404, "Profile photo not found.");
            response.set({
                "Cache-Control": "private, max-age=0, must-revalidate",
                "Content-Type": photo.profile_photo_type,
                "Cross-Origin-Resource-Policy": "cross-origin",
                "X-Content-Type-Options": "nosniff",
            });
            return response.send(photo.profile_photo);
        } catch (error) {
            return next(error);
        }
    });

    app.post(
        "/api/me/profile-photo",
        authenticate,
        express.raw({
            type: ["image/jpeg", "image/png", "image/webp"],
            limit: "3mb",
        }),
        async (request, response, next) => {
            const contentType = request.get("content-type")?.split(";")[0].trim().toLowerCase();
            if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
                return apiError(response, 415, "Choose a JPEG, PNG, or WebP image.");
            }
            if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
                return apiError(response, 400, "The selected image is empty or invalid.");
            }

            const isJpeg = request.body.length >= 3
                && request.body[0] === 0xff && request.body[1] === 0xd8 && request.body[2] === 0xff;
            const isPng = request.body.length >= 8
                && request.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
            const isWebp = request.body.length >= 12
                && request.body.toString("ascii", 0, 4) === "RIFF"
                && request.body.toString("ascii", 8, 12) === "WEBP";
            const matchesType = (contentType === "image/jpeg" && isJpeg)
                || (contentType === "image/png" && isPng)
                || (contentType === "image/webp" && isWebp);
            if (!matchesType) return apiError(response, 415, "The uploaded file does not match a supported image format.");

            try {
                await databasePool.query(
                    `UPDATE ${db}.users
                     SET profile_photo = $1, profile_photo_type = $2
                     WHERE id = $3 AND is_active = TRUE`,
                    [request.body, contentType, request.user.id],
                );
                return response.json({ message: "Profile photo updated." });
            } catch (error) {
                return next(error);
            }
        },
    );

    app.delete("/api/me/profile-photo", authenticate, async (request, response, next) => {
        try {
            await databasePool.query(
                `UPDATE ${db}.users
                 SET profile_photo = NULL, profile_photo_type = NULL
                 WHERE id = $1`,
                [request.user.id],
            );
            return response.status(204).end();
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/me/profile", authenticate, async (request, response, next) => {
        try {
            if (request.user.role === "athlete") {
                const result = await databasePool.query(
                    `SELECT ${projection}, u.verification_requested_at, u.verification_reviewed_at
                     ${profileJoin} WHERE u.id = $1`,
                    [request.user.id],
                );
                if (!result.rows[0]) return apiError(response, 404, "Athlete profile not found.");
                return response.json({ profileType: "athlete", profile: result.rows[0] });
            }
            if (request.user.role === "scout") {
                const result = await databasePool.query(
                    `SELECT a.id, a.agency_name, a.country, a.contact_phone, a.contact_details,
                            a.updated_at, u.id AS user_id, u.username,
                            u.profile_photo IS NOT NULL AS has_profile_photo,
                            u.verification_status, u.verification_requested_at,
                            u.verification_reviewed_at
                     FROM ${db}.agency_profiles a
                     JOIN ${db}.users u ON u.id = a.user_id
                     WHERE u.id = $1`,
                    [request.user.id],
                );
                if (!result.rows[0]) return apiError(response, 404, "Agency profile not found.");
                return response.json({ profileType: "agency", profile: result.rows[0] });
            }
            return response.json({ profileType: "admin", profile: null });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/recipients/:id", authenticate, async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid recipient identifier.");
        try {
            const result = await databasePool.query(
                `SELECT u.id, u.username, u.role,
                        COALESCE(ap.first_name || ' ' || ap.last_name, gp.agency_name, u.username) AS display_name
                 FROM ${db}.users u
                 LEFT JOIN ${db}.athlete_profiles ap ON ap.user_id = u.id
                 LEFT JOIN ${db}.agency_profiles gp ON gp.user_id = u.id
                 WHERE u.id = $1 AND u.is_active = TRUE
                   AND (ap.id IS NOT NULL OR gp.id IS NOT NULL)
                   AND (ap.id IS NULL OR $2 = 'admin'
                        OR ($2 = 'scout' AND $3 = 'verified' AND ap.is_discoverable = TRUE))
                   AND NOT EXISTS (
                       SELECT 1 FROM ${db}.user_blocks b
                       WHERE (b.blocker_id = $4 AND b.blocked_id = u.id)
                          OR (b.blocker_id = u.id AND b.blocked_id = $4)
                   )`,
                [id, request.user.role, request.user.verification_status, request.user.id],
            );
            if (!result.rows[0]) return apiError(response, 404, "Recipient profile not found.");
            return response.json({ recipient: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/athletes", authenticate, requireRole("scout", "admin"), requireVerifiedScout, async (request, response, next) => {
        let filters;
        try {
            filters = normalizeSearch(request.query);
        } catch (error) {
            return apiError(response, 400, error.message);
        }
        const conditions = ["u.is_active = TRUE"];
        if (request.user.role === "scout") conditions.push("p.is_discoverable = TRUE");
        const values = [];
        for (const key of ["sport", "position", "location", "competitionLevel"]) {
            if (filters[key]) {
                values.push(`%${filters[key]}%`);
                const column = key === "competitionLevel" ? "competition_level" : key;
                conditions.push(`p.${column} ILIKE $${values.length}`);
            }
        }
        if (filters.age !== undefined) {
            values.push(filters.age);
            conditions.push(`p.age = $${values.length}`);
        }
        try {
            const result = await databasePool.query(
                `SELECT ${projection} ${profileJoin}
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY p.last_name, p.first_name LIMIT 100`,
                values,
            );
            return response.json({ athletes: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/athletes/:id", authenticate, async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid athlete identifier.");
        if (!["athlete", "scout", "admin"].includes(request.user.role)) {
            return apiError(response, 403, "You don’t have permission to view athlete profiles.");
        }
        if (request.user.role === "scout" && request.user.verification_status !== "verified") {
            return apiError(response, 403, "Only administrator-reviewed Scout/Agency accounts can access athlete profiles.");
        }
        try {
            const result = await databasePool.query(
                `SELECT ${projection} ${profileJoin}
                 WHERE p.id = $1 AND u.is_active = TRUE
                   AND (u.id = $2 OR $3 = 'admin'
                        OR ($3 = 'scout' AND $4 = 'verified' AND p.is_discoverable = TRUE))`,
                [id, request.user.id, request.user.role, request.user.verification_status],
            );
            if (!result.rows[0]) return apiError(response, 404, "Athlete profile not found.");
            return response.json({ athlete: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/me/athlete-profile", authenticate, requireRole("athlete"), async (request, response, next) => {
        let fields;
        try {
            fields = normalizeAthleteUpdate(request.body);
        } catch (error) {
            return apiError(response, 400, error.message);
        }
        const update = setUpdatedFields(fields);
        update.values.push(request.user.id);
        const userParameter = update.values.length;
        try {
            const result = await databasePool.query(
                `WITH updated_profile AS (
                    UPDATE ${db}.athlete_profiles SET ${update.clause}, updated_at = NOW()
                    WHERE user_id = $${userParameter}
                      AND (${update.changedClause})
                    RETURNING id, first_name, last_name, sport, position, age, location,
                              is_discoverable, competition_level, bio, video_link,
                              career_history, performance_stats, updated_at
                 ), reset_verification AS (
                    UPDATE ${db}.users
                    SET verification_status = 'unverified',
                        verification_requested_at = NULL,
                        verification_reviewed_at = NULL,
                        verification_reviewed_by = NULL
                    WHERE id = $${userParameter}
                      AND EXISTS (SELECT 1 FROM updated_profile)
                    RETURNING verification_status
                 )
                 SELECT updated_profile.*, reset_verification.verification_status
                 FROM updated_profile CROSS JOIN reset_verification`,
                update.values,
            );
            if (!result.rows[0]) {
                const unchanged = await databasePool.query(
                    `SELECT p.id, p.first_name, p.last_name, p.sport, p.position, p.age, p.location,
                            p.is_discoverable, p.competition_level, p.bio, p.video_link,
                            p.career_history, p.performance_stats, p.updated_at, u.verification_status
                     FROM ${db}.athlete_profiles p
                     JOIN ${db}.users u ON u.id = p.user_id
                     WHERE p.user_id = $1`,
                    [request.user.id],
                );
                if (!unchanged.rows[0]) return apiError(response, 404, "Athlete profile not found.");
                return response.json({ athlete: unchanged.rows[0] });
            }
            return response.json({ athlete: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/agencies", authenticate, async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT a.id, a.agency_name, a.country, a.contact_phone, a.contact_details,
                        u.id AS user_id, u.username,
                        u.profile_photo IS NOT NULL AS has_profile_photo,
                        u.verification_status
                 FROM ${db}.agency_profiles a
                 JOIN ${db}.users u ON u.id = a.user_id
                 WHERE u.is_active = TRUE
                 ORDER BY a.agency_name LIMIT 100`,
            );
            return response.json({ agencies: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/agencies/:id", authenticate, async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid agency identifier.");
        try {
            const result = await databasePool.query(
                `SELECT a.id, a.agency_name, a.country, a.contact_phone, a.contact_details,
                        u.id AS user_id, u.username,
                        u.profile_photo IS NOT NULL AS has_profile_photo,
                        u.verification_status
                 FROM ${db}.agency_profiles a
                 JOIN ${db}.users u ON u.id = a.user_id
                 WHERE a.id = $1 AND u.is_active = TRUE`,
                [id],
            );
            if (!result.rows[0]) return apiError(response, 404, "Agency profile not found.");
            return response.json({ agency: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/me/agency-profile", authenticate, requireRole("scout"), async (request, response, next) => {
        let fields;
        try {
            fields = normalizeAgencyUpdate(request.body);
        } catch (error) {
            return apiError(response, 400, error.message);
        }
        const update = setUpdatedFields(fields);
        update.values.push(request.user.id);
        const userParameter = update.values.length;
        try {
            const result = await databasePool.query(
                `WITH updated_profile AS (
                    UPDATE ${db}.agency_profiles SET ${update.clause}, updated_at = NOW()
                    WHERE user_id = $${userParameter}
                      AND (${update.changedClause})
                    RETURNING id, agency_name, country, contact_phone, contact_details, updated_at
                 ), reset_verification AS (
                    UPDATE ${db}.users
                    SET verification_status = 'unverified',
                        verification_requested_at = NULL,
                        verification_reviewed_at = NULL,
                        verification_reviewed_by = NULL
                    WHERE id = $${userParameter}
                      AND EXISTS (SELECT 1 FROM updated_profile)
                    RETURNING verification_status
                 )
                 SELECT updated_profile.*, reset_verification.verification_status
                 FROM updated_profile CROSS JOIN reset_verification`,
                update.values,
            );
            if (!result.rows[0]) {
                const unchanged = await databasePool.query(
                    `SELECT a.id, a.agency_name, a.country, a.contact_phone, a.contact_details,
                            a.updated_at, u.verification_status
                     FROM ${db}.agency_profiles a
                     JOIN ${db}.users u ON u.id = a.user_id
                     WHERE a.user_id = $1`,
                    [request.user.id],
                );
                if (!unchanged.rows[0]) return apiError(response, 404, "Agency profile not found.");
                return response.json({ agency: unchanged.rows[0] });
            }
            return response.json({ agency: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/shortlist", authenticate, requireRole("scout"), requireVerifiedScout, async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT s.id AS shortlist_id, s.created_at, ${projection}
                 FROM ${db}.shortlists s
                 JOIN ${db}.agency_profiles a ON a.id = s.agency_id
                 JOIN ${db}.athlete_profiles p ON p.id = s.athlete_id
                 JOIN ${db}.users u ON u.id = p.user_id
                 WHERE a.user_id = $1 AND u.is_active = TRUE AND p.is_discoverable = TRUE
                 ORDER BY s.created_at DESC`,
                [request.user.id],
            );
            return response.json({ shortlist: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.post("/api/shortlist/:athleteId", authenticate, requireRole("scout"), requireVerifiedScout, async (request, response, next) => {
        const athleteId = parseId(request.params.athleteId);
        if (!athleteId) return apiError(response, 400, "Invalid athlete identifier.");
        try {
            const agencyResult = await databasePool.query(
                `SELECT id FROM ${db}.agency_profiles WHERE user_id = $1`,
                [request.user.id],
            );
            if (!agencyResult.rows[0]) return apiError(response, 403, "Your account has no agency profile.");
            const result = await databasePool.query(
                `INSERT INTO ${db}.shortlists (agency_id, athlete_id)
                 SELECT $1, p.id FROM ${db}.athlete_profiles p
                 JOIN ${db}.users u ON u.id = p.user_id
                 WHERE p.id = $2 AND u.is_active = TRUE AND p.is_discoverable = TRUE
                 ON CONFLICT (agency_id, athlete_id) DO NOTHING
                 RETURNING id`,
                [agencyResult.rows[0].id, athleteId],
            );
            if (result.rowCount === 0) {
                const exists = await databasePool.query(
                    `SELECT 1 FROM ${db}.shortlists WHERE agency_id = $1 AND athlete_id = $2`,
                    [agencyResult.rows[0].id, athleteId],
                );
                if (!exists.rowCount) return apiError(response, 404, "Athlete profile not found.");
            }
            return response.status(201).json({ shortlisted: true });
        } catch (error) {
            return next(error);
        }
    });

    app.delete("/api/shortlist/:athleteId", authenticate, requireRole("scout"), requireVerifiedScout, async (request, response, next) => {
        const athleteId = parseId(request.params.athleteId);
        if (!athleteId) return apiError(response, 400, "Invalid athlete identifier.");
        try {
            await databasePool.query(
                `DELETE FROM ${db}.shortlists s
                 USING ${db}.agency_profiles a
                 WHERE s.agency_id = a.id AND a.user_id = $1 AND s.athlete_id = $2`,
                [request.user.id, athleteId],
            );
            return response.status(204).end();
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/blocks", authenticate, async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT b.blocked_id AS blocked_user_id, b.created_at, u.username, u.role,
                        COALESCE(ap.first_name || ' ' || ap.last_name, gp.agency_name, u.username) AS display_name
                 FROM ${db}.user_blocks b
                 JOIN ${db}.users u ON u.id = b.blocked_id
                 LEFT JOIN ${db}.athlete_profiles ap ON ap.user_id = u.id
                 LEFT JOIN ${db}.agency_profiles gp ON gp.user_id = u.id
                 WHERE b.blocker_id = $1
                 ORDER BY b.created_at DESC`,
                [request.user.id],
            );
            return response.json({ blocks: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.post("/api/blocks", authenticate, async (request, response, next) => {
        const blockedUserId = parseId(request.body.blockedUserId);
        if (!blockedUserId) return apiError(response, 400, "Choose a valid account to block.");
        if (blockedUserId === Number(request.user.id)) return apiError(response, 400, "You cannot block your own account.");
        try {
            const target = await databasePool.query(
                `SELECT id, role FROM ${db}.users WHERE id = $1`,
                [blockedUserId],
            );
            if (!target.rows[0]) return apiError(response, 404, "Account not found.");
            if (target.rows[0].role === "admin") return apiError(response, 400, "Administrator accounts cannot be blocked.");
            await databasePool.query(
                `INSERT INTO ${db}.user_blocks (blocker_id, blocked_id)
                 VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
                [request.user.id, blockedUserId],
            );
            return response.status(201).json({ blockedUserId });
        } catch (error) {
            return next(error);
        }
    });

    app.delete("/api/blocks/:id", authenticate, async (request, response, next) => {
        const blockedUserId = parseId(request.params.id);
        if (!blockedUserId) return apiError(response, 400, "Invalid blocked account identifier.");
        try {
            await databasePool.query(
                `DELETE FROM ${db}.user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
                [request.user.id, blockedUserId],
            );
            return response.status(204).end();
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/messages", authenticate, async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT m.id, m.body, m.sent_at, m.is_read,
                        m.sender_id, sender.username AS sender_username,
                       sender.profile_photo IS NOT NULL AS sender_has_profile_photo,
                       m.recipient_id, recipient.username AS recipient_username,
                       recipient.profile_photo IS NOT NULL AS recipient_has_profile_photo
                 FROM ${db}.messages m
                 JOIN ${db}.users sender ON sender.id = m.sender_id
                 JOIN ${db}.users recipient ON recipient.id = m.recipient_id
                 WHERE m.sender_id = $1 OR m.recipient_id = $1
                 ORDER BY m.sent_at DESC LIMIT 200`,
                [request.user.id],
            );
            return response.json({ messages: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/messages/unread", authenticate, async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT
                    (SELECT COUNT(*)::int FROM ${db}.messages
                     WHERE recipient_id = $1 AND is_read = FALSE) AS unread_count,
                    COALESCE((
                        SELECT json_agg(recent)
                        FROM (
                            SELECT m.id, m.body, m.sent_at, sender.username AS sender_username
                            FROM ${db}.messages m
                            JOIN ${db}.users sender ON sender.id = m.sender_id
                            WHERE m.recipient_id = $1 AND m.is_read = FALSE
                            ORDER BY m.sent_at DESC
                            LIMIT 20
                        ) recent
                    ), '[]'::json) AS recent_messages`,
                [request.user.id],
            );
            return response.json({
                unreadCount: result.rows[0].unread_count,
                recentMessages: result.rows[0].recent_messages,
            });
        } catch (error) {
            return next(error);
        }
    });

    app.post("/api/messages", authenticate, async (request, response, next) => {
        const recipientId = parseId(request.body.recipientId);
        const body = String(request.body.body ?? "").trim();
        if (!recipientId) return apiError(response, 400, "Choose a valid recipient.");
        if (recipientId === Number(request.user.id)) return apiError(response, 400, "You cannot message yourself.");
        if (!body || body.length > 5000) return apiError(response, 400, "Message must be 1–5000 characters.");
        try {
            const result = await databasePool.query(
                `INSERT INTO ${db}.messages (sender_id, recipient_id, body)
                 SELECT $1, u.id, $3
                 FROM ${db}.users u
                 WHERE u.id = $2 AND u.is_active = TRUE
                   AND (
                       EXISTS (SELECT 1 FROM ${db}.athlete_profiles p WHERE p.user_id = u.id)
                       OR EXISTS (SELECT 1 FROM ${db}.agency_profiles a WHERE a.user_id = u.id)
                   )
                   AND (
                       NOT EXISTS (SELECT 1 FROM ${db}.athlete_profiles p WHERE p.user_id = u.id)
                       OR $4 = 'admin'
                       OR ($4 = 'scout' AND $5 = 'verified'
                           AND EXISTS (SELECT 1 FROM ${db}.athlete_profiles p
                                       WHERE p.user_id = u.id AND p.is_discoverable = TRUE))
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM ${db}.user_blocks b
                       WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
                          OR (b.blocker_id = u.id AND b.blocked_id = $1)
                   )
                 RETURNING id, sender_id, recipient_id, body, sent_at, is_read`,
                [request.user.id, recipientId, body, request.user.role, request.user.verification_status],
            );
            if (!result.rows[0]) return apiError(response, 404, "Recipient profile not found.");
            return response.status(201).json({ message: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/messages/:id/read", authenticate, async (request, response, next) => {
        const messageId = parseId(request.params.id);
        if (!messageId) return apiError(response, 400, "Invalid message identifier.");
        try {
            const result = await databasePool.query(
                `UPDATE ${db}.messages SET is_read = TRUE
                 WHERE id = $1 AND recipient_id = $2
                 RETURNING id, is_read`,
                [messageId, request.user.id],
            );
            if (!result.rows[0]) return apiError(response, 404, "Received message not found.");
            return response.json({ message: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.post("/api/reports", authenticate, async (request, response, next) => {
        const targetUserId = parseId(request.body.targetUserId);
        const messageId = request.body.messageId === undefined ? null : parseId(request.body.messageId);
        const category = String(request.body.category ?? "");
        const details = String(request.body.details ?? "").trim();
        const categories = ["harassment", "spam", "inappropriate", "impersonation", "other"];
        if (!targetUserId) return apiError(response, 400, "Choose a valid account to report.");
        if (targetUserId === Number(request.user.id)) return apiError(response, 400, "You cannot report your own account.");
        if (request.body.messageId !== undefined && !messageId) return apiError(response, 400, "Invalid message identifier.");
        if (!categories.includes(category)) return apiError(response, 400, "Choose a valid report category.");
        if (details.length > 1000) return apiError(response, 400, "Additional details must be 1000 characters or fewer.");
        try {
            const target = await databasePool.query(
                `SELECT id, role FROM ${db}.users WHERE id = $1`,
                [targetUserId],
            );
            if (!target.rows[0]) return apiError(response, 404, "Reported account not found.");
            if (target.rows[0].role === "admin") return apiError(response, 400, "Administrator accounts cannot be reported here.");

            if (messageId) {
                const message = await databasePool.query(
                    `SELECT sender_id, recipient_id FROM ${db}.messages
                     WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)`,
                    [messageId, request.user.id],
                );
                if (!message.rows[0]) return apiError(response, 404, "Message not found in your conversations.");
                const otherParticipantId = String(message.rows[0].sender_id) === String(request.user.id)
                    ? message.rows[0].recipient_id
                    : message.rows[0].sender_id;
                if (String(otherParticipantId) !== String(targetUserId)) {
                    return apiError(response, 400, "The reported account must be a participant in that message.");
                }
            }

            const result = await databasePool.query(
                `INSERT INTO ${db}.user_reports
                    (reporter_id, target_user_id, message_id, category, details)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, status, created_at`,
                [request.user.id, targetUserId, messageId, category, details],
            );
            return response.status(201).json({ report: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/me/athlete-visibility", authenticate, requireRole("athlete"), async (request, response, next) => {
        if (typeof request.body.isDiscoverable !== "boolean") {
            return apiError(response, 400, "isDiscoverable must be true or false.");
        }
        try {
            const result = await databasePool.query(
                `UPDATE ${db}.athlete_profiles
                 SET is_discoverable = $1
                 WHERE user_id = $2
                 RETURNING is_discoverable`,
                [request.body.isDiscoverable, request.user.id],
            );
            if (!result.rows[0]) return apiError(response, 404, "Athlete profile not found.");
            return response.json({ isDiscoverable: result.rows[0].is_discoverable });
        } catch (error) {
            return next(error);
        }
    });

    app.post("/api/me/verification-request", authenticate, requireRole("athlete", "scout"), async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `UPDATE ${db}.users
                 SET verification_status = 'pending',
                     verification_requested_at = NOW(),
                     verification_reviewed_at = NULL,
                     verification_reviewed_by = NULL
                 WHERE id = $1 AND verification_status IN ('unverified', 'rejected')
                 RETURNING verification_status, verification_requested_at, verification_reviewed_at`,
                [request.user.id],
            );
            if (!result.rows[0]) {
                return apiError(response, 409, "A new review can only be requested for an unverified or rejected profile.");
            }
            return response.status(201).json({ verification: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/admin/summary", authenticate, requireRole("admin"), async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT
                    (SELECT COUNT(*)::int FROM ${db}.users) AS total_users,
                    (SELECT COUNT(*)::int FROM ${db}.users WHERE role = 'athlete') AS athlete_accounts,
                    (SELECT COUNT(*)::int FROM ${db}.agency_profiles) AS agencies,
                    (SELECT COUNT(*)::int FROM ${db}.shortlists) AS shortlist_entries,
                    (SELECT COUNT(*)::int FROM ${db}.messages) AS messages,
                    (SELECT COUNT(*)::int FROM ${db}.users
                     WHERE role IN ('athlete', 'scout') AND verification_status = 'pending')
                     AS pending_approval_requests,
                    (SELECT COUNT(*)::int FROM ${db}.password_reset_requests
                     WHERE status = 'pending') AS pending_password_reset_requests`,
            );
            return response.json({ summary: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/admin/password-reset-requests", authenticate, requireRole("admin"), async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT r.id, r.user_id, u.username, u.email, u.role,
                        r.status, r.requested_at, r.reviewed_at, r.reset_code_expires_at,
                        r.failed_attempts
                 FROM ${db}.password_reset_requests r
                 JOIN ${db}.users u ON u.id = r.user_id
                 WHERE r.status IN ('pending', 'approved') AND u.is_active = TRUE
                 ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requested_at ASC
                 LIMIT 100`,
            );
            return response.json({ requests: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/admin/password-reset-audit", authenticate, requireRole("admin"), async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT e.id, e.reset_request_id, e.event_type, e.details, e.created_at,
                        u.username AS target_username, u.email AS target_email,
                        actor.username AS actor_username
                 FROM ${db}.password_reset_audit e
                 LEFT JOIN ${db}.users u ON u.id = e.user_id
                 LEFT JOIN ${db}.users actor ON actor.id = e.actor_id
                 ORDER BY e.created_at DESC
                 LIMIT 100`,
            );
            return response.json({ events: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/admin/password-reset-requests/:id", authenticate, requireRole("admin"), async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid password reset request identifier.");
        const action = request.body?.status;
        if (!["approved", "declined", "regenerate"].includes(action)) {
            return apiError(response, 400, "Choose approve, decline, or regenerate.");
        }

        let client;
        let transactionStarted = false;
        try {
            client = await databasePool.connect();
            await client.query("BEGIN");
            transactionStarted = true;
            if (action === "declined") {
                const result = await client.query(
                    `UPDATE ${db}.password_reset_requests
                     SET status = 'declined', reviewed_at = NOW(), reviewed_by = $1,
                         reset_code_hash = NULL, reset_code_expires_at = NULL
                     WHERE id = $2 AND status = 'pending'
                     RETURNING id, user_id, status, requested_at, reviewed_at`,
                    [request.user.id, id],
                );
                if (!result.rows[0]) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    const existing = await databasePool.query(
                        `SELECT id, status FROM ${db}.password_reset_requests WHERE id = $1`,
                        [id],
                    );
                    if (!existing.rows[0]) return apiError(response, 404, "Password reset request not found.");
                    return apiError(response, 409, "Only pending password reset requests can be declined.");
                }
                await client.query(
                    `INSERT INTO ${db}.password_reset_audit
                        (reset_request_id, user_id, actor_id, event_type)
                     VALUES ($1, $2, $3, 'declined')`,
                    [id, result.rows[0].user_id, request.user.id],
                );
                await client.query("COMMIT");
                transactionStarted = false;
                return response.json({ request: result.rows[0] });
            }

            const reset = createResetCode();
            const allowedStatus = action === "approved" ? "pending" : "approved";
            const result = await client.query(
                `UPDATE ${db}.password_reset_requests r
                 SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1,
                     reset_code_hash = $2, reset_code_expires_at = $3, failed_attempts = 0
                 WHERE r.id = $4 AND r.status = $5
                   AND EXISTS (SELECT 1 FROM ${db}.users u WHERE u.id = r.user_id AND u.is_active = TRUE)
                 RETURNING r.id, r.user_id, r.status, r.requested_at, r.reviewed_at, r.reset_code_expires_at`,
                [request.user.id, reset.hash, reset.expiresAt, id, allowedStatus],
            );
            if (!result.rows[0]) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                const existing = await databasePool.query(
                    `SELECT r.id, r.status, u.is_active
                     FROM ${db}.password_reset_requests r
                     JOIN ${db}.users u ON u.id = r.user_id
                     WHERE r.id = $1`,
                    [id],
                );
                if (!existing.rows[0]) return apiError(response, 404, "Password reset request not found.");
                return apiError(response, 409, "This request cannot be approved or regenerated because it is no longer available.");
            }
            await client.query(
                `INSERT INTO ${db}.password_reset_audit
                    (reset_request_id, user_id, actor_id, event_type)
                 VALUES ($1, $2, $3, $4)`,
                [
                    id,
                    result.rows[0].user_id,
                    request.user.id,
                    action === "approved" ? "approved" : "code_regenerated",
                ],
            );
            await client.query("COMMIT");
            transactionStarted = false;
            return response.json({
                request: result.rows[0],
                resetCode: reset.code,
                message: action === "approved"
                    ? "Request approved. Share this one-time code with the user through a trusted channel."
                    : "A replacement code was issued. The previous code is now invalid.",
            });
        } catch (error) {
            if (transactionStarted) await client.query("ROLLBACK");
            return next(error);
        } finally {
            client?.release();
        }
    });

    app.get("/api/admin/users", authenticate, requireRole("admin"), async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT u.id, u.username, u.email, u.role, u.is_active, u.created_at,
                        u.verification_status, u.verification_requested_at,
                        u.verification_reviewed_at, u.verification_reviewed_by,
                        ap.first_name, ap.last_name, ap.sport, ap.position, ap.age,
                        ap.location, ap.bio, ap.video_link, ap.career_history, ap.performance_stats,
                        gp.agency_name, gp.country, gp.contact_phone, gp.contact_details
                 FROM ${db}.users u
                 LEFT JOIN ${db}.athlete_profiles ap ON ap.user_id = u.id
                 LEFT JOIN ${db}.agency_profiles gp ON gp.user_id = u.id
                 ORDER BY CASE WHEN u.verification_status = 'pending' THEN 0 ELSE 1 END,
                          u.verification_requested_at ASC NULLS LAST, u.created_at DESC
                 LIMIT 500`,
            );
            return response.json({ users: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.get("/api/admin/reports", authenticate, requireRole("admin"), async (request, response, next) => {
        try {
            const result = await databasePool.query(
                `SELECT r.id, r.reporter_id, reporter.username AS reporter_username,
                        r.target_user_id, target.username AS target_username,
                        r.message_id, m.body AS message_body, r.category, r.details,
                        r.status, r.created_at, r.reviewed_at,
                        reviewer.username AS reviewer_username
                 FROM ${db}.user_reports r
                 JOIN ${db}.users reporter ON reporter.id = r.reporter_id
                 JOIN ${db}.users target ON target.id = r.target_user_id
                 LEFT JOIN ${db}.messages m ON m.id = r.message_id
                 LEFT JOIN ${db}.users reviewer ON reviewer.id = r.reviewed_by
                 ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC
                 LIMIT 200`,
            );
            return response.json({ reports: result.rows });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/admin/reports/:id", authenticate, requireRole("admin"), async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid report identifier.");
        const { status } = request.body;
        if (!["resolved", "dismissed"].includes(status)) {
            return apiError(response, 400, "Status must be resolved or dismissed.");
        }
        try {
            const result = await databasePool.query(
                `UPDATE ${db}.user_reports
                 SET status = $1, reviewed_by = $2, reviewed_at = NOW()
                 WHERE id = $3 AND status = 'pending'
                 RETURNING id, status, reviewed_by, reviewed_at`,
                [status, request.user.id, id],
            );
            if (!result.rows[0]) {
                const current = await databasePool.query(
                    `SELECT status FROM ${db}.user_reports WHERE id = $1`,
                    [id],
                );
                if (!current.rows[0]) return apiError(response, 404, "Report not found.");
                return apiError(response, 409, "This report has already been reviewed.");
            }
            return response.json({ report: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/admin/users/:id/verification", authenticate, requireRole("admin"), async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid user identifier.");
        const { status } = request.body;
        if (!["verified", "rejected", "unverified"].includes(status)) {
            return apiError(response, 400, "Status must be verified, rejected, or unverified.");
        }
        try {
            const result = await databasePool.query(
                `UPDATE ${db}.users
                 SET verification_status = $1,
                     verification_requested_at = CASE WHEN $1 = 'unverified' THEN NULL ELSE verification_requested_at END,
                     verification_reviewed_at = CASE WHEN $1 = 'unverified' THEN NULL ELSE NOW() END,
                     verification_reviewed_by = CASE WHEN $1 = 'unverified' THEN NULL ELSE $3::BIGINT END
                 WHERE id = $2 AND role IN ('athlete', 'scout')
                   AND ((verification_status = 'pending' AND $1 IN ('verified', 'rejected'))
                        OR (verification_status = 'verified' AND $1 = 'unverified'))
                 RETURNING id, verification_status, verification_requested_at,
                           verification_reviewed_at, verification_reviewed_by`,
                [status, id, request.user.id],
            );
            if (!result.rows[0]) {
                const current = await databasePool.query(
                    `SELECT role, verification_status FROM ${db}.users WHERE id = $1`,
                    [id],
                );
                if (!current.rows[0]) return apiError(response, 404, "User not found.");
                if (!["athlete", "scout"].includes(current.rows[0].role)) {
                    return apiError(response, 400, "Administrator accounts cannot be profile-verified.");
                }
                return apiError(response, 409, "Only pending requests can be approved or rejected; only verified profiles can be unverified.");
            }
            return response.json({ verification: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    app.patch("/api/admin/users/:id/active", authenticate, requireRole("admin"), async (request, response, next) => {
        const id = parseId(request.params.id);
        if (!id) return apiError(response, 400, "Invalid user identifier.");
        if (id === Number(request.user.id)) return apiError(response, 400, "You cannot deactivate your own account.");
        if (typeof request.body.isActive !== "boolean") {
            return apiError(response, 400, "isActive must be true or false.");
        }
        try {
            const result = await databasePool.query(
                `UPDATE ${db}.users SET is_active = $1 WHERE id = $2
                 RETURNING id, username, email, role, is_active, created_at`,
                [request.body.isActive, id],
            );
            if (!result.rows[0]) return apiError(response, 404, "User not found.");
            return response.json({ user: result.rows[0] });
        } catch (error) {
            return next(error);
        }
    });

    if (process.env.NODE_ENV === "production") {
        const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../sscs_frontend/dist");
        app.use(express.static(frontendDist));
        app.use((request, response, next) => {
            if (request.method !== "GET" || request.path === "/api" || request.path.startsWith("/api/")) {
                return next();
            }
            return response.sendFile(resolve(frontendDist, "index.html"), (error) => {
                if (error) next(error);
            });
        });
    }

    app.use((request, response) => apiError(response, 404, "API endpoint not found."));
    app.use((error, request, response, next) => {
        console.error("API request failed:", error);
        if (response.headersSent) return next(error);
        if (error.type === "entity.too.large") {
            return apiError(response, 413, "Profile photos must be 3 MB or smaller.");
        }
        return apiError(response, 500, "An unexpected server error occurred.");
    });

    return app;
}
