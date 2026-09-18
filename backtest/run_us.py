#!/usr/bin/env python3
import sys, os, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs

SP = os.path.dirname(os.path.abspath(__file__))
px, vol = load()
us = {t: v for t, v in px.items() if not t.endswith(".SI") and t != "%5ESTI"}
uv = {t: v for t, v in vol.items() if t in us}
cal = calendar(us, "%5EGSPC")

# ---- data honesty first -----------------------------------------------------
dead, alive = [], []
for f in glob.glob(os.path.join(SP, "hist", "*.json")):
    d = json.load(open(f))
    t = d["symbol"]
    if t.endswith(".SI") or t.startswith("%5E"): continue
    (alive if d.get("bars") else dead).append(t)
last = cal[-1]
stale = []
for t in alive:
    lastbar = max(px[t]) if px.get(t) else None
    if lastbar and lastbar < cal[-40]:
        stale.append((t, lastbar))

print("DATA COVERAGE")
print("  candidate tickers with history : %d" % len(alive))
print("  candidates Yahoo has NO data for: %d  %s" % (len(dead), sorted(dead)))
print("  names whose data stops early    : %d  %s"
      % (len(stale), sorted(stale)[:12]))
print("  calendar                        : %s .. %s (%d sessions)"
      % (cal[0], cal[-1], len(cal)))

START, END = cal[260], cal[-1]      # need a year of history before the first signal
print("  backtest window                 : %s .. %s\n" % (START, END))

B  = bench_run(us, cal, START, END)
bs = stats(B["hist"], 10.0)

def line(name, r, years):
    s  = stats(r["hist"], years)
    rel = vs(r["hist"], B["hist"], years)
    print("%-30s %8.2f%% %8.2f%% %7.2f %9.2f%% %9.2f%% %8.2f %9.0f%% %8.2f%%"
          % (name, s["cagr"]*100, s["vol"]*100, s["sharpe"], s["maxdd"]*100,
             rel["alpha_ann"]*100, rel["ir"], r["turnover_per_yr"]*100,
             r["cost_per_yr"]*100))

import datetime
YRS = (datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25

print("MOMENTUM (12-1), LONG-ONLY, TOP 20 OF THE 100 MOST-TRADED NAMES")
print("costs: 2.6bp one-way (US large-cap, zero-commission broker)\n")
print("%-30s %8s %8s %7s %9s %9s %8s %9s %8s"
      % ("strategy","CAGR","vol","Sharpe","maxDD","vs bench","IR","turn/yr","cost/yr"))
print("%-30s %8.2f%% %8.2f%% %7.2f %9.2f%% %9s %8s %9s %8s"
      % ("S&P 500 (benchmark)", stats(B["hist"],YRS)["cagr"]*100,
         stats(B["hist"],YRS)["vol"]*100, stats(B["hist"],YRS)["sharpe"],
         stats(B["hist"],YRS)["maxdd"]*100, "-","-","-","-"))

for freq in ("daily","weekly","monthly","quarterly"):
    r = run(us, uv, cal, START, END, freq=freq, top_n=100, hold_k=20, cost_bp=2.6)
    line("momentum, %s" % freq, r, YRS)

print("\nSAME STRATEGY AT SINGAPORE-LEVEL COSTS (11bp one-way)\n")
print("%-30s %8s %8s %7s %9s %9s %8s %9s %8s"
      % ("strategy","CAGR","vol","Sharpe","maxDD","vs bench","IR","turn/yr","cost/yr"))
for freq in ("daily","monthly"):
    r = run(us, uv, cal, START, END, freq=freq, top_n=100, hold_k=20, cost_bp=11.0)
    line("momentum, %s @11bp" % freq, r, YRS)

print("\nZERO-COST COUNTERFACTUAL (what costs are actually taking)\n")
print("%-30s %8s %8s %7s %9s %9s %8s %9s %8s"
      % ("strategy","CAGR","vol","Sharpe","maxDD","vs bench","IR","turn/yr","cost/yr"))
for freq in ("daily","monthly"):
    r = run(us, uv, cal, START, END, freq=freq, top_n=100, hold_k=20, cost_bp=0.0)
    line("momentum, %s @0bp" % freq, r, YRS)
