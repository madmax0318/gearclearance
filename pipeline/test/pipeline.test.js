import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { draftQueue, loadMerchantMap } from "../src/index.js";

const map = loadMerchantMap(new URL("../data/merchant-map.example.json", import.meta.url));
const dealsPath = new URL("../../data/deals.json", import.meta.url);

test("collect to review stays unpublished when AUTO_PUBLISH is off", async () => {
  const raw = await fs.readFile(new URL("../fixtures/emails/primary-arms-hs403b.eml", import.meta.url), "utf8");
  const before = await fs.readFile(dealsPath);
  const draft = await draftQueue({
    raw,
    map,
    review: { status: "approved" },
    env: { AVANTLINK_AID: "aid-test-only" },
  });
  assert.deepEqual(draft.pipeline, ["collect", "clean", "wrap", "review", "publish"]);
  assert.equal(draft.stopped_at, "review");
  assert.equal(draft.publish.published, false);
  assert.equal(draft.candidates[0].needs_affiliate, false);
  assert.match(draft.candidates[0].affiliate_url, /aid-test-only/);
  assert.equal(draft.candidates[0].source_url.includes("utm_"), false);
  const after = await fs.readFile(dealsPath);
  assert.equal(before.equals(after), true);
});

test("a missing publisher id keeps needs_affiliate true through the queue", async () => {
  const raw = await fs.readFile(new URL("../fixtures/emails/midway-9mm-sale.eml", import.meta.url), "utf8");
  const draft = await draftQueue({
    raw,
    map,
    review: { status: "approved" },
    env: { AUTO_PUBLISH: "1" },
  });
  assert.equal(draft.candidates[0].network, "none");
  assert.equal(draft.candidates[0].needs_affiliate, true);
  assert.equal(draft.candidates[0].affiliate_url, draft.candidates[0].source_url);
  assert.equal(draft.candidates[0].affiliate_url.includes("someone-elses"), false);
  assert.equal(draft.publish.published, true);
  assert.equal(draft.publish.record.destination, "outbox-only");
});
