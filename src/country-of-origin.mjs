import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/country-of-origin.json");

const ORIGIN_NOTE = /(?:^|\s)Country of origin:.*$/;

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "sa-35" matches SA-35, SA35, and SA 35. "m&p15 sport iii" stays one phrase.
function patternToRegExp(pattern) {
  const parts = String(pattern)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) throw new Error(`Empty country pattern: ${pattern}`);
  const body = parts.map(escapeRegExp).join("[^a-z0-9]*");
  return new RegExp(`(?:^|[^a-z0-9])${body}(?:[^a-z0-9]|$)`, "i");
}

function compilePatterns(patterns, label) {
  if (!Array.isArray(patterns)) throw new Error(`${label} patterns must be an array`);
  return patterns.map((pattern) => {
    if (typeof pattern !== "string" || !pattern.trim()) throw new Error(`${label} has an empty pattern`);
    return { source: pattern.trim(), re: patternToRegExp(pattern) };
  });
}

export function normalizeCountryTable(data) {
  if (!isObject(data)) throw new Error("Country lookup must be an object");
  if (data.version !== 1) throw new Error("Country lookup version must be 1");
  if (!isObject(data.countries) || Object.keys(data.countries).length === 0) {
    throw new Error("Country lookup is missing country labels");
  }
  const countries = {};
  for (const [name, label] of Object.entries(data.countries)) {
    const country = name.trim();
    if (!country || typeof label !== "string" || !label.trim()) {
      throw new Error(`Country label for ${name || "(blank)"} must be a non-empty string`);
    }
    if (!label.startsWith("Made in ")) {
      throw new Error(`Country label for ${country} must start with "Made in "`);
    }
    countries[country] = label.trim();
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    throw new Error("Country lookup must list at least one entry");
  }
  const seen = new Set();
  const entries = data.entries.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`Country entry ${index} must be an object`);
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) throw new Error(`Country entry ${index} is missing an id`);
    if (seen.has(id)) throw new Error(`Duplicate country entry id ${id}`);
    seen.add(id);
    const country = typeof entry.country === "string" ? entry.country.trim() : "";
    if (!countries[country]) throw new Error(`Country entry ${id} uses unknown country ${country || "(blank)"}`);
    const source = typeof entry.source === "string" ? entry.source.trim() : "";
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      throw new Error(`Country entry ${id} needs an https source URL`);
    }
    if (parsed.protocol !== "https:") throw new Error(`Country entry ${id} source must be https`);
    const note = typeof entry.note === "string" ? entry.note.trim() : "";
    if (!note) throw new Error(`Country entry ${id} is missing a note`);
    const brandDefault = entry.brand_default === true;
    const brands = compilePatterns(entry.brands ?? [], id);
    const models = compilePatterns(entry.models ?? [], id);
    if (brandDefault && models.length) {
      throw new Error(`Country entry ${id} cannot be a brand default and a model rule`);
    }
    if (brandDefault && brands.length === 0) throw new Error(`Country entry ${id} brand default needs a brand`);
    if (!brandDefault && models.length === 0) throw new Error(`Country entry ${id} needs a model pattern`);
    const specificity = models.reduce((max, pattern) => Math.max(max, pattern.source.length), 0);
    return { id, country, source, note, brandDefault, brands, models, specificity };
  });
  return { version: 1, countries, entries };
}

export function loadCountryTable(file = defaultFile) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Country lookup: cannot read ${file} (${error.message})`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Country lookup: ${file} is not valid JSON (${error.message})`);
  }
  return normalizeCountryTable(data);
}

function asCompiled(table) {
  const first = table?.entries?.[0]?.brands?.[0] ?? table?.entries?.[0]?.models?.[0];
  if (first && typeof first === "object" && first.re instanceof RegExp) return table;
  return normalizeCountryTable(table);
}

function anyMatch(patterns, text) {
  return patterns.some((pattern) => pattern.re.test(text));
}

export function matchCountry(text, table = loadCountryTable()) {
  const compiled = asCompiled(table);
  const hay = String(text ?? "");
  const modelHits = [];
  const defaultHits = [];
  for (const entry of compiled.entries) {
    if (entry.brands.length && !anyMatch(entry.brands, hay)) continue;
    if (entry.brandDefault) {
      defaultHits.push(entry);
      continue;
    }
    if (anyMatch(entry.models, hay)) modelHits.push(entry);
  }
  const chosen = modelHits.length ? modelHits : defaultHits;
  if (!chosen.length) return { country: null, entry: null, conflict: false };
  const countries = new Set(chosen.map((entry) => entry.country));
  if (countries.size !== 1) return { country: null, entry: null, conflict: true };
  const entry = chosen.slice().sort((a, b) => b.specificity - a.specificity)[0];
  return { country: entry.country, entry, conflict: false };
}

export function originLabel(country, table = loadCountryTable()) {
  if (typeof country !== "string" || !country.trim()) return "";
  const compiled = asCompiled(table);
  return compiled.countries[country] ?? "";
}

function stripOriginNote(notes) {
  return String(notes ?? "")
    .replace(ORIGIN_NOTE, "")
    .trim();
}

export function applyCountryOfOrigin(candidate, table = loadCountryTable()) {
  const row = { ...candidate, country_of_origin: null };
  const notes = stripOriginNote(row.notes);
  row.notes = notes;
  if (row.aisle !== "guns") return row;
  const hit = matchCountry([row.title, row.raw_subject].filter(Boolean).join("\n"), table);
  if (!hit.country) return row;
  const sentence = `Country of origin: ${hit.country} (${hit.entry.id}).`;
  return {
    ...row,
    country_of_origin: hit.country,
    notes: notes ? `${notes} ${sentence}` : sentence,
  };
}
