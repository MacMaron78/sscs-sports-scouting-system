import jwt from "jsonwebtoken";

const cookieName = "sscs_session";

function getSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
    }
    return secret;
}

export function setSessionCookie(response, user) {
    const token = jwt.sign(
        { sub: String(user.id), role: user.role, ver: Number(user.token_version || 0) },
        getSecret(),
        { expiresIn: "8h", issuer: "sscs-api", audience: "sscs-web" },
    );
    response.cookie(cookieName, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 60 * 60 * 1000,
    });
}

export function clearSessionCookie(response) {
    response.clearCookie(cookieName, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
    });
}

export function requireAuth(databasePool) {
    return async (request, response, next) => {
        try {
            const token = request.cookies[cookieName];
            if (!token) return response.status(401).json({ error: "Please log in to continue." });
            const payload = jwt.verify(token, getSecret(), {
                issuer: "sscs-api",
                audience: "sscs-web",
            });
            const result = await databasePool.query(
                `SELECT id, username, email, role, is_active, token_version, verification_status,
                        profile_photo IS NOT NULL AS has_profile_photo
                 FROM "${process.env.PGSCHEMA || "sscs_api"}".users
                 WHERE id = $1`,
                [payload.sub],
            );
            const user = result.rows[0];
            if (!user || !user.is_active) {
                clearSessionCookie(response);
                return response.status(401).json({ error: "This account is unavailable. Please log in again." });
            }
            if (Number(payload.ver ?? 0) !== Number(user.token_version ?? 0)) {
                clearSessionCookie(response);
                return response.status(401).json({ error: "Your password changed. Please log in again." });
            }
            if (user.role === "admin") {
                user.verification_status = "verified";
            }
            request.user = user;
            return next();
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
                clearSessionCookie(response);
                return response.status(401).json({ error: "Your session has expired. Please log in again." });
            }
            return next(error);
        }
    };
}

export function requireRole(...roles) {
    return (request, response, next) => {
        if (!request.user || !roles.includes(request.user.role)) {
            return response.status(403).json({ error: "You don’t have permission to perform this action." });
        }
        return next();
    };
}

export function getCookieName() {
    return cookieName;
}
