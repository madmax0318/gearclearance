const PICK_ID = /^\[x\] (C\d{2})\b/;
const HOURS_72 = 72 * 60 * 60 * 1000;

export function parsePickText(text, { reviewIds, max = 10 } = {}) {
  const raw = String(text ?? "");
  if (Buffer.byteLength(raw) > 64 * 1024) return { ok: false, reason: "too-large" };
  const lines = raw.split(/\r?\n/);
  if (lines.length > 200) return { ok: false, reason: "too-many-lines" };
  if (!lines.some((line) => /^\[x\] SUBMIT\b/.test(line.trim()))) return { ok: false, reason: "no-submit" };
  const ids = [];
  for (const line of lines) {
    const match = PICK_ID.exec(line.trim());
    if (!match) continue;
    if (reviewIds && !reviewIds.has(match[1])) continue;
    ids.push(match[1]);
  }
  return { ok: true, accepted: ids.slice(0, max), deferred: ids.slice(max) };
}

export async function readRecordedPicks({ records, drive, reviewIds, now = new Date() }) {
  const accepted = [];
  const deferred = [];
  const skipped = [];
  for (const record of records) {
    if (now.getTime() - Date.parse(record.created_at) > HOURS_72) {
      skipped.push({ file_id: record.file_id, reason: "expired" });
      continue;
    }
    const meta = await drive.get(record.file_id);
    if (!meta || meta.parentId !== record.parent_id) {
      skipped.push({ file_id: record.file_id, reason: "parent" });
      continue;
    }
    if (meta.mimeType !== "text/plain" && meta.mimeType !== "application/vnd.google-apps.document") {
      skipped.push({ file_id: record.file_id, reason: "mime" });
      continue;
    }
    const text = await drive.export(record.file_id);
    const parsed = parsePickText(text, { reviewIds });
    if (!parsed.ok) {
      skipped.push({ file_id: record.file_id, reason: parsed.reason });
      continue;
    }
    accepted.push(...parsed.accepted);
    deferred.push(...parsed.deferred);
  }
  return {
    accepted: accepted.slice(0, 10),
    deferred: [...accepted.slice(10), ...deferred],
    skipped,
  };
}
