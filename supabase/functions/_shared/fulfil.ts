// Shared by both payment webhooks: tip found + amount checked → mark paid → claim → alert.
//
// Idempotency: gateways retry webhooks (and may deliver twice). The alert is
// "claimed" with one atomic UPDATE ... WHERE alert_sent = false, so only one
// delivery can ever send it. If Streamlabs fails, the claim is released and the
// webhook returns 500 so the gateway retries later.

import { json } from "./cors.ts";
import { db } from "./db.ts";
import { filterMessage, filterName } from "./filter.ts";
import { sendStreamlabsDonation } from "./streamlabs.ts";

export interface Tip {
  id: string;
  name: string;
  message: string | null;
  amount_paise: number;
  currency: string;
  status: string;
  alert_sent: boolean;
}

export async function findTipByOrderId(orderId: string): Promise<{ tip: Tip | null; error: unknown }> {
  const { data, error } = await db().from("tips").select("*").eq("order_id", orderId).maybeSingle();
  return { tip: data as Tip | null, error };
}

export async function fulfilTip(tip: Tip, paymentId: string): Promise<Response> {
  if (tip.alert_sent) return json({ ok: true, duplicate: true });

  // Mark paid (safe to repeat)
  if (tip.status !== "paid") {
    const { error } = await db()
      .from("tips")
      .update({ status: "paid", payment_id: paymentId, paid_at: new Date().toISOString() })
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

  // Moderate, then alert
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
    // Release the claim so the gateway's retry can try again
    await db().from("tips").update({ alert_sent: false }).eq("id", tip.id);
    return json({ error: "Alert failed" }, 500);
  }

  return json({ ok: true });
}
