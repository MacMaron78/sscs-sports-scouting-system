import { parsePgSsl } from "./database-config.js";

export class SetupError extends Error {}

function parseDatabaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new SetupError("DATABASE_URL is not a valid PostgreSQL connection URL.");
    }

    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        throw new SetupError("DATABASE_URL must use PostgreSQL.");
    }
    if (url.searchParams.has("host") || url.searchParams.has("database") || url.searchParams.has("dbname")) {
        throw new SetupError("DATABASE_URL must specify its host and database in the URL path.");
    }

    return {
        host: url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
        database: decodeURIComponent(url.pathname.slice(1)),
    };
}

export function getDatabaseTarget(environment) {
    if (environment.DATABASE_URL) {
        return parseDatabaseUrl(environment.DATABASE_URL);
    }

    return {
        host: String(environment.PGHOST ?? "").trim().replace(/^\[|\]$/g, "").toLowerCase(),
        database: String(environment.PGDATABASE ?? "").trim(),
    };
}

export function getSchema(environment) {
    const schema = environment.PGSCHEMA || "sscs_api";
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
        throw new SetupError("PGSCHEMA must be a lowercase PostgreSQL identifier.");
    }
    return schema;
}

export function assertLocalDatabaseTarget(environment) {
    const target = getDatabaseTarget(environment);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (!localHosts.has(target.host) || target.database !== "sscs_db") {
        throw new SetupError("Local admin setup is restricted to the localhost sscs_db database.");
    }
    if (getSchema(environment) !== "sscs_api") {
        throw new SetupError("Local admin setup requires the sscs_api schema.");
    }
    return target;
}

export function assertProductionDatabaseTarget(environment) {
    const target = getDatabaseTarget(environment);
    if (!target.host.endsWith(".neon.tech")) {
        throw new SetupError("Production setup requires a Neon PostgreSQL host.");
    }
    if (target.database !== "neondb") {
        throw new SetupError("Production setup requires the neondb database.");
    }
    if (getSchema(environment) !== "sscs_api") {
        throw new SetupError("Production setup requires the sscs_api schema.");
    }
    if (!environment.DATABASE_URL) {
        let sslEnabled;
        try {
            sslEnabled = parsePgSsl(environment.PGSSL);
        } catch {
            throw new SetupError("Set PGSSL=true when using individual production PostgreSQL settings.");
        }
        if (!sslEnabled) {
            throw new SetupError("Set PGSSL=true when using individual production PostgreSQL settings.");
        }
    }
    return target;
}
