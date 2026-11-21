import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDatabasePoolConfig } from "./database-config.js";

const { Pool } = pg;

export const pool = new Pool({
    ...createDatabasePoolConfig(process.env),
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
