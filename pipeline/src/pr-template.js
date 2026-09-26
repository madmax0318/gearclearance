export const BRANCH_RE = /^bot\/(watch|preppingdeals|aim|expiry)\/\d{8}-\d{1,2}$/;
export const RAW_FIELDS = ["raw_subject", "raw_from", "notes", "body"];

export function pullTitle({ job, count, date, slug }) {
  if (job === "expiry") return `bot(expiry): remove ${slug} ${date}`;
  const label = count === 1 ? "1 card(s)" : `${count} card(s)`;
  return `bot(${job}): ${label} ${date}`;
}

export function fence(value) {
  const text = String(value ?? "");
  const runs = text.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const marker = "`".repeat(Math.max(3, longest + 1));
  return `${marker}\n${text}\n${marker}`;
}

export function pullBody({ summary, untrusted = [] }) {
  const blocks = untrusted.map((value) => fence(value)).join("\n\n");
  const head = summary ? `${summary}\n\n` : "";
  return `${head}${blocks}${blocks ? "\n\n" : ""}Opened by stash-deals-bot. Bots never merge.`;
}

export function publicPlan(input) {
  const plan = {
    job: input.job,
    dry_run: Boolean(input.dry_run),
    date: input.date,
    candidates: (input.candidates || []).map((candidate) => ({
      slug: candidate.slug,
      title: candidate.title,
      url: candidate.url,
      category: candidate.category,
      ...(candidate.price_now !== undefined ? { price_now: candidate.price_now } : {}),
      ...(candidate.price_was !== undefined ? { price_was: candidate.price_was } : {}),
      ...(candidate.merchant ? { merchant: candidate.merchant } : {}),
      ...(candidate.pick_ids ? { pick_ids: candidate.pick_ids } : {}),
    })),
  };
  if (input.branch) plan.branch = input.branch;
  if (input.deferred) plan.deferred = input.deferred;
  if (input.removals) plan.removals = input.removals;
  return plan;
}

export function containsRawFields(value) {
  const text = JSON.stringify(value);
  return RAW_FIELDS.some((field) => text.includes(`"${field}"`));
}
