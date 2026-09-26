import { parseDocument } from "htmlparser2";

const DROP_TAGS = new Set(["script", "style", "head", "template", "noscript"]);

function hidden(node) {
  const attribs = node.attribs || {};
  if (Object.prototype.hasOwnProperty.call(attribs, "hidden")) return true;
  if (String(attribs["aria-hidden"] || "").toLowerCase() === "true") return true;
  const style = String(attribs.style || "").toLowerCase().replace(/\s/g, "");
  if (style.includes("display:none") || style.includes("visibility:hidden")) return true;
  const className = String(attribs.class || "").toLowerCase();
  if (className.split(/\s+/).includes("preheader")) return true;
  if (String(attribs.id || "").toLowerCase() === "preheader") return true;
  return false;
}

function walk(node, state) {
  if (!node || typeof node !== "object") return;
  if (node.type === "comment" || node.type === "directive") return;
  if (node.type === "text") {
    if (!state.skip) state.text.push(node.data);
    return;
  }
  const name = String(node.name || "").toLowerCase();
  if (DROP_TAGS.has(name)) return;
  const skip = state.skip || hidden(node);
  if (name === "a" && !skip) {
    const href = node.attribs?.href;
    if (href) state.links.push(href);
  }
  for (const child of node.children || []) walk(child, { ...state, skip });
}

export function visibleDocument(html) {
  const root = parseDocument(String(html ?? ""));
  const state = { text: [], links: [], skip: false };
  for (const child of root.children || []) walk(child, state);
  return {
    text: state.text.join(" ").replace(/\s+/g, " ").trim(),
    links: state.links,
  };
}
