import { decodeHref, HOP_HOSTS } from "../decode-links.js";
import { visibleDocument } from "../html-text.js";
import { fetchHardened } from "../fetch-hardened.js";

function itemLinks(xml) {
  const links = [];
  for (const match of String(xml).matchAll(/<link>([^<]+)<\/link>/gi)) links.push(match[1].trim());
  return links;
}

export async function collectPreppingDeals({ rss, fetchImpl, allowlist, impactHops = {} } = {}) {
  const calls = [];
  const guardedFetch = async (url, options) => {
    const host = new URL(url).hostname.toLowerCase();
    calls.push(host);
    if (HOP_HOSTS.includes(host) || host.endsWith(".impact.com")) {
      return { ok: false, reason: "drop" };
    }
    if (fetchImpl) return fetchImpl(url, options);
    return fetchHardened(url, { ...options, job: "preppingdeals", allowlist });
  };
  let rssText = rss;
  if (!rssText) {
    const response = await guardedFetch("https://www.preppingdeals.net/deals/rss.xml", { kind: "page" });
    if (!response?.ok) return { candidates: [], calls };
    rssText = response.body;
  }
  const candidates = [];
  for (const link of itemLinks(rssText || "")) {
    const decoded = decodeHref(link, { impactHops });
    if (!decoded.ok) continue;
    let pageUrl = link;
    try {
      pageUrl = new URL(link).hostname.toLowerCase() === "www.preppingdeals.net" ? link : null;
    } catch {
      pageUrl = null;
    }
    let title = decoded.url;
    if (pageUrl) {
      const page = await guardedFetch(pageUrl, { kind: "page" });
      if (page?.ok && page.body) title = visibleDocument(page.body).text.slice(0, 120) || title;
    }
    candidates.push({
      source_url: decoded.url,
      title,
      price: null,
      merchant_domain: new URL(decoded.url).hostname.replace(/^www\./, ""),
      aisle: null,
    });
  }
  return { candidates, calls };
}
