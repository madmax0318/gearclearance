import { resolveCategory } from "../category-policy.js";
import { decodeHref } from "../decode-links.js";
import { capList, LIMITS } from "../limits.js";
import { parseEmail } from "../parse-email.js";
import { gateMessage } from "../sources/gmail.js";

export async function runWatch({ messages = [], impactHops = {}, allowlist } = {}) {
  const candidates = [];
  for (const message of messages) {
    if (!gateMessage({ headers: message.headers || [], allowlist: allowlist || message.allowlist }).ok) continue;
    const parsed = await parseEmail(message.raw || "", { env: { USE_OLLAMA: "0" } });
    const capped = capList(parsed.candidates || [], LIMITS.perEmail);
    for (const candidate of capped.kept) {
      if (!candidate.source_url) continue;
      const decoded = decodeHref(candidate.source_url, { impactHops });
      if (!decoded.ok) continue;
      const category = resolveCategory({ ...candidate, url: decoded.url, category: candidate.aisle || candidate.category });
      if (!category.ok) continue;
      candidates.push({
        slug: candidate.slug || `watch-item-${candidates.length + 1}`,
        title: candidate.title,
        url: category.url,
        category: category.category,
        merchant: candidate.merchant_domain,
      });
    }
  }
  const limited = capList(candidates, LIMITS.perWatchRun);
  const pulled = capList(limited.kept, LIMITS.perPull);
  return {
    candidates: pulled.kept,
    deferred: [...pulled.deferred, ...limited.deferred].map((item) => item.slug),
  };
}
