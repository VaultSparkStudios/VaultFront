// json-schema-lite.mjs — zero-dependency validator for the JSON Schema subset
// used by Studio OS contracts. Keep this deliberately small; unsupported schema
// keywords must be added here with tests before a policy file relies on them.

function jsonType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

export function validateJsonSchema(value, schema, pathPrefix = "") {
  const errors = [];
  const at = pathPrefix || "/";

  if (schema.anyOf) {
    const branches = schema.anyOf.map((candidate) =>
      validateJsonSchema(value, candidate, pathPrefix),
    );
    if (!branches.some((branch) => branch.length === 0)) {
      errors.push(`${at} must match at least one allowed shape`);
      for (const branch of branches) errors.push(...branch);
    }
    return errors;
  }
  if (schema.const !== undefined && value !== schema.const)
    errors.push(`${at} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    errors.push(
      `${at} must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
    );

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsonType(value);
    const matches =
      allowed.includes(actual) ||
      (allowed.includes("integer") &&
        actual === "number" &&
        Number.isInteger(value));
    if (!matches) {
      errors.push(`${at} must be ${allowed.join("|")}, got ${actual}`);
      return errors;
    }
  }

  if (
    schema.pattern &&
    typeof value === "string" &&
    !new RegExp(schema.pattern).test(value)
  )
    errors.push(`${at} must match /${schema.pattern}/`);
  if (
    schema.format === "uri" &&
    typeof value === "string" &&
    !/^https?:\/\//.test(value)
  )
    errors.push(`${at} must be http(s) URI`);
  if (
    schema.format === "date" &&
    typeof value === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    errors.push(`${at} must be an ISO date`);
  if (
    schema.format === "date-time" &&
    typeof value === "string" &&
    Number.isNaN(Date.parse(value))
  )
    errors.push(`${at} must be an ISO date-time`);
  if (
    schema.minLength !== undefined &&
    typeof value === "string" &&
    value.length < schema.minLength
  )
    errors.push(`${at} shorter than minLength ${schema.minLength}`);
  if (
    schema.maxLength !== undefined &&
    typeof value === "string" &&
    value.length > schema.maxLength
  )
    errors.push(`${at} longer than maxLength ${schema.maxLength}`);
  if (
    schema.minimum !== undefined &&
    typeof value === "number" &&
    value < schema.minimum
  )
    errors.push(`${at} below minimum ${schema.minimum}`);
  if (
    schema.maximum !== undefined &&
    typeof value === "number" &&
    value > schema.maximum
  )
    errors.push(`${at} above maximum ${schema.maximum}`);
  if (
    schema.maxItems !== undefined &&
    Array.isArray(value) &&
    value.length > schema.maxItems
  )
    errors.push(`${at} exceeds maxItems ${schema.maxItems}`);

  const objectShape =
    value && typeof value === "object" && !Array.isArray(value);
  if ((schema.type === "object" || schema.properties) && objectShape) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${pathPrefix}/${key} required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value)
        errors.push(
          ...validateJsonSchema(
            value[key],
            childSchema,
            `${pathPrefix}/${key}`,
          ),
        );
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties || {})))
          errors.push(`${pathPrefix}/${key} additional property not allowed`);
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) =>
      errors.push(
        ...validateJsonSchema(item, schema.items, `${pathPrefix}/${index}`),
      ),
    );
  }
  if (schema.allOf) {
    for (const child of schema.allOf) {
      if (child.if && child.then) {
        if (validateJsonSchema(value, child.if, pathPrefix).length === 0)
          errors.push(...validateJsonSchema(value, child.then, pathPrefix));
      } else {
        errors.push(...validateJsonSchema(value, child, pathPrefix));
      }
    }
  }
  return errors;
}

export default validateJsonSchema;
