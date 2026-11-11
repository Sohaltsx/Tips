# Sohal Gaming Tips 💸

A personal, zero-commission tipping page for the **Sohal Gaming** YouTube live streams.
Viewers tip via **Razorpay** (UPI, cards, net banking, wallets), and each successful tip
fires an on-stream **Streamlabs alert** with the viewer's name, amount and message (incl. TTS).

- Only cost: Razorpay's gateway fee (~2% + GST domestic).
- Hosting: GitHub Pages + Supabase free tier + Streamlabs free.
- Target: **GTA 6 launch streams — 19 Nov 2026**.
- Live at: `https://sohaltsx.github.io/Tips/`

> This repo is **public**. Never commit secrets. Only the Razorpay **key ID** (public by design)
> goes in `assets/config.js`; everything else lives in Supabase secrets.

---

## How it works

```
Viewer ──► GitHub Pages (index.html)
              │ 1. POST { name, amount, message }
              ▼
        Edge Function: create-order
              │ 2. validate + rate-limit → Razorpay order (receipt = tip id) → insert tip (pending)
              ▼
        Razorpay Checkout popup ──► viewer pays
              │ 3. webhook: payment.captured
              ▼
        Edge Function: razorpay-webhook
              │ 4. verify HMAC → check amount → mark paid → atomically claim alert → filter
              ▼
        Streamlabs POST /api/v1.0/donations ──► Alertbox in OBS (alert + TTS)
```

**The webhook is the single source of truth.** Alerts fire only after a signature-verified
`payment.captured` event — never from the browser. `success.html` is UI only.

## Project layout

```
index.html  success.html                 tip page + thank-you page
terms.html  privacy.html  refunds.html  contact.html   (needed for Razorpay website review)
assets/     config.js (public config) · app.js · style.css · logo.webp
supabase/
  schema.sql                              tips + rate_limits tables, RLS on, no public policies
  config.toml                             verify_jwt = false for all three functions
  functions/
    create-order/      razorpay-webhook/      health/
    _shared/  cors.ts · db.ts · filter.ts · signature.ts · streamlabs.ts
tests/shared.test.ts                      unit tests (filter, signature, Streamlabs name)
scripts/serve.mjs                         local static server (http://localhost:8080)
scripts/webhook-test.mjs                  fake/signed webhook checks against the deployed function
.github/workflows/pages.yml               deploys only *.html + assets/ to GitHub Pages
```

Brand: `#111111` background · `#f20d24` accent · `#ffffff` text · `#343434` lines.

---

## Setup

### 0. Before you start (do these first — they take the longest)
- **Razorpay KYC**: sign up as *Individual / Unregistered business* (personal PAN). Live activation
  includes a website review that checks the Terms / Privacy / Refunds / Contact pages, so deploy the
  site and **fill in the placeholders** in those pages (`[YOUR LEGAL NAME as on PAN]`,
  `[YOUR CONTACT EMAIL]`, `[YOUR CITY, STATE]`) before submitting.
- **Streamlabs token** (see step 4).

### 1. Supabase
1. Create a free project at supabase.com. Note the **project ref** (`https://<ref>.supabase.co`).
2. Dashboard → SQL Editor → paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. Install the CLI (`npm i -g supabase` or `scoop install supabase`), then:
   ```bash
   supabase login
   supabase link --project-ref <ref>
   ```

### 2. Razorpay (Test Mode)
1. Dashboard → switch to **Test Mode** → Account & Settings → API Keys → generate `rzp_test_…` keys.
2. Settings → Payment capture → make sure payments are **auto-captured**.
3. Webhooks → Add: URL `https://<ref>.supabase.co/functions/v1/razorpay-webhook`,
   event **`payment.captured`**, set a strong secret.

### 3. Secrets & deploy functions
```bash
cp .env.example .env      # fill in values; .env is git-ignored
supabase secrets set --env-file .env
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy health --no-verify-jwt
```
`--no-verify-jwt` is required: the browser, Razorpay and the keep-alive ping have no Supabase JWT.
(`config.toml` sets the same thing.) Each function does its own checks instead.

### 4. Streamlabs
1. streamlabs.com → Settings → API Settings → **Register an App** (whitelist your own account), then
   complete the OAuth flow with scope **`donations.create`** to get an access token
   (or use the "API Access Token" shown under API Settings → API Tokens if your account has it).
2. Put it in `.env` as `STREAMLABS_ACCESS_TOKEN` and re-run `supabase secrets set --env-file .env`.
3. Alertbox → Donations: image/GIF, sound, TTS voice (Hindi/English), **TTS min amount ₹50**.
4. Add the Alertbox URL as a Browser Source in OBS.

Streamlabs only accepts donor names of **2–25 letters/digits/underscores**, so the webhook sends a
safe version (`Rahul Kumar` → `Rahul_Kumar`; non-Latin-only names → `Anonymous`). The original
name is kept in the database.

### 5. Site config & GitHub Pages
1. Edit [`assets/config.js`](assets/config.js): set `SUPABASE_FUNCTIONS_URL` (your ref),
   `RAZORPAY_KEY_ID` (`rzp_test_…`), and `CHANNEL_URL`.
2. GitHub repo → Settings → Pages → Source: **GitHub Actions**.
3. Push to `main`. The workflow publishes only the HTML pages and `assets/`.

### Going live
1. After KYC approval: switch the Razorpay dashboard to **Live Mode**, generate live keys, add the
   same webhook (live mode has its own webhook + secret).
2. Update `.env` (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) →
   `supabase secrets set --env-file .env`.
3. Update `RAZORPAY_KEY_ID` in `assets/config.js` to `rzp_live_…` and push. (The key ID is public;
   the Pages workflow refuses to deploy only if a real secret pattern shows up in the site files.)
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
RAZORPAY_WEBHOOK_SECRET=<secret> node scripts/webhook-test.mjs https://<ref>.supabase.co/functions/v1/razorpay-webhook
```
(PowerShell: `$env:RAZORPAY_WEBHOOK_SECRET="<secret>"; node scripts/webhook-test.mjs <url>`)
Checks: bad/missing signature → 400; signed unknown order → 200 ignored; other events → 200 ignored.

### Manual checklist (Razorpay Test Mode)

| Test | How | Expected |
|---|---|---|
| UPI success | UPI ID `success@razorpay` | Tip = paid, alert in OBS within ~3 s |
| UPI failure | UPI ID `failure@razorpay` | Tip stays pending, no alert |
| Card success | `4100 2800 0000 1007`, any CVV, future date | Alert shows |
| Duplicate webhook | Razorpay Dashboard → Webhooks → Resend a delivered event | Only ONE alert |
| Fake webhook | `scripts/webhook-test.mjs` | 400, no alert |
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
creates the Razorpay order with `receipt = tip id`, then inserts the pending tip.

**razorpay-webhook** — verifies `X-Razorpay-Signature` over the raw body (constant-time); handles
only `payment.captured`; rejects amount/currency mismatches; marks the tip paid; claims the alert
with a single `UPDATE … WHERE alert_sent = false` so concurrent retries can't double-alert. If the
Streamlabs call fails, the claim is released and the function returns 500 so Razorpay retries.

**filter** — strips HTML, URLs, @mentions, control chars; caps repeated characters at 3 and emoji
at 5; masks words from `BLOCK_ANYWHERE` / `BLOCK_WORDS` in
[`filter.ts`](supabase/functions/_shared/filter.ts) (English, Hinglish, Devanagari) after undoing
leetspeak; abusive names → "Anonymous"; hard cap 200 chars.

**health** — trivial DB query, returns `{ ok: true }`.

## Phases

- **Phase 1 – Core (by 19 Nov):** ✅ schema, create-order, razorpay-webhook, health, tip + success
  pages, config, Pages deploy — plus the four compliance pages (moved up from Phase 2 because
  Razorpay's live review needs them).
- **Phase 2:** keep-alive workflow (`.github/workflows/keepalive.yml` pinging `/health` every 2 days).
- **Phase 3:** goal bar + recent-tips overlay (Supabase Realtime), monthly leaderboard, admin page.

## Phase 1 definition of done
- [ ] A test payment with `success@razorpay` shows a Streamlabs alert in OBS within ~3 s.
- [ ] No secret in the repo (`git grep -nE "rzp_live|secret|token"` shows nothing sensitive).
- [x] Signature verification unit-tested; [ ] idempotency tested via webhook resend.
- [ ] Site live at `https://sohaltsx.github.io/Tips/`.
- [x] README has real setup notes.
