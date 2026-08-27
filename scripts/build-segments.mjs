/**
 * build-segments.mjs — segment, product-line and geographic revenue for
 * every covered company, from each one's latest annual filing.
 *
 * The companyfacts feed the rest of the terminal reads is dimensionless:
 * it carries "revenue" but not "iPhone revenue", because the axis that
 * distinguishes them is stripped before the API serves the fact. The full
 * detail is in the filing's own XBRL instance — the machine-readable copy
 * of the segment note in Part II Item 8 and the disaggregation table
 * behind the MD&A — which EDGAR exposes as the *_htm.xml file in every
 * filing directory.
 *
 * One instance per company, three requests each (submissions, directory
 * index, instance). A filing's segment note shows three fiscal years, so
 * one pull yields a three-year trend without touching older filings.
 *
 * Facts are kept only when they carry EXACTLY one of the three axes
 * (business segment, product or service, geography). A fact carrying two
 * — Server products *within* Intelligent Cloud — is a cell of a matrix,
 * and adding it alongside the pure slices would double-count.
 *
 * Years are keyed by PERIOD END DATE, not a fiscal-year label. The
 * panel's calendar alignment renames Microsoft's FY2026 to 2025 so that
 * companies with different year-ends can be aggregated; segment data is
 * only ever shown for one company at a time, so it keeps the filing's own
 * dating and the page prints the period end with it.
 *
 * Output: frontend/data/segments.js, values in FULL dollars.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = { headers: { "User-Agent": process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba" } };

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf("--" + name);
  return i !== -1 ? argv[i + 1] : null;
};
const ONLY = (arg("ticker") || "").toUpperCase();
const LIMIT = Number(arg("limit") || 0) || 0;

/* ---------- pacing: one global gate shared by all workers ---------- */
const MIN_INTERVAL_MS = Number(process.env.SEC_MIN_INTERVAL_MS || 125);
let nextSlotAt = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
async function fetch200(url) {
  for (let a = 0; a < 5; a++) {
    await paced();
    let r;
    try {
      r = await fetch(url, UA);
    } catch (e) {
      /* Connection drops are how SEC sheds load when the request rate is
         fine but the byte rate is not — instance files run to 10MB. They
         deserve the same backoff as a 429, not a hard failure. */
      await new Promise((s) => setTimeout(s, 2500 * (a + 1)));
      continue;
    }
    if (r.ok) return r;
    if (r.status === 429 || r.status >= 500) {
      await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
      continue;
    }
    throw new Error("HTTP " + r.status);
  }
  throw new Error("retries exhausted");
}

/* ---------- minimal zip reader ---------- */
/* Some filer agents disseminate the filing only as an -xbrl.zip, with no
   loose files in the directory at all — Accenture, Netflix, Qualcomm,
   RTX among the covered set. The archive is an ordinary zip: walk the
   central directory for the one member wanted and inflate just that. */
function unzipMember(buf, nameRe) {
  const B = Buffer.from(buf);
  let eocd = -1;
  for (let i = B.length - 22; i >= Math.max(0, B.length - 65558); i--) {
    if (B.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  let off = B.readUInt32LE(eocd + 16);
  const count = B.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (B.readUInt32LE(off) !== 0x02014b50) return null;
    const method = B.readUInt16LE(off + 10);
    const csize = B.readUInt32LE(off + 20);
    const nameLen = B.readUInt16LE(off + 28);
    const extraLen = B.readUInt16LE(off + 30);
    const commentLen = B.readUInt16LE(off + 32);
    const lho = B.readUInt32LE(off + 42);
    const name = B.slice(off + 46, off + 46 + nameLen).toString("utf8");
    if (nameRe.test(name)) {
      const lNameLen = B.readUInt16LE(lho + 26);
      const lExtraLen = B.readUInt16LE(lho + 28);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const data = B.slice(dataStart, dataStart + csize);
      return method === 8 ? inflateRawSync(data).toString("utf8")
        : method === 0 ? data.toString("utf8") : null;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/* ---------- instance parsing ---------- */
const short = (v) => v.replace(/^[a-z-]+:/i, "").replace(/(Segment)?Member$/, "");

export function parseInstance(x) {
  /* Two serializations of the same data. Most filers' directories carry
     an EXTRACTED instance (plain XBRL, facts as <us-gaap:...> elements);
     the zip-only filers ship the primary document itself, which is
     INLINE XBRL — facts as <ix:nonFraction> spans inside the HTML, with
     comma-formatted values, a scale attribute, and a sign attribute
     instead of a leading minus. */
  const inline = x.indexOf("<ix:nonFraction") !== -1 || x.indexOf("<ix:header") !== -1;
  const ctx = {};
  let m;
  /* Inline documents namespace the context elements as xbrli:context. */
  const cre = /<(?:xbrli:)?context id="([^"]+)">([\s\S]*?)<\/(?:xbrli:)?context>/g;
  while ((m = cre.exec(x))) {
    const dims = {};
    const body = m[2];
    let d;
    const dre = /<xbrldi:explicitMember dimension="([^"]+)">\s*([^<\s]+)\s*<\/xbrldi:explicitMember>/g;
    while ((d = dre.exec(body))) dims[d[1]] = d[2];
    const s = (body.match(/<(?:xbrli:)?startDate>([^<]+)</) || [])[1];
    const e = (body.match(/<(?:xbrli:)?endDate>([^<]+)</) || [])[1];
    ctx[m[1]] = { start: s, end: e, dims };
  }
  const isFY = (c) => c.start && c.end &&
    (new Date(c.end) - new Date(c.start)) / 864e5 > 300;

  const AXES = {
    segment: "us-gaap:StatementBusinessSegmentsAxis",
    product: "srt:ProductOrServiceAxis",
    geography: "srt:StatementGeographicalAxis",
  };
  const REV_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "RevenuesNetOfInterestExpense",
  ];

  /* Attributes are newline-separated in some filers' instances and
     single-spaced in others, so the pattern assumes only "no > before
     the attribute". A one-space assumption silently returned nothing
     for Microsoft. */
  function keep(rows, ref, val, signed) {
    const c = ctx[ref];
    if (!c || !isFY(c)) return;
    const dk = Object.keys(c.dims).filter((k) => k !== "srt:ConsolidationItemsAxis");
    if (dk.length !== 1) return;
    if (!isFinite(val)) return;
    if (!signed && val < 0) return;
    rows.push({ end: c.end, dims: c.dims, val: val });
  }
  function facts(tag, signed) {
    const rows = [];
    let f;
    if (inline) {
      /* value text may carry commas and nested spans; scale is a power
         of ten, sign="-" flips it. */
      const re = new RegExp(
        "<ix:nonFraction([^>]*name=\"us-gaap:" + tag + "\"[^>]*)>([\\s\\S]*?)</ix:nonFraction>", "g");
      while ((f = re.exec(x))) {
        const attrs = f[1];
        const ref = (attrs.match(/contextRef="([^"]+)"/) || [])[1];
        if (!ref) continue;
        const raw = f[2].replace(/<[^>]*>/g, "").replace(/[^0-9.]/g, "");
        if (!raw) continue;
        let v = Number(raw);
        const scale = (attrs.match(/scale="(-?[0-9]+)"/) || [])[1];
        if (scale) v *= Math.pow(10, Number(scale));
        if (/sign="-"/.test(attrs)) v = -v;
        keep(rows, ref, v, signed);
      }
    } else {
      const num = signed ? "(-?[0-9.]+)" : "([0-9.]+)";
      const re = new RegExp(
        "<us-gaap:" + tag + "(?![A-Za-z])[^>]*contextRef=\"([^\"]+)\"[^>]*>\\s*" +
        num + "\\s*</us-gaap:" + tag + ">", "g");
      while ((f = re.exec(x))) keep(rows, f[1], Number(f[2]), signed);
    }
    return rows;
  }

  const revenue = { segment: {}, product: {}, geography: {} };
  for (const tag of REV_TAGS) {
    let any = false;
    for (const row of facts(tag, false)) {
      for (const [name, axis] of Object.entries(AXES)) {
        const mem = row.dims[axis];
        if (mem === undefined) continue;
        any = true;
        const byEnd = (revenue[name][row.end] = revenue[name][row.end] || {});
        const k = short(mem);
        if (!(k in byEnd)) byEnd[k] = row.val;
      }
    }
    if (any) break;
  }
  const segmentOperatingIncome = {};
  for (const row of facts("OperatingIncomeLoss", true)) {
    const mem = row.dims["us-gaap:StatementBusinessSegmentsAxis"];
    if (mem === undefined) continue;
    const byEnd = (segmentOperatingIncome[row.end] = segmentOperatingIncome[row.end] || {});
    const k = short(mem);
    if (!(k in byEnd)) byEnd[k] = row.val;
  }
  return { revenue, segmentOperatingIncome };
}

/**
 * Drop members that are aggregates of other members.
 *
 * Apple tags Products at $307.0bn alongside iPhone, Mac, iPad and
 * Wearables — which sum to exactly $307.0bn. Keeping both makes every
 * share wrong, because the denominator counts the same revenue twice.
 * A member is treated as an aggregate when two or more OTHER members sum
 * to within 0.75% of it; exact reported dollars make an accidental match
 * at that tolerance unlikely, and the check is skipped past eighteen
 * members where the subset walk stops being cheap.
 */
export function dropAggregates(byEnd) {
  for (const end of Object.keys(byEnd)) {
    const entries = Object.entries(byEnd[end]);
    if (entries.length < 3 || entries.length > 18) continue;
    const drop = new Set();
    for (const [name, val] of entries) {
      if (val <= 0) continue;
      const others = entries.filter(([n]) => n !== name && !drop.has(n))
        .map(([, v]) => v).filter((v) => v > 0).sort((a, b) => b - a);
      const tol = val * 0.0075;
      let found = false;
      (function walk(i, sum, used) {
        if (found) return;
        if (used >= 2 && Math.abs(sum - val) <= tol) { found = true; return; }
        if (i >= others.length || sum > val + tol) return;
        let rest = 0;
        for (let j = i; j < others.length; j++) rest += others[j];
        if (sum + rest < val - tol) return;
        walk(i + 1, sum + others[i], used + 1);
        walk(i + 1, sum, used);
      })(0, 0, 0);
      if (found) drop.add(name);
    }
    for (const name of drop) delete byEnd[end][name];
  }
  return byEnd;
}

/* ---------- per company ---------- */
async function pull(ticker, cik) {
  const c10 = String(cik).padStart(10, "0");
  const sub = await (await fetch200("https://data.sec.gov/submissions/CIK" + c10 + ".json")).json();
  const r = sub.filings.recent;
  let acc = null, form = null, rd = null;
  for (let i = 0; i < r.form.length; i++) {
    /* 20-F and 40-F are the foreign-filer annual forms; their segment
       notes tag the same way. */
    if (/^(10-K|20-F|40-F)$/.test(r.form[i])) {
      acc = r.accessionNumber[i]; form = r.form[i]; rd = r.reportDate[i];
      break;
    }
  }
  if (!acc) return { ticker, error: "no annual filing" };
  const accn = acc.replace(/-/g, "");
  const base = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accn;
  const idx = await (await fetch200(base + "/index.json")).json();
  const inst = idx.directory.item.find((f) => /_htm\.xml$/.test(f.name));
  let x = null;
  if (inst) {
    x = await (await fetch200(base + "/" + inst.name)).text();
  } else {
    /* zip-only dissemination: the archive is the whole filing */
    const zip = idx.directory.item.find((f) => f.name.endsWith("-xbrl.zip"));
    if (!zip) return { ticker, error: "no extracted instance", form, accession: acc };
    const buf = await (await fetch200(base + "/" + zip.name)).arrayBuffer();
    /* prefer an extracted instance; fall back to the inline-XBRL primary
       document, which parseInstance also reads */
    x = unzipMember(buf, /_htm[.]xml$/) || unzipMember(buf, /-[0-9]{8}[.]xml$/) ||
        unzipMember(buf, /-[0-9]{8}[.]htm$/);
    if (!x) return { ticker, error: "no instance in zip", form, accession: acc };
  }
  const { revenue, segmentOperatingIncome } = parseInstance(x);
  for (const k of Object.keys(revenue)) dropAggregates(revenue[k]);
  const n = (o) => Object.keys(o).length;
  return {
    ticker, form, accession: acc, reportDate: rd,
    revenue, segmentOperatingIncome,
    empty: !n(revenue.segment) && !n(revenue.product) && !n(revenue.geography),
  };
}

/* ---------- main ---------- */
const stub = {};
new Function("window", readFileSync(join(ROOT, "frontend/data/strategy-panel.js"), "utf8"))(stub);
let universe = Object.entries(stub.STRATEGY_PANEL)
  .map(([t, c]) => ({ ticker: t, cik: c.cik }));
if (ONLY) universe = universe.filter((u) => u.ticker === ONLY);
if (LIMIT) universe = universe.slice(0, LIMIT);
console.log("segments: " + universe.length + " companies");

const out = {};
const failures = [];
let done = 0;
const CONCURRENCY = 2;
const queue = universe.slice();
async function worker() {
  for (;;) {
    const u = queue.shift();
    if (!u) return;
    try {
      const res = await pull(u.ticker, u.cik);
      if (res.error) failures.push(u.ticker + ": " + res.error);
      else if (res.empty) failures.push(u.ticker + ": no tagged segment data");
      else out[u.ticker] = { form: res.form, accession: res.accession,
        reportDate: res.reportDate, revenue: res.revenue,
        segmentOperatingIncome: res.segmentOperatingIncome };
    } catch (e) {
      failures.push(u.ticker + ": " + e.message);
    }
    done++;
    if (done % 10 === 0) process.stdout.write(done + " ");
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("");

const body =
  "// GENERATED by scripts/build-segments.mjs — do not edit.\n" +
  "// Segment, product-line and geographic revenue from each company's\n" +
  "// latest annual filing (10-K/20-F/40-F), read from the filing's XBRL\n" +
  "// instance. Values are FULL DOLLARS. Years keyed by period end date.\n" +
  "window.SEGMENT_DATA = " + JSON.stringify(out) + ";\n";
writeFileSync(join(ROOT, "frontend/data/segments.js"), body);
console.log("wrote frontend/data/segments.js — " + Math.round(body.length / 1024) + "KB");
console.log(Object.keys(out).length + " companies with segment data, " + failures.length + " without");
if (failures.length) console.log("without:\n  " + failures.join("\n  "));
