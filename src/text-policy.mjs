const CC_CF = /\p{Cc}|\p{Cf}/gu;

const TITLE_FORBIDDEN = /https?:\/\/|@|`|<|\]\(|\|/i;

export const TITLE_MAX = 120;
export const WHY_MAX = 280;
export const NOTES_MAX = 500;

export function normalizePolicyText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(CC_CF, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkBoundedText(value, max, label) {
  const text = normalizePolicyText(value);
  if (!text) return { ok: false, reason: `${label}-empty`, text };
  if (text.length > max) return { ok: false, reason: `${label}-length`, text };
  return { ok: true, text };
}

export function checkTitle(value) {
  const result = checkBoundedText(value, TITLE_MAX, "title");
  if (!result.ok) return result;
  if (TITLE_FORBIDDEN.test(result.text)) return { ok: false, reason: "title-chars", text: result.text };
  return result;
}

export function checkWhy(value) {
  return checkBoundedText(value, WHY_MAX, "why");
}

export function checkNotes(value) {
  if (value == null || value === "") return { ok: true, text: "" };
  const text = normalizePolicyText(value);
  if (text.length > NOTES_MAX) return { ok: false, reason: "notes-length", text };
  return { ok: true, text };
}
