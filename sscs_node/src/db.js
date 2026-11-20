import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const requiredEnvironment = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
for (const name of requiredEnvironment) {
    if (!process.env[name]) {
        throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and configure it.`);
    }
}

export const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSL === "true" ? {} : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
});

export async function initializeDatabase(databasePool = pool) {
    const schema = process.env.PGSCHEMA || "sscs_api";
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
        throw new Error("PGSCHEMA must be a lowercase PostgreSQL identifier.");
    }

    await databasePool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const schemaSql = await readFile(
        fileURLToPath(new URL("./schema.sql", import.meta.url)),
        "utf8",
    );
    const qualifiedSql = schemaSql.replaceAll("sscs_api.", `"${schema}".`);
    await databasePool.query(qualifiedSql);
}
