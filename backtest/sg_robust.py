#!/usr/bin/env python3
import sys, os, math, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs
px,vol=load()
sg={t:v for t,v in px.items() if t.endswith(".SI")}
sv={t:v for t,v in vol.items() if t in sg}
cal=calendar(sg,"ES3.SI"); START,END=cal[260],cal[-1]
Y=(datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25
perf=[]
for t,s in sg.items():
    if t=="ES3.SI": continue
    ks=sorted(s)
    if len(ks)<2000: continue
    perf.append((s[ks[-1]]/s[ks[0]],t))
perf.sort(reverse=True)
print("Singapore decade winners:", ", ".join("%s %.1fx"%(t,m) for m,t in perf[:6]))
print("Names with <2000 bars (listed late, cannot be in an early portfolio):",
      [t for t in sg if t!="ES3.SI" and len(sg[t])<2000])
print()
print("%-34s %8s %8s %8s %6s %6s"%("test","EW univ","momentum","alpha","IR","t"))
def go(label, U):
    V={t:v for t,v in sv.items() if t in U}
    EW=run(U,V,cal,START,END,freq="monthly",top_n=30,cost_bp=11.0,signal="ew_universe",bench="ES3.SI")
    MO=run(U,V,cal,START,END,freq="monthly",top_n=30,hold_k=10,cost_bp=11.0,bench="ES3.SI")
    r=vs(MO["hist"],EW["hist"],Y)
    print("%-34s %7.2f%% %7.2f%% %7.2f%% %6.2f %6.2f"
          %(label,stats(EW["hist"],Y)["cagr"]*100,stats(MO["hist"],Y)["cagr"]*100,
            r["alpha_ann"]*100,r["ir"],r["ir"]*math.sqrt(Y)))
go("all 30 names", sg)
for k in (1,3,5):
    drop={t for _,t in perf[:k]}
    go("drop top %d (%s)"%(k,",".join(sorted(drop))[:18]),
       {t:v for t,v in sg.items() if t not in drop})
MID=cal[len(cal)//2]
for lbl,s,e in (("first half",START,MID),("second half",MID,END)):
    Y2=(datetime.date.fromisoformat(e)-datetime.date.fromisoformat(s)).days/365.25
    V={t:v for t,v in sv.items()}
    EW=run(sg,V,cal,s,e,freq="monthly",top_n=30,cost_bp=11.0,signal="ew_universe",bench="ES3.SI")
    MO=run(sg,V,cal,s,e,freq="monthly",top_n=30,hold_k=10,cost_bp=11.0,bench="ES3.SI")
    r=vs(MO["hist"],EW["hist"],Y2)
    print("%-34s %7.2f%% %7.2f%% %7.2f%% %6.2f %6.2f"
          %(lbl,stats(EW["hist"],Y2)["cagr"]*100,stats(MO["hist"],Y2)["cagr"]*100,
            r["alpha_ann"]*100,r["ir"],r["ir"]*math.sqrt(Y2)))
