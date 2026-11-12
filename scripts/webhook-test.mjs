// End-to-end checks against the DEPLOYED razorpay-webhook function (Razorpay fallback).
// For Cashfree use scripts/cashfree-webhook-test.mjs.
//
//   RAZORPAY_WEBHOOK_SECRET=... node scripts/webhook-test.mjs https://<ref>.supabase.co/functions/v1/razorpay-webhook
//
// 1. Wrong signature          → expect 400
// 2. Valid signature, unknown → expect 200 (ignored, no alert)
// 3. Valid signature, other event → expect 200 (ignored)
//
// Duplicate-delivery test: in Razorpay Dashboard → Webhooks → your webhook →
// find a delivered payment.captured event → "Resend". Only ONE alert must fire.

import { createHmac } from "node:crypto";

const url = process.argv[2];
const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
if (!url || !secret) {
  console.error("Usage: RAZORPAY_WEBHOOK_SECRET=... node scripts/webhook-test.mjs <webhook-url>");
  process.exit(1);
}

const sign = (body) => createHmac("sha256", secret).update(body).digest("hex");

async function send(name, body, signature, expect) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Razorpay-Signature": signature },
    body,
  });
  const text = await res.text();
  const ok = res.status === expect;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${res.status} (want ${expect}) ${text}`);
  return ok;
}

const fakeCaptured = JSON.stringify({
  event: "payment.captured",
  payload: {
    payment: {
      entity: { id: "pay_TEST" + Date.now(), order_id: "order_DOES_NOT_EXIST", amount: 5000, currency: "INR" },
    },
  },
});
const otherEvent = JSON.stringify({ event: "payment.failed", payload: {} });

const results = [
  await send("fake webhook (bad signature)", fakeCaptured, "0".repeat(64), 400),
  await send("missing signature", fakeCaptured, "", 400),
  await send("signed, unknown order", fakeCaptured, sign(fakeCaptured), 200),
  await send("signed, ignored event", otherEvent, sign(otherEvent), 200),
];
process.exit(results.every(Boolean) ? 0 : 1);
