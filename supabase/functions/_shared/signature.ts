// Webhook signatures.
//   Razorpay: hex(HMAC-SHA256(rawBody, webhookSecret))
//   Cashfree: base64(HMAC-SHA256(timestamp + rawBody, clientSecret))
// Uses Web Crypto so it runs in Deno (Supabase) and Node ≥ 20.

const enc = new TextEncoder();

async function hmacSha256(secret: string, body: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  return [...(await hmacSha256(secret, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64(secret: string, body: string): Promise<string> {
  return btoa(String.fromCharCode(...(await hmacSha256(secret, body))));
}

/** Constant-time string comparison (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function verifyRazorpaySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}

/**
 * Cashfree payment webhook check (same algorithm as Cashfree's official SDK).
 * No timestamp window: Cashfree retries can carry the original timestamp, and a
 * replayed genuine event is harmless because the alert is claimed only once.
 */
export async function verifyCashfreeSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !timestamp || !secret) return false;
  const expected = await hmacSha256Base64(secret, timestamp + rawBody);
  return timingSafeEqual(expected, signature.trim());
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
