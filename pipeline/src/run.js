import { screenCandidates } from "../../src/banned-brands.mjs";
import { applyCountryOfOrigin } from "../../src/country-of-origin.mjs";
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

export async function draftQueue({ raw, map, review, env = process.env, priceDb, priceHistory, log } = {}) {
  const parsed = await parseEmail(raw, { env, log });
  // Collect already dropped banned brands. Screen again after that clean so a later
  // collector path cannot wrap a banned candidate into a card. AUTO_PUBLISH is unchanged.
  const screened = screenCandidates(parsed.candidates, { log });
  const rejected = [...(parsed.rejected ?? []), ...screened.rejected];
  const candidates = screened.candidates.map((candidate) => {
    // Clean fills country_of_origin for guns from the verified lookup. A miss stays null.
    const withOrigin = applyCountryOfOrigin(candidate);
    if (!withOrigin.source_url) {
      return { ...withOrigin, affiliate_url: null, network: "none", wrap_reason: "no_source_url" };
    }
    const wrapped = wrap(withOrigin.source_url, map, env);
    return {
      ...withOrigin,
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
      rejected,
      publish,
    };
  } finally {
    if (opened) opened.close();
  }
}
