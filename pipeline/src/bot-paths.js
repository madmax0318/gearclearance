import { pathToFileURL } from "node:url";

export const BOT_DEAL_PATHS = ["data/deals.json", "data/expired/deals.json"];

export const BOT_IMAGE_PATH = /^public\/images\/deals\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|webp)$/;

export function allowedBotPath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value === "data/deals.json" || value === "data/expired/deals.json") return true;
  return BOT_IMAGE_PATH.test(value);
}

function isDirect() {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(entry).href === import.meta.url;
}

if (isDirect()) {
  process.exit(allowedBotPath(process.argv[2]) ? 0 : 1);
}
