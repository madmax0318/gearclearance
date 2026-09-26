import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codedError } from "./log.js";

const OLLAMA_HOST_RE = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):(\d{1,5})$/;

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function isLoopbackOllamaHost(host) {
  const match = OLLAMA_HOST_RE.exec(String(host ?? ""));
  if (!match) return false;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535;
}

export function loadConfig(env = process.env, { exit = true } = {}) {
  const merged = {};
  const file = env.STASH_ENV;
  if (file) {
    if (!fs.existsSync(file)) {
      const error = codedError(2, "E_CONFIG missing config file");
      if (exit) process.exit(2);
      throw error;
    }
    Object.assign(merged, parseEnvFile(fs.readFileSync(file, "utf8")));
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key !== "STASH_ENV") merged[key] = value;
  }
  if (merged.OLLAMA_HOST !== undefined && merged.OLLAMA_HOST !== "" && !isLoopbackOllamaHost(merged.OLLAMA_HOST)) {
    const error = codedError(2, "E_CONFIG ollama host");
    if (exit) process.exit(2);
    throw error;
  }
  return merged;
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  loadConfig();
}
