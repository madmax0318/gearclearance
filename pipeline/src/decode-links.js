import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, isShortener } from "../../src/link-policy.mjs";
import { loadFetchAllowlist } from "./fetch-hardened.js";

const CJ_HOSTS = new Set(["www.dpbolvw.net", "www.jdoqocy.com", "www.kqzyfj.com", "www.tkqlhce.com"]);
const DROP_HOSTS = new Set(["amzn.to", "walmrt.us", "rstr.co", "affiliates.harvestright.com"]);
const ASIN_PATH = /\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:\/|$)/;

function decodeParam(value) {
  if (!value) return null;
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  if (!/^https:\/\//i.test(current)) return null;
  return current;
}

function asinFrom(pathname) {
  const match = ASIN_PATH.exec(pathname || "");
  return match ? match[1].toUpperCase() : null;
}

export function loadImpactHops(file) {
  const data = file ? JSON.parse(fs.readFileSync(file, "utf8")) : loadFetchAllowlist();
  return data.impact_hops || {};
}

export function decodeHref(href, { impactHops = loadImpactHops(), depth = 0 } = {}) {
  if (depth > 3) return { ok: false, reason: "drop" };
  let parsed;
  try {
    parsed = new URL(String(href || "").trim());
  } catch {
    return { ok: false, reason: "drop" };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "www.amazon.com") {
    const asin = asinFrom(parsed.pathname);
    if (!asin) return { ok: false, reason: "drop" };
    return { ok: true, url: `https://www.amazon.com/dp/${asin}`, source: "amazon" };
  }
  if (CJ_HOSTS.has(host)) {
    const inner = decodeParam(parsed.searchParams.get("url"));
    if (!inner) return { ok: false, reason: "drop" };
    const next = decodeHref(inner, { impactHops, depth: depth + 1 });
    return next.ok ? { ...next, via: "cj" } : { ok: false, reason: "drop" };
  }
  if (Object.prototype.hasOwnProperty.call(impactHops, host)) {
    const inner = decodeParam(parsed.searchParams.get("url") || parsed.searchParams.get("u"));
    if (!inner) return { ok: false, reason: "drop" };
    const next = decodeHref(inner, { impactHops: {}, depth: depth + 1 });
    return next.ok ? { ...next, via: "impact" } : { ok: false, reason: "drop" };
  }
  if (DROP_HOSTS.has(host) || isShortener(host) || host.endsWith(".impact.com") || host === "impact.com") {
    return { ok: false, reason: "drop" };
  }
  const canon = canonicalize(String(href).trim());
  if (!canon.ok) return { ok: false, reason: "drop" };
  return { ok: true, url: canon.url, source: "merchant" };
}

export const HOP_HOSTS = [...CJ_HOSTS, ...DROP_HOSTS];

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const result = decodeHref(process.argv[2] || "");
  console.log(JSON.stringify(result));
}
