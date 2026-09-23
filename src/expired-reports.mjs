// Shared contract for expired-deal reports.
// The static site, the Pages function, and the Ion Cannon midday job all use this shape.

export const REPORT_THRESHOLD = 3;
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REPORT_IP_HOURLY_CAP = 8;
export const REPORT_KEEP_DAYS = 30;
export const OPEN_REPORT_CAP = 1000;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ACTORS = new Set(["admin", "ion-cannon", "reports"]);
export const QUEUE_FILE = "data/expired-reports.json";
export const ARCHIVE_FILE = "data/expired/deals.json";
export const LIVE_FILE = "data/deals.json";
export const AFFILIATE_POLICY =
  "Use the stored merchant url exactly. Do not add tags, link ids, utm parameters, or any other affiliate wrapping.";

const REPORT_STATUSES = new Set(["open", "dismissed", "removed"]);
const REPORT_SOURCES = new Set(["site", "admin", "ion-cannon"]);

export function emptyQueue() {
  return { version: 1, threshold: REPORT_THRESHOLD, reports: [] };
}

export function isLiveDeal(deal) {
  return !deal || deal.status !== "expired";
}

export function publishedDeals(deals) {
  return (Array.isArray(deals) ? deals : []).filter((deal) => deal && deal.status !== "expired");
}

export function liveSlugSet(deals) {
  return new Set(publishedDeals(deals).map((deal) => deal.slug));
}

export function normalizeQueue(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("expired report queue must be an object");
  }
  if (data.version !== 1) throw new Error("expired report queue version must be 1");
  const threshold = data.threshold === undefined ? REPORT_THRESHOLD : data.threshold;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 20) {
    throw new Error("expired report queue threshold must be an integer from 1 to 20");
  }
  if (!Array.isArray(data.reports)) throw new Error("expired report queue reports must be an array");
  const reports = data.reports.map((report, index) => normalizeReport(report, index));
  return { version: 1, threshold, reports };
}

function normalizeReport(report, index) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error(`Bad report at ${index}`);
  }
  if (typeof report.id !== "string" || report.id.length < 8 || report.id.length > 180) {
    throw new Error(`Bad report id at ${index}`);
  }
  if (typeof report.slug !== "string" || !SLUG_RE.test(report.slug)) {
    throw new Error(`Bad report slug at ${index}`);
  }
  if (typeof report.reported_at !== "string" || Number.isNaN(Date.parse(report.reported_at))) {
    throw new Error(`Bad reported_at at ${index}`);
  }
  if (!REPORT_SOURCES.has(report.source)) throw new Error(`Bad report source at ${index}`);
  if (!REPORT_STATUSES.has(report.status)) throw new Error(`Bad report status at ${index}`);
  if (report.ip_hash !== undefined && report.ip_hash !== null && typeof report.ip_hash !== "string") {
    throw new Error(`Bad ip_hash at ${index}`);
  }
  const next = {
    id: report.id,
    slug: report.slug,
    reported_at: report.reported_at,
    source: report.source,
    status: report.status,
    ip_hash: typeof report.ip_hash === "string" ? report.ip_hash : "",
  };
  if (typeof report.resolved_at === "string" && !Number.isNaN(Date.parse(report.resolved_at))) {
    next.resolved_at = report.resolved_at;
  }
  if (typeof report.resolved_by === "string" && ACTORS.has(report.resolved_by)) {
    next.resolved_by = report.resolved_by;
  }
  if (typeof report.note === "string" && report.note.trim()) {
    next.note = report.note.trim().slice(0, 200);
  }
  return next;
}

export async function hashIp(ip, salt) {
  const value = String(ip || "").trim();
  const pepper = String(salt || "");
  if (!value || !pepper) return "";
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is required to hash report addresses");
  const bytes = new TextEncoder().encode(`${pepper}\n${value}`);
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function honeypotFilled(input) {
  return String(input?.company || input?.website || "").trim() !== "";
}

function signalFor(reports, slug) {
  const open = reports.filter((report) => report.slug === slug && report.status === "open");
  const reporters = new Set(open.map((report) => (report.ip_hash ? `ip:${report.ip_hash}` : "anon")));
  return { open_reports: open.length, distinct_reporters: reporters.size };
}

function reportId(now, slug, ipHash) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  const tail = Math.random().toString(16).slice(2, 8);
  const who = (ipHash || "anon").slice(0, 6);
  return `${stamp}-${slug}-${who}${tail}`;
}

export function pruneQueue(queue, now, keepDays = REPORT_KEEP_DAYS) {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const reports = queue.reports.filter((report) => {
    if (report.status === "open") return true;
    const resolved = Date.parse(report.resolved_at || report.reported_at);
    return resolved >= cutoff;
  });
  return { ...queue, reports };
}

export function acceptReport(queue, input = {}) {
  const current = normalizeQueue(queue);
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  if (Number.isNaN(now.getTime())) {
    return { queue: current, result: { ok: false, status: 400, error: "bad_time" } };
  }
  if (honeypotFilled(input)) {
    return { queue: current, result: { ok: true, stored: false, reason: "ignored" } };
  }
  const slug = String(input.slug || "").trim();
  if (!SLUG_RE.test(slug) || slug.length > 80) {
    return { queue: current, result: { ok: false, status: 400, error: "bad_slug" } };
  }
  if (input.knownSlugs && !input.knownSlugs.has(slug)) {
    return { queue: current, result: { ok: false, status: 404, error: "unknown_deal" } };
  }
  const ipHash = typeof input.ipHash === "string" ? input.ipHash : "";
  const windowStart = now.getTime() - REPORT_WINDOW_MS;
  const duplicate = current.reports.find(
    (report) =>
      report.slug === slug &&
      report.ip_hash === ipHash &&
      report.status === "open" &&
      Date.parse(report.reported_at) >= windowStart,
  );
  if (duplicate) {
    const signal = signalFor(current.reports, slug);
    return {
      queue: current,
      result: {
        ok: true,
        stored: false,
        reason: "duplicate",
        id: duplicate.id,
        ...signal,
        ready_for_review: signal.distinct_reporters >= current.threshold,
      },
    };
  }
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const recentFromIp = current.reports.filter(
    (report) => report.ip_hash === ipHash && Date.parse(report.reported_at) >= hourAgo,
  ).length;
  if (recentFromIp >= REPORT_IP_HOURLY_CAP) {
    return { queue: current, result: { ok: false, status: 429, error: "rate_limited" } };
  }
  const openCount = current.reports.filter((report) => report.status === "open").length;
  if (openCount >= OPEN_REPORT_CAP) {
    return { queue: current, result: { ok: false, status: 503, error: "queue_full" } };
  }
  const report = {
    id: reportId(now, slug, ipHash),
    slug,
    reported_at: now.toISOString(),
    source: REPORT_SOURCES.has(input.source) ? input.source : "site",
    status: "open",
    ip_hash: ipHash,
  };
  const next = pruneQueue({ ...current, reports: [...current.reports, report] }, now);
  const signal = signalFor(next.reports, slug);
  return {
    queue: next,
    result: {
      ok: true,
      stored: true,
      id: report.id,
      ...signal,
      ready_for_review: signal.distinct_reporters >= next.threshold,
    },
  };
}

export function removalCommand(slug) {
  return `node scripts/expire-deal.mjs remove ${slug} --by ion-cannon --reason verified-expired`;
}

export function planVerification(queue, deals, { now = new Date() } = {}) {
  const current = normalizeQueue(queue);
  const live = publishedDeals(deals);
  const when = now instanceof Date ? now : new Date(now);
  const slugs = [...new Set(current.reports.filter((report) => report.status === "open").map((report) => report.slug))];
  const verify = [];
  for (const slug of slugs) {
    const signal = signalFor(current.reports, slug);
    if (signal.distinct_reporters < current.threshold) continue;
    const deal = live.find((item) => item.slug === slug);
    if (!deal) continue;
    verify.push({
      slug,
      title: deal.title ?? null,
      merchant: deal.merchant ?? null,
      url: deal.url ?? null,
      open_reports: signal.open_reports,
      distinct_reporters: signal.distinct_reporters,
      ready_for_review: true,
      remove: {
        command: removalCommand(slug),
        sets: { status: "expired" },
        live: LIVE_FILE,
        archive: ARCHIVE_FILE,
      },
    });
  }
  verify.sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    version: 1,
    generated_at: when.toISOString(),
    threshold: current.threshold,
    affiliate_policy: AFFILIATE_POLICY,
    queue: QUEUE_FILE,
    live: LIVE_FILE,
    archive: ARCHIVE_FILE,
    verify,
  };
}

function cleanReason(reason) {
  const text = String(reason || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return text || "verified-expired";
}

function markReportsRemoved(queue, slug, by, now) {
  const reports = queue.reports.map((report) => {
    if (report.slug !== slug || report.status !== "open") return report;
    return {
      ...report,
      status: "removed",
      resolved_at: now.toISOString(),
      resolved_by: by,
    };
  });
  return { ...queue, reports };
}

export function applyRemoval({ deals, archive, queue, slug, by, reason, now = new Date() } = {}) {
  const liveDeals = Array.isArray(deals) ? deals : [];
  const archived = Array.isArray(archive) ? archive : [];
  const current = normalizeQueue(queue ?? emptyQueue());
  const when = now instanceof Date ? now : new Date(now);
  const id = String(slug || "").trim();
  if (!SLUG_RE.test(id)) {
    return { ok: false, error: "bad_slug", deals: liveDeals, archive: archived, queue: current };
  }
  if (!ACTORS.has(by)) {
    return { ok: false, error: "bad_actor", deals: liveDeals, archive: archived, queue: current };
  }
  const index = liveDeals.findIndex((deal) => deal && deal.slug === id);
  const prior = archived.find((deal) => deal && deal.slug === id) || null;
  if (index === -1 && !prior) {
    return { ok: false, error: "unknown_deal", deals: liveDeals, archive: archived, queue: current };
  }
  const source = index === -1 ? prior : liveDeals[index];
  const newlyExpired = index !== -1 && source.status !== "expired";
  const nextRecord = {
    ...source,
    status: "expired",
    expired_at: newlyExpired ? when.toISOString() : source.expired_at || when.toISOString(),
    expired_by: newlyExpired ? by : source.expired_by || by,
    expired_reason: newlyExpired ? cleanReason(reason) : source.expired_reason || cleanReason(reason),
  };
  const nextDeals = liveDeals.filter((deal) => !deal || deal.slug !== id);
  const nextArchive = archived.filter((deal) => !deal || deal.slug !== id).concat(nextRecord);
  const nextQueue = pruneQueue(markReportsRemoved(current, id, by, when), when);
  return {
    ok: true,
    removed: index !== -1,
    reason: index === -1 ? "already_expired" : "expired",
    slug: id,
    url: nextRecord.url ?? null,
    deals: nextDeals,
    archive: nextArchive,
    queue: nextQueue,
  };
}

export function applyReady({ deals, archive, queue, by = "ion-cannon", reason = "verified-expired", now = new Date() } = {}) {
  const plan = planVerification(queue, publishedDeals(deals), { now });
  let state = {
    deals: Array.isArray(deals) ? deals : [],
    archive: Array.isArray(archive) ? archive : [],
    queue: normalizeQueue(queue ?? emptyQueue()),
    removed: [],
  };
  for (const item of plan.verify) {
    const step = applyRemoval({ ...state, slug: item.slug, by, reason, now });
    if (!step.ok || !step.removed) continue;
    state = {
      deals: step.deals,
      archive: step.archive,
      queue: step.queue,
      removed: [...state.removed, item.slug],
    };
  }
  return { ok: true, removed: state.removed, deals: state.deals, archive: state.archive, queue: state.queue, plan };
}
