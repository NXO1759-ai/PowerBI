/**
 * peer-hints.mjs — curated peer sets, in ticker form.
 *
 * The strongest source for a company's comparables is the peer group the
 * company itself discloses in its proxy statement, cross-checked against
 * the sets analysts actually use. These lists were compiled that way —
 * Crocs' own DEF 14A names Deckers, Skechers, Steven Madden, Under
 * Armour, VF and Wolverine among its compensation peers — and they beat
 * any SIC lookup because industry codes cannot see that a rubber-clog
 * maker competes with a sneaker brand filed two codes away.
 *
 * A list may name filers the terminal cannot analyse — foreign issuers
 * on IFRS such as adidas or Birkenstock. They are kept ON PURPOSE: the
 * endpoint validates every name and reports the ones it must drop with
 * the reason, which is more honest than pretending the peer never
 *existed.
 *
 * Order matters: closest comparables first, since only the largest
 * eight by revenue survive the cut.
 */

const FOOTWEAR = ["NKE", "DECK", "SKX", "CROX", "SHOO", "WWW", "UAA", "VFC",
  "BIRK", "ONON", "ADDYY"];
const ATHLEISURE = ["NKE", "LULU", "UAA", "VFC", "DECK", "SKX", "GPS", "ANF"];

export const PEER_HINTS = {
  CROX: FOOTWEAR,
  DECK: FOOTWEAR,
  SKX: FOOTWEAR,
  SHOO: FOOTWEAR,
  WWW: FOOTWEAR,
  BIRK: FOOTWEAR,
  ONON: FOOTWEAR,
  NKE: FOOTWEAR,
  UAA: ATHLEISURE,
  UA: ATHLEISURE,
  LULU: ATHLEISURE,
  VFC: ATHLEISURE,
};

/** The hinted peer list for a ticker, minus the ticker itself. */
export function peerHint(ticker) {
  const list = PEER_HINTS[String(ticker || "").toUpperCase()];
  if (!list) return null;
  return list.filter((t) => t !== ticker);
}
