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
 *
 * The "credit" group at the end serves the Private Credit page's tiles
 * and charts rather than a ratio card; it adds the formats pp, bps, index
 * and chart, and is kept out of GROUPS on purpose (its note says why).
 * The credit page's section files (credit-stress.js, credit-capital.js,
 * credit-dealflow.js) add their own credit-group entries at runtime
 * through register(), defined at the end.
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

    /* ================= credit (the Private Credit page) ================= */
    /* Read by credit.js for the conditions strip, "More conditions" and
       charts M1, M2 and M8. The group is deliberately absent from GROUPS:
       statements.js renders every group there as a card grid against the
       ratio object, and these keys are not ratio properties. byGroup
       ("credit") still returns them. Values on the credit page arrive
       from /api/credit-macro as percentage points (2.71 means 2.71%),
       so the formats are `pp` (percentage points, shown as-is with a %
       sign), `bps` (percentage points shown ×100 as basis points),
       `index` (a unitless level), `money` for $ billions and `chart` for
       the three chart popups. Reading rules are from blueprint 3.1; the
       ICE three-year window and the term-SOFR stand-in sit in `watch`. */

    hyOas: {
      key: "hyOas", group: "credit", format: "bps", direction: "context",
      label: "High-yield OAS",
      subtitle: "BAMLH0A0HYM2",
      formula: "Index yield − spot Treasury curve, adjusted for embedded call options; market-cap weighted; daily close, percent",
      definition:
        "The extra yield over Treasuries that investors demand to hold US " +
        "bonds rated BB or lower. The liquid market's price for " +
        "sub-investment-grade credit risk, and the closest public read on " +
        "what private borrowers pay.",
      interpretation:
        "Under 300 bps is tight, 300–500 normal, over 500 stress, over 800 " +
        "crisis. Tight spreads mean cheap public credit competing with " +
        "private lenders; widening reaches private spreads with a lag.",
      watch:
        "FRED serves three years of this ICE BofA series, so the " +
        "percentile window is three years, not ten; blank holiday rows are " +
        "dropped before ranking.",
    },
    igOas: {
      key: "igOas", group: "credit", format: "bps", direction: "context",
      label: "Investment-grade OAS",
      subtitle: "BAMLC0A0CM",
      formula: "Option-adjusted spread of US-dollar corporate bonds rated BBB or better; market-cap weighted; daily close, percent",
      definition:
        "The extra yield over Treasuries on investment-grade corporate " +
        "bonds: the calmest corner of credit, and the benchmark every " +
        "riskier spread is measured against.",
      interpretation:
        "Under 100 bps is tight; over 200 is stress. When this one moves, " +
        "everything below it in credit quality is moving more.",
      watch:
        "FRED serves three years of this series, so the percentile is " +
        "against a short and mostly calm history.",
    },
    bbOas: {
      key: "bbOas", group: "credit", format: "bps", direction: "context",
      label: "BB OAS",
      subtitle: "BAMLH0A1HYBB",
      formula: "Option-adjusted spread of the BB-rated subset of the ICE BofA US High Yield Index; daily close, percent",
      definition:
        "The spread on the best-rated high-yield bonds, one notch below " +
        "investment grade. The top rung of the spread ladder.",
      interpretation:
        "Read as a ladder with B and CCC: the CCC minus BB gap is " +
        "dispersion. A narrow gap means the market is not distinguishing " +
        "quality; a wide one means it is punishing the weakest.",
      watch:
        "FRED serves three years of this series. Most direct-lending " +
        "borrowers sit below this band or are unrated.",
    },
    bOas: {
      key: "bOas", group: "credit", format: "bps", direction: "context",
      label: "B OAS",
      subtitle: "BAMLH0A2HYB",
      formula: "Option-adjusted spread of the B-rated subset of the ICE BofA US High Yield Index; daily close, percent",
      definition:
        "The spread on single-B bonds, the rating band closest to a " +
        "typical leveraged-buyout borrower. The middle rung of the ladder.",
      interpretation:
        "The reference for private loan pricing: a new-issue direct-lending " +
        "spread well above single-B OAS is the illiquidity and control " +
        "premium a private lender earns.",
      watch:
        "FRED serves three years of this series. Bond OAS is over " +
        "Treasuries; loan spreads are over SOFR, so the ladder mixes bases.",
    },
    cccOas: {
      key: "cccOas", group: "credit", format: "bps", direction: "context",
      label: "CCC OAS",
      subtitle: "BAMLH0A3HYC",
      formula: "Option-adjusted spread of the CCC-and-lower subset of the ICE BofA US High Yield Index; daily close, percent",
      definition:
        "The spread on the weakest rated bonds, where default risk " +
        "dominates the price. The bottom rung of the ladder.",
      interpretation:
        "Its gap to BB is the market's dispersion: a widening gap with a " +
        "flat HY index means stress concentrating in the weakest names " +
        "before it shows in the average.",
      watch:
        "FRED serves three years of this series. A small index whose " +
        "membership changes with downgrades, so jumps can be composition.",
    },
    hyEffectiveYield: {
      key: "hyEffectiveYield", group: "credit", format: "pp", direction: "context",
      label: "High-yield effective yield",
      subtitle: "BAMLH0A0HYM2EY",
      formula: "Effective yield of the ICE BofA US High Yield Index: Treasury yield plus OAS, market-cap weighted; daily, percent",
      definition:
        "The all-in yield an investor gets on the public high-yield bond " +
        "market today. The liquid alternative to holding a private loan.",
      interpretation:
        "The private credit premium is the composite all-in yield minus " +
        "this figure. When this rises with rates, private loans must " +
        "pay more to stay competitive; when it falls, spreads carry more.",
      watch:
        "Five of the six ICE BofA tiles are spreads; this one is a yield, " +
        "so it moves with Treasuries as well as with credit. Three-year " +
        "window on FRED.",
    },
    sofr: {
      key: "sofr", group: "credit", format: "pp", direction: "context",
      label: "SOFR",
      subtitle: "Secured Overnight Financing Rate",
      formula: "Overnight rate on cash borrowed against Treasury collateral (Treasury repo), published by the New York Fed; daily, percent",
      definition:
        "The overnight rate banks pay to borrow cash against Treasuries. " +
        "The base rate of almost every floating-rate loan, so when it " +
        "moves, every borrower's interest bill and every BDC's income move.",
      interpretation:
        "Floating-rate loans pass it straight through: rising SOFR lifts " +
        "BDC net investment income and squeezes borrowers' coverage; " +
        "falling SOFR does the reverse unless floors bite.",
      watch:
        "An overnight rate. Loans reset off term SOFR, which FRED does not " +
        "carry; the 90-day average tile is the stand-in. History from " +
        "2018-04-03, so the window says 'since 2018'.",
    },
    sofr90: {
      key: "sofr90", group: "credit", format: "pp", direction: "context",
      label: "SOFR 90-day average",
      subtitle: "SOFR90DAYAVG",
      formula: "Compounded average of SOFR over the trailing 90 calendar days, published by the New York Fed; daily, percent",
      definition:
        "A three-month-style base rate built from realized overnight SOFR. " +
        "The closest thing FRED serves to the term SOFR most loans reset " +
        "off.",
      interpretation:
        "Used here to back the spread out of an all-in rate: LCD's " +
        "cost-weighted all-in yield less this average is the site's " +
        "estimate of the spread over base.",
      watch:
        "A stand-in for term SOFR, which is forward-looking and set from " +
        "futures; the two differ when the market expects rate moves. " +
        "History from 2018-07-02 ('since 2018').",
    },
    baa10y: {
      key: "baa10y", group: "credit", format: "pp", direction: "context",
      label: "Baa minus 10-year Treasury",
      subtitle: "BAA10Y",
      formula: "Moody's seasoned Baa corporate bond yield − 10-year Treasury constant-maturity yield; daily, percentage points",
      definition:
        "The long-run corporate risk premium: what the lowest investment-" +
        "grade borrowers pay over the government. The only credit spread " +
        "here with history back to 1986.",
      interpretation:
        "The tile carries the ten-year percentile the ICE series cannot. " +
        "Read it as the slow tide under the daily OAS moves: a rising Baa " +
        "spread with tight HY OAS is an early divergence.",
      watch:
        "A yield spread, not an OAS: no option adjustment, and Baa is a " +
        "narrower band than the whole IG index. Recession bands on the " +
        "long chart come from USREC.",
    },
    sloosCiLarge: {
      key: "sloosCiLarge", group: "credit", format: "pp", direction: "context",
      label: "Bank lending standards, C&I",
      subtitle: "DRTSCILM · large and middle-market firms",
      formula: "Net percentage of domestic banks tightening standards for C&I loans to large and middle-market firms (tightening − easing); quarterly",
      definition:
        "The Fed's Senior Loan Officer Opinion Survey: the share of banks " +
        "tightening minus the share easing. Positive means banks are " +
        "pulling back from the borrowers private credit competes for.",
      interpretation:
        "Over 20 is tightening, under −10 loosening. Banks retreating " +
        "(2022–23) is when private credit fills the gap; easing is when " +
        "syndicated loans take deals back.",
      watch:
        "Quarterly, about 40 points in ten years, so the sparkline shows " +
        "eight points and says 'quarterly'. A survey of intentions, not " +
        "of loans made.",
    },
    ciDelinquency: {
      key: "ciDelinquency", group: "credit", format: "pp", direction: "context",
      label: "C&I delinquency rate",
      subtitle: "DRBLACBS · all commercial banks",
      formula: "Delinquent business loans ÷ business loans outstanding, all commercial banks, seasonally adjusted; quarterly, end of period, percent",
      definition:
        "The share of bank business loans that have stopped paying on " +
        "time. A lagging proxy for defaults in the bank-lent middle market.",
      interpretation:
        "Rises after the economy turns, not before. Read it with the BDC " +
        "non-accrual rate: the two measure the same borrowers through " +
        "different lenders.",
      watch:
        "Quarterly and published with a lag, so the tile's date can be " +
        "months old. Bank C&I borrowers are not the direct-lending " +
        "population, which LCD describes as typically unrated.",
    },
    ciChargeoff: {
      key: "ciChargeoff", group: "credit", format: "pp", direction: "context",
      label: "C&I charge-off rate",
      subtitle: "CORBLACBS · all commercial banks",
      formula: "Net charge-offs on C&I loans, annualized ÷ average C&I loans, all commercial banks, seasonally adjusted; quarterly, percent",
      definition:
        "The share of bank business loans written off as unrecoverable in " +
        "a year. The loss that follows delinquency.",
      interpretation:
        "Charge-offs lag delinquencies by a few quarters; delinquency " +
        "rising while charge-offs stay low is the early stage of a credit " +
        "cycle.",
      watch:
        "Annualized from one quarter, so a single bad quarter shows as a " +
        "full year's rate. Quarterly, lagged.",
    },
    busloans: {
      key: "busloans", group: "credit", format: "money", direction: "context",
      label: "C&I loans outstanding",
      subtitle: "BUSLOANS · $ billions",
      formula: "Commercial and industrial loans on the books of all commercial banks, seasonally adjusted; monthly, $ billions",
      definition:
        "How much banks are lending to businesses. The stock that private " +
        "credit grows beside, and takes share from when banks tighten.",
      interpretation:
        "Flat or shrinking bank lending while private credit assets grow " +
        "is the substitution story; both growing is a credit boom.",
      watch:
        "A balance, not a flow: repayments and charge-offs shrink it as " +
        "much as new lending grows it.",
    },
    sloosDemand: {
      key: "sloosDemand", group: "credit", format: "pp", direction: "context",
      label: "Bank C&I loan demand",
      subtitle: "DRSDCILM · large and middle-market firms",
      formula: "Net percentage of banks reporting stronger demand for C&I loans from large and middle-market firms (stronger − weaker); quarterly",
      definition:
        "The demand side of the loan-officer survey: whether businesses " +
        "are asking banks for more credit.",
      interpretation:
        "Standards and demand together: tight standards with strong demand " +
        "is the best environment for a private lender; easy standards with " +
        "weak demand is the worst.",
      watch:
        "Quarterly survey, eight points on the sparkline. Demand can fall " +
        "because borrowers went elsewhere, not because they need less.",
    },
    sloosSmall: {
      key: "sloosSmall", group: "credit", format: "pp", direction: "context",
      label: "Bank lending standards, small firms",
      subtitle: "DRTSCIS",
      formula: "Net percentage of domestic banks tightening standards for C&I loans to small firms (tightening − easing); quarterly",
      definition:
        "The same survey question as the large-and-middle-market tile, " +
        "asked about small firms.",
      interpretation:
        "Small-firm standards usually tighten first and ease last. A gap " +
        "opening between the two series is banks rationing by size.",
      watch:
        "Quarterly, about 40 points in ten years. Small firms in the survey " +
        "are smaller than most direct-lending borrowers.",
    },
    nfci: {
      key: "nfci", group: "credit", format: "index", direction: "context",
      label: "Financial conditions",
      subtitle: "NFCI · Chicago Fed National Financial Conditions Index",
      formula: "Chicago Fed composite of money-market, debt, equity and banking-system indicators, scaled so zero is the long-run average; weekly",
      definition:
        "One number for how easy or hard it is to get financing across US " +
        "money, bond and equity markets and the banking system.",
      interpretation:
        "Positive is tighter than average, negative looser. A reading well " +
        "below zero with tight spreads is an easy-money regime; the risk " +
        "is how fast it can reverse.",
      watch:
        "A composite: it cannot say which market is tightening. Read it " +
        "with the spread tiles for the where.",
    },
    stlfsi: {
      key: "stlfsi", group: "credit", format: "index", direction: "context",
      label: "Financial stress",
      subtitle: "STLFSI4 · St. Louis Fed Financial Stress Index",
      formula: "Built from 18 weekly series (seven interest rates, six yield spreads, five other indicators), scaled so the average since late 1993 is zero; weekly",
      definition:
        "A weekly stress gauge built from rates, spreads and volatility " +
        "measures. Above zero is above-average stress.",
      interpretation:
        "Spikes mark the weeks credit markets seized. Between spikes it " +
        "drifts; the level matters less than a sudden jump.",
      watch:
        "Version 4 of the index, which swapped in forward-looking 90-day " +
        "SOFR; earlier versions are not comparable. Weekly, so it can lag " +
        "a fast-moving week by a few days.",
    },
    t10y2y: {
      key: "t10y2y", group: "credit", format: "pp", direction: "context",
      label: "10-year minus 2-year Treasury",
      subtitle: "T10Y2Y",
      formula: "10-year Treasury constant-maturity yield − 2-year constant-maturity yield; daily, percentage points",
      definition:
        "The slope of the Treasury curve. Below zero the curve is inverted, " +
        "which has preceded most US recessions.",
      interpretation:
        "For a floating-rate lender the front end is what matters; the " +
        "slope says whether the market expects that base rate to fall. " +
        "A re-steepening after inversion has often marked the turn.",
      watch:
        "A signal with long and variable lead times, and the shading on " +
        "the long charts (USREC) is the only test of it the page draws.",
    },
    prime: {
      key: "prime", group: "credit", format: "pp", direction: "context",
      label: "Prime rate",
      subtitle: "DPRIME · bank prime loan rate",
      formula: "Rate posted by a majority of the 25 largest insured US-chartered commercial banks, from the Fed's H.15 release; daily, percent",
      definition:
        "One of the base rates banks use to price short-term business " +
        "loans; small-business and revolving loans are often priced off it.",
      interpretation:
        "Prime moves in steps with Fed decisions while SOFR moves daily; " +
        "the gap between them is the bank's built-in margin on prime-based " +
        "loans.",
      watch:
        "BDC schedules price off SOFR, SONIA and EURIBOR, not prime; it " +
        "is here as the bank-market comparison, not as a loan base rate.",
    },
    ndfiShare: {
      key: "ndfiShare", group: "credit", format: "pp", direction: "context",
      label: "Bank loans to non-bank lenders",
      subtitle: "LNFACBW027SBOG ÷ TOTBKCR · share of bank credit",
      formula: "Bank loans to nondepository financial institutions ÷ total bank credit, both from the Fed's H.8 release; weekly, percent",
      definition:
        "How much of bank credit now goes to non-bank lenders (private " +
        "credit funds, BDCs, finance companies) rather than to businesses " +
        "directly. The banks' exposure to private credit, at one remove.",
      interpretation:
        "The share was 10.1% in the week of Jul 1 2026 against 3.5% in " +
        "June 2016 (both series fetched 2026-09-11): banks lend to the " +
        "lenders instead of the borrowers. Rising share means the two " +
        "systems are more entangled.",
      watch:
        "A share of bank credit, not of bank assets, which is a smaller " +
        "figure. The loan series starts in January 2015, so no ten-year " +
        "percentile before 2025.",
    },

    spreadLadder: {
      key: "spreadLadder", group: "credit", format: "chart", direction: "context",
      label: "Spread ladder",
      subtitle: "OAS by rating rung, bps",
      formula: "Latest OAS for IG, BB, HY, B and CCC in bps; the BDC composite spread over base and LCD's new-issue direct-lending LBO spread join as the BDC layer and the deck ingest land",
      definition:
        "Every rung of the credit market on one scale, from investment " +
        "grade to CCC, with the private-loan spread placed against it.",
      interpretation:
        "Read the gaps: CCC minus BB is dispersion; a private loan spread " +
        "far above single-B OAS is the illiquidity and control premium. " +
        "Where LCD's population meets the site's, direction, not level.",
      watch:
        "Bond OAS is over Treasuries; loan spread is over SOFR. One scale, " +
        "two bases. The composite bar and the LCD dot are absent until " +
        "the schedules are parsed and the deck is ingested.",
    },
    yieldStack: {
      key: "yieldStack", group: "credit", format: "chart", direction: "context",
      label: "Yield stack",
      subtitle: "SOFR, the high-yield yield and LCD's all-in rate, 10 years",
      formula: "SOFR and the high-yield effective yield, monthly; LCD's cost-weighted all-in rate on BDC-held loans at each quarter end, once the ingested series load; and, once computed, the BDC composite total-investment-income yield on average cost; percent",
      definition:
        "The base rate, the public high-yield alternative and what the " +
        "loans BDCs hold actually pay, on one axis over ten years.",
      interpretation:
        "The gap between the LCD line and the HY yield is the private " +
        "credit premium; the gap between the LCD line and SOFR is the " +
        "spread the book earns, the floating-rate carry. Both narrow as base rates fall.",
      watch:
        "The ICE yield has three years of history on FRED, so its line " +
        "starts in 2023 while SOFR runs from 2018. LCD's line covers every " +
        "BDC portfolio it tracks (the footer states how many), a different " +
        "population from the site composite: direction, not level. The composite line " +
        "arrives when the schedules of investments are parsed and states its n.",
    },
    bdcVsLoans: {
      key: "bdcVsLoans", group: "credit", format: "chart", direction: "context",
      label: "Listed BDCs vs leveraged loans",
      subtitle: "BIZD vs SRLN (BKLN as the alternative), 5 years, monthly",
      formula: "Monthly closes rebased to 100 at the first month; the total-return view uses the adjusted close (dividends reinvested), the price view the plain close",
      definition:
        "The one daily public price of private credit (the BDC ETF) " +
        "against the syndicated loan market (a loan ETF), each divided by " +
        "its own starting value so both begin at 100.",
      interpretation:
        "The market's mark on BDC books moves months ahead of the " +
        "quarterly NAV marks. BDCs pay high distributions, so the price " +
        "line can fall while the total-return line rises; the toggle " +
        "and caption say which is shown.",
      watch:
        "Adjusted close restates history at every distribution, so the " +
        "total-return line changes shape over time. The five-year figures " +
        "in the caption are computed at build, never typed.",
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

  /**
   * register(entries) — the credit page's section files add their own
   * entries at runtime (one per chart and tile, same shape as above:
   * key, label, formula, watch, definition, interpretation, and
   * optionally subtitle, group, format, direction). get() then finds
   * them like any built-in entry. A key already in the catalog throws,
   * and nothing from that batch is added, so two files can never claim
   * one popup: register at file evaluation, not inside a mount that
   * runs again on Refresh. Returns the number of entries added.
   */
  function register(entries) {
    if (!Array.isArray(entries)) throw new TypeError("RTCatalog.register expects an array of entries");
    var seen = {};
    entries.forEach(function (e) {
      if (!e || typeof e.key !== "string" || !e.key) throw new TypeError("RTCatalog.register: every entry needs a string key");
      if (METRICS[e.key] || seen[e.key]) throw new Error("RTCatalog.register: key already registered: " + e.key);
      seen[e.key] = true;
    });
    entries.forEach(function (e) {
      var entry = { group: "credit", format: "chart", direction: "context" };
      for (var f in e) if (Object.prototype.hasOwnProperty.call(e, f)) entry[f] = e[f];
      METRICS[e.key] = entry;
    });
    return entries.length;
  }

  return { GROUPS: GROUPS, METRICS: METRICS, byGroup: byGroup, get: get, register: register };
});
