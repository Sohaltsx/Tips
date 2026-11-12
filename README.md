# Sohal Gaming Tips 💸

A personal, zero-commission tipping page for the **Sohal Gaming** YouTube live streams.
Viewers tip via **Cashfree** (UPI, cards, net banking, wallets), and each successful tip
fires an on-stream **Streamlabs alert** with the viewer's name, amount and message (incl. TTS).
Razorpay is still supported as a fallback (`PAYMENT_GATEWAY=razorpay`), but Razorpay would not
onboard an individual YouTube streamer, so Cashfree is the default.

- Only cost: the gateway fee (~2% + GST domestic).
- Hosting: GitHub Pages + Supabase free tier + Streamlabs free.
- Target: **GTA 6 launch streams — 19 Nov 2026**.
- Live at: `https://sohaltsx.github.io/Tips/`
- **What to do next: [Next steps](#next-steps)** · progress log: [STATUS.md](STATUS.md)

> This repo is **public**. Never commit secrets. `assets/config.js` holds only public settings
> (gateway name, Cashfree mode, Razorpay key ID); every secret lives in Supabase secrets.

---

## How it works

```
Viewer ──► GitHub Pages (index.html)
              │ 1. POST { name, amount, message, phone }
              ▼
        Edge Function: create-order
              │ 2. validate + rate-limit → insert tip (pending) → Cashfree order (order_id = tip id,
              │    notify_url = cashfree-webhook) → payment_session_id
              ▼
        Cashfree Checkout popup ──► viewer pays ──► success.html?order_id=… (asks verify-payment)
              │ 3. webhook: PAYMENT_SUCCESS_WEBHOOK
              ▼
        Edge Function: cashfree-webhook
              │ 4. verify signature → check amount → mark paid → atomically claim alert → filter
              ▼
        Streamlabs POST /api/v2.0/donations ──► Alertbox in OBS (alert + TTS)
```

**The webhook is the single source of truth.** Alerts fire only after a signature-verified
success webhook, never from the browser. `success.html` and `verify-payment` are UI only.

The viewer's mobile number is required by Cashfree. It is sent to Cashfree only and is
**not stored** in our database.

## Project layout

```
index.html  success.html                 tip page + thank-you page
terms.html  privacy.html  refunds.html  contact.html   (needed for the gateway's website review)
assets/     config.js (public config) · app.js · style.css · logo.webp
supabase/
  migrations/20261111000000_init.sql      tips + rate_limits tables, RLS on, no public policies
  migrations/20261112000000_gateway_agnostic.sql   order_id / payment_id / gateway columns
  config.toml                             verify_jwt = false for every function
  functions/
    create-order/   cashfree-webhook/   razorpay-webhook/   verify-payment/   health/
    _shared/  cashfree.ts · cors.ts · db.ts · filter.ts · fulfil.ts · signature.ts · streamlabs.ts
tests/shared.test.ts                      unit tests (filter, signatures, phone, Streamlabs name)
scripts/serve.mjs                         local static server (http://localhost:8080)
scripts/cashfree-webhook-test.mjs         fake/signed webhook checks against the deployed Cashfree webhook
scripts/webhook-test.mjs                  same for the Razorpay webhook (fallback)
streamlabs/alertbox/                      branded Alertbox custom HTML/CSS/JS (tips + YouTube subs) + fields + preview
.github/workflows/pages.yml               deploys only *.html + assets/ to GitHub Pages
```

Brand: `#111111` background · `#f20d24` accent · `#ffffff` text · `#343434` lines.

---

## Setup

### 0. Before you start (do these first — they take the longest)
- **Cashfree KYC**: sign up at merchant.cashfree.com as **Individual (unregistered)** with personal
  PAN, Aadhaar and bank account; describe the business as *content creator / digital tips for
  live streams* and give the site URL. Live activation
  includes a website review that checks the Terms / Privacy / Refunds / Contact pages, so deploy the
  site and **fill in the placeholders** in those pages (`[YOUR LEGAL NAME as on PAN]`,
  `[YOUR CONTACT EMAIL]`, `[YOUR CITY, STATE]`) before submitting.
- **Streamlabs token** (see step 4).

### 1. Supabase
1. Create a free project at supabase.com. Note the **project ref** (`https://<ref>.supabase.co`).
2. Database schema lives in [`supabase/migrations/`](supabase/migrations/). With the Supabase ↔ GitHub
   integration (Project Settings → Integrations → GitHub, Supabase directory `.`, production branch
   `main`), pushes to `main` apply new migrations automatically. Without it, paste the migration into
   Dashboard → SQL Editor and run it, or run `supabase db push`.
3. Install the CLI (`npm i -g supabase` or `scoop install supabase`), then:
   ```bash
   supabase login
   supabase link --project-ref <ref>
   ```

### 2. Cashfree (Test / sandbox)
1. Merchant Dashboard → switch to **Test** → Developers → API Keys → generate the
   **App ID** and **Secret Key**. Put them in `.env` as `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY`,
   with `CASHFREE_ENV=sandbox`.
2. Developers → **Whitelisting** → add the site domain `sohaltsx.github.io` (Cashfree only opens
   Checkout on whitelisted domains; production needs this too).
3. Webhooks: nothing to do. `create-order` sets each order's `notify_url` to
   `https://<ref>.supabase.co/functions/v1/cashfree-webhook`. Optionally also add that URL under
   Developers → Webhooks (Payment, success event) as a backup; duplicates are harmless.
   The webhook is signed with the **Secret Key**, so there is no separate webhook secret.

(Razorpay fallback: Test Mode → API Keys → `rzp_test_…` keys; auto-capture on; webhook
`…/functions/v1/razorpay-webhook`, event `payment.captured`, with its own secret. Then set
`PAYMENT_GATEWAY=razorpay` in both `.env` and `assets/config.js`.)

### 3. Secrets & deploy functions
```bash
cp .env.example .env      # fill in values; .env is git-ignored
supabase secrets set --env-file .env
supabase db push                      # applies the gateway_agnostic migration
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy cashfree-webhook --no-verify-jwt
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy health --no-verify-jwt
supabase functions deploy verify-payment --no-verify-jwt
```
(On Windows PowerShell, use `npx.cmd supabase …` if `npx` is blocked by the execution policy.)

Deploy the migration and **all** functions together: the migration renames
`razorpay_order_id` → `order_id` and `razorpay_payment_id` → `payment_id`.

`verify-payment` lets `success.html` show the right message. For Cashfree it asks Cashfree for the
order status (`PAID` / `ACTIVE` / `EXPIRED`); for Razorpay it checks the Checkout signature
`HMAC-SHA256(order_id|payment_id, key_secret)`. It never marks a tip paid or fires an alert —
that stays with the signed webhook.
`--no-verify-jwt` is required: the browser, the gateways and the keep-alive ping have no Supabase JWT.
(`config.toml` sets the same thing.) Each function does its own checks instead.

### 4. Streamlabs
1. streamlabs.com → Account Settings → API Settings → **Register App** (whitelist your own account,
   redirect URL `http://localhost:8787/callback`). Put the Client ID / Secret in `.env` as
   `STREAMLABS_CLIENT_ID` / `STREAMLABS_CLIENT_SECRET`.
   (The "API Access Token" on the API Tokens tab does **not** work — the API returns 401.)
2. Run `node --env-file=.env scripts/streamlabs-auth.mjs`, open the link, Approve — it saves an
   OAuth token with `donations.create` into `.env` as `STREAMLABS_ACCESS_TOKEN`. Then re-run
   `supabase secrets set --env-file .env`.
3. Alertbox → Donations: image/GIF, sound, TTS voice (Hindi/English), **TTS min amount ₹50**.
4. Add the Alertbox URL as a Browser Source in OBS.
5. **Branded alert (custom code):** Alert Box → **Tips** → **Custom HTML/CSS** (enable it), then
   paste [`streamlabs/alertbox/alert.html`](streamlabs/alertbox/alert.html), `alert.css` and
   `alert.js` into the HTML / CSS / JS tabs, and `fields.json` via **Add Custom Fields**.
   **Save Settings**, then **Test → Streamlabs → Tipping**. Recommended: Layout = *Text Over Image*, duration 8–10 s,
   animation in/out = *fade*. The custom fields let you change the accent colour, the
   "Big tip" threshold (default ₹500, adds a stronger glow + shake).
   Preview locally without Streamlabs: `node scripts/serve.mjs` →
   http://localhost:8080/streamlabs/alertbox/preview.html (pick *Tip* or *YouTube subscriber*).
6. **YouTube subscriber alert:** Alert Box → **YouTube → Subscribers** → **Custom HTML/CSS**: paste
   `subscriber.html` (HTML), the same `alert.css` (CSS) and `subscriber.js` (JS); Layout =
   *Text Over Image*. Shows "NEW SUBSCRIBER", the name, and a red **Subscribe** button that flips
   to **🔔 Subscribed**. Test with **Test → YouTube → Subscribers**.
   If you skip Custom Fields, replace `{accentColor}` in the CSS with `#f20d24`.

Only keep the Alert Box open in OBS while testing — every open copy (the **Launch** tab, a dashboard
with Live Preview, duplicate OBS sources) plays the alert sound again.

Streamlabs only accepts donor names of **2–25 letters/digits/underscores**, so the webhook sends a
safe version (`Rahul Kumar` → `Rahul_Kumar`; non-Latin-only names → `Anonymous`). The original
name is kept in the database.

### 5. Site config & GitHub Pages
1. Edit [`assets/config.js`](assets/config.js): set `SUPABASE_FUNCTIONS_URL` (your ref),
   `PAYMENT_GATEWAY` (`cashfree`), `CASHFREE_MODE` (`sandbox`), and `CHANNEL_URL`.
2. GitHub repo → Settings → Pages → Source: **GitHub Actions**.
3. Push to `main`. The workflow publishes only the HTML pages and `assets/`.

### Going live
1. After KYC approval: switch the Cashfree dashboard to **Production**, generate live API keys,
   and whitelist `sohaltsx.github.io` there too.
2. Update `.env` (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=production`) →
   `supabase secrets set --env-file .env`.
3. Set `CASHFREE_MODE: "production"` in `assets/config.js` and push. (The server's reply also tells
   the page which mode to use. The Pages workflow refuses to deploy if a real secret pattern shows
   up in the site files.)
4. Remove `http://localhost:8080` from `ALLOWED_ORIGIN`.
5. Pay ₹10 from your own phone and confirm the alert.
6. Later: request **International Payments** activation.

---

## Testing

### Local
```bash
node --test tests/shared.test.ts    # filter, signature, Streamlabs-name unit tests
node scripts/serve.mjs              # site at http://localhost:8080
```
To test `create-order` from localhost, keep `http://localhost:8080` in `ALLOWED_ORIGIN`
(remove it at go-live).

### Against the deployed webhook
```bash
CASHFREE_SECRET_KEY=<secret> node scripts/cashfree-webhook-test.mjs https://<ref>.supabase.co/functions/v1/cashfree-webhook
```
(PowerShell: `$env:CASHFREE_SECRET_KEY="<secret>"; node scripts/cashfree-webhook-test.mjs <url>`)
Checks: bad/missing signature → 400; signed unknown order → 200 ignored; other events → 200 ignored.
For the Razorpay fallback: `RAZORPAY_WEBHOOK_SECRET=<secret> node scripts/webhook-test.mjs <url>`.

### Manual checklist (Cashfree sandbox)

Use the test UPI IDs / cards shown in the sandbox Checkout and in Cashfree's docs
(Payments → Test data). Any valid-looking 10-digit mobile works in sandbox.

| Test | How | Expected |
|---|---|---|
| UPI success | Sandbox success UPI ID | Thank-you page, tip = paid, alert in OBS within ~3 s |
| UPI failure | Sandbox failure UPI ID | "Payment not completed", tip stays pending, no alert |
| Close popup | Close Checkout without paying | Error on the tip page, no alert |
| Card success | Sandbox test card | Alert shows |
| Duplicate webhook | Dashboard → Developers → Webhooks → logs → resend | Only ONE alert |
| Fake webhook | `scripts/cashfree-webhook-test.mjs` | 400, no alert |
| Bad phone | `12345` | Rejected on the page and by `create-order` (400) |
| Bad input | Amount 5, 300-char message | Rejected by `create-order` (400) |
| Abuse filter | Message with blocked words / links | Masked/removed in the alert |
| Mobile | Open the page on a phone | Layout OK, Checkout opens |
| Live smoke test | Live keys, pay ₹10 from own phone | Real alert |

Useful SQL (Dashboard → SQL Editor):
```sql
select created_at, name, amount_paise/100 as rupees, status, alert_sent, mode
from tips order by created_at desc limit 20;
```

---

## Behaviour details

**create-order** — CORS limited to `ALLOWED_ORIGIN` (comma-separated); name 1–30 chars, whole
rupees within `MIN_AMOUNT`–`MAX_AMOUNT`, message ≤ 200 chars; max 5 orders per IP per minute
(SHA-256-hashed IP in `rate_limits`, rows pruned after an hour); generates the tip id first,
then for Cashfree: requires a valid 10-digit Indian mobile (`+91`/`0` prefixes accepted), inserts
the pending tip, then creates the Cashfree order with `order_id = tip id`, `return_url` =
`SITE_URL/success.html?order_id={order_id}` and `notify_url` = the cashfree-webhook URL. For
Razorpay: creates the order with `receipt = tip id`, then inserts the pending tip.

**cashfree-webhook** — verifies `x-webhook-signature` =
`base64(HMAC-SHA256(x-webhook-timestamp + rawBody, CASHFREE_SECRET_KEY))` (constant-time); handles
only `PAYMENT_SUCCESS_WEBHOOK` with `payment_status = SUCCESS`; rejects amount/currency mismatches;
then the shared `fulfil.ts` step: mark the tip paid, claim the alert with a single
`UPDATE … WHERE alert_sent = false` so concurrent retries can't double-alert, send to Streamlabs.
If Streamlabs fails, the claim is released and the function returns 500 so the gateway retries.

**razorpay-webhook** — same, for Razorpay: verifies `X-Razorpay-Signature` over the raw body and
handles only `payment.captured`.

**filter** — strips HTML, URLs, @mentions, control chars; caps repeated characters at 3 and emoji
at 5; masks words from `BLOCK_ANYWHERE` / `BLOCK_WORDS` in
[`filter.ts`](supabase/functions/_shared/filter.ts) (English, Hinglish, Devanagari) after undoing
leetspeak; abusive names → "Anonymous"; hard cap 200 chars.

**health** — trivial DB query, returns `{ ok: true }`.

## Next steps

Where things stand (12 Nov 2026): the Cashfree code is on `main` and the site is deployed, but
**tips won't work until the Supabase side is updated** (steps 2–3). Launch target: **19 Nov 2026**.
Day-to-day progress notes live in [STATUS.md](STATUS.md).

### 1. Cashfree account — in progress
- [ ] Finish sign-up at merchant.cashfree.com: brand `Sohal Gaming`, category *Content creator /
      Influencer / Media* (never Gaming, Donation or Crowdfunding), lowest turnover range.
- [ ] Business type **Individual** (or Sole Proprietorship), personal PAN, no GST, own bank account.
      Describe it as voluntary **tips** from live-stream viewers (not "donations").
- [x] Legal pages filled in (name as on PAN, contact email, Ludhiana, Punjab) — Cashfree
      reviews the website during KYC.
- [ ] Submit KYC and ask about the "Payment Gateway @ 0%" offer (which methods, how long, what cap).

### 2. Cashfree test setup (can start before KYC is approved)
- [ ] Test mode → Developers → API Keys → in `.env`: `PAYMENT_GATEWAY=cashfree`, `CASHFREE_APP_ID`,
      `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=sandbox`, `SITE_URL=https://sohaltsx.github.io/Tips`.
- [ ] `supabase secrets set --env-file .env`
- [ ] Developers → Whitelisting → add `sohaltsx.github.io`.

### 3. Deploy the backend
- [ ] `supabase db push` (renames `razorpay_*_id` → `order_id` / `payment_id`, adds `gateway`).
- [ ] Deploy all functions together, each with `--no-verify-jwt`: `create-order`,
      `cashfree-webhook`, `razorpay-webhook`, `verify-payment`, `health`.

### 4. Test in sandbox
- [ ] `CASHFREE_SECRET_KEY=… node scripts/cashfree-webhook-test.mjs https://<ref>.supabase.co/functions/v1/cashfree-webhook` → all PASS.
- [ ] Real sandbox tip on the live site → alert in OBS within ~3 s.
- [ ] Rest of the [manual checklist](#manual-checklist-cashfree-sandbox): failed payment, closed
      popup, duplicate webhook resend (only one alert), abuse filter, phone layout.

### 5. Stream setup
- [ ] Alert Box: image/sound, TTS voice, TTS min ₹50; Alert Box browser source in OBS.
- [ ] Put the tip link (`https://sohaltsx.github.io/Tips/`) in the YouTube description, pinned
      chat message and an on-screen QR code.

### 6. Go live (once KYC is approved — target 19 Nov)
- [ ] Production API keys → `.env` (`CASHFREE_ENV=production`) → `supabase secrets set`.
- [ ] `CASHFREE_MODE: "production"` in `assets/config.js`; whitelist the domain in production too.
- [ ] Remove `http://localhost:8080` from `ALLOWED_ORIGIN`.
- [ ] ₹10 live smoke test from your own phone → real alert.
- [ ] Clean up test rows (`delete from tips where mode = 'test';`) and Streamlabs test events.
- [ ] Optional: close the Razorpay ticket and regenerate its test secret (it was shared in a chat).

**Fallback if KYC isn't approved by launch day:** show your personal UPI QR on stream (no
automatic alerts), or use a UPI-alert app such as Stream Alert / StreamerHub for that stream.

### Later
- **Keep-alive:** GitHub Actions workflow pinging `/health` every 2 days so the free Supabase
  project doesn't pause.
- **Overlays:** tip goal bar and recent-tips ticker (Supabase Realtime).
- **Community:** monthly top-tippers leaderboard.
- **Admin page:** see tips, re-send an alert, mark refunds.
- **International tips:** request international payments on Cashfree.
