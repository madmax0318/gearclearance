const SYSTEM_PROMPT = `You extract candidate deal rows from a sale email for The Stash Deals.
Return JSON only, shaped as {"candidates":[{...}]}.
Rules:
- Use only facts present in the email. Unknown fields are null.
- source_url must be a URL copied from the email. Do not invent URLs, prices, or merchants.
- Do not return affiliate_url. Do not add tag, MID, publisher id, website id, or tracking parameters.
- price is a number or null.
- aisle is one of guns, ammo, optics, accessories, apparel, nylon, food-storage, survival, household, gaming, drones, or null.
- needs_affiliate must be true.
- Never guess an affiliate tag.`;

export function parseModelJson(content) {
  const stripped = String(content)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Ollama returned no JSON object");
  const data = JSON.parse(stripped.slice(start, end + 1));
  const list = Array.isArray(data) ? data : data.candidates || data.deals || [data];
  if (!Array.isArray(list)) throw new Error("Ollama JSON had no candidates");
  return list;
}

export async function ollamaExtract(message, { env, fetchImpl } = {}) {
  const host = String(env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = env.OLLAMA_MODEL || "qwen3.5:35b";
  const timeout = Number(env.OLLAMA_TIMEOUT_MS || 30000);
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch is not available");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeout) ? timeout : 30000);
  try {
    const response = await fetchFn(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message.sourceText },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    const content = data?.message?.content ?? data?.response ?? "";
    return parseModelJson(content);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Ollama request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
