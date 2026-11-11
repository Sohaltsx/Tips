// POST /verify-payment { razorpay_order_id, razorpay_payment_id, razorpay_signature } → { verified: true }
//
// Checks the signature Razorpay Checkout hands the browser:
//   HMAC-SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET)
// This only confirms the payment to the viewer's UI. It does NOT mark the tip paid
// or fire an alert — the signed payment.captured webhook remains the single source
// of truth for that, so a tampered browser can never trigger an on-stream alert.

import { corsHeaders, isOriginAllowed, json } from "../_shared/cors.ts";
import { db } from "../_shared/db.ts";
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
    .eq("razorpay_order_id", orderId)
    .maybeSingle();
  if (error) {
    console.error("verify lookup failed", error);
    return json({ error: "Could not verify right now." }, 500, cors);
  }
  if (!tip) return json({ verified: false, error: "Unknown order." }, 400, cors);

  return json({ verified: true, amount: tip.amount_paise / 100, status: tip.status }, 200, cors);
});
