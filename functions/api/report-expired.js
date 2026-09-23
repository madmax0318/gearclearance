import { acceptReport, hashIp, liveSlugSet, normalizeQueue, SLUG_RE } from "../../src/expired-reports.mjs";
import { reportSlugs } from "../report-slugs.js";

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

function readEnv(env, key) {
  try {
    const value = env?.[key];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function repoName(env) {
  try {
    const repo = readEnv(env, "GITHUB_REPOSITORY") || "madmax0318/gearclearance";
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
    return repo;
  } catch {
    return null;
  }
}

function branchName(env) {
  try {
    const branch = readEnv(env, "GITHUB_BRANCH") || "main";
    if (!/^[A-Za-z0-9._/-]+$/.test(branch)) return null;
    return branch;
  } catch {
    return null;
  }
}

function reportSalt(env) {
  try {
    const salt = readEnv(env, "REPORT_IP_SALT");
    if (salt) return salt;
    const token = readEnv(env, "GITHUB_TOKEN");
    if (token) return `gh:${token.slice(-12)}`;
    return "";
  } catch {
    return "";
  }
}

function githubToken(env) {
  return readEnv(env, "GITHUB_TOKEN").trim();
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

async function discard(res) {
  try {
    await res?.body?.cancel();
  } catch {
    // The body is already consumed or was empty.
  }
}

async function github(env, method, filePath, body) {
  const repo = repoName(env);
  const branch = branchName(env);
  if (!repo || !branch) return { error: "bad_repo" };
  const token = githubToken(env);
  if (!token) return { error: "queue_unconfigured" };
  try {
    const url = new URL(`https://api.github.com/repos/${repo}/contents/${filePath}`);
    if (method === "GET") url.searchParams.set("ref", branch);
    let payload;
    try {
      payload = body ? JSON.stringify(body) : undefined;
    } catch {
      return { error: "queue_invalid" };
    }
    // redirect: "error" throws TypeError on a 3xx and became an uncaught Worker
    // exception on the queue write/read. "manual" returns the 3xx instead.
    const response = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "thestash-expired-reports",
        "x-github-api-version": "2022-11-28",
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      body: payload,
    });
    return { response };
  } catch {
    return { error: "github_unreachable" };
  }
}

async function readRepoJson(env, filePath) {
  let got;
  try {
    got = await github(env, "GET", filePath);
  } catch {
    return { error: "github_unreachable" };
  }
  if (!got) return { error: "bad_repo" };
  if (got.error) return { error: got.error };
  const res = got.response;
  if (!res) return { error: "github_unreachable" };
  if (res.status >= 300 && res.status < 400) {
    await discard(res);
    return { error: "github_unreachable", status: res.status };
  }
  if (res.status === 404) {
    await discard(res);
    return { missing: true };
  }
  if (!res.ok) {
    const status = res.status;
    await discard(res);
    return { error: "queue_read_failed", status };
  }
  try {
    const payload = await res.json();
    return { sha: payload.sha, json: JSON.parse(decodeBase64(payload.content || "")) };
  } catch {
    return { error: "queue_invalid" };
  }
}

function slugsFromList(data) {
  if (!Array.isArray(data)) return null;
  return new Set(data.filter((slug) => typeof slug === "string" && SLUG_RE.test(slug)));
}

async function slugsFromResponse(res) {
  if (!res?.ok) {
    await discard(res);
    return null;
  }
  try {
    return slugsFromList(await res.json());
  } catch {
    await discard(res);
    return null;
  }
}

function assetsFetcher(env) {
  try {
    const binding = env?.ASSETS;
    if (binding && typeof binding.fetch === "function") return binding.fetch.bind(binding);
  } catch {
    // An unbound or broken ASSETS binding must not escape the handler.
  }
  return null;
}

async function slugsFromAssets(env, request) {
  const fetchAsset = assetsFetcher(env);
  if (!fetchAsset) return null;
  let assetUrl;
  try {
    assetUrl = new URL("/report-slugs.json", request.url);
  } catch {
    return null;
  }
  try {
    const res = await fetchAsset(new Request(assetUrl, { method: "GET" }));
    return await slugsFromResponse(res);
  } catch {
    return null;
  }
}

function slugsFromBundle() {
  try {
    return slugsFromList(reportSlugs);
  } catch {
    return null;
  }
}

async function knownSlugs(env, request) {
  let githubStatus = null;
  try {
    const file = await readRepoJson(env, DEALS_PATH);
    if (file.json && Array.isArray(file.json)) return { slugs: liveSlugSet(file.json) };
    if (Number.isInteger(file.status)) githubStatus = file.status;
  } catch {
    githubStatus = null;
  }
  try {
    const slugs = await slugsFromAssets(env, request);
    if (slugs) return { slugs };
  } catch {
    // ASSETS failed closed; the build-time list is next.
  }
  const bundled = slugsFromBundle();
  if (bundled) return { slugs: bundled };
  const failure = { slugs: null, github: "github_board_failed", asset: "slug_asset_failed" };
  if (githubStatus !== null) failure.github_status = githubStatus;
  return failure;
}

async function handleReport(context) {
  const request = context?.request;
  const env = context?.env;
  if (!request) return json(500, { ok: false, error: "internal_error" });
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
  if (!githubToken(env)) return json(503, { ok: false, error: "queue_unconfigured" });
  if (!repoName(env) || !branchName(env)) return json(503, { ok: false, error: "bad_repo" });

  let resolved;
  try {
    resolved = await knownSlugs(env, request);
  } catch {
    resolved = { slugs: null, github: "github_board_failed", asset: "slug_asset_failed" };
  }
  if (!resolved?.slugs) {
    const body = {
      ok: false,
      error: "board_unavailable",
      github: resolved?.github || "github_board_failed",
      asset: resolved?.asset || "slug_asset_failed",
    };
    if (Number.isInteger(resolved?.github_status)) body.github_status = resolved.github_status;
    return json(503, body);
  }
  const slugs = resolved.slugs;

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

    let encoded;
    try {
      encoded = encodeBase64(`${JSON.stringify(decision.queue, null, 2)}\n`);
    } catch {
      return json(500, { ok: false, error: "internal_error" });
    }
    const put = await github(env, "PUT", QUEUE_PATH, {
      message: `chore: record expired-deal report for ${slug}`,
      content: encoded,
      sha: queueFile.sha,
      branch: branchName(env),
    });
    if (!put || put.error === "bad_repo" || put.error === "queue_unconfigured") {
      return json(503, { ok: false, error: put?.error || "bad_repo" });
    }
    if (put.error) return json(502, { ok: false, error: "queue_write_failed" });
    const written = put.response;
    if (!written) return json(502, { ok: false, error: "queue_write_failed" });
    if (written.ok) {
      await discard(written);
      return json(200, publicResult(decision.result));
    }
    await discard(written);
    if (written.status !== 409) return json(502, { ok: false, error: "queue_write_failed" });
  }
  return json(503, { ok: false, error: "queue_conflict" });
}

export async function onRequest(context) {
  try {
    return await handleReport(context);
  } catch {
    return json(500, { ok: false, error: "internal_error" });
  }
}
