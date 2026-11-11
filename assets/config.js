// PUBLIC config only — safe to commit. Secrets live in Supabase secrets.
window.TIP_CONFIG = {
  CHANNEL_NAME: "Sohal Gaming",
  CHANNEL_URL: "https://www.youtube.com/@Sohal007",
  SUPABASE_FUNCTIONS_URL: "https://<project-ref>.supabase.co/functions/v1", // TODO: your project ref
  RAZORPAY_KEY_ID: "rzp_test_xxxxx", // key ID is public; the SECRET is not
  MIN_AMOUNT: 10,
  MAX_AMOUNT: 50000,
  TTS_MIN_AMOUNT: 50,
  QUICK_AMOUNTS: [20, 50, 100, 200, 500],
  CURRENCY: "INR"
};
