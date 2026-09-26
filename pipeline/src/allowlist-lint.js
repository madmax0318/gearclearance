import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintMerchantAllowlist } from "../../src/link-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_CDN = /(^|\.)cloudfront\.net$|(^|\.)cloudflare\.net$|(^|\.)googleusercontent\.com$|(^|\.)akamaihd\.net$|(^|\.)fastly\.net$/i;

function exactHost(host) {
  return typeof host === "string" && host.length > 0 && !host.includes("*") && host === host.toLowerCase();
}

export function lintFetchAllowlist(data) {
  const errors = [];
  const jobs = data?.jobs || {};
  for (const [job, rules] of Object.entries(jobs)) {
    for (const rule of rules || []) {
      if (!exactHost(rule.host)) errors.push(`${job}:host:${rule.host}`);
      if (SHARED_CDN.test(rule.host || "") && !(rule.path_prefixes || []).length && !(rule.path_prefix)) {
        errors.push(`${job}:cdn-prefix:${rule.host}`);
      }
    }
  }
  if (!Array.isArray(data?.watch_shorteners)) errors.push("watch_shorteners");
  for (const host of data?.watch_shorteners || []) {
    if (!exactHost(host)) errors.push(`watch_shorteners:${host}`);
  }
  if (!data?.impact_hops || typeof data.impact_hops !== "object" || Array.isArray(data.impact_hops)) {
    errors.push("impact_hops");
  }
  for (const host of Object.keys(data?.impact_hops || {})) {
    if (!exactHost(host)) errors.push(`impact_hops:${host}`);
  }
  return errors;
}

export function lintRepoAllowlists(dir = root) {
  const merchant = JSON.parse(fs.readFileSync(path.resolve(dir, "../data/merchant-allowlist.json"), "utf8"));
  const fetchList = JSON.parse(fs.readFileSync(path.join(dir, "config", "fetch-allowlist.json"), "utf8"));
  return [...lintMerchantAllowlist(merchant), ...lintFetchAllowlist(fetchList)];
}
