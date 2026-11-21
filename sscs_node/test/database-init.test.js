import test from "node:test";
import assert from "node:assert/strict";

test("database initialization executes additive support resolution migrations", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.PGSCHEMA = "sscs_api";
    const { initializeDatabase } = await import("../src/db.js");
    const queries = [];
    const databasePool = {
        async query(sql) {
            queries.push(sql);
            return { rows: [], rowCount: 0 };
        },
    };

    await initializeDatabase(databasePool);

    assert.equal(queries.length, 2);
    assert.match(queries[0], /CREATE SCHEMA IF NOT EXISTS "sscs_api"/);
    const schema = queries[1];
    const createTableIndex = schema.search(/CREATE TABLE IF NOT EXISTS "sscs_api"\.support_conversations/);
    const resolvedAtMigrationIndex = schema.search(
        /ALTER TABLE "sscs_api"\.support_conversations\s+ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ/,
    );
    const resolvedByMigrationIndex = schema.search(
        /ALTER TABLE "sscs_api"\.support_conversations\s+ADD COLUMN IF NOT EXISTS resolved_by BIGINT/,
    );
    assert.ok(createTableIndex >= 0);
    assert.ok(resolvedAtMigrationIndex > createTableIndex);
    assert.ok(resolvedByMigrationIndex > createTableIndex);
    assert.match(schema, /ADD COLUMN IF NOT EXISTS resolved_by BIGINT\s+REFERENCES "sscs_api"\.users\(id\) ON DELETE SET NULL/);
    assert.match(schema, /CREATE INDEX IF NOT EXISTS sscs_api_support_conversations_queue_idx/);
    assert.match(schema, /CREATE INDEX IF NOT EXISTS sscs_api_messages_support_inbox_idx/);
    assert.doesNotMatch(
        schema,
        /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+"sscs_api"\.messages/i,
    );

    await initializeDatabase(databasePool);

    assert.equal(queries.length, 4);
    assert.equal(queries[1], queries[3]);
});
