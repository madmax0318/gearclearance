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
import { allowedCommitPath, publishPullRequest } from "../src/publish-pr.js";
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
  let minted = 0;
  let published = 0;
  const live = await runWatchPromote({
    records: [],
    cards: [{ pick_id: "C01", slug: "watch-one", title: "Card", url: "https://www.rei.com/p", category: "survival" }],
    reviewIds: new Set(["C01"]),
    dryRun: false,
    date: "2026-09-25",
    liveCount: 0,
    mint: async () => {
      minted += 1;
      return { token: "token" };
    },
    publish: async () => {
      published += 1;
    },
  });
  assert.equal(live.candidates.length, 0);
  assert.equal(minted, 0);
  assert.equal(published, 0);
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
  const enableAt = script.indexOf("systemctl --user enable stash-deals-watch.timer");
  const guardAt = script.lastIndexOf('[ "$MODE" = "enable-watch" ]', enableAt);
  assert.equal(enableAt > 0 && guardAt > 0 && guardAt < enableAt, true);
  const defaultEnable = script.split("\n").find((line) => line.includes("systemctl --user enable stash-deals-preppingdeals.timer"));
  assert.equal(defaultEnable.includes("stash-deals-watch.timer"), false);
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
      "CRED_GH=/tmp/stash-cred-gh",
      "CRED_GMAIL=/tmp/stash-cred-gmail",
      "CRED_DRIVE=/tmp/stash-cred-drive",
      "NODE=/usr/bin/node",
      "CHECKOUT=/tmp/checkout",
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
  const render = fs.mkdtempSync(path.join(os.tmpdir(), "id-match-"));
  const liveFile = path.join(os.tmpdir(), `id-live-${process.pid}`);
  fs.writeFileSync(liveFile, "watch-promote\naim-extra\n");
  const idEnv = path.join(os.tmpdir(), `id-env-${process.pid}`);
  fs.writeFileSync(
    idEnv,
    [
      "BLACKOUT_WINDOWS=daily 00:00-06:00",
      "ONCALENDAR_WATCH=daily 12:00",
      "ONCALENDAR_WATCH_PROMOTE=daily 12:00",
      "ONCALENDAR_PREPPINGDEALS=daily 12:00",
      "ONCALENDAR_AIM=daily 12:00",
      "ONCALENDAR_EXPIRY=daily 12:00",
      "DRIVE_UPLOADER=node",
      "CRED_GH=/tmp/stash-cred-gh",
      "CRED_GMAIL=/tmp/stash-cred-gmail",
      "CRED_DRIVE=/tmp/stash-cred-drive",
      "NODE=/usr/bin/node",
      "CHECKOUT=/tmp/checkout",
    ].join("\n"),
  );
  const matched = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: idEnv, STASH_RENDER_DIR: render, STASH_LIVE_FILE: liveFile },
    encoding: "utf8",
  });
  assert.equal(matched.status, 0, matched.stdout + matched.stderr);
  const dryRun = (name) => fs.readFileSync(path.join(render, name), "utf8").match(/STASH_DRY_RUN=(\d)/)[1];
  assert.equal(dryRun("stash-deals-watch.service"), "1");
  assert.equal(dryRun("stash-deals-watch-promote.service"), "0");
  assert.equal(dryRun("stash-deals-aim.service"), "1");
});

test("L-2 readme keeps the token out of Preview", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  assert.equal(readme.includes("Preview"), false);
  assert.match(readme, /Environment variables for Production/);
});

test("L-6 dates use America/Chicago", () => {
  assert.equal(chicagoDate(new Date("2026-09-26T03:30:00Z")), "2026-09-25");
});

test("L-8 gitleaks allowlist is the email fixtures only", () => {
  const config = fs.readFileSync(path.join(repoRoot, ".gitleaks.toml"), "utf8");
  assert.match(config, /pipeline\/fixtures\/emails\//);
  assert.equal(config.includes("pipeline/test/"), false);
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
  assert.equal(calls.some((call) => call.url.endsWith("/pulls") && call.body.head === "bot/watch/20260925-1" && call.body.base === "main"), true);
});

function githubFake(calls) {
  return async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method, body });
    if (String(url).endsWith("/git/ref/heads/main")) return { ok: true, status: 200, body: JSON.stringify({ object: { sha: "base-sha" } }) };
    if (String(url).endsWith("/git/blobs")) return { ok: true, status: 201, body: JSON.stringify({ sha: "blob-sha" }) };
    if (String(url).endsWith("/git/trees")) return { ok: true, status: 201, body: JSON.stringify({ sha: "tree-sha" }) };
    if (String(url).endsWith("/git/commits")) return { ok: true, status: 201, body: JSON.stringify({ sha: "commit-sha" }) };
    if (String(url).endsWith("/git/refs")) return { ok: true, status: 201, body: JSON.stringify({ ref: body.ref }) };
    if (String(url).endsWith("/pulls")) return { ok: true, status: 201, body: JSON.stringify({ number: 1 }) };
    return { ok: false, status: 404, body: "{}" };
  };
}

const publishBase = {
  token: "token",
  branch: "bot/watch/20260925-1",
  job: "watch",
  date: "2026-09-25",
  cards: [{ title: "Card" }],
};

test("RM-1 publish stays on main and refuses empty or foreign paths", async () => {
  assert.equal(allowedCommitPath("data/deals.json"), true);
  assert.equal(allowedCommitPath("data/deals-extra.json"), true);
  assert.equal(allowedCommitPath("data/expired/deals.json"), true);
  assert.equal(allowedCommitPath("public/images/deals/card.jpg"), true);
  assert.equal(allowedCommitPath("public/images/deals/nested/card.webp"), true);
  for (const bad of ["../data/deals.json", "/data/deals.json", "data\\deals.json", "README.md", "public/images/deals/../../etc/passwd", "data/expired/deals-extra.json"]) {
    assert.equal(allowedCommitPath(bad), false, bad);
  }
  const refused = [];
  await assert.rejects(() => publishPullRequest({ ...publishBase, base: "main", files: [{ path: "data/deals.json", content: "[]" }], fetchImpl: githubFake(refused) }));
  await assert.rejects(() => publishPullRequest({ ...publishBase, base: "other", files: [{ path: "data/deals.json", content: "[]" }], fetchImpl: githubFake(refused) }));
  await assert.rejects(() => publishPullRequest({ ...publishBase, files: [], fetchImpl: githubFake(refused) }));
  await assert.rejects(() => publishPullRequest({ ...publishBase, files: [{ path: "README.md", content: "x" }], fetchImpl: githubFake(refused) }));
  await assert.rejects(() => publishPullRequest({
    ...publishBase,
    files: [{ path: "public/images/deals/card.jpg", content: "not-bytes" }],
    fetchImpl: githubFake(refused),
  }));
  assert.equal(refused.length, 0);
  const calls = [];
  const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x11]);
  const created = await publishPullRequest({
    ...publishBase,
    files: [{ path: "public/images/deals/card.jpg", content: bytes }],
    fetchImpl: githubFake(calls),
  });
  assert.equal(created.commit, "commit-sha");
  const blob = calls.find((call) => call.url.endsWith("/git/blobs"));
  assert.equal(blob.body.content, bytes.toString("base64"));
  assert.equal(blob.body.encoding, "base64");
  assert.notEqual(blob.body.content, Buffer.from(String(bytes), "utf8").toString("base64"));
  assert.equal(calls.some((call) => call.url.includes("/heads/other")), false);
  assert.equal(calls.find((call) => call.url.endsWith("/pulls")).body.base, "main");
});

test("RM-2 zero accepted picks skip the token and the publisher", async () => {
  for (const dryRun of [true, false]) {
    let minted = 0;
    let published = 0;
    const plan = await runWatchPromote({
      records: [],
      cards: [{ pick_id: "C01", slug: "watch-one", title: "Card", url: "https://www.rei.com/p", category: "survival" }],
      reviewIds: new Set(["C01"]),
      dryRun,
      date: "2026-09-25",
      mint: async () => {
        minted += 1;
        return { token: "token" };
      },
      publish: async () => {
        published += 1;
      },
    });
    assert.equal(plan.candidates.length, 0);
    assert.equal(plan.published, false);
    assert.equal(minted, 0, `dry=${dryRun}`);
    assert.equal(published, 0, `dry=${dryRun}`);
  }
  let minted = 0;
  let published = 0;
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
    cards: [{ pick_id: "C01", slug: "watch-one", title: "Card", url: "https://www.rei.com/p", category: "survival" }],
    dryRun: false,
    date: "2026-09-25",
    now: new Date("2026-09-25T00:00:00Z"),
    mint: async () => {
      minted += 1;
      return { token: "token" };
    },
    publish: async () => {
      published += 1;
    },
  });
  assert.equal(kept.candidates.length, 1);
  assert.equal(minted, 1);
  assert.equal(published, 1);
});

test("RM-3 job timeouts sit above the shared lock and units run idle", () => {
  const jobs = {
    "stash-deals-watch.service.in": 25,
    "stash-deals-watch-promote.service.in": 30,
    "stash-deals-preppingdeals.service.in": 35,
    "stash-deals-aim.service.in": 40,
    "stash-deals-expiry.service.in": 45,
  };
  for (const [name, minutes] of Object.entries(jobs)) {
    const text = fs.readFileSync(path.join(repoRoot, "ops/runner/systemd", name), "utf8");
    assert.match(text, new RegExp(`^TimeoutStartSec=${minutes}min$`, "m"));
    assert.equal(minutes * 60 > 20 * 60, true, name);
    assert.equal(minutes >= 15 && minutes <= 45, true, name);
    assert.match(text, /^Nice=/m);
    assert.match(text, /^IOSchedulingClass=idle$/m);
    assert.equal(text.includes("TimeoutStartSec=120"), false);
  }
  const alert = fs.readFileSync(path.join(repoRoot, "ops/runner/systemd/stash-deals-alert@.service.in"), "utf8");
  assert.match(alert, /^TimeoutStartSec=15min$/m);
  assert.match(alert, /^Nice=/m);
  assert.match(alert, /^IOSchedulingClass=idle$/m);
});

function checkInstall(lines) {
  const envFile = path.join(os.tmpdir(), `rm4-${process.pid}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(envFile, lines.join("\n"));
  return spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: envFile },
    encoding: "utf8",
  });
}

const quietCalendars = [
  "ONCALENDAR_WATCH=daily 12:00",
  "ONCALENDAR_WATCH_PROMOTE=daily 12:00",
  "ONCALENDAR_PREPPINGDEALS=daily 12:00",
  "ONCALENDAR_AIM=daily 12:00",
  "ONCALENDAR_EXPIRY=daily 12:00",
  "DRIVE_UPLOADER=node",
];

test("RM-4 blackout, live job, enable-watch, and unit values", () => {
  const clock = checkInstall(["BLACKOUT_WINDOWS=daily 18:45-19:05", "ONCALENDAR_WATCH=daily 18:50", ...quietCalendars.slice(1)]);
  assert.equal(clock.status, 1, clock.stdout + clock.stderr);
  assert.match(clock.stderr, /blackout overlap/);
  const seconds = checkInstall(["BLACKOUT_WINDOWS=daily 18:45-19:05", "ONCALENDAR_WATCH=daily 18:50:00", ...quietCalendars.slice(1)]);
  assert.equal(seconds.status, 1, seconds.stdout + seconds.stderr);
  assert.match(seconds.stderr, /blackout overlap/);
  const span = checkInstall(["BLACKOUT_WINDOWS=daily 18:45-19:05", "ONCALENDAR_WATCH=daily 18:30", ...quietCalendars.slice(1)]);
  assert.equal(span.status, 1, span.stdout + span.stderr);
  const clear = checkInstall(["BLACKOUT_WINDOWS=daily 18:45-19:05", ...quietCalendars]);
  assert.equal(clear.status, 0, clear.stdout + clear.stderr);

  const unknown = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--live", "household"], {
    encoding: "utf8",
  });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown job/);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "install-home-"));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/bash\nexit 0\n");
  fs.writeFileSync(
    path.join(bin, "systemctl"),
    "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$STASH_SYSTEMCTL_LOG\"\nif [ \"$2\" = \"daemon-reload\" ] && [ -n \"${STASH_FAIL_RELOAD:-}\" ]; then exit 1; fi\nexit 0\n",
  );
  fs.writeFileSync(
    path.join(bin, "systemd-analyze"),
    "#!/bin/bash\nif [ -n \"${STASH_FAIL_VERIFY:-}\" ]; then exit 1; fi\nexit 0\n",
  );
  for (const name of ["npm", "systemctl", "systemd-analyze"]) fs.chmodSync(path.join(bin, name), 0o755);
  const envFile = path.join(home, "stash.env");
  const dataGit = path.join(home, "data.git");
  fs.writeFileSync(
    envFile,
    [
      "BLACKOUT_WINDOWS=daily 00:00-06:00",
      ...quietCalendars,
      "CRED_GH=/tmp/stash-cred-gh",
      "CRED_GMAIL=/tmp/stash-cred-gmail",
      "CRED_DRIVE=/tmp/stash-cred-drive",
      "NODE=/usr/bin/node",
      "CHECKOUT=/tmp/checkout",
      `DATA_GIT=${dataGit}`,
    ].join("\n"),
  );
  const log = path.join(home, "systemctl.log");
  const baseEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "share"),
    XDG_STATE_HOME: path.join(home, "state"),
    STASH_ENV: envFile,
    STASH_SYSTEMCTL_LOG: log,
  };
  const enabled = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--enable-watch"], {
    env: baseEnv,
    encoding: "utf8",
  });
  assert.equal(enabled.status, 0, enabled.stdout + enabled.stderr);
  const enabledLog = fs.readFileSync(log, "utf8");
  assert.match(enabledLog, /enable stash-deals-watch\.timer stash-deals-watch-promote\.timer/);
  fs.writeFileSync(log, "");
  const installed = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh")], {
    env: baseEnv,
    encoding: "utf8",
  });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const installedLog = fs.readFileSync(log, "utf8");
  assert.match(installedLog, /enable stash-deals-preppingdeals\.timer/);
  assert.equal(installedLog.includes("stash-deals-watch.timer"), false);
  const verifyFail = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh")], {
    env: { ...baseEnv, STASH_FAIL_VERIFY: "1", STASH_SYSTEMCTL_LOG: path.join(home, "verify.log") },
    encoding: "utf8",
  });
  assert.notEqual(verifyFail.status, 0);
  const reloadLog = path.join(home, "reload.log");
  const reloadFail = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh")], {
    env: { ...baseEnv, STASH_FAIL_RELOAD: "1", STASH_SYSTEMCTL_LOG: reloadLog },
    encoding: "utf8",
  });
  assert.notEqual(reloadFail.status, 0);
  assert.equal(fs.readFileSync(reloadLog, "utf8").includes("enable "), false);

  const render = fs.mkdtempSync(path.join(os.tmpdir(), "unit-values-"));
  const renderEnv = path.join(home, "render.env");
  fs.writeFileSync(
    renderEnv,
    fs.readFileSync(envFile, "utf8").split("\n").filter((line) => !line.startsWith("NODE=") && !line.startsWith("CHECKOUT=")).join("\n"),
  );
  const badValue = (extra) => spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: {
      ...process.env,
      STASH_ENV: renderEnv,
      STASH_RENDER_DIR: render,
      NODE: "/usr/bin/node",
      CHECKOUT: "/tmp/checkout",
      ...extra,
    },
    encoding: "utf8",
  });
  assert.equal(badValue({ CHECKOUT: "/tmp/checkout\nExecStart=/bin/sh" }).status, 2);
  assert.equal(badValue({ NODE: "/usr/bin/node%h" }).status, 2);
  assert.equal(badValue({ NODE: "node" }).status, 2);
  assert.equal(badValue({ CHECKOUT: "/tmp/my checkout" }).status, 2);
  const injected = path.join(home, "injected.env");
  fs.writeFileSync(injected, fs.readFileSync(envFile, "utf8").replace("ONCALENDAR_WATCH=daily 12:00", "ONCALENDAR_WATCH=daily 12:00%h"));
  const percent = spawnSync("bash", [path.join(repoRoot, "ops/runner/install.sh"), "--check"], {
    env: { ...process.env, STASH_ENV: injected, STASH_RENDER_DIR: render },
    encoding: "utf8",
  });
  assert.equal(percent.status, 2, percent.stdout + percent.stderr);
});

test("gitleaks ignore lists public site-verification fingerprints", () => {
  const ignore = fs.readFileSync(path.join(repoRoot, ".gitleaksignore"), "utf8");
  assert.match(ignore, /public site-verification tokens/);
  const fingerprints = ignore.split("\n").filter((line) => line && !line.startsWith("#"));
  for (const line of [
    "3e7380931531c1b7a6a6405611b848ae9cd537fc:scripts/build.mjs:generic-api-key:529",
    "3e7380931531c1b7a6a6405611b848ae9cd537fc:scripts/build.mjs:generic-api-key:994",
    "a8ffe4172fb87c98673cf1a7723de69eb689e1f0:scripts/build.mjs:generic-api-key:637",
    "a8ffe4172fb87c98673cf1a7723de69eb689e1f0:scripts/build.mjs:generic-api-key:752",
    "b73abc23f6fef3b85f005ef6038e9fc1663b6bec:scripts/build.mjs:generic-api-key:632",
  ]) {
    assert.equal(fingerprints.includes(line), true, line);
  }
  for (const line of fingerprints) {
    assert.match(line, /^[0-9a-f]{40}:scripts\/build\.mjs:generic-api-key:\d+$/);
  }
  assert.equal(ignore.includes("pipeline/test/"), false);
});
