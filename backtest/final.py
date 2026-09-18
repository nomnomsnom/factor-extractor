#!/usr/bin/env python3
"""Corrected run: benchmarks are TOTAL RETURN (SPY / ES3.SI adjusted close),
matching the adjusted-close basis the strategy trades on. Comparing a
dividend-reinvested strategy to a price-only index (^GSPC, ^STI) overstates
alpha by the dividend yield -- 1.78%/yr in the US, 4.03%/yr in Singapore."""
import sys, os, math, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs

px, vol = load()

def block(title, keys, benchtr, top_n, holds, cost_bp, calkey):
    U={t:v for t,v in px.items() if keys(t)}
    V={t:v for t,v in vol.items() if t in U}
    cal=calendar(U, calkey); START,END=cal[260],cal[-1]
    Y=(datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25
    print("\n"+"="*104); print(title); print("%s .. %s  (%.1f years)\n"%(START,END,Y))
    TR=bench_run(U,cal,START,END,bench=benchtr)
    EW=run(U,V,cal,START,END,freq="monthly",top_n=top_n,cost_bp=cost_bp,
           signal="ew_universe",bench=benchtr)
    print("%-36s %8s %8s %7s %9s %9s %6s %6s %8s"
          % ("","CAGR","vol","Sharpe","maxDD","alpha","IR","t","cost/yr"))
    for nm,h,c in (("index, total return (%s)"%benchtr, TR["hist"], None),
                   ("equal-weight the universe", EW["hist"], EW)):
        s=stats(h,Y)
        print("%-36s %7.2f%% %7.2f%% %7.2f %8.2f%% %9s %6s %6s %8s"
              % (nm,s["cagr"]*100,s["vol"]*100,s["sharpe"],s["maxdd"]*100,"-","-","-",
                 "%.2f%%"%(c["cost_per_yr"]*100) if c else "-"))
    for k in holds:
        MO=run(U,V,cal,START,END,freq="monthly",top_n=top_n,hold_k=k,cost_bp=cost_bp,bench=benchtr)
        s=stats(MO["hist"],Y); r=vs(MO["hist"],EW["hist"],Y); t=r["ir"]*math.sqrt(Y)
        print("%-36s %7.2f%% %7.2f%% %7.2f %8.2f%% %8.2f%% %6.2f %6.2f %7.2f%%"
              % ("momentum, top %d"%k, s["cagr"]*100, s["vol"]*100, s["sharpe"],
                 s["maxdd"]*100, r["alpha_ann"]*100, r["ir"], t, MO["cost_per_yr"]*100))
    print("\n  alpha, IR and t are measured against the equal-weight universe, not the")
    print("  index: same names, same survivorship bias, so the gap is the signal's doing.")

block("UNITED STATES  |  100 most-traded of 159 candidates, momentum 12-1, monthly, 2.6bp",
      lambda t: not t.endswith(".SI") and t not in ("%5ESTI",), "SPY", 100, (20,30), 2.6, "SPY")
block("SINGAPORE  |  30 STI names, momentum 12-1, monthly, 11bp",
      lambda t: t.endswith(".SI"), "ES3.SI", 30, (8,10), 11.0, "ES3.SI")
