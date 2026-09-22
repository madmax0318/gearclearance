import { parseEmail } from "./parse-email.js";
import { applyPriceHistory, recordPublishedSnapshots } from "./price-history.js";
import { openPriceDb, resolveDbPath } from "./price-history-db.js";
import { decidePublish, publishCandidate } from "./publish.js";
import { wrap } from "./wrap.js";

const HIST_UNAVAILABLE = {
  hist: "unknown",
  last_seen: null,
  p50_30d: null,
  reason: "price_history_unavailable",
  enrichment: null,
};

export async function draftQueue({ raw, map, review, env = process.env, priceDb, priceHistory } = {}) {
  const parsed = await parseEmail(raw, { env });
  const candidates = parsed.candidates.map((candidate) => {
    if (!candidate.source_url) {
      return { ...candidate, affiliate_url: null, network: "none", wrap_reason: "no_source_url" };
    }
    const wrapped = wrap(candidate.source_url, map, env);
    return {
      ...candidate,
      source_url: wrapped.source_url,
      affiliate_url: wrapped.affiliate_url,
      needs_affiliate: wrapped.needs_affiliate,
      network: wrapped.network,
      wrap_reason: wrapped.reason,
    };
  });

  const history = { env, ...(priceHistory ?? {}) };
  if (priceDb !== undefined) history.db = priceDb;
  let opened = null;
  if (history.db === undefined) {
    try {
      opened = openPriceDb(resolveDbPath(env));
      history.db = opened;
    } catch {
      history.db = null;
    }
  }

  const assessed = [];
  try {
    for (const candidate of candidates) {
      if (!history.db) {
        assessed.push({ ...candidate, hist_price: { ...HIST_UNAVAILABLE } });
        continue;
      }
      assessed.push(await applyPriceHistory(candidate, history));
    }
    const decision = decidePublish(review ?? { status: "pending" }, env);
    const publish = decision.publish
      ? publishCandidate(assessed, review, env)
      : { published: false, ...decision, record: null };
    if (publish.published && history.db) recordPublishedSnapshots(assessed, history);
    return {
      pipeline: ["collect", "clean", "wrap", "review", "publish"],
      stopped_at: decision.publish ? "publish" : "review",
      extractor: parsed.extractor,
      ollama: parsed.ollama,
      candidates: assessed,
      publish,
    };
  } finally {
    if (opened) opened.close();
  }
}
