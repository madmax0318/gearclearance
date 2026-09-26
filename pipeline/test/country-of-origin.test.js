import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { applyCountryOfOrigin, draftQueue, loadMerchantMap, matchCountry, openPriceDb } from "../src/index.js";

const map = loadMerchantMap(new URL("../data/merchant-map.example.json", import.meta.url));

test("model rules beat a brand default, and an unknown model stays empty", () => {
  const fixture = {
    version: 1,
    countries: {
      "United States": "Made in the USA",
      Croatia: "Made in Croatia",
      Turkey: "Made in Turkey",
    },
    entries: [
      {
        id: "springfield-default",
        brands: ["springfield"],
        brand_default: true,
        country: "United States",
        source: "https://example.com/springfield",
        note: "Fixture brand default used only to prove precedence.",
      },
      {
        id: "hellcat",
        brands: ["springfield"],
        models: ["hellcat"],
        country: "Croatia",
        source: "https://example.com/hellcat",
        note: "Fixture model rule.",
      },
      {
        id: "sa-35",
        brands: ["springfield"],
        models: ["sa-35"],
        country: "Turkey",
        source: "https://example.com/sa-35",
        note: "Fixture model rule that disagrees with the brand default.",
      },
    ],
  };
  assert.equal(matchCountry("Springfield Armory Hellcat 9mm", fixture).country, "Croatia");
  assert.equal(matchCountry("Springfield SA-35", fixture).country, "Turkey");
  assert.equal(matchCountry("Springfield Armory Garrison 1911", fixture).country, "United States");
  assert.equal(matchCountry("No brand here", fixture).country, null);
});

test("the live lookup is model-specific and fail-closed", () => {
  assert.equal(matchCountry("Springfield Armory Hellcat").country, "Croatia");
  assert.equal(matchCountry("Springfield Armory XD-M").country, "Croatia");
  assert.equal(matchCountry("Springfield XD-S").country, "Croatia");
  assert.equal(matchCountry("Springfield Armory Echelon").country, "Croatia");
  assert.equal(matchCountry("Springfield Armory SA-35").country, "United States");
  assert.equal(matchCountry("Springfield Armory SA35").country, "United States");
  assert.equal(matchCountry("Springfield Armory Ronin 1911").country, null);
  assert.equal(matchCountry("Springfield Armory M1A").country, null);
  assert.equal(matchCountry("Glock 19 Gen5 MOS").country, null);
  assert.equal(matchCountry("Glock 22 Gen3 .40").country, null);
  assert.equal(matchCountry("Canik TP9").country, "Turkey");
  assert.equal(matchCountry("Tisas 1911 Duty").country, "Turkey");
  assert.equal(matchCountry("CZ 75 SP-01").country, null);
  assert.equal(matchCountry("Taurus G3").country, null);
  assert.equal(matchCountry("Ruger 10/22 Carbine").country, "United States");
  assert.equal(matchCountry("Sig Sauer P320 Carry").country, "United States");
  assert.equal(matchCountry("Smith & Wesson M&P15 Sport III").country, "United States");
  assert.equal(matchCountry("Smith & Wesson M&P40").country, "United States");
  assert.equal(matchCountry("Smith & Wesson 910").country, null);
  assert.equal(matchCountry("Polish P-83 Wanad").country, "Poland");
  assert.equal(matchCountry("Christensen Arms Ridgeline").country, "United States");
  assert.equal(matchCountry("Geissele Stratomatch").country, null);

  const conflicting = {
    version: 1,
    countries: { Croatia: "Made in Croatia", Turkey: "Made in Turkey" },
    entries: [
      {
        id: "a",
        brands: ["acme"],
        models: ["sidearm"],
        country: "Croatia",
        source: "https://example.com/a",
        note: "One country.",
      },
      {
        id: "b",
        brands: ["acme"],
        models: ["sidearm"],
        country: "Turkey",
        source: "https://example.com/b",
        note: "The other country.",
      },
    ],
  };
  assert.equal(matchCountry("Acme Sidearm", conflicting).country, null);
  assert.equal(matchCountry("Acme Sidearm", conflicting).conflict, true);
});

test("clean leaves non-guns empty and records a guns match", () => {
  const gun = applyCountryOfOrigin({
    aisle: "guns",
    title: "Springfield Armory Hellcat",
    raw_subject: null,
    notes: "Heuristic extract.",
  });
  assert.equal(gun.country_of_origin, "Croatia");
  assert.match(gun.notes, /springfield-hs-produkt/);

  const again = applyCountryOfOrigin(gun);
  assert.equal(again.notes.match(/Country of origin/g).length, 1);

  const other = applyCountryOfOrigin({
    aisle: "optics",
    title: "Canik red dot",
    raw_subject: "Canik",
    notes: "Heuristic extract.",
  });
  assert.equal(other.country_of_origin, null);
  assert.equal(other.notes, "Heuristic extract.");

  const unknown = applyCountryOfOrigin({
    aisle: "guns",
    title: "Springfield Armory Ronin 1911",
    notes: "Heuristic extract.",
  });
  assert.equal(unknown.country_of_origin, null);
});

test("collect and clean fill a Hellcat candidate and leave the live deals file alone", async () => {
  const dealsPath = new URL("../../data/deals.json", import.meta.url);
  const before = await fs.readFile(dealsPath);
  const priceDb = openPriceDb(":memory:");
  const draft = await draftQueue({
    raw: [
      "From: deals@springfield.example.test",
      "Subject: Springfield Armory Hellcat pistol $499",
      "Date: Thu, 18 Sep 2026 15:04:00 +0000",
      "Content-Type: text/plain",
      "",
      "Springfield Armory Hellcat 9mm pistol",
      "Sale price: $499.00",
      "https://www.springfield-armory.com/hellcat-series-handguns/hellcat-3-micro-compact-handguns/",
    ].join("\n"),
    map,
    review: { status: "pending" },
    env: {},
    priceDb,
  });
  assert.equal(draft.candidates[0].aisle, "guns");
  assert.equal(draft.candidates[0].country_of_origin, "Croatia");
  assert.equal(draft.candidates[0].needs_affiliate, true);
  assert.equal(draft.publish.published, false);
  const after = await fs.readFile(dealsPath);
  assert.equal(before.equals(after), true);
  priceDb.close();
});

test("live gun deals agree with the lookup when a rule matches", async () => {
  const deals = JSON.parse(await fs.readFile(new URL("../../data/deals.json", import.meta.url), "utf8"));
  const guns = deals.filter((deal) => deal.category === "guns");
  assert.ok(guns.length > 0);
  for (const deal of guns) {
    assert.equal(typeof deal.country_of_origin, "string", deal.slug);
    const hit = matchCountry(deal.title);
    if (hit.country) assert.equal(deal.country_of_origin, hit.country, deal.slug);
  }
  const austrian = guns.find((deal) => deal.slug === "aim-leo-glock-22-gen3");
  assert.equal(matchCountry(austrian.title).country, null);
  assert.equal(austrian.country_of_origin, "Austria");
});
