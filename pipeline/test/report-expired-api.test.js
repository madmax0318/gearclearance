import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../../functions/api/report-expired.js";

const TOKEN = "test-token";
const ORIGIN = "https://thestash.deals";

function githubFile(json, status = 200) {
  const content = Buffer.from(JSON.stringify(json), "utf8").toString("base64");
  return new Response(JSON.stringify({ sha: "queue-sha", content, encoding: "base64" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyQueue() {
  return { version: 1, threshold: 3, reports: [] };
}

function post(body, { env = {}, assets, url = `${ORIGIN}/api/report-expired` } = {}) {
  const contextEnv = {
    GITHUB_TOKEN: TOKEN,
    GITHUB_REPOSITORY: "madmax0318/gearclearance",
    GITHUB_BRANCH: "main",
    REPORT_IP_SALT: "test-salt",
    ...env,
  };
  if (assets !== undefined) contextEnv.ASSETS = assets;
  return onRequest({
    request: new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify(body),
    }),
    env: contextEnv,
  });
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = init.method || (typeof input !== "string" && input.method) || "GET";
    const headers = new Headers(init.headers || (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined));
    calls.push({ url, method, authorization: headers.get("authorization") });
    return handler({ url, method });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function routeFetch({ deals, slugs, queue = emptyQueue(), putStatus = 200 }) {
  return async ({ url, method }) => {
    if (url.includes("/contents/data/deals.json")) return deals();
    if (url.includes("/report-slugs.json")) return slugs();
    if (url.includes("/contents/data/expired-reports.json") && method === "GET") return githubFile(queue);
    if (url.includes("/contents/data/expired-reports.json") && method === "PUT") {
      return new Response("{}", { status: putStatus });
    }
    return new Response("missing", { status: 404 });
  };
}

test("GitHub deals.json stays the preferred live slug source", async () => {
  await withFetch(
    routeFetch({
      deals: () =>
        githubFile([
          { slug: "still-live" },
          { slug: "gone", status: "expired" },
        ]),
      slugs: () => {
        throw new Error("report-slugs.json should not be read when deals.json parses");
      },
    }),
    async (calls) => {
      const expired = await post({ slug: "gone" });
      assert.equal(expired.status, 404);
      assert.equal((await expired.json()).error, "unknown_deal");

      const live = await post({ slug: "still-live" });
      assert.equal(live.status, 200);
      const body = await live.json();
      assert.equal(body.ok, true);
      assert.equal(body.stored, true);
      assert.equal(body.error, undefined);
      assert.equal(
        calls.some((call) => call.url.includes("/report-slugs.json")),
        false,
      );
    },
  );
});

test("an empty GitHub board does not invent slugs from the asset", async () => {
  await withFetch(
    routeFetch({
      deals: () => githubFile([]),
      slugs: () => {
        throw new Error("empty deals.json is a real board");
      },
    }),
    async () => {
      const response = await post({ slug: "still-live" });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "unknown_deal");
    },
  );
});

test("same-origin report-slugs.json is used when ASSETS.fetch is missing", async () => {
  await withFetch(
    routeFetch({
      deals: () => {
        throw new TypeError("redirect mode is error");
      },
      slugs: () => Response.json(["still-live", "Not A Slug", 12]),
    }),
    async (calls) => {
      const response = await post({ slug: "still-live" }, { assets: {} });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.stored, true);
      assert.equal(body.error, undefined);

      const assetCall = calls.find((call) => call.url.includes("/report-slugs.json"));
      assert.equal(assetCall.url, `${ORIGIN}/report-slugs.json`);
      assert.equal(assetCall.method, "GET");
      assert.equal(assetCall.authorization, null);
      const githubCall = calls.find((call) => call.url.includes("/contents/data/deals.json"));
      assert.equal(githubCall.authorization, `Bearer ${TOKEN}`);
      assert.equal(
        calls.some((call) => call.method === "PUT" && call.url.includes("/contents/data/expired-reports.json")),
        true,
      );
    },
  );
});

test("ASSETS binding supplies slugs before a same-origin fetch", async () => {
  let assetFetches = 0;
  await withFetch(
    routeFetch({
      deals: () => new Response("denied", { status: 403 }),
      slugs: () => {
        throw new Error("same-origin fetch should not run when ASSETS returns slugs");
      },
    }),
    async () => {
      const response = await post(
        { slug: "still-live" },
        {
          assets: {
            async fetch(assetRequest) {
              assetFetches += 1;
              assert.equal(new URL(assetRequest.url).pathname, "/report-slugs.json");
              assert.equal(new Headers(assetRequest.headers).get("authorization"), null);
              return Response.json(["still-live"]);
            },
          },
        },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).stored, true);
      assert.equal(assetFetches, 1);
    },
  );
});

test("a throwing ASSETS binding falls through to the published slug file", async () => {
  await withFetch(
    routeFetch({
      deals: () => new Response("no", { status: 500 }),
      slugs: () => Response.json(["still-live"]),
    }),
    async (calls) => {
      const response = await post(
        { slug: "still-live" },
        {
          assets: {
            async fetch() {
              throw new Error("assets binding down");
            },
          },
        },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).error, undefined);
      assert.equal(
        calls.some((call) => call.url === `${ORIGIN}/report-slugs.json`),
        true,
      );
    },
  );
});

test("a slug missing from report-slugs.json stays unknown", async () => {
  await withFetch(
    routeFetch({
      deals: () => new Response("missing", { status: 404 }),
      slugs: () => Response.json(["other-deal"]),
    }),
    async (calls) => {
      const response = await post({ slug: "still-live" });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "unknown_deal");
      assert.equal(
        calls.some((call) => call.method === "PUT"),
        false,
      );
    },
  );
});

test("slug asset redirects are not followed", async () => {
  await withFetch(
    routeFetch({
      deals: () => new Response("no", { status: 500 }),
      slugs: () => new Response(null, { status: 302, headers: { location: "https://evil.example/slugs.json" } }),
    }),
    async (calls) => {
      const response = await post({ slug: "still-live" });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "board_unavailable",
        github: "github_board_failed",
        asset: "slug_asset_failed",
        github_status: 500,
      });
      assert.equal(
        calls.some((call) => call.url.includes("evil.example")),
        false,
      );
    },
  );
});

test("both slug sources failing names github and the asset without secrets", async () => {
  await withFetch(
    routeFetch({
      deals: () => new Response("upstream", { status: 502 }),
      slugs: () => new Response("<html>nope</html>", { status: 200, headers: { "content-type": "text/html" } }),
    }),
    async (calls) => {
      const response = await post({ slug: "still-live" });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.deepEqual(body, {
        ok: false,
        error: "board_unavailable",
        github: "github_board_failed",
        asset: "slug_asset_failed",
        github_status: 502,
      });
      assert.equal(JSON.stringify(body).includes(TOKEN), false);
      assert.equal(
        calls.some((call) => call.url.includes("expired-reports")),
        false,
      );
    },
  );
});

test("missing token and honeypot submissions do not read the board", async () => {
  await withFetch(
    async () => {
      throw new Error("fetch should not run");
    },
    async () => {
      const unconfigured = await post({ slug: "still-live" }, { env: { GITHUB_TOKEN: "" } });
      assert.equal(unconfigured.status, 503);
      assert.deepEqual(await unconfigured.json(), { ok: false, error: "queue_unconfigured" });

      const honeypot = await post({ slug: "still-live", company: "Acme Bots" });
      assert.equal(honeypot.status, 200);
      assert.deepEqual(await honeypot.json(), { ok: true, stored: false });
    },
  );
});
