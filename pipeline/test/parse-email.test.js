import assert from "node:assert/strict";
import { test } from "node:test";
import { CANDIDATE_FIELDS, parseEmail, parseEmailFile } from "../src/index.js";

const fixture = (name) => new URL(`../fixtures/emails/${name}`, import.meta.url);

function assertShape(row) {
  for (const field of CANDIDATE_FIELDS) assert.equal(Object.hasOwn(row, field), true, field);
  assert.equal(typeof row.needs_affiliate, "boolean");
  assert.equal(row.confidence >= 0 && row.confidence <= 0.9, true);
}

test("parses a multipart Primary Arms clearance message", async () => {
  const result = await parseEmailFile(fixture("primary-arms-hs403b.eml"), { env: {} });
  assert.equal(result.extractor, "heuristic");
  assert.equal(result.ollama.attempted, false);
  assert.equal(result.candidates.length, 1);
  const row = result.candidates[0];
  assertShape(row);
  assert.equal(row.source_url, "https://www.primaryarms.com/holosun-hs403b-micro-red-dot");
  assert.equal(row.source_url.includes("utm_"), false);
  assert.equal(row.merchant_domain, "primaryarms.com");
  assert.equal(row.price, 149.99);
  assert.equal(row.aisle, "optics");
  assert.equal(row.needs_affiliate, true);
  assert.match(row.title, /Holosun HS403B/);
  assert.equal(row.raw_subject, "Clearance: Holosun HS403B micro red dot $149.99 (was $229.99)");
  assert.equal(row.raw_from, "Primary Arms Deals <deals@mail.primaryarms.example.test>");
  assert.equal(row.received_at, "2026-09-18T15:04:00.000Z");
  assert.match(row.notes, /No affiliate tag was added/);
  assert.equal(JSON.stringify(result).includes("evil.example"), false);
});

test("parses a plain-text food storage note without headers", async () => {
  const result = await parseEmailFile(fixture("emergency-food-kit.txt"), { env: {} });
  const row = result.candidates[0];
  assertShape(row);
  assert.equal(row.source_url, "https://www.beprepared.com/products/emergency-food-supply-30-days");
  assert.equal(row.source_url.includes("fbclid"), false);
  assert.equal(row.source_url.includes("utm_"), false);
  assert.equal(row.merchant_domain, "beprepared.com");
  assert.equal(row.price, 119);
  assert.equal(row.aisle, "food-storage");
  assert.equal(row.title, "Augason Farms 30-Day Emergency Food Kit");
  assert.equal(row.raw_subject, null);
  assert.equal(row.raw_from, null);
  assert.equal(row.received_at, null);
  assert.equal(row.needs_affiliate, true);
  assert.match(row.notes, /Plain text had no RFC 5322 headers/);
});

test("classifies a base layer note as apparel", async () => {
  const result = await parseEmail(
    [
      "Killik Men's Merino Long Sleeve Base Layer Shirt",
      "Sale price: $59.77 (was $79.99)",
      "https://www.sportsmans.com/clothing-outdoor-casual-men-women-youth/base-layers/base-layer-tops/killik-mens-merino-long-sleeve-base-layer-shirt/p/p313652",
    ].join("\n"),
    { env: {} },
  );
  const row = result.candidates[0];
  assertShape(row);
  assert.equal(row.aisle, "apparel");
  assert.equal(row.price, 59.77);
  assert.equal(row.merchant_domain, "sportsmans.com");
  assert.equal(row.needs_affiliate, true);
  assert.equal(row.source_url.includes("tag="), false);
  assert.equal(row.source_url.includes("utm_"), false);
});

test("classifies a plate carrier note as nylon", async () => {
  const result = await parseEmail(
    [
      "FirstSpear x Black Crest Enforcer Plate Carrier",
      "Sale price: $130.00 (was $279.00)",
      "https://www.tacticaldistributors.com/products/black-crest-enforcer-w-cummerbund",
    ].join("\n"),
    { env: {} },
  );
  const row = result.candidates[0];
  assertShape(row);
  assert.equal(row.aisle, "nylon");
  assert.equal(row.price, 130);
  assert.equal(row.merchant_domain, "tacticaldistributors.com");
  assert.equal(row.needs_affiliate, true);
  assert.equal(row.source_url.includes("tag="), false);
  assert.equal(row.source_url.includes("utm_"), false);
});

test("strips a foreign affiliate tag from an ammo sale email", async () => {
  const result = await parseEmailFile(fixture("midway-9mm-sale.eml"), { env: {} });
  const row = result.candidates[0];
  assertShape(row);
  assert.equal(row.source_url, "https://www.midwayusa.com/product/federal-american-eagle-9mm-250");
  assert.equal(row.source_url.includes("tag="), false);
  assert.equal(JSON.stringify(row).includes("someone-elses-20"), false);
  assert.equal(row.merchant_domain, "midwayusa.com");
  assert.equal(row.price, 64.99);
  assert.equal(row.aisle, "ammo");
  assert.equal(row.needs_affiliate, true);
  assert.equal(row.received_at, "2026-09-19T13:30:00.000Z");
  assert.match(row.notes, /foreign affiliate/i);
});

test("does not call Ollama unless USE_OLLAMA=1", async () => {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(fixture("primary-arms-hs403b.eml"), "utf8"));
  let called = false;
  const result = await parseEmail(raw, {
    env: {},
    fetchImpl: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  assert.equal(called, false);
  assert.equal(result.extractor, "heuristic");
  assert.equal(result.candidates[0].merchant_domain, "primaryarms.com");
});

const MODEL_ENV = {
  USE_OLLAMA: "1",
  OLLAMA_HOST: "http://127.0.0.1:9",
  OLLAMA_MODEL: "test-model",
  OLLAMA_DIGEST: "sha256:abc",
};

function modelFetch(chatBody) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/api/tags")) {
      return { ok: true, async json() { return { models: [{ name: "test-model", digest: "sha256:abc" }] }; } };
    }
    return { ok: true, async json() { return { message: { content: JSON.stringify(chatBody) } }; } };
  };
  return { calls, fetchImpl };
}

test("Ollama output fails closed when the URL or affiliate tag is invented", async () => {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(fixture("primary-arms-hs403b.eml"), "utf8"));
  const inventedFetch = modelFetch({
    candidates: [
      {
        source_url: "https://evil.example/invented-deal?tag=invented-20",
        title: "Invented rifle",
        price: 1,
        aisle: "guns",
      },
    ],
  });
  const invented = await parseEmail(raw, { env: MODEL_ENV, fetchImpl: inventedFetch.fetchImpl });
  const chat = inventedFetch.calls.find((call) => call.url.endsWith("/api/chat"));
  assert.equal(chat.url, "http://127.0.0.1:9/api/chat");
  assert.equal(chat.body.model, "test-model");
  assert.equal(chat.body.think, false);
  assert.equal(chat.body.options.temperature, 0);
  assert.equal(Object.hasOwn(chat.body, "tools"), false);
  assert.equal(invented.extractor, "heuristic");
  assert.equal(JSON.stringify(invented).includes("evil.example"), false);
  assert.equal(JSON.stringify(invented).includes("invented-20"), false);
  assert.equal(invented.candidates[0].needs_affiliate, true);
  assert.equal(invented.candidates[0].aisle, "optics");

  const taggedFetch = modelFetch({
    candidates: [
      {
        source_url: "https://www.primaryarms.com/holosun-hs403b-micro-red-dot",
        title: "Holosun HS403B micro red dot",
        price: 149.99,
        aisle: "optics",
        confidence: 1,
      },
    ],
  });
  const tagged = await parseEmail(raw, { env: MODEL_ENV, fetchImpl: taggedFetch.fetchImpl });
  assert.equal(tagged.extractor, "ollama");
  assert.equal(tagged.ollama.host, "http://127.0.0.1:9");
  assert.equal(tagged.ollama.model, "test-model");
  const row = tagged.candidates[0];
  assert.equal(row.source_url, "https://www.primaryarms.com/holosun-hs403b-micro-red-dot");
  assert.equal(row.needs_affiliate, true);
  assert.equal(row.aisle, "optics");
  assert.equal(row.price, 149.99);
  assert.equal(row.confidence <= 0.9, true);
  assert.equal(JSON.stringify(tagged).includes("evil.example"), false);
});

test("Ollama connection failure keeps the heuristic candidate", async () => {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(fixture("emergency-food-kit.txt"), "utf8"));
  const result = await parseEmail(raw, {
    env: MODEL_ENV,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/api/tags")) {
        return { ok: true, async json() { return { models: [{ name: "test-model", digest: "sha256:abc" }] }; } };
      }
      throw new Error("connect ECONNREFUSED 127.0.0.1:9");
    },
  });
  assert.equal(result.extractor, "heuristic");
  assert.equal(result.ollama.attempted, true);
  assert.match(result.ollama.error, /ECONNREFUSED/);
  assert.equal(result.candidates[0].aisle, "food-storage");
  assert.equal(result.candidates[0].needs_affiliate, true);
  assert.match(result.candidates[0].notes, /Ollama was unavailable/);
});
