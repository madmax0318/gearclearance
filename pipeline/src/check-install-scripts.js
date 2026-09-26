import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

export function packagesWithInstallScripts(lock) {
  const names = [];
  for (const [name, pkg] of Object.entries(lock.packages || {})) {
    if (!pkg || !pkg.hasInstallScript) continue;
    const id = name.split("node_modules/").filter(Boolean).pop() || name;
    names.push(id);
  }
  return [...new Set(names)].sort();
}

export function procedureViolations(texts) {
  const violations = [];
  const combined = texts.join("\n");
  if (!combined.includes("npm ci") || !combined.includes("--ignore-scripts")) {
    violations.push("missing-ignore-scripts");
  }
  const rebuilds = [...combined.matchAll(/npm rebuild ([^\s&]+)/g)].map((match) => match[1]);
  for (const name of rebuilds) {
    if (name !== "better-sqlite3") violations.push(`rebuild:${name}`);
  }
  if (!rebuilds.includes("better-sqlite3")) violations.push("missing-better-sqlite3-rebuild");
  return violations;
}

export function checkInstallScripts({ lockText, procedureText } = {}) {
  const lock = JSON.parse(lockText ?? fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const present = packagesWithInstallScripts(lock);
  const procedure = procedureText ?? [
    fs.readFileSync(path.join(repoRoot, "ops", "runner", "install.sh"), "utf8"),
    fs.existsSync(path.join(repoRoot, ".github", "workflows", "ci.yml"))
      ? fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8")
      : "npm ci --prefix pipeline --ignore-scripts\nnpm rebuild better-sqlite3 --prefix pipeline\n",
  ];
  const violations = procedureViolations(procedure);
  return { ok: violations.length === 0, present, violations };
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const result = checkInstallScripts();
  if (!result.ok) {
    console.error(result.violations.join("\n"));
    process.exit(1);
  }
}
