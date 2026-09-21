import { cleanUrl, merchantDomain } from "./clean-url.js";
import { findMerchant } from "./merchant-map.js";

function failClosed(source_url, network, reason) {
  return {
    source_url,
    affiliate_url: source_url,
    needs_affiliate: true,
    network,
    reason,
  };
}

function readPublisherId(env, name) {
  if (!name || !Object.prototype.hasOwnProperty.call(env, name)) return null;
  const value = env[name];
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.includes("{{") || /\s/.test(trimmed)) return null;
  return trimmed;
}

function applyTemplate(template, sourceUrl, env) {
  if (!template.includes("{{URL}}") && !template.includes("{{ENCODED_URL}}")) {
    return { url: null, reason: "template_missing_destination" };
  }
  let missing = false;
  const encoded = encodeURIComponent(sourceUrl);
  const url = template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (full, name) => {
    if (name === "URL") return sourceUrl;
    if (name === "ENCODED_URL") return encoded;
    const value = readPublisherId(env, name);
    if (!value) {
      missing = true;
      return full;
    }
    return encodeURIComponent(value);
  });
  if (missing || url.includes("{{")) return { url: null, reason: "missing_publisher_env" };
  return { url, reason: "wrapped" };
}

export function wrap(sourceUrl, map, env = process.env) {
  const source_url = cleanUrl(sourceUrl);
  if (!source_url) {
    return {
      source_url: null,
      affiliate_url: null,
      needs_affiliate: true,
      network: "none",
      reason: "invalid_source_url",
    };
  }
  const entry = findMerchant(map, merchantDomain(source_url));
  if (!entry) return failClosed(source_url, "none", "no_map_entry");
  if (entry.status !== "live") return failClosed(source_url, entry.network, `status_${entry.status}`);
  if (!entry.link_template) return failClosed(source_url, entry.network, "missing_template");

  const applied = applyTemplate(entry.link_template, source_url, env);
  if (!applied.url) return failClosed(source_url, entry.network, applied.reason);
  return {
    source_url,
    affiliate_url: applied.url,
    needs_affiliate: false,
    network: entry.network,
    reason: "wrapped",
  };
}
