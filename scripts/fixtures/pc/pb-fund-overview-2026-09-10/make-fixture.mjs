/**
 * make-fixture.mjs — cuts the test workbook from the real export.
 *
 *   node scripts/fixtures/pc/pb-fund-overview-2026-09-10/make-fixture.mjs [path/to/export.xlsx]
 *
 * The real Fund Overview export (368 KB, 20 sheets) is licensed and lives
 * only in the local data-sources/ folder. The test needs a workbook the
 * production reader opens end to end, so this keeps four sheets and
 * rebuilds a real zip from them with the ingest's own writer:
 *
 *   sheet1   Fundraising Activity            "$1.35Tn" cells, a year series
 *   sheet4   Fundraising by Category (#)     "$303.55B" cells, year x category
 *   sheet9   Average & Median Time To Close  a tab name truncated to 31
 *                                            characters with a trailing
 *                                            space, headers with newlines
 *   sheet16  Sources of Capital              a snapshot table, Tn and B
 *
 * Kept as they are: docProps/core.xml (the export stamp), _rels/.rels.
 * Trimmed to the kept parts: [Content_Types].xml, xl/workbook.xml,
 * xl/_rels/workbook.xml.rels. Rebuilt: xl/sharedStrings.xml holds only
 * the strings the four sheets reference, re-indexed, and the value of
 * "Created for:" is replaced by a placeholder, so the licensee's name is
 * in no fixture byte. Dropped: styles, themes, drawings and the logo
 * image, the sheets' ignoredErrors blocks (11 KB of sheet4 alone). The
 * cut is deterministic: two runs give the same bytes.
 *
 * Every check (the four sheets read identically to the source, the
 * export stamp agrees, the licensee's value is in no byte, the size
 * budget) runs on the buffer, and the file is written only when all of
 * them pass: a re-export whose "Created for:" value sat in another cell
 * would leave nothing on disk, not a fixture carrying the name.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip, writeZip } from "../../../lib/zip-read.mjs";
import { readWorkbook } from "../../../lib/xlsx-read.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../../..");
const DEFAULT_SOURCE = join(ROOT, "data-sources/pitchbook/2026-09-10/PitchBook_Fund_Overview_PitchBook_View_All_Charts_2026_09_10_05_03_44.xlsx");
const source = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SOURCE;
const OUT = join(here, "fund-overview-cut_2026_09_10_05_03_44.xlsx");
const KEEP = ["sheet1", "sheet4", "sheet9", "sheet16"];
const PLACEHOLDER = "licensee name removed from the fixture";

if (!existsSync(source)) {
  console.error("source workbook not found: " + source);
  process.exit(2);
}
const zip = readZip(readFileSync(source));
const text = (name) => { const t = zip.text(name); if (t === null) throw new Error("missing member " + name); return t; };

/* ---- workbook.xml and its rels, trimmed to the kept sheets ---- */
const wbRels = text("xl/_rels/workbook.xml.rels");
const relTargets = {};
for (const m of wbRels.matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*\/>/g)) relTargets[m[1]] = m[2];
const keptRids = new Set(Object.keys(relTargets).filter((id) => KEEP.some((s) => relTargets[id] === "worksheets/" + s + ".xml")));
const wbXml = text("xl/workbook.xml").replace(/<sheet\s[^>]*\/>/g, (tag) => {
  const rid = (/r:id="([^"]+)"/.exec(tag) || [])[1];
  return keptRids.has(rid) ? tag : "";
});
const wbRelsXml = wbRels.replace(/<Relationship\s[^>]*\/>/g, (tag) => {
  const id = (/Id="([^"]+)"/.exec(tag) || [])[1];
  const target = relTargets[id];
  return keptRids.has(id) || target === "sharedStrings.xml" ? tag : "";
});

/* ---- the sheets: drawings and ignoredErrors dropped, strings re-indexed ---- */
const sstXml = text("xl/sharedStrings.xml");
const siFragments = [];
for (const m of sstXml.matchAll(/<si>[\s\S]*?<\/si>/g)) siFragments.push(m[0]);
const oldToNew = new Map();
const newFragments = [];
const remap = (idx) => {
  if (!oldToNew.has(idx)) { oldToNew.set(idx, newFragments.length); newFragments.push(siFragments[idx]); }
  return oldToNew.get(idx);
};
/* the licensee's value sits to the right of the "Created for:" label; find
   the label's index once and replace whatever cell follows it */
const createdForIdx = siFragments.findIndex((f) => /<t[^>]*>Created for:<\/t>/.test(f));
let placeholderIdx = -1;
const remapPlaceholder = () => {
  if (placeholderIdx < 0) { placeholderIdx = newFragments.length; newFragments.push("<si><t>" + PLACEHOLDER + "</t></si>"); }
  return placeholderIdx;
};
const sheets = {};
for (const s of KEEP) {
  let xml = text("xl/worksheets/" + s + ".xml");
  xml = xml.replace(/<drawing\s[^>]*\/>/g, "").replace(/<legacyDrawing\s[^>]*\/>/g, "").replace(/<ignoredErrors>[\s\S]*?<\/ignoredErrors>/g, "");
  /* cells in row order; the cell after "Created for:" on its row is the value */
  xml = xml.replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, (row) => {
    let sawCreatedFor = false;
    return row.replace(/(<c\s[^>]*t="s"[^>]*><v>)(\d+)(<\/v><\/c>)/g, (whole, open, idx, close) => {
      const i = Number(idx);
      if (sawCreatedFor) { sawCreatedFor = false; return open + remapPlaceholder() + close; }
      if (i === createdForIdx) sawCreatedFor = true;
      return open + remap(i) + close;
    });
  });
  sheets[s] = xml;
}
const newSst = sstXml.slice(0, sstXml.indexOf("<si>"))
  .replace(/count="\d+"/, 'count="' + newFragments.length + '"')
  .replace(/uniqueCount="\d+"/, 'uniqueCount="' + newFragments.length + '"')
  + newFragments.join("") + "</sst>";

/* ---- content types, trimmed ---- */
const keptParts = new Set(["/docProps/core.xml", "/xl/workbook.xml", "/xl/sharedStrings.xml", ...KEEP.map((s) => "/xl/worksheets/" + s + ".xml")]);
const ctXml = text("[Content_Types].xml")
  .replace(/<Override\s[^>]*\/>/g, (tag) => (keptParts.has((/PartName="([^"]+)"/.exec(tag) || [])[1]) ? tag : ""))
  .replace(/<Default\s[^>]*Extension="png"[^>]*\/>/g, "");
const pkgRels = text("_rels/.rels").replace(/<Relationship\s[^>]*docProps\/app\.xml[^>]*\/>/g, "");

const members = [
  { name: "[Content_Types].xml", data: ctXml },
  { name: "_rels/.rels", data: pkgRels },
  { name: "docProps/core.xml", data: text("docProps/core.xml") },
  { name: "xl/workbook.xml", data: wbXml },
  { name: "xl/_rels/workbook.xml.rels", data: wbRelsXml },
  { name: "xl/sharedStrings.xml", data: newSst },
  ...KEEP.map((s) => ({ name: "xl/worksheets/" + s + ".xml", data: sheets[s] })),
];
const out = writeZip(members);

/* ---- prove the cut on the buffer; nothing reaches disk until every check passes ---- */
const real = readWorkbook(readFileSync(source));
/* the raw H4 value, read from the source's own row 4 and shared strings,
   never typed here */
const licensee = (() => {
  const row4 = /<row r="4"[^>]*>[\s\S]*?<\/row>/.exec(text("xl/worksheets/sheet1.xml"));
  const cells = [...row4[0].matchAll(/<c\s[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)].map((m) => Number(m[1]));
  const valueIdx = cells[cells.indexOf(createdForIdx) + 1];
  return (/<t[^>]*>([^<]*)<\/t>/.exec(siFragments[valueIdx] || "") || [])[1] || null;
})();
const cut = readWorkbook(out);
const problems = [];
if (cut.sheets.length !== KEEP.length) problems.push("expected " + KEEP.length + " sheets, read " + cut.sheets.length);
if (cut.created !== real.created) problems.push("core.xml created differs");
for (const s of cut.sheets) {
  const r = real.sheets.find((x) => x.file === s.file);
  if (!r || JSON.stringify(r.rows) !== JSON.stringify(s.rows) || JSON.stringify(r.frame) !== JSON.stringify(s.frame)) problems.push(s.name + " differs from the source");
}
if (!licensee) problems.push("the licensee's value beside \"Created for:\" could not be located in the source's row 4, so its absence from the cut cannot be proved");
if (licensee && out.includes(Buffer.from(licensee, "utf8"))) problems.push("the licensee's name survived in the fixture bytes");
if (out.length > 80 * 1024) problems.push("fixture is " + out.length + " bytes, over the 80 KB budget");
for (const m of members) console.log("  " + String(Buffer.byteLength(m.data)).padStart(6) + "  " + m.name);
if (problems.length) {
  for (const p of problems) console.error("PROBLEM: " + p);
  console.error("nothing written: " + basename(OUT) + " keeps its previous bytes" + (existsSync(OUT) ? "" : " (none on disk)"));
  process.exit(1);
}
writeFileSync(OUT, out);
console.log("wrote " + basename(OUT) + ": " + out.length + " bytes, " + members.length + " members, " + newFragments.length + " shared strings (" + siFragments.length + " in the source)");
console.log("the cut reads identically to the source on every kept sheet; the licensee's name is absent");
