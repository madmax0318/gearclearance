export const STANDING_PUBLISH_NOTE =
  "Dave must grant standing publish before enabling. AUTO_PUBLISH stays 0 until that grant. review.status must be approved. This scaffold does not write data/deals.json and does not deploy the site.";

export function decidePublish(review, env = process.env) {
  const hasFlag = env && Object.prototype.hasOwnProperty.call(env, "AUTO_PUBLISH");
  const flag = hasFlag ? env.AUTO_PUBLISH : "0";
  const enabled = String(flag) === "1";
  const status = review?.status ?? null;
  const approved = status === "approved";
  let reason;
  if (!enabled) {
    reason = `AUTO_PUBLISH is off. ${STANDING_PUBLISH_NOTE}`;
  } else if (!approved) {
    reason = `Review status is ${status ?? "missing"}, not approved. ${STANDING_PUBLISH_NOTE}`;
  } else {
    reason =
      "AUTO_PUBLISH=1 and review.status is approved. Standing publish is enabled for this process. This scaffold does not write data/deals.json and does not deploy the site.";
  }
  return {
    publish: enabled && approved,
    auto_publish: enabled,
    review_status: status,
    reason,
  };
}

export function publishCandidate(candidate, review, env = process.env) {
  const decision = decidePublish(review, env);
  if (!decision.publish) {
    return { published: false, ...decision, record: null };
  }
  return {
    published: true,
    ...decision,
    record: {
      candidate,
      published_at: null,
      destination: "outbox-only",
      note: "Scaffold outbox. Does not write data/deals.json or deploy the site.",
    },
  };
}
