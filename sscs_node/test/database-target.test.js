import test from "node:test";
import assert from "node:assert/strict";
import {
    assertLocalDatabaseTarget,
    assertProductionDatabaseTarget,
} from "../src/database-target.js";

test("production target accepts the configured Neon database and schema", () => {
    const target = assertProductionDatabaseTarget({
        DATABASE_URL: "postgresql://user:password@ep-example.us-east-2.aws.neon.tech/neondb",
        PGSCHEMA: "sscs_api",
    });

    assert.deepEqual(target, {
        host: "ep-example.us-east-2.aws.neon.tech",
        database: "neondb",
    });
});

test("production target rejects localhost and non-production database names", () => {
    assert.throws(
        () => assertProductionDatabaseTarget({
            PGHOST: "localhost",
            PGDATABASE: "neondb",
            PGSCHEMA: "sscs_api",
            PGSSL: "true",
        }),
        /requires a Neon PostgreSQL host/,
    );
    assert.throws(
        () => assertProductionDatabaseTarget({
            PGHOST: "ep-example.neon.tech",
            PGDATABASE: "sscs_db",
            PGSCHEMA: "sscs_api",
            PGSSL: "true",
        }),
        /requires the neondb database/,
    );
});

test("production target requires the expected schema and TLS for PG variables", () => {
    assert.throws(
        () => assertProductionDatabaseTarget({
            PGHOST: "ep-example.neon.tech",
            PGDATABASE: "neondb",
            PGSCHEMA: "public",
            PGSSL: "true",
        }),
        /requires the sscs_api schema/,
    );
    assert.throws(
        () => assertProductionDatabaseTarget({
            PGHOST: "ep-example.neon.tech",
            PGDATABASE: "neondb",
            PGSCHEMA: "sscs_api",
            PGSSL: "false",
        }),
        /Set PGSSL=true/,
    );

    assert.equal(assertProductionDatabaseTarget({
        PGHOST: "ep-example.neon.tech",
        PGDATABASE: "neondb",
        PGSCHEMA: "sscs_api",
        PGSSL: " TRUE ",
    }).host, "ep-example.neon.tech");
});

test("production target rejects URL query parameters that could redirect the connection", () => {
    assert.throws(
        () => assertProductionDatabaseTarget({
            DATABASE_URL: "postgresql://user:password@ep-example.neon.tech/neondb?host=localhost",
            PGSCHEMA: "sscs_api",
        }),
        /specify its host and database in the URL path/,
    );
});

test("local admin setup accepts only localhost sscs_db", () => {
    assert.deepEqual(
        assertLocalDatabaseTarget({
            PGHOST: "127.0.0.1",
            PGDATABASE: "sscs_db",
            PGSCHEMA: "sscs_api",
        }),
        { host: "127.0.0.1", database: "sscs_db" },
    );
    assert.throws(
        () => assertLocalDatabaseTarget({
            PGHOST: "ep-example.neon.tech",
            PGDATABASE: "neondb",
            PGSCHEMA: "sscs_api",
        }),
        /restricted to the localhost sscs_db/,
    );
});
