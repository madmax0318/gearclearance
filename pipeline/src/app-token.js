import crypto from "node:crypto";
import { codedError } from "./log.js";
import { fetchHardened } from "./fetch-hardened.js";

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function buildAppJwt({ appId, privateKey, now = Date.now() }) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iat: Math.floor(now / 1000) - 60,
      exp: Math.floor(now / 1000) + 540,
      iss: String(appId),
    }),
  );
  const data = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${signature}`;
}

export async function mintInstallationToken({ appId, privateKey, installationId, fetchImpl, now }) {
  if (!appId || !privateKey || !installationId) throw codedError(2, "E_CONFIG");
  const jwt = buildAppJwt({ appId, privateKey, now });
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
  const body = JSON.stringify({
    repositories: ["gearclearance"],
    permissions: { contents: "write", pull_requests: "write" },
  });
  const response = fetchImpl
    ? await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json" },
        body,
      })
    : await fetchHardened(url, {
        job: "github",
        method: "POST",
        kind: "email",
        headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "content-type": "application/json" },
        body,
      });
  if (!response?.ok) throw codedError(6, "token");
  const data = typeof response.json === "function" ? await response.json() : JSON.parse(response.body);
  return { token: data.token, request: JSON.parse(body) };
}
