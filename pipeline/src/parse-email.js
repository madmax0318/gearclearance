import fs from "node:fs/promises";
import { screenCandidates } from "../../src/banned-brands.mjs";
import { normalizeAisle } from "./aisles.js";
import { extractUrls, inspectUrl, merchantDomain, scoreProductUrl } from "./clean-url.js";
import { ollamaExtract } from "./ollama.js";
import { assertCandidateShape, candidateRow } from "./schema.js";

const AISLE_RULES = [
  { aisle: "ammo", re: /\b(ammo|ammunition|\d+\s?gr\b|fmj|jhp|\d+\s+rounds?)\b/i },
  { aisle: "optics", re: /\b(red dots?|optics?|scopes?|riflescopes?|holographic)\b/i },
  { aisle: "guns", re: /\b(pistols?|rifles?|shotguns?|handguns?|firearms?|glock|ar-?15|carbines?)\b/i },
  { aisle: "food-storage", re: /\b(freeze[- ]dried|emergency food|food kit|food storage|#10 can)\b/i },
  { aisle: "survival", re: /\b(water filters?|ifak|first aid|fire starters?|lifestraw)\b/i },
  { aisle: "household", re: /\b(power stations?|vacuum|drills?|storage bins?|kitchen|household)\b/i },
  { aisle: "accessories", re: /\b(magazines?|slings?|holsters?|weapon lights?|bipods?|mounts?)\b/i },
  { aisle: "nylon", re: /\b(nylons?|plate carriers?|chest rigs?|gun bags?|range bags?|molle|backpacks?|rucksacks?|admin pouches?|dump pouches?|pouches?)\b/i },
  { aisle: "apparel", re: /\b(apparels?|jackets?|boots?|gloves?|baselayers?|base layers?|beanies?|workwear|hoodies?)\b/i },
];

const PRICE_PATTERNS = [
  /(?:sale price|now|only|just)\s*[:\-]?\s*\$\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/i,
  /\$\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)\s*\(\s*was\b/i,
  /\$\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/,
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseHeaders(block) {
  const unfolded = [];
  for (const line of block.split("\n")) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    else unfolded.push(line);
  }
  const headers = new Map();
  for (const line of unfolded) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) headers.set(match[1].toLowerCase(), match[2].trim());
  }
  return headers;
}

function decodeQuotedPrintable(input) {
  const soft = String(input).replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < soft.length; i += 1) {
    if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = soft.charCodeAt(i);
      bytes.push(code <= 0xff ? code : 0x3f);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeBody(body, encoding) {
  const trimmed = String(body).replace(/\s+$/g, "");
  const mode = String(encoding || "").toLowerCase();
  if (mode.includes("quoted-printable")) return decodeQuotedPrintable(trimmed);
  if (mode.includes("base64")) return Buffer.from(trimmed.replace(/\s/g, ""), "base64").toString("utf8");
  return trimmed;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractText(headers, body) {
  const contentType = headers.get("content-type") || "text/plain";
  if (!/multipart\//i.test(contentType)) {
    return decodeBody(body, headers.get("content-transfer-encoding"));
  }
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) return decodeBody(body, headers.get("content-transfer-encoding"));
  const parts = body.split(new RegExp(`--${escapeRegExp(boundary)}`));
  let plain = null;
  for (const part of parts) {
    const chunk = part.replace(/^\n/, "");
    if (!chunk.trim() || chunk.trim() === "--") continue;
    const splitAt = chunk.indexOf("\n\n");
    if (splitAt === -1) continue;
    const partHeaders = parseHeaders(chunk.slice(0, splitAt));
    const partBody = chunk.slice(splitAt + 2).replace(/\n--$/, "");
    const partType = partHeaders.get("content-type") || "";
    if (/text\/plain/i.test(partType) && plain == null) {
      plain = decodeBody(partBody, partHeaders.get("content-transfer-encoding"));
    }
  }
  return plain ?? "";
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function decodeMessage(raw) {
  const text = String(raw).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const splitAt = text.indexOf("\n\n");
  if (splitAt !== -1) {
    const headers = parseHeaders(text.slice(0, splitAt));
    if (headers.has("subject") || headers.has("from") || headers.has("content-type") || headers.has("date")) {
      const body = extractText(headers, text.slice(splitAt + 2));
      const raw_subject = headers.get("subject") ?? null;
      const raw_from = headers.get("from") ?? null;
      return {
        headers,
        body,
        raw_subject,
        raw_from,
        received_at: toIso(headers.get("date")),
        sourceText: [raw_subject, raw_from, body].filter(Boolean).join("\n"),
      };
    }
  }
  return {
    headers: new Map(),
    body: text,
    raw_subject: null,
    raw_from: null,
    received_at: null,
    sourceText: text,
  };
}

function extractPrice(text) {
  for (const pattern of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return round2(Number(match[1].replace(/,/g, "")));
  }
  return null;
}

function detectAisle(text) {
  for (const rule of AISLE_RULES) {
    if (rule.re.test(text)) return rule.aisle;
  }
  return null;
}

function titleFromSubject(subject) {
  if (!subject) return null;
  return subject
    .replace(/^(?:fwd?|re|fw)\s*:\s*/i, "")
    .replace(/^(?:clearance|deal|sale)\s*:\s*/i, "")
    .trim();
}

function titleFromBody(body) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const priceIndex = lines.findIndex((line) => /\$\s?\d/.test(line));
  if (priceIndex > 0 && !/^https?:/i.test(lines[priceIndex - 1])) return lines[priceIndex - 1];
  return lines.find((line) => !/^https?:/i.test(line) && /[A-Za-z]/.test(line) && line.length > 12) ?? null;
}

function heuristicConfidence(row) {
  let score = 0.1;
  if (row.source_url) score += 0.3;
  if (row.price != null) score += 0.2;
  if (row.title) score += 0.15;
  if (row.merchant_domain) score += 0.1;
  if (row.aisle) score += 0.1;
  if (row.raw_subject && row.raw_from && row.received_at) score += 0.05;
  return Math.min(0.9, round2(score));
}

function productUrls(text) {
  const inspected = [];
  for (const raw of extractUrls(text)) {
    const details = inspectUrl(raw);
    if (!details) continue;
    inspected.push(details);
  }
  const unique = [];
  for (const details of inspected) {
    if (!unique.some((item) => item.url === details.url)) unique.push(details);
  }
  unique.sort((a, b) => scoreProductUrl(b.url) - scoreProductUrl(a.url));
  return unique.filter((item) => scoreProductUrl(item.url) > 0);
}

function buildHeuristicCandidates(message) {
  const urls = productUrls(message.body);
  const seeds = urls.length ? urls : [null];
  const haystack = `${message.raw_subject ?? ""}\n${message.body}`;
  return seeds.map((details) => {
    const notes = ["Heuristic extract from the message text."];
    if (!message.raw_subject && !message.raw_from) notes.push("Plain text had no RFC 5322 headers.");
    if (details?.stripped.length) {
      notes.push(
        details.strippedAffiliate
          ? "Stripped foreign affiliate or tracker parameters. No affiliate tag was added."
          : "Stripped tracker parameters. No affiliate tag was added.",
      );
    } else {
      notes.push("No affiliate tag was added.");
    }
    notes.push("needs_affiliate stays true until Wrap finds a live map row and a publisher id in the environment.");
    const row = candidateRow({
      source_url: details?.url ?? null,
      title: titleFromSubject(message.raw_subject) ?? titleFromBody(message.body),
      price: extractPrice(haystack),
      merchant_domain: details ? merchantDomain(details.url) : null,
      aisle: detectAisle(haystack),
      raw_subject: message.raw_subject,
      raw_from: message.raw_from,
      received_at: message.received_at,
      needs_affiliate: true,
      notes: notes.join(" "),
    });
    row.confidence = heuristicConfidence(row);
    return assertCandidateShape(row);
  });
}

function priceGrounded(price, sourceText) {
  if (price == null) return false;
  const body = sourceText.replace(/,/g, "");
  const fixed = price.toFixed(2);
  const asInt = String(Math.trunc(price));
  return body.includes(fixed) || body.includes(String(price)) || (price === Number(asInt) && body.includes(asInt));
}

function titleGrounded(title, sourceText) {
  if (!title || typeof title !== "string") return false;
  const words = title.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  if (words.length === 0) return false;
  const hay = sourceText.toLowerCase();
  const hits = words.filter((word) => hay.includes(word));
  return hits.length / words.length >= 0.6;
}

function urlGrounded(url, sourceText) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const hay = sourceText.toLowerCase();
    if (!hay.includes(host)) return false;
    return parsed.pathname === "/" || sourceText.includes(decodeURIComponent(parsed.pathname));
  } catch {
    return false;
  }
}

function coercePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) return round2(value);
  if (value == null || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return match ? round2(Number(match[1])) : null;
}

function groundCandidates(modeled, message, heuristic) {
  const grounded = [];
  for (const item of modeled) {
    if (!item || typeof item !== "object") continue;
    const details = item.source_url ? inspectUrl(String(item.source_url)) : null;
    if (!details || !urlGrounded(details.url, message.sourceText)) continue;
    const fallback = heuristic.find((row) => row.source_url === details.url) ?? heuristic[0];
    const modelPrice = coercePrice(item.price);
    const price = priceGrounded(modelPrice, message.sourceText) ? modelPrice : fallback?.price ?? null;
    const modelTitle = typeof item.title === "string" ? item.title.trim() : "";
    const title = titleGrounded(modelTitle, message.sourceText) ? modelTitle : fallback?.title ?? null;
    const heuristicAisle = fallback?.aisle ?? detectAisle(message.sourceText);
    const modelAisle = normalizeAisle(item.aisle);
    const aisle = modelAisle && (modelAisle === heuristicAisle || heuristicAisle == null) ? modelAisle : heuristicAisle;
    const notes = [
      "Ollama extract grounded against the message. Affiliate fields from the model were ignored.",
      details.strippedAffiliate
        ? "Stripped foreign affiliate or tracker parameters. No affiliate tag was added."
        : "No affiliate tag was added.",
    ];
    if (item.affiliate_url) notes.push("Ignored affiliate_url returned by the model.");
    if (item.needs_affiliate === false) notes.push("Ignored needs_affiliate=false returned by the model.");
    const row = candidateRow({
      source_url: details.url,
      title,
      price,
      merchant_domain: merchantDomain(details.url),
      aisle,
      raw_subject: message.raw_subject,
      raw_from: message.raw_from,
      received_at: message.received_at,
      needs_affiliate: true,
      notes: notes.join(" "),
    });
    const modelConfidence = Number(item.confidence);
    row.confidence = Number.isFinite(modelConfidence)
      ? Math.min(0.9, Math.max(0, round2(modelConfidence)))
      : heuristicConfidence(row);
    grounded.push(assertCandidateShape(row));
  }
  return grounded;
}

function withOllamaNote(candidates, sentence) {
  return candidates.map((row) => assertCandidateShape({ ...row, notes: `${row.notes} ${sentence}` }));
}

function deliver(result, options, message) {
  const screened = screenCandidates(result.candidates, {
    log: options.log,
    blocklist: options.blocklist,
    file: options.blocklistFile,
    extraText: message?.sourceText ?? "",
  });
  return { ...result, candidates: screened.candidates, rejected: screened.rejected };
}

export async function parseEmail(raw, options = {}) {
  const env = options.env ?? process.env;
  const message = decodeMessage(raw);
  const heuristic = buildHeuristicCandidates(message);
  const useOllama = options.useOllama === true || String(env.USE_OLLAMA) === "1";
  if (!useOllama) {
    return deliver(
      {
        extractor: "heuristic",
        ollama: { attempted: false, used: false, reason: "USE_OLLAMA is not 1" },
        candidates: heuristic,
      },
      options,
      message,
    );
  }
  try {
    const modeled = await ollamaExtract(message, { env, fetchImpl: options.fetchImpl });
    const grounded = groundCandidates(modeled, message, heuristic);
    if (grounded.length === 0) {
      return deliver(
        {
          extractor: "heuristic",
          ollama: { attempted: true, used: false, reason: "Ollama output was not grounded in the message" },
          candidates: withOllamaNote(
            heuristic,
            "Ollama output discarded because it was not grounded in the message. No affiliate tag was added.",
          ),
        },
        options,
        message,
      );
    }
    return deliver(
      {
        extractor: "ollama",
        ollama: {
          attempted: true,
          used: true,
          host: env.OLLAMA_HOST,
          model: env.OLLAMA_MODEL,
        },
        candidates: grounded,
      },
      options,
      message,
    );
  } catch (error) {
    if (error?.exitCode === 2 || error?.exitCode === 3) throw error;
    const messageText = error?.reason === "non-schema" ? "non-schema" : error?.message || "request failed";
    return deliver(
      {
        extractor: "heuristic",
        ollama: { attempted: true, used: false, error: messageText },
        candidates: withOllamaNote(
          heuristic,
          `Ollama was unavailable (${messageText}). Heuristic extract kept. No affiliate tag was added.`,
        ),
      },
      options,
      message,
    );
  }
}

export async function parseEmailFile(file, options = {}) {
  const raw = await fs.readFile(file, "utf8");
  return parseEmail(raw, options);
}
