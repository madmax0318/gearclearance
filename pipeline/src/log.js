const TOKEN_PATTERNS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g, "[REDACTED]"],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, "[REDACTED]"],
  [/\bya29\.[A-Za-z0-9_\-.]{10,}\b/g, "[REDACTED]"],
  [/1\/\/[A-Za-z0-9_\-]{8,}/g, "[REDACTED]"],
  [/\bGOCSPX-[A-Za-z0-9_\-]+/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
  [/\bAIza[0-9A-Za-z_\-]{20,}\b/g, "[REDACTED]"],
  [/\b(?:cf|CF)_[A-Za-z0-9_\-]{20,}\b/g, "[REDACTED]"],
  [/\b[A-Za-z0-9_-]{40}\b(?=[^\n]{0,40}cloudflare)/gi, "[REDACTED]"],
];

export const ERROR_CODES = {
  0: "OK",
  2: "E_CONFIG",
  3: "E_GUARD",
  4: "E_UPSTREAM",
  5: "E_BUILD",
  6: "E_PUBLISH",
};

export function redact(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function logError(code, detail, sink = console.error) {
  const name = ERROR_CODES[code] || "E_UNKNOWN";
  sink(`${name} ${redact(detail)}`);
  return name;
}

export function codedError(code, detail) {
  const error = new Error(logError(code, detail, () => {}));
  error.exitCode = code;
  error.codeName = ERROR_CODES[code] || "E_UNKNOWN";
  return error;
}
