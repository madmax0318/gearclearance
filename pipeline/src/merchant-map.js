import fs from "node:fs";

const NETWORKS = new Set(["avantlink", "impact", "cj", "amazon", "direct", "none"]);
const STATUSES = new Set(["live", "pending_approval", "none", "blocked_tos"]);

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const filtered = rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
  if (filtered.length === 0) return [];
  const header = filtered[0].map((cell) => cell.trim());
  return filtered.slice(1).map((cells) => {
    const obj = {};
    header.forEach((name, index) => {
      obj[name] = cells[index] ?? "";
    });
    return obj;
  });
}

export function normalizeEntry(row) {
  const merchant_domain = String(row.merchant_domain || row.domain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!merchant_domain) throw new Error("Merchant map row is missing merchant_domain");
  const network = String(row.network || "none").trim().toLowerCase();
  const status = String(row.status || "none").trim().toLowerCase();
  if (!NETWORKS.has(network)) throw new Error(`Unknown network "${network}" for ${merchant_domain}`);
  if (!STATUSES.has(status)) throw new Error(`Unknown status "${status}" for ${merchant_domain}`);
  const template = String(row.link_template || "").trim();
  const publisher = String(row.publisher_id_env || "").trim();
  return {
    merchant_domain,
    network,
    status,
    publisher_id_env: publisher || null,
    link_template: template || null,
    notes: row.notes ? String(row.notes) : "",
  };
}

export function loadMerchantMap(source) {
  if (Array.isArray(source)) return source.map(normalizeEntry);
  const text = fs.readFileSync(source, "utf8");
  const rows = String(source).toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("Merchant map must be a list of rows");
  return rows.map(normalizeEntry);
}

export function findMerchant(map, domain) {
  const host = String(domain).toLowerCase().replace(/^www\./, "");
  return (
    map.find((entry) => host === entry.merchant_domain || host.endsWith(`.${entry.merchant_domain}`)) ??
    null
  );
}
