import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_DB_PATH,
  HIST_DEAL_THRESHOLD,
  draftQueue,
  loadMerchantMap,
  lookup,
  openPriceDb,
  recordSnapshot,
} from "../src/index.js";

const NOW = "2026-09-22T00:00:00.000Z";
const map = loadMerchantMap(new URL("../data/merchant-map.example.json", import.meta.url));

function seed(db, price, seen_at, extra = {}) {
  return recordSnapshot(
    {
      merchant: "midwayusa.com",
      title: "Federal American Eagle 9mm 115gr",
      price,
      seen_at,
      aisle: "ammo",
      currency: "USD",
      source: "seed",
      ...extra,
    },
    { db },
  );
}

test("HIST_DEAL_THRESHOLD is 5 percent and the default database lives under pipeline/data", () => {
  assert.equal(HIST_DEAL_THRESHOLD, 0.05);
  assert.equal(path.basename(DEFAULT_DB_PATH), "price_history.sqlite");
  assert.equal(path.basename(path.dirname(DEFAULT_DB_PATH)), "data");
});

test("opening a database creates the price_history table", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stash-hist-"));
  const dbPath = path.join(dir, "price_history.sqlite");
  const db = openPriceDb(dbPath);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'price_history'").get();
  assert.equal(table.name, "price_history");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unknown history does not reject the price and can be snapshotted", async () => {
  const db = openPriceDb(":memory:");
  const first = await lookup(
    { merchant: "www.midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 64.99, aisle: "ammo" },
    { db, now: NOW, enrich: false },
  );
  assert.equal(first.hist, "unknown");
  assert.equal(first.reason, "no_history");
  assert.equal(first.last_seen, null);
  assert.equal(first.p50_30d, null);
  assert.equal(first.enrichment, null);
  const saved = recordSnapshot(
    {
      merchant: "MidwayUSA.com",
      title: "Federal American Eagle 9mm 115gr",
      price: 64.99,
      seen_at: "2026-09-01T00:00:00.000Z",
      aisle: "ammo",
      source: "ingest",
    },
    { db },
  );
  assert.equal(saved.recorded, true);
  const rows = db.prepare("SELECT merchant, title_raw, price, source, aisle FROM price_history").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].merchant, "midwayusa.com");
  assert.equal(rows[0].title_raw, "Federal American Eagle 9mm 115gr");
  assert.equal(rows[0].price, 64.99);
  assert.equal(rows[0].aisle, "ammo");
  db.close();
});

test("ok when the price is at least 5 percent under last_seen and the 30 day median", async () => {
  const db = openPriceDb(":memory:");
  seed(db, 100, "2026-09-01T00:00:00.000Z");
  seed(db, 110, "2026-09-10T00:00:00.000Z");
  seed(db, 120, "2026-09-20T00:00:00.000Z");
  const result = await lookup(
    { merchant: "midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 104.5, aisle: "ammo" },
    { db, now: NOW, enrich: false },
  );
  assert.equal(result.last_seen, 120);
  assert.equal(result.p50_30d, 110);
  assert.equal(result.hist, "ok");
  assert.equal(result.reason, "at_least_5_percent_below");
  db.close();
});

test("weak when the price is not meaningfully below last seen or the 30 day median", async () => {
  const db = openPriceDb(":memory:");
  seed(db, 100, "2026-08-01T00:00:00.000Z");
  seed(db, 100, "2026-09-10T00:00:00.000Z");
  seed(db, 100, "2026-09-20T00:00:00.000Z");
  const same = await lookup(
    { merchant: "midwayusa.com", title: "federal   american eagle 9mm 115gr", price: 100 },
    { db, now: NOW, enrich: false },
  );
  assert.equal(same.hist, "weak");
  assert.equal(same.reason, "not_meaningfully_below");
  assert.equal(same.p50_30d, 100);
  const barely = await lookup(
    { merchant: "midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 95.01 },
    { db, now: NOW, enrich: false },
  );
  assert.equal(barely.hist, "weak");
  const olderOnly = openPriceDb(":memory:");
  seed(olderOnly, 80, "2026-07-01T00:00:00.000Z");
  const stale = await lookup(
    { merchant: "midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 80 },
    { db: olderOnly, now: NOW, enrich: false },
  );
  assert.equal(stale.hist, "weak");
  assert.equal(stale.last_seen, 80);
  assert.equal(stale.p50_30d, null);
  db.close();
  olderOnly.close();
});

test("sku history matches a different title for the same merchant", async () => {
  const db = openPriceDb(":memory:");
  seed(db, 80, "2026-09-12T00:00:00.000Z", { sku: "ae-9mm", title: "Federal bulk pack" });
  const result = await lookup(
    { merchant: "midwayusa.com", title: "Unrelated label", sku: "AE 9MM", price: 70, aisle: "ammo" },
    { db, now: NOW, enrich: false },
  );
  assert.equal(result.hist, "ok");
  assert.equal(result.last_seen, 80);
  db.close();
});

test("ammoseek cloudflare and timeout skips keep the sqlite result", async () => {
  const db = openPriceDb(":memory:");
  seed(db, 100, "2026-09-15T00:00:00.000Z");
  const cloudflare = await lookup(
    { merchant: "midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 90, aisle: "ammo", category: "ammunition" },
    {
      db,
      now: NOW,
      enrich: true,
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        headers: { get: (name) => (name === "server" ? "cloudflare" : name === "cf-ray" ? "abc" : null) },
        text: async () => "<html>Just a moment...</html>",
      }),
    },
  );
  assert.equal(cloudflare.hist, "ok");
  assert.equal(cloudflare.enrichment.skipped, true);
  assert.equal(cloudflare.enrichment.reason, "cloudflare");

  const timedOut = await lookup(
    { merchant: "midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 90, aisle: "ammo" },
    {
      db,
      now: NOW,
      enrich: true,
      timeoutMs: 20,
      fetchImpl: () => new Promise(() => {}),
    },
  );
  assert.equal(timedOut.hist, "ok");
  assert.equal(timedOut.last_seen, 100);
  assert.equal(timedOut.enrichment.skipped, true);
  assert.equal(timedOut.enrichment.reason, "timeout");

  const failed = await lookup(
    { merchant: "midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 90, aisle: "ammo" },
    {
      db,
      now: NOW,
      enrich: true,
      fetchImpl: async () => {
        throw new Error("socket hang up");
      },
    },
  );
  assert.equal(failed.hist, "ok");
  assert.equal(failed.enrichment.skipped, true);
  assert.equal(failed.enrichment.reason, "unavailable");
  db.close();
});

test("a reachable ammoseek page can attach cpr without changing a weak sqlite flag", async () => {
  const db = openPriceDb(":memory:");
  seed(db, 64.99, "2026-09-18T00:00:00.000Z");
  const result = await lookup(
    { merchant: "midwayusa.com", title: "Federal American Eagle 9mm 115gr", price: 64.99, aisle: "ammo" },
    {
      db,
      now: NOW,
      enrich: true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => "Best CPR $0.40/rd elsewhere $0.26/round",
      }),
    },
  );
  assert.equal(result.hist, "weak");
  assert.equal(result.enrichment.skipped, false);
  assert.equal(result.enrichment.source, "ammoseek");
  assert.equal(result.enrichment.cpr, 0.26);
  db.close();
});

test("optics do not call ammoseek", async () => {
  const db = openPriceDb(":memory:");
  let calls = 0;
  const result = await lookup(
    { merchant: "primaryarms.com", title: "Holosun HS403B", price: 149.99, aisle: "optics" },
    {
      db,
      now: NOW,
      enrich: true,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("network");
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.hist, "unknown");
  assert.equal(result.enrichment, null);
  db.close();
});

test("a weak flag still publishes only when AUTO_PUBLISH is on and review is approved", async () => {
  const raw = await fs.promises.readFile(new URL("../fixtures/emails/primary-arms-hs403b.eml", import.meta.url), "utf8");
  const priceDb = openPriceDb(":memory:");
  const env = { AUTO_PUBLISH: "1", AVANTLINK_AID: "aid-test-only" };
  const first = await draftQueue({
    raw,
    map,
    review: { status: "approved" },
    env,
    priceDb,
    priceHistory: { now: NOW, enrich: false },
  });
  assert.equal(first.candidates[0].hist_price.hist, "unknown");
  assert.equal(first.publish.published, true);
  assert.equal(first.candidates[0].needs_affiliate, false);

  const second = await draftQueue({
    raw,
    map,
    review: { status: "approved" },
    env,
    priceDb,
    priceHistory: { now: NOW, enrich: false },
  });
  assert.equal(second.candidates[0].hist_price.hist, "weak");
  assert.equal(second.publish.published, true);
  assert.equal(second.publish.record.destination, "outbox-only");

  const held = await draftQueue({
    raw,
    map,
    review: { status: "approved" },
    env: { AVANTLINK_AID: "aid-test-only" },
    priceDb,
    priceHistory: { now: NOW, enrich: false },
  });
  assert.equal(held.candidates[0].hist_price.hist, "weak");
  assert.equal(held.publish.published, false);
  assert.equal(held.publish.auto_publish, false);
  priceDb.close();
});
