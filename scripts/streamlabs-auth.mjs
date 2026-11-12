// One-time helper: get a Streamlabs OAuth access token with the donations.create scope.
//
// 1. streamlabs.com → Settings → API Settings → Register App
//      Redirect URI:  http://localhost:8787/callback
//    (whitelist your own Streamlabs account; the app does not need approval for personal use)
// 2. Put the app's credentials in .env:
//      STREAMLABS_CLIENT_ID=...
//      STREAMLABS_CLIENT_SECRET=...
// 3. node --env-file=.env scripts/streamlabs-auth.mjs
//    Open the printed link, click Approve. The token is written to .env as
//    STREAMLABS_ACCESS_TOKEN (never printed). Then push it to Supabase secrets.

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const REDIRECT_URI = "http://localhost:8787/callback";
const envPath = resolve(import.meta.dirname, "..", ".env");
const clientId = process.env.STREAMLABS_CLIENT_ID;
const clientSecret = process.env.STREAMLABS_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set STREAMLABS_CLIENT_ID and STREAMLABS_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authUrl = "https://streamlabs.com/api/v2.0/authorize?" + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: "donations.read donations.create",
  state,
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8787");
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  if (url.searchParams.get("state") !== state) return res.writeHead(400).end("State mismatch.");
  const code = url.searchParams.get("code");
  if (!code) return res.writeHead(400).end("No code: " + (url.searchParams.get("error") ?? "unknown"));

  const tokenRes = await fetch("https://streamlabs.com/api/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  const data = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !data.access_token) {
    console.error("Token exchange failed:", tokenRes.status, data.error ?? "", data.error_description ?? "");
    res.writeHead(500).end("Token exchange failed — see terminal.");
    return server.close();
  }

  let env = readFileSync(envPath, "utf8");
  const line = `STREAMLABS_ACCESS_TOKEN=${data.access_token}`;
  env = /^STREAMLABS_ACCESS_TOKEN=.*$/m.test(env)
    ? env.replace(/^STREAMLABS_ACCESS_TOKEN=.*$/m, line)
    : env.trimEnd() + "\n" + line + "\n";
  writeFileSync(envPath, env);
  console.log("Saved STREAMLABS_ACCESS_TOKEN to .env (scope: donations.read + donations.create).");
  res.writeHead(200, { "Content-Type": "text/html" })
    .end("<h2>Done! Token saved to .env. You can close this tab.</h2>");
  server.close();
});

server.listen(8787, () => {
  console.log("Open this link and click Approve:\n\n" + authUrl + "\n");
});
