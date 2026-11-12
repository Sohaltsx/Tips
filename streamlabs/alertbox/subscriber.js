// Sohal Gaming — Streamlabs Alert Box custom JS (YouTube → Subscribers).
// Reads the name Streamlabs put into the HTML, then flips the button to "Subscribed".
(function () {
  var nameEl = document.getElementById("sg-name");
  var btn = document.getElementById("sg-subbtn");
  if (!nameEl) return;

  var s = (nameEl.textContent || "").trim();
  if (/^\{\w+\}$/.test(s)) s = "";
  nameEl.textContent = (s || "New subscriber").replace(/_+/g, " ").trim();

  if (btn) setTimeout(function () { btn.classList.add("sg-on"); }, 1300);
})();
