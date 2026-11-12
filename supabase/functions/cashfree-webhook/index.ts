// POST /cashfree-webhook — the single source of truth for alerts (Cashfree).
// Cashfree → (signature verified) → mark tip paid → filter → Streamlabs alert.
//
// Cashfree calls this via the order's notify_url (set in create-order), and also
// via any webhook added in the Cashfree dashboard. Duplicates are harmless.

import { json } from "../_shared/cors.ts";
import { findTipByOrderId, fulfilTip } from "../_shared/fulfil.ts";
import { verifyCashfreeSignature } from "../_shared/signature.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1) Verify the signature over timestamp + RAW body
  const rawBody = await req.text();
  const ok = await verifyCashfreeSignature(
    rawBody,
    req.headers.get("x-webhook-signature"),
    req.headers.get("x-webhook-timestamp"),
    Deno.env.get("CASHFREE_SECRET_KEY") ?? "",
  );
  if (!ok) {
    console.warn("webhook rejected: bad signature");
    return json({ error: "Invalid signature" }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // 2) Only successful payments matter; acknowledge everything else
  const type: string | undefined = event?.type;
  const payment = event?.data?.payment;
  const order = event?.data?.order;
  if (type !== "PAYMENT_SUCCESS_WEBHOOK" || payment?.payment_status !== "SUCCESS") {
    return json({ ok: true, ignored: type ?? null });
  }

  const orderId: string | undefined = order?.order_id;
  const paymentId = payment?.cf_payment_id != null ? String(payment.cf_payment_id) : "";
  if (!orderId || !paymentId) return json({ ok: true, ignored: "no order_id" });

  // 3) Find the tip
  const { tip, error } = await findTipByOrderId(orderId);
  if (error) {
    console.error("lookup failed", error);
    return json({ error: "DB error" }, 500); // Cashfree will retry
  }
  if (!tip) {
    console.warn("no tip for order", orderId); // payment not made through this page
    return json({ ok: true, ignored: "unknown order" });
  }

  // Sanity: the paid order amount must match what we asked for (Cashfree uses rupees)
  const paidPaise = Math.round(Number(order?.order_amount) * 100);
  if (paidPaise !== tip.amount_paise || order?.order_currency !== tip.currency) {
    console.error("amount mismatch", { orderId, got: order?.order_amount, want: tip.amount_paise / 100 });
    return json({ ok: true, ignored: "amount mismatch" });
  }

  // 4) Mark paid → claim → filter → Streamlabs
  return await fulfilTip(tip, paymentId);
});
