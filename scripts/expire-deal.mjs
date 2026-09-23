import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyReady,
  applyRemoval,
  emptyQueue,
  normalizeQueue,
  planVerification,
  publishedDeals,
} from "../src/expired-reports.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function dataDir() {
  return process.env.STASH_DATA_DIR ? path.resolve(process.env.STASH_DATA_DIR) : path.join(rootDir, "data");
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = Array.isArray(value) && value.length === 0 ? "[]\n" : `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(file, text);
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

export function execute(args, state, now = new Date()) {
  const [cmd, slug] = args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    const prev = args[index - 1];
    return !(prev && prev.startsWith("--"));
  });
  const deals = state.deals;
  const archive = state.archive;
  const queue = state.queue;
  if (cmd === "triage") {
    return {
      code: 0,
      wrote: false,
      deals,
      archive,
      queue,
      json: planVerification(queue, publishedDeals(deals), { now }),
    };
  }
  if (cmd === "remove") {
    if (!slug) return { code: 1, wrote: false, deals, archive, queue, json: { ok: false, error: "missing_slug" } };
    const step = applyRemoval({
      deals,
      archive,
      queue,
      slug,
      by: flag(args, "--by") || "admin",
      reason: flag(args, "--reason") || "verified-expired",
      now,
    });
    return {
      code: step.ok ? 0 : 1,
      wrote: Boolean(step.ok && (step.removed || step.queue !== queue)),
      deals: step.deals,
      archive: step.archive,
      queue: step.queue,
      json: {
        ok: step.ok,
        removed: Boolean(step.removed),
        reason: step.reason || step.error || null,
        slug: step.slug || slug,
        url: step.url ?? null,
        error: step.error || null,
      },
    };
  }
  if (cmd === "apply-ready") {
    if (flag(args, "--confirm") !== "ready") {
      return {
        code: 1,
        wrote: false,
        deals,
        archive,
        queue,
        json: { ok: false, error: "confirm_required", hint: "Re-run with --confirm ready after each merchant url has been checked." },
      };
    }
    const step = applyReady({
      deals,
      archive,
      queue,
      by: flag(args, "--by") || "ion-cannon",
      reason: flag(args, "--reason") || "verified-expired",
      now,
    });
    return {
      code: 0,
      wrote: step.removed.length > 0,
      deals: step.deals,
      archive: step.archive,
      queue: step.queue,
      json: { ok: true, removed: step.removed },
    };
  }
  return {
    code: 1,
    wrote: false,
    deals,
    archive,
    queue,
    json: {
      ok: false,
      error: "usage",
      hint: "node scripts/expire-deal.mjs <triage|remove <slug>|apply-ready --confirm ready>",
    },
  };
}

function main() {
  const dir = dataDir();
  const dealsPath = path.join(dir, "deals.json");
  const archivePath = path.join(dir, "expired", "deals.json");
  const queuePath = path.join(dir, "expired-reports.json");
  const state = {
    deals: readJson(dealsPath),
    archive: readJson(archivePath, []),
    queue: normalizeQueue(readJson(queuePath, emptyQueue())),
  };
  const result = execute(process.argv.slice(2), state);
  if (result.wrote) {
    writeJson(dealsPath, result.deals);
    writeJson(archivePath, result.archive);
    writeJson(queuePath, result.queue);
  }
  console.log(JSON.stringify(result.json, null, 2));
  process.exit(result.code);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
