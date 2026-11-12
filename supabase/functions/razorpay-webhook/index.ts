// POST /razorpay-webhook — the single source of truth for alerts (Razorpay).
// Razorpay → (signature verified) → mark tip paid → filter → Streamlabs alert.
// Kept so Razorpay can be switched back on with PAYMENT_GATEWAY=razorpay.

import { json } from "../_shared/cors.ts";
import { findTipByOrderId, fulfilTip } from "../_shared/fulfil.ts";
import { verifyRazorpaySignature } from "../_shared/signature.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1) Verify the signature over the RAW body
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
  if (!(await verifyRazorpaySignature(rawBody, signature, secret))) {
    console.warn("webhook rejected: bad signature");
    return json({ error: "Invalid signature" }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // 2) Only payment.captured matters; acknowledge everything else
  if (event?.event !== "payment.captured") return json({ ok: true, ignored: event?.event ?? null });

  const payment = event?.payload?.payment?.entity;
  const orderId: string | undefined = payment?.order_id;
  const paymentId: string | undefined = payment?.id;
  if (!orderId || !paymentId) return json({ ok: true, ignored: "no order_id" });

  // 3) Find the tip
  const { tip, error } = await findTipByOrderId(orderId);
  if (error) {
    console.error("lookup failed", error);
    return json({ error: "DB error" }, 500); // Razorpay will retry
  }
  if (!tip) {
    console.warn("no tip for order", orderId); // payment not made through this page
    return json({ ok: true, ignored: "unknown order" });
  }

  // Sanity: the captured amount must match what we asked for (Razorpay uses paise)
  if (payment.amount !== tip.amount_paise || payment.currency !== tip.currency) {
    console.error("amount mismatch", { orderId, got: payment.amount, want: tip.amount_paise });
    return json({ ok: true, ignored: "amount mismatch" });
  }

  // 4) Mark paid → claim → filter → Streamlabs
  return await fulfilTip(tip, paymentId);
});
