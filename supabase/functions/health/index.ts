// GET /health → { ok: true }  — also touches the DB so Supabase's free tier stays awake.

import { json } from "../_shared/cors.ts";
import { db } from "../_shared/db.ts";

Deno.serve(async () => {
  const { error } = await db().from("tips").select("id", { head: true, count: "exact" }).limit(1);
  if (error) {
    console.error("health db error", error);
    return json({ ok: false }, 500);
  }
  return json({ ok: true, time: new Date().toISOString() });
});
