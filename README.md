# The Stash Deals

Static prototype of an affiliate deal aggregator. Cards link out to merchants. The Stash Deals is not the seller and not a federal firearms licensee (FFL).

**Tagline:** Grow your stash without shrinking your wallet.

**Public site:** [thestash.deals](https://thestash.deals)

The published site is the `dist/` folder from `npm run build`. Canonical URLs, Open Graph, Twitter, JSON-LD, the sitemap, and `robots.txt` use `https://thestash.deals`. The former prototype hostname is retired. The Pages build does not run email ingest, a scraper, or a live affiliate API. Optional Ion Cannon drafts live in `pipeline/` and are separate from `npm run build`.

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

The stylesheet and menu script are written with a content hash in the filename (`css/site.<hash>.css`, `js/nav.<hash>.js`). HTML always revalidates but those assets are cached for a year, so the hash is what guarantees a page never loads against a stale stylesheet. Edit `src/site.css` or `src/nav.js` and the next build emits a new filename on its own.

### Custom domain

The public hostname is `thestash.deals`. Canonicals, the sitemap, and structured data use that host only.

`gearclearance.mcdaniel.fyi` is retired. This repository does not remove a Cloudflare Pages custom domain. If that hostname is still attached to the Pages project, remove it in the Cloudflare Pages custom-domain settings.

## Information architecture

Left sidebar, in order:

1. Home — latest deals across every aisle
2. Guns — `/guns/`
3. Ammo — `/ammo/`
4. Optics — `/optics/`
5. Accessories — `/accessories/`
6. Apparel — `/apparel/`
7. Nylon — `/nylon/`
8. Food storage — `/food-storage/`
9. Survival — `/survival/`
10. Household goods — `/household/`
11. Gaming — `/gaming/`
12. Drones — `/drones/`

**Curated** sits on a lower rail with a badge. `/curated/` is a placeholder for hand-picked tips.

On a narrow screen the same list is a drawer (the Menu control). The menu opens without JavaScript. The small script closes the drawer on Escape or after a tap, and it applies the condition-tag chips on home and category pages. Without JavaScript those pages still list every deal.

Each deal also has a page under `/deals/<slug>/` with Product and Offer JSON-LD. Listing pages are real HTML, not an empty app shell.

## Deal data

`data/deals.json` holds 143 deals covering all eleven aisles. Each `url` is a clean HTTPS page on the named merchant: the product page when one is published, otherwise that merchant's category or search page for the product. These links do not include affiliate tracking parameters (`tag`, `linkId`, `utm_*`, or `ref_=as_li_*`). They render with `rel="sponsored noopener noreferrer"`. A deal with no listed price keeps `price_now` and `price_was` null and renders as a sale page. A deal with a current price and `price_was` null shows that price and omits the strikethrough and percent-off badge. Edit the JSON and rebuild to change the board.

A deal may include an optional `image` path such as `images/deals/<slug>.jpg`. The file lives in `public/images/deals/` and is copied into `dist/` at build time. Cards and deal pages render that thumbnail. A deal with no `image` renders a “No photo” frame instead of an `<img>`, so a missing file never becomes a broken image. Image values must be those local files — not remote URLs — which keeps the content security policy on `img-src 'self'`.

A deal may include an optional `tags` array of condition or source ids. Tags are not sidebar aisles. Known tags:

| id | Label |
| --- | --- |
| `used` | Used |
| `police-trade-in` | Police trade-in |

Home and each category page show chips for the tags present on that board. The chips filter the cards in the browser. Curated stays a separate rail.

The footer of every page includes the FTC affiliate disclosure.

## Expired deals

Each card and deal page has a quiet **Report expired** control. It does not ask for an account. The click `POST`s `{ "slug", "company" }` to `/api/report-expired`. `company` is a honeypot; a filled value is ignored. The same address can report a slug once per day, and at most eight reports an hour. The browser shows “Thanks — we'll check this deal.” Without JavaScript the rest of the card still works and the control does nothing.

Reports are stored in `data/expired-reports.json` (schema: `pipeline/schema/expired-report-queue.schema.json`):

```json
{
  "version": 1,
  "threshold": 3,
  "reports": [
    {
      "id": "20260923T160000Z-holosun-hs403b-aaaa12ab34",
      "slug": "holosun-hs403b",
      "reported_at": "2026-09-23T16:00:00.000Z",
      "source": "site",
      "status": "open",
      "ip_hash": "0123456789abcdef"
    }
  ]
}
```

`ip_hash` is a salted hash, not a raw address. Reports with an empty hash share one reporter, so they cannot meet the threshold by themselves. `status` is `open`, `dismissed`, or `removed`.

On Cloudflare Pages, `functions/api/report-expired.js` appends a row by committing that file through the GitHub Contents API. Set `GITHUB_TOKEN` (contents read/write on this repo) in Cloudflare Pages → Settings → Environment variables for Production (and Preview, if preview deployments should accept reports). Optional: `GITHUB_REPOSITORY` (`madmax0318/gearclearance`), `GITHUB_BRANCH` (`main`), and `REPORT_IP_SALT`. If the token is missing or blank the endpoint returns `503` with `queue_unconfigured` and stores nothing. Keep the token in the Pages secret store only.

Live slugs are taken from GitHub `data/deals.json` when that read returns a deal array. If it does not, the function tries the Pages `ASSETS` binding for `/report-slugs.json`, then the list `npm run build` writes to `functions/report-slugs.js` (the same slugs as `dist/report-slugs.json`). The function does not `fetch` this site’s own hostname; that same-zone subrequest aborted the Worker with Cloudflare error 1101. `npm run preview` writes the queue locally so the button can be tried without GitHub.

A deal leaves the public board only after it is marked expired and the site is rebuilt. Two equivalent shapes both drop it from home, aisles, curated, deal pages, and the sitemap:

- `"status": "expired"` on the row in `data/deals.json`
- the row moved to `data/expired/deals.json` with `"status": "expired"`

Removed rows are not kept on the board as expired cards. Old deal URLs fall through to the 404 page.

From the repo root:

```bash
node scripts/expire-deal.mjs triage
node scripts/expire-deal.mjs remove <slug> --by admin --reason "price reverted"
node scripts/expire-deal.mjs apply-ready --by ion-cannon --confirm ready
```

`triage` only prints a plan. `remove` moves one live row into `data/expired/deals.json`, sets `expired_at`, `expired_by`, and `expired_reason`, and marks that slug’s open reports `removed`. The merchant `url` is copied unchanged. `apply-ready` does that for every slug whose distinct reporters are at least `threshold` (3). It refuses to run without `--confirm ready`.

### Midday Ion Cannon job

The verifier is a separate local-LLM pass. It should not wrap links or invent affiliate parameters.

1. `git pull` so `data/expired-reports.json` includes reports committed by the Pages function.
2. `node scripts/expire-deal.mjs triage` (or, inside `pipeline/` after `npm install`, `node src/cli.js expired`).
3. For each object in `verify`, open `url` exactly as stored. The plan repeats that rule on `affiliate_policy`.
4. If the offer is gone or the price is no longer a markdown, run that item’s `remove.command`.
5. Commit `data/deals.json`, `data/expired/deals.json`, and `data/expired-reports.json`.
6. The next `npm run build` / Pages deploy omits the deal.

`verify` is empty until at least three distinct reporter hashes have an open report for a slug that is still live. A single admin can still remove a deal with `remove` before the threshold.

## Brand assets

`public/brand/stash-deals-logo.jpg` is the master poster (1152×1728). It is the source art only — it is not shipped to `dist/` and it does not belong in nav chrome, where a portrait poster cannot read.

Three derived assets are committed alongside it and are what the site actually serves:

| File | Size | Used for |
| --- | --- | --- |
| `stash-deals-emblem.jpg` | 320×320 | Sidebar lockup, `Organization.logo` |
| `stash-deals-og.jpg` | 1200×630 | `og:image` and `twitter:image` |
| `apple-touch-icon.png` | 180×180 | Bookmark icon |

Regenerate them from the poster with ffmpeg:

```bash
cd public/brand
ffmpeg -y -i stash-deals-logo.jpg -vf "crop=1020:1020:66:15,scale=320:320:flags=lanczos" -q:v 4 stash-deals-emblem.jpg
ffmpeg -y -i stash-deals-logo.jpg -vf "crop=1020:1020:66:15,scale=180:180:flags=lanczos" apple-touch-icon.png

# Social card: the poster's own emblem and wordmark, side by side on its cream background
ffmpeg -y -i stash-deals-logo.jpg -vf "crop=1020:1020:66:15,scale=520:520:flags=lanczos" /tmp/emb.png
ffmpeg -y -i stash-deals-logo.jpg -vf "crop=1075:640:40:995,scale=560:-1:flags=lanczos" /tmp/wm.png
ffmpeg -y -f lavfi -i "color=c=0xFCF0DC:s=1200x630" -i /tmp/emb.png -i /tmp/wm.png \
  -filter_complex "[0:v][1:v]overlay=58:55[a];[a][2:v]overlay=600:(H-h)/2" -frames:v 1 -q:v 4 stash-deals-og.jpg
```

Below roughly 48px the illustration stops reading, so the mobile topbar and `favicon.svg` use a vector crate mark built from the poster's ammo-crate and amber-label motifs rather than a shrunken photo.

## Layout

- `data/deals.json` — deal records
- `scripts/build.mjs` — writes `dist/`
- `scripts/preview.mjs` — local static server
- `src/site.css`, `src/nav.js`, `src/fonts/` — styles, drawer behavior, tag filters, OFL fonts
- `public/_headers`, `public/favicon.svg`, `public/brand/` — copied into `dist/` (see Brand assets)
- `pipeline/` — Ion Cannon parking-lot package (Collect → Clean → Wrap → Review → Publish), plus a local SQLite hist-price check that does not publish on its own. Not part of the Pages build. `npm test` runs that package and needs Node 22 after `npm install` inside `pipeline/`. See `pipeline/README.md`.
