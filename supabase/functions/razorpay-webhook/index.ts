// POST /razorpay-webhook — the single source of truth for alerts.
// Razorpay → (signature verified) → mark tip paid → filter → Streamlabs alert.
//
// Idempotency: Razorpay retries webhooks (and may deliver twice). The alert is
// "claimed" with one atomic UPDATE ... WHERE alert_sent = false, so only one
// delivery can ever send it. If Streamlabs fails, the claim is released and we
// return 500 so Razorpay retries later.

import { json } from "../_shared/cors.ts";
import { db } from "../_shared/db.ts";
import { filterMessage, filterName } from "../_shared/filter.ts";
import { verifyRazorpaySignature } from "../_shared/signature.ts";
import { sendStreamlabsDonation } from "../_shared/streamlabs.ts";

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
  const { data: tip, error: findErr } = await db()
    .from("tips")
    .select("*")
    .eq("razorpay_order_id", orderId)
    .maybeSingle();
  if (findErr) {
    console.error("lookup failed", findErr);
    return json({ error: "DB error" }, 500); // Razorpay will retry
  }
  if (!tip) {
    console.warn("no tip for order", orderId); // payment not made through this page
    return json({ ok: true, ignored: "unknown order" });
  }

  // Sanity: the captured amount must match what we asked for
  if (payment.amount !== tip.amount_paise || payment.currency !== tip.currency) {
    console.error("amount mismatch", { orderId, got: payment.amount, want: tip.amount_paise });
    return json({ ok: true, ignored: "amount mismatch" });
  }

  if (tip.alert_sent) return json({ ok: true, duplicate: true });

  // 4) Mark paid (safe to repeat)
  if (tip.status !== "paid") {
    const { error } = await db()
      .from("tips")
      .update({ status: "paid", razorpay_payment_id: paymentId, paid_at: new Date().toISOString() })
      .eq("id", tip.id);
    if (error) {
      console.error("mark paid failed", error);
      return json({ error: "DB error" }, 500);
    }
  }

  // Atomically claim the alert — only one concurrent delivery wins
  const { data: claimed, error: claimErr } = await db()
    .from("tips")
    .update({ alert_sent: true })
    .eq("id", tip.id)
    .eq("alert_sent", false)
    .select("id");
  if (claimErr) {
    console.error("claim failed", claimErr);
    return json({ error: "DB error" }, 500);
  }
  if (!claimed || claimed.length === 0) return json({ ok: true, duplicate: true });

  // 5) Moderate, 6) alert
  try {
    await sendStreamlabsDonation({
      name: filterName(tip.name),
      message: filterMessage(tip.message),
      identifier: tip.id,
      amountRupees: tip.amount_paise / 100,
      currency: tip.currency,
    });
  } catch (e) {
    console.error("streamlabs failed", e);
    // Release the claim so Razorpay's retry can try again
    await db().from("tips").update({ alert_sent: false }).eq("id", tip.id);
    return json({ error: "Alert failed" }, 500);
  }

  // 7) Done
  return json({ ok: true });
});
