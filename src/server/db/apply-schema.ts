import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for release migration");
const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema.sql",
);
const schema = await fs.readFile(schemaPath, "utf8");
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('vaultfront-schema-v1'))",
  );
  await client.query(schema);
  await client.query("COMMIT");
  console.log("VaultFront schema migration applied transactionally");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
