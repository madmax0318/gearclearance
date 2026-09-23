import { acceptReport, hashIp, liveSlugSet, normalizeQueue, SLUG_RE } from "../../src/expired-reports.mjs";

const QUEUE_PATH = "data/expired-reports.json";
const DEALS_PATH = "data/deals.json";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function publicResult(result) {
  return {
    ok: true,
    stored: Boolean(result.stored),
    id: result.id || null,
    open_reports: result.open_reports ?? null,
    distinct_reporters: result.distinct_reporters ?? null,
    ready_for_review: Boolean(result.ready_for_review),
  };
}

function repoName(env) {
  const repo = env.GITHUB_REPOSITORY || "madmax0318/gearclearance";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return repo;
}

function branchName(env) {
  const branch = env.GITHUB_BRANCH || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) return null;
  return branch;
}

function reportSalt(env) {
  if (env.REPORT_IP_SALT) return env.REPORT_IP_SALT;
  if (env.GITHUB_TOKEN) return `gh:${env.GITHUB_TOKEN.slice(-12)}`;
  return "";
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function github(env, method, filePath, body) {
  const repo = repoName(env);
  const branch = branchName(env);
  if (!repo || !branch) return null;
  const url = new URL(`https://api.github.com/repos/${repo}/contents/${filePath}`);
  if (method === "GET") url.searchParams.set("ref", branch);
  return fetch(url, {
    method,
    redirect: "error",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "user-agent": "thestash-expired-reports",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function readRepoJson(env, filePath) {
  const res = await github(env, "GET", filePath);
  if (!res) return { error: "bad_repo" };
  if (res.status === 404) return { missing: true };
  if (!res.ok) return { error: "queue_read_failed", status: res.status };
  const payload = await res.json();
  try {
    return { sha: payload.sha, json: JSON.parse(decodeBase64(payload.content || "")) };
  } catch {
    return { error: "queue_invalid" };
  }
}

async function slugsFromAssets(env, request) {
  if (!env.ASSETS?.fetch) return null;
  try {
    const assetUrl = new URL("/report-slugs.json", request.url);
    const res = await env.ASSETS.fetch(new Request(assetUrl));
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return new Set(data.filter((slug) => typeof slug === "string" && SLUG_RE.test(slug)));
  } catch {
    return null;
  }
}

async function knownSlugs(env, request) {
  const file = await readRepoJson(env, DEALS_PATH);
  if (file.json && Array.isArray(file.json)) return liveSlugSet(file.json);
  return slugsFromAssets(env, request);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 2048) return json(413, { ok: false, error: "body_too_large" });

  let payload;
  try {
    const text = await request.text();
    if (text.length > 2048) return json(413, { ok: false, error: "body_too_large" });
    payload = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: "bad_json" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json(400, { ok: false, error: "bad_json" });
  }

  const company = payload.company || payload.website || "";
  if (String(company).trim()) return json(200, { ok: true, stored: false });

  const slug = String(payload.slug || "").trim();
  if (!SLUG_RE.test(slug) || slug.length > 80) return json(400, { ok: false, error: "bad_slug" });
  if (!env.GITHUB_TOKEN) return json(503, { ok: false, error: "queue_unconfigured" });
  if (!repoName(env) || !branchName(env)) return json(503, { ok: false, error: "bad_repo" });

  let slugs;
  try {
    slugs = await knownSlugs(env, request);
  } catch {
    slugs = null;
  }
  if (!slugs) return json(503, { ok: false, error: "board_unavailable" });

  const ip = request.headers.get("cf-connecting-ip") || "";
  let ipHash = "";
  try {
    ipHash = await hashIp(ip, reportSalt(env));
  } catch {
    ipHash = "";
  }
  const now = new Date();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const queueFile = await readRepoJson(env, QUEUE_PATH);
    if (queueFile.missing) return json(503, { ok: false, error: "queue_missing" });
    if (queueFile.error) return json(503, { ok: false, error: queueFile.error });
    let queue;
    try {
      queue = normalizeQueue(queueFile.json);
    } catch {
      return json(503, { ok: false, error: "queue_invalid" });
    }
    const decision = acceptReport(queue, {
      slug,
      company: "",
      now,
      ipHash,
      knownSlugs: slugs,
      source: "site",
    });
    if (!decision.result.ok) {
      return json(decision.result.status || 400, { ok: false, error: decision.result.error });
    }
    if (!decision.result.stored) return json(200, publicResult(decision.result));

    const put = await github(env, "PUT", QUEUE_PATH, {
      message: `chore: record expired-deal report for ${slug}`,
      content: encodeBase64(`${JSON.stringify(decision.queue, null, 2)}\n`),
      sha: queueFile.sha,
      branch: branchName(env),
    });
    if (!put) return json(503, { ok: false, error: "bad_repo" });
    if (put.ok) return json(200, publicResult(decision.result));
    if (put.status !== 409) return json(502, { ok: false, error: "queue_write_failed" });
  }
  return json(503, { ok: false, error: "queue_conflict" });
}
