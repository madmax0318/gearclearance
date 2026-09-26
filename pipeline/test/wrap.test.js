import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMerchantMap, wrap } from "../src/index.js";

const jsonMap = loadMerchantMap(new URL("../data/merchant-map.example.json", import.meta.url));
const csvMap = loadMerchantMap(new URL("../data/merchant-map.example.csv", import.meta.url));

function params(url) {
  return new URL(url).searchParams;
}

test("JSON and CSV merchant maps load the same rows", () => {
  assert.deepEqual(
    jsonMap.map(({ merchant_domain, network, status, publisher_id_env, link_template }) => ({
      merchant_domain,
      network,
      status,
      publisher_id_env,
      link_template,
    })),
    csvMap.map(({ merchant_domain, network, status, publisher_id_env, link_template }) => ({
      merchant_domain,
      network,
      status,
      publisher_id_env,
      link_template,
    })),
  );
});

test("unknown merchants fail closed with a clean source URL", () => {
  const dirty = "https://www.palmettostatearmory.com/product/glock-19?utm_source=email&tag=foreign-20&sku=GLK19";
  const result = wrap(dirty, jsonMap, {});
  assert.equal(result.needs_affiliate, true);
  assert.equal(result.network, "none");
  assert.equal(result.reason, "no_map_entry");
  assert.equal(result.source_url, "https://www.palmettostatearmory.com/product/glock-19?sku=GLK19");
  assert.equal(result.affiliate_url, result.source_url);
  assert.equal(result.affiliate_url.includes("tag="), false);
  assert.equal(result.affiliate_url.includes("utm_"), false);
  assert.equal(result.affiliate_url.includes("foreign-20"), false);
  assert.equal(params(result.affiliate_url).get("sku"), "GLK19");
});

test("a live map row without a publisher id in the environment fails closed", () => {
  const source = "https://www.primaryarms.com/holosun-hs403b-micro-red-dot?utm_campaign=clearance";
  for (const env of [{}, { AVANTLINK_AID: "" }, { AVANTLINK_AID: "   " }]) {
    const result = wrap(source, jsonMap, env);
    assert.equal(result.needs_affiliate, true);
    assert.equal(result.network, "avantlink");
    assert.equal(result.reason, "missing_publisher_env");
    assert.equal(result.affiliate_url, "https://www.primaryarms.com/holosun-hs403b-micro-red-dot");
    assert.equal(result.affiliate_url.includes("network.example.test"), false);
    assert.equal(result.affiliate_url.includes("website_id"), false);
  }
});

test("a live map row wraps only with the publisher id from the environment", () => {
  const source = "https://www.primaryarms.com/holosun-hs403b-micro-red-dot?utm_source=newsletter";
  const result = wrap(source, csvMap, { AVANTLINK_AID: "aid-test-only" });
  assert.equal(result.needs_affiliate, false);
  assert.equal(result.network, "avantlink");
  assert.equal(result.reason, "wrapped");
  assert.equal(result.source_url, "https://www.primaryarms.com/holosun-hs403b-micro-red-dot");
  assert.equal(
    result.affiliate_url,
    "https://network.example.test/avantlink?website_id=aid-test-only&url=https%3A%2F%2Fwww.primaryarms.com%2Fholosun-hs403b-micro-red-dot",
  );
  assert.equal(result.source_url.includes("aid-test-only"), false);
});

test("pending and blocked rows never wrap, even when the env id is present", () => {
  const pending = wrap("https://www.rei.com/product/water-filter", jsonMap, { IMPACT_PUBLISHER_ID: "impact-test" });
  assert.equal(pending.needs_affiliate, true);
  assert.equal(pending.network, "impact");
  assert.equal(pending.reason, "status_pending_approval");
  assert.equal(pending.affiliate_url, pending.source_url);
  assert.equal(pending.affiliate_url.includes("impact-test"), false);

  const blocked = wrap("https://www.amazon.com/dp/B00TEST123", jsonMap, { AMAZON_ASSOCIATES_TAG: "stash-test-20" });
  assert.equal(blocked.needs_affiliate, true);
  assert.equal(blocked.network, "amazon");
  assert.equal(blocked.reason, "status_blocked_tos");
  assert.equal(blocked.affiliate_url.includes("stash-test-20"), false);
});

test("templates that cannot carry the product URL fail closed", () => {
  const map = [
    {
      merchant_domain: "primaryarms.com",
      network: "direct",
      status: "live",
      publisher_id_env: "AVANTLINK_AID",
      link_template: "https://network.example.test/static",
    },
    {
      merchant_domain: "midwayusa.com",
      network: "avantlink",
      status: "live",
    },
  ];
  const staticTemplate = wrap("https://www.primaryarms.com/holosun-hs403b-micro-red-dot", map, { AVANTLINK_AID: "aid-test-only" });
  assert.equal(staticTemplate.needs_affiliate, true);
  assert.equal(staticTemplate.reason, "template_missing_destination");
  assert.equal(staticTemplate.affiliate_url, "https://www.primaryarms.com/holosun-hs403b-micro-red-dot");

  const noTemplate = wrap("https://www.midwayusa.com/product/100157068", map, { AVANTLINK_AID: "aid-test-only" });
  assert.equal(noTemplate.needs_affiliate, true);
  assert.equal(noTemplate.reason, "missing_template");
  assert.equal(noTemplate.affiliate_url, noTemplate.source_url);
});
