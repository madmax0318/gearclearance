import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chicagoDate } from "../pipeline/src/dates.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const JOB_SLUG_PREFIX = /^(?:pd|aim|watch)-/;
export const EVIDENCE_CODES = new Set([
  "http-404",
  "http-410",
  "redirect-off-host",
  "redirect-off-product",
  "out-of-stock",
  "discontinued",
  "price-at-or-above-was",
]);

const POLICY_FILES = [
  "data/banned-brands.json",
  "data/merchant-allowlist.json",
  "data/policy-exceptions.json",
];

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function listConfigFiles(dir) {
  const configDir = path.join(dir, "pipeline", "config");
  if (!fs.existsSync(configDir)) return [];
  return fs
    .readdirSync(configDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.posix.join("pipeline/config", name));
}

function fileText(dir, rel) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

export function checkBotDiff({ baseDir, headDir, bot = false, today }) {
  const errors = [];
  const warnings = [];
  const day = today || chicagoDate();
  const policy = new Set([...POLICY_FILES, ...listConfigFiles(baseDir), ...listConfigFiles(headDir)]);
  for (const rel of policy) {
    if (fileText(baseDir, rel) !== fileText(headDir, rel)) {
      if (bot) errors.push(`policy-edit:${rel}`);
    }
  }

  const baseLive = readJson(path.join(baseDir, "data", "deals.json"), []);
  const headLive = readJson(path.join(headDir, "data", "deals.json"), []);
  const headArchive = readJson(path.join(headDir, "data", "expired", "deals.json"), []);
  const baseBySlug = new Map(baseLive.map((deal) => [deal.slug, deal]));
  const headBySlug = new Map(headLive.map((deal) => [deal.slug, deal]));
  const archiveBySlug = new Map(headArchive.map((deal) => [deal.slug, deal]));

  for (const [slug, deal] of headBySlug) {
    if (!baseBySlug.has(slug)) {
      if (!bot && slug.startsWith("watch-")) warnings.push(`watch-row:${slug}`);
      if (!bot) continue;
      if (!JOB_SLUG_PREFIX.test(slug)) errors.push(`slug-prefix:${slug}`);
      if (deal.posted !== day) errors.push(`posted:${slug}`);
      if (deal.curated !== false) errors.push(`curated:${slug}`);
      continue;
    }
    if (bot && stable(baseBySlug.get(slug)) !== stable(deal)) errors.push(`modified:${slug}`);
  }

  if (bot) {
    for (const [slug] of baseBySlug) {
      if (headBySlug.has(slug)) continue;
      const archived = archiveBySlug.get(slug);
      if (!archived) {
        errors.push(`removal-archive:${slug}`);
        continue;
      }
      if (archived.expired_by !== "bot") errors.push(`expired-by:${slug}`);
      if (!EVIDENCE_CODES.has(archived.expired_reason)) errors.push(`evidence:${slug}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function main() {
  const args = process.argv.slice(2);
  const baseDir = flag(args, "--base") || rootDir;
  const headDir = flag(args, "--head") || process.env.HEAD_DIR;
  if (!headDir) {
    console.error("missing head directory");
    process.exit(1);
  }
  const bot =
    flag(args, "--bot") === "true" ||
    (process.env.PR_LOGIN &&
      process.env.PR_LOGIN === process.env.BOT_LOGIN &&
      process.env.PR_USER_TYPE === "Bot");
  const today = flag(args, "--today") || process.env.BOT_TODAY || chicagoDate();
  const result = checkBotDiff({ baseDir, headDir, bot: Boolean(bot), today });
  for (const warning of result.warnings) console.log(`::warning::${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
