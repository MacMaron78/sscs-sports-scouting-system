import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;


const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

if (!hasDatabaseUrl) {
  const requiredEnvironment = [
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD"
  ];

  for (const name of requiredEnvironment) {
    if (!process.env[name]) {
      throw new Error(
        `Missing required environment variable ${name}.`
      );
    }
  }
}

export const pool = new Pool({
  ...(hasDatabaseUrl
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: process.env.PGSSL === "true"
          ? { rejectUnauthorized: false }
          : undefined
      }),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
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
