import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codedError } from "../log.js";
import { fetchHardened } from "../fetch-hardened.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadSenderAllowlist(file = path.join(root, "config", "sender-allowlist.json")) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Set((data.domains || []).map((domain) => domain.toLowerCase()));
}

function headerValue(headers, name) {
  const found = headers.find((header) => header.name.toLowerCase() === name);
  return found ? found.value : "";
}

export function fromDomain(value) {
  const match = /@([A-Za-z0-9.-]+)/.exec(String(value || ""));
  return match ? match[1].toLowerCase().replace(/^www\./, "") : "";
}

function parseAuth(value) {
  const text = String(value || "").trim();
  const semi = text.indexOf(";");
  const authserv = (semi === -1 ? text : text.slice(0, semi)).trim().split(/\s+/)[0].toLowerCase();
  const rest = semi === -1 ? "" : text.slice(semi + 1);
  const methods = {};
  const details = {};
  for (const part of rest.split(";")) {
    const match = part.trim().match(/^([a-z0-9]+)\s*=\s*([a-z0-9_-]+)/i);
    if (!match) continue;
    const name = match[1].toLowerCase();
    methods[name] = match[2].toLowerCase();
    details[name] = part;
  }
  return { authserv, methods, details };
}

function instanceOf(value) {
  const match = /\bi\s*=\s*(\d+)/i.exec(String(value || ""));
  return match ? Number(match[1]) : null;
}

function alignedDkim(detail, domain) {
  const text = String(detail || "").toLowerCase();
  return text.includes(`header.d=${domain}`) || text.includes(`header.i=@${domain}`) || text.includes(`header.i=${domain}`);
}

function senderAllowed(domain, allowlist) {
  if (allowlist.has(domain)) return true;
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i += 1) {
    if (allowlist.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

export function gateMessage({ headers, allowlist }) {
  const list = allowlist || loadSenderAllowlist();
  const ordered = (headers || []).filter((header) => header.name.toLowerCase() === "authentication-results");
  const first = ordered[0];
  if (!first) return { ok: false, reason: "no-ar" };
  const parsed = parseAuth(first.value);
  if (parsed.authserv !== "mx.google.com") return { ok: false, reason: "authserv" };
  const domain = fromDomain(headerValue(headers, "from"));
  if (!domain || !senderAllowed(domain, list)) return { ok: false, reason: "sender" };
  const seals = (headers || []).filter((header) => header.name.toLowerCase() === "arc-seal");
  const seen = new Map();
  for (const seal of seals) {
    const instance = instanceOf(seal.value);
    seen.set(instance, (seen.get(instance) || 0) + 1);
    if (seen.get(instance) > 1) return { ok: false, reason: "duplicate-arc" };
  }
  const direct =
    parsed.methods.dmarc === "pass" || (parsed.methods.dkim === "pass" && alignedDkim(parsed.details.dkim, domain));
  if (parsed.methods.arc === "pass") {
    const seal = seals.find((item) => instanceOf(item.value) === 1);
    if (!seal) return { ok: false, reason: "arc-instance" };
    if (/cv=fail/i.test(seal.value)) return { ok: false, reason: "arc-cv" };
    if (!/(?:^|[;\s])d=google\.com(?:[;\s]|$)/i.test(seal.value)) return { ok: false, reason: "arc-seal" };
    const results = (headers || [])
      .filter((header) => header.name.toLowerCase() === "arc-authentication-results")
      .find((header) => instanceOf(header.value) === 1);
    if (!results || !/dmarc=pass/i.test(results.value) || !results.value.toLowerCase().includes(domain)) {
      return { ok: false, reason: "arc-dmarc" };
    }
    return { ok: true, reason: "forwarded" };
  }
  if (direct) return { ok: true, reason: "direct" };
  return { ok: false, reason: "auth" };
}

export async function assertTokeninfo({ fetchImpl, token, expectScope, expectEmail, job = "gmail" }) {
  const url = `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`;
  const response = await (fetchImpl
    ? fetchImpl(url)
    : fetchHardened(url, { job, kind: "email" }));
  if (response?.ok === false && response?.reason) throw codedError(2, response.reason);
  const data = typeof response.json === "function" ? await response.json() : response.body ? JSON.parse(response.body) : response;
  const scopes = String(data.scope || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => scope.split("/").pop());
  if (scopes.length !== 1 || scopes[0] !== expectScope) throw codedError(2, "scope");
  if (String(data.email || "").toLowerCase() !== String(expectEmail || "").toLowerCase()) throw codedError(2, "account");
  return data;
}

export async function assertGmailToken(options) {
  return assertTokeninfo({ ...options, expectScope: "gmail.readonly", expectEmail: options.inbox, job: "gmail" });
}

export async function assertDriveToken(options) {
  return assertTokeninfo({
    ...options,
    expectScope: "drive.file",
    expectEmail: options.account,
    job: "drive",
  });
}
