import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acceptReport, hashIp, liveSlugSet, normalizeQueue } from "../src/expired-reports.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queuePath = path.join(rootDir, "data", "expired-reports.json");
const dealsPath = path.join(rootDir, "data", "deals.json");

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("dist/ is missing. Run npm run build first.");
  process.exit(1);
}

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded.includes("\0")) return null;
  const rel = path.normalize(decoded).replace(/^[/\\]+/, "");
  const full = path.resolve(dist, rel);
  if (full !== dist && !full.startsWith(dist + path.sep)) return null;
  return full;
}

function sendFile(res, filePath, status = 200) {
  const ext = path.extname(filePath);
  res.writeHead(status, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2048) {
        if (!settled) {
          settled = true;
          reject(Object.assign(new Error("body_too_large"), { status: 413 }));
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function handleReport(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, error.status || 400, { ok: false, error: error.status === 413 ? "body_too_large" : "bad_json" });
    return;
  }
  const deals = JSON.parse(fs.readFileSync(dealsPath, "utf8"));
  const queue = normalizeQueue(JSON.parse(fs.readFileSync(queuePath, "utf8")));
  const ipHash = await hashIp(req.socket.remoteAddress || "", process.env.REPORT_IP_SALT || "preview-only-not-production");
  const decision = acceptReport(queue, {
    slug: payload && payload.slug,
    company: payload && (payload.company || payload.website),
    now: new Date(),
    ipHash,
    knownSlugs: liveSlugSet(deals),
    source: "site",
  });
  if (!decision.result.ok) {
    sendJson(res, decision.result.status || 400, { ok: false, error: decision.result.error });
    return;
  }
  if (decision.result.stored) {
    fs.writeFileSync(queuePath, `${JSON.stringify(decision.queue, null, 2)}\n`);
  }
  sendJson(res, 200, {
    ok: true,
    stored: Boolean(decision.result.stored),
    id: decision.result.id || null,
    open_reports: decision.result.open_reports ?? null,
    distinct_reporters: decision.result.distinct_reporters ?? null,
    ready_for_review: Boolean(decision.result.ready_for_review),
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/api/report-expired") {
    handleReport(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server_error" });
    });
    return;
  }
  const full = resolvePath(url.pathname);
  if (!full) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  let stat = null;
  try {
    stat = fs.statSync(full);
  } catch {
    stat = null;
  }

  if (stat?.isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
      res.end();
      return;
    }
    const index = path.join(full, "index.html");
    if (fs.existsSync(index)) {
      sendFile(res, index);
      return;
    }
  } else if (stat?.isFile()) {
    sendFile(res, full);
    return;
  }

  const notFound = path.join(dist, "404.html");
  if (fs.existsSync(notFound)) {
    sendFile(res, notFound, 404);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`The Stash Deals preview at http://localhost:${port}`);
});
