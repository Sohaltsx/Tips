// Unit tests for the runtime-agnostic shared modules.
// Run: node --test tests/shared.test.ts   (Node ≥ 23, no install needed)

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, containsAbuse, filterMessage, filterName } from "../supabase/functions/_shared/filter.ts";
import { hmacSha256Hex, timingSafeEqual, verifyRazorpaySignature } from "../supabase/functions/_shared/signature.ts";

// Streamlabs name helper lives in streamlabs.ts which touches Deno.env only inside a function,
// so it imports fine under Node.
import { toStreamlabsName } from "../supabase/functions/_shared/streamlabs.ts";

test("strips URLs, mentions and HTML", () => {
  const out = filterMessage("hi <b>bro</b> check https://spam.com/x and www.foo.in and bit.ly/abc @someone");
  assert.equal(out, "hi bro check and and");
});

test("limits repeated characters and emoji", () => {
  assert.equal(cleanText("heyyyyyyyy!!!!!!", 200), "heyyy!!!");
  assert.equal(cleanText("🔥🔥🔥🔥🔥🔥🔥🔥 gg", 200), "🔥🔥🔥 gg");
  const out = cleanText("🔥😂🎮🔥😂🎮🔥😂 gg", 200);
  assert.equal([...out.matchAll(/\p{Extended_Pictographic}/gu)].length, 5);
});

test("hard cap at 200 characters", () => {
  assert.equal([...filterMessage("a b ".repeat(200))].length <= 200, true);
});

test("masks English and Hinglish abuse incl. obfuscation", () => {
  assert.equal(filterMessage("you are a fuuuck"), "you are a f*****");
  assert.equal(filterMessage("F.U.C.K this"), "F****** this");
  assert.equal(filterMessage("sh1t game"), "s*** game");
  assert.equal(filterMessage("chutiya streamer"), "c****** streamer");
  assert.equal(filterMessage("bc kya scene hai"), "b* kya scene hai");
  assert.equal(filterMessage("तू चूतिया है"), "तू च***** है");
  assert.equal(filterMessage("motherfucker"), "m***********");
});

test("does not mask innocent words", () => {
  for (const s of ["peacock", "chutney", "Gandhi", "Scunthorpe", "grape", "class", "assessment", "Dickens"]) {
    assert.equal(containsAbuse(s), false, s);
    assert.equal(filterMessage(s), s);
  }
});

test("abusive or empty names become Anonymous", () => {
  assert.equal(filterName("Gandu King"), "Anonymous");
  assert.equal(filterName("   "), "Anonymous");
  assert.equal(filterName("<script>"), "Anonymous");
  assert.equal(filterName("Rahul Kumar"), "Rahul Kumar");
});

test("Streamlabs-safe names", () => {
  assert.equal(toStreamlabsName("Rahul Kumar!"), "Rahul_Kumar");
  assert.equal(toStreamlabsName("José"), "Jose");
  assert.equal(toStreamlabsName("राहुल"), "Anonymous");
  assert.equal(toStreamlabsName("A"), "Anonymous");
  assert.equal(toStreamlabsName("a".repeat(40)).length, 25);
});

test("webhook signature: valid, tampered, wrong secret, missing", async () => {
  const body = JSON.stringify({ event: "payment.captured", payload: {} });
  const secret = "whsec_test";
  const sig = await hmacSha256Hex(secret, body);
  assert.equal(await verifyRazorpaySignature(body, sig, secret), true);
  assert.equal(await verifyRazorpaySignature(body + " ", sig, secret), false);
  assert.equal(await verifyRazorpaySignature(body, sig, "other"), false);
  assert.equal(await verifyRazorpaySignature(body, null, secret), false);
  assert.equal(await verifyRazorpaySignature(body, sig, ""), false);
});

test("checkout signature: HMAC(order_id|payment_id, key_secret)", async () => {
  const secret = "test_key_secret";
  const sig = await hmacSha256Hex(secret, "order_ABC|pay_XYZ");
  // independent reference via Node's crypto
  const { createHmac } = await import("node:crypto");
  assert.equal(sig, createHmac("sha256", secret).update("order_ABC|pay_XYZ").digest("hex"));
  assert.equal(timingSafeEqual(sig, await hmacSha256Hex(secret, "order_ABC|pay_OTHER")), false);
});

test("known HMAC vector", async () => {
  // RFC 4231 test case 2
  assert.equal(
    await hmacSha256Hex("Jefe", "what do ya want for nothing?"),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});
