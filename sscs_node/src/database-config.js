const CONNECTION_POOL_OPTIONS = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
};

export function parsePgSsl(value) {
    if (value === undefined) return undefined;

    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error('PGSSL must be set to "true" or "false".');
}

function withVerifiedTls(connectionString) {
    let url;
    try {
        url = new URL(connectionString);
    } catch {
        throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
    }

    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        throw new Error("DATABASE_URL must use PostgreSQL.");
    }

    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
}

export function createDatabasePoolConfig(environment) {
    if (environment.DATABASE_URL) {
        return {
            ...CONNECTION_POOL_OPTIONS,
            connectionString: withVerifiedTls(environment.DATABASE_URL),
            ssl: { rejectUnauthorized: true },
        };
    }

    const requiredEnvironment = [
        "PGHOST",
        "PGPORT",
        "PGDATABASE",
        "PGUSER",
        "PGPASSWORD",
    ];

    for (const name of requiredEnvironment) {
        if (!environment[name]) {
            throw new Error(`Missing required environment variable ${name}.`);
        }
    }

    const sslEnabled = parsePgSsl(environment.PGSSL);
    return {
        ...CONNECTION_POOL_OPTIONS,
        host: environment.PGHOST,
        port: Number(environment.PGPORT),
        database: environment.PGDATABASE,
        user: environment.PGUSER,
        password: environment.PGPASSWORD,
        ssl: sslEnabled === undefined
            ? undefined
            : sslEnabled
                ? { rejectUnauthorized: true }
                : false,
    };
}
