// Tip page logic. The on-stream alert is triggered ONLY by the server webhook,
// never from here — this file just collects input and opens Cashfree (or Razorpay) Checkout.
(function () {
  "use strict";

  var C = window.TIP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  var form = $("tip-form");
  var nameEl = $("name");
  var amountEl = $("amount");
  var msgEl = $("message");
  var btn = $("tip-btn");
  var btnText = $("tip-btn-text");
  var errorEl = $("error");
  var quick = $("quick");
  var ttsHint = $("tts-hint");
  var phoneEl = $("phone");

  var GATEWAY = C.PAYMENT_GATEWAY === "razorpay" ? "razorpay" : "cashfree";
  var SDK_URL = {
    cashfree: "https://sdk.cashfree.com/js/v3/cashfree.js",
    razorpay: "https://checkout.razorpay.com/v1/checkout.js"
  };
  $("gateway-name").textContent = GATEWAY === "razorpay" ? "Razorpay" : "Cashfree";
  // Cashfree needs the payer's mobile number; Razorpay asks for it in its own popup.
  $("phone-field").hidden = GATEWAY !== "cashfree";
  phoneEl.required = GATEWAY === "cashfree";
  phoneEl.addEventListener("input", hideError);

  // Load the gateway's checkout script (only the one we use).
  var sdkReady = new Promise(function (resolve) {
    var s = document.createElement("script");
    s.src = SDK_URL[GATEWAY];
    s.async = true;
    s.onload = function () { resolve(true); };
    s.onerror = function () { resolve(false); };
    document.head.appendChild(s);
  });
  function sdkLoaded() {
    return GATEWAY === "cashfree" ? typeof window.Cashfree === "function" : typeof window.Razorpay === "function";
  }

  // Same rules as the server: 10-digit Indian mobile, optional +91 / 0 prefix.
  function normalizePhone(input) {
    var d = String(input || "").replace(/[\s\-().]/g, "");
    if (d.indexOf("+91") === 0) d = d.slice(3);
    else if (d.length === 12 && d.indexOf("91") === 0) d = d.slice(2);
    else if (d.length === 11 && d.charAt(0) === "0") d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  }

  $("year").textContent = new Date().getFullYear();
  $("amount-hint").textContent = "Min ₹" + fmt(C.MIN_AMOUNT) + " · Max ₹" + fmt(C.MAX_AMOUNT);
  amountEl.min = C.MIN_AMOUNT;
  amountEl.max = C.MAX_AMOUNT;

  function fmt(n) { return Number(n).toLocaleString("en-IN"); }

  // Quick amount buttons
  C.QUICK_AMOUNTS.forEach(function (amt) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = "₹" + amt;
    b.dataset.amount = amt;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", function () {
      amountEl.value = amt;
      onAmountChange();
    });
    quick.appendChild(b);
  });

  function onAmountChange() {
    var v = Number(amountEl.value);
    [].forEach.call(quick.children, function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.amount) === v));
    });
    var tts = v >= C.TTS_MIN_AMOUNT;
    ttsHint.classList.toggle("on", tts);
    ttsHint.querySelector("span").innerHTML = tts
      ? "Your message will be <b>read aloud</b> on stream"
      : "Messages from ₹" + fmt(C.TTS_MIN_AMOUNT) + "+ are read aloud on stream";
    btnText.textContent = v > 0 ? "Tip ₹" + fmt(v) : "Tip";
    hideError();
  }
  amountEl.addEventListener("input", onAmountChange);

  function counter(input, el, max) {
    var update = function () {
      var n = Array.from(input.value).length;
      el.textContent = n + (el.id === "name-count" ? "/" + max : "");
      el.classList.toggle("warn", n >= max);
    };
    input.addEventListener("input", function () { update(); hideError(); });
    update();
  }
  counter(nameEl, $("name-count"), 30);
  counter(msgEl, $("msg-count"), 200);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add("show");
    errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function hideError() { errorEl.classList.remove("show"); }

  function setLoading(on) {
    btn.disabled = on;
    btn.classList.toggle("loading", on);
  }

  function validate() {
    var name = nameEl.value.trim();
    var amount = Number(amountEl.value);
    var message = msgEl.value.trim();
    if (!name) return { error: "Please enter your name." };
    if (Array.from(name).length > 30) return { error: "Name must be 30 characters or less." };
    if (!amountEl.value || !Number.isInteger(amount)) return { error: "Please enter a whole amount in rupees." };
    if (amount < C.MIN_AMOUNT) return { error: "Minimum tip is ₹" + fmt(C.MIN_AMOUNT) + "." };
    if (amount > C.MAX_AMOUNT) return { error: "Maximum tip is ₹" + fmt(C.MAX_AMOUNT) + "." };
    var phone = null;
    if (GATEWAY === "cashfree") {
      phone = normalizePhone(phoneEl.value);
      if (!phone) return { error: "Please enter a valid 10-digit mobile number." };
    }
    if (Array.from(message).length > 200) return { error: "Message must be 200 characters or less." };
    return { name: name, amount: amount, message: message, phone: phone };
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideError();
    var v = validate();
    if (v.error) return showError(v.error);
    if (!sdkLoaded()) {
      sdkReady.then(function (ok) {
        if (!ok) showError("Couldn't load the payment system. Check your connection or ad-blocker and reload.");
      });
      return showError("Payment system is still loading. Please try again in a moment.");
    }

    setLoading(true);
    var payload = { name: v.name, amount: v.amount, message: v.message };
    if (v.phone) payload.phone = v.phone;
    fetch(C.SUPABASE_FUNCTIONS_URL + "/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "Could not start the payment. Please try again.");
          return data;
        });
      })
      .then(function (order) {
        if (order.gateway === "razorpay") openRazorpay(order, v);
        else openCashfree(order, v);
      })
      .catch(function (err) {
        setLoading(false);
        // fetch() rejects with TypeError on network/CORS/bad-URL problems
        showError(err instanceof TypeError
          ? "Network error. Check your connection and try again."
          : err.message);
      });
  });

  function rememberTip(v) {
    try {
      sessionStorage.setItem("lastTip", JSON.stringify({ name: v.name, amount: v.amount }));
    } catch (_) { /* storage unavailable — success page shows a generic thanks */ }
  }

  // ── Cashfree ────────────────────────────────────────────────────────
  function openCashfree(order, v) {
    var cashfree;
    try {
      cashfree = window.Cashfree({ mode: order.mode || C.CASHFREE_MODE || "sandbox" });
    } catch (e) {
      setLoading(false);
      return showError("Payment system failed to start. Please reload and try again.");
    }
    cashfree.checkout({ paymentSessionId: order.payment_session_id, redirectTarget: "_modal" })
      .then(function (result) {
        result = result || {};
        if (result.error) {
          // Closed the popup, or the payment failed inside it.
          setLoading(false);
          onAmountChange();
          var reason = result.error.message;
          showError((reason ? reason + ". " : "Payment was not completed. ") +
            "If money was debited it will be refunded automatically — you can try again.");
          return;
        }
        // Payment finished (or the gateway redirected): the thank-you page asks the
        // server for the real status. UI only — the alert comes from the signed webhook.
        rememberTip(v);
        location.href = "success.html?order_id=" + encodeURIComponent(order.order_id);
      });
  }

  // ── Razorpay ────────────────────────────────────────────────────────
  // Resolves "verified" | "invalid" | "unknown" (couldn't reach the server).
  function verifyPayment(resp) {
    return fetch(C.SUPABASE_FUNCTIONS_URL + "/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature
      })
    })
      .then(function (res) {
        if (res.ok) return "verified";
        return res.status === 400 ? "invalid" : "unknown";
      })
      .catch(function () { return "unknown"; });
  }

  function openRazorpay(order, v) {
    var rzp = new window.Razorpay({
      key: order.key_id || C.RAZORPAY_KEY_ID,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: C.CHANNEL_NAME,
      description: "Tip for " + C.CHANNEL_NAME,
      image: new URL("assets/logo.webp", location.href).href,
      theme: { color: "#f20d24", backdrop_color: "#111111" },
      // Prefill nothing personal — Razorpay collects contact/email itself.
      handler: function (resp) {
        // Confirm the Checkout signature server-side, then show the thank-you page.
        // UI only — the on-stream alert is fired by the signed webhook, never from here.
        btnText.textContent = "Confirming…";
        verifyPayment(resp).then(function (result) {
          if (result === "invalid") {
            setLoading(false);
            onAmountChange();
            showError("We couldn't verify this payment. If money was debited, contact us with your payment ID: " +
              resp.razorpay_payment_id);
            return;
          }
          // "verified" or "unknown" (network hiccup): payment went through on Razorpay's side.
          rememberTip(v);
          location.href = "success.html";
        });
      },
      modal: {
        confirm_close: true,
        ondismiss: function () {
          setLoading(false);
          showError("Payment was cancelled. No money was taken — you can try again.");
        }
      }
    });
    rzp.on("payment.failed", function (resp) {
      setLoading(false);
      var reason = resp && resp.error && resp.error.description;
      showError("Payment failed" + (reason ? ": " + reason : "") + ". Please try again.");
    });
    rzp.open();
  }

  onAmountChange();
})();
