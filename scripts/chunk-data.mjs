/**
 * chunk-data.mjs — split the generated data files so a page loads what it
 * needs and nothing else.
 *
 * The strategy page had been loading 1.7MB of JavaScript before its
 * first paint: the whole panel (every industry), every company's
 * segment tables, every company's risk register, and the SEC index. A
 * reader looking at one company in one industry needs that industry's
 * panel rows, that company's segments and risks, and the index for
 * search. So:
 *
 *   frontend/data/panel/<industry>.json   one file per industry
 *   frontend/data/panel-index.json        ticker → industry, sector,
 *                                         name, cik, sic, fyEndMonth
 *                                         (small: what search and the
 *                                         industry picker need)
 *   frontend/data/segments/<TICKER>.json  one file per company
 *   frontend/data/risks/<TICKER>.json     one file per company
 *
 * The monolithic files stay as the builders' output and the source of
 * truth for this split; this script runs after them in the weekly job.
 * Industry file names are slugs of the industry label.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "frontend/data");

function loadWindowFile(name) {
  const stub = {};
  new Function("window", readFileSync(join(DATA, name), "utf8"))(stub);
  return stub;
}
export function slug(s) {
  return String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function clean(dir) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) unlinkSync(join(dir, f));
}

/* ---- panel by industry + index ---- */
const panel = loadWindowFile("strategy-panel.js");
const P = panel.STRATEGY_PANEL || {};
const FIELDS = panel.PANEL_FIELDS || [];
const byIndustry = {};
const index = {};
for (const [t, c] of Object.entries(P)) {
  (byIndustry[c.industry] = byIndustry[c.industry] || {})[t] = c;
  index[t] = { name: c.name, cik: c.cik, industry: c.industry, sector: c.sector,
    sic: c.sic || null, fyEndMonth: c.fyEndMonth || 12 };
}
clean(join(DATA, "panel"));
let panelBytes = 0;
for (const [ind, members] of Object.entries(byIndustry)) {
  const body = JSON.stringify({ industry: ind, fields: FIELDS, companies: members });
  writeFileSync(join(DATA, "panel", slug(ind) + ".json"), body);
  panelBytes += body.length;
}
/* The DuPont read compares a company against the median of every
   nonfinancial company in the panel. A page that has loaded one industry
   cannot compute that, so it is computed here over the whole panel. */
function wholePanelReference() {
  const stub = {};
  try {
    for (const lib of ["lib/metrics.js", "lib/ratios.js", "lib/strategy.js"]) {
      new Function("window", readFileSync(join(ROOT, "frontend", lib), "utf8"))(stub);
    }
    const S = stub.RTStrategy || globalThis.RTStrategy;
    const get = S.makeReader(FIELDS);
    const years = new Set();
    for (const c of Object.values(P)) for (const y of Object.keys(c.years || {})) years.add(Number(y));
    const out = {};
    for (const y of [...years].sort()) out[y] = S.panelReference(P, get, y);
    return out;
  } catch (e) {
    console.warn("reference not precomputed: " + (e && e.message || e));
    return {};
  }
}
writeFileSync(join(DATA, "panel-index.json"), JSON.stringify({ fields: FIELDS, companies: index,
  reference: wholePanelReference(),
  industries: Object.keys(byIndustry).sort().map((i) => ({ label: i, file: slug(i) + ".json",
    members: Object.keys(byIndustry[i]).length })) }));

/* ---- segments and risks per company ---- */
function splitPer(name, globalKey, dir) {
  if (!existsSync(join(DATA, name))) return 0;
  const data = loadWindowFile(name)[globalKey] || {};
  clean(join(DATA, dir));
  let n = 0;
  for (const [t, v] of Object.entries(data)) {
    writeFileSync(join(DATA, dir, t + ".json"), JSON.stringify(v));
    n++;
  }
  return n;
}
const segN = splitPer("segments.js", "SEGMENT_DATA", "segments");
const riskN = splitPer("risks.js", "RISK_DATA", "risks");

console.log("chunked: " + Object.keys(byIndustry).length + " industry files (" +
  Math.round(panelBytes / 1024) + "KB total), index " +
  Math.round(readFileSync(join(DATA, "panel-index.json")).length / 1024) + "KB, " +
  segN + " segment files, " + riskN + " risk files");
