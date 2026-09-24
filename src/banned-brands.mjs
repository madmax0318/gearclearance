import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/banned-brands.json");

export const DEAL_MATCH_FIELDS = ["slug", "title", "why", "url"];
export const CANDIDATE_MATCH_FIELDS = ["slug", "title", "why", "url", "source_url", "notes", "raw_subject"];

function assertWordBoundary(pattern) {
  const source = String(pattern);
  if (!source.startsWith("\\b") || !source.endsWith("\\b")) {
    throw new Error(
      `Banned brand pattern must be word-boundary safe and start and end with \\b: ${source}`,
    );
  }
}

export function normalizeBannedBrands(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Banned brand blocklist must be an object");
  }
  if (data.version !== 1) throw new Error("Banned brand blocklist version must be 1");
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    throw new Error("Banned brand blocklist must list at least one entry");
  }
  const entries = data.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Banned brand entry ${index} must be an object`);
    }
    const brand = typeof entry.brand === "string" ? entry.brand.trim() : "";
    const scope = typeof entry.scope === "string" ? entry.scope.trim() : "";
    if (!brand) throw new Error(`Banned brand entry ${index} is missing a brand name`);
    if (!scope) throw new Error(`Banned brand ${brand} is missing a scope note`);
    if (!Array.isArray(entry.patterns) || entry.patterns.length === 0) {
      throw new Error(`Banned brand ${brand} is missing match patterns`);
    }
    const patterns = entry.patterns.map((pattern) => {
      if (typeof pattern !== "string" || !pattern.trim()) {
        throw new Error(`Banned brand ${brand} has an empty match pattern`);
      }
      assertWordBoundary(pattern);
      try {
        return { source: pattern, re: new RegExp(pattern, "i") };
      } catch (error) {
        throw new Error(`Banned brand ${brand} has an invalid pattern ${pattern} (${error.message})`);
      }
    });
    return { brand, scope, patterns };
  });
  return { version: 1, entries };
}

export function loadBannedBrands(file = defaultFile) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Banned brand blocklist: cannot read ${file} (${error.message})`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Banned brand blocklist: ${file} is not valid JSON (${error.message})`);
  }
  return normalizeBannedBrands(data);
}

function asCompiled(blocklist) {
  const first = blocklist?.entries?.[0]?.patterns?.[0];
  if (first && typeof first === "object" && first.re instanceof RegExp) return blocklist;
  return normalizeBannedBrands(blocklist);
}

export function matchBannedBrand(record, blocklist = loadBannedBrands(), fields = DEAL_MATCH_FIELDS) {
  const list = asCompiled(blocklist);
  for (const entry of list.entries) {
    for (const field of fields) {
      const value = record?.[field];
      if (value == null || value === "") continue;
      const text = String(value);
      for (const pattern of entry.patterns) {
        pattern.re.lastIndex = 0;
        if (pattern.re.test(text)) {
          return { brand: entry.brand, scope: entry.scope, field, pattern: pattern.source };
        }
      }
    }
  }
  return null;
}

export function screenCandidates(candidates, options = {}) {
  const blocklist = options.blocklist ?? loadBannedBrands(options.file);
  const log = options.log === undefined ? console.error : options.log;
  const fields = options.fields ?? CANDIDATE_MATCH_FIELDS;
  const extraText = options.extraText == null ? "" : String(options.extraText);
  const kept = [];
  const rejected = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const hit =
      matchBannedBrand(candidate, blocklist, fields) ||
      (extraText
        ? matchBannedBrand({ source_text: extraText }, blocklist, ["source_text"])
        : null);
    if (!hit) {
      kept.push(candidate);
      continue;
    }
    const label = candidate?.title || candidate?.source_url || "(untitled candidate)";
    const message = `banned-brand: rejected "${label}" — ${hit.brand}. ${hit.scope}`;
    if (typeof log === "function") log(message);
    rejected.push({
      brand: hit.brand,
      reason: "banned-brand",
      field: hit.field,
      scope: hit.scope,
      title: candidate?.title ?? null,
      source_url: candidate?.source_url ?? null,
      message,
    });
  }
  return { candidates: kept, rejected };
}

export function assertNoBannedLiveDeals(deals, options = {}) {
  const blocklist = options.blocklist ?? loadBannedBrands(options.file);
  const hits = [];
  for (const deal of Array.isArray(deals) ? deals : []) {
    if (!deal || typeof deal !== "object" || deal.status === "expired") continue;
    const hit = matchBannedBrand(deal, blocklist, DEAL_MATCH_FIELDS);
    if (hit) hits.push({ slug: deal.slug || "(missing slug)", ...hit });
  }
  if (hits.length === 0) return;
  const lines = hits.map((hit) => `- ${hit.slug} matches ${hit.brand} (${hit.field})`).join("\n");
  throw new Error(
    `Banned brand blocklist: ${hits.length} live deal(s) match data/banned-brands.json and cannot be published.\n${lines}`,
  );
}
