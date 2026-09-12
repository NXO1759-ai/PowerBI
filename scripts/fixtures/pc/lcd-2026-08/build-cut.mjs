/**
 * build-cut.mjs — cuts the August 2026 LCD monitor down to the fixture
 * scripts/test-pc-deck.mjs reads.
 *
 *   node scripts/fixtures/pc/lcd-2026-08/build-cut.mjs [path-to-deck]
 *
 * The cut is a real pptx zip, rebuilt with scripts/lib/zip-read.mjs's
 * writer, holding six slides by presentation position — the cover, the
 * slides of chart1, chart11, chart27 and chart30, and the first EMF deal
 * table — with their relationship parts, chart parts, chart drawings and
 * the EMF picture; ppt/presentation.xml keeps only those six sldIds, the
 * presentation rels only those six slides, [Content_Types].xml only the
 * parts that are present. Nothing inside a slide or chart part is edited.
 * docProps/core.xml keeps its dates and title; the two personal-name
 * elements are blanked, since the reader never uses them.
 *
 * Slide positions in the cut: 1 cover, 2 = deck slide 4 (chart1),
 * 3 = slide 15 (chart11), 4 = slide 33 (chart27), 5 = slide 37 (chart30),
 * 6 = slide 40 (the BSL-takeout table, image6.emf).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip, writeZip } from "../../../lib/zip-read.mjs";
import { parseXml, find, children, attr, readRels, resolveTarget } from "../../../lib/ooxml.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../../..");
const SOURCE = process.argv[2] || join(ROOT, "data-sources/lcd/2026-09-10/august-2026-us-private-credit-monitor.pptx");
const OUT = join(here, "august-2026-us-private-credit-monitor.cut.pptx");
const KEEP = [1, 4, 15, 33, 37, 40];

const zip = readZip(readFileSync(SOURCE));
const presRels = readRels(zip, "ppt/_rels/presentation.xml.rels");
const presXml = zip.text("ppt/presentation.xml");
const sldIds = children(find(parseXml(presXml), "sldIdLst"), "sldId");

const members = new Map(); /* name → { data, deflate } */
const keep = (name, data, deflate = true) => { if (!members.has(name)) members.set(name, { data, deflate }); };
const relsOf = (member) => resolveTarget(member, "_rels/" + member.split("/").pop() + ".rels");

const keptRIds = new Set();
for (const pos of KEEP) {
  const sld = sldIds[pos - 1];
  if (!sld) throw new Error("the deck has no slide at position " + pos);
  const rId = attr(sld, "r:id");
  keptRIds.add(rId);
  const slideFile = resolveTarget("ppt/presentation.xml", presRels[rId].target);
  keep(slideFile, zip.text(slideFile));
  keep(relsOf(slideFile), zip.text(relsOf(slideFile)));
  const rels = readRels(zip, relsOf(slideFile));
  for (const rel of Object.values(rels)) {
    const target = resolveTarget(slideFile, rel.target);
    if (rel.type === "chart") {
      keep(target, zip.text(target));
      keep(relsOf(target), zip.text(relsOf(target)));
      for (const crel of Object.values(readRels(zip, relsOf(target)))) {
        if (crel.type === "chartUserShapes") {
          const drawing = resolveTarget(target, crel.target);
          keep(drawing, zip.text(drawing));
        }
      }
    } else if (rel.type === "image" && /\.emf$/i.test(target)) {
      keep(target, zip.read(target), false);
    }
  }
}

/* presentation.xml: the six sldIds; presentation.xml.rels: the six slides */
const sldIdLst = presXml.match(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/)[0];
const keptList = "<p:sldIdLst>" + sldIds.filter((s) => keptRIds.has(attr(s, "r:id")))
  .map((s) => '<p:sldId id="' + attr(s, "id") + '" r:id="' + attr(s, "r:id") + '"/>').join("") + "</p:sldIdLst>";
keep("ppt/presentation.xml", presXml.replace(sldIdLst, keptList));
const presRelsXml = zip.text("ppt/_rels/presentation.xml.rels");
const relOpen = presRelsXml.indexOf("<Relationship ");
const relsHead = presRelsXml.slice(0, relOpen);
const keptRels = [...presRelsXml.matchAll(/<Relationship [^>]*\/>/g)].map((m) => m[0])
  .filter((r) => [...keptRIds].some((id) => r.indexOf('Id="' + id + '"') !== -1));
keep("ppt/_rels/presentation.xml.rels", relsHead + keptRels.join("") + "</Relationships>");

/* docProps/core.xml: dates and title stay; the personal-name elements are blanked */
keep("docProps/core.xml", zip.text("docProps/core.xml")
  .replace(/<dc:creator>[^<]*<\/dc:creator>/, "<dc:creator/>")
  .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy/>"));

/* [Content_Types].xml: the defaults, and the overrides of parts that are present */
const ct = zip.text("[Content_Types].xml");
const ctOpen = ct.indexOf("<Default ");
const overrides = [...ct.matchAll(/<Override [^>]*\/>/g)].map((m) => m[0])
  .filter((o) => { const m = /PartName="\/([^"]+)"/.exec(o); return m && members.has(m[1]); });
const defaults = [...ct.matchAll(/<Default [^>]*\/>/g)].map((m) => m[0]);
keep("[Content_Types].xml", ct.slice(0, ctOpen) + defaults.join("") + overrides.join("") + "</Types>", false);

const list = [...members.entries()].map(([name, m]) => ({ name, data: m.data, deflate: m.deflate }));
const out = writeZip(list);
writeFileSync(OUT, out);
const bytes = list.reduce((n, m) => n + Buffer.byteLength(m.data), 0);
console.log("wrote", OUT, out.length, "bytes zipped,", bytes, "bytes of members,", list.length, "members");
for (const m of list) console.log("  " + (m.deflate ? "deflate " : "stored  ") + String(Buffer.byteLength(m.data)).padStart(6) + "  " + m.name);
