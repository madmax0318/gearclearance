import { mintInstallationToken } from "../app-token.js";
import { withinHeadroom } from "../limits.js";
import { readRecordedPicks } from "../picks.js";
import { publishPullRequest } from "../publish-pr.js";
import { BRANCH_RE } from "../pr-template.js";

export async function runWatchPromote({
  records = [],
  drive,
  reviewIds,
  now,
  liveCount = 0,
  cards = [],
  dryRun = true,
  date,
  branch,
  tokenOptions,
  fetchImpl,
}) {
  const picks = await readRecordedPicks({ records, drive, reviewIds, now });
  const selected = cards.filter((card) => !picks.accepted.length || picks.accepted.includes(card.pick_id));
  const room = withinHeadroom(liveCount, selected);
  const stamp = String(date || "").replace(/-/g, "");
  const head = branch || `bot/watch/${stamp}-1`;
  if (!BRANCH_RE.test(head)) {
    const error = new Error("branch");
    error.exitCode = 3;
    throw error;
  }
  const plan = {
    job: "watch-promote",
    dry_run: dryRun,
    date,
    branch: head,
    candidates: room.publish.map((card) => ({
      slug: card.slug,
      title: card.title,
      url: card.url,
      category: card.category,
      pick_ids: card.pick_id ? [card.pick_id] : picks.accepted,
    })),
    deferred: [...room.deferred, ...picks.deferred],
  };
  if (!dryRun) {
    const minted = await mintInstallationToken({ ...tokenOptions, fetchImpl });
    await publishPullRequest({
      token: minted.token,
      branch: head,
      job: "watch",
      date,
      cards: plan.candidates,
      fetchImpl,
      untrusted: plan.candidates.map((card) => card.title),
    });
  }
  return plan;
}
