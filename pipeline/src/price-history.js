import { normalizeAisle } from "./aisles.js";
import { insertSnapshot, openPriceDb, resolveDbPath, selectHistory } from "./price-history-db.js";

// Soft goods (gaming, household, food-storage) can add CamelCamelCamel or Keepa later.
// TODO: do not implement Amazon price history in this module, and never use it for guns, ammo, or optics.

export const HIST_DEAL_THRESHOLD = 0.05;
export const AMMOSEEK_TIMEOUT_MS = 8000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeMerchant(value) {
  if (value == null) return "";
  let text = String(value).trim().toLowerCase();
  text = text.replace(/^https?:\/\//, "");
  text = text.split("/")[0].replace(/^www\./, "");
  return text;
}

export function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSku(value) {
  if (value == null) return null;
  const sku = String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return sku || null;
}

export function looksLikeAmmo({ aisle, category } = {}) {
  if (normalizeAisle(aisle) === "ammo" || normalizeAisle(category) === "ammo") return true;
  const blob = `${aisle ?? ""} ${category ?? ""}`.toLowerCase();
  return /\b(ammo|ammunition)\b/.test(blob);
}

function coercePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? Math.round(value * 100) / 100 : null;
  }
  if (value == null || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const price = Math.round(Number(match[1]) * 100) / 100;
  return price > 0 ? price : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function asDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function assessPrice(price, rows, now = new Date()) {
  const clock = asDate(now);
  if (!rows.length) {
    return { hist: "unknown", last_seen: null, p50_30d: null, reason: "no_history" };
  }
  const last_seen = rows[rows.length - 1].price;
  const cutoff = clock.getTime() - 30 * DAY_MS;
  const windowPrices = rows
    .filter((row) => {
      const time = Date.parse(row.seen_at);
      return !Number.isNaN(time) && time >= cutoff && time <= clock.getTime();
    })
    .map((row) => row.price);
  const p50_30d = windowPrices.length ? Math.round(median(windowPrices) * 100) / 100 : null;
  const current = coercePrice(price);
  if (current == null) {
    return { hist: "unknown", last_seen, p50_30d, reason: "missing_price" };
  }
  const baseline = Math.min(...[last_seen, p50_30d].filter((value) => value != null && Number.isFinite(value)));
  const limitCents = Math.round(baseline * (1 - HIST_DEAL_THRESHOLD) * 100);
  const priceCents = Math.round(current * 100);
  if (priceCents <= limitCents) {
    return { hist: "ok", last_seen, p50_30d, reason: "at_least_5_percent_below" };
  }
  return { hist: "weak", last_seen, p50_30d, reason: "not_meaningfully_below" };
}

function skuFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("sku");
  } catch {
    return null;
  }
}

export function snapshotFields(candidate, source) {
  return {
    merchant: candidate.merchant ?? candidate.merchant_domain ?? null,
    title: candidate.title ?? null,
    sku: candidate.sku ?? skuFromUrl(candidate.source_url),
    price: candidate.price,
    currency: candidate.currency || "USD",
    source,
    seen_at: candidate.seen_at ?? candidate.received_at ?? new Date().toISOString(),
    aisle: candidate.aisle ?? null,
    category: candidate.category ?? null,
    title_raw: candidate.title_raw ?? candidate.title ?? null,
  };
}

function unavailableAssessment() {
  return {
    hist: "unknown",
    last_seen: null,
    p50_30d: null,
    reason: "price_history_unavailable",
    enrichment: null,
  };
}

function enrichmentEnabled(options) {
  if (options.enrich === false) return false;
  if (options.enrich === true) return true;
  if (typeof options.fetchImpl === "function") return true;
  const env = options.env ?? process.env;
  return String(env?.AMMOSEEK_ENRICH) === "1";
}

function isCloudflare(status, headers, body) {
  const headerBlob = `${headers?.get?.("server") ?? ""} ${headers?.get?.("cf-ray") ?? ""}`;
  const blob = `${headerBlob}\n${body ?? ""}`.toLowerCase();
  if (/just a moment|cf-browser-verification|attention required/.test(blob)) return true;
  if ((status === 403 || status === 503 || status === 429) && /cloudflare|cf-ray/.test(blob)) return true;
  return false;
}

function parseBestCpr(html) {
  const found = [];
  const patterns = [
    /\$\s*(\d+\.\d{2,4})\s*(?:\/\s*(?:rd|round|rnd)|cpr)\b/gi,
    /\bcpr\b[^$\d]{0,24}\$\s*(\d+\.\d{2,4})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of String(html).matchAll(pattern)) {
      const value = Number(match[1]);
      if (value > 0 && value < 100) found.push(value);
    }
  }
  if (!found.length) return null;
  return Math.min(...found);
}

async function enrichAmmo(input, options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? AMMOSEEK_TIMEOUT_MS;
  const query = input.sku || input.title || "";
  if (!String(query).trim()) {
    return { skipped: true, source: "ammoseek", reason: "missing_query" };
  }
  const url = `https://ammoseek.com/ammo/search?q=${encodeURIComponent(String(query))}`;
  const controller = new AbortController();
  let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const error = new Error("timeout");
        error.code = "timeout";
        reject(error);
      }, timeoutMs);
      Promise.resolve(
        fetchImpl(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { accept: "text/html" },
        }),
      ).then(resolve, reject);
    });
    const status = Number(response?.status ?? 0);
    const body = typeof response?.text === "function" ? await response.text() : "";
    if (isCloudflare(status, response?.headers, body)) {
      return { skipped: true, source: "ammoseek", reason: "cloudflare" };
    }
    if (!response?.ok) return { skipped: true, source: "ammoseek", reason: "unavailable" };
    const cpr = parseBestCpr(body);
    if (cpr == null) return { skipped: true, source: "ammoseek", reason: "no_cpr" };
    return { skipped: false, source: "ammoseek", cpr };
  } catch (error) {
    const timedOut = error?.code === "timeout" || error?.name === "AbortError";
    return { skipped: true, source: "ammoseek", reason: timedOut ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

function withDb(options, fn) {
  const owned = !options.db;
  let db;
  try {
    db = options.db ?? openPriceDb(resolveDbPath(options.env));
  } catch {
    return fn(null, true);
  }
  try {
    return fn(db, false);
  } finally {
    if (owned && db) db.close();
  }
}

export function recordSnapshot(input, options = {}) {
  return withDb(options, (db, failed) => {
    if (failed || !db) return { recorded: false, reason: "price_history_unavailable" };
    const merchant = normalizeMerchant(input.merchant ?? input.merchant_domain);
    const title_raw = input.title_raw ?? input.title ?? null;
    const title_norm = normalizeTitle(input.title ?? title_raw);
    const sku = normalizeSku(input.sku);
    const price = coercePrice(input.price);
    if (!merchant || price == null || (!title_norm && !sku)) {
      return { recorded: false, reason: "incomplete_snapshot" };
    }
    const seen = input.seen_at ?? input.seenAt ?? new Date().toISOString();
    const seenDate = new Date(seen);
    if (Number.isNaN(seenDate.getTime())) return { recorded: false, reason: "invalid_seen_at" };
    const id = insertSnapshot(db, {
      merchant,
      title_norm,
      sku,
      title_raw,
      price,
      currency: String(input.currency || "USD").toUpperCase(),
      source: input.source ?? "snapshot",
      seen_at: seenDate.toISOString(),
      aisle: input.aisle ?? null,
      category: input.category ?? null,
    });
    return { recorded: true, id, merchant, title_norm, sku };
  });
}

export async function lookup(input, options = {}) {
  const owned = !options.db;
  let db;
  try {
    db = options.db ?? openPriceDb(resolveDbPath(options.env));
  } catch {
    return unavailableAssessment();
  }
  try {
    const merchant = normalizeMerchant(input.merchant ?? input.merchant_domain);
    const title_norm = normalizeTitle(input.title);
    const sku = normalizeSku(input.sku);
    const currency = String(input.currency || "USD").toUpperCase();
    let assessment;
    if (!merchant || (!title_norm && !sku)) {
      assessment = { hist: "unknown", last_seen: null, p50_30d: null, reason: "missing_key" };
    } else {
      const rows = selectHistory(db, { merchant, title_norm, sku }).filter(
        (row) => String(row.currency || "USD").toUpperCase() === currency,
      );
      assessment = assessPrice(input.price, rows, options.now);
    }
    let enrichment = null;
    if (looksLikeAmmo(input) && enrichmentEnabled(options)) {
      enrichment = await enrichAmmo({ ...input, sku, title: input.title }, options);
    }
    return { ...assessment, enrichment };
  } finally {
    if (owned && db) db.close();
  }
}

export async function applyPriceHistory(candidate, options = {}) {
  const fields = snapshotFields(candidate, "ingest");
  let hist_price;
  try {
    hist_price = await lookup(fields, options);
  } catch {
    hist_price = unavailableAssessment();
  }
  if (hist_price.reason === "no_history" && options.db) {
    try {
      recordSnapshot(fields, options);
    } catch {
      // A missing snapshot must not stop review or publish.
    }
  }
  return { ...candidate, hist_price };
}

export function recordPublishedSnapshots(candidates, options = {}) {
  return candidates.map((candidate) => {
    try {
      return recordSnapshot(snapshotFields(candidate, "publish"), options);
    } catch {
      return { recorded: false, reason: "snapshot_failed" };
    }
  });
}
