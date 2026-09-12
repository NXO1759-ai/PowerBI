/**
 * ooxml.mjs — the Office XML helpers the pptx and xlsx readers share.
 *
 * parseXml turns a member into a small tree — { tag, prefix, attrs,
 * children, text } — with no DOM and no regular expression over the
 * document: a single left-to-right scan, so a 40 KB chart cache and a
 * 200 KB shared-string table cost the same per byte. Tags are matched by
 * local name (c:ser, cdr:sp, a:t) because the prefix is whatever the
 * writer chose; where the prefix matters, as it does to tell a chart's
 * live c:ser from the c15:ser copies PowerPoint keeps of filtered series,
 * it is on the node.
 *
 * The scratch parser that read the deck first (parse-deck.js) matched
 * blocks with regular expressions; it worked, but took the first
 * <c:title> in a chart as the chart title (chart10 to chart12 have only
 * an axis title) and could not tell nesting apart. A tree can.
 */

/* ---------- entities ---------- */
const NAMED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function decodeXml(s) {
  if (s.indexOf("&") === -1 && s.indexOf("_x") === -1) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf("&", i);
    if (amp === -1) { out += s.slice(i); break; }
    out += s.slice(i, amp);
    const semi = s.indexOf(";", amp);
    if (semi === -1 || semi - amp > 10) { out += "&"; i = amp + 1; continue; }
    const ent = s.slice(amp + 1, semi);
    if (NAMED[ent] !== undefined) out += NAMED[ent];
    else if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      out += Number.isFinite(code) ? String.fromCodePoint(code) : "&" + ent + ";";
    } else out += "&" + ent + ";";
    i = semi + 1;
  }
  /* Excel writes control characters as _x000D_ (a carriage return); the
     cell text never wants them. */
  return out.indexOf("_x") === -1 ? out : out.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => {
    const code = parseInt(h, 16);
    return code < 32 ? "" : String.fromCodePoint(code);
  });
}

/* ---------- the tree ---------- */
function node(qname, attrs) {
  const colon = qname.indexOf(":");
  return {
    tag: colon === -1 ? qname : qname.slice(colon + 1),
    prefix: colon === -1 ? "" : qname.slice(0, colon),
    attrs,
    children: [],
    text: "",
  };
}

const isSpace = (c) => c === " " || c === "\n" || c === "\r" || c === "\t";

/**
 * parseXml(text) → the root element. A well-formed Office member has one
 * root; the XML declaration, comments and a doctype are skipped.
 */
export function parseXml(text) {
  const root = node("#document", {});
  const stack = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) { stack[stack.length - 1].text += decodeXml(text.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decodeXml(text.slice(i, lt));
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end === -1) throw new Error("xml: unterminated processing instruction");
      i = end + 2; continue;
    }
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) throw new Error("xml: unterminated comment");
      i = end + 3; continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end === -1) throw new Error("xml: unterminated CDATA");
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3; continue;
    }
    if (text.startsWith("<!", lt)) {
      const end = text.indexOf(">", lt + 2);
      if (end === -1) throw new Error("xml: unterminated declaration");
      i = end + 1; continue;
    }
    if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt + 2);
      if (end === -1) throw new Error("xml: unterminated closing tag");
      const qname = text.slice(lt + 2, end).trim();
      const top = stack[stack.length - 1];
      const topName = top.prefix ? top.prefix + ":" + top.tag : top.tag;
      if (topName !== qname) throw new Error("xml: closing </" + qname + "> does not match <" + topName + ">");
      stack.pop();
      i = end + 1; continue;
    }
    /* an opening or self-closing tag: name, then attributes */
    let j = lt + 1;
    while (j < n && !isSpace(text[j]) && text[j] !== ">" && text[j] !== "/") j++;
    const qname = text.slice(lt + 1, j);
    const attrs = {};
    let selfClose = false;
    for (;;) {
      while (j < n && isSpace(text[j])) j++;
      if (j >= n) throw new Error("xml: unterminated tag <" + qname);
      if (text[j] === ">") { j++; break; }
      if (text[j] === "/") { selfClose = true; j++; continue; }
      let k = j;
      while (k < n && !isSpace(text[k]) && text[k] !== "=" && text[k] !== ">" && text[k] !== "/") k++;
      const aname = text.slice(j, k);
      while (k < n && isSpace(text[k])) k++;
      if (text[k] !== "=") { attrs[aname] = ""; j = k; continue; }
      k++;
      while (k < n && isSpace(text[k])) k++;
      const q = text[k];
      if (q !== '"' && q !== "'") throw new Error("xml: unquoted attribute " + aname + " on <" + qname);
      const close = text.indexOf(q, k + 1);
      if (close === -1) throw new Error("xml: unterminated attribute " + aname + " on <" + qname);
      attrs[aname] = decodeXml(text.slice(k + 1, close));
      j = close + 1;
    }
    const el = node(qname, attrs);
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
    i = j;
  }
  if (stack.length !== 1) throw new Error("xml: <" + stack[stack.length - 1].tag + "> is never closed");
  return root.children.find((c) => c.tag) || null;
}

/* ---------- walking ---------- */
const matches = (el, tag) => {
  if (tag.indexOf(":") === -1) return el.tag === tag;
  const colon = tag.indexOf(":");
  return el.prefix === tag.slice(0, colon) && el.tag === tag.slice(colon + 1);
};

/** the first descendant (depth first, document order) with the tag, or null */
export function find(el, tag) {
  if (!el) return null;
  for (const c of el.children) {
    if (matches(c, tag)) return c;
    const deep = find(c, tag);
    if (deep) return deep;
  }
  return null;
}

/** every descendant with the tag, document order */
export function findAll(el, tag, out = []) {
  if (!el) return out;
  for (const c of el.children) {
    if (matches(c, tag)) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}

/** the direct children with the tag */
export function children(el, tag) {
  return el ? el.children.filter((c) => matches(c, tag)) : [];
}

/** an attribute by exact name, else by local name (r:id answers to id) */
export function attr(el, name) {
  if (!el) return null;
  if (el.attrs[name] !== undefined) return el.attrs[name];
  for (const k of Object.keys(el.attrs)) {
    const colon = k.indexOf(":");
    if (colon !== -1 && k.slice(colon + 1) === name) return el.attrs[k];
  }
  return null;
}

/** the text of the element and every descendant, in document order */
export function textOf(el) {
  if (!el) return "";
  let s = el.text;
  for (const c of el.children) s += textOf(c);
  return s;
}

/**
 * paragraphs(el) → one string per <a:p>, the <a:t> runs joined. Chart
 * drawings split "Source: PitchBook" across three runs; the role tests
 * need the joined line.
 */
export function paragraphs(el) {
  return findAll(el, "p").filter((p) => p.prefix === "a").map((p) => findAll(p, "t").map(textOf).join(""));
}

/* ---------- package parts ---------- */
/** a .rels member → { rId: { target, type } }, targets left as written */
export function readRels(zip, name) {
  const xml = zip.text(name);
  if (xml === null) return {};
  const out = {};
  for (const r of findAll(parseXml(xml), "Relationship")) {
    out[attr(r, "Id")] = { target: attr(r, "Target"), type: (attr(r, "Type") || "").split("/").pop() };
  }
  return out;
}

/** "../charts/chart1.xml" against "ppt/slides/slide4.xml" → "ppt/charts/chart1.xml" */
export function resolveTarget(fromMember, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromMember.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** xl/sharedStrings.xml → string[]; an <si> may hold one <t> or run <r><t> pairs */
export function readSharedStrings(zip) {
  const xml = zip.text("xl/sharedStrings.xml");
  if (xml === null) return [];
  return children(parseXml(xml), "si").map((si) => findAll(si, "t").map(textOf).join(""));
}

/** docProps/core.xml → { created, modified, title } (ISO strings as written, null when absent) */
export function readCoreProps(zip) {
  const xml = zip.text("docProps/core.xml");
  if (xml === null) return { created: null, modified: null, title: null };
  const root = parseXml(xml);
  const one = (tag) => { const el = find(root, tag); return el ? textOf(el).trim() || null : null; };
  return { created: one("created"), modified: one("modified"), title: one("title") };
}
