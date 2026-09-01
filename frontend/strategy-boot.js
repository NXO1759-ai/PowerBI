/* Strategy Analysis — data bootstrap.
   Fetches only what the first paint needs: the panel index (which
   companies exist, in which industry), the industry chunk for the company
   being opened, and that company's segment tables and risk register.
   Then the renderer loads; the SEC company index, used only to search
   beyond the panel, arrives after the page is drawn. Other industries
   are fetched when the reader picks them. */
(function () {
  "use strict";
  var urlT = (location.search.match(/[?&]t=([A-Za-z0-9.\-]+)/) || [])[1];
  var t = urlT ? decodeURIComponent(urlT).toUpperCase() : "NVDA";
  function getJson(url, optional) {
    return fetch(url).then(function (r) {
      if (r.ok) return r.json();
      if (optional) return null;
      throw new Error(url + " returned " + r.status);
    }).catch(function (e) { if (optional) return null; throw e; });
  }
  function script(src, async) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = !!async;
      s.onload = resolve; s.onerror = function () { reject(new Error(src + " failed to load")); };
      document.head.appendChild(s);
    });
  }
  getJson("data/panel-index.json").then(function (idx) {
    window.PANEL_INDEX = idx;
    window.PANEL_FIELDS = idx.fields;
    window.STRATEGY_PANEL = {};
    window.PANEL_LOADED = {};
    window.SEGMENT_DATA = {};
    window.RISK_DATA = {};
    window.STATIC_DETAIL = {};
    var covered = idx.companies[t] ? t : "NVDA";
    var c = idx.companies[covered];
    var ind = null;
    for (var i = 0; c && i < idx.industries.length; i++) {
      if (idx.industries[i].label === c.industry) ind = idx.industries[i];
    }
    var chunk = ind ? getJson("data/panel/" + ind.file) : Promise.resolve(null);
    var detail = idx.companies[t]
      ? Promise.all([getJson("data/segments/" + t + ".json", true), getJson("data/risks/" + t + ".json", true)])
      : Promise.resolve([null, null]);
    return Promise.all([chunk, detail]).then(function (r) {
      var ch = r[0], d = r[1];
      if (ch && ch.companies) {
        Object.keys(ch.companies).forEach(function (k) { window.STRATEGY_PANEL[k] = ch.companies[k]; });
        window.PANEL_LOADED[ch.industry] = true;
      }
      if (idx.companies[t]) {
        window.STATIC_DETAIL[t] = true;
        if (d[0]) window.SEGMENT_DATA[t] = d[0];
        if (d[1]) window.RISK_DATA[t] = d[1];
      }
      return script("strategy.js");
    });
  }).then(function () {
    /* search beyond the panel needs the SEC index; nothing on the first
       paint does, so it loads after */
    return script("data/company-index.js", true);
  }).catch(function (e) {
    var st = document.getElementById("status");
    if (st) st.textContent = "The panel data failed to load: " + (e && e.message ? e.message : e);
  });
})();
