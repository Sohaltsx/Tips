// End-to-end checks against the DEPLOYED cashfree-webhook function.
//
//   CASHFREE_SECRET_KEY=... node scripts/cashfree-webhook-test.mjs https://<ref>.supabase.co/functions/v1/cashfree-webhook
//
// 1. Wrong signature                → expect 400
// 2. Missing signature              → expect 400
// 3. Valid signature, unknown order → expect 200 (ignored, no alert)
// 4. Valid signature, failed event  → expect 200 (ignored)
//
// Duplicate-delivery test: Cashfree Dashboard → Developers → Webhooks → Logs →
// resend a delivered PAYMENT_SUCCESS_WEBHOOK. Only ONE alert must fire.

import { createHmac } from "node:crypto";

const url = process.argv[2];
const secret = process.env.CASHFREE_SECRET_KEY;
if (!url || !secret) {
  console.error("Usage: CASHFREE_SECRET_KEY=... node scripts/cashfree-webhook-test.mjs <webhook-url>");
  process.exit(1);
}

const sign = (ts, body) => createHmac("sha256", secret).update(ts + body).digest("base64");

async function send(name, body, ts, signature, expect) {
  const headers = { "Content-Type": "application/json", "x-webhook-timestamp": ts, "x-webhook-version": "2025-01-01" };
  if (signature) headers["x-webhook-signature"] = signature;
  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  const ok = res.status === expect;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${res.status} (want ${expect}) ${text}`);
  return ok;
}

const ts = String(Date.now());
const fakeSuccess = JSON.stringify({
  type: "PAYMENT_SUCCESS_WEBHOOK",
  event_time: new Date().toISOString(),
  data: {
    order: { order_id: "00000000-0000-4000-8000-000000000000", order_amount: 50, order_currency: "INR" },
    payment: { cf_payment_id: "TEST" + Date.now(), payment_status: "SUCCESS", payment_amount: 50, payment_currency: "INR" },
  },
});
const failedEvent = JSON.stringify({ type: "PAYMENT_FAILED_WEBHOOK", data: { payment: { payment_status: "FAILED" } } });

const results = [
  await send("fake webhook (bad signature)", fakeSuccess, ts, "AAAA" + sign(ts, fakeSuccess).slice(4), 400),
  await send("missing signature", fakeSuccess, ts, "", 400),
  await send("signed, unknown order", fakeSuccess, ts, sign(ts, fakeSuccess), 200),
  await send("signed, ignored event", failedEvent, ts, sign(ts, failedEvent), 200),
];
process.exit(results.every(Boolean) ? 0 : 1);
