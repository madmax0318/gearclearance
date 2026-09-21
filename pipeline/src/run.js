import { parseEmail } from "./parse-email.js";
import { decidePublish, publishCandidate } from "./publish.js";
import { wrap } from "./wrap.js";

export async function draftQueue({ raw, map, review, env = process.env } = {}) {
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
  const decision = decidePublish(review ?? { status: "pending" }, env);
  const publish = decision.publish
    ? publishCandidate(candidates, review, env)
    : { published: false, ...decision, record: null };
  return {
    pipeline: ["collect", "clean", "wrap", "review", "publish"],
    stopped_at: decision.publish ? "publish" : "review",
    extractor: parsed.extractor,
    ollama: parsed.ollama,
    candidates,
    publish,
  };
}
