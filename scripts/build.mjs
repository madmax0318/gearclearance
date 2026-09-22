import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// WCAG 2.x relative luminance and contrast, so the guardrail block can check the palette
// numerically instead of trusting a reviewer's eye. axe and Lighthouse cannot do this here:
// body and .card both paint gradients, so axe marks 225 of 226 text nodes "incomplete —
// background color could not be determined" and the accessibility score stays at 100.
function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(value.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Every foreground/background token pair the stylesheet actually produces, with the ratio measured
// on 2026-09-22 as a floor. `need` is 4.5 for body text and 3 for large text (>=24px, or >=18.66px
// bold). Three pairs are known to fail AA; they are recorded rather than hidden so the build fails
// on a new failure or a regression, and passes again once a token is lightened.
const CONTRAST_PAIRS = [
  { label: ".lede/.result-count/.empty/.legal/.crumbs a/.tag-chip", fg: "muted", bg: "bg", need: 4.5, measured: 6.11 },
  { label: ".crumbs current + .tag-chip .count", fg: "faint", bg: "bg", need: 4.5, measured: 4.36 },
  { label: ".nav-link .count + .fine-note", fg: "muted", bg: "panel", need: 4.5, measured: 3.78 },
  { label: ".cat-link/.merchant time/.was on a card", fg: "muted", bg: "panel-2", need: 4.5, measured: 3.1 },
  { label: ".nav-link/.rail-note/.brand-tag", fg: "text", bg: "panel", need: 4.5, measured: 8.78 },
  { label: ".why/.merchant on a card", fg: "text", bg: "panel-2", need: 4.5, measured: 7.2 },
  { label: ".eyebrow", fg: "accent", bg: "bg", need: 4.5, measured: 7.84 },
  { label: ".rail-kicker", fg: "accent", bg: "panel", need: 4.5, measured: 4.85 },
  { label: ".now (large)", fg: "accent-hover", bg: "panel-2", need: 3, measured: 4.41 },
  { label: ".off badge + .pill", fg: "accent-hover", bg: "surface", need: 4.5, measured: 7.82 },
  { label: ".cta + .skip", fg: "accent-ink", bg: "accent", need: 4.5, measured: 7.7 },
  { label: ".disclosure", fg: "text", bg: "notice-bg", need: 4.5, measured: 13.51 },
  { label: ".disclosure strong", fg: "accent", bg: "notice-bg", need: 4.5, measured: 7.46 },
];

// Lightening --muted and --faint clears all three; until then the count must not grow.
const KNOWN_CONTRAST_FAILURES = 3;

// Measured 73,492 B across three faces. The budget leaves a little headroom but not a fourth face:
// the fonts are the largest render-affecting payload on the site and are discovered only after the
// stylesheet parses, so every added byte lands inside the FOUT window.
const FONT_BUDGET_BYTES = 76800;

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
  if (!Array.isArray(deals) || deals.length < 12 || deals.length > 48) {
    throw new Error(`Expected 12–48 deals, found ${deals.length}`);
  }
  const slugs = new Set();
  for (const deal of deals) {
    for (const key of ["slug", "title", "merchant", "why", "url", "category", "posted"]) {
      if (deal[key] === undefined || deal[key] === "") throw new Error(`Missing ${key} on a deal`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(deal.slug)) throw new Error(`Bad slug: ${deal.slug}`);
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
  }
  for (const category of CATEGORIES) {
    if (!deals.some((deal) => deal.category === category.id)) {
      throw new Error(`No deals in ${category.id}`);
    }
  }
  for (const tag of DEAL_TAGS) {
    if (!deals.some((deal) => dealTags(deal).includes(tag.id))) {
      throw new Error(`No sample deal tagged ${tag.id}`);
    }
  }
  return deals.sort(byNewest);
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

function renderCard(deal, depth, heading) {
  const category = categoryById(deal.category);
  const tag = heading === "h3" ? "h3" : "h2";
  const tags = dealTags(deal).join(" ");
  return `<article class="card" data-tags="${esc(tags)}">
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
</div>`;
}

// Impact.com Universal Tracking Tag (account snippet P-A7822267). Permanent, every page.
const IMPACT_UTT = `<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7822267-c904-4255-a7d2-efe7698726ea1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');</script>`;

function pageShell({ title, description, canonical, robots = "index, follow", ogType = "website", depth, json, body }) {
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
${IMPACT_UTT}
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
  for (const html of [home, guns, sampleDeal]) {
    if (html.includes("classic.avantlink.com") || html.includes("TEMP AvantLink") || html.includes("1655057")) {
      throw new Error("Temporary AvantLink ownership verification script must not be injected");
    }
  }
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
  if (home.includes("Used</span></a>") || /nav-link[^>]*>[^<]*Used/.test(home)) {
    throw new Error("Condition tags must not be sidebar categories");
  }
  const nav = home.slice(home.indexOf('aria-label="Categories"'), home.indexOf('class="rail"'));
  const aisleOrder = ["Guns", "Ammo", "Optics", "Accessories", "Apparel", "Food storage", "Survival", "Household goods", "Gaming", "Drones"];
  let cursor = 0;
  for (const label of aisleOrder) {
    const at = nav.indexOf(`>${label}<`, cursor);
    if (at < 0) throw new Error(`Sidebar missing ${label} in aisle order`);
    cursor = at;
  }

  // ---- UX/UI guardrails (see .cursor/rules/ux-ui.mdc for the audit each one came from) ----

  const cssText = fs.readFileSync(CSS_SRC, "utf8");
  const tokens = Object.fromEntries(
    [...cssText.slice(cssText.indexOf(":root"), cssText.indexOf("color-scheme")).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(
      (match) => [match[1], match[2].toLowerCase()],
    ),
  );
  let contrastFailures = 0;
  for (const pair of CONTRAST_PAIRS) {
    for (const token of [pair.fg, pair.bg]) {
      if (!tokens[token]) throw new Error(`Colour token --${token} is gone; update CONTRAST_PAIRS for ${pair.label}`);
    }
    const ratio = contrastRatio(tokens[pair.fg], tokens[pair.bg]);
    if (ratio < pair.measured - 0.01) {
      throw new Error(
        `Contrast regression: ${pair.label} (--${pair.fg} on --${pair.bg}) dropped to ${ratio.toFixed(2)}:1 from ${pair.measured}:1`,
      );
    }
    if (ratio < pair.need) contrastFailures += 1;
  }
  if (contrastFailures > KNOWN_CONTRAST_FAILURES) {
    throw new Error(`${contrastFailures} token pairs now fail WCAG AA contrast, up from ${KNOWN_CONTRAST_FAILURES}`);
  }

  // Motion the stylesheet declares must be switched off for prefers-reduced-motion, not just some
  // of it. Only .sidebar animates and only html scrolls smoothly, so both must appear in the block.
  const reduceAt = cssText.indexOf("@media (prefers-reduced-motion: reduce)");
  if (reduceAt < 0) throw new Error("site.css must keep a prefers-reduced-motion block");
  const reduceBlock = cssText.slice(reduceAt);
  for (const rule of cssText.slice(0, reduceAt).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, rawSelector, body] = rule;
    const animates = /transition:\s*(?!none)|animation:\s*(?!none)|scroll-behavior:\s*smooth/.test(body);
    if (!animates) continue;
    const selector = rawSelector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!reduceBlock.includes(selector)) {
      throw new Error(`${selector} animates but is not reset under prefers-reduced-motion`);
    }
  }

  // Self-hosted faces must swap rather than block text, must exist in dist/, and must stay inside
  // the payload budget. font-display is the difference between a FOUT and invisible text.
  const faces = [...cssText.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]);
  if (!faces.length) throw new Error("site.css declares no @font-face rules");
  let fontBytes = 0;
  for (const face of faces) {
    if (!/font-display:\s*swap/.test(face)) {
      throw new Error("Every @font-face must set font-display: swap");
    }
    const file = face.match(/url\("\.\.\/fonts\/([^"]+)"\)/);
    if (!file) throw new Error("Every @font-face must load a self-hosted ../fonts/ woff2");
    const shipped = path.join(distDir, "fonts", file[1]);
    if (!fs.existsSync(shipped)) throw new Error(`@font-face references ${file[1]} which is not in dist/fonts/`);
    fontBytes += fs.statSync(shipped).size;
  }
  if (fontBytes > FONT_BUDGET_BYTES) {
    throw new Error(`Webfonts total ${fontBytes} B, over the ${FONT_BUDGET_BYTES} B budget`);
  }

  const pages = [];
  function collectPages(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectPages(full);
      else if (entry.name.endsWith(".html")) pages.push([path.relative(distDir, full), fs.readFileSync(full, "utf8")]);
    }
  }
  collectPages(distDir);
  if (pages.length !== htmlCount) throw new Error(`Expected ${htmlCount} HTML pages, collected ${pages.length}`);

  for (const [name, html] of pages) {
    // 43 cards carry the identical visible label "View deal", so link purpose rests entirely on the
    // sr-only merchant suffix, and the new-tab warning has to reach a screen reader before the click.
    for (const cta of html.matchAll(/<a class="cta"([^>]*)>([\s\S]*?)<\/a>/g)) {
      const [, attrs, inner] = cta;
      if (!attrs.includes('target="_blank"') || !attrs.includes('rel="sponsored noopener noreferrer"')) {
        throw new Error(`${name} has a View deal link without target="_blank" and rel="sponsored noopener noreferrer"`);
      }
      if (!/<span class="sr-only"> at [^<]*\(opens a new tab\)<\/span>/.test(inner)) {
        throw new Error(`${name} has a View deal link without the sr-only merchant and new-tab suffix`);
      }
      if (!inner.includes('class="ext"')) {
        throw new Error(`${name} has a View deal link without the visible external-link affordance`);
      }
    }

    // One h1 and no skipped levels, so the heading outline is a usable table of contents.
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
    if (levels.filter((level) => level === 1).length !== 1) {
      throw new Error(`${name} must have exactly one h1, found ${levels.filter((level) => level === 1).length}`);
    }
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] > levels[i - 1] + 1) {
        throw new Error(`${name} skips from h${levels[i - 1]} to h${levels[i]}`);
      }
    }

    // Intrinsic dimensions keep an image from shifting the layout once it decodes.
    for (const img of html.matchAll(/<img\b[^>]*>/g)) {
      for (const attr of ["width=", "height=", "alt="]) {
        if (!img[0].includes(attr)) throw new Error(`${name} has an <img> missing ${attr}`);
      }
    }

    // The skip link is the only way past 13 nav links by keyboard, so its target must exist.
    const skip = html.match(/<a class="skip" href="#([^"]+)">/);
    if (!skip) throw new Error(`${name} is missing the skip link`);
    if (!html.includes(`id="${skip[1]}"`)) throw new Error(`${name} skip link points at missing #${skip[1]}`);

    // nav.js rewrites .result-count and toggles aria-pressed, so the markup it needs must be there.
    if (html.includes('class="tag-filters"')) {
      if (!html.includes('role="group"') || !html.includes('aria-label="Filter by condition or source"')) {
        throw new Error(`${name} renders tag filters without a labelled group`);
      }
      if (!/<p class="result-count" data-total="\d+">/.test(html)) {
        throw new Error(`${name} renders tag filters without the .result-count element nav.js updates`);
      }
      for (const chip of html.matchAll(/<button[^>]*class="tag-chip[^>]*>/g)) {
        if (!chip[0].includes('type="button"') || !chip[0].includes("aria-pressed=")) {
          throw new Error(`${name} has a tag chip without type="button" and aria-pressed`);
        }
      }
    }
  }

  console.log(`Built ${htmlCount} HTML pages and ${deals.length} deals into dist/`);
}

build();
