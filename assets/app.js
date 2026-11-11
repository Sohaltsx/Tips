// Tip page logic. The on-stream alert is triggered ONLY by the server webhook,
// never from here — this file just collects input and opens Razorpay Checkout.
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
    if (Array.from(message).length > 200) return { error: "Message must be 200 characters or less." };
    return { name: name, amount: amount, message: message };
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideError();
    var v = validate();
    if (v.error) return showError(v.error);
    if (typeof window.Razorpay !== "function") {
      return showError("Payment system is still loading. Please try again in a moment.");
    }

    setLoading(true);
    fetch(C.SUPABASE_FUNCTIONS_URL + "/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: v.name, amount: v.amount, message: v.message })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "Could not start the payment. Please try again.");
          return data;
        });
      })
      .then(function (order) { openCheckout(order, v); })
      .catch(function (err) {
        setLoading(false);
        // fetch() rejects with TypeError on network/CORS/bad-URL problems
        showError(err instanceof TypeError
          ? "Network error. Check your connection and try again."
          : err.message);
      });
  });

  function openCheckout(order, v) {
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
      handler: function () {
        // UI only. The alert is fired by the verified webhook on the server.
        try {
          sessionStorage.setItem("lastTip", JSON.stringify({ name: v.name, amount: v.amount }));
        } catch (_) { /* storage unavailable — success page shows a generic thanks */ }
        location.href = "success.html";
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
