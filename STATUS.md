# Project status — Sohal Gaming Tips

Last updated: **12 Nov 2026** · Launch target: **19 Nov 2026** (GTA 6 streams)

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

### Razorpay (Test Mode) — now the fallback
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
| Signed `payment.captured` → Streamlabs alert | 200 `ok` (~2.8 s), **alert appeared in Alert Box** ✅ |
| Same webhook resent | 200 `duplicate`, **no second alert** |
| Message with emoji (🔥) | Order created (emoji stripped from Razorpay notes only) |

### Streamlabs (done 12 Nov)
- App **"Sohal Tips"** registered (status: Testing). Whitelist: YouTube `Sohal007`.
  Redirect URL `http://localhost:8787/callback`.
- OAuth token (scopes `donations.read donations.create`) obtained via
  `scripts/streamlabs-auth.mjs` and set as `STREAMLABS_ACCESS_TOKEN` in Supabase.
- New Streamlabs apps use **API v2.0** with `Authorization: Bearer` (v1 returns 401) — code updated.
- Unused extra app "Sohal Gaming Tips" can be deleted under API Settings → My Apps.

---

## Switched to Cashfree (12 Nov)

Razorpay would not onboard an individual YouTube streamer, so **Cashfree is now the default
gateway**. Razorpay code is kept as a fallback (`PAYMENT_GATEWAY=razorpay`).

What changed (branch `ccr-0d80feb9-yhl5ui`, not yet on `main`):
- New `cashfree-webhook` function + shared `_shared/cashfree.ts` and `_shared/fulfil.ts`
  (mark paid → claim alert once → Streamlabs, shared by both webhooks).
- `create-order` / `verify-payment` support both gateways (`PAYMENT_GATEWAY` secret).
- Tip page asks for a **mobile number** (Cashfree requires it; sent to Cashfree only, never stored).
- Thank-you page now checks the real order status (`PAID` / not completed).
- Migration `20261112000000_gateway_agnostic.sql`: `razorpay_order_id` → `order_id`,
  `razorpay_payment_id` → `payment_id`, new `gateway` column.
- Terms / Privacy / Refunds / Contact now name Cashfree.
- Tested here: 13 unit tests; Edge Functions type-check; the real `cashfree-webhook` against a
  mock DB + Streamlabs (bad signature, unknown order, wrong amount, Streamlabs down → retry,
  duplicate and concurrent deliveries → exactly one alert); tip page + thank-you page in a
  browser with Cashfree mocked. **Not yet tested against real Cashfree sandbox.**

## Next up

1. **Cashfree account:** sign up at merchant.cashfree.com as *Individual (unregistered)*
   (PAN + Aadhaar + bank). Category: content creator / live-stream tips. Start KYC now.
2. **Cashfree test keys:** Test mode → Developers → API Keys → put in `.env`:
   `PAYMENT_GATEWAY=cashfree`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=sandbox`,
   `SITE_URL=https://sohaltsx.github.io/Tips` → `supabase secrets set --env-file .env`.
   Developers → Whitelisting → add `sohaltsx.github.io`.
3. **Deploy:** `supabase db push`, then deploy `create-order`, `cashfree-webhook`,
   `razorpay-webhook`, `verify-payment`, `health` (all `--no-verify-jwt`). Merge the branch to
   `main` so Pages publishes the new tip page.
4. **Check:** `CASHFREE_SECRET_KEY=… node scripts/cashfree-webhook-test.mjs <url>` (all PASS),
   then a real sandbox tip → alert in OBS within ~3 s. Then the README test table.
5. **Alert Box polish:** donation alert image/sound, TTS voice, TTS min ₹50; Alert Box added in OBS.

## Before going live
- [x] Legal placeholders filled in `terms.html`, `privacy.html`, `refunds.html`, `contact.html` (12 Nov).
- [ ] Confirm YouTube handle in `assets/config.js` (`CHANNEL_URL`, currently `@Sohal007`) and `contact.html`.
- [ ] Cashfree KYC approved → Production API keys → `CASHFREE_ENV=production` in Supabase secrets
      and `CASHFREE_MODE: "production"` in `assets/config.js`; whitelist the domain in production.
- [ ] Remove `http://localhost:8080` from `ALLOWED_ORIGIN`.
- [ ] ₹10 live smoke test from your own phone.
- [ ] Optional: close the Razorpay ticket / regenerate the Razorpay test secret (it was shared in a chat).

## Later (Phase 2–3)
- Keep-alive workflow pinging `/health` every 2 days.
- Goal bar / recent-tips overlay, monthly leaderboard, admin page.

## Clean-up notes
- Test rows in `tips` named "Claude Test" / "Sohal Test" can be deleted any time (mode = `test`).
- Streamlabs has test donations ("Claude_Test", "Sohal_Test") in Recent Events — delete if you like.
