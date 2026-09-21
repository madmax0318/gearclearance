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
  assert.equal(row.source_url, "https://www.emergencyessentials.com/augason-farms-30-day-emergency-food-kit");
  assert.equal(row.source_url.includes("fbclid"), false);
  assert.equal(row.source_url.includes("utm_"), false);
  assert.equal(row.merchant_domain, "emergencyessentials.com");
  assert.equal(row.price, 119);
  assert.equal(row.aisle, "food-storage");
  assert.equal(row.title, "Augason Farms 30-Day Emergency Food Kit");
  assert.equal(row.raw_subject, null);
  assert.equal(row.raw_from, null);
  assert.equal(row.received_at, null);
  assert.equal(row.needs_affiliate, true);
  assert.match(row.notes, /Plain text had no RFC 5322 headers/);
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

test("Ollama output fails closed when the URL or affiliate tag is invented", async () => {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(fixture("primary-arms-hs403b.eml"), "utf8"));
  const calls = [];
  const invented = await parseEmail(raw, {
    env: { USE_OLLAMA: "1", OLLAMA_HOST: "http://127.0.0.1:11434", OLLAMA_MODEL: "qwen3.5:35b" },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        async json() {
          return {
            message: {
              content: JSON.stringify({
                candidates: [
                  {
                    source_url: "https://evil.example/invented-deal?tag=invented-20",
                    title: "Invented rifle",
                    price: 1,
                    aisle: "guns",
                    needs_affiliate: false,
                    affiliate_url: "https://evil.example/aff?tag=invented-20",
                  },
                ],
              }),
            },
          };
        },
      };
    },
  });
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(calls[0].body.model, "qwen3.5:35b");
  assert.equal(invented.extractor, "heuristic");
  assert.equal(JSON.stringify(invented).includes("evil.example"), false);
  assert.equal(JSON.stringify(invented).includes("invented-20"), false);
  assert.equal(invented.candidates[0].needs_affiliate, true);
  assert.equal(invented.candidates[0].aisle, "optics");

  const tagged = await parseEmail(raw, {
    env: { USE_OLLAMA: "1" },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          message: {
            content:
              '<think>do not invent a tag</think>{"candidates":[{"source_url":"https://www.primaryarms.com/holosun-hs403b-micro-red-dot?tag=invented-20","title":"Holosun HS403B micro red dot","price":149.99,"aisle":"guns","needs_affiliate":false,"affiliate_url":"https://evil.example/aff?tag=invented-20","confidence":1}]}',
          },
        };
      },
    }),
  });
  assert.equal(tagged.extractor, "ollama");
  assert.equal(tagged.ollama.host, "http://127.0.0.1:11434");
  assert.equal(tagged.ollama.model, "qwen3.5:35b");
  const row = tagged.candidates[0];
  assert.equal(row.source_url, "https://www.primaryarms.com/holosun-hs403b-micro-red-dot");
  assert.equal(row.needs_affiliate, true);
  assert.equal(row.aisle, "optics");
  assert.equal(row.price, 149.99);
  assert.equal(row.confidence <= 0.9, true);
  assert.equal(JSON.stringify(tagged).includes("invented-20"), false);
  assert.equal(JSON.stringify(tagged).includes("evil.example"), false);
  assert.match(row.notes, /Ignored affiliate_url/);
});

test("Ollama connection failure keeps the heuristic candidate", async () => {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(fixture("emergency-food-kit.txt"), "utf8"));
  const result = await parseEmail(raw, {
    env: { USE_OLLAMA: "1", OLLAMA_HOST: "http://127.0.0.1:11434" },
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    },
  });
  assert.equal(result.extractor, "heuristic");
  assert.equal(result.ollama.attempted, true);
  assert.match(result.ollama.error, /ECONNREFUSED/);
  assert.equal(result.candidates[0].aisle, "food-storage");
  assert.equal(result.candidates[0].needs_affiliate, true);
  assert.match(result.candidates[0].notes, /Ollama was unavailable/);
});
