import { BRANCH_RE, pullBody, pullTitle } from "./pr-template.js";
import { codedError } from "./log.js";
import { fetchHardened } from "./fetch-hardened.js";

async function github(url, token, options, fetchImpl) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  if (fetchImpl) return fetchImpl(url, { ...options, headers });
  return fetchHardened(url, { ...options, headers, job: "github", kind: "email" });
}

export async function publishPullRequest({
  token,
  branch,
  job,
  date,
  cards = [],
  slug,
  bodySummary = "",
  untrusted = [],
  base = "main",
  fetchImpl,
  files = [],
} = {}) {
  if (!BRANCH_RE.test(branch)) throw codedError(3, "branch");
  const title = pullTitle({ job, count: cards.length, date, slug });
  const body = pullBody({ summary: bodySummary, untrusted });
  if (!body.endsWith("Opened by stash-deals-bot. Bots never merge.")) throw codedError(3, "body");
  const repo = "https://api.github.com/repos/madmax0318/gearclearance";
  const ref = await github(`${repo}/git/ref/heads/${base}`, token, { method: "GET" }, fetchImpl);
  if (!ref?.ok && ref?.status !== 200) throw codedError(6, "ref");
  const created = await github(
    `${repo}/pulls`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ title, head: branch, base, body }),
    },
    fetchImpl,
  );
  if (created?.ok === false) throw codedError(6, "pull");
  return { title, body, branch, files: files.map((file) => file.path) };
}
