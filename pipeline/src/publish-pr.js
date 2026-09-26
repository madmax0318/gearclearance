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

async function githubJson(url, token, options, fetchImpl) {
  const response = await github(url, token, options, fetchImpl);
  if (response?.ok === false || (Number(response?.status) >= 400)) throw codedError(6, "github");
  if (typeof response?.json === "function") return response.json();
  if (typeof response?.body === "string" && response.body) return JSON.parse(response.body);
  return response;
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
  message,
} = {}) {
  if (!BRANCH_RE.test(branch)) throw codedError(3, "branch");
  const title = pullTitle({ job, count: cards.length, date, slug });
  const body = pullBody({ summary: bodySummary, untrusted });
  if (!body.endsWith("Opened by stash-deals-bot. Bots never merge.")) throw codedError(3, "body");
  const repo = "https://api.github.com/repos/madmax0318/gearclearance";
  const ref = await githubJson(`${repo}/git/ref/heads/${base}`, token, { method: "GET" }, fetchImpl);
  const baseSha = ref?.object?.sha;
  if (!baseSha) throw codedError(6, "ref");
  const tree = [];
  for (const file of files) {
    const blob = await githubJson(
      `${repo}/git/blobs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ content: Buffer.from(String(file.content ?? ""), "utf8").toString("base64"), encoding: "base64" }),
      },
      fetchImpl,
    );
    if (!blob?.sha) throw codedError(6, "blob");
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const treeResult = await githubJson(
    `${repo}/git/trees`,
    token,
    { method: "POST", body: JSON.stringify({ base_tree: baseSha, tree }) },
    fetchImpl,
  );
  if (!treeResult?.sha) throw codedError(6, "tree");
  const commit = await githubJson(
    `${repo}/git/commits`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message: message || title,
        tree: treeResult.sha,
        parents: [baseSha],
      }),
    },
    fetchImpl,
  );
  if (!commit?.sha) throw codedError(6, "commit");
  await githubJson(
    `${repo}/git/refs`,
    token,
    { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) },
    fetchImpl,
  );
  const created = await githubJson(
    `${repo}/pulls`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ title, head: branch, base, body }),
    },
    fetchImpl,
  );
  if (!created || created.ok === false) throw codedError(6, "pull");
  return { title, body, branch, commit: commit.sha, files: files.map((file) => file.path) };
}
