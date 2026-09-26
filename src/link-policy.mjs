import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultAllowlist = path.join(rootDir, "data", "merchant-allowlist.json");
const defaultExceptions = path.join(rootDir, "data", "policy-exceptions.json");

const SHORTENERS = new Set([
  "t.co",
  "bit.ly",
  "amzn.to",
  "goo.gl",
  "ow.ly",
  "tinyurl.com",
  "rebrand.ly",
  "lnkd.in",
  "walmrt.us",
  "rstr.co",
]);

const AMAZON_SOFT = new Set(["gaming", "household", "food-storage"]);
const AMAZON_GP = /^\/gp\/product\/([A-Za-z0-9]{10})\/?$/;
const URL_PARAM = /^(?:https?:)?\/\//i;
const CLICK_HOST = /^(?:click|links|trk)\./i;

export const AMAZON_PATH = /^\/dp\/[A-Z0-9]{10}$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadAllowlist(file = defaultAllowlist) {
  const data = readJson(file);
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) {
    throw new Error("merchant allowlist must be version 1 with entries");
  }
  const entries = new Map();
  for (const entry of data.entries) {
    if (!entry || typeof entry.host !== "string" || entry.host !== entry.host.toLowerCase()) {
      throw new Error("merchant allowlist host must be lowercase");
    }
    if (entry.host.includes("*")) throw new Error(`wildcard host ${entry.host}`);
    entries.set(entry.host, {
      host: entry.host,
      params: Array.isArray(entry.params) ? entry.params.map((item) => String(item).toLowerCase()) : [],
      path_pattern: entry.path_pattern ? new RegExp(entry.path_pattern) : null,
      path_prefix: typeof entry.path_prefix === "string" ? entry.path_prefix : "",
      family: entry.family || "",
      normalize: entry.normalize || "",
    });
  }
  return { version: 1, entries };
}

export function loadExceptions(file = defaultExceptions) {
  if (!fs.existsSync(file)) return { version: 1, entries: [] };
  const data = readJson(file);
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) {
    throw new Error("policy exceptions must be version 1 with entries");
  }
  return data;
}

function ipLiteral(hostname) {
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

function rawHost(input) {
  const match = /^https?:\/\/([^/?#]+)/i.exec(input);
  return match ? match[1] : "";
}

function hostWithoutUserinfo(authority) {
  const at = authority.lastIndexOf("@");
  return at === -1 ? authority : authority.slice(at + 1);
}

export function isShortener(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (SHORTENERS.has(host)) return true;
  return false;
}

export function isRedirector(hostname, pathname) {
  const host = String(hostname || "").toLowerCase();
  const pathName = pathname || "/";
  if (host === "l.facebook.com") return true;
  if ((host === "google.com" || host === "www.google.com") && (pathName === "/url" || pathName.startsWith("/url/"))) {
    return true;
  }
  return false;
}

export function isClickHost(hostname) {
  return CLICK_HOST.test(String(hostname || ""));
}

function sortedQuery(params, allowed) {
  const keys = [];
  for (const key of params.keys()) keys.push(key);
  const unique = [...new Set(keys)];
  unique.sort();
  const search = new URLSearchParams();
  for (const key of unique) {
    if (!allowed.includes(key.toLowerCase())) return { ok: false, reason: "unlisted-param" };
    const values = params.getAll(key);
    if (values.length !== 1) return { ok: false, reason: "non-canonical" };
    if (URL_PARAM.test(values[0])) return { ok: false, reason: "url-param" };
    search.append(key, values[0]);
  }
  return { ok: true, search: search.toString() };
}

export function canonicalize(input, { allowlist = loadAllowlist() } = {}) {
  if (typeof input !== "string" || !input.trim()) return { ok: false, reason: "empty" };
  const raw = input.trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (parsed.username || parsed.password || rawHost(raw).includes("@")) return { ok: false, reason: "userinfo" };
  if (parsed.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (parsed.port) return { ok: false, reason: "port" };
  if (parsed.hash) return { ok: false, reason: "fragment" };
  if (ipLiteral(parsed.hostname)) return { ok: false, reason: "ip" };

  const authority = hostWithoutUserinfo(rawHost(raw));
  const authorityHost = authority.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (authorityHost !== authorityHost.toLowerCase() || authorityHost.endsWith(".")) {
    return { ok: false, reason: "non-canonical" };
  }

  const host = parsed.hostname.toLowerCase();
  if (isShortener(host)) return { ok: false, reason: "shortener" };
  if (isRedirector(host, parsed.pathname)) return { ok: false, reason: "redirector" };
  if (isClickHost(host)) return { ok: false, reason: "click-host" };

  for (const [, value] of parsed.searchParams.entries()) {
    if (URL_PARAM.test(value)) return { ok: false, reason: "url-param" };
  }

  const entry = allowlist.entries.get(host);
  if (!entry) return { ok: false, reason: "unlisted-host" };

  let pathname = parsed.pathname || "/";
  let amazonRewrite = false;
  if (entry.normalize === "amazon-asin") {
    const gp = AMAZON_GP.exec(pathname);
    if (gp) {
      pathname = `/dp/${gp[1].toUpperCase()}`;
      amazonRewrite = true;
    } else if (!AMAZON_PATH.test(pathname)) {
      return { ok: false, reason: "bad-path" };
    }
    if ([...parsed.searchParams.keys()].length) return { ok: false, reason: "unlisted-param" };
  }

  const query = sortedQuery(parsed.searchParams, entry.params);
  if (!query.ok) return query;

  if (entry.path_prefix && !pathname.startsWith(entry.path_prefix)) {
    return { ok: false, reason: "bad-path" };
  }
  if (entry.path_pattern && !entry.path_pattern.test(pathname)) {
    return { ok: false, reason: "bad-path" };
  }

  const canonical = `https://${host}${pathname}${query.search ? `?${query.search}` : ""}`;
  if (raw !== canonical && !amazonRewrite) return { ok: false, reason: "non-canonical" };

  return {
    ok: true,
    url: canonical,
    host,
    family: entry.family,
    amazonNormalized: amazonRewrite,
  };
}

export function categoryRule(host, category, family) {
  const amazon =
    family === "amazon" ||
    host === "www.amazon.com" ||
    host === "www.walmart.com" ||
    host === "woot.com" ||
    host.endsWith(".woot.com");
  if (!amazon) return { ok: true };
  if (AMAZON_SOFT.has(category)) return { ok: true };
  return { ok: false, reason: "amazon-category" };
}

export function exceptionAllows(exceptions, slug, rule) {
  return (exceptions?.entries || []).some((entry) => entry.slug === slug && entry.rule === rule);
}

export function checkDealUrl(input, { category, slug, allowlist, exceptions } = {}) {
  const list = allowlist ?? loadAllowlist();
  const canon = canonicalize(input, { allowlist: list });
  if (!canon.ok) return canon;
  const categoryVerdict = categoryRule(canon.host, category, canon.family);
  if (!categoryVerdict.ok) {
    if (slug && exceptionAllows(exceptions ?? loadExceptions(), slug, "amazon-soft-goods")) {
      return { ...canon, excepted: true };
    }
    return { ok: false, reason: categoryVerdict.reason, url: canon.url, host: canon.host };
  }
  return canon;
}

const SHARED_CDN = /(^|\.)cloudfront\.net$|(^|\.)cloudflare\.net$|(^|\.)googleapis\.com$|(^|\.)googleusercontent\.com$|(^|\.)akamaihd\.net$|(^|\.)fastly\.net$|^cdn\./i;

export function lintMerchantAllowlist(data) {
  const errors = [];
  const entries = data?.entries || [];
  for (const entry of entries) {
    const host = String(entry?.host || "");
    if (!host || host.includes("*")) errors.push(`wildcard-or-empty:${host}`);
    if (SHARED_CDN.test(host) && !entry.path_prefix) errors.push(`cdn-prefix:${host}`);
  }
  return errors;
}
