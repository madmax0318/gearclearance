import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const SITE_NAME = "The Stash Deals";
const TAGLINE = "Grow your stash without shrinking your wallet.";
// Canonicals stay on the prototype host. Intended public domain is https://thestash.deals (see README).
const SITE = "https://gearclearance.mcdaniel.fyi";

const CATEGORIES = [
  {
    id: "guns",
    slug: "guns",
    name: "Guns",
    h1: "Gun deals",
    eyebrow: "Guns",
    description:
      "Sample gun deals with merchant, was/now price, and why the markdown is listed. The Stash Deals only links out — we are not the seller and we are not an FFL.",
  },
  {
    id: "ammo",
    slug: "ammo",
    name: "Ammo",
    h1: "Ammo deals",
    eyebrow: "Ammo",
    description:
      "Sample ammunition markdowns with round count in the title, a percent-off badge, and a short note on why the price is worth a look.",
  },
  {
    id: "optics",
    slug: "optics",
    name: "Optics",
    h1: "Optics deals",
    eyebrow: "Optics",
    description:
      "Sample red dot and riflescope deals. Each card shows the merchant, the previous price, and any condition or source tags.",
  },
  {
    id: "accessories",
    slug: "accessories",
    name: "Accessories",
    h1: "Accessory deals",
    eyebrow: "Accessories",
    description:
      "Sample deals on magazines, lights, and slings, with pack versus single pricing called out in the title.",
  },
  {
    id: "food-storage",
    slug: "food-storage",
    name: "Food storage",
    h1: "Food storage deals",
    eyebrow: "Food storage",
    description:
      "Sample clearance prices on freeze-dried food and pantry supplies for longer-term storage.",
  },
  {
    id: "survival",
    slug: "survival",
    name: "Survival",
    h1: "Survival deals",
    eyebrow: "Survival",
    description:
      "Sample deals on water, shelter, and a compact medical kit, with the old price beside the sale price.",
  },
  {
    id: "household",
    slug: "household",
    name: "Household goods",
    h1: "Household goods deals",
    eyebrow: "Household goods",
    description:
      "Sample household clearance: portable power and a basic drill kit, using the same card layout as the gear aisles.",
  },
  {
    id: "gaming",
    slug: "gaming",
    name: "Gaming",
    h1: "Gaming deals",
    eyebrow: "Gaming",
    description:
      "Sample markdowns on handhelds and mice. Same card layout as the other aisles, including any condition tags.",
  },
  {
    id: "drones",
    slug: "drones",
    name: "Drones",
    h1: "Drone deals",
    eyebrow: "Drones",
    description:
      "Sample drone deals with merchant, was/now price, and a short note on why the markdown is listed.",
  },
];

const HOME = {
  id: "home",
  h1: "Latest deals",
  eyebrow: "Latest across every aisle",
  title: "Latest deals | The Stash Deals",
  description:
    "Grow your stash without shrinking your wallet. Sample deals on guns, ammo, optics, accessories, food storage, survival, household goods, gaming, and drones.",
  lede: "Grow your stash without shrinking your wallet. Newest sample deals across guns, ammo, optics, accessories, food storage, survival, household goods, gaming, and drones. Open a category to narrow the board.",
};

const CURATED = {
  id: "curated",
  slug: "curated",
  h1: "Curated picks",
  eyebrow: "Hand-picked tips",
  title: "Curated picks | The Stash Deals",
  description:
    "A short rail of hand-picked sample deals. This curated section is an editorial placeholder, not an automated ranking.",
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

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="1.2" y="1.2" width="29.6" height="29.6" rx="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 23.2 16 8.2l8 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="16" cy="17.2" r="2.3" fill="#e0a82e"/></svg>`;

const EXT = `<svg class="ext" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.2 3.2h5.1v1.4H4.6v6.8h6.8V7.7h1.4v5.1H3.2V3.2z"/><path fill="currentColor" d="M8.2 2.4h5.4V7.8h-1.4V4.8L7.4 9.6 6.4 8.6l4.8-4.8H8.2V2.4z"/></svg>`;

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
  if (!Array.isArray(deals) || deals.length < 12 || deals.length > 30) {
    throw new Error(`Expected 12–30 deals, found ${deals.length}`);
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
    if (typeof deal.price_now !== "number" || typeof deal.price_was !== "number") {
      throw new Error(`Prices must be numbers on ${deal.slug}`);
    }
    if (!(deal.price_was > deal.price_now && deal.price_now > 0)) {
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

function renderCard(deal, depth, heading) {
  const category = categoryById(deal.category);
  const pct = percentOff(deal.price_now, deal.price_was);
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
  <div class="price-row">
    <p class="now"><span class="sr-only">Price now </span>${esc(money(deal.price_now))}</p>
    <p class="was"><span class="sr-only">Was </span><s>${esc(money(deal.price_was))}</s></p>
    <p class="off">${pct}% off</p>
  </div>
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
    ${MARK}
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
    <a class="topbar-mark" href="${href(depth, "")}">${SITE_NAME}</a>
  </header>
  <label class="backdrop" for="nav-toggle"><span class="sr-only">Close menu</span></label>
  ${renderSidebar(activeId, depth, deals)}
  <div class="main-col">
    <main id="content">${main}</main>
    <footer class="site-footer">
      <div class="wrap">
        <p class="disclosure"><strong>Affiliate disclosure.</strong> ${esc(DISCLOSURE)}</p>
        <p class="legal">© 2026 ${SITE_NAME}. Sample prices for this static prototype. Not a live feed.</p>
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
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="icon" href="${href(depth, "favicon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${href(depth, "css/site.css")}">${blocks}
</head>
<body>
<a class="skip" href="#content">Skip to deals</a>
<input class="nav-toggle" id="nav-toggle" type="checkbox">
${body}
<script src="${href(depth, "js/nav.js")}"></script>
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
      : `<p class="empty">No sample deals in this aisle yet.</p>`
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
  const pct = percentOff(deal.price_now, deal.price_was);
  const description = clip(
    `${deal.title} is ${money(deal.price_now)} at ${deal.merchant} (was ${money(deal.price_was)}, ${pct}% off). ${deal.why}`,
  );
  const title = `${deal.title} — ${money(deal.price_now)} | ${SITE_NAME}`;
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
      <div class="price-row">
        <p class="now"><span class="sr-only">Price now </span>${esc(money(deal.price_now))}</p>
        <p class="was"><span class="sr-only">Was </span><s>${esc(money(deal.price_was))}</s></p>
        <p class="off">${pct}% off</p>
      </div>
      <a class="cta" href="${esc(deal.url)}" target="_blank" rel="sponsored noopener noreferrer">View deal<span class="sr-only"> at ${esc(deal.merchant)} (opens a new tab)</span>${EXT}</a>
      <p class="fine-note">Sample price for this prototype. Confirm it on the merchant site. The button leaves ${SITE_NAME}.</p>
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
        priceCurrency: "USD",
        price: deal.price_now.toFixed(2),
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
    <p class="lede">The link does not match a category or a sample deal. Head back to the latest list.</p>
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

// TEMP AvantLink ownership verify app 1655057 — remove after verify
const AVANTLINK_HOME_VERIFY = `<!-- TEMP AvantLink ownership verify app 1655057 — remove after verify -->
<script type="text/javascript" src="http://classic.avantlink.com/affiliate_app_confirm.php?mode=js&authResponse=c3faa08455ca3fdfb5861ff2736b00d74d7f9664"></script>
`;

function withAvantLinkHomeVerify(html) {
  const closing = "</body>";
  const at = html.lastIndexOf(closing);
  if (at < 0) throw new Error("Home page shell is missing </body>");
  return `${html.slice(0, at)}${AVANTLINK_HOME_VERIFY}${html.slice(at)}`;
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
    withAvantLinkHomeVerify(
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
    ),
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

  copyFile(path.join(rootDir, "src", "site.css"), path.join("css", "site.css"));
  copyFile(path.join(rootDir, "src", "nav.js"), path.join("js", "nav.js"));
  copyFile(path.join(rootDir, "public", "favicon.svg"), "favicon.svg");
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
  if (!home.includes(AVANTLINK_HOME_VERIFY.trim())) {
    throw new Error("Home page is missing temporary AvantLink ownership verification");
  }
  if (!home.includes('src="http://classic.avantlink.com/affiliate_app_confirm.php?mode=js&authResponse=c3faa08455ca3fdfb5861ff2736b00d74d7f9664"')) {
    throw new Error("AvantLink verify script must use the official http:// src");
  }
  if (home.includes("https://classic.avantlink.com/affiliate_app_confirm.php")) {
    throw new Error("AvantLink verify script must not use https:// — the matcher looks for http://");
  }
  const guns = fs.readFileSync(path.join(distDir, "guns", "index.html"), "utf8");
  const sampleDeal = fs.readFileSync(path.join(distDir, "deals", deals[0].slug, "index.html"), "utf8");
  const impactCount = (html) => html.split(IMPACT_UTT).length - 1;
  if (impactCount(home) !== 1 || impactCount(guns) !== 1 || impactCount(sampleDeal) !== 1) {
    throw new Error("Impact tracking tag must appear exactly once in the shared page shell");
  }
  if (guns.includes("avantlink.com") || guns.includes("1655057") || sampleDeal.includes("avantlink.com")) {
    throw new Error("AvantLink verification must be homepage only");
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
  if (!home.includes('data-tag="used"') || !home.includes('data-tag="police-trade-in"') || !home.includes('class="tag"')) {
    throw new Error("Home page is missing condition tag filters or badges");
  }
  if (home.includes("Used</span></a>") || /nav-link[^>]*>[^<]*Used/.test(home)) {
    throw new Error("Condition tags must not be sidebar categories");
  }
  const nav = home.slice(home.indexOf('aria-label="Categories"'), home.indexOf('class="rail"'));
  const aisleOrder = ["Guns", "Ammo", "Optics", "Accessories", "Food storage", "Survival", "Household goods", "Gaming", "Drones"];
  let cursor = 0;
  for (const label of aisleOrder) {
    const at = nav.indexOf(`>${label}<`, cursor);
    if (at < 0) throw new Error(`Sidebar missing ${label} in aisle order`);
    cursor = at;
  }
  console.log(`Built ${htmlCount} HTML pages and ${deals.length} deals into dist/`);
}

build();
