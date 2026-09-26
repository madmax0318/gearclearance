import { resolveCategory } from "../category-policy.js";
import { collectPreppingDeals } from "../sources/preppingdeals.js";
import { capList, LIMITS } from "../limits.js";

export async function runPreppingDeals(options = {}) {
  const collected = await collectPreppingDeals(options);
  const accepted = [];
  for (const candidate of collected.candidates) {
    const category = resolveCategory(candidate);
    if (!category.ok) continue;
    accepted.push({ ...candidate, source_url: category.url, category: category.category });
  }
  const limited = capList(accepted, LIMITS.perPull);
  return {
    candidates: limited.kept.map((candidate, index) => ({
      slug: `pd-item-${index + 1}`,
      title: String(candidate.title || "deal").slice(0, 120),
      url: candidate.source_url,
      category: candidate.category,
    })),
    calls: collected.calls,
    deferred: limited.deferred.map((item) => item.source_url),
  };
}
