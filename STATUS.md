# Project status — Sohal Gaming Tips

Last updated: **11 Nov 2026** · Launch target: **19 Nov 2026** (GTA 6 streams)

Pick up from **[Next up](#next-up)**. Setup details live in the [README](README.md).

---

## ✅ Done

### Code (on `main`)
- Tip page, thank-you page, Terms / Privacy / Refunds / Contact pages in the brand colours
  (`#111111`, `#f20d24`, `#ffffff`, `#343434`) with the logo.
- Edge Functions: `create-order`, `razorpay-webhook`, `verify-payment`, `health`.
- Message/name filter (English, Hinglish, Devanagari), Streamlabs-safe names, atomic
  "send alert once" logic, amount check in the webhook.
- 10 unit tests passing (`node --test tests/shared.test.ts`).

### Hosting
- Repo is public; GitHub Pages deploys from `main` via GitHub Actions.
- Site live: **https://sohaltsx.github.io/Tips/**

### Supabase (project `pqvygvligzexbeloakkn`)
- CLI linked; migration applied → `tips` and `rate_limits` tables exist (RLS on, no public policies).
- All 4 functions deployed with `--no-verify-jwt`.
- Secrets set: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
  `ALLOWED_ORIGIN`, `MIN_AMOUNT`, `MAX_AMOUNT`, `STREAMLABS_ACCESS_TOKEN` (⚠ wrong kind — see below).

### Razorpay (Test Mode)
- Test keys generated; key ID in `assets/config.js`, secret only in Supabase + local `.env`.
- Webhook secret generated and stored in `.env` + Supabase.
- Support ticket submitted to fix the business category (was "Gaming → Game developer",
  should be content creator).

### Verified live
| Check | Result |
|---|---|
| `/health` (real DB query) | 200 `{ok:true}` |
| `create-order` valid ₹50 | 200, Razorpay test order created |
| `create-order` amount 5 / 300-char message | 400 |
| `create-order` from another origin | 403 |
| `verify-payment` missing / bad signature / unknown order | 400 |
| `verify-payment` good signature | 200 `verified: true` |
| Webhook bad / missing signature | 400 |
| Webhook signed, unknown order or other event | 200 ignored |
| Webhook signed `payment.captured` for test tip | Tip marked **paid**, Streamlabs call **failed (401)** → claim released, 500 returned |

---

## 🔴 Blocking: Streamlabs token

The "API Access Token" from Streamlabs → API Settings → API Tokens is **rejected by the
Streamlabs API** (401 `access_denied`). We need an **OAuth token with `donations.create`**.

## Next up

1. **Finish Streamlabs app registration** (Streamlabs → Account Settings → API Settings → Register App)
   - Whitelist: platform you log in with (YouTube) + your account name; optionally add `sohal0072`.
   - Redirect URL: `http://localhost:8787/callback`
   - Click **Complete** → copy **Client ID** and **Client Secret** into `.env`
     (`STREAMLABS_CLIENT_ID=`, `STREAMLABS_CLIENT_SECRET=`). Never paste them in chat.
2. **Get the OAuth token:** `node --env-file=.env scripts/streamlabs-auth.mjs` → open the link →
   Approve. It writes `STREAMLABS_ACCESS_TOKEN` into `.env`.
3. **Push it:** `npx.cmd supabase secrets set --env-file .env`
4. **Retry the test alert:** resend the signed webhook for the pending test tip
   (order `order_TyvlCxh7CB406Q`, ₹50, name "Claude Test") → alert should show in the Alert Box.
   Resend again → must **not** show a second alert.
5. **Razorpay test webhook:** confirm it is added in the dashboard (Test Mode → Webhooks):
   URL `https://pqvygvligzexbeloakkn.supabase.co/functions/v1/razorpay-webhook`,
   event `payment.captured`, secret = `RAZORPAY_WEBHOOK_SECRET` from `.env`.
6. **Real test payment on the site:** tip ₹50 with UPI `success@razorpay` → alert in OBS within ~3 s.
   Then run the rest of the README test table (failure UPI, card, duplicate resend from
   dashboard, abuse filter, phone layout).

## Before going live
- [ ] Fill legal placeholders in `terms.html`, `privacy.html`, `refunds.html`, `contact.html`:
      `[YOUR LEGAL NAME as on PAN]`, `[YOUR CONTACT EMAIL]`, `[YOUR CITY, STATE]`.
- [ ] Confirm YouTube handle in `assets/config.js` (`CHANNEL_URL`, currently `@Sohal007`) and `contact.html`.
- [ ] Razorpay support ticket resolved → category = content creator → complete KYC.
- [ ] Live mode: live keys + live webhook (its own secret) → update Supabase secrets and
      `RAZORPAY_KEY_ID` in `config.js`.
- [ ] Remove `http://localhost:8080` from `ALLOWED_ORIGIN`.
- [ ] ₹10 live smoke test from your own phone.
- [ ] Optional: regenerate the Razorpay test key secret (it was shared in a chat).

## Later (Phase 2–3)
- Keep-alive workflow pinging `/health` every 2 days.
- Goal bar / recent-tips overlay, monthly leaderboard, admin page.

## Clean-up notes
- Test rows in `tips` named "Claude Test" can be deleted any time (mode = `test`).
