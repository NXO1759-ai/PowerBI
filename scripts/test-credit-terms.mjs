/**
 * test-credit-terms.mjs — the credit glossary and its browser file.
 *
 * Checks the glossary's shape (every entry complete, every popup under
 * 240 characters, no term or alias shared between entries), that every
 * term the blueprint's refuters listed as missing is present, that the
 * committed frontend/lib/credit-terms.js is byte-identical to a fresh run
 * of the generator and carries only the hover fields (the definitions
 * stay in the JSON for the Glossary view to fetch), and that the wrapper
 * wraps the first occurrence of a term in each section and nothing
 * inside code, links or the popup. The
 * wrapper runs against a small DOM shim so no browser is needed. Exits
 * non-zero on the first failure.
 */
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const T = require("../frontend/lib/credit-terms.js");
const glossary = JSON.parse(readFileSync(join(ROOT, "frontend/data/pc/glossary.json"), "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

/* ---------- 1. shape ---------- */
{
  const terms = glossary.terms;
  const missing = [];
  for (const t of terms) {
    for (const f of ["term", "popup", "definition", "source", "side", "kind"]) {
      if (typeof t[f] !== "string" || !t[f].trim()) missing.push(`${t.term || "?"}.${f}`);
    }
  }
  check("every entry has term, popup, definition, source, side and kind", !missing.length, missing.slice(0, 5).join(", "));
  const long = terms.filter((t) => t.popup.length > 240).map((t) => `${t.term} (${t.popup.length})`);
  check("every popup is 240 characters or fewer", !long.length, long.slice(0, 5).join(", "));
  const sides = new Set(terms.map((t) => t.side));
  check("side is market, lender or both", [...sides].every((s) => ["market", "lender", "both"].includes(s)), [...sides].join(","));
  const kinds = new Set(terms.map((t) => t.kind));
  check("kind is one of the six", [...kinds].every((k) => ["series-id", "acronym", "instrument", "metric", "market", "regulation"].includes(k)), [...kinds].join(","));
  const seen = new Map(), dupes = [];
  for (const t of terms) {
    for (const k of [t.term, ...(t.aliases || [])]) {
      const key = k.toLowerCase();
      if (seen.has(key) && seen.get(key) !== t.term) dupes.push(`${k}: ${t.term} / ${seen.get(key)}`);
      seen.set(key, t.term);
    }
  }
  check("no term or alias is shared between two entries (case-insensitive)", !dupes.length, dupes.slice(0, 5).join("; "));
  check("count field matches", glossary.count === terms.length, `${glossary.count} vs ${terms.length}`);
  check("the browser file carries every term", T.TERMS.length === terms.length, `${T.TERMS.length} vs ${terms.length}`);
  /* the house rule keeps model and vendor names out of every file, this
     one included, so the banned words are stored reversed */
  const banned = new RegExp(["edualc", "ciporhtna", "keespeed", "ianepo", "tpgtahc"]
    .map((w) => w.split("").reverse().join("")).join("|"), "i");
  const raw = readFileSync(join(ROOT, "frontend/data/pc/glossary.json"), "utf8");
  check("no model or vendor name in the glossary", !banned.test(raw));
  /* every source is a public reference a reader can open: no working
     file, no fetch tooling, no design document by name */
  const privateRef = /scratchpad|pc-x\/|with curl|the blueprint/i;
  const leaked = terms.filter((t) => privateRef.test([t.term, t.expansion, t.popup, t.definition, t.source, (t.aliases || []).join(" ")].join("\n"))).map((t) => t.term);
  check("no working-file path, curl note or design-document name in any shown field", !leaked.length, leaked.slice(0, 5).join(", "));
  check("the raw JSON carries none either", !privateRef.test(raw));
  /* code lives in workingRef, which is never built; a reader sees "this
     site's own construction", never a path or a function name */
  const codeRef = /frontend\/|scripts\/|api\/[a-z-]+\.js|RTCatalog\.|RTValuation\.|\b(?:terms|composite|coverage)\.json\b|\bPR [A-Z]\b|section 15\b/;
  const coded = terms.filter((t) => codeRef.test([t.popup, t.definition, t.source].join("\n"))).map((t) => t.term);
  check("no popup, definition or source names a code file, a function or a build step", !coded.length, coded.slice(0, 5).join(", "));
}

/* ---------- 2. the refuters' omissions (blueprint section 8 and 15.9) ---------- */
{
  const required = [
    "term SOFR", "SONIA", "EURIBOR", "EBITDA", "incurrence covenant", "market flex", "fulcrum security",
    "add-on", "dividend recapitalization", "revolver", "delayed-draw term loan", "GP", "LP", "drawdown fund",
    "evergreen vehicle", "megafund", "CAGR", "IRR", "TVPI", "DPI", "RVPI", "PME",
    "PitchBook", "LCD", "ICE BofA", "Morningstar LSTA", "MFA", "KBRA", "Moody's", "Fitch", "S&P",
    "BIZD", "BKLN", "SRLN", "adjusted close", "rebased to 100",
    /* the fund types on chart29 (series-catalog.json, US private debt capital raised by type) */
    "Venture debt", "Real estate debt", "Mezzanine", "Infrastructure debt", "Debt (fund type)", "Distressed debt",
    "Direct lending", "Credit special situations", "Bridge financing",
    /* scorecard rows without entries */
    "NII per share", "NII return on NAV", "cost of debt", "net interest margin", "dividend yield",
    "total-investment-income yield", "yield on new investments", "yield on exits", "risk-rating mix",
    "severity stripe", "reconciliation gate",
    /* section 15.9 popups */
    "capex (tagged)", "capex run-rate", "capex to operating cash flow", "capex to depreciation", "funding gap",
    "sources and uses", "finance lease vs operating lease", "leases not yet commenced",
    "purchase obligation and contractual commitment", "gross debt (principal)", "net debt", "net debt to EBITDA",
    "interest coverage", "capitalized interest", "accrued capex", "maturity ladder", "contract-backed and take-or-pay",
    "backlog to debt", "SPV and non-recourse debt", "joint-venture financing", "residual value guarantee", "backstop",
    "mandatory convertible preferred", "PIK preferred", "customer prepayments", "guidance vs outturn",
    "net cash outlay for capex (Oracle)", "new-issue spread", "OAS", "rating action", "DSCR", "vendor financing",
    "private-credit share of the ledger", "calendar-quarter alignment", "RPO", "DDTL", "neocloud",
  ];
  const absent = required.filter((r) => !T.index.has(r));
  check(`every listed omission resolves to an entry (${required.length} checked)`, !absent.length, absent.join(", "));
  check("an alias resolves to its entry", T.lookup("DDTL") && T.lookup("DDTL").term === "delayed-draw");
  check("lookup is case-insensitive", T.lookup("nii per share") && T.lookup("NII PER SHARE").term === "NII per share");
}

/* ---------- 3. section-8 fixes applied ---------- */
{
  const by = (n) => glossary.terms.find((t) => t.term === n);
  check("AUM figures from the 2024 report are dated June 30, 2024",
    /as of June 30, 2024/.test(by("AUM").definition) && /as of June 30, 2024/.test(by("Dry powder").definition) &&
    /as of June 30, 2024/.test(by("Private debt").definition) && /as of June 30, 2024/.test(by("Direct lending").definition));
  check("no AUM figure is still dated end-2024", !glossary.terms.some((t) => /end-2024/.test(t.definition)));
  check("the SBA-exempt seed list is marked unconfirmed", /unconfirmed seed/.test(by("SBA debentures").definition));
  /* SEC frames, fetched 2026-09-11: https://data.sec.gov/api/xbrl/frames/us-gaap/
     InvestmentCompanySeniorSecurityIndebtednessAssetCoverageRatio/pure/CY2026Q2I.json
     (76 filers). "Exchange-listed" is the exchanges field of each filer's
     https://data.sec.gov/submissions/CIK##########.json naming NYSE or Nasdaq,
     fetched the same day: 19 filers, by CIK and ratio —
       under 2.00 (14): MFIC 1278752 1.63, ARCC 1287750 1.86, SAR 1377936 1.626,
       OCSL 1414932 1.9416, FSK 1422183 1.79, GBDC 1476765 1.8037, NMFC 1496099 1.8622,
       CION 1534254 1.57, CGBD 1544206 1.8229, OBDC 1655888 1.87, BXSL 1736035 1.78,
       NCDL 1737924 1.7764, KBDC 1747172 1.5, MSDL 1782524 1.827;
       at or over 2.00 (5): CSWC 17313 2.09, PSEC 1287032 3.394, GAIN 1321741 2.088,
       PFX 1490349 2, OTF 1747777 2.03.
     FRBP 1825248 (1.78) is OTC, not exchange-listed, and is not counted. */
  check("the 150% election popup states the counted figure", /14 of the 19 exchange-listed/.test(by("150%/200% election").popup) && !/Most listed/.test(by("150%/200% election").popup));
  check("no popup generalizes with 'most elected'", !glossary.terms.some((t) => /most (listed BDCs have )?elected/i.test(t.popup)));
  check("the OAS definition says five OAS tiles and one yield", /Five of the six/.test(by("OAS").definition));
}

/* ---------- 4. the committed file equals a fresh generator run ---------- */
{
  const dir = mkdtempSync(join(tmpdir(), "credit-terms-"));
  const out = join(dir, "credit-terms.js");
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/build-credit-terms.mjs"), out], { encoding: "utf8" });
  check("the generator runs", r.status === 0, (r.stderr || "").slice(0, 200));
  const fresh = r.status === 0 ? readFileSync(out) : Buffer.alloc(0);
  const committed = readFileSync(join(ROOT, "frontend/lib/credit-terms.js"));
  check("frontend/lib/credit-terms.js is byte-identical to a fresh run", fresh.equals(committed),
    fresh.equals(committed) ? "" : `${fresh.length} vs ${committed.length} bytes — run node scripts/build-credit-terms.mjs`);
  rmSync(dir, { recursive: true, force: true });
  const src = committed.toString("utf8");
  check("the generated file parses as a script", (() => { try { new Function(src); return true; } catch { return false; } })());
  check("the generated file is an IIFE assigning RTTerms, not a module", /root\.RTTerms = factory\(\)/.test(src) && !/^\s*(import|export)\s/m.test(src));
  check("the generated file carries no working-file path or design-document name", !/scratchpad|pc-x\/|with curl|the blueprint/i.test(src));
  check("the generated file embeds no maintenance field", !/"(whereUsed|fixNote|workingRef)"/.test(src));
  /* the definitions are fetched by the Glossary view, never embedded */
  const HOVER = ["term", "expansion", "kind", "side", "popup", "source", "aliases"];
  const extra = T.TERMS.filter((t) => Object.keys(t).some((k) => !HOVER.includes(k))).map((t) => t.term);
  check("every embedded entry carries only the hover fields", !extra.length, extra.slice(0, 5).join(", "));
  check("the generated file embeds no definition", !/"definition"/.test(src));
  /* a glossary text with "$&" must land verbatim: the splice is a function replacer */
  const { build } = await import("./build-credit-terms.mjs");
  const probe = build({ generated: "2026-01-01", terms: [{ term: "probe", popup: "a $& b $' c $$ d", definition: "x", source: "y", kind: "acronym", side: "market" }] });
  check("a $-pattern in a popup survives the generator unchanged", probe.indexOf("a $& b $' c $$ d") > 0);
}

/* ---------- 5. the pure matcher ---------- */
{
  let seen = {};
  const parts = T.tokenize("The HY OAS (BAMLH0A0HYM2) sits at 2.71%; OAS again.", seen);
  const wrapped = parts.filter((p) => p.term).map((p) => p.text);
  check("each term is wrapped once per section", wrapped.join("|") === "HY|OAS|BAMLH0A0HYM2", wrapped.join("|"));
  check("text round-trips through the tokenizer", parts.map((p) => p.text).join("") === "The HY OAS (BAMLH0A0HYM2) sits at 2.71%; OAS again.");
  seen = {};
  check("a series id is case-sensitive", T.tokenize("sofr is not the id", seen) === null);
  seen = {};
  check("an acronym is case-sensitive", T.tokenize("the nii line", seen) === null);
  seen = {};
  const ph = T.tokenize("Dividend coverage under 1.0x", seen);
  check("a phrase matches in any case", ph && ph[0].term === "dividend coverage", JSON.stringify(ph && ph[0]));
  seen = {};
  check("whole words only: $2,899B does not contain the rating B", T.tokenize("C&I loans $2,899B", seen).filter((p) => p.term).map((p) => p.term).join("|") === "C&I");
  seen = {};
  const longest = T.tokenize("core NII and NII", seen).filter((p) => p.term).map((p) => p.term);
  check("the longest term wins at a position", longest.join("|") === "core NII|NII", longest.join("|"));
  seen = {};
  const al = T.tokenize("a DDTL draw", seen).filter((p) => p.term)[0];
  check("an alias wraps with its entry's term", al && al.text === "DDTL" && al.term === "delayed-draw");
  const h = T.html({ term: "x<y", expansion: "a&b", popup: "\"q\"", source: "s'" });
  check("popup html escapes every field", !/<y|a&b|"q"|s'/.test(h) && /&lt;y/.test(h) && /&amp;b/.test(h));
}

/* ---------- 6. the wrapper against a DOM shim ---------- */
{
  /* Enough DOM for wrap(): elements with childNodes, classList, attributes,
     querySelectorAll on a tag, class or attribute selector; text nodes; a
     fragment; a document with createTreeWalker over text nodes. */
  function El(tag, attrs) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = attrs || {}; this.childNodes = []; this.parentNode = null;
    const self = this;
    this.classList = { contains: (c) => (self.attrs.class || "").split(/\s+/).includes(c) };
  }
  El.prototype.getAttribute = function (n) { return n in this.attrs ? this.attrs[n] : null; };
  El.prototype.hasAttribute = function (n) { return n in this.attrs; };
  El.prototype.setAttribute = function (n, v) { this.attrs[n] = String(v); };
  Object.defineProperty(El.prototype, "className", { set(v) { this.attrs.class = v; }, get() { return this.attrs.class || ""; } });
  Object.defineProperty(El.prototype, "textContent", {
    set(v) { this.childNodes = [new Tx(v)]; this.childNodes[0].parentNode = this; },
    get() { return this.childNodes.map((c) => c.nodeType === 3 ? c.nodeValue : c.textContent).join(""); },
  });
  El.prototype.matches = function (sel) {
    if (sel[0] === ".") return this.classList.contains(sel.slice(1));
    if (sel[0] === "[") return this.hasAttribute(sel.slice(1, -1));
    return this.tagName === sel.toUpperCase();
  };
  El.prototype.querySelectorAll = function (sel) {
    const out = [];
    (function walk(n) { for (const c of n.childNodes) { if (c.nodeType === 1) { if (c.matches(sel)) out.push(c); walk(c); } } })(this);
    return out;
  };
  El.prototype.appendChild = function (c) { c.parentNode = this; this.childNodes.push(c); return c; };
  El.prototype.replaceChild = function (nu, old) {
    const i = this.childNodes.indexOf(old);
    const list = nu.nodeType === 11 ? nu.childNodes : [nu];
    list.forEach((c) => { c.parentNode = this; });
    this.childNodes.splice(i, 1, ...list);
    return old;
  };
  function Tx(v) { this.nodeType = 3; this.nodeValue = v; this.parentNode = null; }
  const doc = {
    createElement: (t) => new El(t),
    createTextNode: (v) => new Tx(v),
    createDocumentFragment: () => ({ nodeType: 11, childNodes: [], appendChild(c) { this.childNodes.push(c); return c; } }),
    createTreeWalker(root, what, filter) {
      const texts = [];
      (function walk(n) { for (const c of n.childNodes) { if (c.nodeType === 3) texts.push(c); else walk(c); } })(root);
      let i = -1;
      return {
        currentNode: null,
        nextNode() {
          while (++i < texts.length) { if (filter.acceptNode(texts[i]) === 1) { this.currentNode = texts[i]; return texts[i]; } }
          return null;
        },
      };
    },
  };
  function parse(html) {
    const root = new El("div"); let cur = root;
    const re = /<\/([a-z0-9-]+)>|<([a-z0-9-]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
    let m;
    while ((m = re.exec(html))) {
      if (m[1]) { cur = cur.parentNode; continue; }
      if (m[2]) {
        const attrs = {};
        (m[3] || "").replace(/([a-z-]+)(?:="([^"]*)")?/gi, (_, k, v) => { attrs[k] = v === undefined ? "" : v; return ""; });
        const el = new El(m[2], attrs); cur.appendChild(el); if (!/\/>$/.test(m[0])) cur = el; continue;
      }
      if (m[4]) cur.appendChild(new Tx(m[4]));
    }
    return root;
  }

  const page = parse(
    "<section><p>High-yield OAS from BAMLH0A0HYM2 is an OAS; <code>BAMLH0A0HYM2</code> stays plain and so does " +
    "<a href=\"#\">OAS in a link</a>. BAMLH0A0HYM2 again.</p><div class=\"metric-pop\">OAS</div>" +
    "<p data-no-terms=\"\">OAS</p><h3 data-metric=\"hyOas\">High-yield OAS</h3></section>" +
    "<section><p>A second section: OAS and BAMLH0A0HYM2 once more, then OAS.</p></section>");
  const made = T.wrap(page, { perSection: "section", document: doc });
  const spans = page.querySelectorAll(".term");
  const inSection = (i) => page.querySelectorAll("section")[i].querySelectorAll(".term").map((s) => s.getAttribute("data-term"));
  check("wrap returns the number of spans", made === spans.length && made === 4, String(made));
  check("section 1 wraps BAMLH0A0HYM2 and OAS once each", inSection(0).sort().join("|") === "BAMLH0A0HYM2|OAS", inSection(0).join("|"));
  check("section 2 wraps them again, once each", inSection(1).sort().join("|") === "BAMLH0A0HYM2|OAS", inSection(1).join("|"));
  const code = page.querySelectorAll("code")[0], link = page.querySelectorAll("a")[0];
  check("nothing is wrapped inside <code>", code.querySelectorAll(".term").length === 0 && code.textContent === "BAMLH0A0HYM2");
  check("nothing is wrapped inside <a>", link.querySelectorAll(".term").length === 0);
  check("nothing is wrapped inside .metric-pop, [data-no-terms] or [data-metric]",
    ["div", "p", "h3"].every((tag) => page.querySelectorAll(tag).filter((e) => e.classList.contains("metric-pop") || e.hasAttribute("data-no-terms") || e.hasAttribute("data-metric"))
      .every((e) => e.querySelectorAll(".term").length === 0)));
  const first = spans[0];
  check("a wrapped span is focusable and carries the term", first.tabIndex === 0 && first.classList.contains("term") && first.getAttribute("data-term"));
  check("the page text is unchanged by wrapping", page.textContent === parse(
    "<section><p>High-yield OAS from BAMLH0A0HYM2 is an OAS; <code>BAMLH0A0HYM2</code> stays plain and so does " +
    "<a href=\"#\">OAS in a link</a>. BAMLH0A0HYM2 again.</p><div class=\"metric-pop\">OAS</div>" +
    "<p data-no-terms=\"\">OAS</p><h3 data-metric=\"hyOas\">High-yield OAS</h3></section>" +
    "<section><p>A second section: OAS and BAMLH0A0HYM2 once more, then OAS.</p></section>").textContent);
  const again = T.wrap(page, { perSection: "section", document: doc });
  check("a second wrap is a no-op", again === 0 && page.querySelectorAll(".term").length === 4, String(again));
  const bare = parse("<p>OAS here</p>");
  check("a root with no sections is one section", T.wrap(bare, { perSection: "section", document: doc }) === 1);
}

console.log(failed ? "\n" + failed + " failed" : "\nall credit-terms checks pass");
process.exit(failed ? 1 : 0);
