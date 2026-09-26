import { canonicalize } from "../../src/link-policy.mjs";

const TRACKING_EXACT = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "mc_eid",
  "mc_cid",
  "wickedid",
  "wickedsource",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "igshid",
  "tag",
  "ascsubtag",
  "linkcode",
  "linkid",
  "irclickid",
  "irgwc",
  "sharedid",
  "affid",
  "affiliate",
  "affiliate_id",
  "website_id",
  "tt",
  "clickid",
  "ranmid",
  "raneaid",
  "ransiteid",
]);

const AFFILIATE_EXACT = new Set([
  "tag",
  "ascsubtag",
  "linkcode",
  "linkid",
  "irclickid",
  "irgwc",
  "sharedid",
  "affid",
  "affiliate",
  "affiliate_id",
  "website_id",
  "tt",
  "clickid",
  "ranmid",
  "raneaid",
  "ransiteid",
]);

export function isTrackingParam(name) {
  const key = String(name).toLowerCase();
  if (key.startsWith("utm_")) return true;
  return TRACKING_EXACT.has(key);
}

export function isAffiliateParam(name) {
  return AFFILIATE_EXACT.has(String(name).toLowerCase());
}

function isHopper(hostname) {
  const host = hostname.toLowerCase();
  if (host === "google.com" || host.endsWith(".google.com")) return true;
  if (host === "bit.ly" || host === "tinyurl.com") return true;
  return (
    /^(click|email|links|trk|track)\./.test(host) ||
    host.includes("list-manage") ||
    host.includes("awstrack") ||
    host.includes("sendgrid") ||
    host.includes("exacttarget") ||
    host.includes("mailchimp")
  );
}

export function merchantDomain(url) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

export function inspectUrl(input) {
  if (!input || typeof input !== "string") return null;
  const current = input.trim().replace(/[.,;:]+$/g, "");
  let parsed;
  try {
    parsed = new URL(current);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const stripped = [];
  const kept = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (isTrackingParam(key)) stripped.push(key);
    else kept.push([key, value]);
  }
  parsed.hash = "";
  parsed.search = "";
  for (const [key, value] of kept) parsed.searchParams.append(key, value);
  const canon = canonicalize(parsed.toString());
  if (!canon.ok) return null;
  return {
    url: canon.url,
    stripped,
    strippedAffiliate: stripped.some((name) => isAffiliateParam(name)),
  };
}

export function cleanUrl(input) {
  return inspectUrl(input)?.url ?? null;
}

export function extractUrls(text) {
  const re = /https?:\/\/[^\s<>"'\\\])]+/gi;
  return [...String(text).matchAll(re)].map((match) => match[0].replace(/[.,;:]+$/g, ""));
}

export function scoreProductUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return -100;
  }
  let score = 0;
  if (parsed.pathname && parsed.pathname !== "/") score += 5;
  if (isHopper(parsed.hostname)) score -= 20;
  return score;
}
