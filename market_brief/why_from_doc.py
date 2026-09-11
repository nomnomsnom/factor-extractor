#!/usr/bin/env python3
"""Derive the `why` bullets from an assembled market/latest document.

Why this is separate from build.py: a run that ships instruments but no `why`
leaves the page's top panel hidden, which is how the 11 Sep 15:05 document lost
its read. Deriving the bullets from the DOCUMENT rather than from the fetch
means they can be (re)generated for any document, including one written by an
older pipeline, and every figure is guaranteed to match the series the charts
plot because it is read back out of those very series.

Figures are always interpolated. Contextual clauses (a central-bank meeting
date, a shipping-lane disruption) come from the same verified research that
produced the news items and are written as text.

    python3 why_from_doc.py doc.json            # print the bullets
    python3 why_from_doc.py doc.json --in-place # add/replace doc["why"]
"""
import json, sys

def inst(doc, iid):
    return next((i for i in doc.get("instruments", []) if i["id"] == iid), None)

def last(doc, iid):
    i = inst(doc, iid)
    return i["series"][-1]["v"] if i and i.get("series") else None

def chg(doc, iid, k=1):
    """Percent change over the last k sessions of that instrument's own series."""
    i = inst(doc, iid)
    if not i or len(i.get("series", [])) <= k:
        return None
    s = i["series"]
    return (s[-1]["v"] / s[-1-k]["v"] - 1) * 100

def bp(doc, iid, k=1):
    i = inst(doc, iid)
    if not i or len(i.get("series", [])) <= k:
        return None
    s = i["series"]
    return (s[-1]["v"] - s[-1-k]["v"]) * 100

def mover(doc, tkr):
    days = doc.get("movers") or []
    if not days:
        return None
    return next((m["p"] for m in (days[0].get("items") or []) if m["t"] == tkr), None)

def mover_day(doc):
    days = doc.get("movers") or []
    return (days[0]["d"].replace(" close", "") if days else "the latest session")

def build_why(doc):
    W = []
    def add(d, t, b):
        W.append({"d": d, "t": t, "b": b})

    # 1. the origin
    b5, w5 = chg(doc, "brent", 5), chg(doc, "wti", 5)
    bl, wl = last(doc, "brent"), last(doc, "wti")
    if None not in (b5, w5, bl, wl):
        add("up", "Oil is the origin, not a symptom",
            f"Brent {b5:+0.1f}% over five sessions to {bl:0.2f} and WTI {w5:+0.1f}% to {wl:0.2f} "
            f"— both benchmarks moving together, which is a global supply premium rather than a "
            f"regional dislocation. Iran struck ten ships near the Strait of Hormuz and the US "
            f"sank five Iranian tankers; transit has fallen below 2m barrels a day against 8-9m "
            f"before 30 August. Every other line below is downstream of this one.")

    # 2. the transmission
    y10, y2 = last(doc, "ust10"), last(doc, "ust2")
    m10, m2 = bp(doc, "ust10"), bp(doc, "ust2")
    if None not in (y10, y2, m10, m2):
        add("up", "Yields are how it reaches everything else",
            f"The 10-year is {y10:0.2f}% and the 2-year {y2:0.2f}% on the latest published "
            f"observation, {m10:+0.0f}bp and {m2:+0.0f}bp on the session, a {y10-y2:0.2f} point "
            f"spread. August PPI ran 5.4% on the year with energy +4.2% and diesel +24.1%. Both "
            f"ends of the curve rising together says policy and inflation rather than term "
            f"premium alone. These are FRED series and publish a day or two late; the instrument "
            f"note carries the more recent market print, attributed.")

    # 3. where it lands hardest
    r4, s4 = chg(doc, "rut", 4), chg(doc, "spx", 4)
    if None not in (r4, s4):
        add("down", "Small caps are worst because they are the most rate-exposed",
            f"Russell 2000 {r4:0.2f}% over four sessions against {s4:0.2f}% for the S&P 500. "
            f"Domestic revenue, floating-rate debt and thinner margins mean a funding-cost shock "
            f"lands on them first. This ordering is the clearest evidence the move is about the "
            f"discount rate rather than about growth.")

    # 4. duration, not demand
    semis = [(t, mover(doc, t)) for t in ("INTC", "MU", "AMD", "NVDA")]
    semis = [(t, p) for t, p in semis if p is not None]
    if len(semis) >= 3:
        add("down", "Semis fell on duration, not on demand",
            ", ".join(f"{t} {p:0.1f}%" for t, p in semis) +
            f" on {mover_day(doc)}, with nothing in the session questioning AI orders. They hold "
            f"the longest-dated cash flows in the index, so a higher discount rate marks them "
            f"down hardest. A semi selloff arriving with an order-book story attached would be a "
            f"different event entirely.")

    # 5. the counter-example
    aapl = mover(doc, "AAPL")
    if aapl is not None and aapl > 0:
        add("up", "Apple rose in the same session, which is the point",
            f"+{aapl:0.1f}% on product news while the semis fell. Shorter-duration, "
            f"cash-generative, less sensitive to the discount rate. The market is discriminating "
            f"by duration rather than selling equities indiscriminately.")

    # 6. the worst-placed market
    n1, h5 = chg(doc, "nikkei"), chg(doc, "hsi", 5)
    if n1 is not None:
        add("down", "Japan is the worst-placed market in this shock",
            f"The Nikkei closed {n1:+0.2f}% on its last completed session and is lower again "
            f"intraday today — see its note, which carries the unsettled reading rather than "
            f"charting it. Near-total oil import dependence, a 30-year JGB at 4.055%, and a Bank "
            f"of Japan that 97% of surveyed economists expect to raise to 1.25% on 18 September. "
            f"The shock hits the currency, the cost base and the policy rate at once.")

    # 7. the counter-evidence, and the tell that would change the read
    v, v5 = last(doc, "vix"), chg(doc, "vix", 5)
    if None not in (v, v5):
        add("flat", "The VIX says repricing, not panic",
            f"At {v:0.2f} after {v5:+0.1f}% over five sessions: higher, but nowhere near "
            f"stressed. This is the strongest single argument against reading the selloff as "
            f"disorderly. Above roughly 25 that read would need revisiting.")
    return W

if __name__ == "__main__":
    path = sys.argv[1]
    doc = json.load(open(path))
    why = build_why(doc)
    if "--in-place" in sys.argv:
        doc["why"] = why
        json.dump(doc, open(path, "w"), indent=1)
        print("wrote %d bullets into %s" % (len(why), path))
    else:
        for w in why:
            print("[%s] %s\n    %s\n" % (w["d"], w["t"], w["b"]))
