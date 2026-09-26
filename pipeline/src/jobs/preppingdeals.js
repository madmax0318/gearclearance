import { collectPreppingDeals } from "../sources/preppingdeals.js";
import { capList, LIMITS } from "../limits.js";

export async function runPreppingDeals(options = {}) {
  const collected = await collectPreppingDeals(options);
  const limited = capList(collected.candidates, LIMITS.perPull);
  return {
    candidates: limited.kept.map((candidate, index) => ({
      slug: `pd-item-${index + 1}`,
      title: String(candidate.title || "deal").slice(0, 120),
      url: candidate.source_url,
      category: "household",
    })),
    calls: collected.calls,
    deferred: limited.deferred.map((item) => item.source_url),
  };
}
