import fs from "node:fs";
import path from "node:path";
import { validateJsonSchema } from "./json-schema-lite.mjs";

export const PROJECT_STATUS_SCHEMA_REL = "context/PROJECT_STATUS.schema.json";

export function validateProjectStatusShape(status, repoRoot = process.cwd()) {
  const schemaPath = path.join(repoRoot, PROJECT_STATUS_SCHEMA_REL);
  if (!fs.existsSync(schemaPath))
    return {
      ok: false,
      schemaPath,
      schemaMissing: true,
      errors: [`/${PROJECT_STATUS_SCHEMA_REL} missing`],
    };
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      schemaPath,
      schemaMissing: false,
      errors: [`schema parse error: ${error.message}`],
    };
  }
  const errors = validateJsonSchema(status, schema);
  return { ok: errors.length === 0, schemaPath, schemaMissing: false, errors };
}

export function formatTruthGenome(value, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  if (Number.isInteger(value)) return `${value}/25`;
  if (value && typeof value === "object") {
    if (Number.isFinite(value.score))
      return `${value.score}/${Number.isFinite(value.max) ? value.max : 25}`;
    if (typeof value.status === "string" && value.status.trim())
      return value.status;
  }
  return fallback;
}
