import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import {
    assertLocalDatabaseTarget,
    assertProductionDatabaseTarget,
    getSchema,
    SetupError,
} from "./database-target.js";

const command = process.argv[2];
const production = command === "create-admin:production" || command === "verify:production-db";
const local = command === "create-admin:local";

if (!production && !local) {
    console.error("Choose create-admin:local, create-admin:production, or verify:production-db.");
    process.exitCode = 1;
} else {
    const environmentFile = fileURLToPath(new URL(production ? "../.env.production" : "../.env", import.meta.url));
    for (const name of [
        "DATABASE_URL",
        "PGHOST",
        "PGPORT",
        "PGDATABASE",
        "PGUSER",
        "PGPASSWORD",
        "PGSSL",
        "PGSCHEMA",
    ]) {
        delete process.env[name];
    }
    const loaded = dotenv.config({ path: environmentFile, override: true, quiet: true });

    if (loaded.error) {
        console.error(production
            ? "Cannot load sscs_node/.env.production. Create it from .env.production.example first."
            : "Cannot load sscs_node/.env. Configure the local database first.");
        process.exitCode = 1;
    } else {
        try {
            if (production) {
                process.env.NODE_ENV = "production";
                assertProductionDatabaseTarget(process.env);
            } else {
                assertLocalDatabaseTarget(process.env);
            }

            const schema = getSchema(process.env);
            const { pool } = await import("./db.js");
            try {
                const result = await pool.query(
                    `SELECT current_database() AS database,
                            EXISTS (
                                SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1
                            ) AS schema_exists`,
                    [schema],
                );
                const database = result.rows[0];
                const expectedDatabase = production ? "neondb" : "sscs_db";
                if (database.database !== expectedDatabase || !database.schema_exists) {
                    throw new SetupError(`Expected database ${expectedDatabase} with schema ${schema}; no changes were made.`);
                }

                if (command === "verify:production-db") {
                    await pool.query("SELECT 1");
                    console.log(JSON.stringify({
                        provider: "Neon",
                        database: database.database,
                        schema,
                        schemaExists: database.schema_exists,
                        readOnlyCheck: "passed",
                    }, null, 2));
                } else {
                    if (production) {
                        const admin = await pool.query(
                            `SELECT EXISTS (SELECT 1 FROM "${schema}".users WHERE role = 'admin') AS exists`,
                        );
                        if (admin.rows[0].exists) {
                            throw new SetupError("A production administrator already exists. No account was created.");
                        }
                    }
                    const { createAdmin } = await import("./create-admin.js");
                    await createAdmin(pool, schema, production);
                }
            } finally {
                await pool.end();
            }
        } catch (error) {
            if (error.code === "23505") {
                console.error("That username or email is already registered. No account was created.");
            } else if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) {
                console.error(`Database operation failed (SQLSTATE ${error.code}). No credentials were displayed.`);
            } else if (error instanceof SetupError) {
                console.error(error.message);
            } else {
                console.error("Setup failed. No credentials were displayed.");
            }
            process.exitCode = 1;
        }
    }
}
