# The Stash Deals pipeline

Parking-lot package for [thestash.deals](https://thestash.deals). It drafts deal rows on the local runner (Node 22, optional local model). It does **not** run during `npm run build`, and it does not edit `data/deals.json` or the Impact / AvantLink tags on the static site.

Locked order: **Collect → Clean → Wrap → Review → Publish.**

| Stage | Module | Behavior |
| --- | --- | --- |
| Collect | `src/parse-email.js` | `.eml` or plain text → candidate JSON |
| Clean | `src/clean-url.js` | Strip `utm_*`, `fbclid`, `gclid`, `mc_eid`, `wickedid`, and foreign affiliate params. Keep product params such as `sku`. |
| Wrap | `src/wrap.js` | Apply the merchant map. No map row, or no publisher id in the environment → clean `source_url` and `needs_affiliate: true`. |
| Review | caller | Human status. This package does not approve deals. |
| Publish | `src/publish.js` | Off unless `AUTO_PUBLISH=1` **and** `review.status` is `approved`. Writes an in-memory outbox only. |
| Hist price | `src/price-history.js` | Local SQLite check after wrap and before the publish decision. Flags weak deals. Does not block publish. |

## Standing publish

**Dave must grant standing publish before anyone sets `AUTO_PUBLISH=1`.**

The default is off (`AUTO_PUBLISH=0`, and an unset variable is also off). Only the exact value `1` counts. An approved review with the flag off stays in review. A flag of `1` with any other review status stays in review. Enabling the flag does not deploy the site and does not change live deal cards.

## Banned brands

Dave banned three brands from [thestash.deals](https://thestash.deals). The source of truth is `data/banned-brands.json` at the repo root (brand name, word-boundary patterns, and a scope note). Matching is case-insensitive.

- **CAA (Command Arms Accessories)** — the standalone word `CAA`, or `Command Arms` (including a slug like `command-arms`). `CAA` inside another word does not match.
- **Uncle Mike's** — `Uncle Mike's`, `Uncle Mikes`, and slug form `uncle-mikes`.
- **BlackHawk SERPA** — only SERPA items (holsters, QD, and other attachments whose name includes the word `SERPA`). BlackHawk nylon (packs, pouches, slings) and BlackHawk knives are wanted and must pass.

Collect/Clean rejects a matching candidate before Wrap. The candidate is omitted from the card queue and the reason is logged as `banned-brand` plus the brand name and scope note. `AUTO_PUBLISH` is unchanged: the flag still defaults off, and this filter does not publish or unpublish anything by itself. `npm run build` fails closed if a live row in `data/deals.json` matches the same list.

Future collector runs (PreppingDeals, AIM, sale-email WATCH, or anything else that drafts through this package) must skip these brands. Do not add affiliate parameters while dropping one. Merchant URLs stay bare.

## Historical price gate

Before review hands off to publish, each candidate is looked up in a local SQLite file (`src/price-history.js`). The result is attached as `hist_price` (`ok`, `weak`, or `unknown`). Publish stays human-gated: `AUTO_PUBLISH` still defaults off, and a weak or unknown price does not block the outbox.

The database file is `pipeline/data/price_history.sqlite` (gitignored). Override it with `PRICE_HISTORY_DB`. Install the native driver once, then create or migrate the table (opening the file also runs `CREATE TABLE IF NOT EXISTS`):

```bash
cd pipeline
npm install
node src/cli.js price-history init
```

`better-sqlite3` needs Node 22 or newer. Rows are keyed by merchant plus a normalized title, and by SKU when one is present. Each row stores the raw title, price, currency, source, `seen_at`, and aisle or category.

- No matching rows: `hist` is `unknown`. The candidate price is inserted as an ingest snapshot so the next run has history. Unknown does not drop the deal.
- A price must be at least 5% under `min(last_seen, p50_30d)` (`HIST_DEAL_THRESHOLD`) to be `ok`. Anything else with history is `weak` (flagged, still eligible for human review).
- After a successful outbox publish (`AUTO_PUBLISH=1` and `review.status` approved), another snapshot is stored. The scaffold still does not write `data/deals.json`.

Ammo aisles can attach a best-effort Ammoseek cost-per-round when `AMMOSEEK_ENRICH=1`. Cloudflare, timeouts, and other failures skip that enrichment and keep the SQLite result. They never block publish. Gaming, household, and food-storage Amazon history (CamelCamelCamel / Keepa) is a later stub only and is not implemented.

## Paid ads

`src/ads.js` is a scaffold for soft goods only: Household, Food storage, and accessories that are not weapon-related. It throws `ADS_WEAPONS_REFUSED` for Guns, Ammo, optics, or weapons-related copy (including weapon lights and magazines). It does not call Meta or X.

## Local runner

From the repo root, after `npm install` inside `pipeline/` (needed for `better-sqlite3`):

```bash
npm test
```

That runs this package’s `node --test` suite. The site build is still `npm run build`.

Parser against a fixture, heuristic only (Ollama stays off):

```bash
cd pipeline
node src/cli.js parse fixtures/emails/primary-arms-hs403b.eml
node src/cli.js parse fixtures/emails/emergency-food-kit.txt
node src/cli.js parse fixtures/emails/midway-9mm-sale.eml
```

Stdout is JSON. `needs_affiliate` is true. `source_url` is the cleaned merchant URL. Tracker and foreign `tag=` parameters are removed. Nothing in the parser invents a network tag, MID, or publisher id.

Optional local model. Set the host to the loopback form in `pipeline/.env.example` and the model tag from the private config:

```bash
cd pipeline
USE_OLLAMA=1 \
OLLAMA_HOST=http://127.0.0.1:<port> \
OLLAMA_MODEL=<model-tag> \
node src/cli.js parse fixtures/emails/primary-arms-hs403b.eml
```

If Ollama is down, times out, or returns a URL or price that is not in the message, the command keeps the heuristic candidate and says so in `notes`. Model output cannot set `needs_affiliate` to false and cannot supply `affiliate_url`. Affiliate query params the model adds are stripped.

Other commands:

```bash
node src/cli.js wrap 'https://www.primaryarms.com/example-product?utm_source=email'
node src/cli.js publish --review approved
node src/cli.js ads --aisle household --title 'Portable power station'
```

`wrap` reads `pipeline/data/merchant-map.example.json` unless you pass `--map`. `publish` prints the gate decision for the current environment and does not deploy. `ads` exits non-zero for guns, ammo, and weapons-related items. `price-history init` creates the local hist-price database.

## Expired deals (midday check)

Reader reports live in `data/expired-reports.json` at the repo root. The shape is `schema/expired-report-queue.schema.json`. This package does not turn a report into a publish, and it does not invent an affiliate tag while checking a URL.

A midday job on the runner:

```bash
node src/cli.js expired
```

That prints the same plan as `node scripts/expire-deal.mjs triage` from the repo root: slugs with at least `threshold` distinct open reporters, the stored merchant `url`, and `remove.command`. Fetch that URL as stored. If the offer is gone or the markdown is gone, run the command, then commit `data/deals.json`, `data/expired/deals.json`, and `data/expired-reports.json`. The next site build drops the deal. See the root README section “Expired deals”.

## Environment

Copy `pipeline/.env.example` to `pipeline/.env` on the runner. `.env` is gitignored. Publisher ids are exported into the shell only when wrapping:

- `AVANTLINK_AID`
- `IMPACT_PUBLISHER_ID`
- `CJ_PID`
- `AMAZON_ASSOCIATES_TAG`

Empty or missing ids fail closed. The example map uses `https://network.example.test/...` templates with `{{ENCODED_URL}}` and `{{AVANTLINK_AID}}` style placeholders. Replace a template from the network’s deep-link tool when a merchant is actually live. Do not commit the filled id. Rows with status `pending_approval`, `none`, or `blocked_tos` never wrap.

## Candidate row

`schema/candidate-deal.schema.json`:

`source_url`, `title`, `price`, `merchant_domain`, `aisle`, `raw_subject`, `raw_from`, `received_at`, `confidence`, `needs_affiliate`, `notes`.

Aisles match the site: guns, ammo, optics, accessories, apparel, nylon, food-storage, survival, household, gaming, drones. Unknown values stay null instead of being guessed into a paid-ads category.

## Fixtures

Invented sale mail, no personal data:

- `fixtures/emails/primary-arms-hs403b.eml` — multipart, quoted-printable, HTML hopper ignored
- `fixtures/emails/emergency-food-kit.txt` — plain text, no headers
- `fixtures/emails/midway-9mm-sale.eml` — foreign `tag=` must be stripped

## What this package will not do

- Invent affiliate tags, MIDs, or publisher ids
- Draft or publish CAA (Command Arms Accessories), Uncle Mike's, or BlackHawk SERPA items. BlackHawk nylon (packs, pouches, slings) and BlackHawk knives stay allowed.
- Publish because a model or a missing map said so
- Buy Meta or X ads for guns, ammo, or weapons-related gear
- Remove the site’s Impact universal tag or AvantLink confirmation file
