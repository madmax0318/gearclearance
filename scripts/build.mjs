import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeQueue, publishedDeals, SLUG_RE } from "../src/expired-reports.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const SITE_NAME = "The Stash Deals";
const TAGLINE = "Grow your stash without shrinking your wallet.";
const SITE = "https://thestash.deals";

const CATEGORIES = [
  {
    id: "guns",
    slug: "guns",
    name: "Guns",
    h1: "Gun deals",
    eyebrow: "Guns",
    description:
      "Gun deals with merchant, was/now price, and why the markdown is listed. The Stash Deals only links out — we are not the seller and we are not an FFL.",
  },
  {
    id: "ammo",
    slug: "ammo",
    name: "Ammo",
    h1: "Ammo deals",
    eyebrow: "Ammo",
    description:
      "Ammunition markdowns with round count in the title, a percent-off badge, and a short note on why the price is worth a look.",
  },
  {
    id: "optics",
    slug: "optics",
    name: "Optics",
    h1: "Optics deals",
    eyebrow: "Optics",
    description:
      "Red dot and riflescope deals. Each card shows the merchant, the previous price, and any condition or source tags.",
  },
  {
    id: "accessories",
    slug: "accessories",
    name: "Accessories",
    h1: "Accessory deals",
    eyebrow: "Accessories",
    description:
      "Deals on magazines, lights, and slings, with pack versus single pricing called out in the title.",
  },
  {
    id: "apparel",
    slug: "apparel",
    name: "Apparel",
    h1: "Apparel deals",
    eyebrow: "Apparel",
    description:
      "Jackets, boots, gloves, baselayers, and hats. Each card shows the merchant, the previous price, and why the markdown is listed.",
  },
  {
    id: "food-storage",
    slug: "food-storage",
    name: "Food storage",
    h1: "Food storage deals",
    eyebrow: "Food storage",
    description:
      "Clearance prices on freeze-dried food and pantry supplies for longer-term storage.",
  },
  {
    id: "survival",
    slug: "survival",
    name: "Survival",
    h1: "Survival deals",
    eyebrow: "Survival",
    description:
      "Deals on water, shelter, and a compact medical kit, with the old price beside the sale price.",
  },
  {
    id: "household",
    slug: "household",
    name: "Household goods",
    h1: "Household goods deals",
    eyebrow: "Household goods",
    description:
      "Household clearance: portable power and a basic drill kit, using the same card layout as the gear aisles.",
  },
  {
    id: "gaming",
    slug: "gaming",
    name: "Gaming",
    h1: "Gaming deals",
    eyebrow: "Gaming",
    description:
      "Markdowns on handhelds and mice. Same card layout as the other aisles, including any condition tags.",
  },
  {
    id: "drones",
    slug: "drones",
    name: "Drones",
    h1: "Drone deals",
    eyebrow: "Drones",
    description:
      "Drone deals with merchant, was/now price, and a short note on why the markdown is listed.",
  },
];

const HOME = {
  id: "home",
  h1: "Latest deals",
  eyebrow: "Latest across every aisle",
  title: "Latest deals | The Stash Deals",
  description:
    "Grow your stash without shrinking your wallet. Deals on guns, ammo, optics, accessories, apparel, food storage, survival, household goods, gaming, and drones.",
  lede: "Grow your stash without shrinking your wallet. Newest deals across guns, ammo, optics, accessories, apparel, food storage, survival, household goods, gaming, and drones. Open a category to narrow the board.",
};

const CURATED = {
  id: "curated",
  slug: "curated",
  h1: "Curated picks",
  eyebrow: "Hand-picked tips",
  title: "Curated picks | The Stash Deals",
  description:
    "A short rail of hand-picked deals. This curated section is an editorial placeholder, not an automated ranking.",
  lede: "Deals a person flagged as worth a second look. This rail is a placeholder for editorial tips — nothing here is ranked by a formula.",
};

const DEAL_TAGS = [
  { id: "used", label: "Used" },
  { id: "police-trade-in", label: "Police trade-in" },
];

const TAG_LABEL = Object.fromEntries(DEAL_TAGS.map((tag) => [tag.id, tag.label]));

const DISCLOSURE =
  "The Stash Deals is an affiliate deal aggregator. If you buy through a link on this site, we may earn a commission at no extra cost to you. We do not sell these products, we do not take payment, and we are not a federal firearms licensee (FFL). Every offer is an outbound link to another merchant. Prices, shipping, and availability can change — the merchant page is the offer that matters.";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// _headers caches /css/* and /js/* for a day, and HTML always revalidates, so an unfingerprinted
// stylesheet lets a fresh page load against a stale cached one. Content hashes keep the pair honest.
const CSS_SRC = path.join(rootDir, "src", "site.css");
const JS_SRC = path.join(rootDir, "src", "nav.js");

function fingerprint(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
}

const CSS_PATH = `css/site.${fingerprint(CSS_SRC)}.css`;
const JS_PATH = `js/nav.${fingerprint(JS_SRC)}.js`;

// Master poster art. Stays in the repo as the source for the derived assets below; too tall and
// too heavy to ship or to sit in nav chrome.
const LOGO = "brand/stash-deals-logo.jpg";
// Square crop of the poster emblem, sized for the sidebar lockup at up to 3x.
const EMBLEM = "brand/stash-deals-emblem.jpg";
const EMBLEM_PX = 320;
const OG_IMAGE = "brand/stash-deals-og.jpg";
const APPLE_ICON = "brand/apple-touch-icon.png";
const OG_ALT = `${SITE_NAME} — ${TAGLINE}`;
// Crate mark for the places the illustration is too small to read: mobile topbar and favicon.
// Drawn from the poster's ammo crates, so it is brand art rather than a generic placeholder.
const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M2.5 8.5h27v4.2h-27z" fill="currentColor"/><rect x="4.2" y="12.7" width="23.6" height="12.8" rx="1.6" fill="#3d4a32" stroke="currentColor" stroke-width="1.8"/><rect x="11.6" y="16.4" width="8.8" height="5.4" rx="1" fill="#d4a017"/></svg>`;

const EXT = `<svg class="ext" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.2 3.2h5.1v1.4H4.6v6.8h6.8V7.7h1.4v5.1H3.2V3.2z"/><path fill="currentColor" d="M8.2 2.4h5.4V7.8h-1.4V4.8L7.4 9.6 6.4 8.6l4.8-4.8H8.2V2.4z"/></svg>`;
const THUMB_MARK = `<svg class="thumb-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M2.5 8.5h27v4.2h-27z" fill="currentColor"/><rect x="4.2" y="12.7" width="23.6" height="12.8" rx="1.6" fill="#3d4a32" stroke="currentColor" stroke-width="1.8"/><rect x="11.6" y="16.4" width="8.8" height="5.4" rx="1" fill="#d4a017"/></svg>`;
const IMAGE_RE = /^images\/deals\/[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|jpeg|png|webp)$/;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function money(amount) {
  return usd.format(amount);
}

function percentOff(now, was) {
  return Math.round((1 - now / was) * 100);
}

function hasListedPrice(deal) {
  return typeof deal.price_now === "number" && typeof deal.price_was === "number";
}

function trackingParam(key, value) {
  const name = String(key).toLowerCase();
  const val = String(value).toLowerCase();
  if (name === "tag" || name === "linkid" || name === "link_id") return true;
  if (name.startsWith("utm_")) return true;
  if ((name === "ref_" || name === "ref") && val.startsWith("as_li")) return true;
  return false;
}

function formatDate(iso) {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

function plusDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clip(text, max = 160) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function href(depth, target) {
  const prefix = "../".repeat(depth);
  if (!target) return prefix || "./";
  return `${prefix}${target}`;
}

function categoryById(id) {
  return CATEGORIES.find((category) => category.id === id);
}

function byNewest(a, b) {
  return b.posted.localeCompare(a.posted) || a.title.localeCompare(b.title);
}

function loadDeals() {
  const file = path.join(rootDir, "data", "deals.json");
  const deals = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(deals)) throw new Error("data/deals.json must be an array");
  const slugs = new Set();
  for (const deal of deals) {
    for (const key of ["slug", "title", "merchant", "why", "url", "category", "posted"]) {
      if (deal[key] === undefined || deal[key] === "") throw new Error(`Missing ${key} on a deal`);
    }
    if (!SLUG_RE.test(deal.slug)) throw new Error(`Bad slug: ${deal.slug}`);
    if (deal.status !== undefined && deal.status !== "live" && deal.status !== "expired") {
      throw new Error(`Bad status on ${deal.slug}`);
    }
    if (slugs.has(deal.slug)) throw new Error(`Duplicate slug: ${deal.slug}`);
    slugs.add(deal.slug);
    if (!categoryById(deal.category)) throw new Error(`Unknown category ${deal.category}`);
    const priceMissing = deal.price_now == null && deal.price_was == null;
    if (!priceMissing && !hasListedPrice(deal)) {
      throw new Error(`Prices must be numbers or both null on ${deal.slug}`);
    }
    if (hasListedPrice(deal) && !(deal.price_was > deal.price_now && deal.price_now > 0)) {
      throw new Error(`Price must drop on ${deal.slug}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deal.posted) || Number.isNaN(Date.parse(`${deal.posted}T00:00:00Z`))) {
      throw new Error(`Bad posted date on ${deal.slug}`);
    }
    let parsed;
    try {
      parsed = new URL(deal.url);
    } catch {
      throw new Error(`Bad url on ${deal.slug}`);
    }
    if (parsed.protocol !== "https:") throw new Error(`URL must be https on ${deal.slug}`);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (trackingParam(key, value)) {
        throw new Error(`Tracking param ${key} on ${deal.slug}`);
      }
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com") || host === "gearclearance.mcdaniel.fyi") {
      throw new Error(`Deal URL must be a real merchant page on ${deal.slug}`);
    }
    if (typeof deal.curated !== "boolean") throw new Error(`curated must be boolean on ${deal.slug}`);
    if (deal.tags !== undefined) {
      if (!Array.isArray(deal.tags)) throw new Error(`tags must be an array on ${deal.slug}`);
      const seen = new Set();
      for (const tag of deal.tags) {
        if (!TAG_LABEL[tag]) throw new Error(`Unknown tag ${tag} on ${deal.slug}`);
        if (seen.has(tag)) throw new Error(`Duplicate tag ${tag} on ${deal.slug}`);
        seen.add(tag);
      }
    }
    if (deal.image != null && deal.image !== "") {
      if (typeof deal.image !== "string" || !IMAGE_RE.test(deal.image)) {
        throw new Error(`Image must be a local images/deals file on ${deal.slug}`);
      }
      if (path.basename(deal.image, path.extname(deal.image)) !== deal.slug) {
        throw new Error(`Image filename must match the slug on ${deal.slug}`);
      }
      const imageFile = path.join(rootDir, "public", deal.image);
      if (!fs.existsSync(imageFile)) throw new Error(`Missing image file for ${deal.slug}`);
      const bytes = fs.statSync(imageFile).size;
      if (bytes < 800 || bytes > 400_000) {
        throw new Error(`Image for ${deal.slug} must be between 800 bytes and 400KB`);
      }
    }
  }
  const live = publishedDeals(deals);
  if (live.length < 12 || live.length > 90) {
    throw new Error(`Expected 12–90 live deals, found ${live.length}`);
  }
  for (const category of CATEGORIES) {
    if (!live.some((deal) => deal.category === category.id)) {
      throw new Error(`No deals in ${category.id}`);
    }
  }
  for (const tag of DEAL_TAGS) {
    if (!live.some((deal) => dealTags(deal).includes(tag.id))) {
      throw new Error(`No sample deal tagged ${tag.id}`);
    }
  }
  return live.sort(byNewest);
}

function loadArchive(liveSlugs) {
  const file = path.join(rootDir, "data", "expired", "deals.json");
  if (!fs.existsSync(file)) return [];
  const deals = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(deals)) throw new Error("data/expired/deals.json must be an array");
  const slugs = new Set();
  for (const deal of deals) {
    if (!deal || typeof deal !== "object") throw new Error("Archive deal must be an object");
    if (!SLUG_RE.test(deal.slug || "")) throw new Error(`Bad archive slug: ${deal.slug}`);
    if (slugs.has(deal.slug) || liveSlugs.has(deal.slug)) throw new Error(`Duplicate slug: ${deal.slug}`);
    slugs.add(deal.slug);
    if (deal.status !== "expired") throw new Error(`Archive deal ${deal.slug} must have status expired`);
    if (!deal.title || !deal.merchant) throw new Error(`Archive deal ${deal.slug} is missing a title or merchant`);
    if (deal.category && !categoryById(deal.category)) throw new Error(`Unknown category ${deal.category} on ${deal.slug}`);
    if (deal.expired_by !== undefined && !["admin", "ion-cannon", "reports"].includes(deal.expired_by)) {
      throw new Error(`Bad expired_by on ${deal.slug}`);
    }
    let parsed;
    try {
      parsed = new URL(deal.url);
    } catch {
      throw new Error(`Bad url on ${deal.slug}`);
    }
    if (parsed.protocol !== "https:") throw new Error(`URL must be https on ${deal.slug}`);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (trackingParam(key, value)) throw new Error(`Tracking param ${key} on ${deal.slug}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com") || host === "gearclearance.mcdaniel.fyi") {
      throw new Error(`Deal URL must be a real merchant page on ${deal.slug}`);
    }
  }
  return deals;
}

function loadReportQueue() {
  const file = path.join(rootDir, "data", "expired-reports.json");
  return normalizeQueue(JSON.parse(fs.readFileSync(file, "utf8")));
}

function dealTags(deal) {
  return Array.isArray(deal.tags) ? deal.tags : [];
}

function renderTagBadges(deal) {
  const tags = dealTags(deal);
  if (!tags.length) return "";
  const items = tags
    .map((id) => `<li><span class="tag">${esc(TAG_LABEL[id])}</span></li>`)
    .join("");
  return `<ul class="deal-tags">${items}</ul>`;
}

function renderTagFilters(deals) {
  const present = DEAL_TAGS.filter((tag) => deals.some((deal) => dealTags(deal).includes(tag.id)));
  if (!present.length) return "";
  const chips = present
    .map((tag) => {
      const count = deals.filter((deal) => dealTags(deal).includes(tag.id)).length;
      return `<button type="button" class="tag-chip" data-tag="${esc(tag.id)}" aria-pressed="false"><span class="tag-chip-label">${esc(tag.label)}</span><span class="count">${count}</span></button>`;
    })
    .join("\n");
  return `<div class="tag-filters" role="group" aria-label="Filter by condition or source">
  <button type="button" class="tag-chip is-on" data-tag="" aria-pressed="true"><span class="tag-chip-label">All</span><span class="count">${deals.length}</span></button>
  ${chips}
</div>`;
}

function renderPriceRow(deal) {
  if (!hasListedPrice(deal)) {
    return `<div class="price-row">
    <p class="now is-unpriced"><span class="sr-only">Price </span>Sale page</p>
  </div>`;
  }
  const pct = percentOff(deal.price_now, deal.price_was);
  return `<div class="price-row">
    <p class="now"><span class="sr-only">Price now </span>${esc(money(deal.price_now))}</p>
    <p class="was"><span class="sr-only">Was </span><s>${esc(money(deal.price_was))}</s></p>
    <p class="off">${pct}% off</p>
  </div>`;
}

function hasImage(deal) {
  return typeof deal.image === "string" && deal.image !== "";
}

function renderThumb(deal, depth, { linked = true } = {}) {
  if (!hasImage(deal)) {
    return `<div class="thumb thumb-empty">${THUMB_MARK}<span class="thumb-label">No photo</span></div>`;
  }
  const img = `<img src="${esc(href(depth, deal.image))}" alt="${linked ? "" : esc(`Product photo of ${deal.title}`)}" width="720" height="540" loading="${linked ? "lazy" : "eager"}" decoding="async">`;
  if (!linked) return `<div class="thumb">${img}</div>`;
  // The title link is the accessible name. This repeat is pointer-only.
  return `<a class="thumb" href="${href(depth, `deals/${deal.slug}/`)}" tabindex="-1" aria-hidden="true">${img}</a>`;
}

function renderReportControl(deal) {
  return `<p class="report-row"><button type="button" class="report-expired" data-slug="${esc(deal.slug)}">Report expired<span class="sr-only">: ${esc(deal.title)}</span></button></p>`;
}

function renderCard(deal, depth, heading) {
  const category = categoryById(deal.category);
  const tag = heading === "h3" ? "h3" : "h2";
  const tags = dealTags(deal).join(" ");
  return `<article class="card" data-tags="${esc(tags)}">
  ${renderThumb(deal, depth)}
  <div class="card-body">
  <div class="card-top">
    <a class="cat-link" href="${href(depth, `${category.slug}/`)}">${esc(category.name)}</a>
    ${deal.curated ? '<span class="pill">Curated</span>' : ""}
  </div>
  ${renderTagBadges(deal)}
  <${tag} class="card-title"><a href="${href(depth, `deals/${deal.slug}/`)}">${esc(deal.title)}</a></${tag}>
  <p class="merchant">${esc(deal.merchant)} · <time datetime="${esc(deal.posted)}">Listed ${esc(formatDate(deal.posted))}</time></p>
  ${renderPriceRow(deal)}
  <p class="why">${esc(deal.why)}</p>
  <a class="cta" href="${esc(deal.url)}" target="_blank" rel="sponsored noopener noreferrer">View deal<span class="sr-only"> at ${esc(deal.merchant)} (opens a new tab)</span>${EXT}</a>
  ${renderReportControl(deal)}
  </div>
</article>`;
}

function renderSidebar(activeId, depth, deals) {
  const homeCount = deals.length;
  const curatedCount = deals.filter((deal) => deal.curated).length;
  const links = [
    { id: "home", href: href(depth, ""), label: "Home", count: homeCount },
    ...CATEGORIES.map((category) => ({
      id: category.id,
      href: href(depth, `${category.slug}/`),
      label: category.name,
      count: deals.filter((deal) => deal.category === category.id).length,
    })),
  ];
  const items = links
    .map((link) => {
      const current = link.id === activeId ? ' aria-current="page"' : "";
      return `<a class="nav-link" href="${link.href}"${current}><span>${esc(link.label)}</span><span class="count">${link.count}</span></a>`;
    })
    .join("\n");
  const curatedCurrent = activeId === "curated" ? ' aria-current="page"' : "";
  return `<aside id="sidebar" class="sidebar">
  <a class="brand" href="${href(depth, "")}">
    <img class="brand-emblem" src="${href(depth, EMBLEM)}" width="${EMBLEM_PX}" height="${EMBLEM_PX}" alt="" decoding="async">
    <span class="brand-text">
      <span class="wordmark">${SITE_NAME}</span>
      <span class="brand-tag">${esc(TAGLINE)}</span>
    </span>
  </a>
  <nav class="nav-list" aria-label="Categories">
    ${items}
  </nav>
  <div class="rail">
    <p class="rail-kicker">Editor's rail</p>
    <a class="nav-link" href="${href(depth, "curated/")}"${curatedCurrent}><span class="pill">Curated</span><span class="count">${curatedCount}</span></a>
    <p class="rail-note">Hand-picked tips. Placeholder for notes a person would add later.</p>
  </div>
</aside>`;
}

function renderChrome({ depth, activeId, deals, main }) {
  return `<div class="app">
  <header class="topbar">
    <label class="menu-btn" for="nav-toggle"><span class="menu-bars" aria-hidden="true"></span>Menu</label>
    <a class="topbar-mark" href="${href(depth, "")}">${MARK}<span class="wordmark">${SITE_NAME}</span></a>
  </header>
  <label class="backdrop" for="nav-toggle"><span class="sr-only">Close menu</span></label>
  ${renderSidebar(activeId, depth, deals)}
  <div class="main-col">
    <main id="content">${main}</main>
    <footer class="site-footer">
      <div class="wrap">
        <p class="disclosure"><strong>Affiliate disclosure.</strong> ${esc(DISCLOSURE)}</p>
        <p class="legal">© 2026 ${SITE_NAME}. Confirm prices on the merchant site.</p>
      </div>
    </footer>
  </div>
  <p class="report-hp" aria-hidden="true"><label>Company <input type="text" name="company" tabindex="-1" autocomplete="off" value=""></label></p>
  <div class="toast" role="status" aria-live="polite" hidden></div>
</div>`;
}

// Impact.com Universal Tracking Tag (account snippet P-A7822267). Permanent, every page.
const IMPACT_UTT = `<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7822267-c904-4255-a7d2-efe7698726ea1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');</script>`;

// TEMP AvantLink ownership verify for application_id=1655829. Homepage only.
// Strip path: delete this constant, stop passing avantlinkVerify, and restore the
// build assertion that rejects classic.avantlink.com / "TEMP AvantLink" / app id
// 1655057 on every page. Do that after verify succeeds at:
// https://classic.avantlink.com/affiliate_app_confirm.php?mode=verify-js&application_id=1655829
const AVANTLINK_OWNERSHIP_VERIFY = `<!-- TEMP AvantLink ownership verify app 1655829 — delete after successful verify -->
<script type="text/javascript" src="https://classic.avantlink.com/affiliate_app_confirm.php?mode=js&authResponse=45db105505328ea31ad0aa12912acddeab0fe924"></script>`;

function pageShell({ title, description, canonical, robots = "index, follow", ogType = "website", depth, json, body, avantlinkVerify = false }) {
  const blocks = json
    ? `\n<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@graph": json })}</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta name="robots" content="${esc(robots)}">
<meta name="theme-color" content="#0f1410">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ""}
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:image" content="${SITE}/${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
${canonical ? `<meta name="twitter:url" content="${esc(canonical)}">` : ""}
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/${OG_IMAGE}">
<meta name="twitter:image:alt" content="${esc(OG_ALT)}">
<link rel="icon" href="${href(depth, "favicon.svg")}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${href(depth, APPLE_ICON)}">
<link rel="stylesheet" href="${href(depth, CSS_PATH)}">${blocks}
</head>
<body>
<a class="skip" href="#content">Skip to deals</a>
<input class="nav-toggle" id="nav-toggle" type="checkbox">
${body}
<script src="${href(depth, JS_PATH)}"></script>
${IMPACT_UTT}${avantlinkVerify ? `\n${AVANTLINK_OWNERSHIP_VERIFY}` : ""}
</body>
</html>
`;
}

function organizationNode() {
  return {
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: SITE_NAME,
    url: `${SITE}/`,
    slogan: TAGLINE,
    description: TAGLINE,
    logo: {
      "@type": "ImageObject",
      url: `${SITE}/${EMBLEM}`,
      width: EMBLEM_PX,
      height: EMBLEM_PX,
    },
    image: `${SITE}/${OG_IMAGE}`,
  };
}

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": `${SITE}/#website`,
    name: SITE_NAME,
    url: `${SITE}/`,
    description: HOME.description,
    publisher: { "@id": `${SITE}/#organization` },
  };
}

function breadcrumbNode(crumbs) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

function itemListNode(deals) {
  return {
    "@type": "ItemList",
    itemListElement: deals.map((deal, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: deal.title,
      url: `${SITE}/deals/${deal.slug}/`,
    })),
  };
}

function listingPage({ activeId, depth, canonicalPath, title, description, h1, eyebrow, lede, deals, allDeals, tagFilters = false }) {
  const cards = deals.map((deal) => renderCard(deal, depth, "h2")).join("\n");
  const noun = deals.length === 1 ? "deal" : "deals";
  const filters = tagFilters ? renderTagFilters(deals) : "";
  const main = `
<div class="wrap">
  <header class="page-head">
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h1>${esc(h1)}</h1>
    <p class="lede">${esc(lede)}</p>
    <p class="result-count" data-total="${deals.length}">${deals.length} ${noun} · newest first</p>
    ${filters}
  </header>
  ${
    deals.length
      ? `<section class="deal-grid" data-filterable="true" aria-label="Deals">\n${cards}\n</section>`
      : `<p class="empty">No deals in this aisle yet.</p>`
  }
</div>`;
  const crumbs =
    activeId === "home"
      ? []
      : [
          { name: "Home", url: `${SITE}/` },
          { name: h1, url: `${SITE}${canonicalPath}` },
        ];
  const graph = [
    organizationNode(),
    websiteNode(),
    {
      "@type": "CollectionPage",
      "@id": `${SITE}${canonicalPath}#page`,
      url: `${SITE}${canonicalPath}`,
      name: h1,
      description,
      isPartOf: { "@id": `${SITE}/#website` },
      mainEntity: itemListNode(deals),
    },
  ];
  if (crumbs.length) graph.push(breadcrumbNode(crumbs));
  return pageShell({
    title,
    description,
    canonical: `${SITE}${canonicalPath}`,
    depth,
    json: graph,
    avantlinkVerify: canonicalPath === "/",
    body: renderChrome({ depth, activeId, deals: allDeals, main }),
  });
}

function dealPage(deal, allDeals) {
  const category = categoryById(deal.category);
  const depth = 2;
  const canonical = `${SITE}/deals/${deal.slug}/`;
  const listed = hasListedPrice(deal);
  const pct = listed ? percentOff(deal.price_now, deal.price_was) : null;
  const description = clip(
    listed
      ? `${deal.title} is ${money(deal.price_now)} at ${deal.merchant} (was ${money(deal.price_was)}, ${pct}% off). ${deal.why}`
      : `${deal.title} is a sale page at ${deal.merchant}. ${deal.why}`,
  );
  const title = listed
    ? `${deal.title} — ${money(deal.price_now)} | ${SITE_NAME}`
    : `${deal.title} | ${SITE_NAME}`;
  const related = allDeals.filter((item) => item.category === deal.category && item.slug !== deal.slug).slice(0, 3);
  const ffl =
    deal.category === "guns"
      ? `<p class="fine-note">${SITE_NAME} does not sell this firearm and is not an FFL. Checkout and any transfer happen at the merchant.</p>`
      : "";
  const relatedHtml = related.length
    ? `<section class="related" aria-labelledby="related-heading">
  <h2 id="related-heading">More ${esc(category.name.toLowerCase())} deals</h2>
  <div class="deal-grid">
    ${related.map((item) => renderCard(item, depth, "h3")).join("\n")}
  </div>
</section>`
    : "";
  const main = `
<div class="wrap">
  <nav aria-label="Breadcrumb">
    <ol class="crumbs">
      <li><a href="${href(depth, "")}">Home</a></li>
      <li><a href="${href(depth, `${category.slug}/`)}">${esc(category.name)}</a></li>
      <li>${esc(deal.title)}</li>
    </ol>
  </nav>
  <article class="deal-hero">
    <div class="deal-copy">
      ${renderThumb(deal, depth, { linked: false })}
      <p class="eyebrow">${esc(category.name)}${deal.curated ? " · Curated" : ""}</p>
      ${renderTagBadges(deal)}
      <h1>${esc(deal.title)}</h1>
      <p class="why">${esc(deal.why)}</p>
    </div>
    <div class="buy-box">
      <p class="merchant">${esc(deal.merchant)} · <time datetime="${esc(deal.posted)}">Listed ${esc(formatDate(deal.posted))}</time></p>
      ${renderPriceRow(deal)}
      <a class="cta" href="${esc(deal.url)}" target="_blank" rel="sponsored noopener noreferrer">View deal<span class="sr-only"> at ${esc(deal.merchant)} (opens a new tab)</span>${EXT}</a>
      <p class="fine-note">Confirm the price on the merchant site. The button leaves ${SITE_NAME}.</p>
      ${ffl}
      ${renderReportControl(deal)}
    </div>
  </article>
  ${relatedHtml}
</div>`;
  const graph = [
    organizationNode(),
    websiteNode(),
    {
      "@type": "Product",
      "@id": `${canonical}#product`,
      name: deal.title,
      description: deal.why,
      category: category.name,
      ...(hasImage(deal) ? { image: `${SITE}/${deal.image}` } : {}),
      mainEntityOfPage: canonical,
      offers: {
        "@type": "Offer",
        url: deal.url,
        ...(listed
          ? { priceCurrency: "USD", price: deal.price_now.toFixed(2) }
          : {}),
        priceValidUntil: plusDays(deal.posted, 30),
        availability: "https://schema.org/InStock",
        itemCondition: dealTags(deal).some((id) => id === "used" || id === "police-trade-in")
          ? "https://schema.org/UsedCondition"
          : "https://schema.org/NewCondition",
        seller: { "@type": "Organization", name: deal.merchant },
      },
    },
    breadcrumbNode([
      { name: "Home", url: `${SITE}/` },
      { name: category.name, url: `${SITE}/${category.slug}/` },
      { name: deal.title, url: canonical },
    ]),
  ];
  return pageShell({
    title,
    description,
    canonical,
    ogType: "product",
    depth,
    json: graph,
    body: renderChrome({ depth, activeId: category.id, deals: allDeals, main }),
  });
}

function notFoundPage(deals) {
  const main = `
<div class="wrap">
  <header class="page-head">
    <p class="eyebrow">Missing page</p>
    <h1>That page is not on the board</h1>
    <p class="lede">The link does not match a category or a deal. Head back to the latest list.</p>
    <p class="result-count"><a href="./">Latest deals</a></p>
  </header>
</div>`;
  return pageShell({
    title: "Page not found | The Stash Deals",
    description: "That page does not exist on The Stash Deals.",
    robots: "noindex, follow",
    depth: 0,
    body: renderChrome({ depth: 0, activeId: "", deals, main }),
  });
}

function sitemap(entries) {
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${entry.lastmod}</lastmod>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function latestDate(deals) {
  return deals.map((deal) => deal.posted).sort().at(-1);
}

function writeFile(rel, contents) {
  const dest = path.join(distDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, contents);
}

function copyFile(from, rel) {
  const dest = path.join(distDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}

function build() {
  const deals = loadDeals();
  const rawDeals = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "deals.json"), "utf8"));
  const archive = loadArchive(new Set(rawDeals.map((deal) => deal.slug)));
  const queue = loadReportQueue();
  const probe = publishedDeals([
    { slug: "expired-sample-not-published", status: "expired" },
    { slug: "still-live", status: "live" },
    { slug: "default-live" },
  ]);
  if (probe.length !== 2 || probe.some((deal) => deal.status === "expired" || deal.slug === "expired-sample-not-published")) {
    throw new Error("Expired deals must be filtered out of the public board");
  }
  if (queue.version !== 1 || !Array.isArray(queue.reports)) {
    throw new Error("Expired report queue is missing");
  }
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  const sitemapEntries = [{ loc: `${SITE}/`, lastmod: latestDate(deals) }];

  writeFile(
    "index.html",
    listingPage({
      activeId: "home",
      depth: 0,
      canonicalPath: "/",
      title: HOME.title,
      description: HOME.description,
      h1: HOME.h1,
      eyebrow: HOME.eyebrow,
      lede: HOME.lede,
      deals,
      allDeals: deals,
      tagFilters: true,
    }),
  );

  for (const category of CATEGORIES) {
    const inCategory = deals.filter((deal) => deal.category === category.id);
    writeFile(
      path.join(category.slug, "index.html"),
      listingPage({
        activeId: category.id,
        depth: 1,
        canonicalPath: `/${category.slug}/`,
        title: `${category.h1} | ${SITE_NAME}`,
        description: category.description,
        h1: category.h1,
        eyebrow: category.eyebrow,
        lede: category.description,
        deals: inCategory,
        allDeals: deals,
        tagFilters: true,
      }),
    );
    sitemapEntries.push({
      loc: `${SITE}/${category.slug}/`,
      lastmod: latestDate(inCategory),
    });
  }

  const curated = deals.filter((deal) => deal.curated);
  writeFile(
    path.join("curated", "index.html"),
    listingPage({
      activeId: "curated",
      depth: 1,
      canonicalPath: "/curated/",
      title: CURATED.title,
      description: CURATED.description,
      h1: CURATED.h1,
      eyebrow: CURATED.eyebrow,
      lede: CURATED.lede,
      deals: curated,
      allDeals: deals,
    }),
  );
  sitemapEntries.push({ loc: `${SITE}/curated/`, lastmod: latestDate(curated) });

  for (const deal of deals) {
    writeFile(path.join("deals", deal.slug, "index.html"), dealPage(deal, deals));
    sitemapEntries.push({ loc: `${SITE}/deals/${deal.slug}/`, lastmod: deal.posted });
  }

  writeFile(
    "report-slugs.json",
    `${JSON.stringify(deals.map((deal) => deal.slug).sort())}\n`,
  );
  writeFile("404.html", notFoundPage(deals));
  writeFile("sitemap.xml", sitemap(sitemapEntries));
  writeFile(
    "robots.txt",
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
  );

  copyFile(CSS_SRC, path.join(...CSS_PATH.split("/")));
  copyFile(JS_SRC, path.join(...JS_PATH.split("/")));
  copyFile(path.join(rootDir, "public", "favicon.svg"), "favicon.svg");
  for (const asset of [EMBLEM, OG_IMAGE, APPLE_ICON]) {
    copyFile(path.join(rootDir, "public", ...asset.split("/")), path.join(...asset.split("/")));
  }
  copyFile(path.join(rootDir, "public", "_headers"), "_headers");
  copyFile(path.join(rootDir, "public", "avantlink_confirmation.txt"), "avantlink_confirmation.txt");
  for (const deal of deals) {
    if (!hasImage(deal)) continue;
    copyFile(path.join(rootDir, "public", deal.image), deal.image);
  }

  const fontDir = path.join(rootDir, "src", "fonts");
  for (const name of fs.readdirSync(fontDir)) {
    copyFile(path.join(fontDir, name), path.join("fonts", name));
  }

  const htmlCount = sitemapEntries.length + 1;
  const home = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  if (!home.includes("Affiliate disclosure") || !home.includes("Guns") || !home.includes('rel="sponsored noopener noreferrer"')) {
    throw new Error("Home page is missing disclosure, navigation, or sponsored links");
  }
  if (!home.includes('<link rel="canonical" href="https://thestash.deals/">')) {
    throw new Error("Home canonical must be https://thestash.deals/");
  }
  if (!home.includes('<meta property="og:url" content="https://thestash.deals/">')) {
    throw new Error("Home og:url must be https://thestash.deals/");
  }
  if (!home.includes('<meta name="twitter:url" content="https://thestash.deals/">')) {
    throw new Error("Home twitter:url must be https://thestash.deals/");
  }
  const bannedHosts = ["gearclearance.mcdaniel.fyi", "example.com"];
  function walkDist(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDist(full);
      else if (/\.(html|xml|txt)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const host of bannedHosts) {
          if (text.includes(host)) {
            throw new Error(`${path.relative(distDir, full)} still contains ${host}`);
          }
        }
      }
    }
  }
  walkDist(distDir);
  const robots = fs.readFileSync(path.join(distDir, "robots.txt"), "utf8");
  const sitemapXml = fs.readFileSync(path.join(distDir, "sitemap.xml"), "utf8");
  if (!robots.includes("Sitemap: https://thestash.deals/sitemap.xml")) {
    throw new Error("robots.txt sitemap must use https://thestash.deals");
  }
  if (!sitemapXml.includes("<loc>https://thestash.deals/</loc>")) {
    throw new Error("sitemap loc must use https://thestash.deals");
  }
  const guns = fs.readFileSync(path.join(distDir, "guns", "index.html"), "utf8");
  const sampleDeal = fs.readFileSync(path.join(distDir, "deals", deals[0].slug, "index.html"), "utf8");
  const impactCount = (html) => html.split(IMPACT_UTT).length - 1;
  if (impactCount(home) !== 1 || impactCount(guns) !== 1 || impactCount(sampleDeal) !== 1) {
    throw new Error("Impact tracking tag must appear exactly once in the shared page shell");
  }
  // TEMP allowance for AvantLink application_id=1655829. Restore the blanket
  // rejection (classic.avantlink.com / "TEMP AvantLink" / old app id 1655057 on
  // every page) in the follow-up that deletes AVANTLINK_OWNERSHIP_VERIFY, after
  // https://classic.avantlink.com/affiliate_app_confirm.php?mode=verify-js&application_id=1655829
  const avantCount = (html) => html.split(AVANTLINK_OWNERSHIP_VERIFY).length - 1;
  if (avantCount(home) !== 1) {
    throw new Error("Homepage must include the temporary AvantLink ownership verification script exactly once");
  }
  if (!AVANTLINK_OWNERSHIP_VERIFY.includes("https://classic.avantlink.com/affiliate_app_confirm.php?mode=js&authResponse=45db105505328ea31ad0aa12912acddeab0fe924")) {
    throw new Error("Temporary AvantLink verification script must use the https confirm URL");
  }
  function walkHtml(dir, rel = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walkHtml(full, next);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      const text = fs.readFileSync(full, "utf8");
      const count = avantCount(text);
      if (next === "index.html") {
        if (count !== 1) {
          throw new Error("Homepage must include the temporary AvantLink ownership verification script exactly once");
        }
      } else if (count !== 0 || text.includes("classic.avantlink.com") || text.includes("TEMP AvantLink")) {
        throw new Error(`${next} must not include the temporary AvantLink ownership verification script`);
      }
      if (text.includes("1655057")) {
        throw new Error(`${next} must not include old AvantLink application id 1655057`);
      }
    }
  }
  walkHtml(distDir);
  const confirmName = "avantlink_confirmation.txt";
  const confirmSrc = fs.readFileSync(path.join(rootDir, "public", confirmName), "utf8");
  const confirmDist = fs.readFileSync(path.join(distDir, confirmName), "utf8");
  if (confirmSrc !== confirmDist || !confirmDist.includes("<Mode>Verify-File</Mode>")) {
    throw new Error("avantlink_confirmation.txt must be copied unchanged to the site root");
  }
  const headers = fs.readFileSync(path.join(distDir, "_headers"), "utf8");
  const impactSource = IMPACT_UTT.match(/^<script type="text\/javascript">([\s\S]*)<\/script>$/);
  if (!impactSource) throw new Error("Impact tag must stay a single inline script");
  const impactHash = `'sha256-${crypto.createHash("sha256").update(impactSource[1]).digest("base64")}'`;
  for (const token of [
    "http://classic.avantlink.com",
    "https://classic.avantlink.com",
    "https://utt.impactcdn.com",
    "https://*.impactradius.com",
    "https://*.impact.com",
    impactHash,
  ]) {
    if (!headers.includes(token)) throw new Error(`Content-Security-Policy is missing ${token}`);
  }
  for (const [page, name] of [[home, "home"], [guns, "guns"], [sampleDeal, "deal"]]) {
    if (!page.includes(CSS_PATH) || !page.includes(JS_PATH)) {
      throw new Error(`The ${name} page must link the fingerprinted css and js`);
    }
    // An unhashed URL would be served from the day-long cache and could go stale against this HTML.
    if (page.includes("css/site.css") || page.includes("js/nav.js")) {
      throw new Error(`The ${name} page links an unfingerprinted asset`);
    }
  }
  for (const asset of [CSS_PATH, JS_PATH]) {
    if (!fs.existsSync(path.join(distDir, ...asset.split("/")))) {
      throw new Error(`Fingerprinted asset ${asset} was not written into dist/`);
    }
  }
  const sidebar = home.slice(home.indexOf('id="sidebar"'), home.indexOf('class="main-col"'));
  const topbar = home.slice(home.indexOf('class="topbar"'), home.indexOf('class="backdrop"'));
  for (const chrome of [sidebar, topbar]) {
    if (!chrome.includes('class="wordmark"') || chrome.includes("wordmark sr-only") || !chrome.includes(SITE_NAME)) {
      throw new Error("Nav chrome is missing the visible wordmark");
    }
    if (chrome.includes("brand-logo") || chrome.includes("topbar-logo") || chrome.includes(LOGO)) {
      throw new Error("Portrait poster must not appear in nav chrome");
    }
    // The old placeholder was a triangle in a rounded square and was not brand art.
    if (chrome.includes("M8 23.2 16 8.2l8 15")) {
      throw new Error("Placeholder triangle mark must not return to nav chrome");
    }
  }
  // The sidebar has room for the illustration; the topbar does not, so it keeps the crate mark.
  if (!sidebar.includes('class="brand-emblem"') || !sidebar.includes(EMBLEM)) {
    throw new Error("Sidebar brand is missing the emblem lockup");
  }
  if (!topbar.includes('class="mark"') || topbar.includes(EMBLEM)) {
    throw new Error("Mobile topbar must use the crate mark, not the emblem image");
  }
  if (!topbar.includes("#d4a017")) {
    throw new Error("Topbar mark must be the brand crate mark, not a generic glyph");
  }
  if (!sidebar.includes(TAGLINE) || !sidebar.includes('class="brand-tag"')) {
    throw new Error("Sidebar brand is missing the tagline");
  }
  for (const asset of [EMBLEM, OG_IMAGE, APPLE_ICON]) {
    if (!fs.existsSync(path.join(distDir, ...asset.split("/")))) {
      throw new Error(`Brand asset ${asset} was not copied into dist/`);
    }
  }
  if (fs.existsSync(path.join(distDir, LOGO))) {
    throw new Error("Master poster is unreferenced art and must not ship in dist/");
  }
  if (sampleDeal.includes(LOGO)) {
    throw new Error("Deal pages must not render the portrait poster");
  }
  if (!sampleDeal.includes(`../../${EMBLEM}`)) {
    throw new Error("Deal pages must resolve the emblem relative to their depth");
  }
  for (const [page, name] of [[home, "home"], [guns, "guns"], [sampleDeal, "deal"]]) {
    if (!page.includes(`<meta property="og:image" content="${SITE}/${OG_IMAGE}">`)) {
      throw new Error(`Missing absolute og:image on the ${name} page`);
    }
    if (!page.includes('content="summary_large_image"')) {
      throw new Error(`Social card on the ${name} page must be summary_large_image`);
    }
    if (!page.includes(`rel="apple-touch-icon"`)) {
      throw new Error(`Missing apple-touch-icon on the ${name} page`);
    }
  }
  if (!home.includes('data-tag="used"') || !home.includes('data-tag="police-trade-in"') || !home.includes('class="tag"')) {
    throw new Error("Home page is missing condition tag filters or badges");
  }
  const placeholder = renderThumb({ title: "Sample", slug: "sample" }, 0);
  if (!placeholder.includes("thumb-empty") || placeholder.includes("<img")) {
    throw new Error("Missing-image cards must render a placeholder, not an image");
  }
  if (!home.includes('class="thumb"')) {
    throw new Error("Home cards must render a product thumbnail frame");
  }
  if (deals.some((deal) => !hasImage(deal)) && !home.includes('class="thumb thumb-empty"')) {
    throw new Error("Deals without an image must render the no-photo placeholder");
  }
  if (/<img[^>]+src="https?:/i.test(home) || /<img[^>]+src="\/\//i.test(home)) {
    throw new Error("Card images must be same-origin files, not remote URLs");
  }
  const imaged = deals.filter(hasImage);
  if (imaged.length < 12) throw new Error("Expected a sample of self-hosted product thumbnails");
  for (const deal of imaged) {
    if (!fs.existsSync(path.join(distDir, deal.image))) {
      throw new Error(`Thumbnail ${deal.image} was not copied into dist/`);
    }
  }
  const gunsImaged = deals.find((deal) => deal.category === "guns" && hasImage(deal));
  if (gunsImaged && !guns.includes(`../${gunsImaged.image}`)) {
    throw new Error("Aisle cards must resolve thumbnail paths relative to the page");
  }
  const imagedPage = fs.readFileSync(path.join(distDir, "deals", imaged[0].slug, "index.html"), "utf8");
  if (!imagedPage.includes(`../../${imaged[0].image}`) || !imagedPage.includes(`${SITE}/${imaged[0].image}`)) {
    throw new Error("Deal pages must resolve the thumbnail and include it in Product JSON-LD");
  }
  if (home.includes("Used</span></a>") || /nav-link[^>]*>[^<]*Used/.test(home)) {
    throw new Error("Condition tags must not be sidebar categories");
  }
  const nav = home.slice(home.indexOf('aria-label="Categories"'), home.indexOf('class="rail"'));
  const reportButtons = home.split('class="report-expired"').length - 1;
  if (reportButtons !== deals.length) {
    throw new Error(`Home should have one Report expired control per live deal, found ${reportButtons}`);
  }
  if (!home.includes(">Report expired<span") || !home.includes('class="report-hp"') || !home.includes('class="toast"')) {
    throw new Error("Home page is missing the expired-report control");
  }
  if (!sampleDeal.includes('class="report-expired"')) {
    throw new Error("Deal pages must include Report expired");
  }
  const navSource = fs.readFileSync(JS_SRC, "utf8");
  if (!navSource.includes("Thanks — we'll check this deal.") || !navSource.includes("/api/report-expired")) {
    throw new Error("Report expired client is missing the thanks toast or the report endpoint");
  }
  for (const deal of [...rawDeals.filter((item) => item.status === "expired"), ...archive]) {
    const needle = `/deals/${deal.slug}/`;
    if (home.includes(needle) || sitemapXml.includes(needle)) {
      throw new Error(`Expired deal ${deal.slug} is still on the public board`);
    }
    if (fs.existsSync(path.join(distDir, "deals", deal.slug, "index.html"))) {
      throw new Error(`Expired deal ${deal.slug} still has a public page`);
    }
  }
  const slugFile = JSON.parse(fs.readFileSync(path.join(distDir, "report-slugs.json"), "utf8"));
  if (slugFile.length !== deals.length || archive.some((deal) => slugFile.includes(deal.slug))) {
    throw new Error("report-slugs.json must list only live deals");
  }
  const aisleOrder = ["Guns", "Ammo", "Optics", "Accessories", "Apparel", "Food storage", "Survival", "Household goods", "Gaming", "Drones"];
  let cursor = 0;
  for (const label of aisleOrder) {
    const at = nav.indexOf(`>${label}<`, cursor);
    if (at < 0) throw new Error(`Sidebar missing ${label} in aisle order`);
    cursor = at;
  }
  console.log(`Built ${htmlCount} HTML pages and ${deals.length} deals into dist/`);
}

build();
