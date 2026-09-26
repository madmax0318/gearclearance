import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  acceptReport,
  AFFILIATE_POLICY,
  applyReady,
  applyRemoval,
  emptyQueue,
  planVerification,
  publishedDeals,
  REPORT_THRESHOLD,
} from "../../src/expired-reports.mjs";

const NOW = new Date("2026-09-23T16:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function deal(slug, extra = {}) {
  return {
    slug,
    title: `${slug} title`,
    merchant: "Primary Arms",
    price_now: 10,
    price_was: 20,
    category: "optics",
    why: "Listed under the usual price.",
    url: `https://www.primaryarms.com/${slug}`,
    curated: false,
    posted: "2026-09-21",
    ...extra,
  };
}

function report(queue, slug, ipHash, when) {
  const step = acceptReport(queue, { slug, ipHash, now: when, source: "site" });
  assert.equal(step.result.ok, true, step.result.error);
  return step;
}

test("live deals stay published and status expired is dropped", () => {
  const deals = [deal("still-live"), deal("gone", { status: "expired" }), deal("default-live", { status: "live" })];
  const live = publishedDeals(deals);
  assert.deepEqual(
    live.map((item) => item.slug),
    ["still-live", "default-live"],
  );
});

test("a honeypot submission is ignored and does not queue", () => {
  const step = acceptReport(emptyQueue(), {
    slug: "still-live",
    company: "Acme Bots",
    ipHash: "aaaa",
    now: NOW,
  });
  assert.equal(step.result.stored, false);
  assert.equal(step.result.reason, "ignored");
  assert.equal(step.queue.reports.length, 0);
});

test("unknown slugs, bad slugs, and repeats are rejected", () => {
  const known = new Set(["still-live"]);
  assert.equal(acceptReport(emptyQueue(), { slug: "nope", knownSlugs: known, ipHash: "aaaa", now: NOW }).result.error, "unknown_deal");
  assert.equal(acceptReport(emptyQueue(), { slug: "Bad Slug", ipHash: "aaaa", now: NOW }).result.status, 400);
  const first = acceptReport(emptyQueue(), { slug: "still-live", ipHash: "aaaa", now: NOW, knownSlugs: known });
  assert.equal(first.result.stored, true);
  const second = acceptReport(first.queue, { slug: "still-live", ipHash: "aaaa", now: new Date(NOW.getTime() + 60_000), knownSlugs: known });
  assert.equal(second.result.stored, false);
  assert.equal(second.result.reason, "duplicate");
  assert.equal(second.queue.reports.length, 1);
});

test("one address cannot meet the threshold, three distinct reporters can", () => {
  let queue = emptyQueue();
  for (let day = 0; day < REPORT_THRESHOLD; day += 1) {
    const step = report(queue, "still-live", "samehash", new Date(NOW.getTime() + day * (DAY + 60_000)));
    queue = step.queue;
    assert.equal(step.result.ready_for_review, false);
  }
  queue = report(queue, "still-live", "bbbb", new Date(NOW.getTime() + 3 * DAY)).queue;
  const third = report(queue, "still-live", "cccc", new Date(NOW.getTime() + 3 * DAY));
  assert.equal(third.result.ready_for_review, true);
  assert.equal(third.result.distinct_reporters, 3);

  const hourly = emptyQueue();
  let blocked = hourly;
  for (let i = 0; i < 8; i += 1) {
    blocked = acceptReport(blocked, {
      slug: `deal-${i}`,
      ipHash: "burst",
      now: new Date(NOW.getTime() + i * 1000),
    }).queue;
  }
  const limited = acceptReport(blocked, { slug: "deal-9", ipHash: "burst", now: new Date(NOW.getTime() + 9000) });
  assert.equal(limited.result.status, 429);
});

test("triage lists only slugs with enough signal and keeps the merchant url bare", () => {
  let queue = emptyQueue();
  queue = report(queue, "still-live", "aaaa", NOW).queue;
  queue = report(queue, "still-live", "bbbb", NOW).queue;
  queue = report(queue, "still-live", "cccc", NOW).queue;
  queue = report(queue, "quiet-deal", "aaaa", NOW).queue;
  const deals = [deal("still-live"), deal("quiet-deal"), deal("gone", { status: "expired" })];
  const plan = planVerification(queue, deals, { now: NOW });
  assert.equal(plan.threshold, 3);
  assert.equal(plan.affiliate_policy, AFFILIATE_POLICY);
  assert.equal(plan.verify.length, 1);
  assert.equal(plan.verify[0].slug, "still-live");
  assert.equal(plan.verify[0].url, "https://www.primaryarms.com/still-live");
  assert.equal(plan.verify[0].url.includes("tag="), false);
  assert.match(plan.verify[0].remove.command, /^node scripts\/expire-deal\.mjs remove still-live --by bot --reason verified-expired$/);
  assert.deepEqual(plan.verify[0].remove.sets, { status: "expired" });
});

test("remove moves the deal to the archive, leaves the url unchanged, and closes reports", () => {
  const original = deal("still-live");
  let queue = emptyQueue();
  queue = report(queue, "still-live", "aaaa", NOW).queue;
  queue = report(queue, "other", "bbbb", NOW).queue;
  const step = applyRemoval({
    deals: [original, deal("other")],
    archive: [],
    queue,
    slug: "still-live",
    by: "bot",
    reason: "price back to $20",
    now: NOW,
  });
  assert.equal(step.ok, true);
  assert.equal(step.removed, true);
  assert.deepEqual(
    step.deals.map((item) => item.slug),
    ["other"],
  );
  assert.equal(step.archive.length, 1);
  assert.equal(step.archive[0].status, "expired");
  assert.equal(step.archive[0].url, original.url);
  assert.equal(step.archive[0].expired_by, "bot");
  assert.equal(step.archive[0].expired_reason, "price back to $20");
  assert.equal(step.queue.reports.find((item) => item.slug === "still-live").status, "removed");
  assert.equal(step.queue.reports.find((item) => item.slug === "other").status, "open");

  const again = applyRemoval({
    deals: step.deals,
    archive: step.archive,
    queue: step.queue,
    slug: "still-live",
    by: "admin",
    now: NOW,
  });
  assert.equal(again.reason, "already_expired");
  assert.equal(again.removed, false);
  assert.equal(again.archive[0].url, original.url);
});

test("apply-ready removes only deals that reached the threshold", () => {
  let queue = emptyQueue();
  for (const ip of ["aaaa", "bbbb", "cccc"]) queue = report(queue, "still-live", ip, NOW).queue;
  queue = report(queue, "quiet-deal", "aaaa", NOW).queue;
  const step = applyReady({
    deals: [deal("still-live"), deal("quiet-deal")],
    archive: [],
    queue,
    now: NOW,
  });
  assert.deepEqual(step.removed, ["still-live"]);
  assert.deepEqual(
    step.deals.map((item) => item.slug),
    ["quiet-deal"],
  );
  assert.equal(step.archive[0].status, "expired");
  assert.equal(publishedDeals(step.deals).some((item) => item.slug === "still-live"), false);
});

test("the expire-deal script writes the archive and drops the slug from the live file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stash-expired-"));
  const live = [deal("still-live"), deal("quiet-deal")];
  fs.writeFileSync(path.join(dir, "deals.json"), `${JSON.stringify(live, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, "expired"));
  fs.writeFileSync(path.join(dir, "expired", "deals.json"), "[]\n");
  let queue = emptyQueue();
  queue = report(queue, "still-live", "aaaa", NOW).queue;
  fs.writeFileSync(path.join(dir, "expired-reports.json"), `${JSON.stringify(queue, null, 2)}\n`);

  const script = fileURLToPath(new URL("../../scripts/expire-deal.mjs", import.meta.url));
  const triage = spawnSync(process.execPath, [script, "triage"], {
    env: { ...process.env, STASH_DATA_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(triage.status, 0, triage.stderr);
  const plan = JSON.parse(triage.stdout);
  assert.equal(plan.verify.length, 0);

  const removed = spawnSync(process.execPath, [script, "remove", "still-live", "--by", "admin", "--reason", "sold out"], {
    env: { ...process.env, STASH_DATA_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(removed.status, 0, removed.stderr);
  const payload = JSON.parse(removed.stdout);
  assert.equal(payload.removed, true);
  assert.equal(payload.url, "https://www.primaryarms.com/still-live");
  const deals = JSON.parse(fs.readFileSync(path.join(dir, "deals.json"), "utf8"));
  const archive = JSON.parse(fs.readFileSync(path.join(dir, "expired", "deals.json"), "utf8"));
  assert.deepEqual(
    deals.map((item) => item.slug),
    ["quiet-deal"],
  );
  assert.equal(archive[0].slug, "still-live");
  assert.equal(archive[0].status, "expired");
  assert.equal(archive[0].url, "https://www.primaryarms.com/still-live");
  assert.equal(archive[0].url.includes("utm_"), false);
});
