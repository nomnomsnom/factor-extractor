/* Industry rulebooks: which numbers answer section 2 for this kind of business,
   what a normal value looks like, and which standard metrics are meaningless here.
   k = key in company.M · c = key on the company object · f = read it in the filing */
window.RULEBOOKS = [
{ m: /Banks/, name: 'Banks',
  decides: 'Credit quality. Loans go bad about three years after they are written, so the good years tell you nothing about the underwriting.',
  watch: [
    { l: 'Return on equity', k: 'roe', t: 'above 12%; above 15% is excellent', ok: v => v >= 12 },
    { l: 'Price to book vs its own history', k: 'pb', t: 'the multiple that matters for a bank, not P/E' },
    { l: 'Cost-to-income ratio', fill: 'cti', u: '%', f: 'quarterly results presentation', t: 'below 50% is strong (DBS runs low 40s)', ok: v => v <= 55 },
    { l: 'CET1 capital ratio', fill: 'cet1', u: '%', f: 'capital adequacy note in the annual report', t: 'comfortably above the regulator minimum' },
    { l: 'Non-performing loans', fill: 'npl', u: '%', f: 'asset quality section', t: 'below 2% and, more importantly, not rising', ok: v => v <= 2 },
    { l: 'Allowance for loan losses / gross loans', fill: 'allowPct', u: '%', t: 'a reserve proxy, not the NPL ratio — read it alongside the real one' },
    { l: 'Loans / deposits', fill: 'ldr', u: '%', t: 'below 100% means deposits fund the book' },
    { l: 'Net interest margin', fill: 'nim', u: '%', f: 'results presentation', t: 'watch the direction as rates move' }],
  ignore: ['Gross margin', 'EV / EBITDA', 'Debt / EBITDA', 'Free cash flow', 'Price / sales'] },

{ m: /Insurance/, name: 'Insurers',
  decides: 'Whether reserves are adequate and new business is written at a profit. An insurer can report profit for years by under-reserving.',
  watch: [
    { l: 'Return on equity', k: 'roe', t: 'above 12% through a cycle', ok: v => v >= 12 },
    { l: 'Combined ratio (general insurance)', f: 'results presentation', t: 'below 100% means underwriting itself makes money' },
    { l: 'New business profit / embedded value (life)', f: 'embedded value report', t: 'growing, and the assumptions behind it disclosed' },
    { l: 'Price to embedded value or book', k: 'pb', t: 'compare to its own five-year range' },
    { l: 'Investment portfolio quality', f: 'investments note', t: 'what the float is invested in, and duration' }],
  ignore: ['Gross margin', 'EV / EBITDA', 'Debt / EBITDA', 'Free cash flow'] },

{ m: /Capital Markets|Asset Management|Financial Data & Stock Exchanges|Financial Conglomerates/, name: 'Asset managers, brokers and exchanges',
  decides: 'Whether fee income is durable. Assets under management fall with markets and with client withdrawals at the same time.',
  watch: [
    { l: 'Operating margin', k: 'om', t: 'above 30% for scale managers and exchanges', ok: v => v >= 30 },
    { l: 'Net flows (not just AUM)', f: 'quarterly AUM disclosure', t: 'positive in a flat market is the real test' },
    { l: 'Effective fee rate', f: 'revenue note', t: 'falling fee rates can cancel out rising assets' },
    { l: 'Return on equity', k: 'roe', t: 'above 15%', ok: v => v >= 15 },
    { l: 'Revenue mix: recurring vs performance fees', f: 'segment note', t: 'performance fees are not an annuity' }],
  ignore: ['Gross margin', 'Debt / EBITDA', 'Inventory turnover'] },

{ m: /Credit Services/, name: 'Consumer lenders and pawnbrokers',
  decides: 'Loss rates through a downturn. Growth in the loan book always looks good until the provisions arrive.',
  watch: [
    { l: 'Net charge-off rate', f: 'credit quality disclosure', t: 'compare to the same stage of the last cycle' },
    { l: '30-day delinquencies', f: 'quarterly supplement', t: 'the early-warning number; watch the trend' },
    { l: 'Return on equity', k: 'roe', t: 'above 15%', ok: v => v >= 15 },
    { l: 'Loan growth vs provisions', f: 'income statement', t: 'book growing much faster than provisions is a warning' },
    { l: 'Collateral value (pawnbrokers)', f: 'inventory note', t: 'gold-backed books move with the gold price' }],
  ignore: ['Gross margin', 'EV / EBITDA', 'Free cash flow'] },

{ m: /REIT/, name: 'REITs',
  decides: 'Refinancing. A REIT rarely dies of low occupancy; it dies of debt maturing into higher rates, which forces an asset sale or an equity raise at a discount.',
  watch: [
    { l: 'Gearing (debt to assets)', fill: 'gearing', u: '%', f: 'financial review', t: 'below 40%; the MAS limit for S-REITs is 50%. Managers report aggregate leverage on the MAS definition, which differs where assets sit in joint ventures', ok: v => v <= 40 },
    { l: 'Distribution per unit, five-year trend', c: 'dpsTrend', t: 'flat or rising; a falling DPU is the story' },
    { l: 'Interest coverage', k: 'icov', t: 'above 3x; below 2.5x the manager has no room', ok: v => v >= 3 },
    { l: 'Rental reversion', f: 'quarterly results', t: 'positive means leases renew at higher rents' },
    { l: 'Occupancy and WALE', f: 'portfolio summary', t: 'occupancy above 95%; longer WALE is safer, less upside' },
    { l: 'Yield spread over the 10-year government bond', k: 'divy', t: 'the compensation for taking property risk' },
    { l: 'Debt maturity profile', f: 'debt section', t: 'how much refinances in the next 24 months, and at what rate' }],
  ignore: ['P/E ratio (earnings include revaluations)', 'ROIC', 'Gross margin', 'Revenue growth'] },

{ m: /Real Estate - |Real Estate Services/, name: 'Property developers',
  decides: 'The cost basis of the land bank and how much debt sits against it. Profits arrive in lumps when projects complete, so any single year is meaningless.',
  watch: [
    { l: 'Net gearing', k: 'de', t: 'below 1.0x equity; above 1.5x you are leveraged to property prices' },
    { l: 'Debt to total assets', fill: 'gearing', u: '%', t: 'below 45% for a developer that can survive a downturn', ok: v => v <= 45 },
    { l: 'Price to book vs net asset value', k: 'pb', t: 'developers usually trade below book — ask why this discount, not whether' },
    { l: 'Unsold inventory and its age', f: 'development properties note', t: 'ageing unsold stock is trapped capital' },
    { l: 'Recurring rental income vs development profit', f: 'segment note', t: 'recurring income is what supports the dividend' },
    { l: 'Land bank cost vs current land prices', f: 'annual report land schedule', t: 'cheap legacy land is the whole margin' }],
  ignore: ['P/E ratio (lumpy)', 'Gross margin', 'Revenue growth', 'ROIC'] },

{ m: /Semiconductor/, name: 'Semiconductors and semi equipment',
  decides: 'Where you are in the cycle. These businesses look cheapest on trailing earnings exactly when earnings are at a peak.',
  watch: [
    { l: 'Operating margin across five years, not today', c: 'omRange', t: 'use the mid-cycle average as your earnings base' },
    { l: 'Inventory days', fill: 'invDays', u: 'days', f: 'balance sheet', t: 'rising inventory into flat revenue precedes every downturn' },
    { l: 'Capex as % of revenue', c: 'capexPct', t: 'fabless is asset-light; fabs and memory are not' },
    { l: 'Customer concentration', f: '10-K risk factors / customer note', t: 'over 10% from one customer is a real risk' },
    { l: 'Book-to-bill or backlog', f: 'earnings call', t: 'above 1.0 means orders exceed shipments' },
    { l: 'ROIC', k: 'roic', t: 'above 15% across a cycle, not just at the top', ok: v => v >= 15 }],
  ignore: ['Trailing P/E at a cycle peak', 'Single-year revenue growth'] },

{ m: /Software|Information Technology Services/, name: 'Software',
  decides: 'Whether growth is decelerating. The entire multiple rests on the growth rate continuing, so the second derivative is the thing to watch.',
  watch: [
    { l: 'Revenue growth, 5-year', c: 'rev5', t: 'above 15% to justify a software multiple', ok: v => v >= 15 },
    { l: 'Gross margin', k: 'gm', t: 'above 70%; below that it is a services business', ok: v => v >= 70 },
    { l: 'Rule of 40 (growth + FCF margin)', c: 'rule40', t: 'above 40 is healthy', ok: v => v >= 40 },
    { l: 'Net revenue retention', f: 'investor presentation', t: 'above 110% means the installed base grows by itself' },
    { l: 'Stock-based comp as % of revenue', fill: 'sbcPct', u: '%', f: 'cash flow statement', t: 'above 15% and reported profit overstates the economics', ok: v => v <= 15 },
    { l: 'Remaining performance obligation', fill: 'rpo', u: 'money', f: 'revenue note', t: 'contracted revenue not yet booked; should track or lead revenue growth' }],
  ignore: ['Price / book', 'Book value', 'Inventory', 'Asset turnover'] },

{ m: /Computer Hardware|Consumer Electronics|Electronic Components|Hardware, Equipment|Communication Equipment/, name: 'Hardware and components',
  decides: 'Whether the gross margin survives the next product cycle. Hardware margins are defended by design wins, and design wins expire.',
  watch: [
    { l: 'Gross margin trend', k: 'gm', t: 'flat or rising; falling means commoditisation' },
    { l: 'Free cash flow margin', k: 'fcfm', t: 'above 8%', ok: v => v >= 8 },
    { l: 'Inventory days', fill: 'invDays', u: 'days', f: 'balance sheet', t: 'the first place a demand slowdown shows up' },
    { l: 'Customer concentration', f: '10-K risk factors', t: 'assembly businesses often have two or three customers' },
    { l: 'ROIC', k: 'roic', t: 'above 12%, but check it is not flattered by buybacks shrinking equity', ok: v => v >= 12 }],
  ignore: ['ROE where buybacks have shrunk equity to near zero'] },

{ m: /Drug Manufacturers|Biotechnology/, name: 'Pharma and biotech',
  decides: 'The patent cliff. Every big drug has an expiry date you can look up, and revenue steps down the year generics arrive.',
  watch: [
    { l: 'Revenue concentration in the top product', c: 'topSeg', t: 'above 40% from one drug is a single-product company' },
    { l: 'Patent expiry dates by product', f: '10-K, intellectual property section', t: 'the single most important fact about a pharma company' },
    { l: 'Phase III pipeline and readout dates', f: 'pipeline page of the annual report', t: 'what replaces the revenue that expires' },
    { l: 'R&D as % of revenue', fill: 'rdPct', u: '%', f: 'income statement', t: '15-25% is typical for large pharma' },
    { l: 'Gross margin', k: 'gm', t: 'above 70% for patented drugs', ok: v => v >= 70 }],
  ignore: ['Past revenue growth as a trend — it steps down at expiry, it does not decay smoothly'] },

{ m: /Medical|Diagnostics/, name: 'Medical devices and diagnostics',
  decides: 'The installed base and what it consumes. Systems are sold near cost; the money is in the consumables and service attached to them.',
  watch: [
    { l: 'Recurring revenue share', f: 'revenue note', t: 'consumables and service above 60% is a strong model' },
    { l: 'Procedure or test volume growth', f: 'earnings call', t: 'the underlying demand signal, ahead of revenue' },
    { l: 'Gross margin', k: 'gm', t: 'above 55%', ok: v => v >= 55 },
    { l: 'ROIC', k: 'roic', t: 'above 12%', ok: v => v >= 12 },
    { l: 'Regulatory approvals and recalls', f: 'FDA / HSA filings', t: 'a recall resets the installed base story' }],
  ignore: ['Price / sales in isolation'] },

{ m: /Healthcare Plans|Medical Care Facilities/, name: 'Health insurers and hospitals',
  decides: 'The medical loss ratio for insurers, bed occupancy and revenue intensity for hospitals. Both are reimbursement businesses — the payer sets the ceiling.',
  watch: [
    { l: 'Medical loss ratio (insurers)', f: 'quarterly results', t: '85-89%; every point is enormous' },
    { l: 'Occupancy and revenue per bed (hospitals)', f: 'operating statistics', t: 'the two levers that matter' },
    { l: 'Reimbursement and rate decisions', f: 'regulatory filings', t: 'a rate cut lands directly in operating profit' },
    { l: 'Operating margin', k: 'om', t: 'mid single digits for insurers, high teens+ for private hospitals' },
    { l: 'Return on equity', k: 'roe', t: 'above 12%', ok: v => v >= 12 }],
  ignore: ['Gross margin', 'Price / sales'] },

{ m: /Tobacco|Beverages|Packaged Foods|Household & Personal Products|Agricultural Farm Products|Food Distribution/, name: 'Consumer staples',
  decides: 'Volume, separated from price. A staple growing revenue 4% on minus 2% volume and plus 6% price is shrinking while looking like it is growing.',
  watch: [
    { l: 'Organic volume growth (not revenue)', f: 'results presentation, organic growth bridge', t: 'positive, or at worst flat' },
    { l: 'Gross margin vs input costs', k: 'gm', t: 'holding margin while commodities rise proves pricing power' },
    { l: 'Market share', f: 'annual report / Nielsen data cited by the company', t: 'losing share while raising price is the classic trap' },
    { l: 'ROIC', k: 'roic', t: 'above 15% — brands should earn high returns', ok: v => v >= 15 },
    { l: 'Payout ratio', k: 'payout', t: 'below 75% leaves room for the dividend to grow', ok: v => v <= 75 }],
  ignore: ['Revenue growth taken on its own', 'EV / EBITDA vs high-growth sectors'] },

{ m: /Retail|Restaurants|Discount Stores|Grocery Stores|Luxury Goods/, p: 70, name: 'Retail and restaurants',
  decides: 'Same-store sales, split into traffic and average ticket. Growth from opening stores is not the same as growth from stores that already exist.',
  watch: [
    { l: 'Comparable store sales, traffic vs ticket', f: 'quarterly results', t: 'positive traffic is the healthy version' },
    { l: 'Gross margin', k: 'gm', t: 'stable; discounting shows up here first' },
    { l: 'Inventory days', fill: 'invDays', u: 'days', f: 'balance sheet', t: 'rising days mean stock nobody wants' },
    { l: 'New store returns / payback period', f: 'investor day materials', t: 'if new stores earn less than old ones, growth is value-destroying' },
    { l: 'Operating margin', k: 'om', t: 'thin by nature — 5-12% is normal, so small changes matter' }],
  ignore: ['Revenue growth driven purely by store openings'] },

{ m: /Aerospace/, name: 'Aerospace and defence',
  decides: 'The split between original equipment and aftermarket. Engines are sold near cost and earn for twenty-five years on spare parts.',
  watch: [
    { l: 'Backlog (contracted, not yet booked)', fill: 'rpo', u: 'money', f: 'results presentation for book-to-bill', t: 'backlog leads revenue by years; book-to-bill above 1.0' },
    { l: 'Aftermarket share of revenue', f: 'segment note', t: 'the higher the better — it is the profit' },
    { l: 'Charges on fixed-price contracts', f: 'income statement, one-off items', t: 'recurring charges mean systematic underbidding' },
    { l: 'Operating margin', k: 'om', t: '10-15% is normal; defence margins are capped by contract structure' },
    { l: 'Free cash flow conversion', c: 'fcfConv', t: 'above 80% of net income', ok: v => v >= 80 }],
  ignore: ['Trailing P/E during a programme ramp'] },

{ m: /Machinery|Conglomerates|Engineering|Industrial|Building Materials|Specialty Chemicals/, p: 80, name: 'Industrials and machinery',
  decides: 'The order book and where you are in the cycle. Record margins in a cyclical business are a warning, not a virtue.',
  watch: [
    { l: 'Backlog (contracted, not yet booked)', fill: 'rpo', u: 'money', f: 'quarterly results for order intake', t: 'the leading indicator; revenue is the lagging one' },
    { l: 'Operating margin across five years', c: 'omRange', t: 'use the average, not the peak, as your base' },
    { l: 'Dealer or channel inventory', f: 'earnings call', t: 'rising channel inventory is demand being pulled forward' },
    { l: 'ROIC vs cost of capital', c: 'spread', t: 'positive spread across the whole cycle', ok: v => v > 0 },
    { l: 'Aftermarket and parts revenue', f: 'segment note', t: 'the stable half of most industrials' }],
  ignore: ['Extrapolating peak-cycle margins'] },

{ m: /Railroads|Freight|Transportation|Marine Shipping/, p: 40, name: 'Rail, freight and shipping',
  decides: 'Pricing power against volume. These are fixed-cost networks: a few percent of volume swings the margin enormously.',
  watch: [
    { l: 'Operating ratio (rail)', f: 'quarterly results', t: 'below 60% is excellent — it is costs over revenue, so lower is better' },
    { l: 'Volume vs price per unit', f: 'operating statistics', t: 'price above inflation with flat volume is the rail model' },
    { l: 'Capex as % of revenue', c: 'capexPct', t: 'heavy and non-negotiable for networks' },
    { l: 'Charter rates and fleet age (shipping)', f: 'fleet list in the annual report', t: 'shipping is a commodity with a cycle, not a compounder' },
    { l: 'Free cash flow after maintenance capex', k: 'fcf', t: 'positive through the cycle' }],
  ignore: ['Gross margin', 'Revenue growth in isolation'] },

{ m: /Airlines/, p: 40, name: 'Airlines',
  decides: 'Yield per seat against fuel and capacity. Airlines are price-takers on both revenue and their biggest cost.',
  watch: [
    { l: 'Load factor and yield', f: 'monthly operating statistics', t: 'load factor above 80%; yield direction matters more' },
    { l: 'Fuel cost and hedging', f: 'fuel note', t: 'the single largest variable cost' },
    { l: 'Industry capacity growth on your routes', f: 'competitor announcements', t: 'capacity added by rivals kills yields' },
    { l: 'Net debt including leases', k: 'debt', t: 'aircraft leases are debt' },
    { l: 'Price to book', k: 'pb', t: 'near or below book is the normal state for an airline' }],
  ignore: ['P/E on peak-cycle earnings', 'ROIC as a quality signal'] },

{ m: /Oil & Gas|Coal/, name: 'Oil, gas and coal',
  decides: 'Cost per barrel or tonne against the commodity price. Nobody has pricing power, so cost position is the entire moat.',
  watch: [
    { l: 'Cash cost and free cash flow break-even', f: 'investor presentation', t: 'the lower the break-even, the longer you survive' },
    { l: 'Reserve life and reserve replacement', f: 'reserves statement in the 10-K', t: 'replacement above 100% or the business is liquidating' },
    { l: 'Net debt', k: 'netcash', t: 'low debt is what lets you survive a $40 oil year' },
    { l: 'Capex discipline', c: 'capexPct', t: 'the sector destroyed capital for a decade by overspending at the top' },
    { l: 'Dividend and buyback coverage at strip prices', k: 'payout', t: 'is the payout funded by cash flow or by debt' }],
  ignore: ['P/E ratio', 'Revenue growth', 'Multi-year growth forecasts'] },

{ m: /Gold|Precious Metals|Rubber & Agricultural Processing/, name: 'Mining and commodity processing',
  decides: 'Cost position and reserve life. The commodity price is not something the company influences.',
  watch: [
    { l: 'All-in sustaining cost per unit', f: 'quarterly production report', t: 'compare to the commodity price, and to peers' },
    { l: 'Reserve life at current production', f: 'reserves and resources statement', t: 'under ten years and the clock is running' },
    { l: 'Net debt', k: 'netcash', t: 'balance sheet decides who survives a price trough' },
    { l: 'Grade and production guidance history', f: 'operating results', t: 'chronic guidance misses are a management signal' },
    { l: 'Processing spread (for processors)', k: 'gm', t: 'thin and volatile — it is a spread business, not a brand' }],
  ignore: ['P/E at a commodity price peak', 'Growth rates'] },

{ m: /Telecom/, name: 'Telecom',
  decides: 'Whether the dividend is covered after capex, not before it. Telcos are bond substitutes and the payout is what breaks.',
  watch: [
    { l: 'EBITDA margin', k: 'ebitdam', t: '30-40% is normal', ok: v => v >= 30 },
    { l: 'Net debt / EBITDA', k: 'debitda', t: 'up to 3.5x is normal here, unlike most sectors', ok: v => v <= 3.5 },
    { l: 'Capex as % of revenue', c: 'capexPct', t: '15-20%; spectrum auctions come on top' },
    { l: 'Subscriber churn and ARPU', f: 'quarterly results', t: 'rising churn means price competition has started' },
    { l: 'Dividend covered by free cash flow', c: 'divCover', t: 'payout below 80% of free cash flow', ok: v => v <= 80 }],
  ignore: ['Revenue growth', 'Price / book', 'ROIC as a screen'] },

{ m: /Utilities/, name: 'Utilities',
  decides: 'The allowed return and the rate base it applies to. A regulated utility grows earnings by investing capital the regulator lets it earn on.',
  watch: [
    { l: 'Rate base growth', f: 'regulatory filings and investor presentation', t: 'this is the earnings growth rate' },
    { l: 'Allowed return on equity', f: 'rate case decisions', t: 'set by the regulator, not the market' },
    { l: 'Net debt / EBITDA', k: 'debitda', t: 'up to 5x is normal for regulated utilities', ok: v => v <= 5.5 },
    { l: 'Dividend cover and credit rating', k: 'payout', t: 'a downgrade raises the cost of the whole model' },
    { l: 'Capex funding plan', f: 'financing section', t: 'equity issuance dilutes the per-share growth' }],
  ignore: ['Free cash flow (negative by design while investing)', 'P/E vs the market'] },

{ m: /Lodging|Gambling|Travel|Hotel/, name: 'Hotels, gaming and travel',
  decides: 'The occupancy and rate cycle against a fixed asset base, and when the next capex cycle lands.',
  watch: [
    { l: 'RevPAR or gaming volume', f: 'quarterly operating statistics', t: 'rate and occupancy separately, not blended' },
    { l: 'EBITDA margin', k: 'ebitdam', t: 'high operating leverage — small revenue moves swing it hard' },
    { l: 'Net debt', k: 'netcash', t: 'the thing that kills hotel owners in a downturn' },
    { l: 'Capex cycle and refurbishment', f: 'capital commitments note', t: 'properties need reinvestment every decade' },
    { l: 'Licence or concession terms (gaming)', f: 'regulatory disclosure', t: 'the licence is the moat; check its expiry' }],
  ignore: ['P/E on depressed or peak earnings', 'Revenue growth in a recovery year'] },

{ m: /Auto/, name: 'Autos and auto parts',
  decides: 'Units times mix minus incentives, against a fixed cost base that must be funded whether cars sell or not.',
  watch: [
    { l: 'Gross margin excluding regulatory credits', f: 'income statement detail', t: 'credits are not a business' },
    { l: 'Unit deliveries and average selling price', f: 'quarterly production report', t: 'price cuts to defend volume show up here' },
    { l: 'Inventory days (company, not dealer)', fill: 'invDays', u: 'days', f: 'earnings call for dealer days on hand', t: 'rising days precedes discounting' },
    { l: 'Capex and R&D commitment', c: 'capexPct', t: 'non-negotiable, and it does not stop in a downturn' },
    { l: 'Net cash', k: 'netcash', t: 'autos need a cash buffer to survive a cycle' }],
  ignore: ['P/E on peak-cycle earnings'] },

{ m: /Internet Retail|Internet Content|Advertising|Entertainment/, p: 40, name: 'Internet platforms and media',
  decides: 'Users times monetisation per user, and whether the capital now going into data centres ever earns a return.',
  watch: [
    { l: 'Revenue growth, 5-year', c: 'rev5', t: 'above 10% to support a platform multiple', ok: v => v >= 10 },
    { l: 'Segment operating margin', f: 'segment note', t: 'consolidated margin hides a profitable core funding losses' },
    { l: 'Capex vs operating cash flow', c: 'capexPct', t: 'the AI build-out is the current swing factor' },
    { l: 'Users and revenue per user', f: 'quarterly metrics', t: 'growing users on falling revenue per user is not growth' },
    { l: 'ROIC', k: 'roic', t: 'above 15%', ok: v => v >= 15 }],
  ignore: ['Consolidated gross margin (it mixes unrelated businesses)', 'Price / book'] },
];

window.RULEBOOK_DEFAULT = { name: 'General business',
  decides: 'Whether reinvested capital earns more than it costs, and whether reported profit turns into cash.',
  watch: [
    { l: 'ROIC vs cost of capital', c: 'spread', t: 'positive, and ideally 3 points or more', ok: v => v >= 3 },
    { l: 'Free cash flow', k: 'fcf', t: 'positive and tracking net income over five years' },
    { l: 'Operating margin trend', k: 'om', t: 'flat or rising over five years' },
    { l: 'Debt / EBITDA', k: 'debitda', t: 'below 2.5x', ok: v => v <= 2.5 },
    { l: 'Interest coverage', k: 'icov', t: 'above 5x', ok: v => v >= 5 },
    { l: 'Share count change', k: 'shchg', t: 'flat or falling', ok: v => v <= 0 }],
  ignore: [] };

/* A few companies the industry label misclassifies: a shipyard filed under oil services,
   pawnbrokers filed under luxury goods. */
window.RULEBOOK_BY_TICKER = {
  '5E2': 'Industrials and machinery',
  'T6I': 'Consumer lenders and pawnbrokers',
  '5UF': 'Consumer lenders and pawnbrokers',
  '5WJ': 'Consumer lenders and pawnbrokers'
};

var _ordered = null;
window.rulebookFor = function (c) {
  if (!_ordered) {
    _ordered = window.RULEBOOKS.slice().sort(function (a, b) { return (a.p || 50) - (b.p || 50); });
  }
  var named = window.RULEBOOK_BY_TICKER[c.t];
  if (named) {
    for (var j = 0; j < _ordered.length; j++) if (_ordered[j].name === named) return _ordered[j];
  }
  var hay = (c.indu || '') + ' ' + (c.sec || '');
  for (var i = 0; i < _ordered.length; i++) {
    if (_ordered[i].m.test(hay)) return _ordered[i];
  }
  return window.RULEBOOK_DEFAULT;
};
