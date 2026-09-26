import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ACTORS } from "../../src/expired-reports.mjs";
import { checkDealUrl, canonicalize, loadAllowlist, loadExceptions } from "../../src/link-policy.mjs";
import { matchBannedBrand } from "../../src/banned-brands.mjs";
import { checkTitle } from "../../src/text-policy.mjs";
import { checkBotDiff, EVIDENCE_CODES } from "../../scripts/check-bot-diff.mjs";
import { isLoopbackOllamaHost } from "../src/config.js";
import { ollamaExtract, sanitizeModelInput } from "../src/ollama.js";
import { validateSchema } from "../src/validate.js";
import { visibleDocument } from "../src/html-text.js";
import { fetchHardened, ipBlocked } from "../src/fetch-hardened.js";
import { decodeHref } from "../src/decode-links.js";
import { reviewSpawn } from "../src/spawn.js";
import { gateMessage, assertGmailToken, assertDriveToken } from "../src/sources/gmail.js";
import { candidatesFromAimHtml } from "../src/sources/aimsurplus.js";
import { collectPreppingDeals } from "../src/sources/preppingdeals.js";
import { judgePage, safetyRefusal } from "../src/expiry/evidence.js";
import { redact } from "../src/log.js";
import { checkInstallScripts } from "../src/check-install-scripts.js";
import { lintRepoAllowlists } from "../src/allowlist-lint.js";
import { fence, publicPlan, containsRawFields, pullBody, BRANCH_RE } from "../src/pr-template.js";
import { buildAppJwt, mintInstallationToken } from "../src/app-token.js";
import { withinHeadroom, MAX_LIVE_DEALS, assertDailyCeiling } from "../src/limits.js";
import { openState, recordPull } from "../src/state-db.js";
import { execute } from "../src/jobs/run.js";
import { runWatch } from "../src/jobs/watch.js";
import { runWatchPromote } from "../src/jobs/watch-promote.js";
import { runAim } from "../src/jobs/aim.js";
import { runExpiry } from "../src/jobs/expiry.js";
import { runPreppingDeals } from "../src/jobs/preppingdeals.js";
import { parsePickText, readRecordedPicks } from "../src/picks.js";
import { writeAlert } from "../src/jobs/alert.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const allowlist = loadAllowlist();
const exceptions = loadExceptions();

test("AT-01 link policy rejects unsafe URLs", () => {
  const samples = [
    ["https://t.co/abc", "shortener"],
    ["https://bit.ly/abc", "shortener"],
    ["https://amzn.to/abc", "shortener"],
    ["https://goo.gl/abc", "shortener"],
    ["https://ow.ly/abc", "shortener"],
    ["https://tinyurl.com/abc", "shortener"],
    ["https://rebrand.ly/abc", "shortener"],
    ["https://lnkd.in/abc", "shortener"],
    ["https://walmrt.us/abc", "shortener"],
    ["https://rstr.co/abc", "shortener"],
    ["https://www.google.com/url?q=https://www.amazon.com/dp/B012345678", "redirector"],
    ["https://l.facebook.com/l.php", "redirector"],
    ["https://click.example.net/out", "click-host"],
    ["https://links.example.net/out", "click-host"],
    ["https://trk.example.net/out", "click-host"],
    ["https://user:pass@www.amazon.com/dp/B012345678", "userinfo"],
    ["https://www.amazon.com:8443/dp/B012345678", "port"],
    ["https://192.0.2.1/dp/B012345678", "ip"],
    ["http://www.amazon.com/dp/B012345678", "scheme"],
    ["https://shop.example.net/item", "unlisted-host"],
    ["https://www.amazon.com/dp/B012345678?tag=abc", "unlisted-param"],
    ["https://www.primaryarms.com/search?q=https://evil.example/phish", "url-param"],
    ["https://www.amazon.com/dp/B012345678#reviews", "fragment"],
    ["https://WWW.AMAZON.COM/dp/B012345678", "non-canonical"],
  ];
  for (const [url, reason] of samples) {
    const verdict = canonicalize(url, { allowlist });
    assert.equal(verdict.ok, false, url);
    assert.equal(verdict.reason, reason, url);
  }
});

test("AT-02 build passes on current data", () => {
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("AT-03 tracking params and shorteners fail closed in the builder", () => {
  const tracking = checkDealUrl("https://www.primaryarms.com/search?utm_source=email", {
    category: "optics",
    allowlist,
    exceptions,
  });
  assert.equal(tracking.ok, false);
  const short = checkDealUrl("https://amzn.to/deal", { category: "household", allowlist, exceptions });
  assert.equal(short.reason, "shortener");
});

test("AT-04 undecodable hops drop with no fallback", () => {
  assert.equal(decodeHref("https://amzn.to/abc").ok, false);
  assert.equal(decodeHref("https://walmrt.us/abc").ok, false);
  assert.equal(decodeHref("https://rstr.co/abc").ok, false);
  assert.equal(decodeHref("https://affiliates.harvestright.com/x").ok, false);
  const cj = decodeHref("https://www.dpbolvw.net/click?url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB012345678");
  assert.equal(cj.ok, true);
  assert.equal(cj.url, "https://www.amazon.com/dp/B012345678");
  assert.equal(decodeHref("https://impact.example.net/c/1?u=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB012345678").ok, false);
});

test("AT-05 Amazon category rule and dp normalization", () => {
  const normalized = canonicalize("https://www.amazon.com/gp/product/b012345678", { allowlist });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.url, "https://www.amazon.com/dp/B012345678");
  const guns = checkDealUrl("https://www.amazon.com/dp/B012345678", {
    category: "guns",
    slug: "not-excepted",
    allowlist,
    exceptions,
  });
  assert.equal(guns.reason, "amazon-category");
  const food = checkDealUrl("https://www.amazon.com/dp/B012345678", {
    category: "food-storage",
    slug: "pd-food",
    allowlist,
    exceptions,
  });
  assert.equal(food.ok, true);
  const woot = checkDealUrl("https://tools.woot.com/offers/hammerhead-2-2-amp-oscillating", {
    category: "household",
    allowlist,
    exceptions,
  });
  assert.equal(woot.ok, true);
  const grandfathered = checkDealUrl("https://www.amazon.com/dp/B06XJG6NYB", {
    category: "survival",
    slug: "pd-uniden-cmx760-bearcat-cb-radio",
    allowlist,
    exceptions,
  });
  assert.equal(grandfathered.ok, true);
  assert.equal(grandfathered.excepted, true);
});

test("AT-06 title sanitization and normalized brand matching", () => {
  assert.equal(checkTitle("A fine title").ok, true);
  assert.equal(checkTitle("see https://example.com").ok, false);
  assert.equal(checkTitle("hello @shop").ok, false);
  assert.equal(checkTitle("use `code`").ok, false);
  assert.equal(checkTitle("a < b").ok, false);
  assert.equal(checkTitle("bad ]( link").ok, false);
  assert.equal(checkTitle("a | b").ok, false);
  assert.equal(checkTitle("x".repeat(121)).reason, "title-length");
  const hit = matchBannedBrand({ title: "C\u200bAA tactical stock" });
  assert.equal(hit?.brand, "CAA (Command Arms Accessories)");
});

test("AT-07 fences untrusted text and keeps raw fields out of plan.json", () => {
  for (let i = 0; i < 20; i += 1) {
    const ticks = "`".repeat(i % 7);
    const value = `alpha ${ticks} raw_subject ${ticks}\nnotes`;
    const fenced = fence(value);
    const marker = fenced.split("\n")[0];
    assert.equal(marker.length > ticks.length, true);
    assert.equal(fenced.includes(value), true);
    const plan = publicPlan({
      job: "watch",
      dry_run: true,
      date: "2026-09-25",
      candidates: [{ slug: "watch-one", title: "Card", url: "https://www.rei.com/p", category: "survival", raw_subject: value, notes: value, body: value }],
    });
    assert.equal(containsRawFields(plan), false);
    const body = pullBody({ summary: "summary", untrusted: [value] });
    assert.equal(body.endsWith("Opened by stash-deals-bot. Bots never merge."), true);
  }
});

test("AT-08 schema rejects extra keys and candidate caps", () => {
  const extra = validateSchema("model-output.schema.json", {
    candidates: [{ title: "ok", unexpected: true }],
  });
  assert.equal(extra.ok, false);
  const capped = validateSchema("model-output.schema.json", {
    candidates: Array.from({ length: 6 }, () => ({ title: "ok" })),
  });
  assert.equal(capped.ok, false);
  const row = validateSchema("deal-row.schema.json", {
    slug: "pd-example",
    title: "Example",
    merchant: "Example",
    price_now: 1,
    price_was: 2,
    category: "household",
    why: "Because",
    url: "https://www.amazon.com/dp/B012345678",
    curated: false,
    posted: "2026-09-25",
    bonus: true,
  });
  assert.equal(row.ok, false);
});

test("AT-09 non-loopback model host exits 2", () => {
  for (const host of [
    "http://localhost:9",
    "http://localhost.example.net:9",
    "http://127.0.0.1.nip.io:9",
    "http://0.0.0.0:9",
    "https://127.0.0.1:9",
  ]) {
    assert.equal(isLoopbackOllamaHost(host), false, host);
    const result = spawnSync(process.execPath, ["src/config.js"], {
      cwd: path.join(repoRoot, "pipeline"),
      env: { ...process.env, OLLAMA_HOST: host },
      encoding: "utf8",
    });
    assert.equal(result.status, 2, host);
  }
  assert.equal(isLoopbackOllamaHost("http://127.0.0.1:9"), true);
  assert.equal(isLoopbackOllamaHost("http://[::1]:9"), true);
});

test("AT-10 digest mismatch exits 3", async () => {
  await assert.rejects(
    () =>
      ollamaExtract(
        { sourceText: "hello" },
        {
          env: { OLLAMA_HOST: "http://127.0.0.1:9", OLLAMA_MODEL: "test-model", OLLAMA_DIGEST: "sha256:expected" },
          fetchImpl: async () => ({ ok: true, async json() { return { models: [{ name: "test-model", digest: "sha256:other" }] }; } }),
        },
      ),
    (error) => error.exitCode === 3,
  );
});

test("AT-11 request body is pinned", async () => {
  let body;
  await ollamaExtract(
    { sourceText: "Sale price $10 https://www.rei.com/product/1" },
    {
      env: { OLLAMA_HOST: "http://127.0.0.1:9", OLLAMA_MODEL: "test-model", OLLAMA_DIGEST: "sha256:abc" },
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/api/tags")) {
          return { ok: true, async json() { return { models: [{ name: "test-model", digest: "sha256:abc" }] }; } };
        }
        body = JSON.parse(init.body);
        return { ok: true, async json() { return { message: { content: '{"candidates":[]}' } }; } };
      },
    },
  );
  assert.equal(body.think, false);
  assert.equal(body.options.temperature, 0);
  assert.equal(Object.hasOwn(body, "tools"), false);
  assert.equal(body.format.additionalProperties, false);
  assert.equal(body.messages[1].content.includes("<source-text>"), true);
  assert.equal(sanitizeModelInput("x".repeat(20000)).length < 17000, true);
});

test("AT-12 non-schema fallback and AIM price comes only from Offer", async () => {
  const none = candidatesFromAimHtml("<html><script type=\"application/ld+json\">{\"@type\":\"Product\",\"name\":\"Widget\"}</script><p>$9.99</p></html>", "https://www.aimsurplus.com/products/widget");
  assert.equal(none.candidates.length, 0);
  assert.equal(none.reason, "no_structured_price");
  const priced = candidatesFromAimHtml(
    "<html><script type=\"application/ld+json\">{\"@type\":\"Product\",\"offers\":{\"@type\":\"Offer\",\"price\":\"19.95\"}}</script><p>Widget</p></html>",
    "https://www.aimsurplus.com/products/widget",
  );
  assert.equal(priced.candidates[0].price, 19.95);
  assert.equal(priced.candidates[0].price_source, "json-ld");
});

test("AT-13 hidden text is dropped", () => {
  const html = `
    <html><head><title>SECRETHEAD</title><style>.x{}</style></head>
    <body>
      <script>SECRETJS</script>
      <div class="preheader">SECRETPAD</div>
      <div hidden>SECRETHIDDEN</div>
      <div aria-hidden="true">SECRETHARIA</div>
      <div style="display:none">SECRETDISPLAY</div>
      <!-- SECRETCOMMENT -->
      <a href="https://www.example.net/hidden" hidden>nope</a>
      <a href="https://www.aimsurplus.com/products/widget">Visible product</a>
      <p>Visible copy</p>
    </body></html>`;
  const visible = visibleDocument(html);
  for (const secret of ["SECRETHEAD", "SECRETJS", "SECRETPAD", "SECRETHIDDEN", "SECRETHARIA", "SECRETDISPLAY", "SECRETCOMMENT"]) {
    assert.equal(visible.text.includes(secret), false, secret);
  }
  assert.equal(visible.text.includes("Visible copy"), true);
  assert.deepEqual(visible.links, ["https://www.aimsurplus.com/products/widget"]);
});

test("AT-14 hardened fetch rejects SSRF and the wrong prepping deals hosts", async () => {
  for (const address of ["127.0.0.1", "10.1.1.1", "192.168.0.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "fd7a:115c:a1e0::1", "fe80::1"]) {
    assert.equal(ipBlocked(address) != null, true, address);
  }
  assert.equal(ipBlocked("192.0.2.10"), null);
  const allow = JSON.parse(fs.readFileSync(path.join(repoRoot, "pipeline/config/fetch-allowlist.json"), "utf8"));
  for (const url of ["https://preppingdeals.com/deals/rss.xml", "https://preppingdeals.net/deals/rss.xml"]) {
    const result = await fetchHardened(url, { job: "preppingdeals", allowlist: allow, resolve: async () => ["192.0.2.10"] });
    assert.equal(result.reason, "unlisted-host", url);
  }
  const rebound = await fetchHardened("https://www.preppingdeals.net/deals/rss.xml", {
    job: "preppingdeals",
    allowlist: allow,
    resolve: async () => ["192.0.2.10", "127.0.0.1"],
  });
  assert.equal(rebound.reason, "ssrf");
  const capped = await fetchHardened("https://www.preppingdeals.net/deals/rss.xml", {
    job: "preppingdeals",
    allowlist: allow,
    resolve: async () => ["192.0.2.10"],
    fetchImpl: async () => ({
      status: 200,
      headers: { get: (name) => (name === "content-length" ? "5000000" : "text/html") },
      text: async () => "x",
    }),
  });
  assert.equal(capped.reason, "body-cap");
});

function headersFrom(lines) {
  return lines.map((line) => {
    const idx = line.indexOf(":");
    return { name: line.slice(0, idx), value: line.slice(idx + 1).trim() };
  });
}

test("AT-15 first authentication-results gate", () => {
  const allow = new Set(["example.com"]);
  const from = "From: Deals <deals@mail.example.com>";
  const pass = "Authentication-Results: mx.google.com; dmarc=pass; dkim=pass header.d=example.com";
  assert.equal(gateMessage({ headers: headersFrom([pass, from]), allowlist: allow }).ok, true);
  const forgedLower = headersFrom([
    "Authentication-Results: mx.google.com; dmarc=fail",
    "Authentication-Results: mx.google.com; dmarc=pass",
    from,
  ]);
  assert.equal(gateMessage({ headers: forgedLower, allowlist: allow }).ok, false);
  assert.equal(
    gateMessage({
      headers: headersFrom(["Authentication-Results: mx.example.net; dmarc=pass", from]),
      allowlist: allow,
    }).ok,
    false,
  );
  const arcBase = [
    "Authentication-Results: mx.google.com; arc=pass; dmarc=fail",
    "ARC-Seal: i=1; cv=pass; d=example.net",
    "ARC-Authentication-Results: i=1; mx.google.com; dmarc=pass header.from=example.com",
    from,
  ];
  assert.equal(gateMessage({ headers: headersFrom(arcBase), allowlist: allow }).reason, "arc-seal");
  assert.equal(
    gateMessage({
      headers: headersFrom([
        "Authentication-Results: mx.google.com; arc=pass",
        "ARC-Seal: i=2; cv=pass; d=google.com",
        from,
      ]),
      allowlist: allow,
    }).reason,
    "arc-instance",
  );
  assert.equal(
    gateMessage({
      headers: headersFrom([
        "Authentication-Results: mx.google.com; arc=pass",
        "ARC-Seal: i=1; cv=fail; d=google.com",
        "ARC-Authentication-Results: i=1; mx.google.com; dmarc=pass header.from=example.com",
        from,
      ]),
      allowlist: allow,
    }).reason,
    "arc-cv",
  );
  assert.equal(
    gateMessage({
      headers: headersFrom([
        "Authentication-Results: mx.google.com; arc=pass",
        "ARC-Seal: i=1; cv=pass; d=google.com",
        "ARC-Seal: i=1; cv=pass; d=google.com",
        from,
      ]),
      allowlist: allow,
    }).reason,
    "duplicate-arc",
  );
  for (const arc of ["none", "fail"]) {
    assert.equal(
      gateMessage({
        headers: headersFrom([
          `Authentication-Results: mx.google.com; arc=${arc}; dmarc=fail`,
          "ARC-Seal: i=1; cv=pass; d=google.com",
          "ARC-Authentication-Results: i=1; mx.google.com; dmarc=pass header.from=example.com",
          from,
        ]),
        allowlist: allow,
      }).ok,
      false,
      arc,
    );
  }
  assert.equal(
    gateMessage({
      headers: headersFrom([pass, "From: Other <other@example.net>"]),
      allowlist: allow,
    }).reason,
    "sender",
  );
});

test("AT-16 watch collect does not import the publisher", () => {
  function walk(file, seen = new Set()) {
    if (seen.has(file) || !fs.existsSync(file)) return seen;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/from "(\.[^"]+)"/g)) {
      let next = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(next) && fs.existsSync(`${next}.js`)) next = `${next}.js`;
      walk(next, seen);
    }
    return seen;
  }
  const files = [...walk(path.join(repoRoot, "pipeline/src/jobs/watch.js"))];
  const names = files.map((file) => path.basename(file));
  assert.equal(names.includes("publish-pr.js"), false);
  assert.equal(names.includes("app-token.js"), false);
});

test("AT-17 job code does not call applyReady", () => {
  const roots = [path.join(repoRoot, "pipeline/src/jobs"), path.join(repoRoot, "pipeline/src/expiry")];
  for (const root of roots) {
    for (const name of fs.readdirSync(root)) {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      assert.equal(/applyReady|apply-ready/.test(text), false, name);
    }
  }
});

test("AT-18 and AT-19 expiry evidence and safety refusals", () => {
  assert.equal(judgePage({ status: 404, productUrl: "https://www.rei.com/p/1" }).code, "http-404");
  assert.equal(judgePage({ status: 410, productUrl: "https://www.rei.com/p/1" }).code, "http-410");
  assert.equal(judgePage({ status: 302, location: "https://example.net/other", productUrl: "https://www.rei.com/p/1" }).code, "redirect-off-host");
  assert.equal(judgePage({ status: 302, location: "https://www.rei.com/search", productUrl: "https://www.rei.com/p/1" }).code, "redirect-off-product");
  assert.equal(judgePage({ status: 200, productUrl: "https://www.rei.com/p/1", structured: { availability: "https://schema.org/OutOfStock" } }).code, "out-of-stock");
  assert.equal(judgePage({ status: 200, productUrl: "https://www.rei.com/p/1", structured: { availability: "https://schema.org/Discontinued" } }).code, "discontinued");
  assert.equal(judgePage({ status: 200, productUrl: "https://www.rei.com/p/1", structured: { price: 20 }, priceWas: 20 }).code, "price-at-or-above-was");
  for (const status of [403, 500, 503]) {
    assert.equal(judgePage({ status, productUrl: "https://www.rei.com/p/1" }).reason, "inconclusive");
  }
  assert.equal(judgePage({ status: 200, captcha: true, productUrl: "https://www.rei.com/p/1" }).reason, "inconclusive");
  assert.equal(judgePage({ timedOut: true, productUrl: "https://www.rei.com/p/1" }).reason, "inconclusive");
  const deals = [
    { slug: "only-guns", category: "guns", tags: ["used"] },
    { slug: "other", category: "ammo", tags: ["police-trade-in"] },
  ];
  assert.equal(safetyRefusal(deals[0], deals), "empty-category");
  const tagged = [
    { slug: "a", category: "optics", tags: ["used"] },
    { slug: "b", category: "optics", tags: [] },
  ];
  assert.equal(safetyRefusal(tagged[0], tagged), "last-tag-sample");
});

test("AT-20 publisher branch and spawn allowlist", () => {
  assert.equal(BRANCH_RE.test("bot/watch/20260925-1"), true);
  assert.equal(BRANCH_RE.test("bot/watch/latest"), false);
  const git = [
    "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always",
    "-c", "credential.helper=",
    "-c", "http.followRedirects=false",
    "-c", "core.hooksPath=/dev/null",
    "--git-dir=/tmp/data.git",
    "fetch",
    "https://github.com/madmax0318/gearclearance.git",
  ];
  assert.equal(reviewSpawn("/usr/bin/git", git).ok, true);
  assert.equal(reviewSpawn("/usr/bin/npm", ["install"]).ok, false);
  assert.equal(reviewSpawn(process.execPath, ["/tmp/scratch/scripts/build.mjs"], { scratch: "/tmp/scratch" }).ok, true);
  assert.equal(reviewSpawn(process.execPath, ["/tmp/other/scripts/build.mjs"], { scratch: "/tmp/scratch" }).ok, false);
  assert.equal(reviewSpawn("/usr/bin/rclone", ["copyto", "--config", "c", "l", "r:n"], { env: {} }).ok, false);
});

function botPaths(env) {
  const yaml = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const script = yaml.split("# bot-paths-begin")[1].split("# bot-paths-end")[0];
  return spawnSync("bash", ["-c", script], { env: { ...process.env, ...env }, encoding: "utf8" });
}

test("AT-21 bot path cases", () => {
  const forbidden = ["scripts/build.mjs", "src/nav.js", "functions/api/report-expired.js", "pipeline/src/jobs/run.js", "ops/runner/install.sh", ".github/workflows/ci.yml", "public/_headers", "data/banned-brands.json", "data/merchant-allowlist.json", "data/policy-exceptions.json", "pipeline/config/fetch-allowlist.json", "data/expired-reports.json"];
  for (const file of forbidden) {
    const result = botPaths({
      PR_LOGIN: "stash-deals-bot",
      BOT_LOGIN: "stash-deals-bot",
      PR_TYPE: "Bot",
      HEAD_REF: "bot/watch/20260925-1",
      FILES_OVERRIDE: file,
    });
    assert.equal(result.status, 1, file);
  }
  const user = botPaths({
    PR_LOGIN: "stash-deals-bot",
    BOT_LOGIN: "stash-deals-bot",
    PR_TYPE: "User",
    HEAD_REF: "feature/cards",
    FILES_OVERRIDE: "scripts/build.mjs",
  });
  assert.equal(user.status, 0);
  const impostor = botPaths({
    PR_LOGIN: "someone",
    BOT_LOGIN: "stash-deals-bot",
    PR_TYPE: "User",
    HEAD_REF: "bot/aim/20260925-1",
    FILES_OVERRIDE: "data/deals.json",
  });
  assert.equal(impostor.status, 1);
  const extraOff = botPaths({
    PR_LOGIN: "someone",
    BOT_LOGIN: "stash-deals-bot",
    PR_TYPE: "User",
    HEAD_REF: "batch/cards",
    EXTRA_PREFIXES: "",
    FILES_OVERRIDE: "scripts/build.mjs",
  });
  assert.equal(extraOff.status, 0);
  const extraOn = botPaths({
    PR_LOGIN: "someone",
    BOT_LOGIN: "stash-deals-bot",
    PR_TYPE: "User",
    HEAD_REF: "batch/cards",
    EXTRA_PREFIXES: "batch/,other/",
    FILES_OVERRIDE: "scripts/build.mjs",
  });
  assert.equal(extraOn.status, 1);
  const image = botPaths({
    PR_LOGIN: "stash-deals-bot",
    BOT_LOGIN: "stash-deals-bot",
    PR_TYPE: "Bot",
    HEAD_REF: "bot/aim/20260925-1",
    FILES_OVERRIDE: "public/images/deals/aim-widget.jpg",
  });
  assert.equal(image.status, 0);
});

test("AT-22 check-bot-diff cases and base checkout", () => {
  const yaml = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  assert.equal(yaml.includes("ref: ${{ github.event.pull_request.base.sha }}"), true);
  assert.equal(yaml.includes("scripts/check-bot-diff.mjs"), true);
  const today = "2026-09-25";
  const base = [{ slug: "keep-me", title: "Keep", posted: "2026-09-01", curated: false, url: "https://www.rei.com/p" }];
  function withDirs(headLive, headArchive, policyEdit) {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "base-"));
    const headDir = fs.mkdtempSync(path.join(os.tmpdir(), "head-"));
    fs.mkdirSync(path.join(baseDir, "data/expired"), { recursive: true });
    fs.mkdirSync(path.join(headDir, "data/expired"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "pipeline/config"), { recursive: true });
    fs.mkdirSync(path.join(headDir, "pipeline/config"), { recursive: true });
    fs.writeFileSync(path.join(baseDir, "data/deals.json"), JSON.stringify(base));
    fs.writeFileSync(path.join(headDir, "data/deals.json"), JSON.stringify(headLive));
    fs.writeFileSync(path.join(baseDir, "data/expired/deals.json"), "[]");
    fs.writeFileSync(path.join(headDir, "data/expired/deals.json"), JSON.stringify(headArchive));
    fs.writeFileSync(path.join(baseDir, "data/banned-brands.json"), "{}");
    fs.writeFileSync(path.join(headDir, "data/banned-brands.json"), policyEdit ? "{\"edited\":true}" : "{}");
    fs.writeFileSync(path.join(baseDir, "data/merchant-allowlist.json"), "{}");
    fs.writeFileSync(path.join(headDir, "data/merchant-allowlist.json"), "{}");
    fs.writeFileSync(path.join(baseDir, "data/policy-exceptions.json"), "{}");
    fs.writeFileSync(path.join(headDir, "data/policy-exceptions.json"), "{}");
    fs.writeFileSync(path.join(baseDir, "pipeline/config/fetch-allowlist.json"), "{}");
    fs.writeFileSync(path.join(headDir, "pipeline/config/fetch-allowlist.json"), "{}");
    return checkBotDiff({ baseDir, headDir, bot: true, today });
  }
  const modified = withDirs([{ ...base[0], title: "Changed" }], [], false);
  assert.equal(modified.errors.includes("modified:keep-me"), true);
  const prefix = withDirs([...base, { slug: "nope", posted: today, curated: false }], [], false);
  assert.equal(prefix.errors.some((error) => error.startsWith("slug-prefix:")), true);
  const curated = withDirs([...base, { slug: "pd-one", posted: today, curated: true }], [], false);
  assert.equal(curated.errors.includes("curated:pd-one"), true);
  const missing = withDirs([], [], false);
  assert.equal(missing.errors.includes("removal-archive:keep-me"), true);
  const wrongBy = withDirs([], [{ slug: "keep-me", expired_by: "admin", expired_reason: "http-404" }], false);
  assert.equal(wrongBy.errors.includes("expired-by:keep-me"), true);
  const policy = withDirs(base, [], true);
  assert.equal(policy.errors.some((error) => error.startsWith("policy-edit:")), true);
  const clean = withDirs(
    [...base, { slug: "pd-new", posted: today, curated: false }],
    [{ slug: "keep-me", expired_by: "bot", expired_reason: "http-404" }],
    false,
  );
  assert.equal(clean.errors.includes("removal-archive:keep-me"), false);
  assert.equal(clean.errors.some((error) => error.startsWith("slug-prefix:")), false);
  const human = checkBotDiff({
    baseDir: repoRoot,
    headDir: repoRoot,
    bot: false,
    today,
  });
  assert.equal(human.ok, true);
});

test("AT-23 headroom defers overflow without editing the cap", () => {
  assert.equal(MAX_LIVE_DEALS, 160);
  const cards = Array.from({ length: 3 }, (_, index) => ({ slug: `pd-${index}` }));
  const full = withinHeadroom(160, cards);
  assert.equal(full.publish.length, 0);
  assert.equal(full.deferred.length, 3);
  const room = withinHeadroom(158, cards);
  assert.equal(room.publish.length, 2);
  assert.deepEqual(room.deferred, ["pd-2"]);
});

test("AT-24 daily ceiling exits 3", () => {
  const db = openState(":memory:");
  for (let i = 0; i < 8; i += 1) recordPull(db, { day: "2026-09-25", job: "watch", branch: `bot/watch/20260925-${i + 1}` });
  assert.throws(() => assertDailyCeiling(db, "2026-09-25"), (error) => error.exitCode === 3);
  db.close();
});

test("AT-25 dry-run writes a plan and does not call publish endpoints", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  const planPath = path.join(dir, "plan.json");
  let calls = 0;
  await execute(["watch", "--dry-run"], {
    planPath,
    date: "2026-09-25",
    messages: [],
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network");
    },
  });
  assert.equal(calls, 0);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.equal(plan.dry_run, true);
  assert.equal(containsRawFields(plan), false);
});

test("AT-26 missing credentials exit 2 and alert", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alert-"));
  let alerted = null;
  await assert.rejects(
    () =>
      execute(["aim", "--live"], {
        env: {},
        date: "2026-09-25",
        pages: [],
        stateDir: dir,
        journal: { write() {} },
        alert: (status, options) => {
          alerted = status;
          writeAlert(status, options);
        },
      }),
    (error) => error.exitCode === 2,
  );
  assert.equal(alerted.code, 2);
  assert.equal(fs.existsSync(path.join(dir, "status.json")), true);
});

test("AT-27 workflow is pull_request only and pins actions", () => {
  const yaml = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  assert.equal(yaml.includes("pull_request_target"), false);
  assert.match(yaml, /on:\n {2}pull_request:\n/);
  assert.match(yaml, /permissions:\n {2}contents: read/);
  const uses = [...yaml.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
  assert.equal(uses.length > 0, true);
  for (const use of uses) assert.match(use, /@[0-9a-f]{40}$/);
  assert.equal(yaml.includes("${{ github.event"), true);
  let runIndent = -1;
  for (const line of yaml.split("\n")) {
    const marker = line.match(/^(\s*)run:\s*\|/);
    if (marker) {
      runIndent = marker[1].length;
      continue;
    }
    if (runIndent < 0) continue;
    if (line.trim() === "") continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= runIndent) {
      runIndent = -1;
      continue;
    }
    if (line.includes("${{ github.event")) assert.fail(line);
  }
});

test("AT-28 redaction and gitleaks config", () => {
  const github = redact(`token ${"ghp_"}${"A".repeat(36)} end`);
  assert.equal(github.includes("ghp_"), false);
  const google = redact(`token ${"ya29."}${"abc".repeat(8)}`);
  assert.equal(google.includes("ya29."), false);
  const pem = redact(`${["-----BEGIN ", "PRIVATE KEY-----"].join("")}\nabc\n${["-----END ", "PRIVATE KEY-----"].join("")}`);
  assert.equal(pem.includes("PRIVATE KEY"), false);
  const config = fs.readFileSync(path.join(repoRoot, ".gitleaks.toml"), "utf8");
  assert.match(config, /useDefault = true/);
});

test("AT-29 unit templates, blackout, and placeholders", () => {
  const overlap = path.join(os.tmpdir(), `stash-overlap-${process.pid}.env`);
  fs.writeFileSync(
    overlap,
    [
      "BLACKOUT_WINDOWS=daily 00:00-06:00",
      "ONCALENDAR_WATCH=daily 03:00",
      "ONCALENDAR_WATCH_PROMOTE=daily 12:00",
      "ONCALENDAR_PREPPINGDEALS=daily 12:00",
      "ONCALENDAR_AIM=daily 12:00",
      "ONCALENDAR_EXPIRY=daily 12:00",
      "DRIVE_UPLOADER=node",
      "CRED_GH=cred-gh",
      "CRED_GMAIL=cred-gmail",
      "CRED_DRIVE=cred-drive",
    ].join("\n"),
  );
  const blocked = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: overlap },
    encoding: "utf8",
  });
  assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
  assert.match(blocked.stderr, /blackout overlap/);
  const render = fs.mkdtempSync(path.join(os.tmpdir(), "units-"));
  const okFile = path.join(os.tmpdir(), `stash-ok-${process.pid}.env`);
  fs.writeFileSync(
    okFile,
    [
      "BLACKOUT_WINDOWS=daily 00:00-06:00",
      "ONCALENDAR_WATCH=daily 12:00",
      "ONCALENDAR_WATCH_PROMOTE=daily 12:00",
      "ONCALENDAR_PREPPINGDEALS=daily 12:00",
      "ONCALENDAR_AIM=daily 12:00",
      "ONCALENDAR_EXPIRY=daily 12:00",
      "DRIVE_UPLOADER=node",
      "CRED_GH=cred-gh",
      "CRED_GMAIL=cred-gmail",
      "CRED_DRIVE=cred-drive",
      "NODE=/usr/bin/node",
      "CHECKOUT=/tmp/checkout",
      "STASH_ENV_PATH=/tmp/stash.env",
    ].join("\n"),
  );
  const ok = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: okFile, STASH_RENDER_DIR: render },
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /NOT ENFORCED \(user units\)/);
  const rendered = fs.readFileSync(path.join(render, "stash-deals-watch.timer"), "utf8");
  assert.equal(rendered.includes("@ONCALENDAR@"), false);
  assert.match(rendered, /OnCalendar=daily 12:00/);
  const service = fs.readFileSync(path.join(render, "stash-deals-watch.service"), "utf8");
  for (const banned of ["IPAddressDeny=", "SocketBindDeny=", "PrivateTmp=", "ProtectSystem=", "ProtectHome=", "MemoryDenyWriteExecute="]) {
    assert.equal(service.includes(banned), false, banned);
  }
  const committed = [
    path.join(repoRoot, "ops/runner/stash.env.example"),
    path.join(repoRoot, "pipeline/.env.example"),
  ];
  for (const file of committed) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.includes("11434"), false, file);
    assert.equal(/qwen|proton/i.test(text), false, file);
  }
});

test("AT-33 tokeninfo gate", async () => {
  const good = async () => ({ ok: true, async json() { return { scope: "https://www.googleapis.com/auth/gmail.readonly", email: "inbox@example.com" }; } });
  await assertGmailToken({ fetchImpl: good, token: "token", inbox: "inbox@example.com" });
  await assert.rejects(
    () => assertGmailToken({
      fetchImpl: async () => ({ ok: true, async json() { return { scope: "https://www.googleapis.com/auth/gmail.modify", email: "inbox@example.com" }; } }),
      token: "token",
      inbox: "inbox@example.com",
    }),
    (error) => error.exitCode === 2,
  );
  await assert.rejects(
    () => assertDriveToken({
      fetchImpl: async () => ({ ok: true, async json() { return { scope: "https://www.googleapis.com/auth/drive.file", email: "other@example.com" }; } }),
      token: "token",
      account: "drive@example.com",
    }),
    (error) => error.exitCode === 2,
  );
});

test("AT-35 dry-run jobs do not listen or spawn", async () => {
  const jobsDir = path.join(repoRoot, "pipeline/src/jobs");
  for (const name of fs.readdirSync(jobsDir)) {
    const text = fs.readFileSync(path.join(jobsDir, name), "utf8");
    assert.equal(text.includes("node:net"), false, name);
    assert.equal(text.includes("node:child_process"), false, name);
    assert.equal(text.includes(".listen("), false, name);
    assert.equal(text.includes("execFile"), false, name);
  }
  await runWatch({ messages: [] });
  await runPreppingDeals({ rss: "<rss></rss>" });
  await runAim({ pages: [] });
  await runExpiry({ deals: [], pages: [] });
  await runWatchPromote({
    records: [],
    drive: { async get() { throw new Error("get"); }, async export() { throw new Error("export"); } },
    reviewIds: new Set(),
    dryRun: true,
    date: "2026-09-25",
    liveCount: 0,
    cards: [],
  });
});

test("AT-36 allowlists have no wildcards and CDN prefixes", () => {
  assert.deepEqual(lintRepoAllowlists(), []);
});

test("AT-37 actors include bot and the legacy actor string is gone", () => {
  assert.equal(ACTORS.has("bot"), true);
  assert.equal(ACTORS.has("admin"), true);
  assert.equal(ACTORS.has("reports"), true);
  const roots = ["src", "scripts", "pipeline", "data"].map((name) => path.join(repoRoot, name));
  const skip = new Set(["node_modules", "package-lock.json"]);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(mjs|js|json|md|example)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        assert.equal(text.includes(["ion", "cannon"].join("-")), false, full);
      }
    }
  }
  for (const root of roots) walk(root);
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts/expire-deal.mjs"), "remove", "still-live"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /by_required/);
  for (const code of ["http-404", "http-410", "redirect-off-host", "out-of-stock", "discontinued", "price-at-or-above-was"]) {
    assert.equal(EVIDENCE_CODES.has(code), true);
  }
});

test("AT-38 prepping deals does not fetch hop hosts and impact drops", async () => {
  const rss = [
    "<rss><channel>",
    "<item><link>https://amzn.to/abc</link></item>",
    "<item><link>https://www.dpbolvw.net/click?url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB012345678</link></item>",
    "<item><link>https://walmrt.us/abc</link></item>",
    "<item><link>https://rstr.co/abc</link></item>",
    "<item><link>https://affiliates.harvestright.com/x</link></item>",
    "<item><link>https://impact.example.net/c/1?u=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB012345678</link></item>",
    "</channel></rss>",
  ].join("");
  const calls = [];
  const result = await collectPreppingDeals({
    rss,
    impactHops: {},
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, body: "<p>page</p>" };
    },
  });
  assert.deepEqual(calls, []);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source_url, "https://www.amazon.com/dp/B012345678");
});

test("AT-39 watch promote and picks", async () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = buildAppJwt({ appId: "1", privateKey: pem, now: Date.parse("2026-09-25T00:00:00Z") });
  assert.equal(jwt.split(".").length, 3);
  let tokenBody;
  const minted = await mintInstallationToken({
    appId: "1",
    privateKey: pem,
    installationId: "9",
    fetchImpl: async (_url, init) => {
      tokenBody = JSON.parse(init.body);
      return { ok: true, async json() { return { token: "installation-token" }; } };
  },
  });
  assert.deepEqual(tokenBody.repositories, ["gearclearance"]);
  assert.deepEqual(tokenBody.permissions, { contents: "write", pull_requests: "write" });
  assert.equal(minted.token, "installation-token");

  const reviewIds = new Set(["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C11", "C12"]);
  const lines = ["[ ] ignored", "[x] nope", "[x] C99 extra", ...[...reviewIds].map((id) => `[x] ${id} card`), "[x] SUBMIT"];
  const parsed = parsePickText(lines.join("\n"), { reviewIds });
  assert.equal(parsed.accepted.length, 10);
  assert.equal(parsed.deferred.length, 2);
  assert.equal(parsed.accepted.includes("C99"), false);
  const other = parsePickText("[x] C01 card\n[x] SUBMIT\n", { reviewIds: new Set(["C02"]) });
  assert.deepEqual(other.accepted, []);
  assert.equal(parsePickText("[x] C01\n", { reviewIds }).reason, "no-submit");
  assert.equal(parsePickText(`${"x".repeat(70_000)}\n[x] SUBMIT\n`, { reviewIds }).reason, "too-large");
  assert.equal(parsePickText(`${"line\n".repeat(201)}[x] SUBMIT\n`, { reviewIds }).reason, "too-many-lines");

  const calls = [];
  const drive = {
    async get(id) {
      calls.push(["get", id]);
      if (id === "bad-parent") return { parentId: "wrong", mimeType: "text/plain" };
      if (id === "bad-mime") return { parentId: "folder", mimeType: "image/jpeg" };
      return { parentId: "folder", mimeType: "text/plain" };
    },
    async export(id) {
      calls.push(["export", id]);
      if (id === "no-submit") return "[x] C01 card\n";
      return "[x] C01 card\n[x] SUBMIT\n";
    },
    async list() {
      calls.push(["list"]);
    },
  };
  const now = new Date("2026-09-25T00:00:00Z");
  const read = await readRecordedPicks({
    records: [
      { file_id: "good", run_id: "run-1", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" },
      { file_id: "bad-parent", run_id: "run-1", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" },
      { file_id: "bad-mime", run_id: "run-1", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" },
      { file_id: "no-submit", run_id: "run-1", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" },
      { file_id: "unrecorded", run_id: "run-1", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" },
    ].filter((row) => row.file_id !== "unrecorded"),
    drive,
    reviewIds,
    now,
  });
  assert.equal(calls.some((call) => call[0] === "list"), false);
  assert.equal(calls.some((call) => call[1] === "unrecorded"), false);
  assert.equal(read.accepted.includes("C01"), true);
  assert.equal(read.skipped.some((item) => item.reason === "parent"), true);
  assert.equal(read.skipped.some((item) => item.reason === "mime"), true);
  assert.equal(read.skipped.some((item) => item.reason === "no-submit"), true);

  const promoted = await runWatchPromote({
    records: [],
    drive,
    reviewIds,
    dryRun: true,
    date: "2026-09-25",
    liveCount: 0,
    cards: [{ slug: "watch-one", title: "Card", url: "https://www.rei.com/p", category: "survival", pick_id: "C01" }],
  });
  assert.equal(promoted.branch, "bot/watch/20260925-1");
  assert.equal(JSON.stringify(promoted).includes("raw_subject"), false);
});
