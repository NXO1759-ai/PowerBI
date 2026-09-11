/**
 * test-nav.mjs — the page family stays one family, offline.
 *
 * The four dashboards carry the same four nav tabs in the same order,
 * every short label fits a phone-width tab, the retired "Soon" pill and
 * the old "Private Credit Report" name are gone, the credit page is
 * titled as decided, no page references a script that is not on disk,
 * credit.js parses, and every caption template on the credit page
 * measures under 240 characters with its widest sample values.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = join(ROOT, "frontend");
const PAGES = ["index.html", "statements.html", "credit.html", "strategy.html"];
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? "  ok   " : "  FAIL ") + n + (d ? "  " + d : "")); if (!ok) failed++; };

const html = Object.fromEntries(PAGES.map((p) => [p, readFileSync(join(FRONT, p), "utf8")]));

/* the nav: same tabs, same order, on every page */
const tabsOf = (src) => {
  const nav = (src.match(/<nav class="nav-tabs"[\s\S]*?<\/nav>/) || [""])[0];
  return [...nav.matchAll(/<a class="nav-tab[^"]*" href="([^"]+)"[^>]*><span class="tab-long">([^<]+)<\/span><span class="tab-short">([^<]+)<\/span>/g)]
    .map((m) => ({ href: m[1], long: m[2], short: m[3] }));
};
const expected = tabsOf(html["index.html"]);
check("index.html carries four nav tabs", expected.length === 4, String(expected.length));
for (const p of PAGES) {
  const tabs = tabsOf(html[p]);
  check(p + " carries the same four tabs in the same order",
    JSON.stringify(tabs) === JSON.stringify(expected), JSON.stringify(tabs.map((t) => t.short)));
  check(p + " short labels fit a phone tab (≤ 10 characters)", tabs.every((t) => t.short.length <= 10),
    tabs.map((t) => t.short + ":" + t.short.length).join(" "));
  check(p + " has no Soon pill", !/soon-pill/.test(html[p]));
  check(p + " no longer says Private Credit Report", !/Private Credit Report/.test(html[p]));
  check(p + " marks exactly one tab active", (html[p].match(/nav-tab active/g) || []).length === 1);
}
const credit = expected.find((t) => t.href === "credit.html");
check("the credit tab reads Private Credit Terminal / Credit", !!credit && credit.long === "Private Credit Terminal" && credit.short === "Credit",
  credit && credit.long + " / " + credit.short);
check("styles.css no longer styles the pill", !/soon-pill/.test(readFileSync(join(FRONT, "styles.css"), "utf8")));

/* the credit page's title and og tags */
const title = (html["credit.html"].match(/<title>([^<]+)<\/title>/) || [])[1];
check("credit.html title", title === "Private Credit Terminal — Research Terminal", title);
check("credit.html og:title matches", /og:title" content="Private Credit Terminal — Research Terminal"/.test(html["credit.html"]));

/* every script a page loads exists on disk (vendored and generated files included) */
for (const p of PAGES) {
  const srcs = [...html[p].matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const missing = srcs.filter((s) => !/^https?:/.test(s) && !existsSync(join(FRONT, s)));
  check(p + " references only scripts that exist (" + srcs.length + ")", missing.length === 0, missing.join(", "));
}

/* credit.js parses, and its captions measure under 240 with the widest samples */
const src = readFileSync(join(FRONT, "credit.js"), "utf8");
let parsed = true;
try { new Function(src); } catch (e) { parsed = false; check("credit.js parses", false, e.message); }
if (parsed) {
  check("credit.js parses", true);
  const mod = {};
  new Function("module", src)(mod);
  const CAPTIONS = mod.exports && mod.exports.CAPTIONS;
  check("credit.js hands its CAPTIONS to a non-browser caller", !!CAPTIONS && typeof CAPTIONS.sample === "function");
  if (CAPTIONS) {
    const samples = CAPTIONS.sample();
    const keys = Object.keys(samples);
    check("at least the M8, M1, M2 and NDFI captions are templated", ["m8", "m1", "m2", "ndfi"].every((k) => k in samples), keys.join(","));
    for (const k of keys) {
      check("caption " + k + " measures under 240 characters", samples[k].length < 240, samples[k].length + " chars");
      check("caption " + k + " carries no source stamp (that lives in the footer)", !/Source:|FRED/.test(samples[k]));
    }
    const marked = (src.match(/\/\* caption \*\//g) || []).length;
    check("every template is marked /* caption */", marked >= keys.length, marked + " marks for " + keys.length + " templates");
  }
}

console.log(failed ? "\n" + failed + " failed" : "\nall nav checks pass");
process.exit(failed ? 1 : 0);
