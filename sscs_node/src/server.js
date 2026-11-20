import "dotenv/config";
import { createApp } from "./app.js";
import { initializeDatabase, pool } from "./db.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("Set JWT_SECRET to a random value of at least 32 characters in .env.");
}

await initializeDatabase(pool);
await pool.query("SELECT 1");

const port = Number(process.env.PORT || 5000);
const host = "0.0.0.0";
const app = createApp(pool);
const server = app.listen(port, host, () => {
    console.log(`SSCS application listening on ${host}:${port}`);
    console.log(`PostgreSQL schema: ${process.env.PGSCHEMA || "sscs_api"}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
    });
}
