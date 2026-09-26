import { canonicalize, categoryRule } from "../../src/link-policy.mjs";

const KNOWN = new Set([
  "guns",
  "ammo",
  "optics",
  "accessories",
  "apparel",
  "nylon",
  "food-storage",
  "survival",
  "household",
  "gaming",
  "drones",
]);

export function resolveCategory(item) {
  const raw = String(item?.category || item?.aisle || "").trim();
  const url = item?.url || item?.source_url || "";
  const canon = canonicalize(url);
  if (!canon.ok) return canon;
  if (!KNOWN.has(raw)) return { ok: false, reason: "unknown-category", url: canon.url };
  const verdict = categoryRule(canon.host, raw, canon.family);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, url: canon.url };
  return { ok: true, category: raw, url: canon.url };
}
