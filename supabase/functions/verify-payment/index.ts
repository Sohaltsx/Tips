// POST /verify-payment — tells the viewer's browser whether their payment went through.
//
// Cashfree:  { order_id }  → asks Cashfree for the order status
//            → { verified: true|false, status: "PAID" | "ACTIVE" | "EXPIRED" | ..., amount }
// Razorpay:  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//            → checks HMAC-SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET) → { verified: true }
//
// UI only. It does NOT mark the tip paid or fire an alert — the signed webhook remains
// the single source of truth for that, so a tampered browser can never trigger an alert.

import { corsHeaders, isOriginAllowed, json } from "../_shared/cors.ts";
import { db } from "../_shared/db.ts";
import { getCashfreeOrder } from "../_shared/cashfree.ts";
import { hmacSha256Hex, timingSafeEqual } from "../_shared/signature.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  if (!isOriginAllowed(origin)) return json({ error: "Origin not allowed" }, 403, cors);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400, cors);
  }

  // ── Cashfree ─────────────────────────────────────────────────────────
  if (typeof body.order_id === "string") {
    const orderId = body.order_id.trim();
    if (!/^[A-Za-z0-9_-]{1,45}$/.test(orderId)) return json({ error: "Invalid order." }, 400, cors);

    const { data: tip, error } = await db()
      .from("tips")
      .select("id, name, amount_paise, gateway")
      .eq("order_id", orderId)
      .eq("gateway", "cashfree")
      .maybeSingle();
    if (error) {
      console.error("verify lookup failed", error);
      return json({ error: "Could not verify right now." }, 500, cors);
    }
    if (!tip) return json({ verified: false, error: "Unknown order." }, 400, cors);

    try {
      const order = await getCashfreeOrder(orderId);
      const status = order?.order_status ?? "UNKNOWN";
      return json(
        { verified: status === "PAID", status, amount: tip.amount_paise / 100, name: tip.name },
        200,
        cors,
      );
    } catch (e) {
      console.error("cashfree get order failed", e);
      return json({ error: "Could not verify right now." }, 502, cors);
    }
  }

  // ── Razorpay ─────────────────────────────────────────────────────────
  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string" ||
      !orderId || !paymentId || !signature) {
    return json({ error: "Missing payment details." }, 400, cors);
  }

  const secret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
  if (!secret) return json({ error: "Server not configured." }, 500, cors);

  const expected = await hmacSha256Hex(secret, `${orderId}|${paymentId}`);
  if (!timingSafeEqual(expected, signature.trim().toLowerCase())) {
    return json({ verified: false, error: "Payment could not be verified." }, 400, cors);
  }

  // Must be an order this page created
  const { data: tip, error } = await db()
    .from("tips")
    .select("id, amount_paise, status")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) {
    console.error("verify lookup failed", error);
    return json({ error: "Could not verify right now." }, 500, cors);
  }
  if (!tip) return json({ verified: false, error: "Unknown order." }, 400, cors);

  return json({ verified: true, amount: tip.amount_paise / 100, status: tip.status }, 200, cors);
});
