/**
 * sic-map.mjs — the ONE definition of how an SIC code becomes an industry
 * label. The weekly industry-map builder and the on-demand peer endpoint
 * both classify with this; a second copy would eventually put the same
 * company in two industries depending on which path loaded it.
 */
export const MAJOR_GROUP = {
  10: ["Metals & Mining", "Materials"],
  13: ["Oil & Gas Extraction", "Energy"],
  20: ["Food & Beverage", "Consumer Staples"],
  21: ["Tobacco", "Consumer Staples"],
  22: ["Textiles", "Consumer Discretionary"],
  23: ["Apparel", "Consumer Discretionary"],
  26: ["Paper & Packaging", "Materials"],
  28: ["Pharmaceuticals & Chemicals", "Health Care"],
  29: ["Petroleum Refining", "Energy"],
  30: ["Rubber & Plastics", "Materials"],
  31: ["Footwear & Leather Goods", "Consumer Discretionary"],
  32: ["Building Materials", "Materials"],
  33: ["Primary Metals", "Materials"],
  34: ["Fabricated Metal", "Industrials"],
  35: ["Industrial & Computer Hardware", "Information Technology"],
  36: ["Electronics & Semiconductors", "Information Technology"],
  37: ["Transportation Equipment", "Industrials"],
  38: ["Instruments & Medical Devices", "Health Care"],
  39: ["Miscellaneous Manufacturing", "Industrials"],
  40: ["Railroads", "Industrials"],
  42: ["Trucking & Logistics", "Industrials"],
  44: ["Marine Transport", "Industrials"],
  45: ["Airlines", "Industrials"],
  46: ["Pipelines", "Energy"],
  47: ["Transportation Services", "Industrials"],
  48: ["Telecommunications & Media", "Communication Services"],
  49: ["Utilities", "Utilities"],
  50: ["Wholesale — Durables", "Industrials"],
  51: ["Wholesale — Nondurables", "Consumer Staples"],
  52: ["Building Retail", "Consumer Discretionary"],
  53: ["General Merchandise Retail", "Consumer Discretionary"],
  54: ["Food Retail", "Consumer Staples"],
  55: ["Auto Retail", "Consumer Discretionary"],
  56: ["Apparel Retail", "Consumer Discretionary"],
  57: ["Home Furnishings Retail", "Consumer Discretionary"],
  58: ["Restaurants", "Consumer Discretionary"],
  59: ["Specialty & Internet Retail", "Consumer Discretionary"],
  60: ["Banks", "Financials"],
  61: ["Consumer & Specialty Finance", "Financials"],
  62: ["Brokers & Capital Markets", "Financials"],
  63: ["Insurance", "Financials"],
  64: ["Insurance Brokers", "Financials"],
  65: ["Real Estate", "Real Estate"],
  67: ["Investment Offices & REITs", "Real Estate"],
  70: ["Lodging", "Consumer Discretionary"],
  72: ["Personal Services", "Consumer Discretionary"],
  73: ["Software & IT Services", "Information Technology"],
  78: ["Motion Pictures", "Communication Services"],
  79: ["Recreation & Entertainment", "Communication Services"],
  80: ["Health Care Services", "Health Care"],
  82: ["Education", "Consumer Discretionary"],
  87: ["Professional & Research Services", "Industrials"],
};

/* Where the two-digit group mixes businesses that do not compete, the
   three-digit code splits it. SIC 35 otherwise files Apple and
   Caterpillar together, and an industry analysis built on that peer group
   would be meaningless: their cost structures, capital intensity and
   customers have nothing in common. Same for chemicals versus
   pharmaceuticals in 28, and autos versus aerospace in 37. */
export const INDUSTRY_GROUP = {
  /* Footwear spans two SIC neighbourhoods — rubber footwear under 302
     (Nike, Crocs) and everything-else footwear under 314 (Deckers,
     Steven Madden, Wolverine). Without both, the industry cannot see
     its own members: Crocs classified into Rubber & Plastics and its
     real rivals into an unmapped group. */
  302: ["Footwear", "Consumer Discretionary"],
  314: ["Footwear", "Consumer Discretionary"],
  283: ["Pharmaceuticals", "Health Care"],
  281: ["Chemicals", "Materials"], 282: ["Chemicals", "Materials"],
  284: ["Household & Personal Products", "Consumer Staples"],
  286: ["Chemicals", "Materials"], 287: ["Chemicals", "Materials"],
  289: ["Chemicals", "Materials"],
  353: ["Industrial Machinery", "Industrials"],
  354: ["Industrial Machinery", "Industrials"],
  355: ["Industrial Machinery", "Industrials"],
  356: ["Industrial Machinery", "Industrials"],
  357: ["Computer Hardware", "Information Technology"],
  358: ["Industrial Machinery", "Industrials"],
  361: ["Electrical Equipment", "Industrials"],
  362: ["Electrical Equipment", "Industrials"],
  364: ["Electrical Equipment", "Industrials"],
  365: ["Consumer Electronics", "Consumer Discretionary"],
  366: ["Communications Equipment", "Information Technology"],
  367: ["Semiconductors", "Information Technology"],
  371: ["Automobiles", "Consumer Discretionary"],
  372: ["Aerospace & Defense", "Industrials"],
  376: ["Aerospace & Defense", "Industrials"],
  384: ["Medical Devices", "Health Care"],
  382: ["Instruments", "Health Care"],
  731: ["Advertising & Marketing", "Communication Services"],
  737: ["Software & IT Services", "Information Technology"],
  601: ["Banks", "Financials"], 602: ["Banks", "Financials"],
  621: ["Brokers & Capital Markets", "Financials"],
  631: ["Insurance — Life & Health", "Financials"],
  633: ["Insurance — Property & Casualty", "Financials"],
  635: ["Insurance — Property & Casualty", "Financials"],
  641: ["Insurance Brokers", "Financials"],
  679: ["Investment Offices", "Financials"],
  651: ["REITs", "Real Estate"], 653: ["REITs", "Real Estate"],
  671: ["Holding Companies", "Financials"],
  801: ["Health Care Services", "Health Care"],
  806: ["Hospitals", "Health Care"],
  873: ["Research Services", "Health Care"],
};

export function classify(sic, sicDescription) {
  const code = Number(String(sic || "").slice(0, 4));
  const three = Math.floor(code / 10);
  const fine = INDUSTRY_GROUP[three];
  if (fine) return { industry: fine[0], sector: fine[1] };
  const hit = MAJOR_GROUP[Math.floor(code / 100)];
  if (hit) return { industry: hit[0], sector: hit[1] };
  return { industry: sicDescription || "Unclassified", sector: "Other" };
}
