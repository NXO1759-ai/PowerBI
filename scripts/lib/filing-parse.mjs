/**
 * filing-parse.mjs — parsers over SEC filing documents, shared by the
 * weekly builders and the on-demand endpoints.
 *
 * Everything here is pure: bytes in, structure out. The functions were
 * born inside the builders and moved here so a serverless function can
 * parse one company's filing without importing a module whose top level
 * starts a 130-company crawl.
 */
import { inflateRawSync } from "node:zlib";

/* ---------- minimal zip reader ---------- */
/* Some filer agents disseminate the filing only as an -xbrl.zip, with no
   loose files in the directory at all — Accenture, Netflix, Qualcomm,
   RTX among the covered set. The archive is an ordinary zip: walk the
   central directory for the one member wanted and inflate just that. */
export function unzipMember(buf, nameRe) {
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
export const short = (v) => v.replace(/^[a-z-]+:/i, "").replace(/(Segment)?Member$/, "");

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
  /* Duration class by span: a fiscal year runs longer than 300 days, a
     discrete quarter 80 to 100 — the six- and nine-month year-to-date
     durations a 10-Q also carries fall between and are ignored. */
  const spanOf = (c) => {
    if (!c.start || !c.end) return null;
    const days = (new Date(c.end) - new Date(c.start)) / 864e5;
    return days > 300 ? "fy" : (days >= 80 && days <= 100) ? "q" : null;
  };

  const AXES = {
    segment: "us-gaap:StatementBusinessSegmentsAxis",
    product: "srt:ProductOrServiceAxis",
    geography: "srt:StatementGeographicalAxis",
  };
  /* Ordered by priority; a member keeps the first tag that supplies it.
     The last three come from probing the filers the general tags missed:
     Chubb books segment revenue as earned premiums, Progressive under the
     supplementary-insurance schedule, NextEra as regulated-and-unregulated
     operating revenue. None of these overlaps a filer that uses the
     general tags, so appending them recovers those companies without
     touching anyone else's numbers. */
  const REV_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "RevenuesNetOfInterestExpense",
    "PremiumsEarnedNet",
    "SupplementaryInsuranceInformationPremiumRevenue",
    "RegulatedAndUnregulatedOperatingRevenue",
  ];

  /* Attributes are newline-separated in some filers' instances and
     single-spaced in others, so the pattern assumes only "no > before
     the attribute". A one-space assumption silently returned nothing
     for Microsoft. */
  function keep(rows, ref, val, signed) {
    const c = ctx[ref];
    if (!c) return;
    const span = spanOf(c);
    if (!span) return;
    const dk = Object.keys(c.dims).filter((k) => k !== "srt:ConsolidationItemsAxis");
    if (dk.length !== 1) return;
    if (!isFinite(val)) return;
    if (!signed && val < 0) return;
    rows.push({ end: c.end, span: span, dims: c.dims, val: val });
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
  const quarterly = { segment: {}, product: {}, geography: {} };
  const bucketFor = (span) => (span === "q" ? quarterly : revenue);
  for (const tag of REV_TAGS) {
    for (const row of facts(tag, false)) {
      for (const [name, axis] of Object.entries(AXES)) {
        const mem = row.dims[axis];
        if (mem === undefined) continue;
        const byEnd = bucketFor(row.span)[name];
        const o = (byEnd[row.end] = byEnd[row.end] || {});
        const k = short(mem);
        if (!(k in o)) o[k] = row.val;
      }
    }
  }
  /* Banks tag no revenue line per segment at all: Truist's segments carry
     net interest income and noninterest income as two separate concepts,
     which together are what RevenuesNetOfInterestExpense means at the
     company level. Summed only where BOTH are present for a member, and
     only into periods the ordinary tags left empty, so a partial sum can
     never displace a reported figure. */
  for (const span of ["fy", "q"]) {
    const target = bucketFor(span).segment;
    const nii = {}, fee = {};
    for (const row of facts("InterestIncomeExpenseNet", true)) {
      const mem = row.dims["us-gaap:StatementBusinessSegmentsAxis"];
      if (mem !== undefined && row.span === span)
        (nii[row.end] = nii[row.end] || {})[short(mem)] = row.val;
    }
    for (const row of facts("NoninterestIncome", false)) {
      const mem = row.dims["us-gaap:StatementBusinessSegmentsAxis"];
      if (mem !== undefined && row.span === span)
        (fee[row.end] = fee[row.end] || {})[short(mem)] = row.val;
    }
    for (const end of Object.keys(nii)) {
      if (target[end] && Object.keys(target[end]).length) continue;
      for (const k of Object.keys(nii[end])) {
        if (fee[end] && k in fee[end]) {
          (target[end] = target[end] || {})[k] = nii[end][k] + fee[end][k];
        }
      }
    }
  }
  const segmentOperatingIncome = {};
  for (const row of facts("OperatingIncomeLoss", true)) {
    if (row.span !== "fy") continue;
    const mem = row.dims["us-gaap:StatementBusinessSegmentsAxis"];
    if (mem === undefined) continue;
    const byEnd = (segmentOperatingIncome[row.end] = segmentOperatingIncome[row.end] || {});
    const k = short(mem);
    if (!(k in byEnd)) byEnd[k] = row.val;
  }
  return { revenue, quarterly, segmentOperatingIncome };
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


/* ---------- Item 1A isolation ---------- */
export const strip = (h) => h
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/&#8217;|&rsquo;/gi, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
  .replace(/&#8211;|&ndash;/gi, "-").replace(/&#8212;|&mdash;/gi, "-")
  .replace(/\s+/g, " ").trim();

export function extractItem1A(html) {
  /* "Item 1A" appears several times: the contents page, the section
     heading, and cross-references from the MD&A ("the factors described
     in Item 1A"). Three facts separate the real section from the rest:
     it is always followed by an Item 1B or Item 2 heading, because that
     is the fixed order of Part I; it runs for pages; and a contents
     entry's terminator arrives within a line. A cross-reference in Part
     II has NO 1B or 2 after it at all, so requiring the terminator
     removes it without any formatting assumption. The section may
     mention Item 7A or Item 8 internally, which is why the terminator is
     specifically 1B-or-2 rather than any item number. */
  const oneARe = /item\s*(?:&nbsp;|&#160;|\s)*1\s*a\b/gi;
  const starts = [];
  let m;
  while ((m = oneARe.exec(html))) starts.push(m.index);
  if (!starts.length) return null;
  let best = null;
  for (const start of starts) {
    /* The real heading announces itself — "Item 1A. Risk Factors" — and
       is followed by prose, where a contents entry runs into the next
       item's line within a few dozen characters. Checked on stripped
       text so tags and page numbers cannot hide the difference. */
    const head = strip(html.slice(start, start + 400));
    if (!/^item\s*1\s*a\s*[.:\-]*\s*risk\s*factors/i.test(head)) continue;
    /* A cross-reference quotes the heading verbatim and then continues
       the sentence — "Item 1A. Risk Factors OF THIS Annual Report",
       "...FOR more information". A real heading is followed by prose
       that starts fresh, which may legitimately open with a preposition
       ("In addition to the other information…"), so only the specific
       reference continuations are rejected. */
    if (/^item\s*1\s*a\s*[.:\-]*\s*risk\s*factors\s*[,"']*\s*(of\s+(this|our|the)|in\s+(this|part|item)|for\s+(more|additional|information|a\s+discussion)|to\s+this)\b/i.test(head)) continue;
    const endRe = /item\s*(?:&nbsp;|&#160;|\s)*(?:1\s*b|2)\b/gi;
    endRe.lastIndex = start + 40;
    const e = endRe.exec(html);
    if (!e) continue;
    const span = e.index - start;
    /* A contents row dies on the floor: its next-item reference arrives
       within a line. Among the survivors the FIRST in document order
       wins. Not the smallest: filers that repeat "Item 1A. Risk Factors"
       as a page-continuation header create many later candidates whose
       spans shrink toward the section's end, and the smallest of those is
       the last page, not the section. The first qualifying start IS the
       section — everything before it was a contents row (too small) or a
       cross-reference (fails the heading pattern or has no terminator). */
    if (span < 8000 || span > 1500000) continue;
    best = { start: start, end: e.index, span: span };
    break;
  }
  if (!best) return null;
  return html.slice(best.start, best.end);
}

export function extractHeadings(sectionHtml) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    let t = strip(raw).replace(/[.;:]\s*$/, "");
    /* bullets and stray page numbers travel inside the styled run */
    t = t.replace(/&#8226;|&bull;/gi, " ").replace(/^[•·▪◦\s]+/, "")
         .replace(/^\d{1,3}\s+(?=[A-Z])/, "").replace(/\s+/g, " ").trim();
    if (t.length < 25 || t.length > 300) return;
    if (!/[a-z]/.test(t) || !/\s/.test(t)) return;
    /* page furniture and cross-references */
    if (/^(item|table of contents|part\s+[ivx]+|risk factors?|summary)/i.test(t)) return;
    if (/^\d+$/.test(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  /* bold and italic elements */
  let m;
  const tagRe = /<(b|strong|i|em)\b[^>]*>([\s\S]{10,2000}?)<\/\1>/gi;
  while ((m = tagRe.exec(sectionHtml))) push(m[2]);
  /* spans styled bold or italic inline */
  const spanRe = /<(span|p|div)\b[^>]*style="[^"]*(?:font-weight\s*:\s*(?:bold|[7-9]00)|font-style\s*:\s*italic)[^"]*"[^>]*>([\s\S]{10,2000}?)<\/\1>/gi;
  while ((m = spanRe.exec(sectionHtml))) push(m[2]);
  return out;
}

