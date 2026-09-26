import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { chicagoDate } from "../dates.js";
import { codedError } from "../log.js";
import { assertDailyCeiling } from "../limits.js";
import { publicPlan } from "../pr-template.js";
import { openState } from "../state-db.js";
import { writeAlert } from "./alert.js";
import { runAim } from "./aim.js";
import { runExpiry } from "./expiry.js";
import { runPreppingDeals } from "./preppingdeals.js";
import { runWatch } from "./watch.js";
import { runWatchPromote } from "./watch-promote.js";

const JOBS = new Set(["watch", "watch-promote", "preppingdeals", "aim", "expiry"]);

export function readAppPrivateKey(env = process.env) {
  const dir = env.CREDENTIALS_DIRECTORY;
  if (!dir) return "";
  const file = path.join(dir, "cred-gh");
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function isDry(argv, env = process.env) {
  if (argv.includes("--dry-run")) return true;
  if (argv.includes("--live")) return false;
  return String(env.STASH_DRY_RUN ?? "1") !== "0";
}

export async function execute(argv, deps = {}) {
  const job = argv[0];
  if (!JOBS.has(job)) throw codedError(2, "job");
  const env = deps.env || process.env;
  const dry = deps.dryRun !== undefined ? deps.dryRun : isDry(argv, env);
  const date = deps.date || chicagoDate();
  const privateKey = readAppPrivateKey(env);
  if (!dry && job !== "watch") {
    if (!env.GH_APP_ID || !env.GH_INSTALLATION_ID || !privateKey) {
      (deps.alert || writeAlert)({ code: 2, job, error: "E_CONFIG" }, { dir: deps.stateDir, journal: deps.journal });
      throw codedError(2, "creds");
    }
  }
  if (deps.db) assertDailyCeiling(deps.db, date);
  let result;
  if (job === "watch") result = await runWatch(deps);
  else if (job === "watch-promote") {
    result = await runWatchPromote({
      ...deps,
      dryRun: dry,
      date,
      tokenOptions: { ...(deps.tokenOptions || {}), appId: env.GH_APP_ID, installationId: env.GH_INSTALLATION_ID, privateKey },
    });
  }
  else if (job === "preppingdeals") result = await runPreppingDeals(deps);
  else if (job === "aim") result = await runAim(deps);
  else result = await runExpiry(deps);
  const plan = publicPlan({
    job: job === "watch-promote" ? "watch-promote" : job,
    dry_run: dry,
    date,
    branch: result.branch,
    candidates: result.candidates || [],
    deferred: result.deferred || [],
    removals: result.removals || [],
  });
  if (deps.planPath) fs.writeFileSync(deps.planPath, `${JSON.stringify(plan)}\n`);
  if (!dry && deps.db && plan.branch) {
    const { recordPull } = await import("../state-db.js");
    recordPull(deps.db, { day: date, job, branch: plan.branch });
  }
  return { code: 0, plan, result };
}

async function main() {
  try {
    const env = process.env.STASH_ENV ? loadConfig(process.env) : process.env;
    if (env.OLLAMA_HOST && !process.env.STASH_ENV) loadConfig(process.env);
    const db = process.env.STASH_STATE ? openState(path.join(process.env.STASH_STATE, "state.sqlite")) : null;
    const outcome = await execute(process.argv.slice(2), {
      env,
      db,
      planPath: process.env.STASH_PLAN || path.join(process.cwd(), "plan.json"),
    });
    if (db) db.close();
    process.exit(outcome.code);
  } catch (error) {
    process.exit(error.exitCode || 1);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
