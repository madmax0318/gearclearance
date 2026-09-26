import { AISLES, normalizeAisle } from "./aisles.js";

export { AISLES, normalizeAisle };

export const CANDIDATE_FIELDS = [
  "source_url",
  "title",
  "price",
  "merchant_domain",
  "aisle",
  "raw_subject",
  "raw_from",
  "received_at",
  "confidence",
  "needs_affiliate",
  "notes",
  "country_of_origin",
];

export function candidateRow(partial = {}) {
  const row = {
    source_url: null,
    title: null,
    price: null,
    merchant_domain: null,
    aisle: null,
    raw_subject: null,
    raw_from: null,
    received_at: null,
    confidence: 0,
    needs_affiliate: true,
    notes: "",
    country_of_origin: null,
  };
  for (const key of CANDIDATE_FIELDS) {
    if (partial[key] !== undefined) row[key] = partial[key];
  }
  row.needs_affiliate = partial.needs_affiliate === false ? false : true;
  if (row.aisle != null) row.aisle = normalizeAisle(row.aisle);
  return row;
}

export function assertCandidateShape(row) {
  for (const key of CANDIDATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      throw new Error(`Candidate is missing ${key}`);
    }
  }
  if (typeof row.needs_affiliate !== "boolean") {
    throw new Error("needs_affiliate must be boolean");
  }
  if (row.source_url != null && typeof row.source_url !== "string") {
    throw new Error("source_url must be a string or null");
  }
  if (row.price != null && (typeof row.price !== "number" || !Number.isFinite(row.price))) {
    throw new Error("price must be a finite number or null");
  }
  if (row.aisle != null && !AISLES.includes(row.aisle)) {
    throw new Error(`aisle must be one of ${AISLES.join(", ")}`);
  }
  if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) {
    throw new Error("confidence must be between 0 and 1");
  }
  if (typeof row.notes !== "string") throw new Error("notes must be a string");
  if (row.country_of_origin != null && typeof row.country_of_origin !== "string") {
    throw new Error("country_of_origin must be a string or null");
  }
  return row;
}
