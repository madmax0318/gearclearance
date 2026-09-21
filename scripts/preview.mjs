import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
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
  console.log(`Gear Clearance preview at http://localhost:${port}`);
});
