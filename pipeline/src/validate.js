import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schema");

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });
addFormats(ajv);

const cache = new Map();

export function loadSchema(name) {
  if (!cache.has(name)) {
    const file = path.join(schemaDir, name);
    cache.set(name, JSON.parse(fs.readFileSync(file, "utf8")));
  }
  return cache.get(name);
}

export function validateSchema(name, data) {
  const schema = loadSchema(name);
  const validate = ajv.compile(schema);
  const ok = validate(data);
  return { ok, errors: ok ? [] : validate.errors || [] };
}

export function assertSchema(name, data) {
  const result = validateSchema(name, data);
  if (!result.ok) {
    const detail = result.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`schema ${name}: ${detail}`);
  }
  return data;
}
