import { isLoopbackOllamaHost } from "./config.js";
import { codedError } from "./log.js";
import { loadSchema, validateSchema } from "./validate.js";

const INPUT_CAP = 16_000;

export function sanitizeModelInput(text) {
  const cleaned = String(text ?? "")
    .normalize("NFKC")
    .replace(/\p{Cc}|\p{Cf}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, INPUT_CAP);
  return `<source-text>\n${cleaned}\n</source-text>`;
}

export function parseModelJson(content) {
  let data;
  try {
    data = JSON.parse(String(content ?? "").trim());
  } catch {
    const error = codedError(0, "non-schema");
    error.reason = "non-schema";
    throw error;
  }
  const result = validateSchema("model-output.schema.json", data);
  if (!result.ok) {
    const error = codedError(0, "non-schema");
    error.reason = "non-schema";
    throw error;
  }
  return data.candidates || [];
}

async function readTags(host, fetchImpl) {
  const response = await fetchImpl(`${host}/api/tags`, { method: "GET" });
  if (!response?.ok) throw codedError(4, "tags");
  return response.json();
}

export async function ollamaExtract(message, { env, fetchImpl } = {}) {
  const host = String(env.OLLAMA_HOST || "");
  const model = env.OLLAMA_MODEL;
  const digest = env.OLLAMA_DIGEST;
  if (!isLoopbackOllamaHost(host) || !model || !digest) throw codedError(2, "E_CONFIG");
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") throw codedError(2, "E_CONFIG");
  const tags = await readTags(host, fetchFn);
  const found = (tags?.models || []).find((item) => item.name === model || item.model === model);
  if (!found || found.digest !== digest) throw codedError(3, "digest");
  const timeout = Number(env.OLLAMA_TIMEOUT_MS || 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeout) ? timeout : 30000);
  try {
    const response = await fetchFn(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: loadSchema("model-output.schema.json"),
        think: false,
        options: { temperature: 0 },
        messages: [
          {
            role: "system",
            content:
              "Extract candidate deals from the labeled source text. Return JSON only. Do not invent URLs, prices, or affiliate parameters. needs_affiliate stays true.",
          },
          { role: "user", content: sanitizeModelInput(message.sourceText) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw codedError(4, `HTTP ${response.status}`);
    const data = await response.json();
    const content = data?.message?.content ?? "";
    return parseModelJson(content);
  } catch (error) {
    if (error?.reason === "non-schema") throw error;
    if (error?.exitCode) throw error;
    if (error?.name === "AbortError") throw codedError(4, "timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
