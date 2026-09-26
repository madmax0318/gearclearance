import { visibleDocument } from "../html-text.js";
import { fetchHardened } from "../fetch-hardened.js";

const CDN_PREFIX = "https://dvjr4l3xblvos.cloudfront.net/products/";

function offers(html) {
  const found = [];
  for (const match of String(html).matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const offer = node?.offers || node?.["@graph"]?.flatMap?.((item) => item.offers || []) || null;
        const list = Array.isArray(offer) ? offer : offer ? [offer] : [];
        for (const item of list) {
          if (item && (item["@type"] === "Offer" || item.price != null || item.availability)) found.push(item);
        }
      }
    } catch {
      // Ignore blocks that are not JSON-LD.
    }
  }
  return found;
}

export function candidatesFromAimHtml(html, pageUrl) {
  const blocks = offers(html);
  if (!blocks.length) return { candidates: [], reason: "no_structured_price" };
  const priced = blocks.find((offer) => offer.price != null && offer.price !== "");
  if (!priced) return { candidates: [], reason: "no_structured_price" };
  const visible = visibleDocument(html);
  const image = visible.links.find((href) => href.startsWith(CDN_PREFIX)) || null;
  return {
    candidates: [
      {
        source_url: pageUrl,
        title: visible.text.slice(0, 120),
        price: Number(priced.price),
        price_source: "json-ld",
        image,
        merchant_domain: "aimsurplus.com",
        aisle: null,
      },
    ],
  };
}

export async function collectAim({ pages = [], fetchImpl, allowlist } = {}) {
  const candidates = [];
  const dropped = [];
  for (const pageUrl of pages) {
    const response = fetchImpl
      ? await fetchImpl(pageUrl)
      : await fetchHardened(pageUrl, { job: "aim", allowlist, kind: "page" });
    if (!response?.ok) {
      dropped.push({ url: pageUrl, reason: response?.reason || "upstream" });
      continue;
    }
    const parsed = candidatesFromAimHtml(response.body || "", pageUrl);
    if (!parsed.candidates.length) dropped.push({ url: pageUrl, reason: parsed.reason || "no_structured_price" });
    candidates.push(...parsed.candidates);
  }
  return { candidates, dropped };
}
