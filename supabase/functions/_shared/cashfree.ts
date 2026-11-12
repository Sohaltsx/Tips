// Cashfree Payment Gateway (PG) helpers.
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
// Secrets (Supabase): CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV = sandbox | production.
// The webhook is signed with CASHFREE_SECRET_KEY — there is no separate webhook secret.

export const CASHFREE_API_VERSION = "2025-01-01";

export type CashfreeEnv = "sandbox" | "production";

export function cashfreeEnv(): CashfreeEnv {
  return (Deno.env.get("CASHFREE_ENV") ?? "sandbox").trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

export function cashfreeBaseUrl(env: CashfreeEnv = cashfreeEnv()): string {
  return env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-version": Deno.env.get("CASHFREE_API_VERSION") ?? CASHFREE_API_VERSION,
    "x-client-id": Deno.env.get("CASHFREE_APP_ID") ?? "",
    "x-client-secret": Deno.env.get("CASHFREE_SECRET_KEY") ?? "",
  };
}

/**
 * Cashfree requires a customer phone. Accepts "98765 43210", "+91-9876543210", "09876543210"
 * and returns the 10-digit Indian mobile number, or null if it isn't one.
 */
export function normalizeIndianPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let digits = input.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Cashfree order_note / tags: plain text, no emoji or control chars, capped. */
export function cashfreeSafe(s: string, max = 200): string {
  return s
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f\u200d\ufe0f]/g, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max);
}

export interface CashfreeOrderInput {
  orderId: string; // our tip id (UUID: alphanumeric and '-', ≤ 45 chars)
  amountRupees: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  note: string;
  returnUrl?: string;
  notifyUrl?: string;
}

export interface CashfreeOrder {
  cf_order_id?: string | number;
  order_id: string;
  order_status: string;
  order_amount: number;
  order_currency: string;
  payment_session_id: string;
}

export async function createCashfreeOrder(input: CashfreeOrderInput): Promise<CashfreeOrder> {
  const meta: Record<string, string> = {};
  if (input.returnUrl) meta.return_url = input.returnUrl;
  if (input.notifyUrl) meta.notify_url = input.notifyUrl;

  const res = await fetch(`${cashfreeBaseUrl()}/orders`, {
    method: "POST",
    headers: { ...headers(), "x-idempotency-key": input.orderId },
    body: JSON.stringify({
      order_id: input.orderId,
      order_amount: input.amountRupees,
      order_currency: input.currency,
      customer_details: {
        // alphanumeric only
        customer_id: "tip" + input.orderId.replace(/[^A-Za-z0-9]/g, ""),
        customer_phone: input.customerPhone,
        customer_name: cashfreeSafe(input.customerName, 50) || "Viewer",
      },
      order_meta: meta,
      order_note: cashfreeSafe(input.note, 200),
      order_tags: { tip_id: input.orderId },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`cashfree create order ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return await res.json();
}

/** GET /orders/{id} → order_status: ACTIVE | PAID | EXPIRED | TERMINATED | TERMINATION_REQUESTED */
export async function getCashfreeOrder(orderId: string): Promise<CashfreeOrder | null> {
  const res = await fetch(`${cashfreeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cashfree get order ${res.status}: ${await res.text().catch(() => "")}`);
  return await res.json();
}
