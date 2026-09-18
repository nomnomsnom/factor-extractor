#!/usr/bin/env python3
import sys, os, math, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs
px,vol=load()
us={t:v for t,v in px.items() if not t.endswith(".SI") and t!="%5ESTI"}
uv={t:v for t,v in vol.items() if t in us}
cal=calendar(us,"SPY"); START,END=cal[260],cal[-1]
Y=(datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25
EW=run(us,uv,cal,START,END,freq="monthly",top_n=100,cost_bp=2.6,signal="ew_universe",bench="SPY")
print("REBALANCE FREQUENCY, measured against the equal-weight universe")
print("US large-cap momentum, top 20 of 100, %.1f years\n"%Y)
for cost,lbl in ((2.6,"US 2.6bp"),(11.0,"SG 11bp")):
    print("  at %s costs:"%lbl)
    print("  %-12s %8s %9s %9s %7s %6s %9s"%("freq","CAGR","alpha","cost/yr","IR","t","turn/yr"))
    for f in ("daily","weekly","monthly","quarterly"):
        M=run(us,uv,cal,START,END,freq=f,top_n=100,hold_k=20,cost_bp=cost,bench="SPY")
        r=vs(M["hist"],EW["hist"],Y)
        print("  %-12s %7.2f%% %8.2f%% %8.2f%% %7.2f %6.2f %8.0f%%"
              %(f,stats(M["hist"],Y)["cagr"]*100,r["alpha_ann"]*100,
                M["cost_per_yr"]*100,r["ir"],r["ir"]*math.sqrt(Y),M["turnover_per_yr"]*100))
    print()
