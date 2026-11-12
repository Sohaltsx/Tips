import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

let client: SupabaseClient | null = null;

/** Service-role client (bypasses RLS). Only ever used server-side. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}

export type Gateway = "cashfree" | "razorpay";

/** Which gateway new tips use. Set PAYMENT_GATEWAY in Supabase secrets (default: cashfree). */
export function activeGateway(): Gateway {
  return (Deno.env.get("PAYMENT_GATEWAY") ?? "cashfree").trim().toLowerCase() === "razorpay"
    ? "razorpay"
    : "cashfree";
}

export function razorpayMode(): "test" | "live" {
  return (Deno.env.get("RAZORPAY_KEY_ID") ?? "").startsWith("rzp_live_") ? "live" : "test";
}
