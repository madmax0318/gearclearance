import { MAX_LIVE_DEALS } from "../../scripts/build.mjs";
import { countPulls } from "./state-db.js";
import { codedError } from "./log.js";

export { MAX_LIVE_DEALS };

export const LIMITS = {
  perEmail: 5,
  perWatchRun: 15,
  perPull: 10,
  pullsPerRun: 1,
  expiryRemovals: 3,
  dailyPulls: 8,
};

export function withinHeadroom(liveCount, cards, max = MAX_LIVE_DEALS) {
  const room = Math.max(0, max - liveCount);
  const publish = cards.slice(0, Math.min(room, LIMITS.perPull));
  const deferred = cards.slice(publish.length).map((card) => card.slug);
  return { publish, deferred, room };
}

export function capList(items, max) {
  return { kept: items.slice(0, max), deferred: items.slice(max) };
}

export function assertDailyCeiling(db, day, limit = LIMITS.dailyPulls) {
  if (countPulls(db, day) >= limit) throw codedError(3, "daily-ceiling");
}
