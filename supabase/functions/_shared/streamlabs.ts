// Streamlabs "create donation" → fires the existing Alertbox (alert + TTS).
// Docs: https://dev.streamlabs.com/reference/donations-1
// Streamlabs constraints: name 2–25 chars, letters/digits/underscore only;
// message ≤ 255 chars; identifier groups donations by donor.
// Apps registered now are API v2.0: the OAuth token goes in an Authorization: Bearer
// header (v1.0 with ?access_token= rejects these tokens with 401).

export const DEFAULT_DONATIONS_URL = "https://streamlabs.com/api/v2.0/donations";

/** Make a display name Streamlabs will accept: "Rahul Kumar!" → "Rahul_Kumar". */
export function toStreamlabsName(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents: "José" → "Jose"
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 25)
    .replace(/_$/, "");
  return ascii.length >= 2 ? ascii : "Anonymous";
}

export interface StreamlabsDonation {
  name: string;
  message: string;
  identifier: string;
  amountRupees: number;
  currency: string;
}

export async function sendStreamlabsDonation(d: StreamlabsDonation): Promise<void> {
  const token = Deno.env.get("STREAMLABS_ACCESS_TOKEN");
  if (!token) throw new Error("STREAMLABS_ACCESS_TOKEN is not set");
  const url = Deno.env.get("STREAMLABS_DONATIONS_URL") || DEFAULT_DONATIONS_URL;

  const form = new URLSearchParams({
    name: toStreamlabsName(d.name),
    message: d.message.slice(0, 255),
    identifier: d.identifier,
    amount: d.amountRupees.toFixed(2),
    currency: d.currency,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Streamlabs ${res.status}: ${text.slice(0, 300)}`);
  }
}
