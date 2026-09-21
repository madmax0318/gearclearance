import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { decidePublish, publishCandidate, STANDING_PUBLISH_NOTE } from "../src/index.js";

const dealsPath = new URL("../../data/deals.json", import.meta.url);

test("AUTO_PUBLISH defaults off even when review is approved", () => {
  const previous = process.env.AUTO_PUBLISH;
  delete process.env.AUTO_PUBLISH;
  try {
    const decision = decidePublish({ status: "approved" });
    assert.equal(decision.publish, false);
    assert.equal(decision.auto_publish, false);
    assert.match(decision.reason, /standing publish/i);
    assert.match(decision.reason, new RegExp(STANDING_PUBLISH_NOTE.slice(0, 24)));
  } finally {
    if (previous === undefined) delete process.env.AUTO_PUBLISH;
    else process.env.AUTO_PUBLISH = previous;
  }
});

test("AUTO_PUBLISH=0 and AUTO_PUBLISH=1 without approval do not publish", () => {
  assert.equal(decidePublish({ status: "approved" }, { AUTO_PUBLISH: "0" }).publish, false);
  assert.equal(decidePublish({ status: "approved" }, {}).publish, false);
  assert.equal(decidePublish({ status: "pending" }, { AUTO_PUBLISH: "1" }).publish, false);
  assert.equal(decidePublish({ status: "rejected" }, { AUTO_PUBLISH: "1" }).publish, false);
  assert.equal(decidePublish({}, { AUTO_PUBLISH: "1" }).publish, false);
  const held = publishCandidate({ title: "Example" }, { status: "approved" }, { AUTO_PUBLISH: "0" });
  assert.equal(held.published, false);
  assert.equal(held.record, null);
});

test("publish runs only when AUTO_PUBLISH=1 and review.status is approved", () => {
  const before = fs.readFileSync(dealsPath);
  const result = publishCandidate(
    { title: "Augason Farms 30-Day Emergency Food Kit", needs_affiliate: true },
    { status: "approved" },
    { AUTO_PUBLISH: "1" },
  );
  const after = fs.readFileSync(dealsPath);
  assert.equal(result.published, true);
  assert.equal(result.record.destination, "outbox-only");
  assert.equal(result.record.published_at, null);
  assert.match(result.reason, /Standing publish is enabled/);
  assert.match(result.reason, /does not write data\/deals.json/);
  assert.equal(before.equals(after), true);
});
