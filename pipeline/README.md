# The Stash Deals pipeline (Ion Cannon)

Parking-lot package for [thestash.deals](https://thestash.deals). It drafts deal rows on Ion Cannon (Ubuntu, Node 18+, optional local Ollama). It does **not** run during `npm run build`, and it does not edit `data/deals.json` or the Impact / AvantLink tags on the static site.

Locked order: **Collect → Clean → Wrap → Review → Publish.**

| Stage | Module | Behavior |
| --- | --- | --- |
| Collect | `src/parse-email.js` | `.eml` or plain text → candidate JSON |
| Clean | `src/clean-url.js` | Strip `utm_*`, `fbclid`, `gclid`, `mc_eid`, `wickedid`, and foreign affiliate params. Keep product params such as `sku`. |
| Wrap | `src/wrap.js` | Apply the merchant map. No map row, or no publisher id in the environment → clean `source_url` and `needs_affiliate: true`. |
| Review | caller | Human status. This package does not approve deals. |
| Publish | `src/publish.js` | Off unless `AUTO_PUBLISH=1` **and** `review.status` is `approved`. Writes an in-memory outbox only. |

## Standing publish

**Dave must grant standing publish before anyone sets `AUTO_PUBLISH=1`.**

The default is off (`AUTO_PUBLISH=0`, and an unset variable is also off). Only the exact value `1` counts. An approved review with the flag off stays in review. A flag of `1` with any other review status stays in review. Enabling the flag does not deploy the site and does not change live deal cards.

## Paid ads

`src/ads.js` is a scaffold for soft goods only: Household, Food storage, and accessories that are not weapon-related. It throws `ADS_WEAPONS_REFUSED` for Guns, Ammo, optics, or weapons-related copy (including weapon lights and magazines). It does not call Meta or X.

## Ion Cannon

From the repo root:

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

Optional Ollama on the box (`qwen3.5:35b` at `http://127.0.0.1:11434`):

```bash
cd pipeline
USE_OLLAMA=1 \
OLLAMA_HOST=http://127.0.0.1:11434 \
OLLAMA_MODEL=qwen3.5:35b \
node src/cli.js parse fixtures/emails/primary-arms-hs403b.eml
```

If Ollama is down, times out, or returns a URL or price that is not in the message, the command keeps the heuristic candidate and says so in `notes`. Model output cannot set `needs_affiliate` to false and cannot supply `affiliate_url`. Affiliate query params the model adds are stripped.

Other commands:

```bash
node src/cli.js wrap 'https://www.primaryarms.com/example-product?utm_source=email'
node src/cli.js publish --review approved
node src/cli.js ads --aisle household --title 'Portable power station'
```

`wrap` reads `pipeline/data/merchant-map.example.json` unless you pass `--map`. `publish` prints the gate decision for the current environment and does not deploy. `ads` exits non-zero for guns, ammo, and weapons-related items.

## Environment

Copy `pipeline/.env.example` to `pipeline/.env` on the machine. `.env` is gitignored. Publisher IDs stay in Proton Pass and are exported into the shell only when wrapping:

- `AVANTLINK_AID`
- `IMPACT_PUBLISHER_ID`
- `CJ_PID`
- `AMAZON_ASSOCIATES_TAG`

Empty or missing ids fail closed. The example map uses `https://network.example.test/...` templates with `{{ENCODED_URL}}` and `{{AVANTLINK_AID}}` style placeholders. Replace a template from the network’s deep-link tool when a merchant is actually live. Do not commit the filled id. Rows with status `pending_approval`, `none`, or `blocked_tos` never wrap.

## Candidate row

`schema/candidate-deal.schema.json`:

`source_url`, `title`, `price`, `merchant_domain`, `aisle`, `raw_subject`, `raw_from`, `received_at`, `confidence`, `needs_affiliate`, `notes`.

Aisles match the site: guns, ammo, optics, accessories, apparel, food-storage, survival, household, gaming, drones. Unknown values stay null instead of being guessed into a paid-ads category.

## Fixtures

Invented sale mail, no personal data:

- `fixtures/emails/primary-arms-hs403b.eml` — multipart, quoted-printable, HTML hopper ignored
- `fixtures/emails/emergency-food-kit.txt` — plain text, no headers
- `fixtures/emails/midway-9mm-sale.eml` — foreign `tag=` must be stripped

## What this package will not do

- Invent affiliate tags, MIDs, or publisher ids
- Publish because a model or a missing map said so
- Buy Meta or X ads for guns, ammo, or weapons-related gear
- Remove the site’s Impact universal tag or AvantLink confirmation file
