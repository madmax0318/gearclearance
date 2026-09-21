import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaidAdDraft, PaidAdsError } from "../src/index.js";

function refused(input) {
  assert.throws(() => buildPaidAdDraft(input), (error) => {
    assert.equal(error instanceof PaidAdsError, true);
    assert.equal(error.code, "ADS_WEAPONS_REFUSED");
    assert.match(error.message, /Meta or X/);
    assert.match(error.message, /Guns, Ammo, and weapons-related/);
    return true;
  });
}

test("guns and ammo are refused for paid ads", () => {
  refused({ aisle: "guns", title: "Example pistol" });
  refused({ aisle: "ammo", title: "Example 9mm practice pack" });
  refused({ category: "Guns", title: "Example carbine" });
  refused({ category: "Ammo", title: "Example practice ammunition" });
  refused({ aisle: "gun", title: "Example" });
});

test("weapons-related accessories and optics are refused", () => {
  refused({ aisle: "accessories", title: "Streamlight weapon light" });
  refused({ aisle: "accessories", title: "30 round magazine" });
  refused({ aisle: "optics", title: "Micro red dot" });
  refused({ aisle: "household", title: "Ammo can labeled as household" });
});

test("soft goods return a scaffold and do not call an ads network", () => {
  for (const input of [
    { aisle: "household", title: "Anker portable power station" },
    { aisle: "food-storage", title: "Augason Farms 30-Day Emergency Food Kit" },
    { aisle: "Household goods", title: "Basic drill kit" },
    { aisle: "accessories", title: "Silicone pantry bin lids" },
  ]) {
    const draft = buildPaidAdDraft(input);
    assert.equal(draft.ok, true);
    assert.equal(draft.status, "scaffold");
    assert.equal(draft.spend, false);
    assert.deepEqual(draft.channels, []);
    assert.equal(draft.network_calls, 0);
    assert.match(draft.message, /No Meta or X campaign/);
  }
});

test("non-soft aisles without weapon terms are still outside the scaffold", () => {
  assert.throws(() => buildPaidAdDraft({ aisle: "survival", title: "LifeStraw personal water filter" }), (error) => {
    assert.equal(error.code, "ADS_NOT_SOFT_GOODS");
    assert.match(error.message, /soft-goods only/i);
    return true;
  });
});
