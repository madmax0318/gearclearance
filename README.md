# The Stash Deals

Static prototype of an affiliate deal aggregator. Cards link out to merchants. The Stash Deals is not the seller and not a federal firearms licensee (FFL).

**Tagline:** Grow your stash without shrinking your wallet.

**Public domain (intended):** [thestash.deals](https://thestash.deals)

**Prototype host:** [gearclearance.mcdaniel.fyi](https://gearclearance.mcdaniel.fyi) on Cloudflare Pages. The published site is the `dist/` folder from `npm run build`. Canonical URLs, the sitemap, and JSON-LD still use the prototype host until thestash.deals is the live hostname. No Node server, email ingest, scraper, or live affiliate API.

## Local preview

Requires Node 18 or newer.

```bash
npm run build
npm run preview
```

Open http://localhost:4173

`npm run preview` serves `dist/` and resolves category paths such as `/guns/` and `/ammo/`. After a build, `dist/index.html` also opens on its own and shows the sidebar, the latest deals, and the footer disclosure. Use the preview server for the category routes.

## Cloudflare Pages

1. Create a Pages project connected to this repository.
2. Framework preset: None.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Node.js version: 20 (or any 18+). No environment variables.

The build writes HTML, CSS, a small menu script, fonts, `sitemap.xml`, `robots.txt`, and `_headers`. `_headers` sets baseline security headers (nosniff, frame denial, referrer policy, a self-only content security policy, and HSTS).

### Custom domain

The intended public domain is `thestash.deals`. This prototype still publishes on `gearclearance.mcdaniel.fyi`.

Add `gearclearance.mcdaniel.fyi` as a custom domain on the Pages project.

DNS for that hostname is a **CNAME**:

| Name | Type | Target |
| --- | --- | --- |
| `gearclearance` | CNAME | the project's `*.pages.dev` hostname (shown in the Pages dashboard, for example `gear-clearance.pages.dev`) |

If `mcdaniel.fyi` is already on Cloudflare DNS, adding the custom domain in Pages can create that CNAME for you. Leave the record proxied. Wait until the certificate is active, then open https://gearclearance.mcdaniel.fyi.

This is a subdomain, so a CNAME is the right record. Do not move the zone apex for this prototype. Point `thestash.deals` at the same Pages project when that hostname is ready; until then, keep the prototype CNAME above.

## Information architecture

Left sidebar, in order:

1. Home — latest deals across every aisle
2. Guns — `/guns/`
3. Ammo — `/ammo/`
4. Optics — `/optics/`
5. Accessories — `/accessories/`
6. Food storage — `/food-storage/`
7. Survival — `/survival/`
8. Household goods — `/household/`
9. Gaming — `/gaming/`
10. Drones — `/drones/`

**Curated** sits on a lower rail with a badge. `/curated/` is a placeholder for hand-picked tips.

On a narrow screen the same list is a drawer (the Menu control). The menu opens without JavaScript. The small script closes the drawer on Escape or after a tap, and it applies the condition-tag chips on home and category pages. Without JavaScript those pages still list every deal.

Each deal also has a page under `/deals/<slug>/` with Product and Offer JSON-LD. Listing pages are real HTML, not an empty app shell.

## Sample data

`data/deals.json` holds 24 fictional deals covering all nine aisles. Affiliate URLs are `https://example.com/out/...` and render with `rel="sponsored noopener noreferrer"`. Edit the JSON and rebuild to change the board.

A deal may include an optional `tags` array of condition or source ids. Tags are not sidebar aisles. Known tags:

| id | Label |
| --- | --- |
| `used` | Used |
| `police-trade-in` | Police trade-in |

Home and each category page show chips for the tags present on that board. The chips filter the cards in the browser. Curated stays a separate rail.

The footer of every page includes the FTC affiliate disclosure.

## Layout

- `data/deals.json` — sample deals
- `scripts/build.mjs` — writes `dist/`
- `scripts/preview.mjs` — local static server
- `src/site.css`, `src/nav.js`, `src/fonts/` — styles, drawer behavior, tag filters, OFL fonts
- `public/_headers`, `public/favicon.svg` — copied into `dist/`
