/**
 * metric-catalog.js — what every figure on the Statement Analysis
 * dashboard means, in plain English.
 *
 * Paired with ratios.js: that file computes, this file explains, and the
 * `key` of each entry is the property ratios.js writes. A card renders
 * from both, so a number can never appear with a tooltip describing a
 * different formula.
 *
 * Written for a reader who has done an undergraduate finance or
 * accounting course: terms are defined the first time they appear, no
 * step is skipped as obvious, and nothing is explained by restating its
 * own name. Each entry has three parts and they do different jobs:
 *
 *   definition     what the number is, and what it is built from
 *   interpretation how to read it — what moves it, what a high or low
 *                  reading actually means, and what it does NOT mean
 *   watch          the trap. The reading that looks good and is not, or
 *                  the case where the ratio should be ignored entirely.
 *
 * `format` drives display: pct (0.42 -> 42.0%), x (2.14x), days, money,
 * number. `direction` says which way is generally better, and is
 * deliberately "context" wherever a higher reading is not simply better —
 * leverage and payable days are the obvious cases.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTCatalog = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var GROUPS = [
    { key: "returns", label: "Returns",
      blurb: "What the business earns on the money invested in it. The " +
        "reformulated view separates the return earned by operating from " +
        "the return added or destroyed by how the company is financed." },
    { key: "margins", label: "Margins",
      blurb: "How much of each dollar of sales survives to each stage of " +
        "the income statement. Reading them in order shows exactly where " +
        "profit is made or lost." },
    { key: "efficiency", label: "Efficiency & working capital",
      blurb: "How hard the asset base works, and how long cash is tied up " +
        "between paying suppliers and collecting from customers." },
    { key: "liquidity", label: "Liquidity",
      blurb: "Whether the company can meet what falls due in the near " +
        "term. These only mean something read together with the cash " +
        "cycle." },
    { key: "solvency", label: "Solvency & risk",
      blurb: "Whether the company can carry its debt over the long term. " +
        "Leverage describes the situation; it does not by itself say " +
        "whether the situation is dangerous." },
    { key: "cashflow", label: "Cash flow & earnings quality",
      blurb: "Whether reported profit turns into actual cash. Over a long " +
        "enough window the two should converge, and a persistent gap is " +
        "the single most useful warning sign in financial analysis." },
  ];

  var METRICS = {

    /* ================= returns ================= */

    rnoa: {
      key: "rnoa", group: "returns", format: "pct", direction: "up",
      label: "RNOA",
      subtitle: "Return on net operating assets",
      formula: "NOPAT ÷ average net operating assets",
      definition:
        "The return the business earns on the capital actually tied up in " +
        "operating it. NOPAT is operating profit after tax. Net operating " +
        "assets are what the company has invested in running the business " +
        "— its operating assets less the operating liabilities that fund " +
        "them for free, such as unpaid supplier bills. Cash and debt are " +
        "excluded from both, so what is left is the operating business on " +
        "its own.",
      interpretation:
        "This is the cleanest measure of whether the underlying business " +
        "is any good, because it is unaffected by how much the company " +
        "has borrowed. It rises either by earning more on each sale or by " +
        "needing less capital to make those sales. Compare it against the " +
        "company's weighted average cost of capital: earning above that " +
        "creates value, below it destroys value however healthy the " +
        "profit looks.",
      watch:
        "A company can post a strong return on equity while this is flat " +
        "or falling — that means the improvement came from borrowing, not " +
        "from the business getting better.",
    },
    roe: {
      key: "roe", group: "returns", format: "pct", direction: "up",
      label: "ROE",
      subtitle: "Return on equity",
      formula: "Net income ÷ average shareholders' equity",
      definition:
        "What the company earned for its owners, as a percentage of the " +
        "money those owners have in the business. Equity here is the book " +
        "value on the balance sheet, not the market value of the shares.",
      interpretation:
        "The headline measure of performance for a shareholder, but a " +
        "composite one: it blends how well the business operates with how " +
        "aggressively it is financed. Borrowing raises it whenever the " +
        "business earns more than the after-tax cost of the debt, which " +
        "is why it must be decomposed before it means anything.",
      watch:
        "Rising return on equity is only good news if the operating " +
        "return rose too. If it did not, the company simply took on more " +
        "risk, and the same leverage that lifted the return in good years " +
        "will deepen the losses in bad ones.",
    },
    spread: {
      key: "spread", group: "returns", format: "pct", direction: "up",
      label: "Spread",
      subtitle: "Operating return less the after-tax cost of debt",
      formula: "RNOA − after-tax net interest rate",
      definition:
        "How much more the operating business earns than the debt funding " +
        "it costs, after tax. The interest rate here is a net one: " +
        "interest paid on borrowings less interest earned on cash.",
      interpretation:
        "This is the single number that decides whether borrowing helps " +
        "or hurts. Positive means every dollar borrowed and put to work " +
        "in the business adds to shareholder returns. Negative means " +
        "borrowing subtracts from them, and more debt makes it worse.",
      watch:
        "A wide spread is not a reason to borrow without limit. It " +
        "measures the average return, not the return on the next dollar " +
        "invested, and it says nothing about how volatile that return is.",
    },
    netFinancialLeverage: {
      key: "netFinancialLeverage", group: "returns", format: "pct",
      direction: "context",
      label: "Net financial leverage",
      subtitle: "Net debt relative to equity",
      formula: "Average net debt ÷ average equity",
      definition:
        "How much net borrowing the company carries for each dollar of " +
        "equity. Net debt is interest-bearing debt less cash and " +
        "short-term investments, so a company holding more cash than debt " +
        "has a negative figure.",
      interpretation:
        "The multiplier on the spread. It says how much the financing " +
        "decision amplifies the operating return, in either direction. " +
        "Zero means financing is neutral and return on equity equals the " +
        "operating return.",
      watch:
        "Negative leverage — more cash than debt — combined with a " +
        "positive spread actually REDUCES return on equity, because cash " +
        "earns less than the business does. That is a real cost of " +
        "hoarding cash, and it is invisible in most ratio sets.",
    },
    financialLeverageGain: {
      key: "financialLeverageGain", group: "returns", format: "pct",
      direction: "context",
      label: "Financial leverage gain",
      subtitle: "The financing contribution to return on equity",
      formula: "Spread × net financial leverage",
      definition:
        "The number of percentage points that financing decisions added " +
        "to — or subtracted from — return on equity. Operating return " +
        "plus this figure equals return on equity exactly.",
      interpretation:
        "Read it beside the operating return to see where performance " +
        "actually came from. A company with a 12% operating return and a " +
        "10-point leverage gain has a 22% return on equity, but only 12 " +
        "points of it came from the business.",
      watch:
        "This can be large and positive for years and then reverse " +
        "violently, because it is the product of two things that both " +
        "move against the company in a downturn: the spread narrows as " +
        "profits fall, and leverage rises as equity shrinks.",
    },
    nopatMargin: {
      key: "nopatMargin", group: "returns", format: "pct", direction: "up",
      label: "NOPAT margin",
      subtitle: "Operating profit after tax per dollar of sales",
      formula: "NOPAT ÷ revenue",
      definition:
        "How many cents of after-tax operating profit the company keeps " +
        "from each dollar of sales, before any effect of borrowing.",
      interpretation:
        "One of the two things that produce the operating return; the " +
        "other is how fast capital turns over. A high margin generally " +
        "signals pricing power, a differentiated product, or a cost " +
        "advantage.",
      watch:
        "Margin is meaningless across industries without turnover beside " +
        "it. A supermarket earning 2% on capital that turns ten times a " +
        "year outperforms a manufacturer earning 15% on capital that " +
        "turns once.",
    },
    noaTurnover: {
      key: "noaTurnover", group: "returns", format: "x", direction: "up",
      label: "NOA turnover",
      subtitle: "Sales generated per dollar of operating capital",
      formula: "Revenue ÷ average net operating assets",
      definition:
        "How many dollars of sales the company generates from each dollar " +
        "of capital invested in operations.",
      interpretation:
        "The second driver of the operating return, and the one that " +
        "describes the business model. High turnover with a thin margin " +
        "is the cost-leader pattern; low turnover with a fat margin is " +
        "the differentiator pattern. Two companies can reach an identical " +
        "operating return by opposite routes.",
      watch:
        "Turnover changes slowly, because it is set by production " +
        "technology and the shape of the business. A sudden jump usually " +
        "means an asset sale, an acquisition, or a change in accounting " +
        "assumptions rather than a genuine efficiency gain.",
    },
    earningsLeverage: {
      key: "earningsLeverage", group: "returns", format: "pct",
      direction: "context",
      label: "Earnings leverage",
      subtitle: "Net income as a share of operating profit after tax",
      formula: "Net income ÷ NOPAT",
      definition:
        "How much of after-tax operating profit survives to the bottom " +
        "line once net interest and other non-operating items are taken " +
        "out.",
      interpretation:
        "The income-statement half of the financing effect. Below 100% " +
        "means the company pays out net interest; above 100% means it " +
        "earns more from its cash and other non-operating sources than it " +
        "pays on its debt.",
      watch:
        "A reading above 100% is not free money. It usually means a large " +
        "cash pile earning interest, and that cash is capital not being " +
        "used in the business.",
    },
    roa: {
      key: "roa", group: "returns", format: "pct", direction: "up",
      label: "ROA",
      subtitle: "Return on assets",
      formula: "Net income ÷ average total assets",
      definition:
        "Profit as a percentage of everything the company owns.",
      interpretation:
        "The traditional measure, shown for continuity with conventional " +
        "analysis. It is a blunter instrument than the operating return " +
        "because its numerator is affected by borrowing while its " +
        "denominator includes assets, such as a cash pile, that have " +
        "nothing to do with operations.",
      watch:
        "For a company holding substantial cash or investments this " +
        "understates how good the operating business really is — which is " +
        "precisely the gap the operating return is designed to close.",
    },
    residualIncome: {
      key: "residualIncome", group: "returns", format: "money",
      direction: "up",
      label: "Residual income",
      subtitle: "Profit after charging for the equity used",
      formula: "Net income − (cost of equity × book equity)",
      definition:
        "What is left of profit after subtracting a charge for the " +
        "shareholders' capital tied up in the business. Accounting profit " +
        "already deducts the cost of debt as interest, but never deducts " +
        "any cost for equity; this puts that back.",
      interpretation:
        "Positive means the company earned more than shareholders could " +
        "have got elsewhere at similar risk, so it genuinely created " +
        "value. It is the same statement as return on equity exceeding " +
        "the cost of equity.",
      watch:
        "A company can report healthy profits every year and still show " +
        "negative residual income throughout, meaning it has been " +
        "destroying value the whole time.",
    },

    /* ================= margins ================= */

    grossMargin: {
      key: "grossMargin", group: "margins", format: "pct", direction: "up",
      label: "Gross margin",
      formula: "(Revenue − cost of goods sold) ÷ revenue",
      definition:
        "What proportion of sales is left after the direct cost of making " +
        "or buying the product, before any overheads.",
      interpretation:
        "The clearest read on pricing power and unit economics. It is set " +
        "by what the company can charge relative to what the product " +
        "costs to produce, so it moves with price changes, input costs, " +
        "and product mix.",
      watch:
        "What sits inside cost of goods sold is not standardised. Some " +
        "companies put distribution or depreciation there and others do " +
        "not, so cross-company comparison needs care.",
    },
    operatingMargin: {
      key: "operatingMargin", group: "margins", format: "pct", direction: "up",
      label: "Operating margin",
      formula: "EBIT ÷ revenue",
      definition:
        "Profit from the core business per dollar of sales, after both " +
        "direct costs and overheads, but before interest and tax. EBIT " +
        "means earnings before interest and taxes.",
      interpretation:
        "The best single measure of operating performance, because it " +
        "strips out how the company is financed and how it is taxed. " +
        "Rising margin on rising sales is evidence of economies of scale.",
      watch:
        "Operating income is not defined by accounting standards, so " +
        "companies choose what to include. Check whether unusual items " +
        "have been placed above or below the line.",
    },
    netMargin: {
      key: "netMargin", group: "margins", format: "pct", direction: "up",
      label: "Net margin",
      formula: "Net income ÷ revenue",
      definition:
        "The share of every sales dollar that reaches the bottom line " +
        "after every expense, including interest and tax.",
      interpretation:
        "What shareholders ultimately keep from each dollar of sales.",
      watch:
        "It mixes operating and financing performance, and is easily " +
        "moved by one-off items such as asset sales, legal settlements or " +
        "tax adjustments. A jump here with no change in operating margin " +
        "is usually not repeatable.",
    },
    ebitdaMargin: {
      key: "ebitdaMargin", group: "margins", format: "pct", direction: "up",
      label: "EBITDA margin",
      formula: "(EBIT + depreciation and amortisation) ÷ revenue",
      definition:
        "Operating profit before non-cash charges for the wearing-out of " +
        "assets, as a share of sales.",
      interpretation:
        "Widely used as a rough proxy for operating cash generation, and " +
        "useful for comparing companies with very different asset ages or " +
        "depreciation policies.",
      watch:
        "Treat with real caution. Depreciation is a genuine recurring " +
        "cost — assets do wear out and have to be replaced — so excluding " +
        "it does not make the number more true, it makes it more " +
        "flattering. For a capital-intensive business, capital spending " +
        "roughly tracks depreciation over time.",
    },
    sgaMargin: {
      key: "sgaMargin", group: "margins", format: "pct", direction: "down",
      label: "SG&A margin",
      formula: "Selling, general and administrative expense ÷ revenue",
      definition:
        "Overheads — salespeople, marketing, head office, administration " +
        "— as a share of sales.",
      interpretation:
        "The main test of whether growth brings economies of scale. If " +
        "this falls as revenue rises, the company is spreading fixed " +
        "overheads across more sales.",
      watch:
        "A falling ratio can also mean under-investment in sales and " +
        "marketing, which supports margins now at the cost of growth " +
        "later.",
    },

    /* ================= efficiency ================= */

    daysSalesOutstanding: {
      key: "daysSalesOutstanding", group: "efficiency", format: "days",
      direction: "down",
      label: "Days sales outstanding",
      subtitle: "Collection period",
      formula: "Average receivables ÷ (revenue ÷ days in period)",
      definition:
        "How long, on average, the company waits to be paid after making " +
        "a sale.",
      interpretation:
        "Shorter means cash comes back faster and less capital is tied up " +
        "financing customers. Watch the trend more than the level, since " +
        "the normal figure varies enormously by industry.",
      watch:
        "This is a blended average that may describe no actual customer. " +
        "Half the book paying immediately and half paying in 60 days " +
        "gives the same 30-day average as everyone paying in 30 days, and " +
        "the two situations carry very different risk. It is also simply " +
        "not meaningful for a business that sells for cash.",
    },
    daysInventoryOutstanding: {
      key: "daysInventoryOutstanding", group: "efficiency", format: "days",
      direction: "down",
      label: "Days inventory outstanding",
      formula: "Average inventory ÷ (cost of goods sold ÷ days in period)",
      definition:
        "How long stock sits before it is sold.",
      interpretation:
        "Lower generally means less cash tied up and less risk of goods " +
        "becoming obsolete or having to be discounted.",
      watch:
        "Too low can mean stock-outs and lost sales. A sudden rise is one " +
        "of the earliest signs that demand is weakening, because " +
        "production usually keeps running after sales have slowed.",
    },
    daysPayablesOutstanding: {
      key: "daysPayablesOutstanding", group: "efficiency", format: "days",
      direction: "context",
      label: "Days payables outstanding",
      formula: "Average payables ÷ (purchases ÷ days in period)",
      definition:
        "How long the company takes to pay its suppliers. Purchases are " +
        "cost of goods sold adjusted for the change in inventory — what " +
        "was actually bought, rather than what was consumed.",
      interpretation:
        "Longer means suppliers are financing the business for free, " +
        "which is genuinely valuable. This is how large retailers fund " +
        "their working capital.",
      watch:
        "Higher is not automatically better. Stretching payment terms can " +
        "mean strong bargaining power, or it can mean the company cannot " +
        "afford to pay. A sharp extension alongside falling cash is a " +
        "distress signal, not an efficiency gain.",
    },
    cashConversionCycle: {
      key: "cashConversionCycle", group: "efficiency", format: "days",
      direction: "down",
      label: "Cash conversion cycle",
      formula: "Days inventory + days receivable − days payable",
      definition:
        "The number of days between paying for goods and collecting the " +
        "cash from selling them. It is the length of time the company's " +
        "own money is tied up in the operating cycle.",
      interpretation:
        "Lower is better, and negative is excellent: it means the company " +
        "collects from customers before it has to pay suppliers, so " +
        "growth generates cash instead of consuming it.",
      watch:
        "This is the number that makes sense of an alarming-looking " +
        "current ratio. A company with a negative cash cycle can safely " +
        "run current liabilities above current assets, because its " +
        "suppliers are funding the working capital.",
    },
    assetTurnoverTraditional: {
      key: "assetTurnoverTraditional", group: "efficiency", format: "x",
      direction: "up",
      label: "Asset turnover",
      formula: "Revenue ÷ average total assets",
      definition:
        "Sales generated per dollar of total assets.",
      interpretation:
        "A measure of how intensively the whole asset base is used. It is " +
        "structurally low for capital-heavy businesses and high for " +
        "asset-light ones.",
      watch:
        "Because the denominator includes cash and other non-operating " +
        "assets, a company sitting on a large cash balance looks less " +
        "efficient than it is.",
    },

    /* ================= liquidity ================= */

    currentRatio: {
      key: "currentRatio", group: "liquidity", format: "x", direction: "up",
      label: "Current ratio",
      formula: "Current assets ÷ current liabilities",
      definition:
        "Whether assets expected to turn into cash within a year cover " +
        "the obligations falling due within a year.",
      interpretation:
        "A figure around or above 1 is the conventional comfort point.",
      watch:
        "Do not read it alone. A ratio below 1 is not a problem for a " +
        "company whose cash conversion cycle is negative — several large " +
        "retailers run this way permanently and are perfectly safe. " +
        "Equally a high ratio built on slow-moving inventory is weaker " +
        "than it looks.",
    },
    quickRatio: {
      key: "quickRatio", group: "liquidity", format: "x", direction: "up",
      label: "Quick ratio",
      subtitle: "Acid test",
      formula: "(Cash + short-term investments + receivables) ÷ current liabilities",
      definition:
        "The same test as the current ratio, but excluding inventory, on " +
        "the grounds that stock may not be sellable quickly at full " +
        "value.",
      interpretation:
        "A stricter view of near-term safety, and the more informative " +
        "one for a business carrying a lot of inventory.",
      watch:
        "It still assumes receivables will actually be collected. If " +
        "collection periods are lengthening, this overstates the position.",
    },
    cashBurnDays: {
      key: "cashBurnDays", group: "liquidity", format: "days",
      direction: "up",
      label: "Cash burn",
      subtitle: "Days of operating spending covered by liquid assets",
      formula: "(Cash + short-term investments + receivables) ÷ daily operating spend",
      definition:
        "How many days the company could keep paying its operating costs " +
        "out of the liquid assets it currently holds, with no new revenue " +
        "coming in.",
      interpretation:
        "Expressed in days rather than as a ratio, because the question " +
        "being asked is how long the company could last. Most useful for " +
        "businesses that are loss-making or growing fast.",
      watch:
        "A low figure is not automatically dangerous. A company whose " +
        "suppliers fund its working capital can operate safely on a few " +
        "days of liquid assets, because cash arrives continuously.",
    },

    /* ================= solvency ================= */

    debtToEquity: {
      key: "debtToEquity", group: "solvency", format: "x",
      direction: "context",
      label: "Debt to equity",
      formula: "Interest-bearing debt ÷ total equity",
      definition:
        "How much the company has borrowed for each dollar of equity. " +
        "Only interest-bearing debt counts here — supplier credit and " +
        "accrued expenses are operating liabilities, not borrowings.",
      interpretation:
        "The standard gauge of financial risk. Higher borrowing magnifies " +
        "returns in both directions and makes the company more vulnerable " +
        "to a downturn.",
      watch:
        "Leverage describes the situation; it does not say whether the " +
        "situation is risky. That depends on how stable the cash flows " +
        "are and how the company came to be leveraged. A stable utility " +
        "can carry debt that would sink a cyclical manufacturer.",
    },
    netDebtToEbitda: {
      key: "netDebtToEbitda", group: "solvency", format: "x",
      direction: "down",
      label: "Net debt to EBITDA",
      formula: "Net debt ÷ EBITDA",
      definition:
        "Roughly how many years of operating earnings before non-cash " +
        "charges it would take to repay the debt net of cash.",
      interpretation:
        "The measure lenders use most, and the one most often written " +
        "into loan covenants. Lower means more room before a lender gets " +
        "uncomfortable.",
      watch:
        "It inherits every weakness of EBITDA. A company that must spend " +
        "heavily to maintain its assets has less capacity to repay than " +
        "this suggests.",
    },
    interestCoverage: {
      key: "interestCoverage", group: "solvency", format: "x", direction: "up",
      label: "Interest coverage",
      subtitle: "Times interest earned",
      formula: "EBIT ÷ interest expense",
      definition:
        "How many times over the company's operating profit could pay its " +
        "interest bill.",
      interpretation:
        "A direct read on the risk of missing a payment. Comfortable " +
        "coverage means interest is easily absorbed even if profits fall.",
      watch:
        "The level alone is not enough — it has to be read against how " +
        "volatile the earnings are. Coverage of three times on stable " +
        "earnings is far safer than coverage of three times on earnings " +
        "that swing wildly, because the average conceals the bad year.",
    },
    altmanZ: {
      key: "altmanZ", group: "solvency", format: "number", direction: "up",
      label: "Altman Z-score",
      subtitle: "Bankruptcy screen",
      formula: "1.2·(WC/TA) + 1.4·(RE/TA) + 3.3·(EBIT/TA) + 0.6·(equity/debt) + 1.0·(sales/TA)",
      definition:
        "A single score combining five ratios covering liquidity, " +
        "accumulated profitability, operating profitability, solvency and " +
        "asset productivity. The weights were fitted statistically to " +
        "companies that did and did not go bankrupt.",
      interpretation:
        "Below 1.81 predicts distress; above 2.99 predicts safety. " +
        "Between the two is the zone of ignorance — the model declining " +
        "to give an answer, which is itself worth knowing.",
      watch:
        "A screening tool, not a verdict. It is about 95% accurate one " +
        "year before a failure but only around a third accurate five " +
        "years out. It is essentially a weighted average of ratios you " +
        "can already see, so treat a bad score as a reason to look " +
        "harder, never as a conclusion.",
    },

    /* ================= cash flow & quality ================= */

    freeCashFlow: {
      key: "freeCashFlow", group: "cashflow", format: "money", direction: "up",
      label: "Free cash flow",
      formula: "Operating cash flow − capital expenditure",
      definition:
        "The cash left from operations after paying for the investment " +
        "needed to keep the asset base intact. This is the money genuinely " +
        "available for debt repayment, dividends and buybacks.",
      interpretation:
        "The most important cash figure for most purposes, because it is " +
        "what the company can actually distribute or reinvest by choice " +
        "rather than by necessity.",
      watch:
        "It can be flattered for a year or two by cutting capital " +
        "spending, which borrows from future capacity. Compare capital " +
        "spending against depreciation to see whether the asset base is " +
        "being maintained.",
    },
    cashConversion: {
      key: "cashConversion", group: "cashflow", format: "pct", direction: "up",
      label: "Cash conversion",
      formula: "Operating cash flow ÷ net income",
      definition:
        "How much of reported profit arrived as actual operating cash.",
      interpretation:
        "Around 100% or above means profits are backed by cash. " +
        "Persistently below means profit is being recognised well before " +
        "the money appears, which is either a growing business funding " +
        "working capital or an accounting problem.",
      watch:
        "This is the single most useful early warning in financial " +
        "analysis. Companies have reported rising profits for years while " +
        "operating cash flow was deeply negative, and the divergence was " +
        "visible long before the collapse.",
    },
    accrualsRatio: {
      key: "accrualsRatio", group: "cashflow", format: "pct",
      direction: "down",
      label: "Accruals ratio",
      formula: "(Net income − operating cash flow) ÷ average total assets",
      definition:
        "The portion of reported profit not backed by cash, scaled by the " +
        "size of the company. Accruals are the accounting adjustments " +
        "that recognise revenue and costs before or after the cash moves.",
      interpretation:
        "Accruals are a normal and necessary part of accounting. The " +
        "concern is their size and persistence: high accruals tend to " +
        "reverse, so unusually high readings are typically followed by " +
        "weaker reported earnings.",
      watch:
        "A high reading is not evidence of manipulation on its own. Fast " +
        "growth naturally produces high accruals as receivables and " +
        "inventory build.",
    },
    capexToDepreciation: {
      key: "capexToDepreciation", group: "cashflow", format: "x",
      direction: "context",
      label: "Capex to depreciation",
      formula: "Capital expenditure ÷ depreciation and amortisation",
      definition:
        "Whether the company is investing more than the rate at which its " +
        "existing assets are being written down.",
      interpretation:
        "Above 1 means the asset base is growing; around 1 means it is " +
        "being maintained; below 1 sustained means it is shrinking and " +
        "the company is effectively consuming its own capacity.",
      watch:
        "A reading below 1 can flatter free cash flow for several years " +
        "before the under-investment becomes visible in falling revenue.",
    },
    fcfMargin: {
      key: "fcfMargin", group: "cashflow", format: "pct", direction: "up",
      label: "Free cash flow margin",
      formula: "Free cash flow ÷ revenue",
      definition:
        "How many cents of genuinely spendable cash each dollar of sales " +
        "produces.",
      interpretation:
        "Combines profitability and capital intensity into one figure, " +
        "which makes it useful for comparing very different businesses.",
      watch:
        "Lumpy for companies with large periodic investment programmes. " +
        "Read it over several years rather than one.",
    },
    freeCashFlowToFirm: {
      key: "freeCashFlowToFirm", group: "cashflow", format: "money",
      direction: "up",
      label: "Unlevered free cash flow",
      subtitle: "FCFU",
      formula: "Operating cash flow + after-tax interest − cash used in investing",
      definition:
        "The cash the operations generate for everyone who funded the " +
        "company, lenders and shareholders alike, after the investment " +
        "needed to sustain it. Interest is added back so the figure does " +
        "not depend on how the company is financed.",
      interpretation:
        "The input to an enterprise valuation. Because it is unaffected " +
        "by the financing mix, two identically-operating companies " +
        "produce the same figure whatever their debt levels.",
      watch:
        "It subtracts total investing cash flow, so acquisitions and " +
        "purchases of securities depress it alongside genuine capital " +
        "spending. A single large acquisition can make a healthy year " +
        "look poor.",
    },
  };

  /** Every metric belonging to one group, in catalogue order. */
  function byGroup(groupKey) {
    var out = [];
    for (var k in METRICS) {
      if (METRICS[k].group === groupKey) out.push(METRICS[k]);
    }
    return out;
  }
  function get(key) { return METRICS[key] || null; }

  return { GROUPS: GROUPS, METRICS: METRICS, byGroup: byGroup, get: get };
});
