// Sohal Gaming — Streamlabs Alert Box custom JS (runs once per alert, after the HTML).
// Reads the values Streamlabs put into the HTML (never uses tokens inside JS, so a
// viewer's message can't break the script).
(function () {
  var BIG_TIP = Number("{bigTipAmount}") || 500;

  var alertEl = document.getElementById("sg-alert");
  var nameEl = document.getElementById("sg-name");
  var amountEl = document.getElementById("sg-amount");
  var labelEl = document.getElementById("sg-label-text");
  var messageEl = document.getElementById("sg-message");
  if (!alertEl || !nameEl || !amountEl) return;

  // A token Streamlabs didn't fill stays as "{something}" — treat it as empty.
  function read(el) {
    var s = (el && el.textContent || "").trim();
    return /^\{\w+\}$/.test(s) ? "" : s;
  }

  // Our backend sends names like "Rahul_Kumar" (Streamlabs rule) → show "Rahul Kumar".
  nameEl.textContent = (read(nameEl) || "Someone").replace(/_+/g, " ").trim();

  // "₹1,500.00" / "INR 1500.00" / "1500" → 1500
  var rawAmount = read(amountEl);
  var value = parseFloat(rawAmount.replace(/[^0-9.]/g, "")) || 0;

  function formatRupees(n) {
    var whole = Math.round(n * 100) % 100 === 0;
    return "₹" + n.toLocaleString("en-IN", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
  }

  if (value > 0) {
    // Count up from 0 to the amount.
    var start = null;
    amountEl.textContent = formatRupees(0);
    setTimeout(function () {
      requestAnimationFrame(function step(t) {
        if (start === null) start = t;
        var p = Math.min(1, (t - start) / 900);
        var eased = 1 - Math.pow(1 - p, 3);
        amountEl.textContent = formatRupees(p < 1 ? Math.floor(value * eased) : value);
        if (p < 1) requestAnimationFrame(step);
      });
    }, 450);
  } else {
    amountEl.textContent = rawAmount;
  }

  if (value >= BIG_TIP) {
    alertEl.classList.add("sg-big");
    labelEl.textContent = "Big tip";
  }

  if (messageEl && !read(messageEl)) messageEl.classList.add("sg-empty");
})();
