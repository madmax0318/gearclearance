import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyDealText } from "../../scripts/build.mjs";
import { chicagoDate } from "../src/dates.js";
import { resolveCategory } from "../src/category-policy.js";
import { fetchHardened } from "../src/fetch-hardened.js";
import { runAim } from "../src/jobs/aim.js";
import { readAppPrivateKey } from "../src/jobs/run.js";
import { runPreppingDeals } from "../src/jobs/preppingdeals.js";
import { runWatch } from "../src/jobs/watch.js";
import { runWatchPromote } from "../src/jobs/watch-promote.js";
import { parsePickText, readRecordedPicks } from "../src/picks.js";
import { publishPullRequest } from "../src/publish-pr.js";
import { fromDomain, gateMessage } from "../src/sources/gmail.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function headersFrom(lines) {
  return lines.map((line) => {
    const idx = line.indexOf(":");
    return { name: line.slice(0, idx), value: line.slice(idx + 1).trim() };
  });
}

test("H-1 empty picks promote nothing", async () => {
  const empty = await runWatchPromote({
    records: [],
    cards: [{ pick_id: "C01", slug: "watch-one", title: "Card", url: "https://www.rei.com/p", category: "survival" }],
    reviewIds: new Set(["C01"]),
    dryRun: true,
    date: "2026-09-25",
    liveCount: 0,
  });
  assert.equal(empty.candidates.length, 0);
  const kept = await runWatchPromote({
    records: [{ file_id: "good", run_id: "run-1", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" }],
    drive: {
      async get() {
        return { parentId: "folder", mimeType: "text/plain" };
      },
      async export() {
        return "[x] C01 card\n[x] SUBMIT\n";
      },
    },
    reviewIds: new Set(["C01"]),
    cards: [
      { pick_id: "C01", slug: "watch-one", title: "Card", url: "https://www.rei.com/p", category: "survival" },
      { pick_id: "C02", slug: "watch-two", title: "Other", url: "https://www.rei.com/q", category: "survival" },
    ],
    dryRun: true,
    date: "2026-09-25",
    now: new Date("2026-09-25T00:00:00Z"),
    liveCount: 0,
  });
  assert.deepEqual(kept.candidates.map((card) => card.slug), ["watch-one"]);
});

test("H-2 watch auth gate fails closed without headers", async () => {
  const blocked = await runWatch({
    messages: [{ raw: "From: deals@example.com\n\nhttps://www.rei.com/product/tent\n" }],
  });
  assert.equal(blocked.candidates.length, 0);
});

test("H-3 from address and exact authentication alignment", () => {
  assert.equal(fromDomain('"deals@example.com" <other@example.net>'), "example.net");
  assert.equal(fromDomain("Deals <deals@mail.example.com>"), "mail.example.com");
  const allow = new Set(["example.com"]);
  assert.equal(
    gateMessage({
      headers: headersFrom([
        "Authentication-Results: mx.google.com; dmarc=pass header.from=example.com",
        "From: Deals <deals@mail.example.com>",
      ]),
      allowlist: allow,
    }).ok,
    false,
  );
  assert.equal(
    gateMessage({
      headers: headersFrom([
        "Authentication-Results: mx.google.com; dkim=pass header.d=example.com.evil.net",
        "From: Deals <deals@example.com>",
      ]),
      allowlist: allow,
    }).ok,
    false,
  );
  assert.equal(
    gateMessage({
      headers: headersFrom([
        "Authentication-Results: mx.google.com; arc=pass; dmarc=fail",
        "ARC-Seal: i=1; cv=pass; d=google.com",
        "ARC-Authentication-Results: i=1; mx.google.com; dmarc=pass header.from=example.com",
        "From: Deals <deals@example.com>",
      ]),
      allowlist: allow,
    }).ok,
    true,
  );
});

test("H-4 watch timers stay disabled and live mode is per job", () => {
  const script = fs.readFileSync(path.join(repoRoot, "ops/runner/install.sh"), "utf8");
  assert.equal(script.includes("systemctl --user enable stash-deals-watch.timer"), false);
  assert.equal(script.includes("systemctl --user enable stash-deals-watch-promote.timer"), false);
  assert.equal(script.includes("STASH_DRY_RUN=0/"), false);
  const render = fs.mkdtempSync(path.join(os.tmpdir(), "live-"));
  const live = path.join(os.tmpdir(), `live-${process.pid}`);
  fs.writeFileSync(live, "aim\n");
  const envFile = path.join(os.tmpdir(), `env-${process.pid}`);
  fs.writeFileSync(
    envFile,
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
    ].join("\n"),
  );
  const result = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: envFile, STASH_RENDER_DIR: render, STASH_LIVE_FILE: live },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(fs.readFileSync(path.join(render, "stash-deals-aim.service"), "utf8"), /STASH_DRY_RUN=0/);
  assert.match(fs.readFileSync(path.join(render, "stash-deals-watch.service"), "utf8"), /STASH_DRY_RUN=1/);
  assert.match(fs.readFileSync(path.join(render, "stash-deals-expiry.service"), "utf8"), /STASH_DRY_RUN=1/);
});

test("M-1 each unit loads only its credentials and the app key is a file", () => {
  const watch = fs.readFileSync(path.join(repoRoot, "ops/runner/systemd/stash-deals-watch.service.in"), "utf8");
  assert.match(watch, /LoadCredential=cred-gmail:/);
  assert.equal(watch.includes("cred-gh"), false);
  const aim = fs.readFileSync(path.join(repoRoot, "ops/runner/systemd/stash-deals-aim.service.in"), "utf8");
  assert.match(aim, /LoadCredential=cred-gh:/);
  assert.equal(aim.includes("cred-gmail"), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-"));
  fs.writeFileSync(path.join(dir, "cred-gh"), "key-material");
  assert.equal(readAppPrivateKey({ CREDENTIALS_DIRECTORY: dir, GH_PRIVATE_KEY: "from-env" }), "key-material");
  assert.equal(readAppPrivateKey({ GH_PRIVATE_KEY: "from-env" }), "");
});

test("M-2 units notify on failure and timer services are not installed", () => {
  for (const name of ["stash-deals-watch.service.in", "stash-deals-aim.service.in", "stash-deals-expiry.service.in"]) {
    const text = fs.readFileSync(path.join(repoRoot, "ops/runner/systemd", name), "utf8");
    assert.match(text, /OnFailure=stash-deals-alert@%n\.service/);
    assert.match(text, /TimeoutStartSec=/);
    assert.equal(text.includes("[Install]"), false);
  }
});

test("M-3 diffs are three-dot and do not follow renames", () => {
  const yaml = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const diffs = [...yaml.matchAll(/git diff [^\n]+/g)].map((match) => match[0]);
  assert.equal(diffs.length >= 2, true);
  for (const command of diffs) {
    assert.match(command, /--no-renames/);
    assert.match(command, /--name-only/);
    assert.match(command, /\.\.\./);
  }
});

test("M-4 checker fallback is pinned and checkouts drop credentials", () => {
  const yaml = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  assert.equal(yaml.includes('65dcbe0a9b6d9dfd5f0bb55d0373a6b59cd01435'), true);
  assert.equal(yaml.includes("base is missing scripts/check-bot-diff.mjs"), true);
  assert.equal((yaml.match(/persist-credentials: false/g) || []).length, 3);
  const notes = fs.readFileSync(path.join(repoRoot, "ops/README.md"), "utf8");
  assert.match(notes, /check-bot-diff/);
  assert.match(notes, /Workflows permission/);
  assert.match(notes, /Code Owner review/);
});

test("M-5 redirects drop authorization on a host change", async () => {
  const seen = [];
  const allowlist = {
    jobs: {
      aim: [
        { host: "www.example.com", path_prefixes: ["/"] },
        { host: "www.example.net", path_prefixes: ["/"] },
      ],
    },
  };
  await fetchHardened("https://www.example.com/a", {
    job: "aim",
    allowlist,
    resolve: async () => ["192.0.2.10"],
    headers: { Authorization: "Bearer secret", Cookie: "a=b" },
    fetchImpl: async (url, init) => {
      seen.push(init.headers.Authorization || init.headers.authorization || "");
      if (String(url).includes("example.com")) {
        return { status: 302, headers: { get: (name) => (name === "location" ? "https://www.example.net/b" : "") } };
      }
      return {
        status: 200,
        headers: { get: (name) => (name === "content-type" ? "text/html" : "") },
        text: async () => "ok",
      };
    },
  });
  assert.equal(seen[0], "Bearer secret");
  assert.equal(seen[1], "");
  assert.equal(fetchHardened ? true : false, true);
});

test("M-6 review ids are required and mime types are exact", async () => {
  const loose = parsePickText("[x] C01 card\n[x] SUBMIT\n");
  assert.deepEqual(loose.accepted, []);
  const calls = [];
  const skipped = await readRecordedPicks({
    records: [{ file_id: "file", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" }],
    drive: {
      async get(id) {
        calls.push(id);
        return { parentId: "folder", mimeType: "text/plain; charset=utf-8" };
      },
      async export() {
        return "";
      },
    },
  });
  assert.equal(calls.length, 0);
  assert.equal(skipped.skipped[0].reason, "no-review");
  const mime = await readRecordedPicks({
    records: [{ file_id: "file", parent_id: "folder", created_at: "2026-09-24T00:00:00Z" }],
    reviewIds: new Set(["C01"]),
    drive: {
      async get() {
        return { parentId: "folder", mimeType: "text/plain; charset=utf-8" };
      },
      async export() {
        throw new Error("export");
      },
    },
    now: new Date("2026-09-25T00:00:00Z"),
  });
  assert.equal(mime.skipped[0].reason, "mime");
});

test("M-7 category comes from the item", async () => {
  assert.equal(resolveCategory({ url: "https://www.amazon.com/dp/B012345678", aisle: "household" }).ok, true);
  assert.equal(resolveCategory({ url: "https://www.amazon.com/dp/B012345678", aisle: "guns" }).reason, "amazon-category");
  assert.equal(resolveCategory({ url: "https://www.amazon.com/dp/B012345678" }).reason, "unknown-category");
  assert.equal(resolveCategory({ url: "https://www.rei.com/product/tent", aisle: "survival" }).category, "survival");
  const dropped = await runPreppingDeals({
    rss: "<rss><channel><item><link>https://www.amazon.com/dp/B012345678</link></item></channel></rss>",
  });
  assert.equal(dropped.candidates.length, 0);
  const aim = await runAim({
    pages: ["https://www.aimsurplus.com/products/widget"],
    fetchImpl: async () => ({
      ok: true,
      body: '<html><script type="application/ld+json">{"@type":"Offer","price":"9.00"}</script><p>Widget</p></html>',
    }),
  });
  assert.equal(aim.candidates.length, 0);
});

test("M-9 rendered titles are the sanitized text", () => {
  const deal = { slug: "sample", title: "Left\u202eRight\u200b", why: "Because" };
  applyDealText(deal);
  assert.equal(deal.title, "LeftRight");
});

test("L-5 installer uses bash, a private data git, and credential file modes", () => {
  const script = fs.readFileSync(path.join(repoRoot, "ops/runner/install.sh"), "utf8");
  assert.match(script, /^#!\/bin\/bash/);
  assert.match(script, /XDG_RUNTIME_DIR/);
  assert.match(script, /grep -w/);
  assert.equal(script.includes("DATA_GIT:-$ROOT/data.git"), false);
  const creds = fs.mkdtempSync(path.join(os.tmpdir(), "creds-"));
  fs.chmodSync(creds, 0o700);
  fs.writeFileSync(path.join(creds, "token"), "value");
  fs.chmodSync(path.join(creds, "token"), 0o644);
  const envFile = path.join(os.tmpdir(), `cred-env-${process.pid}`);
  fs.writeFileSync(envFile, ["BLACKOUT_WINDOWS=daily 00:00-06:00", "DRIVE_UPLOADER=node", `CRED_DIR=${creds}`].join("\n"));
  const bad = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: envFile },
    encoding: "utf8",
  });
  assert.equal(bad.status, 1);
  fs.chmodSync(path.join(creds, "token"), 0o600);
  const good = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: envFile },
    encoding: "utf8",
  });
  assert.equal(good.status, 0, good.stdout + good.stderr);
});

test("L-6 dates use America/Chicago", () => {
  assert.equal(chicagoDate(new Date("2026-09-26T03:30:00Z")), "2026-09-25");
});

test("publish creates a branch, a commit, and a pull request through the client", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method, body });
    if (url.endsWith("/git/ref/heads/main")) return { ok: true, status: 200, body: JSON.stringify({ object: { sha: "base-sha" } }) };
    if (url.endsWith("/git/blobs")) return { ok: true, status: 201, body: JSON.stringify({ sha: "blob-sha" }) };
    if (url.endsWith("/git/trees")) return { ok: true, status: 201, body: JSON.stringify({ sha: "tree-sha" }) };
    if (url.endsWith("/git/commits")) return { ok: true, status: 201, body: JSON.stringify({ sha: "commit-sha" }) };
    if (url.endsWith("/git/refs")) return { ok: true, status: 201, body: JSON.stringify({ ref: body.ref }) };
    if (url.endsWith("/pulls")) return { ok: true, status: 201, body: JSON.stringify({ number: 1 }) };
    return { ok: false, status: 404, body: "{}" };
  };
  const result = await publishPullRequest({
    token: "token",
    branch: "bot/watch/20260925-1",
    job: "watch",
    date: "2026-09-25",
    cards: [{ title: "Card" }],
    files: [{ path: "data/deals.json", content: "[]" }],
    fetchImpl,
  });
  assert.equal(result.commit, "commit-sha");
  assert.equal(result.branch, "bot/watch/20260925-1");
  assert.equal(calls.some((call) => call.url.endsWith("/git/refs") && call.body.ref === "refs/heads/bot/watch/20260925-1"), true);
  assert.equal(calls.some((call) => call.url.endsWith("/git/commits") && call.body.parents[0] === "base-sha"), true);
  assert.equal(calls.some((call) => call.url.endsWith("/pulls") && call.body.head === "bot/watch/20260925-1"), true);
});
