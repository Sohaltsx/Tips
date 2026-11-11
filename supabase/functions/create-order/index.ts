// POST /create-order  { name, amount, message }  →  { order_id, amount, currency, key_id, tip_id }
// amount is in whole rupees; Razorpay works in paise.

import { corsHeaders, isOriginAllowed, json } from "../_shared/cors.ts";
import { db, razorpayMode } from "../_shared/db.ts";
import { cleanText, MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH } from "../_shared/filter.ts";
import { sha256Hex } from "../_shared/signature.ts";

const CURRENCY = "INR";
const RATE_LIMIT = 5; // orders per IP per minute
const MIN_AMOUNT = Number(Deno.env.get("MIN_AMOUNT") ?? 10);
const MAX_AMOUNT = Number(Deno.env.get("MAX_AMOUNT") ?? 50000);

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

async function isRateLimited(ip: string): Promise<boolean> {
  const ipHash = await sha256Hex(`tips:${ip}`);
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await db()
    .from("rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (error) {
    console.error("rate limit check failed", error);
    return false; // fail open: never block real tips because of a DB hiccup
  }
  if ((count ?? 0) >= RATE_LIMIT) return true;
  await db().from("rate_limits").insert({ ip_hash: ipHash });
  // Occasional cleanup of old rows
  if (Math.random() < 0.05) {
    await db().from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3_600_000).toISOString());
  }
  return false;
}

interface ValidInput {
  name: string;
  message: string;
  amount: number;
}

function validate(body: unknown): { ok: true; value: ValidInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;

  const rawName = typeof b.name === "string" ? b.name : "";
  const name = cleanText(rawName, MAX_NAME_LENGTH);
  if ([...rawName.trim()].length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or less.` };
  }
  if (!name) return { ok: false, error: "Please enter your name." };

  const rawMessage = b.message == null ? "" : b.message;
  if (typeof rawMessage !== "string") return { ok: false, error: "Invalid message." };
  if ([...rawMessage].length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Message must be ${MAX_MESSAGE_LENGTH} characters or less.` };
  }
  const message = cleanText(rawMessage, MAX_MESSAGE_LENGTH);

  const amount = typeof b.amount === "string" ? Number(b.amount) : b.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    return { ok: false, error: "Amount must be a whole number of rupees." };
  }
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return { ok: false, error: `Amount must be between ₹${MIN_AMOUNT} and ₹${MAX_AMOUNT}.` };
  }
  return { ok: true, value: { name, message, amount } };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  if (!isOriginAllowed(origin)) return json({ error: "Origin not allowed" }, 403, cors);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400, cors);
  }

  const v = validate(body);
  if (!v.ok) return json({ error: v.error }, 400, cors);
  const { name, message, amount } = v.value;

  if (await isRateLimited(clientIp(req))) {
    return json({ error: "Too many attempts. Please wait a minute and try again." }, 429, cors);
  }

  const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
  const tipId = crypto.randomUUID();
  const amountPaise = amount * 100;

  // 1) Create the Razorpay order (receipt = our tip id, ≤ 40 chars)
  const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: CURRENCY,
      receipt: tipId,
      notes: { tip_id: tipId, name: name.slice(0, 250), message: message.slice(0, 250) },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("razorpay order request failed", e);
    return null;
  });

  if (!rzpRes || !rzpRes.ok) {
    console.error("razorpay order error", rzpRes?.status, await rzpRes?.text().catch(() => ""));
    return json({ error: "Could not start the payment. Please try again." }, 502, cors);
  }
  const order = await rzpRes.json();

  // 2) Store the pending tip
  const { error } = await db().from("tips").insert({
    id: tipId,
    name,
    message: message || null,
    amount_paise: amountPaise,
    currency: CURRENCY,
    razorpay_order_id: order.id,
    status: "pending",
    mode: razorpayMode(),
  });
  if (error) {
    console.error("insert tip failed", error);
    return json({ error: "Could not start the payment. Please try again." }, 500, cors);
  }

  return json(
    { order_id: order.id, amount: amountPaise, currency: CURRENCY, key_id: keyId, tip_id: tipId },
    200,
    cors,
  );
});
