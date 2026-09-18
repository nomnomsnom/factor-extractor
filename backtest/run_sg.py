#!/usr/bin/env python3
import sys, os, math, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs

px, vol = load()
sg={t:v for t,v in px.items() if t.endswith(".SI") or t=="%5ESTI"}
sv={t:v for t,v in vol.items() if t in sg}
cal=calendar(sg,"%5ESTI"); START,END=cal[260],cal[-1]
Y=(datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25
print("SINGAPORE: %d names with history, %s .. %s\n" % (len(sg)-1, START, END))

B=bench_run(sg,cal,START,END,bench="%5ESTI")
print("%-40s %8s %8s %7s %9s %9s %7s %8s"
      % ("","CAGR","vol","Sharpe","maxDD","vs EW","IR","cost/yr"))
sb=stats(B["hist"],Y)
print("%-40s %7.2f%% %7.2f%% %7.2f %8.2f%% %9s %7s %8s"
      % ("STI index", sb["cagr"]*100, sb["vol"]*100, sb["sharpe"], sb["maxdd"]*100,"-","-","-"))
EW=run(sg,sv,cal,START,END,freq="monthly",top_n=30,cost_bp=11.0,
       signal="ew_universe",bench="%5ESTI")
se=stats(EW["hist"],Y)
print("%-40s %7.2f%% %7.2f%% %7.2f %8.2f%% %9s %7s %7.2f%%"
      % ("equal-weight all 30", se["cagr"]*100, se["vol"]*100, se["sharpe"],
         se["maxdd"]*100,"-","-",EW["cost_per_yr"]*100))
for k in (5,8,10):
    MO=run(sg,sv,cal,START,END,freq="monthly",top_n=30,hold_k=k,cost_bp=11.0,bench="%5ESTI")
    s=stats(MO["hist"],Y); r=vs(MO["hist"],EW["hist"],Y)
    t=r["ir"]*math.sqrt(Y)
    print("%-40s %7.2f%% %7.2f%% %7.2f %8.2f%% %8.2f%% %7.2f %7.2f%%   t=%.2f"
          % ("momentum, top %d of 30"%k, s["cagr"]*100, s["vol"]*100, s["sharpe"],
             s["maxdd"]*100, r["alpha_ann"]*100, r["ir"], MO["cost_per_yr"]*100, t))
print("\n  A 'top 5 of 30' portfolio is five bets, not a factor portfolio.")
