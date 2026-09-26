import fs from "node:fs";
import path from "node:path";
import { lookup as dnsLookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { Agent, fetch as undiciFetch } from "undici";
import { codedError } from "./log.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMAIL_CAP = 1_000_000;
const PAGE_CAP = 2_000_000;
const TIMEOUT_MS = 15_000;

const PAGE_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "text/plain",
  "image/jpeg",
  "image/webp",
];

export function loadFetchAllowlist(file = path.join(root, "config", "fetch-allowlist.json")) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ipv4Blocked(value) {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return "bad-ip";
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return "blocked";
  if (a === 169 && b === 254) return "blocked";
  if (a === 172 && b >= 16 && b <= 31) return "blocked";
  if (a === 192 && b === 168) return "blocked";
  if (a === 100 && b >= 64 && b <= 127) return "blocked";
  if (a >= 224) return "blocked";
  if (value === "169.254.169.254") return "blocked";
  return null;
}

export function ipBlocked(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  if (!value) return "empty";
  if (value.includes(":")) return ipv6Blocked(value);
  return ipv4Blocked(value);
}

function ipv6Blocked(value) {
  if (/^64:ff9b::/i.test(value)) return "blocked";
  const dotted = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (dotted) {
    const embedded = ipv4Blocked(dotted[1]);
    if (embedded) return embedded;
    return "blocked";
  }
  const expanded = expandIPv6(value);
  if (!expanded) return "bad-ip";
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return "blocked";
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return "blocked";
  if (expanded.startsWith("0000:0000:0000:0000:0000:ffff:")) {
    const hi = Number.parseInt(expanded.slice(30, 34), 16);
    const lo = Number.parseInt(expanded.slice(35, 39), 16);
    const embedded = ipv4Blocked(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    if (embedded) return embedded;
    return "blocked";
  }
  if (expanded.startsWith("0064:ff9b:0000:0000:0000:0000:")) return "blocked";
  if (expanded.startsWith("2002:")) return "blocked";
  const first = Number.parseInt(expanded.slice(0, 4), 16);
  if ((first & 0xffc0) === 0xfe80) return "blocked";
  if (expanded.startsWith("fc") || expanded.startsWith("fd")) return "blocked";
  if (expanded.startsWith("ff")) return "blocked";
  return null;
}

function expandIPv6(value) {
  const lower = value.toLowerCase();
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    return left.map(pad).join(":");
  }
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map(pad).join(":");
}

function pad(part) {
  return part.padStart(4, "0");
}

export function hostRule(url, job, allowlist) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (parsed.port && parsed.port !== "443") return { ok: false, reason: "port" };
  if (parsed.username || parsed.password) return { ok: false, reason: "userinfo" };
  const rules = allowlist?.jobs?.[job] || [];
  const host = parsed.hostname.toLowerCase();
  const rule = rules.find((item) => item.host === host);
  if (!rule) return { ok: false, reason: "unlisted-host" };
  const pathName = parsed.pathname || "/";
  const prefixes = rule.path_prefixes || [];
  const paths = rule.paths || [];
  const prefixOk = prefixes.length === 0 || prefixes.some((prefix) => pathName.startsWith(prefix));
  const pathOk = paths.length === 0 || paths.includes(pathName) || prefixOk;
  if (!prefixOk && !paths.includes(pathName)) return { ok: false, reason: "bad-path" };
  if (prefixes.length && !prefixOk && !paths.includes(pathName)) return { ok: false, reason: "bad-path" };
  if (!pathOk) return { ok: false, reason: "bad-path" };
  return { ok: true, host, pathname: pathName };
}

function contentTypeOk(header, kind) {
  const value = String(header || "").split(";")[0].trim().toLowerCase();
  if (!value) return false;
  if (kind === "email") return value === "application/json" || value === "message/rfc822" || value === "text/plain";
  return PAGE_TYPES.includes(value);
}

async function defaultResolve(hostname) {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function fetchHardened(input, options = {}) {
  const allowlist = options.allowlist || loadFetchAllowlist();
  const job = options.job;
  const kind = options.kind || "page";
  const cap = kind === "email" ? EMAIL_CAP : PAGE_CAP;
  let current = input;
  let hops = 0;
  const requestHeaders = { ...(options.headers || {}), accept: options.accept || "*/*" };
  delete requestHeaders.cookie;
  delete requestHeaders.Cookie;
  let previousHost = "";
  while (hops <= 3) {
    const rule = hostRule(current, job, allowlist);
    if (!rule.ok) return { ok: false, reason: rule.reason, url: current };
    const resolve = options.resolve || defaultResolve;
    let addresses;
    try {
      addresses = await resolve(rule.host);
    } catch {
      return { ok: false, reason: "dns", url: current };
    }
    if (!addresses?.length) return { ok: false, reason: "dns", url: current };
    for (const address of addresses) {
      if (ipBlocked(address)) return { ok: false, reason: "ssrf", url: current, address };
    }
    const pinned = addresses[0];
    const family = pinned.includes(":") ? 6 : 4;
    const dispatcher =
      options.dispatcher ||
      new Agent({
        connect: {
          lookup(hostname, _opts, callback) {
            if (hostname !== rule.host) {
              callback(new Error("host mismatch"));
              return;
            }
            callback(null, pinned, family);
          },
        },
      });
    const host = new URL(current).host;
    if (previousHost && previousHost !== host) {
      delete requestHeaders.authorization;
      delete requestHeaders.Authorization;
      delete requestHeaders.cookie;
      delete requestHeaders.Cookie;
    }
    previousHost = host;
    const fetchImpl = options.fetchImpl || undiciFetch;
    const timeout = options.timeoutMs ?? TIMEOUT_MS;
    let response;
    try {
      response = await fetchImpl(current, {
        method: options.method || "GET",
        redirect: "manual",
        headers: requestHeaders,
        body: options.body,
        dispatcher,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "upstream";
      return { ok: false, reason, url: current };
    }
    const status = Number(response.status || 0);
    if (status >= 300 && status < 400) {
      const location = response.headers?.get?.("location");
      if (!location) return { ok: false, reason: "redirect", url: current, status };
      if (hops === 3) return { ok: false, reason: "redirect-limit", url: current, status };
      current = new URL(location, current).toString();
      hops += 1;
      continue;
    }
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (length > cap) return { ok: false, reason: "body-cap", url: current, status };
    const type = response.headers?.get?.("content-type");
    if (!contentTypeOk(type, kind)) return { ok: false, reason: "content-type", url: current, status };
    const body = typeof response.text === "function" ? await response.text() : "";
    if (Buffer.byteLength(body) > cap) return { ok: false, reason: "body-cap", url: current, status };
    return { ok: status >= 200 && status < 300, status, url: current, body, address: pinned, hops };
  }
  return { ok: false, reason: "redirect-limit", url: current };
}

export function guardError(reason) {
  return codedError(reason === "timeout" ? 4 : 3, reason);
}
