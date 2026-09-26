import { applyRemoval } from "../../../src/expired-reports.mjs";

export const EVIDENCE_CODES = new Set([
  "http-404",
  "http-410",
  "redirect-off-host",
  "redirect-off-product",
  "out-of-stock",
  "discontinued",
  "price-at-or-above-was",
]);

const INCONCLUSIVE = new Set([401, 403, 408, 429, 500, 502, 503, 504]);

export function judgePage({ status, location, productUrl, structured, priceWas, captcha = false, timedOut = false, parseError = false }) {
  if (timedOut || parseError || captcha) return { action: "keep", reason: "inconclusive" };
  if (status === 404) return { action: "remove", code: "http-404" };
  if (status === 410) return { action: "remove", code: "http-410" };
  if (INCONCLUSIVE.has(status) || (status >= 500 && status <= 599)) return { action: "keep", reason: "inconclusive" };
  if (location) {
    let target;
    try {
      target = new URL(location, productUrl);
    } catch {
      return { action: "keep", reason: "inconclusive" };
    }
    const product = new URL(productUrl);
    if (target.hostname !== product.hostname) return { action: "remove", code: "redirect-off-host" };
    if (target.pathname !== product.pathname) return { action: "remove", code: "redirect-off-product" };
  }
  const availability = String(structured?.availability || "");
  if (/OutOfStock/i.test(availability)) return { action: "remove", code: "out-of-stock" };
  if (/Discontinued/i.test(availability)) return { action: "remove", code: "discontinued" };
  const price = structured?.price == null ? null : Number(structured.price);
  if (priceWas != null && price != null && Number.isFinite(price) && price >= Number(priceWas)) {
    return { action: "remove", code: "price-at-or-above-was" };
  }
  return { action: "keep", reason: "live" };
}

export function safetyRefusal(deal, liveDeals) {
  const others = (liveDeals || []).filter((item) => item && item.slug !== deal.slug && item.status !== "expired");
  if (!others.some((item) => item.category === deal.category)) return "empty-category";
  for (const tag of deal.tags || []) {
    if (!others.some((item) => (item.tags || []).includes(tag))) return "last-tag-sample";
  }
  return null;
}

export function applyBotRemoval(state) {
  return applyRemoval({ ...state, by: "bot" });
}
