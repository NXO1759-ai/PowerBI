/**
 * bdc-prose.mjs — the figures a business development company states in
 * the prose of its 10-Q or 10-K and tags nowhere.
 *
 * The schedule of investments gives every loan's cost, fair value, spread
 * and rate, and the companyfacts feed gives the balance sheet. What
 * neither carries is what the manager says about the book: the asset
 * coverage ratio for the twelve top-30 filers that do not tag it, the
 * weighted-average yield the manager computed with discount accretion,
 * the loan-to-value, the floating share, the count of portfolio
 * companies, the non-accrual rate at cost and at fair value, the Item 3
 * table that turns a base-rate move into dollars of income and expense,
 * the dividend note's split of regular from supplemental, the target
 * leverage range, and the fee schedule. Those come from here.
 *
 * Every figure returned is { v, sentence, where }: the number as stated,
 * the sentence (or the table row) it was read from, and where that
 * sentence sits — the line and character offset in the text this module
 * makes of the document (htmlToText, then the page joins below), and
 * the Item heading above it. A document that lacks the sentence yields
 * null for the field, never a number from another sentence that merely
 * resembles it; a figure the page shows without its sentence is a
 * figure nobody can check.
 *
 * The reader takes the main document as EDGAR serves it (inline XBRL
 * HTML) or the text this module makes of it. A table becomes one line
 * per row with the cells separated by " | ", so a row reads as a
 * sentence and the numbers keep their column order; the paragraphs
 * become one line each, and a paragraph a page break split in two is
 * joined back. Filers put the current period in the first numeric
 * column of a 10-Q table (BXSL: "9.2% | 9.5%" under "June 30, 2026 |
 * December 31, 2025"), and the reader confirms the order from the
 * nearest dated header above the row before taking the first number.
 * A joint venture's table ("a summary of SCP's portfolio", TSLX) and a
 * segment's table ("LMM | Private Loan", MAIN) are not the filer's and
 * are passed over.
 *
 * Verified sentence forms (2026-09-11), each with a fixture under
 * scripts/fixtures/prose/ and a case in scripts/test-bdc-prose.mjs:
 *   BXSL 10-Q 2026-06-30, accession 0001736035-26-000016:
 *     "the Company's asset coverage was 178.0 % and 177.1 %, respectively"
 *     portfolio table rows "Number of portfolio companies | 313 | 316",
 *     "... at amortized cost (1)(2) | 9.2 % | 9.5 %", "... at fair value
 *     (1)(2) | 9.4 % | 9.6 %", "Average loan-to-value (LTV) (3) | 51.9 %",
 *     "Percentage of performing debt investments bearing a floating rate
 *     (4) | 99.3 %", "Percentage of assets on non-accrual, at amortized
 *     cost (5) | 3.6 %", "... at fair value (5) | 1.8 %";
 *     Item 3: "Up 100 basis points | $ | 132,588 | $ | (23,798) | $ |
 *     108,790" in thousands;
 *     Note 3: "income based incentive fee of 17.5 %, with a 1.5 % hurdle
 *     and 100 % catch-up"; "annual rate of 1.0 % of the average value of
 *     the Company's "gross assets"".
 *   MAIN 10-Q 2026-06-30, accession 0001396440-26-000094:
 *     "As of June 30, 2026, our BDC asset coverage ratio was 244%" in the
 *     paragraph that states the January 2008 exemptive relief for the
 *     SBA-guaranteed debentures; Note G rows "Regular monthly dividends
 *     per share | $ | 0.78" and "Supplemental dividends per share | 0.30";
 *     "investments on non-accrual status were $ 65.2 million at fair
 *     value and $ 198.5 million at cost and comprised 1.1 % and 4.0 % of
 *     ... at fair value and cost, respectively" (fair value first);
 *     "Distributable net investment income ... $97.4 million, or $1.04
 *     per share"; Item 3 rows "(100) | (23,034) | 2,410 | (617) |
 *     (21,241) | (0.23)" under a "Basis Point Change" header;
 *     "to operate as an internally managed business development company".
 *   ARCC 10-Q 2026-06-30, accession 0001628280-26-050307:
 *     "loans on non-accrual status represented 2.4 % of the total
 *     investments at amortized cost (or 1.4 % at fair value) and 1.8 %
 *     at amortized cost (or 1.2 % at fair value), respectively";
 *     "Weighted average yield on portfolio | 9.5 | % | 10.1 | %" with
 *     the footnote "Includes non-interest earning investments";
 *     "the Company's asset coverage was 186 %"; "Up 100 basis points |
 *     $ | 212 | $ | 118 | $ | 94" in millions; the base management fee
 *     "1.5 %" up to 1.0x debt to equity and "1.0 %" over it.
 *
 * Not here, by design: anything computed. A yield, a share or a ratio
 * the filing does not state is left to the schedule reader and to
 * frontend/lib/credit.js, and the two are compared, never merged.
 */

/* ---------- text ---------- */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", shy: "",
  rsquo: "'", lsquo: "'", ldquo: "\"", rdquo: "\"", ndash: "-", mdash: "-",
  hellip: "...", sect: "§", bull: "•", middot: "·", trade: "",
  reg: "", copy: "",
};

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => fromCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : m));
}

/* the typographic characters filers use where a regex wants ASCII */
function fromCode(n) {
  if (n === 160 || n === 8194 || n === 8195 || n === 8201 || n === 8239) return " ";
  if (n === 173 || n === 8203) return "";
  if (n === 8211 || n === 8212 || n === 8209 || n === 8722 || n === 8208) return "-";
  if (n === 8216 || n === 8217) return "'";
  if (n === 8220 || n === 8221) return "\"";
  if (n === 8230) return "...";
  if (n < 32 && n !== 9 && n !== 10 && n !== 13) return " ";
  return String.fromCodePoint(n);
}

/* An inline tag (a span, an inline-XBRL fact, a footnote superscript)
   takes no width: "(or 1</span><span>.49%" is 1.49%, as a browser shows
   it. Every other tag is a boundary between words. */
const INLINE_TAG = /<\/?(?:span|ix:[\w-]+|a|b|i|u|em|strong|sup|sub|font|small|big|s|strike|abbr|time|label|nobr|wbr)\b[^>]*>/gi;

const stripTags = (s) => decodeEntities(String(s)
  .replace(/<br\s*\/?>/gi, " ")
  .replace(INLINE_TAG, "")
  .replace(/<[^>]+>/g, " "))
  .replace(/[ \t\r\f\v ]+/g, " ")
  .trim();

/* One table row per line, cells joined by " | ", empty cells dropped.
   A cell that closes itself (<td .../>) is a filler; the rendering
   engines put one between every pair of figures, and a reader that
   treats it as an opening tag swallows the next cell into it. */
function tableToText(tableHtml) {
  const lines = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tableHtml))) {
    const cells = [];
    const tdRe = /<t([dh])\b([^>]*?)(\/?)>/gi;
    let td;
    while ((td = tdRe.exec(tr[1]))) {
      if (td[3] === "/" || /\/\s*$/.test(td[2])) continue;
      const close = new RegExp(`</t${td[1]}\\s*>`, "i");
      close.lastIndex = 0;
      const rest = tr[1].slice(tdRe.lastIndex);
      const m = close.exec(rest);
      const inner = m ? rest.slice(0, m.index) : rest;
      const text = stripTags(inner);
      if (text) cells.push(text);
      if (m) tdRe.lastIndex += m.index + m[0].length;
    }
    if (cells.length) lines.push(cells.join(" | "));
  }
  return "\n" + lines.join("\n") + "\n";
}

/**
 * The main document as lines: paragraphs one per line, table rows one
 * per line with " | " between the cells. Text that carries no tags is
 * returned with its line endings normalized, so a fixture cut from this
 * output reads back identically.
 */
export function htmlToText(html) {
  const s = String(html);
  if (!/<(?:table|p|div|tr|body|html|span)\b/i.test(s)) {
    return s.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  }
  let t = s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  /* innermost tables first, so a nested table renders as rows of its own */
  for (let guard = 0; guard < 8; guard++) {
    const before = t;
    t = t.replace(/<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/gi, (m) => tableToText(m));
    if (t === before) break;
  }
  t = t
    .replace(/<\/(?:p|div|li|h[1-6]|tr|ul|ol|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(INLINE_TAG, "")
    .replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return t
    .replace(/[ \t\r\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/* ---------- numbers and cells ---------- */

const NUM_SRC = String.raw`\(?-?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|x|X|times|percent|bps|basis points)?\)?`;

/* "(23,798)" -> -23798; "1.78x" -> 1.78 with unit x; "9.2 %" -> 9.2 with
   unit %; "-" alone -> 0 (a dash in a money column is a zero) */
export function parseNumber(raw) {
  const s = String(raw).trim();
  if (/^[-—–]$/.test(s)) return { v: 0, unit: null, dash: true };
  const m = new RegExp("^" + NUM_SRC + "$").exec(s);
  if (!m) return null;
  const neg = /^\(/.test(s) && /\)$/.test(s) || /^-|^\(?\$?\s?-/.test(s);
  const v = Number(m[1].replace(/,/g, "") + (m[2] || ""));
  if (!Number.isFinite(v)) return null;
  const unit = m[3] ? m[3].toLowerCase() : null;
  return { v: neg ? -v : v, unit: unit === "percent" ? "%" : unit === "times" ? "x" : unit };
}

export const cellsOf = (line) => String(line).split("|").map((c) => c.trim()).filter(Boolean);

/* The numbers of a row in column order. A "$" or "%" that sits in a
   cell of its own belongs to its neighbour; a footnote marker "(1)" is
   not a figure (it follows a label or sits alone between labels). */
export function rowNumbers(line, { markers = true } = {}) {
  const cells = cellsOf(line);
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    let c = cells[i];
    if (c === "$" || c === "%") continue;
    /* "(3)" after a label is a footnote marker; after a "$" or another
       figure it is a negative three */
    if (markers && /^\(\d{1,2}\)$/.test(c) &&
        (i === 0 || (cells[i - 1] !== "$" && !parseNumber(cells[i - 1])))) continue;
    const n = parseNumber(c);
    if (!n) continue;
    let unit = n.unit;
    if (!unit && cells[i + 1] === "%") unit = "%";
    if (n.dash) { out.push({ v: 0, unit, dash: true, raw: c }); continue; }
    out.push({ v: n.v, unit, raw: c });
  }
  return out;
}

/* the text of a row before its first figure: the label */
export function rowLabel(line) {
  const cells = cellsOf(line);
  const label = [];
  for (const c of cells) {
    if (c === "$") break;
    if (parseNumber(c) && !/^\(\d{1,2}\)$/.test(c)) break;
    label.push(c);
  }
  return label.join(" ").trim();
}

/* ---------- the document context ---------- */

const ITEM_RE = /^(?:PART\s+[IV]+\s*[-.,]?\s*)?ITEM\s+(\d{1,2}[A-C]?)\b/i;

function periodPhrase(period) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period || "");
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

const DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/g;

/* A page break splits a paragraph: "...of at least 150%. As defined in
   the 1940 Act, a 150% asset" continues on the next page after the page
   number and "Table of Contents". The two halves are joined when the
   first does not end a sentence and the second starts as a
   continuation (a lower-case word, a closing bracket, a comma). */
const PAGE_FURNITURE = /^(?:\d{1,3}|[ivx]+|F-\d+|S-\d+|Table of Contents|\(Unaudited\)|\(continued\)|\(Continued\)|[A-Z][A-Za-z.,&' -]{2,80}(?:\(Continued\))?|Notes to (?:the )?(?:Condensed |Unaudited )?Consolidated Financial Statements(?: \(Continued\)| \(Unaudited\))*|\((?:dollars |amounts |dollar amounts )?in (?:thousands|millions)[^)]*\))$/;
function joinPages(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (cur.includes("|") || /[.:;!?"')\]]$/.test(cur) || cur.length < 40) { out.push(cur); continue; }
    let j = i + 1, skipped = 0;
    while (j < lines.length && skipped < 6 && PAGE_FURNITURE.test(lines[j]) && lines[j].length < 90) { j++; skipped++; }
    if (j < lines.length && j > i + 1 && !lines[j].includes("|") && /^(?:[a-z(,;]|[0-9]{1,3}(?:\.\d+)?\s?%)/.test(lines[j])) {
      lines[j] = cur + " " + lines[j];
      for (let k = i + 1; k < j; k++) out.push(lines[k]);
      i = j - 1;
      continue;
    }
    out.push(cur);
  }
  return out;
}

function buildContext(doc, { ticker, period } = {}) {
  const text0 = htmlToText(doc);
  const lines = joinPages(text0.split("\n"));
  const text = lines.join("\n");
  const starts = new Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) { starts[i] = pos; pos += lines[i].length + 1; }
  /* the Item heading above each line, the table of contents excluded
     by taking the last heading seen: the body's heading always comes
     after the contents' entry for it */
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM_RE.exec(lines[i]);
    if (!m || lines[i].length > 160) continue;
    /* a contents row ends in its page number */
    if (lines[i].includes("|") && /\|\s*\d{1,3}\s*$/.test(lines[i])) continue;
    items.push({ line: i, item: "Item " + m[1].toUpperCase() });
  }
  const phrase = periodPhrase(period);
  return { text, lines, starts, items, ticker: ticker || null, period: period || null, phrase,
           scale: documentScale(lines), cover: text.slice(0, 4000) };
}

/* "(in thousands, except share and per share data)" on the statement
   headers: the document's default scale, used where a table states none */
function documentScale(lines) {
  let th = 0, mi = 0;
  for (const l of lines) {
    if (l.length > 240) continue;
    if (/\(\s*(?:dollars? |amounts? |dollar amounts? )?in thousands\b/i.test(l)) th++;
    else if (/\(\s*(?:dollars? |amounts? |dollar amounts? )?in millions\b/i.test(l)) mi++;
  }
  if (!th && !mi) return null;
  return th >= mi ? "thousands" : "millions";
}

/* the body of a 10-Q opens with Part I, Item 1 (the statements and their
   notes), so a line before the first heading found is in Item 1 */
function itemAt(ctx, line) {
  let cur = "Item 1";
  for (const it of ctx.items) { if (it.line <= line) cur = it.item; else break; }
  return cur;
}

function lineOf(ctx, pos) {
  let lo = 0, hi = ctx.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.starts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo;
}

const whereOf = (ctx, line, pos) => ({ line: line + 1, pos, section: itemAt(ctx, line) });

/* ---------- sentences ---------- */

const ABBREV = /(?:\b(?:U\.S|U\.K|Inc|No|Nos|Mr|Mrs|Ms|Dr|Corp|Co|Ltd|L\.P|LP|L\.L\.C|St|vs|etc|approx|e\.g|i\.e|Jr|Sr|Sec|Mfg|Bros|Assoc)|\b[A-Z])\.$/;

/* the sentence of a line that contains character offset `at` (an offset
   into the line); decimals, "U.S." and "Inc." do not end a sentence */
export function sentenceOf(line, at) {
  const bounds = [0];
  const re = /[.!?]["')\]]?\s+(?=[A-Z("$•])/g;
  let m;
  while ((m = re.exec(line))) {
    const before = line.slice(Math.max(0, m.index - 12), m.index + 1);
    if (ABBREV.test(before)) continue;
    bounds.push(m.index + m[0].length);
  }
  bounds.push(line.length);
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (at >= bounds[i] && at < bounds[i + 1]) {
      return { text: line.slice(bounds[i], bounds[i + 1]).trim(), start: bounds[i] };
    }
  }
  return { text: line.trim(), start: 0 };
}

/* a sentence longer than this is cut to the words around the figure,
   on word boundaries, with an ellipsis at each cut end */
const MAX_SENTENCE = 700;
function clip(sentence, around) {
  if (sentence.length <= MAX_SENTENCE) return sentence;
  let a = Math.max(0, around - MAX_SENTENCE / 2);
  let b = Math.min(sentence.length, a + MAX_SENTENCE);
  if (a > 0) { const sp = sentence.indexOf(" ", a); if (sp !== -1 && sp < around) a = sp + 1; }
  if (b < sentence.length) { const sp = sentence.lastIndexOf(" ", b); if (sp > around) b = sp; }
  return (a > 0 ? "... " : "") + sentence.slice(a, b) + (b < sentence.length ? " ..." : "");
}

function figure(ctx, v, line, offsetInLine, extra) {
  const s = sentenceOf(ctx.lines[line], offsetInLine);
  const pos = ctx.starts[line] + s.start;
  return { v, sentence: clip(s.text, offsetInLine - s.start), where: whereOf(ctx, line, pos), ...(extra || {}) };
}

/* Every match of `re` over the document, as { line, index, m, sentence } */
function* matches(ctx, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i];
    g.lastIndex = 0;
    let m;
    while ((m = g.exec(line))) {
      const sent = sentenceOf(line, m.index);
      yield { line: i, index: m.index, m, sentence: sent.text, at: m.index - sent.start };
      if (m[0].length === 0) g.lastIndex++;
    }
  }
}

/* A sentence that names the period's date answers first; one that names
   no date at all second; a sentence dated to another period never. A
   10-Q states "As of June 30, 2026 and December 31, 2025, ... 178.0 %
   and 177.1 %, respectively", and the comparative lives in the same
   sentence, so the first figure of a period-dated sentence is the
   period's. */
function pickDated(ctx, cands) {
  if (!cands.length) return null;
  if (ctx.phrase) {
    const dated = cands.find((c) => c.sentence.includes(ctx.phrase));
    if (dated) return dated;
  }
  const undated = cands.find((c) => !DATE_RE.test(c.sentence) || (DATE_RE.lastIndex = 0, false));
  DATE_RE.lastIndex = 0;
  return undated || null;
}

/* ---------- table rows ---------- */

/* Which numeric column holds the period: the nearest header above the
   row that carries two dates says whether the period's date is first
   or second. No dated header within reach: the first column. */
function periodColumn(ctx, line) {
  if (!ctx.phrase) return 0;
  for (let i = line - 1; i >= Math.max(0, line - 14); i--) {
    const l = ctx.lines[i];
    if (!l.includes(ctx.phrase)) continue;
    const dates = l.match(DATE_RE) || [];
    if (dates.length >= 2) return dates.indexOf(ctx.phrase) <= 0 ? 0 : 1;
    return 0;
  }
  return 0;
}

/* The first row whose label matches, with the period's figure. `unit`
   restricts the figures ("%" for a rate row); `above` requires a line
   within four above the row to match (a group header such as
   "Weighted average yield of debt and other income producing
   securities:" over rows labeled only "Funded during the period"). */
/* A header whose cells name segments rather than periods (Main Street's
   "LMM (a) | Private Loan" over "Number of portfolio companies | 94 |
   86"): the nearest line above with two or more text cells, none of
   which carries a date, a year, "ended", "as of" or a percentage. */
function segmentColumns(ctx, line) {
  for (let i = line - 1; i >= Math.max(0, line - 10); i--) {
    const cells = cellsOf(ctx.lines[i]);
    if (cells.length < 2 || cells.some((c) => parseNumber(c) && !/^\(\d{1,2}\)$/.test(c))) continue;
    if (cells.every((c) => /^\(?[a-z]\)?$|^\(\d{1,2}\)$/i.test(c))) continue;
    const header = cells.join(" ");
    if (/\b(?:19|20)\d{2}\b|ended|as of|%|month|quarter|year|period|actual|budget/i.test(header)) return false;
    if (MONTHS.some((m) => header.includes(m))) return false;
    return true;
  }
  return false;
}

/* A joint venture's table is not the filer's: "Below is a summary of
   SCP's portfolio" (TSLX), "of SLF's portfolio" (FRBP), the Senior
   Direct Lending Program (ARCC). The nearest prose line above the row
   says whose portfolio the table summarizes. */
const JV_WORDS = /\b(?:joint venture|JV|SLF|SCP|SLP|SDLP|SSLP|JVs|Senior Loan (?:Fund|Program)|Credit Partners|Lending Program|Loan Fund|Loan Program|the Program|Investment Fund|Investment Partners)\b/;
function jvContext(ctx, line) {
  for (let i = line - 1; i >= Math.max(0, line - 14); i--) {
    const l = ctx.lines[i];
    if (l.includes("|") || l.length < 24) continue;
    if (/^\(\d{1,2}\)|^_{4,}/.test(l)) continue;
    if (/\b(?:our|the Company's|the Fund's|the Corporation's) (?:investment |total )?portfolio\b/i.test(l)) return false;
    /* "a summary of Capstone Lending's portfolio": whose? The cover page
       names the filer, so a possessor absent from it is someone else */
    const m = /\b((?:[A-Z][\w&.-]*\s?){1,4})'s (?:investment )?portfolio\b/.exec(l);
    if (m && !/^(?:Company|Fund|Corporation|Corp\.|Inc\.)$/.test(m[1].trim()) && !ctx.cover.includes(m[1].trim())) return true;
    return JV_WORDS.test(l) && /summary of|composition of|below is|following table|the portfolio of/i.test(l);
  }
  return false;
}

function rowFigure(ctx, labelRe, { unit = null, above = null, from = 0, skipLabel = null, periodsOnly = false } = {}) {
  for (let i = from; i < ctx.lines.length; i++) {
    const line = ctx.lines[i];
    if (!line.includes("|")) continue;
    const label = rowLabel(line);
    if (!label || !labelRe.test(label)) continue;
    if (skipLabel && skipLabel.test(label)) continue;
    if (JV_WORDS.test(label) && /\bin\b|\bof\b/.test(label)) continue;
    if (jvContext(ctx, i)) continue;
    if (above && !ctx.lines.slice(Math.max(0, i - 4), i).some((l) => above.test(l))) continue;
    if (periodsOnly && segmentColumns(ctx, i)) continue;
    let nums = rowNumbers(line);
    if (unit) nums = nums.filter((n) => n.unit === unit);
    if (!nums.length) continue;
    const col = Math.min(periodColumn(ctx, i), nums.length - 1);
    const n = nums[col];
    return { v: n.v, sentence: clip(line, 0), where: whereOf(ctx, i, ctx.starts[i]), label, line: i };
  }
  return null;
}

/* ---------- the fields ---------- */

const PCT = String.raw`(\d{1,3}(?:\.\d+)?)\s?%`;
/* a span inside one sentence: any character but a full stop, except the
   point of a decimal ("$ 65.2 million" sits inside the sentence) */
const S = String.raw`(?:[^.]|\.(?=\d)|(?<=\bi)\.(?=e\.)|(?<=\bi\.e)\.|(?<=\be)\.(?=g\.)|(?<=\be\.g)\.|(?<=\bU)\.(?=S\.)|(?<=\bU\.S)\.|(?<=\bInc|\bCorp|\bLtd|\bNo|\bvs)\.)`;

/** Asset coverage, as a ratio (178% -> 1.78; "1.78x" -> 1.78) with the
    percentage beside it, and whether the paragraph states SBA exemptive
    relief (the ratio then excludes the SBA debentures). */
function assetCoverage(ctx) {
  const re = new RegExp(String.raw`asset coverage(?: ratio)?(?:,? (?:as|calculated)[^,.;]{0,80},)?(?: applicable to senior securities)? (?:was|were|is|of|equal(?:ed|led)? to|totaled|totalled|amounted to|stood at)\s+(?:approximately\s+|about\s+)?(\d{1,3}(?:\.\d+)?)\s?(%|x|X|times|percent|to 1|:1)`, "i");
  /* "our asset coverage ratio under our regulatory requirements as a BDC
     was 212.2% excluding our SBA debentures" (HTGC) */
  const loose = new RegExp(String.raw`asset coverage(?: ratio)?${S}{0,70}? (?:was|were|is|equal(?:ed|led)? to|totaled|totalled|amounted to|stood at)\s+(?:approximately\s+|about\s+)?(\d{1,3}(?:\.\d+)?)\s?(%|x|X|times|percent|to 1|:1)`, "i");
  const cands = [];
  for (const h of [...matches(ctx, re), ...matches(ctx, loose)]) {
    const raw = Number(h.m[1]);
    const unit = h.m[2].toLowerCase();
    let pct = unit === "%" || unit === "percent" ? raw : raw * 100;
    /* a coverage under 20 stated with a percent sign is a ratio typed
       wrong; over 20 with an x is a percentage typed wrong */
    if (pct < 20) pct = raw * 100;
    if (pct > 2000) pct = raw;
    if (pct < 100 || pct > 2000) continue;
    cands.push({ pct, line: h.line, index: h.index, sentence: h.sentence });
  }
  const c = pickDated(ctx, cands);
  if (!c) return null;
  const para = ctx.lines[c.line];
  const sbaRelief = /exemptive relief/i.test(para) && /\bSBA\b|\bSBIC|Small Business Administration/i.test(para);
  return figure(ctx, Math.round(c.pct) / 100, c.line, c.index, { pct: c.pct, sbaRelief });
}

/** The statutory minimum the filer is held to: 150% after the 2018
    election under §61(a)(2), 200% for a filer that never made it. */
function statutoryCoverage(ctx) {
  /* the election: "reduced from 200% to 150%", "decrease to 150% from
     200%", "approved a reduction ... from 200% to 150%" */
  const elected = [
    new RegExp(String.raw`(?:reduc|decreas|lower|modif|chang)${S}{0,120}?from 200(?:\.0)?\s?% to (150)(?:\.0)?\s?%`, "i"),
    new RegExp(String.raw`(?:reduc|decreas|lower)${S}{0,80}?to (150)(?:\.0)?\s?% from 200(?:\.0)?\s?%`, "i"),
    new RegExp(String.raw`(?:approv|elect|adopt)${S}{0,160}?asset coverage${S}{0,120}?(?:of|to) (150)\s?%`, "i"),
    new RegExp(String.raw`(?:approv|elect|adopt)${S}{0,200}?(150)\s?% (?:minimum )?asset coverage`, "i"),
  ];
  for (const r of elected) for (const h of matches(ctx, r)) return figure(ctx, Number(h.m[1]), h.line, h.index);
  /* the floor as stated for the filer itself, in the present tense; a
     sentence about what BDCs are "generally" able to do, or about what
     the filer was allowed "prior to" its election, is not it */
  const floor = [
    new RegExp(String.raw`(?:we|the company|the fund|[A-Z][\w.]* (?:is|are)|it is|we are)${S}{0,40}?(?:is |are )?(?:only )?(?:allowed|permitted|able)${S}{0,160}?asset coverage${S}{0,200}?(?:is|are|must (?:be|equal)|equals?|of) at least (150|200)\s?%`, "i"),
    new RegExp(String.raw`asset coverage${S}{0,120}?(?:must (?:be|equal)|is required to be|is|of) at least (150|200)(?:\.0)?\s?%`, "i"),
    /* "we are required to meet a coverage ratio of total assets (...) to
       total borrowings and other senior securities (...) of at least
       150%" (KBDC) */
    new RegExp(String.raw`(?:we|the company) (?:are|is) required to (?:meet|maintain)${S}{0,320}?coverage ratio${S}{0,320}?(?:of )?at least (150|200)(?:\.0)?\s?%`, "i"),
  ];
  for (const r of floor) {
    for (const h of matches(ctx, r)) {
      if (/^prior to|\bwas at least\b|\bgenerally\b|business development companies are|BDCs are/i.test(h.sentence)) continue;
      return figure(ctx, Number(h.m[1]), h.line, h.index);
    }
  }
  return null;
}

/** Exemptive relief from the SEC to exclude SBA-guaranteed debentures
    from the coverage test: true on the sentence that says it was
    received, false on a sentence that says it was not, null otherwise. */
function sbaExempt(ctx) {
  const has = new RegExp(String.raw`(?:received|obtained|granted|been granted|holds?|has|have|had|pursuant to|under|reliance on|relying on|in accordance with)${S}{0,120}?exemptive (?:relief|order)${S}{0,260}?(?:\bSBA\b|\bSBIC|Small Business Administration|SBA-guaranteed)`, "i");
  const has2 = new RegExp(String.raw`(?:\bSBA\b|\bSBIC|Small Business Administration)${S}{0,200}?(?:received|obtained|granted|pursuant to|under|reliance on|relying on)${S}{0,80}?exemptive (?:relief|order)`, "i");
  const not = new RegExp(String.raw`\b(?:not|no|never|neither|has not|have not)\b${S}{0,60}?(?:received|obtained|applied for|sought|granted)${S}{0,80}?exemptive (?:relief|order)${S}{0,200}?(?:\bSBA\b|\bSBIC|Small Business Administration)`, "i");
  for (const h of matches(ctx, not)) return figure(ctx, false, h.line, h.index);
  for (const r of [has, has2]) {
    for (const h of matches(ctx, r)) {
      if (new RegExp(String.raw`\b(?:if|unless|should|would|could|may|might) (?:we|the company)\b${S}{0,40}?(?:receive|obtain|apply)`, "i").test(h.sentence)) continue;
      return figure(ctx, true, h.line, h.index);
    }
  }
  return null;
}

/* Yield rows and sentences. The label of the figure the schedule reader
   is compared with comes first: the yield on debt and income-producing
   investments at amortized cost, as of period end. */
const YIELD_COST_ROWS = [
  /weighted[- ]average (?:total )?yield[^|]*?(?:performing|accruing|income[- ]producing|debt)[^|]*?(?:at )?(?:amortized )?cost/i,
  /weighted[- ]average (?:total )?yield[^|]*?(?:at )?amortized cost/i,
  /weighted[- ]average (?:total )?yield (?:on|of) (?:the |our |total )?(?:debt )?(?:investment )?portfolio(?! at fair value)/i,
  /weighted[- ]average (?:total )?(?:effective )?yield[^|]*?(?:debt|income[- ]producing)[^|]*?(?:investments|securities|portfolio)(?! at fair value)/i,
];
const YIELD_FV_ROWS = [
  /weighted[- ]average (?:total )?yield[^|]*?(?:performing|accruing|income[- ]producing|debt)[^|]*?(?:at )?fair value/i,
  /weighted[- ]average (?:total )?yield[^|]*?(?:at )?fair value/i,
];
const YIELD_COST_SENTENCE = new RegExp(String.raw`weighted[- ]average (?:total |annual |annualized |effective )?yield${S}{0,120}?(?:debt|income[- ]producing|accruing|performing)${S}{0,100}?(?:at )?(?:amortized )?cost\b${S}{0,60}?(?:was|were|of|is)\s+(?:approximately\s+)?${PCT}`, "i");
const YIELD_FV_SENTENCE = new RegExp(String.raw`weighted[- ]average (?:total |annual |annualized |effective )?yield${S}{0,120}?(?:debt|income[- ]producing|accruing|performing)${S}{0,100}?(?:at )?fair value${S}{0,60}?(?:was|were|of|is)\s+(?:approximately\s+)?${PCT}`, "i");
const YIELD_COST_SENTENCE_2 = new RegExp(String.raw`weighted[- ]average (?:total |annual |annualized |effective )?yield${S}{0,200}?(?:was|were|of|is)\s+(?:approximately\s+)?${PCT}${S}{0,80}?(?:at )?(?:amortized )?cost\b(?! of)`, "i");
const YIELD_FV_SENTENCE_2 = new RegExp(String.raw`weighted[- ]average (?:total |annual |annualized |effective )?yield${S}{0,200}?(?:was|were|of|is)\s+(?:approximately\s+)?${PCT}${S}{0,80}?(?:at )?fair value`, "i");

function yieldField(ctx, rows, sentences) {
  for (const re of rows) {
    const r = rowFigure(ctx, re, { unit: "%" });
    if (r && r.v > 0 && r.v < 40) {
      const note = footnoteBelow(ctx, r.line);
      const intro = introAbove(ctx, r.line);
      return { v: r.v, sentence: r.sentence, where: r.where, label: r.label, ...(note ? { note } : {}), ...(intro ? { intro } : {}) };
    }
  }
  for (const re of sentences) {
    const c = pickDated(ctx, [...matches(ctx, re)].map((h) => ({ ...h, v: Number(h.m[1]) })));
    if (c && c.v > 0 && c.v < 40) return figure(ctx, c.v, c.line, c.index, { label: "sentence" });
  }
  return null;
}

/* "(1) Includes non-interest earning investments." within the six lines
   under a row whose label ends in a footnote marker */
function footnoteBelow(ctx, line) {
  const label = rowLabel(ctx.lines[line]);
  const marks = label.match(/\((\d{1,2}|[a-z])\)/g);
  if (!marks) return null;
  const notes = [];
  for (const mark of marks) {
    for (let i = line + 1; i < Math.min(ctx.lines.length, line + 24); i++) {
      if (ctx.lines[i].startsWith(mark + " ") || ctx.lines[i].startsWith(mark)) {
        notes.push(clip(ctx.lines[i].slice(mark.length).trim(), 0));
        break;
      }
    }
  }
  return notes.length ? notes.join(" ") : null;
}

/* the sentence that introduces a table: the nearest prose line above
   the row ("The average size and weighted average yield of our portfolio
   at amortized cost for the three and six months ended ... were as
   follows:", ARCC) */
function introAbove(ctx, line) {
  for (let i = line - 1; i >= Math.max(0, line - 10); i--) {
    const l = ctx.lines[i];
    if (l.includes("|") || l.length < 40) continue;
    return clip(l, 0);
  }
  return null;
}

/* The whole yield table where a filer gives one: every row that carries
   a percentage under a header that names amortized cost and fair value
   (ARCC: "Debt and other income producing securities(1) | 10.3 % | 10.5
   % ...", "Total portfolio(2) | 9.3 % | 9.4 % ..."). */
function yieldTable(ctx) {
  const out = [];
  for (let i = 0; i < ctx.lines.length; i++) {
    const l = ctx.lines[i];
    if (!/amortized cost/i.test(l) || !/fair value/i.test(l) || !l.includes("|") || l.length > 240) continue;
    const cells = cellsOf(l).map((c) => c.toLowerCase());
    const ci = cells.findIndex((c) => /amortized cost|^cost$/.test(c));
    const fi = cells.findIndex((c) => /fair value/.test(c));
    if (ci === -1 || fi === -1) continue;
    const intro = ctx.lines.slice(Math.max(0, i - 6), i).join(" ");
    if (!/weighted[- ]average yield/i.test(intro)) continue;
    const costFirst = ci < fi;
    for (let j = i + 1; j < Math.min(ctx.lines.length, i + 16); j++) {
      const row = ctx.lines[j];
      if (!row.includes("|")) { if (/^_{5,}|^\(\d\)/.test(row)) break; continue; }
      const nums = rowNumbers(row).filter((n) => n.unit === "%");
      const label = rowLabel(row);
      if (nums.length < 2 || !label) continue;
      const col = periodColumn(ctx, j) * 2;
      const a = nums[col], b = nums[col + 1];
      if (!a || !b) continue;
      out.push({ label, cost: costFirst ? a.v : b.v, fv: costFirst ? b.v : a.v,
                 sentence: clip(row, 0), where: whereOf(ctx, j, ctx.starts[j]) });
    }
    if (out.length) break;
  }
  return out;
}

function ltv(ctx) {
  const r = rowFigure(ctx, /loan[- ]to[- ]value|\bLTV\b/i, { unit: "%" });
  if (r && r.v > 0 && r.v < 100) return { v: r.v, sentence: r.sentence, where: r.where };
  const re = new RegExp(String.raw`(?:weighted[- ]average |average )?loan[- ]to[- ]value(?: ratio)?(?: \(LTV\))?${S}{0,80}?(?:was|were|of|is|at)\s+(?:approximately\s+)?${PCT}`, "i");
  const c = pickDated(ctx, [...matches(ctx, re)].map((h) => ({ ...h, v: Number(h.m[1]) })));
  return c ? figure(ctx, c.v, c.line, c.index) : null;
}

/* The floating share and what it is a share of: "of performing debt
   investments" at fair value (BXSL) is not "of the investments at fair
   value in our portfolio" (ARCC, which counts the equity) nor "of our
   Investment Portfolio debt investments (at cost)" (MAIN). */
function basisOf(sentence) {
  const s = sentence.toLowerCase();
  const of = /debt investments|loans|debt portfolio|debt securities/.test(s) ? "debt" : "total";
  const at = /amortized cost|\(at cost\)|at cost/.test(s) ? "cost" : /fair value/.test(s) ? "fv" : null;
  return { of, at };
}

function floatingShare(ctx) {
  const r = rowFigure(ctx, /(?:percentage|%|share|portion) of[^|]*?(?:floating|variable)[- ]rate/i,
    { unit: "%", skipLabel: /\bnew\b|commitment|origination|funded/i });
  if (r) return { v: r.v, sentence: r.sentence, where: r.where, basis: { ...basisOf(r.label), row: true } };
  const res = [
    new RegExp(String.raw`${PCT}(?: and ${PCT}, respectively,)? of (?:our |the )?(?:[A-Za-z-]+ ){0,4}?(?:investments|portfolio|loans)${S}{0,90}?(?:bore|bear|bearing|were|are|was|carried|paid|pay)(?: interest)?(?: and dividends)? at (?:a |the )?(?:floating|variable)(?: interest)? rates?`, "i"),
    new RegExp(String.raw`(?:floating|variable)[- ]rate${S}{0,80}?(?:represented|comprised|constituted|accounted for|was|were)\s+(?:approximately\s+)?${PCT}`, "i"),
    new RegExp(String.raw`(?:approximately\s+)?${PCT} of (?:our |the )?(?:performing |total |accruing )?(?:debt )?(?:investments|portfolio|loans)${S}{0,60}?(?:were|are|was|bore interest|bear interest)(?: at)? (?:floating|variable)`, "i"),
  ];
  const cands = [];
  for (const re of res) for (const h of matches(ctx, re)) cands.push({ ...h, v: Number(h.m[1]) });
  const c = pickDated(ctx, cands);
  return c ? figure(ctx, c.v, c.line, c.index, { basis: { ...basisOf(c.sentence), row: false } }) : null;
}

function portfolioCompanies(ctx) {
  const r = rowFigure(ctx, /^(?:total )?number of (?:portfolio companies|companies in (?:the |our )?portfolio)/i, { periodsOnly: true });
  if (r && Number.isInteger(r.v) && r.v > 0 && r.v < 5000) return { v: r.v, sentence: r.sentence, where: r.where };
  /* "a fair value ... of approximately $2,289.8 million in 112
     portfolio companies" (NMFC, 10-Q 0001496099-26-000029): the count
     after a dollar amount is the same statement */
  const re = /(?:investments? in|invested in|across|comprised of|consisted of(?: investments in)?|portfolio of|loans to|totaling|held(?: investments)? in|\$\s?\d[\d,.]*\s?(?:million|billion) in)\s+(\d{1,3}(?:,\d{3})?|\d{1,4})\s+(?!new\b|different\b|separate\b|distinct\b)(?:different |distinct |separate |unique )?(?:portfolio companies|companies|borrowers|issuers|obligors)\b/i;
  const cands = [];
  for (const h of matches(ctx, re)) {
    const v = Number(h.m[1].replace(/,/g, ""));
    if (!/portfolio companies|borrowers|obligors|issuers/i.test(h.m[0]) && !/portfolio/i.test(h.sentence)) continue;
    if (/\bnew\b|\bexited\b|\badded\b/i.test(h.m[0])) continue;
    /* a segment's count is not the portfolio's: "Middle Market portfolio
       investments in 11 portfolio companies" (Main Street) */
    if (/\bLMM\b|middle market|private loan|other portfolio|lower middle|venture|first lien|second lien|equity|controlled|affiliated|joint venture|\bJV\b/i.test(h.sentence.slice(0, h.index))) continue;
    if (JV_WORDS.test(h.sentence)) continue;
    /* the filer's own portfolio, as of period end: not a joint
       venture's ("PSSL II had ... investments in 52 portfolio companies",
       PFLT) and not a quarter's activity ("we invested approximately
       $202.4 million across 28 portfolio companies", SLRC) */
    if (!/\b(?:we|our|us|the company|the fund|the corporation)\b/i.test(h.sentence)) continue;
    if (/during the (?:three|six|nine|twelve) months|during the (?:quarter|period|year|fiscal)|(?:invested|deployed|originated|funded|committed)\b|new investments? in|for the (?:three|six|nine) months/i.test(h.sentence.slice(0, h.index + h.m[0].length))) continue;
    if (v > 0 && v < 5000) cands.push({ ...h, v });
  }
  const c = pickDated(ctx, cands);
  return c ? figure(ctx, c.v, c.line, c.index) : null;
}

/* Non-accrual at cost and at fair value from one sentence. The sentence
   is read as a sequence of percentages and basis words, and each
   percentage takes the basis that follows it — the next basis word
   when the figure stands alone ("2.4 % ... at amortized cost (or 1.4 %
   at fair value)"), the matching position of a run of basis words when
   the figures run together ("1.1 % and 4.0 % ... at fair value and
   cost, respectively"). */
function pairBases(sentence) {
  const tokens = [];
  const re = /(\d{1,3}(?:\.\d+)?)\s?%|(amortized cost|\bcost\b)|(fair value)/gi;
  let m;
  while ((m = re.exec(sentence))) {
    if (m[1]) tokens.push({ t: "n", v: Number(m[1]), i: m.index });
    else tokens.push({ t: "b", b: m[2] ? "cost" : "fv", i: m.index });
  }
  const out = [];
  let pending = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.t === "n") { pending.push(tok); continue; }
    if (!pending.length) continue;
    /* a run of basis words after a run of figures pairs by position */
    const run = [tok];
    while (tokens[k + 1] && tokens[k + 1].t === "b") run.push(tokens[++k]);
    if (pending.length > 1 && run.length >= pending.length) {
      pending.forEach((p, j) => out.push({ v: p.v, basis: run[j].b }));
    } else if (pending.length === 1) {
      out.push({ v: pending[0].v, basis: run[0].b });
    } else {
      pending.forEach((p) => out.push({ v: p.v, basis: run[0].b }));
    }
    pending = [];
  }
  /* figures the sentence states after naming the bases ("at cost and
     fair value ... were 1.5% and 0.9%, respectively") */
  if (pending.length) {
    const bases = tokens.filter((t) => t.t === "b" && t.i < pending[0].i).map((t) => t.b);
    if (bases.length >= pending.length) {
      const tail = bases.slice(bases.length - pending.length);
      pending.forEach((p, j) => out.push({ v: p.v, basis: tail[j] }));
    }
  }
  return out;
}

/* "there were no investments placed on non-accrual status" (LIEN, 10-Q
   0001193125-26-347342) is a stated zero on both bases — a measurement,
   not an absence — and comes back as 0% so the reader can count the
   filer rather than leave the figure unknown. It is the last resort,
   after every percentage sentence, and only for the filer's own
   portfolio at the period: ARCC's 10-Q says "As of December 31, 2025,
   none of the loans in the SDLP portfolio were on non-accrual status"
   two paragraphs from its own "2.4% of the total investments at
   amortized cost", and the vehicle's December sentence must never
   stand for the filer's June figure. */
const NONE_NA_RE = /(?:there (?:were|are) no|(?:we |the company |the fund )?(?:had|have|has) no|no|none of (?:our|the)) (?:investments?|loans?|debt investments?|portfolio companies|portfolio investments?)\b[^.;]{0,80}?(?:on|placed on) non-?accrual/i;
function statedNone(ctx) {
  const cands = [];
  for (const h of matches(ctx, NONE_NA_RE)) {
    if (/\d{1,3}(?:\.\d+)?\s?%/.test(h.sentence)) continue;
    if (JV_WORDS.test(h.sentence)) continue;
    /* the filer's own book, not a vehicle's, a segment's or a peer's */
    if (/\b(?:portfolio|investments?|loans?) (?:of|held by|in) (?:the |our )?[A-Z]/.test(h.sentence) && !/\b(?:we|our|us|the company|the fund)\b/i.test(h.sentence)) continue;
    /* dated at the period, or undated; another date is another figure */
    const dated = DATE_RE.test(h.sentence);
    DATE_RE.lastIndex = 0;
    if (dated && !(ctx.phrase && h.sentence.includes(ctx.phrase))) continue;
    cands.push(h);
  }
  const c = pickDated(ctx, cands);
  return c ? { cost: figure(ctx, 0, c.line, c.index, { of: "total", stated: "none" }), fv: figure(ctx, 0, c.line, c.index, { of: "total", stated: "none" }) } : null;
}

function nonAccrual(ctx) {
  const res = { cost: null, fv: null };
  const rc = rowFigure(ctx, /non-?accrual[^|]*?(?:at )?(?:amortized )?cost/i, { unit: "%" });
  const rf = rowFigure(ctx, /non-?accrual[^|]*?(?:at )?fair value/i, { unit: "%" });
  if (rc) res.cost = { v: rc.v, sentence: rc.sentence, where: rc.where, of: /debt|loans/i.test(rc.label) ? "debt" : "total" };
  if (rf) res.fv = { v: rf.v, sentence: rf.sentence, where: rf.where, of: /debt|loans/i.test(rf.label) ? "debt" : "total" };
  if (res.cost && res.fv) return res;
  const re = new RegExp(String.raw`non-?accrual(?: status)?${S}{0,200}?\d{1,3}(?:\.\d+)?\s?%`, "i");
  const cands = [];
  for (const h of matches(ctx, re)) {
    if (!/\d{1,3}(?:\.\d+)?\s?%/.test(h.sentence)) continue;
    const pairs = pairBases(h.sentence);
    const cost = pairs.find((p) => p.basis === "cost");
    const fv = pairs.find((p) => p.basis === "fv");
    if (!cost && !fv) continue;
    cands.push({ ...h, cost, fv, pairs });
  }
  const c = pickDated(ctx, cands);
  if (!c) return (!res.cost && !res.fv && statedNone(ctx)) || res;
  const tail = c.sentence.slice(c.sentence.search(/\d{1,3}(?:\.\d+)?\s?%/)).slice(0, 110);
  const of = /debt|\bloan/i.test(tail) ? "debt" : "total";
  if (!res.cost && c.cost) res.cost = figure(ctx, c.cost.v, c.line, c.index, { of });
  if (!res.fv && c.fv) res.fv = figure(ctx, c.fv.v, c.line, c.index, { of });
  return res;
}

/* ---------- the Item 3 table ---------- */

const SHOCK_ROW = /^(?:(up|down|increase|decrease|plus|minus|\+|-)\s*)?\(?\s*(\d{2,3})\s*\)?\s*(?:bps|bp|basis points?)?(?:\s*(increase|decrease))?$/i;

function shockOf(label) {
  const m = SHOCK_ROW.exec(label.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const bps = Number(m[2]);
  if (![25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500].includes(bps)) return null;
  const word = (m[1] || m[3] || "").toLowerCase();
  let sign = 1;
  if (/^(down|decrease|minus|-)$/.test(word)) sign = -1;
  else if (!word && /^\(/.test(label.trim())) sign = -1;
  else if (!word && /\)$/.test(label.trim())) sign = -1;
  return { bps: sign * bps, label: label.trim() };
}

/* the shock a row states in its first cell: "Up 100 basis points",
   "+100 bps", or under a "Basis Point Change" header a bare "(100)" or
   "100" (Main Street) */
function shockOfRow(line) {
  const first = cellsOf(line)[0];
  return first ? shockOf(first) : null;
}

/* the header cells above the first shock row, classified by column */
function classifyColumns(headerLines) {
  const cols = [];
  for (const l of headerLines) {
    for (const c of cellsOf(l)) {
      const s = c.toLowerCase().replace(/\s+/g, " ");
      if (/basis point|change in interest rates|^change$|rate change|interest rate change/.test(s) && !/income|expense/.test(s)) continue;
      if (/per share/.test(s)) cols.push("perShare");
      else if (/external|manager|other/.test(s) && /net/.test(s)) cols.push("other");
      else if (/interest expense|borrowing|expense/.test(s)) cols.push("interestExpense");
      else if (/net (?:investment )?income|net increase|net change|net assets|net impact|^net$|net interest/.test(s)) cols.push("net");
      else if (/interest (?:and dividend )?income|investment income|income/.test(s)) cols.push("interestIncome");
    }
  }
  return cols;
}

function scaleNear(ctx, line) {
  for (let i = line; i >= Math.max(0, line - 40); i--) {
    const l = ctx.lines[i];
    if (/in thousands/i.test(l)) return "thousands";
    if (/in millions/i.test(l)) return "millions";
  }
  return ctx.scale;
}

const scaled = (v, scale) => v === null ? null : scale === "thousands" ? v * 1000 : scale === "millions" ? v * 1000000 : v;

function rateSensitivity(ctx) {
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i];
    if (!line.includes("|")) continue;
    const shock = shockOfRow(line);
    if (!shock) continue;
    /* the table: consecutive shock rows from here */
    const rows = [];
    let j = i;
    for (; j < ctx.lines.length; j++) {
      const l = ctx.lines[j];
      if (!l.includes("|")) { if (rows.length && /^\(\d\)|^_{4,}|^[A-Z]/.test(l)) break; continue; }
      const sh = shockOfRow(l);
      if (!sh) { if (rows.length >= 2) break; continue; }
      const nums = rowNumbers(cellsOf(l).slice(1).join(" | "), { markers: false }).map((n) => (n.dash ? 0 : n.v));
      if (!nums.length) continue;
      rows.push({ shock: sh, nums, line: j });
    }
    if (rows.length < 2) { i = j; continue; }
    /* the header: the lines above the first row back to the intro
       sentence, plus that sentence for the scale and provenance */
    const headerLines = [];
    let intro = null;
    for (let k = i - 1; k >= Math.max(0, i - 14); k--) {
      const l = ctx.lines[k];
      if (l.includes("|")) headerLines.unshift(l);
      else if (/basis point|interest rate|base rate|hypothetical/i.test(l) && l.length > 60) { intro = k; break; }
      else if (l.length > 160) break;
    }
    const cols = classifyColumns(headerLines);
    const scale = scaleNear(ctx, i);
    const out = rows.map((r) => {
      const f = { interestIncome: null, interestExpense: null, net: null, perShare: null };
      if (cols.length && cols.length === r.nums.length) {
        cols.forEach((c, k) => { if (c in f) f[c] = r.nums[k]; });
      } else if (cols.length && cols.length > r.nums.length && cols.filter((c) => c in f).length === r.nums.length) {
        cols.filter((c) => c in f).forEach((c, k) => { f[c] = r.nums[k]; });
      } else if (r.nums.length === 3) {
        [f.interestIncome, f.interestExpense, f.net] = r.nums;
      } else if (r.nums.length === 1) {
        f.net = r.nums[0];
      } else {
        f.net = r.nums[r.nums.length - 1];
      }
      return {
        shock: (r.shock.bps > 0 ? "+" : "-") + Math.abs(r.shock.bps) + " bps",
        bps: r.shock.bps,
        interestIncome: scaled(f.interestIncome, scale),
        interestExpense: scaled(f.interestExpense, scale),
        net: scaled(f.net, scale),
        ...(f.perShare !== null ? { perShare: f.perShare } : {}),
        scale: scale || "unknown",
        columns: cols.length ? cols : null,
        sentence: clip(ctx.lines[r.line], 0),
        where: whereOf(ctx, r.line, ctx.starts[r.line]),
      };
    });
    if (intro !== null) out.intro = { sentence: clip(ctx.lines[intro], 0), where: whereOf(ctx, intro, ctx.starts[intro]) };
    return out;
  }
  return null;
}

/* ---------- dividends ---------- */

function dividendSplit(ctx) {
  const regular = rowFigure(ctx, /^(?:total )?(?:regular|base) (?:monthly |quarterly |cash )?(?:dividends?|distributions?)(?: declared| paid)? per (?:common )?share/i);
  const supplemental = rowFigure(ctx, /^(?:total )?supplemental (?:monthly |quarterly |cash )?(?:dividends?|distributions?)(?: declared| paid)? per (?:common )?share/i);
  const special = rowFigure(ctx, /^(?:total )?special (?:cash )?(?:dividends?|distributions?)(?: declared| paid)? per (?:common )?share/i);
  const total = rowFigure(ctx, /^total (?:dividends?|distributions?)(?: declared| paid)? per (?:common )?share/i);
  if (regular || supplemental || special) {
    const first = regular || supplemental || special;
    return {
      regular: regular ? regular.v : null,
      supplemental: supplemental ? supplemental.v : null,
      special: special ? special.v : null,
      total: total ? total.v : null,
      sentence: [regular, supplemental, special].filter(Boolean).map((r) => r.sentence).join(" || "),
      where: first.where,
    };
  }
  /* sentence forms, only where the sentence dates the dividend to the
     period: "declared a supplemental dividend of $0.30 per share" in a
     subsequent-events note is next quarter's */
  const re = new RegExp(String.raw`(regular|base|supplemental|special)${S}{0,60}?(?:dividend|distribution)s?${S}{0,80}?\$\s?(\d{1,2}\.\d{2,4})\s?per (?:common )?share`, "i");
  const cands = [...matches(ctx, re)].filter((h) => ctx.phrase && h.sentence.includes(ctx.phrase));
  if (!cands.length) return null;
  const out = { regular: null, supplemental: null, special: null, total: null, sentence: null, where: null };
  for (const h of cands) {
    const kind = h.m[1].toLowerCase() === "base" ? "regular" : h.m[1].toLowerCase();
    if (out[kind] === null) { out[kind] = Number(h.m[2]); out.sentence = (out.sentence ? out.sentence + " || " : "") + h.sentence; if (!out.where) out.where = whereOf(ctx, h.line, ctx.starts[h.line]); }
  }
  return out;
}

/* ---------- leverage target ---------- */

function targetLeverage(ctx) {
  const X = String.raw`(\d(?:\.\d{1,2})?)\s?(?:x|X|times|:1|to 1)?`;
  const res = [
    new RegExp(String.raw`(?:target|targeted|targeting|goal|aim)${S}{0,100}?(?:leverage|debt[- ]to[- ]equity|debt to equity|regulatory leverage)${S}{0,80}?(?:of |at |between |from |range of |ranging from |approximately )?${X}\s?(?:x|times)?\s?(?:to|-|and|through)\s?${X}\s?(?:x|times)`, "i"),
    new RegExp(String.raw`(?:leverage|debt[- ]to[- ]equity)${S}{0,60}?(?:target|targeted)${S}{0,80}?(?:of |at |between |from |range of |ranging from )?${X}\s?(?:x|times)?\s?(?:to|-|and|through)\s?${X}\s?(?:x|times)`, "i"),
    new RegExp(String.raw`(?:target|targeted|targeting)${S}{0,100}?(?:leverage|debt[- ]to[- ]equity)${S}{0,80}?(?:of |at |approximately )?${X}\s?(?:x|times)(?!${S}{0,10}?(?:to|-|and)\s?\d)`, "i"),
    new RegExp(String.raw`(?:leverage|debt[- ]to[- ]equity)(?: ratio)?${S}{0,60}?\btarget(?:ed)? (?:of|at|is|was)\s+${X}\s?(?:x|times)`, "i"),
  ];
  for (const re of res) {
    for (const h of matches(ctx, re)) {
      const low = Number(h.m[1]);
      const high = h.m[2] !== undefined ? Number(h.m[2]) : low;
      if (!(low > 0 && low < 4 && high >= low && high < 4)) continue;
      if (/asset coverage|150\s?%|200\s?%/.test(h.sentence) && !/debt[- ]to[- ]equity|leverage ratio/i.test(h.sentence)) continue;
      return figure(ctx, { low, high }, h.line, h.index, { low, high });
    }
  }
  return null;
}

/* ---------- fees ---------- */

const FEE_SENTENCE = new RegExp(String.raw`base management fee|management fee${S}{0,120}?(?:annual rate|per annum|annualized rate|quarterly rate|rate of)|incentive fee${S}{0,160}?\d{1,3}(?:\.\d+)?\s?%|hurdle|catch-?up|internally[- ]managed|externally[- ]managed`, "i");

function feeSentences(ctx) {
  const out = [];
  const seen = new Set();
  for (const h of matches(ctx, FEE_SENTENCE)) {
    const s = h.sentence;
    if (s.length < 40 || s.length > 900 || !/\d/.test(s) && !/managed/i.test(s)) continue;
    const key = s.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sentence: clip(s, 0), where: whereOf(ctx, h.line, ctx.starts[h.line] + h.index) });
    if (out.length >= 16) break;
  }
  return out;
}

/* A fee sentence the filer states as the recipient, not the payer:
   "The Company receives a base management fee of 0.10% per annum" is
   Saratoga's CLO fee income. An expense cap is not a fee either. */
const NOT_A_FEE_PAID = /\b(?:we|the company|the fund|the corporation|[A-Z][\w.]+) (?:receives?|earns?|earned|received|is paid|are paid|collects?)\b|expense (?:limitation|support|cap)|cap the|fee (?:waiver|income)|fee revenue|management fee income/i;

/* A term stated twice, before and after a listing: "(i) prior to the
   Exchange Listing, 10% ... (ii) after the Exchange Listing, 17.5%"
   (Blue Owl Technology Finance). The figure after the listing is the
   one in force. */
const LISTING_LATER = /\b(?:after|following|subsequent to|from and after|upon(?: the completion of)?|commencing (?:on|with)) (?:the )?(?:date of the )?(?:consummation of the |completion of the )?(?:Exchange |Initial )?(?:Listing|IPO|initial public offering|listing)/i;

function firstFigure(ctx, res, ok) {
  for (const re of res) {
    for (const h of matches(ctx, re)) {
      if (NOT_A_FEE_PAID.test(h.sentence)) continue;
      let v = Number(h.m[1]);
      let index = h.index;
      /* the figure sits inside a "prior to the Listing" clause; a figure
         stated before that clause (the hurdle the clause then refers to)
         is the term as it stands */
      const prior = /\bprior to (?:the )?(?:Exchange |Initial )?(?:Listing|IPO|initial public offering)/i.exec(h.sentence);
      if (prior && h.at >= prior.index) {
        const later = LISTING_LATER.exec(h.sentence);
        if (later) {
          const tail = h.sentence.slice(later.index);
          const g = new RegExp(re.source, re.flags.replace("g", ""));
          const m2 = g.exec(tail);
          const pct = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(tail);
          if (m2 && ok(Number(m2[1]))) v = Number(m2[1]);
          else if (pct && ok(Number(pct[1]))) v = Number(pct[1]);
          else continue;
        } else {
          /* a sentence that states only the pre-listing term; the term
             in force is in another sentence */
          continue;
        }
      }
      if (ok(v, h)) return figure(ctx, v, h.line, index);
    }
  }
  return null;
}

function fees(ctx) {
  const mgmt = firstFigure(ctx, [
    new RegExp(String.raw`(?:base )?management fee${S}{0,120}?(?:annual rate|rate per annum|annualized rate|per annum|annual basis)${S}{0,30}?(?:of|equal to|at)?\s+${PCT}`, "i"),
    new RegExp(String.raw`annual (?:base )?management fee(?: rate)? (?:is|of|was|equals?|equal to)\s+${PCT}`, "i"),
    new RegExp(String.raw`(?:base )?management fee rate (?:is|of|was|equals?|equal to)\s+${PCT}`, "i"),
    new RegExp(String.raw`(?:base )?management fee${S}{0,120}?(?:is|of|equal to|at|calculated at)\s+(?:an annual rate of\s+)?${PCT}${S}{0,20}?(?:per annum|annually|per year|of (?:the |our )?(?:average )?(?:value of )?(?:the |our )?(?:company's )?(?:"?gross assets|total assets|net assets|investments))`, "i"),
    new RegExp(String.raw`${PCT}(?: per annum| annual| annualized)? (?:base )?management fee`, "i"),
  ], (v) => v > 0 && v <= 3);
  const income = firstFigure(ctx, [
    new RegExp(String.raw`income[- ](?:based |related )?incentive fee(?: rate)? (?:of|equal to|at|is)\s+${PCT}`, "i"),
    new RegExp(String.raw`(?:income[- ]based fee|incentive fee)${S}{0,200}?${PCT} (?:of|on) (?:the |our |such |all |any |total |amount of |aggregate |remaining |the company's |the fund's )*pre-incentive fee net investment income`, "i"),
    new RegExp(String.raw`${PCT} (?:of|on) (?:the |our |such |all |any |total |amount of |aggregate |remaining |the company's |the fund's )*pre-incentive fee net investment income`, "i"),
    new RegExp(String.raw`(?:income|subordinated) incentive fee${S}{0,40}?(?:of|equal to|at|is|equals)\s+${PCT}`, "i"),
  ], (v) => v >= 5 && v <= 30);
  const hurdle = firstFigure(ctx, [
    new RegExp(String.raw`hurdle(?: rate)?"?(?: of return)?(?: equal to| of)?\s+${PCT}\s?(?:per quarter|quarterly|per calendar quarter)`, "i"),
    new RegExp(String.raw`hurdle(?: rate)?"?(?: of return)?(?: equal to| of)?\s+${PCT}(?:\s?per quarter|\s?quarterly)?`, "i"),
    new RegExp(String.raw`${PCT}\s?(?:quarterly |per quarter )?"?hurdle`, "i"),
    new RegExp(String.raw`(?:preferred return|hurdle)(?: rate| amount)?,?"?(?: of return)?${S}{0,30}?(?:of|equal to|is|at)\s+${PCT}`, "i"),
  ], (v, h) => v > 0 && v <= 12 && !/(?:maximum|minimum|up to|no more than|not less than)\s+(?:annual\s+)?(?:hurdle|preferred)/i.test(h.sentence) &&
    /* "less than or equal to 1.8182%" is the catch-up ceiling, not the hurdle */
    !new RegExp(String.raw`(?:less than|greater than|more than)(?: or equal to)?\s+${String(v).replace(".", "\.")}\s?%`, "i").test(h.sentence));
  const catchUp = firstFigure(ctx, [
    new RegExp(String.raw`${PCT}\s?(?:"?catch-?up)`, "i"),
    new RegExp(String.raw`catch-?up${S}{0,80}?${PCT}`, "i"),
    new RegExp(String.raw`${PCT} of (?:the |our )?(?:company's |our )?pre-incentive fee net investment income${S}{0,160}?(?:exceeds|in excess of|above) the (?:hurdle|preferred return)`, "i"),
  ], (v) => v >= 50 && v <= 100);
  /* a second rate above a leverage line: "from 1.5 % to 1.0 % on all
     assets financed using leverage over 1.0 x debt to equity" (ARCC) */
  let tier = null;
  for (const h of matches(ctx, new RegExp(String.raw`management fee${S}{0,160}?${PCT}${S}{0,60}?(?:over|above|in excess of|exceeding|greater than)\s+(\d(?:\.\d{1,2})?)\s?(?:x|times|:1|to 1)?\s?(?:debt[- ]to[- ]equity|leverage)`, "i"))) {
    /* the rate is the last percentage before the leverage line: "from
       1.5 % to 1.0 % on all assets ... over 1.0 x" */
    const pcts = h.m[0].match(/\d{1,3}(?:\.\d+)?(?=\s?%)/g);
    tier = figure(ctx, Number(pcts[pcts.length - 1]), h.line, h.index, { above: Number(h.m[2]) });
    break;
  }
  const gains = firstFigure(ctx, [
    new RegExp(String.raw`capital gains[- ]based incentive fee (?:of|equal to|at|is)\s+${PCT}`, "i"),
    new RegExp(String.raw`(?:capital gains? incentive fee|incentive fee on capital gains|second (?:part|component)${S}{0,80}?capital gains)${S}{0,220}?(?:equal to|of|at)\s+${PCT}`, "i"),
    new RegExp(String.raw`${PCT} of (?:the |our )?(?:company's |our )?(?:cumulative |aggregate |net )?(?:realized )?(?:net )?(?:realized )?capital gains`, "i"),
  ], (v) => v >= 5 && v <= 30);
  /* the annualized hurdle beside the quarterly one: "1.5 % per quarter
     ( 6.0 % annualized)" */
  let hurdleAnnual = null;
  if (hurdle) {
    /* the annualized figure beside the quarterly one: "1.5% per quarter
       (6.0% annualized)"; another annualized figure in the same sentence
       (the catch-up ceiling) is not it, so the hurdle is four quarters */
    const beside = new RegExp(String.raw`${String(hurdle.v).replace(".", "\.")}\s?%${S}{0,40}?\(?(\d{1,2}(?:\.\d+)?)\s?%\s?(?:annualized|annually|per annum|on an annualized basis)`, "i").exec(hurdle.sentence);
    if (beside && Number(beside[1]) !== hurdle.v) hurdleAnnual = Number(beside[1]);
    else if (hurdle.v <= 4) hurdleAnnual = Math.round(hurdle.v * 400) / 100;
    /* a hurdle over 4% is the annual rate; the quarterly rate is a
       quarter of it (BCP Investment: "7%"; FS KKR: "7.0% annualized") */
    if (hurdle.v > 4) { hurdleAnnual = hurdle.v; hurdle.v = Math.round(hurdle.v * 25) / 100; hurdle.derived = "annual rate / 4"; }
  }
  return { managementFeeRate: mgmt, managementFeeTier: tier, incentiveIncomeRate: income, hurdle, hurdleAnnual, catchUp, capitalGainsRate: gains };
}

function internallyManaged(ctx) {
  const yes = /\b(?:is|are|was|were|as|be|being|remain(?:s)?|operates? as)\s+(?:an?\s+)?internally[- ]managed\b/i;
  const no = /\b(?:is|are|was|were|as|be|being|remain(?:s)?|operates? as)\s+(?:an?\s+)?externally[- ]managed\b/i;
  for (const h of matches(ctx, yes)) {
    if (/unlike|as opposed to|compared to|other|such as|rather than/i.test(h.sentence.slice(0, h.index))) continue;
    if (/\buntil\b|formerly|previously|prior to|no longer|ceased|converted/i.test(h.sentence)) continue;
    return figure(ctx, true, h.line, h.index);
  }
  for (const h of matches(ctx, no)) return figure(ctx, false, h.line, h.index);
  return null;
}

/* ---------- adjusted income measures and yields on activity ---------- */

function adjustedNii(ctx, kindRe, name) {
  const row = rowFigure(ctx, new RegExp(String.raw`^${kindRe.source}[^|]*?per (?:common )?share`, "i"));
  if (row && row.v > -5 && row.v < 20) return { v: row.v, sentence: row.sentence, where: row.where, label: name };
  const re = new RegExp(String.raw`${kindRe.source}${S}{0,220}?\$\s?(\d{1,2}\.\d{2})\s?per (?:common )?share`, "i");
  const cands = [...matches(ctx, re)].map((h) => ({ ...h, v: Number(h.m[1]) }))
    .filter((h) => !ctx.phrase || h.sentence.includes(ctx.phrase) || !DATE_RE.test(h.sentence) || (DATE_RE.lastIndex = 0, false));
  DATE_RE.lastIndex = 0;
  const c = pickDated(ctx, cands);
  return c ? figure(ctx, c.v, c.line, c.index, { label: name }) : null;
}

function activityYield(ctx, which) {
  const rows = which === "new"
    ? [[/weighted[- ]average yield (?:of|on) new (?:debt )?investments|new (?:debt )?investments?[^|]*?weighted[- ]average yield|yield (?:on|of) new/i, null],
       [/^(?:funded|originated|purchased|new investments?)[^|]*?(?:during the period|during the quarter)?[^|]*?(?:at )?(?:amortized )?cost/i, /weighted[- ]average yield/i]]
    : [[/weighted[- ]average yield (?:of|on) (?:investments )?(?:fully )?(?:sold|exited|repaid|paid down|realized)|(?:sold|exited|repaid|paid down)[^|]*?weighted[- ]average yield/i, null],
       [/^(?:exited|sold|repaid|exits)[^|]*?(?:during the period|during the quarter)?[^|]*?(?:at )?(?:amortized )?cost/i, /weighted[- ]average yield/i]];
  for (const [labelRe, above] of rows) {
    const r = rowFigure(ctx, labelRe, { unit: "%", above });
    if (r && r.v > 0 && r.v < 40) return { v: r.v, sentence: r.sentence, where: r.where, label: r.label };
  }
  const re = which === "new"
    ? new RegExp(String.raw`weighted[- ]average yield (?:of|on) (?:the |our )?new (?:debt )?investments?${S}{0,120}?(?:was|were|of)\s+${PCT}`, "i")
    : new RegExp(String.raw`weighted[- ]average yield (?:of|on) (?:the |our )?(?:debt |income producing )?(?:and other income producing securities )?(?:investments? )?(?:fully )?(?:sold|exited|repaid|paid down|realized)${S}{0,120}?(?:was|were|of)\s+${PCT}`, "i");
  const cands = [...matches(ctx, re)].map((h) => ({ ...h, v: Number(h.m[1]) }))
    .filter((h) => !/^From [A-Z][a-z]+ \d{1,2}, \d{4} through/i.test(h.sentence));
  const c = pickDated(ctx, cands);
  return c ? figure(ctx, c.v, c.line, c.index, { label: "sentence" }) : null;
}

/* ---------- entry point ---------- */

/**
 * extractProse(doc, { ticker, period }) — every field is { v, sentence,
 * where, ... } or null. `doc` is the main document's HTML or the text
 * htmlToText makes of it; `period` is the fiscal period end
 * ("2026-06-30"), which decides which of two comparative figures is the
 * period's and which dated sentences are skipped.
 */
export function extractProse(doc, opts = {}) {
  const ctx = buildContext(doc, opts);
  const na = nonAccrual(ctx);
  const internal = internallyManaged(ctx);
  /* an internally managed BDC pays no adviser: the fee sentences its
     document carries describe fees it earns (Main Street as MSC
     Income's adviser) or fees it does not pay, and no rate is served */
  const feeRates = internal && internal.v === true
    ? { managementFeeRate: null, managementFeeTier: null, incentiveIncomeRate: null, hurdle: null,
        hurdleAnnual: null, catchUp: null, capitalGainsRate: null, note: "internally managed: no adviser fee" }
    : fees(ctx);
  const yields = yieldTable(ctx);
  return {
    ticker: ctx.ticker,
    period: ctx.period,
    scale: ctx.scale,
    assetCoveragePct: assetCoverage(ctx),
    statutoryCoverage: statutoryCoverage(ctx),
    sbaExempt: sbaExempt(ctx),
    waYieldAtCost: yieldField(ctx, YIELD_COST_ROWS, [YIELD_COST_SENTENCE, YIELD_COST_SENTENCE_2]),
    waYieldAtFv: yieldField(ctx, YIELD_FV_ROWS, [YIELD_FV_SENTENCE, YIELD_FV_SENTENCE_2]),
    waYields: yields,
    ltv: ltv(ctx),
    floatingShare: floatingShare(ctx),
    portfolioCompanies: portfolioCompanies(ctx),
    nonAccrualCostPct: na.cost,
    nonAccrualFvPct: na.fv,
    rateSensitivity: rateSensitivity(ctx),
    dividendSplit: dividendSplit(ctx),
    targetLeverage: targetLeverage(ctx),
    fees: feeRates,
    feeSentences: feeSentences(ctx),
    internallyManaged: internal,
    distributableNii: adjustedNii(ctx, /distributable (?:net investment income|NII|earnings)/, "distributable net investment income"),
    coreNiiPerShare: adjustedNii(ctx, /(?:core|adjusted) (?:net investment income|NII|EPS|earnings)/, "core or adjusted net investment income"),
    yieldOnNew: activityYield(ctx, "new"),
    yieldOnExits: activityYield(ctx, "exits"),
  };
}

export const _internal = { buildContext, pairBases, shockOf, classifyColumns, sentenceOf, periodPhrase };
