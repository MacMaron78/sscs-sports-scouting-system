import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { createDatabasePoolConfig } from "../src/database-config.js";

const individualPgVariables = {
    PGHOST: "ep-example.neon.tech",
    PGPORT: "5432",
    PGDATABASE: "neondb",
    PGUSER: "app-user",
    PGPASSWORD: "not-a-real-password",
};

test("PGSSL parses true and false as explicit SSL settings", () => {
    const enabled = createDatabasePoolConfig({
        ...individualPgVariables,
        PGSSL: " TRUE ",
    });
    const disabled = createDatabasePoolConfig({
        ...individualPgVariables,
        PGSSL: "false",
    });

    assert.deepEqual(enabled.ssl, { rejectUnauthorized: true });
    assert.equal(disabled.ssl, false);
    assert.deepEqual(new pg.Client(enabled).connectionParameters.ssl, { rejectUnauthorized: true });
    assert.equal(new pg.Client(disabled).connectionParameters.ssl, false);
});

test("PGSSL rejects values other than true or false", () => {
    assert.throws(
        () => createDatabasePoolConfig({
            ...individualPgVariables,
            PGSSL: "sometimes",
        }),
        /PGSSL must be set to "true" or "false"/,
    );
});

test("DATABASE_URL takes precedence over PGSSL and enforces verified TLS", () => {
    const config = createDatabasePoolConfig({
        DATABASE_URL: "postgresql://app-user:placeholder@ep-example.neon.tech/neondb?sslmode=disable",
        PGSSL: "false",
    });
    const client = new pg.Client(config);

    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(new URL(config.connectionString).searchParams.get("sslmode"), "verify-full");
    assert.notEqual(client.connectionParameters.ssl, false);
    assert.notEqual(client.connectionParameters.ssl, undefined);
});
