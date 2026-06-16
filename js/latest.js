(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "fbclid"];
  var stored = {};

  keys.forEach(function (key) {
    var value = params.get(key);
    if (value) stored[key] = value;
  });

  try {
    if (Object.keys(stored).length) {
      sessionStorage.setItem("utmify_latest", JSON.stringify(stored));
    }
  } catch (_) {}
})();
