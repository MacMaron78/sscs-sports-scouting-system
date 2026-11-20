import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { createPasswordResetEmailSender } from "../src/mailer.js";

process.env.FRONTEND_ORIGIN = "http://localhost:5173";
process.env.JWT_SECRET = "test-secret-with-more-than-thirty-two-characters";
process.env.PGSCHEMA = "sscs_api";

let storedPhoto = null;
let athleteDiscoverable = true;
let athleteVerification = { status: "unverified", requestedAt: null, reviewedAt: null, reviewedBy: null };
let athleteProfileRecord = {
    id: 3,
    first_name: "Test",
    last_name: "Athlete",
    sport: "Football",
    position: "Forward",
    age: 20,
    location: "Kampala",
    is_discoverable: true,
    competition_level: null,
    bio: "A test athlete",
    video_link: "",
    career_history: [],
    performance_stats: {},
    updated_at: "2026-11-14T00:00:00.000Z",
};
const agencyProfileRecord = {
    id: 4,
    agency_name: "Test Agency",
    country: "Uganda",
    contact_phone: "",
    contact_details: "",
    updated_at: "2026-11-14T00:00:00.000Z",
};
let scoutVerificationStatus = "unverified";
let lastAthleteSearchSql = "";
const userBlocks = new Set();
const storedMessages = [];
const storedReports = [];
const passwordResetTokens = new Map();
let nextMessageId = 1;
let nextReportId = 1;
let lastPasswordResetEmail = null;
let passwordResetMailError = null;

const fakePool = {
    async query(sql, values = []) {
        if (sql.includes("WITH consumed_token AS")) {
            const [tokenHash, passwordHash] = values;
            const token = passwordResetTokens.get(tokenHash);
            if (!token || token.expiresAt <= Date.now()) return { rows: [], rowCount: 0 };
            passwordResetTokens.delete(tokenHash);
            testPasswordHash = passwordHash;
            return { rows: [{ id: 1 }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".password_reset_tokens")) {
            const [tokenHash, userId, expiresAt] = values;
            passwordResetTokens.set(tokenHash, { userId, expiresAt: new Date(expiresAt).getTime() });
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM") && sql.includes(".password_reset_tokens")) {
            if (sql.includes("WHERE user_id = $1")) {
                for (const [hash, token] of passwordResetTokens) {
                    if (String(token.userId) === String(values[0])) passwordResetTokens.delete(hash);
                }
            } else {
                passwordResetTokens.delete(values[0]);
            }
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT id, email FROM") && sql.includes(".users")) {
            const user = String(values[0]).toLowerCase() === "athlete@example.com"
                ? { id: 1, email: "athlete@example.com" }
                : null;
            return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
        }
        if (sql.includes("AS blocked_user_id") && sql.includes(".user_blocks b")) {
            const blockerId = String(values[0]);
            return {
                rows: [...userBlocks]
                    .filter((pair) => pair.startsWith(`${blockerId}:`))
                    .map((pair) => {
                        const blockedUserId = Number(pair.split(":")[1]);
                        return {
                            blocked_user_id: blockedUserId,
                            username: blockedUserId === 3 ? "test-scout" : "test-athlete",
                            role: blockedUserId === 3 ? "scout" : "athlete",
                            display_name: blockedUserId === 3 ? "Test Scout" : "Test Athlete",
                        };
                    }),
                rowCount: userBlocks.size,
            };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".user_blocks (")) {
            userBlocks.add(`${values[0]}:${values[1]}`);
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM") && sql.includes(".user_blocks")) {
            userBlocks.delete(`${values[0]}:${values[1]}`);
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT id, role FROM") && sql.includes(".users")) {
            const id = Number(values[0]);
            return {
                rows: [id === 2 ? { id, role: "admin" } : { id, role: id === 3 ? "scout" : "athlete" }],
                rowCount: 1,
            };
        }
        if (sql.includes("AS display_name") && sql.includes("WHERE u.id = $1 AND u.is_active = TRUE")) {
            const targetId = String(values[0]);
            const callerId = String(values[3]);
            const blocked = userBlocks.has(`${callerId}:${targetId}`) || userBlocks.has(`${targetId}:${callerId}`);
            return {
                rows: blocked ? [] : [{
                    id: Number(targetId),
                    username: targetId === "3" ? "test-scout" : "test-athlete",
                    role: targetId === "3" ? "scout" : "athlete",
                    display_name: targetId === "3" ? "Test Scout" : "Test Athlete",
                }],
                rowCount: blocked ? 0 : 1,
            };
        }
        if (sql.includes("SELECT m.id, m.body, m.sent_at, m.is_read") && sql.includes(".messages m")) {
            const userId = String(values[0]);
            return {
                rows: storedMessages
                    .filter((entry) => String(entry.sender_id) === userId || String(entry.recipient_id) === userId)
                    .map((entry) => ({
                        ...entry,
                        sender_username: String(entry.sender_id) === "3" ? "test-scout" : "test-athlete",
                        sender_has_profile_photo: false,
                        recipient_username: String(entry.recipient_id) === "3" ? "test-scout" : "test-athlete",
                        recipient_has_profile_photo: false,
                    })),
                rowCount: storedMessages.length,
            };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".messages")) {
            const [senderId, recipientId, body] = values;
            const blocked = userBlocks.has(`${senderId}:${recipientId}`) || userBlocks.has(`${recipientId}:${senderId}`);
            if (blocked) return { rows: [], rowCount: 0 };
            const message = {
                id: nextMessageId++,
                sender_id: Number(senderId),
                recipient_id: Number(recipientId),
                body,
                sent_at: "2026-11-14T00:00:00.000Z",
                is_read: false,
            };
            storedMessages.push(message);
            return { rows: [message], rowCount: 1 };
        }
        if (sql.includes("SELECT sender_id, recipient_id FROM") && sql.includes(".messages")) {
            const message = storedMessages.find((entry) => (
                String(entry.id) === String(values[0])
                && (String(entry.sender_id) === String(values[1]) || String(entry.recipient_id) === String(values[1]))
            ));
            return { rows: message ? [message] : [], rowCount: message ? 1 : 0 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".user_reports")) {
            const [reporterId, targetUserId, messageId, category, details] = values;
            const report = {
                id: nextReportId++,
                reporter_id: Number(reporterId),
                reporter_username: String(reporterId) === "2" ? "test-admin" : String(reporterId) === "3" ? "test-scout" : "test-athlete",
                target_user_id: Number(targetUserId),
                target_username: String(targetUserId) === "3" ? "test-scout" : "test-athlete",
                message_id: messageId,
                category,
                details,
                status: "pending",
                created_at: "2026-11-14T00:00:00.000Z",
                reviewed_at: null,
            };
            storedReports.push(report);
            return { rows: [report], rowCount: 1 };
        }
        if (sql.includes("FROM") && sql.includes(".user_reports r")) {
            return { rows: [...storedReports], rowCount: storedReports.length };
        }
        if (sql.includes("UPDATE") && sql.includes(".user_reports")) {
            const [status, reviewerId, id] = values;
            const report = storedReports.find((entry) => String(entry.id) === String(id) && entry.status === "pending");
            if (!report) return { rows: [], rowCount: 0 };
            Object.assign(report, { status, reviewed_by: reviewerId, reviewed_at: "2026-11-14T00:05:00.000Z" });
            return { rows: [{ id: report.id, status, reviewed_by: reviewerId, reviewed_at: report.reviewed_at }], rowCount: 1 };
        }
        if (sql.includes("SELECT status FROM") && sql.includes(".user_reports")) {
            const report = storedReports.find((entry) => String(entry.id) === String(values[0]));
            return { rows: report ? [{ status: report.status }] : [], rowCount: report ? 1 : 0 };
        }
        if (sql.includes("ORDER BY p.last_name, p.first_name")) {
            lastAthleteSearchSql = sql;
            return {
                rows: athleteDiscoverable ? [{ id: 3, verification_status: athleteVerification.status }] : [],
                rowCount: athleteDiscoverable ? 1 : 0,
            };
        }
        if (sql.includes("WHERE p.id = $1 AND u.is_active = TRUE")) {
            const role = values[2];
            const callerId = String(values[1]);
            if (role === "scout" && !athleteDiscoverable) return { rows: [], rowCount: 0 };
            if (role === "athlete" && callerId !== "1") return { rows: [], rowCount: 0 };
            return {
                rows: [{
                    user_id: 1,
                    id: 3,
                    username: "test-athlete",
                    first_name: "Test",
                    last_name: "Athlete",
                    sport: "Football",
                    verification_status: athleteVerification.status,
                    is_discoverable: athleteDiscoverable,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SET is_discoverable = $1")) {
            athleteDiscoverable = values[0];
            return { rows: [{ is_discoverable: athleteDiscoverable }], rowCount: 1 };
        }
        if (sql.includes("WITH updated_profile AS")) {
            const isAgency = sql.includes(".agency_profiles");
            const record = isAgency ? agencyProfileRecord : athleteProfileRecord;
            const verification = isAgency ? scoutVerificationStatus : athleteVerification.status;
            const fields = [...sql.matchAll(/([a-z_]+) IS DISTINCT FROM \$(\d+)/g)];
            const changedFields = fields.filter(([, column, parameter]) => {
                let value = values[Number(parameter) - 1];
                if (["career_history", "performance_stats"].includes(column)) value = JSON.parse(value);
                if (column === "age" && value !== null) value = Number(value);
                return JSON.stringify(record[column] ?? null) !== JSON.stringify(value ?? null);
            });
            if (!changedFields.length) return { rows: [], rowCount: 0 };

            for (const [, column, parameter] of changedFields) {
                let value = values[Number(parameter) - 1];
                if (["career_history", "performance_stats"].includes(column)) value = JSON.parse(value);
                if (column === "age" && value !== null) value = Number(value);
                record[column] = value;
            }
            if (isAgency) {
                scoutVerificationStatus = "unverified";
                return { rows: [{ ...record, verification_status: scoutVerificationStatus }], rowCount: 1 };
            }
            athleteVerification = { status: "unverified", requestedAt: null, reviewedAt: null, reviewedBy: null };
            return { rows: [{ ...record, verification_status: athleteVerification.status }], rowCount: 1 };
        }
        if (sql.includes("FROM \"sscs_api\".athlete_profiles p") && sql.includes("WHERE p.user_id = $1")) {
            return {
                rows: [{ ...athleteProfileRecord, verification_status: athleteVerification.status }],
                rowCount: 1,
            };
        }
        if (sql.includes("FROM \"sscs_api\".agency_profiles a") && sql.includes("WHERE a.user_id = $1")) {
            return {
                rows: [{ ...agencyProfileRecord, verification_status: scoutVerificationStatus }],
                rowCount: 1,
            };
        }
        if (sql.includes("SET verification_status = 'pending'")) {
            if (!["unverified", "rejected"].includes(athleteVerification.status)) {
                return { rows: [], rowCount: 0 };
            }
            athleteVerification = {
                status: "pending",
                requestedAt: "2026-11-14T00:00:00.000Z",
                reviewedAt: null,
                reviewedBy: null,
            };
            return {
                rows: [{
                    verification_status: athleteVerification.status,
                    verification_requested_at: athleteVerification.requestedAt,
                    verification_reviewed_at: athleteVerification.reviewedAt,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SET verification_status = $1")) {
            const [status, id, reviewerId] = values;
            const canReview = athleteVerification.status === "pending" && ["verified", "rejected"].includes(status);
            const canRevoke = athleteVerification.status === "verified" && status === "unverified";
            if (String(id) !== "1" || (!canReview && !canRevoke)) return { rows: [], rowCount: 0 };
            athleteVerification = {
                status,
                requestedAt: status === "unverified" ? null : athleteVerification.requestedAt,
                reviewedAt: status === "unverified" ? null : "2026-11-14T00:05:00.000Z",
                reviewedBy: status === "unverified" ? null : reviewerId,
            };
            return {
                rows: [{
                    id: Number(id),
                    verification_status: athleteVerification.status,
                    verification_requested_at: athleteVerification.requestedAt,
                    verification_reviewed_at: athleteVerification.reviewedAt,
                    verification_reviewed_by: athleteVerification.reviewedBy,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SELECT role, verification_status")) {
            return {
                rows: [String(values[0]) === "1"
                    ? { role: "athlete", verification_status: athleteVerification.status }
                    : { role: "admin", verification_status: "unverified" }],
                rowCount: 1,
            };
        }
        if (sql.includes("AS pending_approval_requests")) {
            return {
                rows: [{
                    total_users: 3,
                    athlete_accounts: 1,
                    agencies: 1,
                    shortlist_entries: 0,
                    messages: 0,
                    pending_approval_requests: [athleteVerification.status, scoutVerificationStatus]
                        .filter((status) => status === "pending").length,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("athlete_count")) {
            return { rows: [{ athlete_count: 7, agency_count: 3 }], rowCount: 1 };
        }
        if (sql.includes("AS unread_count")) {
            return {
                rows: [{
                    unread_count: 2,
                    recent_messages: [
                        { id: 21, body: "Are you available for a trial?", sent_at: "2026-11-03T10:00:00.000Z", sender_username: "scout-one" },
                        { id: 20, body: "I saw your profile.", sent_at: "2026-11-03T09:00:00.000Z", sender_username: "scout-two" },
                    ],
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("password_hash")) {
            lastLoginIdentifier = values[0];
            return {
                rows: [{
                    id: 1,
                    username: "test-athlete",
                    email: "athlete@example.com",
                    role: "athlete",
                    is_active: true,
                    password_hash: testPasswordHash,
                    has_profile_photo: false,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("u.profile_photo, u.profile_photo_type")) {
            return {
                rows: storedPhoto ? [{
                    id: Number(values[0]),
                    role: "athlete",
                    verification_status: athleteVerification.status,
                    athlete_is_discoverable: athleteDiscoverable,
                    profile_photo: storedPhoto.data,
                    profile_photo_type: storedPhoto.type,
                }] : [],
                rowCount: storedPhoto ? 1 : 0,
            };
        }
        if (sql.includes("LEFT JOIN") && sql.includes("athlete_profiles")) {
            return {
                rows: [{
                    id: 3,
                    username: "test-athlete",
                    email: "athlete@example.com",
                    role: "athlete",
                    is_active: true,
                    created_at: "2026-01-01T00:00:00.000Z",
                    first_name: "Test",
                    last_name: "Athlete",
                    sport: "Football",
                    position: "Forward",
                    age: 20,
                    location: "Kampala",
                    bio: "A test athlete",
                    video_link: "",
                    career_history: [],
                    performance_stats: {},
                    agency_name: null,
                    country: null,
                    contact_phone: null,
                    contact_details: null,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SELECT id, username, email, role, is_active")) {
            const id = String(values[0]);
            const user = id === "2"
                ? { id: 2, username: "test-admin", email: "admin@example.com", role: "admin", is_active: true, verification_status: "unverified" }
                : id === "3"
                    ? { id: 3, username: "test-scout", email: "scout@example.com", role: "scout", is_active: true, verification_status: scoutVerificationStatus }
                    : { id: 1, username: "test-athlete", email: "athlete@example.com", role: "athlete", is_active: true, verification_status: athleteVerification.status };
            return { rows: [user], rowCount: 1 };
        }
        if (sql.includes("SET profile_photo = $1")) {
            storedPhoto = { data: values[0], type: values[1] };
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SET profile_photo = NULL")) {
            storedPhoto = null;
            return { rows: [], rowCount: 1 };
        }
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
    },
};

let testPasswordHash;
let lastLoginIdentifier;
const app = createApp(fakePool, {
    async sendPasswordResetEmail(message) {
        if (passwordResetMailError) throw passwordResetMailError;
        lastPasswordResetEmail = message;
    },
});
let server;
let baseUrl;

before(async () => {
    testPasswordHash = await bcrypt.hash("valid-password-123", 4);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test("health endpoint checks the database dependency", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", database: "connected" });
});

test("public summary returns counts without exposing account records", async () => {
    const response = await fetch(`${baseUrl}/api/public/summary`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { athlete_count: 7, agency_count: 3 });
});

test("scout search requires an authenticated user", async () => {
    const response = await fetch(`${baseUrl}/api/athletes`);

    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /log in/i);
});

test("athlete discovery requires a verified scout and respects athlete visibility", async () => {
    const scoutToken = jwt.sign(
        { sub: "3", role: "scout" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const athleteToken = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const scoutHeaders = { Cookie: `sscs_session=${scoutToken}` };
    const athleteHeaders = { Cookie: `sscs_session=${athleteToken}`, "Content-Type": "application/json" };

    scoutVerificationStatus = "unverified";
    const unverifiedSearch = await fetch(`${baseUrl}/api/athletes`, { headers: scoutHeaders });
    assert.equal(unverifiedSearch.status, 403);

    scoutVerificationStatus = "verified";
    const search = await fetch(`${baseUrl}/api/athletes`, { headers: scoutHeaders });
    assert.equal(search.status, 200);
    assert.match(lastAthleteSearchSql, /p\.is_discoverable = TRUE/);
    assert.doesNotMatch(lastAthleteSearchSql, /u\.email/);

    const hide = await fetch(`${baseUrl}/api/me/athlete-visibility`, {
        method: "PATCH",
        headers: athleteHeaders,
        body: JSON.stringify({ isDiscoverable: false }),
    });
    assert.equal(hide.status, 200);
    assert.equal((await hide.json()).isDiscoverable, false);

    const hiddenSearch = await fetch(`${baseUrl}/api/athletes`, { headers: scoutHeaders });
    assert.equal(hiddenSearch.status, 200);
    assert.equal((await hiddenSearch.json()).athletes.length, 0);

    storedPhoto = { data: Buffer.from("private-photo"), type: "image/png" };
    const hiddenPhoto = await fetch(`${baseUrl}/api/profile-photos/1`, { headers: scoutHeaders });
    assert.equal(hiddenPhoto.status, 404);
    const ownerPhoto = await fetch(`${baseUrl}/api/profile-photos/1`, { headers: { Cookie: athleteHeaders.Cookie } });
    assert.equal(ownerPhoto.status, 200);
    storedPhoto = null;

    const hiddenProfile = await fetch(`${baseUrl}/api/athletes/3`, { headers: scoutHeaders });
    assert.equal(hiddenProfile.status, 404);

    const ownerProfile = await fetch(`${baseUrl}/api/athletes/3`, { headers: { Cookie: athleteHeaders.Cookie } });
    assert.equal(ownerProfile.status, 200);

    const show = await fetch(`${baseUrl}/api/me/athlete-visibility`, {
        method: "PATCH",
        headers: athleteHeaders,
        body: JSON.stringify({ isDiscoverable: true }),
    });
    assert.equal(show.status, 200);
    assert.equal((await show.json()).isDiscoverable, true);
});

test("role-specific login rejects accounts from the other portal without setting a session", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "test-athlete",
            password: "valid-password-123",
            expectedRole: "scout",
        }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Please use the Athlete login portal." });
    assert.equal(response.headers.get("set-cookie"), null);
});

test("role-specific login accepts an account from the selected portal", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "ATHLETE@example.com",
            password: "valid-password-123",
            expectedRole: "athlete",
        }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, "athlete");
    assert.equal(lastLoginIdentifier, "ATHLETE@example.com");
    assert.match(response.headers.get("set-cookie"), /^sscs_session=/);
});

test("administrator login portal rejects non-administrator accounts", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "test-athlete",
            password: "valid-password-123",
            expectedRole: "admin",
        }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Please use the Administrator login portal." });
});

test("password reset requests do not reveal whether an email belongs to an account", async () => {
    lastPasswordResetEmail = null;
    const knownAccount = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ATHLETE@example.com" }),
    });
    const unknownAccount = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
    });

    assert.equal(knownAccount.status, 202);
    assert.equal(unknownAccount.status, 202);
    assert.deepEqual(await knownAccount.json(), await unknownAccount.json());
    assert.equal(lastPasswordResetEmail.to, "athlete@example.com");
    const token = new URLSearchParams(new URL(lastPasswordResetEmail.resetUrl).hash.slice(1)).get("token");
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    assert.equal(passwordResetTokens.has(tokenHash), true);
    assert.equal(passwordResetTokens.has(token), false);
});

test("password reset links update the password once and reject expired or reused tokens", async () => {
    const token = new URLSearchParams(new URL(lastPasswordResetEmail.resetUrl).hash.slice(1)).get("token");
    const newPassword = "new-secure-password-456";
    const update = await fetch(`${baseUrl}/api/auth/password-reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: newPassword }),
    });
    assert.equal(update.status, 200);
    assert.deepEqual(await update.json(), { message: "Your password has been updated. You can now log in." });
    assert.equal(await bcrypt.compare(newPassword, testPasswordHash), true);

    const reuse = await fetch(`${baseUrl}/api/auth/password-reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "another-secure-password-789" }),
    });
    assert.equal(reuse.status, 400);

    const expiredToken = "x".repeat(43);
    passwordResetTokens.set(createHash("sha256").update(expiredToken).digest("hex"), {
        userId: 1,
        expiresAt: Date.now() - 1000,
    });
    const expired = await fetch(`${baseUrl}/api/auth/password-reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: expiredToken, password: newPassword }),
    });
    assert.equal(expired.status, 400);

    const tooShort = await fetch(`${baseUrl}/api/auth/password-reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: expiredToken, password: "short" }),
    });
    assert.equal(tooShort.status, 400);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "athlete@example.com", password: newPassword }),
    });
    assert.equal(login.status, 200);
});

test("password reset mailer remains optional until SMTP credentials are configured", () => {
    assert.equal(createPasswordResetEmailSender({ SMTP_PORT: "587" }), null);
    assert.throws(
        () => createPasswordResetEmailSender({ SMTP_HOST: "smtp.example.com" }),
        /Configure all password-reset email settings/,
    );
    assert.equal(typeof createPasswordResetEmailSender({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "sender@example.com",
        SMTP_PASSWORD: "test-password",
        SMTP_FROM: "SSCS <sender@example.com>",
    }), "function");
});

test("admin user list includes all athlete profile fields", async () => {
    const token = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const response = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { Cookie: `sscs_session=${token}` },
    });

    assert.equal(response.status, 200);
    const { users } = await response.json();
    assert.equal(users.length, 1);
    assert.equal(users[0].sport, "Football");
    assert.equal(users[0].position, "Forward");
    assert.equal(users[0].location, "Kampala");
    assert.deepEqual(users[0].career_history, []);
    assert.deepEqual(users[0].performance_stats, {});
});

test("unread-message endpoint returns the signed-in user's count and recent messages", async () => {
    const token = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const response = await fetch(`${baseUrl}/api/messages/unread`, {
        headers: { Cookie: `sscs_session=${token}` },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.unreadCount, 2);
    assert.equal(payload.recentMessages.length, 2);
    assert.equal(payload.recentMessages[0].sender_username, "scout-one");
});

test("unread-message endpoint requires authentication", async () => {
    const response = await fetch(`${baseUrl}/api/messages/unread`);

    assert.equal(response.status, 401);
});

test("blocking prevents new messages in both directions while reports enter admin review", async () => {
    userBlocks.clear();
    storedMessages.splice(0);
    storedReports.splice(0);
    nextMessageId = 1;
    nextReportId = 1;
    athleteDiscoverable = true;
    scoutVerificationStatus = "verified";
    const tokenFor = (id, role) => jwt.sign(
        { sub: String(id), role },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const athleteHeaders = {
        Cookie: `sscs_session=${tokenFor(1, "athlete")}`,
        "Content-Type": "application/json",
    };
    const scoutHeaders = {
        Cookie: `sscs_session=${tokenFor(3, "scout")}`,
        "Content-Type": "application/json",
    };
    const adminHeaders = { Cookie: `sscs_session=${tokenFor(2, "admin")}` };

    const firstMessage = await fetch(`${baseUrl}/api/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ recipientId: 1, body: "Hello" }),
    });
    assert.equal(firstMessage.status, 201, JSON.stringify(await firstMessage.clone().json()));

    const block = await fetch(`${baseUrl}/api/blocks`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({ blockedUserId: 3 }),
    });
    assert.equal(block.status, 201);

    const blockList = await fetch(`${baseUrl}/api/blocks`, { headers: athleteHeaders });
    assert.equal((await blockList.json()).blocks[0].blocked_user_id, 3);

    const hiddenRecipient = await fetch(`${baseUrl}/api/recipients/3`, { headers: athleteHeaders });
    assert.equal(hiddenRecipient.status, 404);

    const blockedMessage = await fetch(`${baseUrl}/api/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ recipientId: 1, body: "A new message" }),
    });
    assert.equal(blockedMessage.status, 404);

    const history = await fetch(`${baseUrl}/api/messages`, { headers: athleteHeaders });
    assert.equal((await history.json()).messages.length, 1);

    const unblock = await fetch(`${baseUrl}/api/blocks/3`, {
        method: "DELETE",
        headers: athleteHeaders,
    });
    assert.equal(unblock.status, 204);
    assert.equal((await (await fetch(`${baseUrl}/api/blocks`, { headers: athleteHeaders })).json()).blocks.length, 0);

    const secondMessage = await fetch(`${baseUrl}/api/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ recipientId: 1, body: "A message after unblocking" }),
    });
    assert.equal(secondMessage.status, 201);
    const { message } = await secondMessage.json();

    const accountReport = await fetch(`${baseUrl}/api/reports`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({ targetUserId: 3, category: "spam", details: "Suspicious outreach" }),
    });
    assert.equal(accountReport.status, 201);
    const accountReportPayload = await accountReport.json();

    const messageReport = await fetch(`${baseUrl}/api/reports`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({
            targetUserId: 3,
            messageId: message.id,
            category: "harassment",
            details: "Please review this message",
        }),
    });
    assert.equal(messageReport.status, 201);

    const queue = await fetch(`${baseUrl}/api/admin/reports`, { headers: adminHeaders });
    assert.equal(queue.status, 200);
    assert.equal((await queue.json()).reports.length, 2);

    const review = await fetch(`${baseUrl}/api/admin/reports/${accountReportPayload.report.id}`, {
        method: "PATCH",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(review.status, 200);
    assert.equal((await review.json()).report.status, "resolved");
});

test("state-changing requests reject an unexpected browser origin", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
    });

    assert.equal(response.status, 403);
});

test("development API allows the frontend loopback origin for state-changing requests", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: "http://127.0.0.1:5173" },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("profile photos upload, serve, reject invalid formats, and can be removed", async () => {
    const token = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const headers = { Cookie: `sscs_session=${token}` };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    const invalidUpload = await fetch(`${baseUrl}/api/me/profile-photo`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/png" },
        body: Buffer.from("not an image"),
    });
    assert.equal(invalidUpload.status, 415);

    const upload = await fetch(`${baseUrl}/api/me/profile-photo`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/png" },
        body: png,
    });
    assert.equal(upload.status, 200);
    assert.deepEqual(await upload.json(), { message: "Profile photo updated." });

    const anonymousPhoto = await fetch(`${baseUrl}/api/profile-photos/1`);
    assert.equal(anonymousPhoto.status, 401);

    const photo = await fetch(`${baseUrl}/api/profile-photos/1`, { headers });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/png");
    assert.equal(photo.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);

    const removal = await fetch(`${baseUrl}/api/me/profile-photo`, { method: "DELETE", headers });
    assert.equal(removal.status, 204);
    const missingPhoto = await fetch(`${baseUrl}/api/profile-photos/1`, { headers });
    assert.equal(missingPhoto.status, 404);
});

test("administrators can upload and remove their own profile photo", async () => {
    const token = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const headers = { Cookie: `sscs_session=${token}` };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    const upload = await fetch(`${baseUrl}/api/me/profile-photo`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/png" },
        body: png,
    });
    assert.equal(upload.status, 200);

    const photo = await fetch(`${baseUrl}/api/profile-photos/2`, { headers });
    assert.equal(photo.status, 200);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);

    const removal = await fetch(`${baseUrl}/api/me/profile-photo`, { method: "DELETE", headers });
    assert.equal(removal.status, 204);
});

test("athletes can request manual profile review and admins can approve it", async () => {
    const athleteToken = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const adminToken = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );

    const request = await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    assert.equal(request.status, 201);
    assert.equal((await request.json()).verification.verification_status, "pending");

    const pendingSummary = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal(pendingSummary.status, 200);
    assert.equal((await pendingSummary.json()).summary.pending_approval_requests, 1);

    const duplicateRequest = await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    assert.equal(duplicateRequest.status, 409);

    const approval = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "verified" }),
    });
    assert.equal(approval.status, 200);
    const { verification } = await approval.json();
    assert.equal(verification.verification_status, "verified");
    assert.equal(verification.verification_reviewed_by, 2);
    const reviewedSummary = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal((await reviewedSummary.json()).summary.pending_approval_requests, 0);

    const revocation = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "unverified" }),
    });
    assert.equal(revocation.status, 200);
    assert.equal((await revocation.json()).verification.verification_status, "unverified");

    await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    const rejection = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "rejected" }),
    });
    assert.equal(rejection.status, 200);
    assert.equal((await rejection.json()).verification.verification_status, "rejected");

    const resubmission = await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    assert.equal(resubmission.status, 201);
    assert.equal((await resubmission.json()).verification.verification_status, "pending");

    const profileEdit = await fetch(`${baseUrl}/api/me/athlete-profile`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${athleteToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sport: "Basketball" }),
    });
    assert.equal(profileEdit.status, 200);
    assert.equal((await profileEdit.json()).athlete.verification_status, "unverified");

    await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    const approvalAfterEdit = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "verified" }),
    });
    assert.equal(approvalAfterEdit.status, 200);

    const unchangedAthleteProfile = await fetch(`${baseUrl}/api/me/athlete-profile`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${athleteToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sport: "Basketball" }),
    });
    assert.equal(unchangedAthleteProfile.status, 200);
    assert.equal((await unchangedAthleteProfile.json()).athlete.verification_status, "verified");

    const scoutToken = jwt.sign(
        { sub: "3", role: "scout" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const previousScoutVerification = scoutVerificationStatus;
    scoutVerificationStatus = "verified";
    const unchangedAgencyProfile = await fetch(`${baseUrl}/api/me/agency-profile`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${scoutToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ agencyName: "Test Agency" }),
    });
    assert.equal(unchangedAgencyProfile.status, 200);
    assert.equal((await unchangedAgencyProfile.json()).agency.verification_status, "verified");
    scoutVerificationStatus = previousScoutVerification;
});
