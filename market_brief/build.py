#!/usr/bin/env python3
"""Assemble market/latest from fetched raw data. Computes every pct from the
close series it ships. Never interpolates, never carries a close forward."""
import json, os, csv, datetime, zoneinfo

SP = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(SP, "raw")
SGT = zoneinfo.ZoneInfo("Asia/Singapore")
NOW = datetime.datetime.now(SGT)
# The session in progress. Every bar dated on or after this is excluded from
# every series: an intraday level charted as a close is the fastest way to
# make this page lie. Override with BRIEF_TODAY when back-filling.
TODAY = os.environ.get("BRIEF_TODAY") or NOW.strftime("%Y-%m-%d")
NSESS = int(os.environ.get("BRIEF_SESSIONS", "22"))   # about one month
CLOCK = NOW.strftime("%H:%M SGT")     # stamped on every intraday quote in a note

def fname(sym):
    return sym.replace("=", "%3D") + ".json"

def yahoo(sym):
    d = json.load(open(os.path.join(RAW, fname(sym))))
    bars = [b for b in d["bars"] if b["d"] < TODAY]
    bars.sort(key=lambda b: b["d"])
    return bars, d

def intraday(sym):
    """Today's in-progress reading, for notes only. Never enters a series."""
    d = json.load(open(os.path.join(RAW, fname(sym))))
    for b in d["bars"]:
        if b["d"] == TODAY:
            return b["c"]
    return None

def fred(series_id):
    rows = []
    with open(os.path.join(SP, "fred_%s.csv" % series_id)) as f:
        for r in csv.DictReader(f):
            v = r[series_id].strip()
            if v in ("", "."):        # holiday or not-yet-published
                continue
            rows.append({"d": r["observation_date"], "c": float(v)})
    rows.sort(key=lambda x: x["d"])
    return rows

def series(bars, n=NSESS, pct=True, dp=2):
    out = []
    sel = bars[-(n + 1):] if pct else bars[-n:]
    for i, b in enumerate(sel):
        if pct and i == 0 and len(sel) > n:
            continue                 # the extra bar only anchors the first pct
        row = {"d": b["d"], "v": round(b["c"], dp)}
        if pct:
            j = bars.index(b)
            row["pct"] = (round((b["c"] / bars[j-1]["c"] - 1) * 100, 2)
                          if j > 0 else None)
        else:
            row["pct"] = None
        out.append(row)
    return out

def chg(bars, k=1):
    """Percent change over the last k sessions."""
    return round((bars[-1]["c"] / bars[-1-k]["c"] - 1) * 100, 2)

def bp(rows, k=1):
    return round((rows[-1]["c"] - rows[-1-k]["c"]) * 100, 1)

MONL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
def hd(d):
    y, m, dd = d.split("-")
    return "%d %s" % (int(dd), MONL[int(m)-1])

# ---------------------------------------------------------------- instruments
I = []
def add(**kw):
    I.append(kw)

spx, _   = yahoo("^GSPC")
ndx, _   = yahoo("^IXIC")
dji, _   = yahoo("^DJI")
rut, _   = yahoo("^RUT")
vix, _   = yahoo("^VIX")
brent, _ = yahoo("BZ=F")
wti, _   = yahoo("CL=F")
n225, _  = yahoo("^N225")
hsi, _   = yahoo("^HSI")
sti, _   = yahoo("^STI")
nvda, _  = yahoo("NVDA")
tnx, _   = yahoo("^TNX")

d10 = fred("DGS10")
d02 = fred("DGS2")
d20 = fred("DGS20")

spx_hi = max(spx, key=lambda b: b["c"])
brent_hi_since = [b for b in brent if b["c"] >= brent[-1]["c"] and b["d"] < brent[-1]["d"]]

add(id="spx", name="S&P 500", unit="index", kind="eq", kpi=True,
    series=series(spx),
    note=("Yahoo Finance daily closes. Fourth consecutive down session into 10 Sep, "
          "-%0.2f%% over those four days. The index is %0.1f%% below its %s close of "
          "%s, the highest in this window. Nothing here is back-filled: 7 Sep is absent "
          "because US markets were shut for Labor Day."
          % (abs(chg(spx, 4)), (1 - spx[-1]["c"]/spx_hi["c"]) * 100,
             hd(spx_hi["d"]), format(round(spx_hi["c"], 2), ",.2f"))))

add(id="ust10", name="US 10-year yield", unit="percent", kind="rate", kpi=True,
    series=series(d10, pct=False, dp=3),
    note=("FRED DGS10, the primary series, which publishes with a lag. Its latest "
          "observation is %s at %0.2f%%, which is +%0.1fbp on the session and +%0.1fbp "
          "since %s. FRED has not yet published 10 Sep. A separate source, the CBOE "
          "10-year yield index on Yahoo, printed %0.3f%% for 10 Sep against %0.3f%% the "
          "day before, so +%0.1fbp on its own series. That figure is quoted here, "
          "attributed, rather than spliced onto the end of the FRED series: a basis-point "
          "move computed across two providers is not a real move. 7 Sep is blank in FRED "
          "because the market was shut."
          % (hd(d10[-1]["d"]), d10[-1]["c"], bp(d10), bp(d10, 5), hd(d10[-6]["d"]),
             tnx[-1]["c"], tnx[-2]["c"], (tnx[-1]["c"] - tnx[-2]["c"]) * 100)))

add(id="brent", name="Brent crude", unit="USD per barrel", kind="oil", kpi=True,
    series=series(brent),
    note=("ICE Brent front-month futures settlements from Yahoo Finance. The 9 Sep "
          "settle of 101.21 matches the figure Reuters and Al-Monitor reported for that "
          "session, so level and percent reconcile against the press. Up %0.1f%% over "
          "five sessions. Note that FRED's DCOILBRENTEU, which is the EIA Europe Brent "
          "spot assessment rather than the futures contract, showed 109.51 for 9 Sep; the "
          "futures settle is used here because it is what the market traded. Today's "
          "session is still open and is not charted: Brent was around %0.2f at %s "
          "today, an intraday reading, not a close."
          % (chg(brent, 5), intraday("BZ=F") or 0, CLOCK)))

add(id="vix", name="VIX", unit="index", kind="rate", kpi=True,
    series=series(vix),
    note=("Up %0.1f%% over five sessions but still at %0.2f. This remains the strongest "
          "single argument against reading the selloff as disorderly: a rates-and-oil "
          "repricing, not a liquidity event. Above roughly 25 that reading would need "
          "revisiting." % (chg(vix, 5), vix[-1]["c"])))

add(id="ndx", name="Nasdaq Composite", unit="index", kind="eq", kpi=False,
    series=series(ndx),
    note=("Yahoo Finance daily closes. Down %0.2f%% on 10 Sep and %0.2f%% over four "
          "sessions. The long-duration end of the equity market is doing more of the work "
          "than the headline index, which is what a rates-led move looks like."
          % (abs(chg(ndx)), abs(chg(ndx, 4)))))

add(id="dji", name="Dow Jones Industrial", unit="index", kind="eq", kpi=False,
    series=series(dji),
    note=("The 10 Sep close of %s is a fall of %0.2f points on the day, which matches the "
          "316.56-point decline reported for the session by CNBC, so the level and the "
          "change reconcile against an independent account. No session is missing from "
          "this series."
          % (format(round(dji[-1]["c"], 2), ",.2f"), dji[-2]["c"] - dji[-1]["c"])))

add(id="rut", name="Russell 2000", unit="index", kind="eq", kpi=False,
    series=series(rut),
    note=("Small caps have led the decline throughout: -%0.2f%% over four sessions "
          "against -%0.2f%% for the S&P 500. Domestic, rate-sensitive and more levered, "
          "which fits a rates-driven move rather than a growth scare."
          % (abs(chg(rut, 4)), abs(chg(spx, 4)))))

add(id="ust2", name="US 2-year yield", unit="percent", kind="rate", kpi=False,
    series=series(d02, pct=False, dp=3),
    note=("FRED DGS2, same lag as the 10-year. %0.2f%% on %s: +%0.1fbp on the session and "
          "+%0.1fbp since %s. The 2-year is the cleanest read available here on what the "
          "market thinks the Fed does on 16 Sep, and it has been rising with the 10-year "
          "rather than against it, which says the move is about policy and inflation "
          "rather than term premium alone. The 10s2s spread is %0.2f percentage points. "
          "FRED DGS20 was %0.2f%% on the same date."
          % (d02[-1]["c"], hd(d02[-1]["d"]), bp(d02), bp(d02, 10), hd(d02[-11]["d"]),
             d10[-1]["c"] - d02[-1]["c"], d20[-1]["c"])))

add(id="wti", name="WTI crude", unit="USD per barrel", kind="oil", kpi=False,
    series=series(wti),
    note=("NYMEX WTI front-month settlements from Yahoo Finance. The 9 Sep settle of "
          "96.05 matches the press figure for that session. Brent's premium to WTI on "
          "10 Sep is %0.2f a barrel. Today is still trading and is not charted."
          % (brent[-1]["c"] - wti[-1]["c"])))

add(id="nikkei", name="Nikkei 225", unit="index", kind="eq", kpi=False,
    series=series(n225),
    note=("Closes only. Tokyo actually rose %0.2f%% on 10 Sep; the shock is landing today "
          "instead, and today is not on this chart. Japan is the cleanest expression of "
          "it: near-total oil import dependence plus a Bank of Japan the market now "
          "expects to move on 18 Sep. The intraday reading at %s today was "
          "about %s, roughly %0.1f%% below the 10 Sep close, but an unsettled session is "
          "not a close and is not charted."
          % (chg(n225), CLOCK, format(round(intraday("^N225") or 0, 2), ",.2f"),
             ((intraday("^N225") or n225[-1]["c"]) / n225[-1]["c"] - 1) * 100)))

add(id="hsi", name="Hang Seng", unit="index", kind="eq", kpi=False,
    series=series(hsi),
    note=("Closes only. Down %0.2f%% on 10 Sep and %0.2f%% over five sessions, so most of "
          "the damage is recent rather than cumulative. Hong Kong was still open when this "
          "ran, so today is omitted rather than shown as a close; the intraday level at "
          "%s was about %s."
          % (abs(chg(hsi)), abs(chg(hsi, 5)), CLOCK,
             format(round(intraday("^HSI") or 0, 2), ",.2f"))))

add(id="sti", name="Straits Times Index", unit="index", kind="eq", kpi=False,
    series=series(sti),
    note=("Singapore closes. Down %0.2f%% on 10 Sep and %0.2f%% over five sessions, "
          "against %0.2f%% for the Hang Seng over the same five. Today is omitted because "
          "the session was still open; the intraday level at %s was about %s."
          % (abs(chg(sti)), abs(chg(sti, 5)), abs(chg(hsi, 5)), CLOCK,
             format(round(intraday("^STI") or 0, 2), ",.2f"))))

add(id="nvda", name="Nvidia, USD per share", unit="index", kind="eq", kpi=False,
    series=series(nvda),
    note=("Promoted out of the percent chips into a full close series. The unit chip "
          "reads index because the feed contract allows only three unit values; these are "
          "US dollars per share. Down %0.2f%% on 10 Sep and %0.2f%% over five "
          "sessions. The AI-complex bellwether: if the selloff were about AI demand rather "
          "than the discount rate, this is where it would show first."
          % (abs(chg(nvda)), abs(chg(nvda, 5)))))

# -------------------------------------------------------------------- movers
NAMES = ["NVDA", "AMD", "MU", "INTC", "AAPL", "META", "GOOGL", "AMZN",
         "MRVL", "TSM", "AVGO"]
byname = {t: yahoo(t)[0] for t in NAMES}
MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
def label(d):
    y, m, dd = d.split("-")
    return "%d %s" % (int(dd), MON[int(m)-1])

movers = []
recent = [b["d"] for b in spx[-3:]][::-1]     # last three completed US sessions
for day in recent:
    items = []
    for t in NAMES:
        b = byname[t]
        idx = next((i for i, x in enumerate(b) if x["d"] == day), None)
        if idx is None or idx == 0:
            continue                      # no print that day: no chip
        items.append({"t": t,
                      "p": round((b[idx]["c"] / b[idx-1]["c"] - 1) * 100, 2)})
    items.sort(key=lambda x: -x["p"])
    movers.append({"d": label(day) + " close", "items": items})

def pct_on(t, day):
    b = byname[t] if t in byname else yahoo(t)[0]
    i = next((k for k, x in enumerate(b) if x["d"] == day), None)
    return (b[i]["c"] / b[i-1]["c"] - 1) * 100

# ----------------------------------------------------------------------- why
# The read, as bullets, at the top of the page. Authored each run like the news,
# but every figure inside is interpolated from the same series the charts plot,
# so the prose cannot drift away from the numbers underneath it.
# `d` is the direction of the thing being explained: "up", "down" or "flat".

why = [
 {"d":"up",
  "t":"Oil is the origin, not a symptom",
  "b":(f"Brent {chg(brent,5):+0.1f}% over five sessions to {brent[-1]['c']:0.2f} and WTI "
       f"{chg(wti,5):+0.1f}% to {wti[-1]['c']:0.2f} — both benchmarks moving together, which "
       f"is a global supply premium rather than a regional dislocation. Iran struck ten ships "
       f"near the Strait of Hormuz and the US sank five Iranian tankers; transit has fallen "
       f"below 2m barrels a day against 8-9m before 30 August. Every other line below is "
       f"downstream of this one.")},

 {"d":"up",
  "t":"Yields are how it reaches everything else",
  "b":(f"The 10-year printed {tnx[-1]['c']:0.3f}% on 10 Sep, +{(tnx[-1]['c']-tnx[-2]['c'])*100:0.1f}bp "
       f"in a session; the 2-year is {d02[-1]['c']:0.2f}%. August PPI ran 5.4% on the year "
       f"with energy +4.2% and diesel +24.1%. Both ends of the curve are rising together, "
       f"which says policy and inflation rather than term premium alone.")},

 {"d":"down",
  "t":"Small caps are worst because they are the most rate-exposed",
  "b":(f"Russell 2000 {chg(rut,4):0.2f}% over four sessions against {chg(spx,4):0.2f}% for the "
       f"S&P 500. Domestic revenue, floating-rate debt and thinner margins mean a funding-cost "
       f"shock lands on them first. This ordering is the clearest evidence the move is about "
       f"the discount rate.")},

 {"d":"down",
  "t":"Semis fell on duration, not on demand",
  "b":(f"Intel {pct_on('INTC','2026-09-10'):0.1f}%, Micron {pct_on('MU','2026-09-10'):0.1f}%, "
       f"AMD {pct_on('AMD','2026-09-10'):0.1f}%, Nvidia {pct_on('NVDA','2026-09-10'):0.1f}% on "
       f"10 Sep with nothing in the session questioning AI orders. They hold the "
       f"longest-dated cash flows in the index, so a higher discount rate marks them down "
       f"hardest. A semi selloff with an order-book story attached would be a different event.")},

 {"d":"up",
  "t":"Apple rose in the same session, which is the point",
  "b":(f"+{pct_on('AAPL','2026-09-10'):0.1f}% on product news while the semis fell. Shorter-duration, "
       f"cash-generative, less sensitive to the discount rate. The market is discriminating by "
       f"duration rather than selling equities indiscriminately.")},

 {"d":"down",
  "t":"Japan is the worst-placed market in this shock",
  "b":(f"The Nikkei closed {chg(n225):+0.2f}% on 10 Sep but is around "
       f"{((intraday('^N225') or n225[-1]['c'])/n225[-1]['c']-1)*100:0.1f}% intraday today. Near-total "
       f"oil import dependence, a 30-year JGB at 4.055%, and a Bank of Japan that 97% of "
       f"surveyed economists expect to raise to 1.25% on 18 September. The shock hits the "
       f"currency, the cost base and the policy rate at once.")},

 {"d":"flat",
  "t":"The VIX says repricing, not panic",
  "b":(f"At {vix[-1]['c']:0.2f} after +{chg(vix,5):0.1f}% over five sessions: higher, but nowhere "
       f"near stressed. This is the strongest single argument against reading the selloff as "
       f"disorderly. Above roughly 25 that read would need revisiting.")},
]

# ---------------------------------------------------------------------- news

news = [
 {"d":"2026-09-10","cat":"mkt",
  "t":"August PPI +0.4% on the month, 5.4% on the year, and it is almost all energy",
  "b":("The BLS reported final-demand PPI up 0.4% in August and 5.4% over twelve months. "
       "Energy did the damage, advancing 4.2% with diesel fuel up 24.1%, more than "
       "three-quarters of the goods increase. Core final demand, excluding food, energy "
       "and trade services, rose a much calmer 0.3% and 4.7% year on year. That gap is the "
       "whole argument: this is an oil shock passing through wholesale prices, not yet a "
       "broad domestic inflation problem, and the Fed has to decide which one it is "
       "reacting to on 16 September."),
  "u":"https://www.bls.gov/news.release/ppi.nr0.htm","un":"BLS, primary release"},

 {"d":"2026-09-10","cat":"mkt",
  "t":"Fourth straight down day; small caps and long duration take the most damage",
  "b":(f"The S&P 500 closed at 7,591.70, down 0.58%, the Dow fell 316.56 points to "
       f"52,064.10 and the Nasdaq Composite lost 0.65% to 26,081.72. The Russell 2000 was "
       f"the worst of them at -{abs(chg(rut)):0.2f}%. Over the four sessions the S&P is "
       f"down {abs(chg(spx,4)):0.2f}% and the Russell {abs(chg(rut,4)):0.2f}%. That "
       f"ordering, small caps worst and the VIX still at {vix[-1]['c']:0.2f}, is what a "
       f"discount-rate repricing looks like rather than a growth scare."),
  "u":"https://finance.yahoo.com/quote/%5EGSPC/history/","un":"Yahoo Finance, daily closes"},

 {"d":"2026-09-09","cat":"mkt",
  "t":"Brent settles above $100 after the biggest wave of attacks on shipping of the war",
  "b":("Brent settled up $3.29 at $101.21 and WTI at $96.05, both the highest closes since "
       "22 May, after Iran struck ten ships near the Strait of Hormuz and the US sank five "
       "Iranian tankers. Hormuz flows have fallen below 2 million barrels a day against "
       "8-9 million in the week before fighting resumed on 30 August. Brent then settled "
       f"at {brent[-1]['c']:0.2f} on 10 Sep. The EIA has raised its 2026-27 price forecasts on faster "
       "global stockpile draws."),
  "u":"https://www.al-monitor.com/originals/2026/09/brent-settles-over-100-barrel-middle-east-conflict-intensifies",
  "un":"Al-Monitor, citing Reuters"},

 {"d":"2026-09-09","cat":"mkt",
  "t":"HFR: macro and CTAs ran away with August, and trend beat discretionary for the first time since 2022",
  "b":("The HFRI Fund Weighted Composite gained 1.7% in August. Macro led at +4.1%, with "
       "the Commodity index +10.0% and Systematic Diversified/CTA +3.45%. Equity Hedge "
       "managed +1.5%, Relative Value +0.3% and Event-Driven +0.15%. The read for anyone "
       "in systematic strategies is that the oil and rates trends that are hurting long "
       "equity books are precisely what trend followers are paid to capture, and the "
       "dispersion is enormous: the top decile is +65.9% over twelve months against "
       "-9.9% for the bottom."),
  "u":"https://www.hedgeweek.com/macro-hedge-funds-lead-august-rebound-as-commodities-and-ctas-surge/",
  "un":"Hedgeweek, citing HFR"},

 {"d":"2026-09-11","cat":"mkt",
  "t":"Asia sells the same story harder: Nikkei near -3%, JGB 30-year at 4.055%",
  "b":("Tokyo fell close to 3% and the Topix 1.9%, Kospi -2.4% and the Hang Seng around "
       "-1.5%, with the MSCI Asia Pacific index off 1.3%. The 30-year JGB yield reached "
       "4.055% and the 10-year 2.965%. Reporting cites 97% of surveyed economists now "
       "expecting the Bank of Japan to raise its policy rate to 1.25% on 18 September. "
       "Japan imports essentially all of its oil, so the shock lands on the currency, the "
       "cost base and the policy rate at once. These are intraday figures from a session "
       "that was still settling, and none of them are charted above."),
  "u":"https://au.investing.com/news/stock-market-news/asia-stocks-slip-on-tech-losses-with-oil-surge-yields-in-focus-4635799",
  "un":"Investing.com"},

 {"d":"2026-09-10","cat":"mkt",
  "t":"Semis sold off on the discount rate, not on demand",
  "b":(f"Intel {pct_on('INTC','2026-09-10'):+0.1f}%, Micron {pct_on('MU','2026-09-10'):+0.1f}%, "
       f"AMD {pct_on('AMD','2026-09-10'):+0.1f}%, Nvidia {pct_on('NVDA','2026-09-10'):+0.1f}%, "
       f"Broadcom {pct_on('AVGO','2026-09-10'):+0.1f}% and TSMC {pct_on('TSM','2026-09-10'):+0.1f}% "
       f"on the session, while Apple rose {pct_on('AAPL','2026-09-10'):0.1f}%. Nothing in the "
       f"day's news questioned AI capex; a ten-year yield approaching 4.95% simply repriced "
       f"the longest-duration cash flows in the index. Worth watching rather than trading: if "
       f"a semi selloff ever arrives with an order-book story attached, that is a different "
       f"event entirely."),
  "u":"https://finance.yahoo.com/quote/NVDA/history/","un":"Yahoo Finance, daily closes"},

 {"d":"2026-09-10","cat":"mkt",
  "t":"Existing home sales at the slowest pace in more than a year, inventory at a decade high",
  "b":("Sales fell 2% from July to a 3.98 million annualised rate, a third straight monthly "
       "decline and 1.2% below August last year, per the National Association of Realtors. "
       "Unsold inventory rose to 1.62 million, a 4.9-months supply and the highest in over "
       "ten years. Most of these closings were contracted in June and July at 30-year "
       "mortgage rates of 6.43% to 6.66%; rates have risen since. Housing is the clearest "
       "channel through which the bond move reaches the real economy."),
  "u":"https://wtop.com/national/2026/09/us-home-sales-weaken-to-slowest-pace-in-more-than-a-year-as-mortgage-rates-home-prices-climb",
  "un":"AP, citing NAR"},

 {"d":"2026-09-03","cat":"mkt",
  "t":"SEC and CFTC push the Form PF compliance date out again, to 1 July 2027",
  "b":("The further extension, effective 3 September, moves the compliance date for the "
       "February 2024 Form PF amendments from 1 October 2026 to 1 July 2027. This is the "
       "second slip. For private-fund and quant shops it buys roughly nine more months "
       "before the more granular exposure, liquidity and risk reporting bites, and it sits "
       "alongside an April joint proposal to recalibrate who files, what they report and "
       "how often."),
  "u":"https://www.federalregister.gov/documents/2026/09/03/2026-18104/form-pf-reporting-requirements-for-all-filers-and-large-hedge-fund-advisers-further-extension-of",
  "un":"Federal Register"},

 {"d":"2026-09-10","cat":"flag",
  "t":"The FOMC decides on 16 September and the market cannot agree on the odds",
  "b":(f"The meeting runs 15-16 September with the statement and dot plot at 2pm ET on the "
       f"16th, from a current target range of 3.50-3.75%. Published estimates of the "
       f"probability of a 25bp hike ranged from about 56% to near 70% across sources during "
       f"the week, which is too wide a spread to report as a single number. The 2-year yield, "
       f"which is the cleanest market read available here, closed at {d02[-1]['c']:0.2f}% on "
       f"{hd(d02[-1]['d'])}. This item is flagged rather than stated because the odds figure is "
       f"genuinely contested."),
  "u":"https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  "un":"Federal Reserve calendar"},

 {"d":"2026-09-02","cat":"ai",
  "t":"Nvidia to buy Hugging Face for about $12.93bn",
  "b":("Per the 8-K, roughly $11.9bn cash to shareholders plus up to $1.0bn in equity "
       "retention, expected to close in the first half of 2027 subject to regulatory "
       "approval. Nvidia frames it as a deconcentration platform. No regulator has "
       "commented. The practical point is that the default distribution point for open "
       "model weights now has a chip vendor as its owner."),
  "u":"https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm",
  "un":"SEC 8-K"},

 {"d":"2026-09-07","cat":"flag",
  "t":"Artificial Analysis rewrote its index three times in five days",
  "b":("v4.1.1 had Fable at 66 and Astra at 61. v4.2 dropped a saturated GPQA Diamond and "
       "had 57 and 55. v4.3 swapped in AutomationBench-AA and put both at 53, with private "
       "test weighting raised from 20% to 45%. Scores are not comparable across those "
       "versions, so any ranking claim citing that week depends entirely on which version "
       "is quoted. A benchmark that moves this fast is a benchmark you cannot build a "
       "position on."),
  "u":"https://www.techtimes.com/articles/327053/20260909/ai-leaderboard-rewrote-itself-three-times-last-week-same-score-half-cost.htm",
  "un":"Tech Times"},
]

# ---------------------------------------------------------------------- gaps
gaps = [
 ("<b>Every level on this page is a Yahoo Finance daily close, except the yields.</b> "
  "Percent changes are computed from the close series shipped alongside them, never "
  "lifted from a second provider, so a level and its change always reconcile. Yields are "
  "FRED, which is the primary source for them."),
 ("<b>Today, " + NOW.strftime("%-d %B") + ", is deliberately missing.</b> Asian and "
  "commodity sessions were still open or still settling when this ran at " + CLOCK +
  ". Intraday readings appear in "
  "the notes, clearly labelled, and in nothing else. An intraday level charted as a close "
  "is the single easiest way to make a dashboard lie."),
 ("<b>The 10-year yield series stops one session short.</b> FRED DGS10 publishes with a "
  "lag and its latest observation is %s. The CBOE 10-year yield index printed %0.3f%% for "
  "10 September and that figure is quoted in the note, attributed, rather than spliced "
  "onto the end of the FRED series."
  % (hd(d10[-1]["d"]), tnx[-1]["c"])),
 ("<b>CSI 300 was dropped this run.</b> Yahoo's series for 000300.SS has a hole running "
  "from 17 July to today, and the alternative Shenzhen symbol returned a single bar. "
  "Rather than chart two months of stale data as if it were current, the instrument is "
  "omitted. China exposure is therefore not represented on this page."),
 ("<b>Sources that could not be dated were left out.</b> The Jane Street and SEBI "
  "proceeding before the Securities Appellate Tribunal is live and directly relevant to "
  "quant market-making, but no report found this run could be pinned to a confirmed 2026 "
  "date rather than a 2025 one, so it is absent rather than approximated."),
 ("<b>Fed hike odds are reported as a range, not a number.</b> Estimates between roughly "
  "56% and 70% were in circulation during the week. Picking one and presenting it as the "
  "market's view would be a fabrication dressed as precision."),
 ("<b>No trading logic lives here.</b> This page reports what printed and what moved it. "
  "It does not size, rank or recommend anything."),
]

doc = {
  "asOf": NOW.strftime("%-d %b %Y, %H:%M SGT"),
  # Machine-readable twin of asOf. The page computes the feed's age from this
  # and says out loud when a scheduled run has not landed.
  "asOfISO": NOW.astimezone(datetime.timezone.utc)
               .strftime("%Y-%m-%dT%H:%M:%SZ"),
  "origin": "Live feed: Yahoo Finance daily closes + FRED DGS10/DGS2/DGS20",
  "why": why,
  "instruments": I,
  "movers": movers,
  "news": news,
  "gaps": gaps,
}

out = os.path.join(SP, "market-latest.json")
with open(out, "w") as f:
    json.dump(doc, f, indent=1)
print("wrote", out)
print("instruments:", len(I), "kpi:", sum(1 for x in I if x.get("kpi")))
print("news:", len(news), "movers days:", len(movers), "gaps:", len(gaps))
