#!/usr/bin/env node
import path from "node:path";
import { buildPaidAdDraft } from "./ads.js";
import { loadMerchantMap } from "./merchant-map.js";
import { parseEmailFile } from "./parse-email.js";
import { openPriceDb, resolveDbPath } from "./price-history-db.js";
import { decidePublish } from "./publish.js";
import { wrap } from "./wrap.js";

const [cmd, ...args] = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function positional() {
  return args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    const prev = args[index - 1];
    return !(prev && prev.startsWith("--"));
  });
}

const defaultMap = new URL("../data/merchant-map.example.json", import.meta.url);

if (cmd === "parse") {
  const [file] = positional();
  if (!file) {
    console.error("Usage: node src/cli.js parse <file.eml|file.txt>");
    process.exit(1);
  }
  const result = await parseEmailFile(path.resolve(file));
  console.log(JSON.stringify(result, null, 2));
} else if (cmd === "wrap") {
  const [url] = positional();
  if (!url) {
    console.error("Usage: node src/cli.js wrap <url> [--map merchant-map.json]");
    process.exit(1);
  }
  const map = loadMerchantMap(flag("--map") ? path.resolve(flag("--map")) : defaultMap);
  console.log(JSON.stringify(wrap(url, map), null, 2));
} else if (cmd === "publish") {
  const review = { status: flag("--review") || "pending" };
  console.log(JSON.stringify(decidePublish(review), null, 2));
} else if (cmd === "price-history") {
  const [sub] = positional();
  if (sub !== "init") {
    console.error("Usage: node src/cli.js price-history init [--db path]");
    process.exit(1);
  }
  const dbPath = flag("--db") ? path.resolve(flag("--db")) : resolveDbPath();
  const db = openPriceDb(dbPath);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'price_history'").get();
  const out = { ok: true, path: dbPath, table: table?.name ?? null };
  db.close();
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === "ads") {
  try {
    const draft = buildPaidAdDraft({
      aisle: flag("--aisle"),
      category: flag("--category"),
      title: flag("--title") || "",
    });
    console.log(JSON.stringify(draft, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  console.error("Usage: node src/cli.js <parse|wrap|publish|ads|price-history> ...");
  process.exit(1);
}
