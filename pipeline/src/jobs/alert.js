import fs from "node:fs";
import path from "node:path";

export function writeAlert(status, { dir = process.env.STASH_STATE || process.cwd(), journal = process.stderr } = {}) {
  const payload = { identifier: "stash-deals", level: "err", ...status, at: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "status.json"), `${JSON.stringify(payload)}\n`);
  journal.write(`${JSON.stringify({ SYSLOG_IDENTIFIER: "stash-deals", level: "err", code: status.code || null })}\n`);
  return payload;
}
