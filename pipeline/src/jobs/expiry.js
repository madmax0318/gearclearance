import { applyBotRemoval, judgePage, safetyRefusal } from "../expiry/evidence.js";
import { LIMITS } from "../limits.js";

export async function runExpiry({ deals = [], pages = [], archive = [], queue, now = new Date() } = {}) {
  const considered = [];
  for (const page of pages) {
    if (considered.length >= LIMITS.expiryRemovals) break;
    const deal = deals.find((item) => item.slug === page.slug);
    if (!deal) continue;
    const verdict = judgePage(page);
    if (verdict.action !== "remove") continue;
    const refusal = safetyRefusal(deal, deals);
    if (refusal) {
      considered.push({ slug: deal.slug, skipped: refusal });
      continue;
    }
    considered.push({ slug: deal.slug, evidence: verdict.code });
  }
  const ready = considered.filter((item) => item.evidence);
  const chosen = ready.slice(0, 1);
  let removal = null;
  if (chosen.length === 1) {
    removal = applyBotRemoval({
      deals,
      archive,
      queue,
      slug: chosen[0].slug,
      reason: chosen[0].evidence,
      now,
    });
  }
  return {
    considered,
    removals: chosen,
    deferred: ready.slice(1).map((item) => item.slug),
    removal,
  };
}
