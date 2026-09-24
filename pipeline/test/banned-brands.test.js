import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  assertNoBannedLiveDeals,
  draftQueue,
  loadBannedBrands,
  loadMerchantMap,
  matchBannedBrand,
  normalizeBannedBrands,
  openPriceDb,
  parseEmail,
  screenCandidates,
} from "../src/index.js";

const map = loadMerchantMap(new URL("../data/merchant-map.example.json", import.meta.url));
const dealsPath = new URL("../../data/deals.json", import.meta.url);

function mail({ subject, body }) {
  return `From: AIM Surplus <deals@aimsurplus.example.test>\nSubject: ${subject}\nDate: Thu, 24 Sep 2026 16:00:00 +0000\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`;
}

test("the blocklist names CAA, Uncle Mike's, and BlackHawk SERPA", () => {
  const list = loadBannedBrands();
  assert.deepEqual(
    list.entries.map((entry) => entry.brand),
    ["CAA (Command Arms Accessories)", "Uncle Mike's", "BlackHawk SERPA"],
  );
  for (const entry of list.entries) {
    assert.equal(entry.scope.length > 0, true);
    assert.equal(entry.patterns.length > 0, true);
  }
});

test("CAA matches the word and Command Arms, not a substring inside another word", () => {
  const hits = [
    { title: "CAA Tactical Collapsible Stock" },
    { title: "Command Arms Accessories mil-spec stock" },
    { slug: "aim-caa-collapsible-ar15-stock-cheek-rest" },
    { url: "https://www.aimsurplus.com/products/caa-collapsible-ar15m4-mil-spec-stock" },
    { why: "command-arms cheek rest on sale" },
  ];
  for (const deal of hits) {
    const hit = matchBannedBrand(deal);
    assert.equal(hit?.brand, "CAA (Command Arms Accessories)", JSON.stringify(deal));
  }
  const misses = [
    { title: "Caatinga bushcraft knife" },
    { title: "Broadcast antenna kit" },
    { slug: "maccaa-stock" },
    { why: "because the price dropped" },
    { title: "CAATINGA field guide" },
  ];
  for (const deal of misses) {
    assert.equal(matchBannedBrand(deal), null, JSON.stringify(deal));
  }
});

test("Uncle Mike's matches apostrophe, plural, and slug forms only", () => {
  const hits = [
    { title: "Uncle Mike's Inside-the-Pants Holster" },
    { title: "Uncle Mikes ITP holster" },
    { slug: "aim-uncle-mikes-itp-holster-rh" },
    { url: "https://www.aimsurplus.com/products/uncle-mikes-inside-the-pants-holster" },
    { title: "UNCLE MIKE’S compact holster" },
  ];
  for (const deal of hits) {
    assert.equal(matchBannedBrand(deal)?.brand, "Uncle Mike's", JSON.stringify(deal));
  }
  for (const deal of [{ title: "Uncle Bob's holster" }, { title: "Mike's holster" }, { slug: "myuncle-mikes" }]) {
    assert.equal(matchBannedBrand(deal), null, JSON.stringify(deal));
  }
});

test("SERPA requires that word and leaves other BlackHawk products alone", () => {
  assert.equal(matchBannedBrand({ title: "BlackHawk SERPA Quick Disconnect Female Adapter" })?.brand, "BlackHawk SERPA");
  assert.equal(matchBannedBrand({ slug: "aim-blackhawk-serpa-qd-female" })?.brand, "BlackHawk SERPA");
  assert.equal(matchBannedBrand({ url: "https://www.example.com/products/serpa-qd-female" })?.brand, "BlackHawk SERPA");
  assert.equal(matchBannedBrand({ title: "BlackHawk CQC holster" }), null);
  assert.equal(matchBannedBrand({ title: "Blackhawk Sportster belt" }), null);
  assert.equal(matchBannedBrand({ slug: "blackhawk-omnivore-holster" }), null);
  assert.equal(matchBannedBrand({ why: "superserpa is not a separate word here" }), null);
});

test("the build guard fails closed with the live slug and brand", () => {
  const deal = {
    slug: "aim-caa-collapsible-ar15-stock-cheek-rest",
    title: "CAA Tactical Collapsible AR-15/M4 Stock with Cheek Rest",
    why: "CAA stock",
    url: "https://www.aimsurplus.com/products/caa-collapsible-ar15m4-mil-spec-stock",
  };
  assert.throws(() => assertNoBannedLiveDeals([deal]), (error) => {
    assert.match(error.message, /Banned brand blocklist/);
    assert.match(error.message, /aim-caa-collapsible-ar15-stock-cheek-rest/);
    assert.match(error.message, /CAA \(Command Arms Accessories\)/);
    assert.match(error.message, /cannot be published/);
    return true;
  });
  assert.doesNotThrow(() =>
    assertNoBannedLiveDeals([{ ...deal, status: "expired" }, { slug: "blackhawk-cqc", title: "BlackHawk CQC holster", why: "duty holster", url: "https://example.com/blackhawk-cqc" }]),
  );
});

test("a pattern without word boundaries is rejected", () => {
  assert.throws(
    () =>
      normalizeBannedBrands({
        version: 1,
        entries: [{ brand: "CAA", scope: "Ban the brand.", patterns: ["caa"] }],
      }),
    /word-boundary/,
  );
});

test("live deals.json has no banned-brand match", () => {
  const deals = JSON.parse(fs.readFileSync(dealsPath, "utf8"));
  assert.doesNotThrow(() => assertNoBannedLiveDeals(deals));
});

test("collect/clean rejects a banned candidate and logs the reason", async () => {
  const lines = [];
  const raw = mail({
    subject: "Clearance: Uncle Mike's ITP holster $5.95",
    body: "Uncle Mike's Inside-the-Pants Holster\n$5.95 (was $12.95)\nhttps://www.aimsurplus.com/products/uncle-mikes-inside-the-pants-holster-for-compact-and-subcompact-handguns-right-hand",
  });
  const parsed = await parseEmail(raw, { env: {}, log: (line) => lines.push(line) });
  assert.equal(parsed.candidates.length, 0);
  assert.equal(parsed.rejected.length, 1);
  assert.equal(parsed.rejected[0].reason, "banned-brand");
  assert.equal(parsed.rejected[0].brand, "Uncle Mike's");
  assert.match(lines[0], /banned-brand/);
  assert.match(lines[0], /Uncle Mike's/);

  const priceDb = openPriceDb(":memory:");
  const draft = await draftQueue({
    raw,
    map,
    review: { status: "approved" },
    env: { AUTO_PUBLISH: "1" },
    priceDb,
    log: (line) => lines.push(line),
  });
  assert.equal(draft.candidates.length, 0);
  assert.equal(draft.rejected[0].reason, "banned-brand");
  assert.equal(draft.publish.auto_publish, true);
  assert.equal(draft.publish.published, true);
  assert.equal(JSON.stringify(draft.publish).toLowerCase().includes("uncle"), false);
  assert.equal(JSON.stringify(draft.candidates).toLowerCase().includes("serpa"), false);
  priceDb.close();
});

test("a BlackHawk product without SERPA still ingests and AUTO_PUBLISH is unchanged", async () => {
  const lines = [];
  const raw = mail({
    subject: "Clearance: BlackHawk CQC holster $19.95",
    body: "BlackHawk CQC holster\n$19.95 (was $40.00)\nhttps://www.aimsurplus.com/products/blackhawk-cqc-holster",
  });
  const priceDb = openPriceDb(":memory:");
  const draft = await draftQueue({
    raw,
    map,
    review: { status: "approved" },
    env: { AUTO_PUBLISH: "1" },
    priceDb,
    log: (line) => lines.push(line),
  });
  assert.equal(draft.rejected.length, 0);
  assert.equal(lines.length, 0);
  assert.equal(draft.candidates.length, 1);
  assert.match(draft.candidates[0].title, /BlackHawk CQC holster/);
  assert.equal(draft.publish.published, true);
  assert.equal(draft.publish.auto_publish, true);
  assert.match(draft.publish.record.candidate[0].title, /BlackHawk CQC holster/);
  priceDb.close();
});

test("screenCandidates drops Command Arms and SERPA before they become cards", () => {
  const lines = [];
  const result = screenCandidates(
    [
      { title: "Command Arms Accessories stock", source_url: "https://shop.example/command-arms-stock", notes: "", raw_subject: "Command Arms stock" },
      { title: "BlackHawk SERPA holster", source_url: "https://shop.example/blackhawk-serpa-holster", notes: "", raw_subject: "SERPA" },
      { title: "BlackHawk CQC holster", source_url: "https://shop.example/blackhawk-cqc-holster", notes: "", raw_subject: "BlackHawk CQC" },
    ],
    { log: (line) => lines.push(line) },
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, "BlackHawk CQC holster");
  assert.deepEqual(
    result.rejected.map((item) => item.brand),
    ["CAA (Command Arms Accessories)", "BlackHawk SERPA"],
  );
  assert.equal(lines.length, 2);
  assert.match(lines[0], /banned-brand/);
  assert.match(lines[1], /SERPA/);
});
