// Sohal Gaming — Streamlabs Alert Box custom JS (runs once per alert).
// Reads name + amount out of Streamlabs' {messageTemplate} and fills the card.
(function () {
  var BIG_TIP = Number("{bigTipAmount}") || 500;

  var source = document.getElementById("sg-source");
  var alertEl = document.getElementById("sg-alert");
  var nameEl = document.getElementById("sg-name");
  var amountEl = document.getElementById("sg-amount");
  var labelEl = document.getElementById("sg-label-text");
  var messageEl = document.getElementById("sg-message");
  if (!source || !alertEl) return;

  function tokenText(token) {
    var el = source.querySelector('[data-token="' + token + '"]');
    return el ? el.textContent.trim() : "";
  }

  // Our backend sends names like "Rahul_Kumar" (Streamlabs rule) → show "Rahul Kumar".
  var rawName = tokenText("name");
  var rawAmount = tokenText("amount");

  if (!rawName && !rawAmount) {
    // Template without token spans: show the whole line as the name row.
    nameEl.textContent = source.textContent.trim();
  } else {
    nameEl.textContent = (rawName || "Someone").replace(/_+/g, " ").trim();
  }

  // "₹1,500.00" / "INR 1500.00" / "1500" → 1500
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
    var duration = 900;
    var delay = 450;
    amountEl.textContent = formatRupees(0);
    setTimeout(function () {
      requestAnimationFrame(function step(t) {
        if (start === null) start = t;
        var p = Math.min(1, (t - start) / duration);
        var eased = 1 - Math.pow(1 - p, 3);
        amountEl.textContent = formatRupees(p < 1 ? Math.floor(value * eased) : value);
        if (p < 1) requestAnimationFrame(step);
      });
    }, delay);
  } else {
    amountEl.textContent = rawAmount;
  }

  if (value >= BIG_TIP) {
    alertEl.classList.add("sg-big");
    labelEl.textContent = "Big tip";
  }

  if (!messageEl.textContent.trim()) messageEl.classList.add("sg-empty");
})();
