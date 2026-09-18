#!/usr/bin/env python3
import sys, os, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs

px, vol = load()
us = {t:v for t,v in px.items() if not t.endswith(".SI") and t!="%5ESTI"}
uv = {t:v for t,v in vol.items() if t in us}
cal = calendar(us, "%5EGSPC")
START, END = cal[260], cal[-1]
YRS = (datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25

B  = bench_run(us, cal, START, END)
EW = run(us, uv, cal, START, END, freq="monthly", top_n=100, cost_bp=2.6,
         signal="ew_universe")
MO = run(us, uv, cal, START, END, freq="monthly", top_n=100, hold_k=20, cost_bp=2.6)

sb, se, sm = stats(B["hist"],YRS), stats(EW["hist"],YRS), stats(MO["hist"],YRS)
print("DECOMPOSING THE 'ALPHA'\n")
print("%-46s %9s %9s" % ("", "CAGR", "Sharpe"))
print("%-46s %8.2f%% %9.2f" % ("1. S&P 500", sb["cagr"]*100, sb["sharpe"]))
print("%-46s %8.2f%% %9.2f" % ("2. equal-weight MY universe (same 100 names)",
                                se["cagr"]*100, se["sharpe"]))
print("%-46s %8.2f%% %9.2f" % ("3. momentum, top 20 of that universe",
                                sm["cagr"]*100, sm["sharpe"]))
print()
print("  survivorship / selection bias  (2 - 1) = %+6.2f%% a year" % ((se["cagr"]-sb["cagr"])*100))
print("  what the momentum signal adds  (3 - 2) = %+6.2f%% a year" % ((sm["cagr"]-se["cagr"])*100))
print("  headline 'alpha' vs the index  (3 - 1) = %+6.2f%% a year" % ((sm["cagr"]-sb["cagr"])*100))
print()
r = vs(MO["hist"], EW["hist"], YRS)
print("  momentum vs its OWN universe: alpha %+0.2f%%/yr, tracking error %0.2f%%, IR %0.2f"
      % (r["alpha_ann"]*100, r["te"]*100, r["ir"]))
r2 = vs(MO["hist"], B["hist"], YRS)
print("  momentum vs the S&P 500     : alpha %+0.2f%%/yr, tracking error %0.2f%%, IR %0.2f"
      % (r2["alpha_ann"]*100, r2["te"]*100, r2["ir"]))
