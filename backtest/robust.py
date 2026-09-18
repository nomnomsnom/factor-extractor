#!/usr/bin/env python3
import sys, os, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs

px, vol = load()
us = {t:v for t,v in px.items() if not t.endswith(".SI") and t!="%5ESTI"}
uv = {t:v for t,v in vol.items() if t in us}
cal= calendar(us,"%5EGSPC")
START, END = cal[260], cal[-1]
def yrs(a,b): return (datetime.date.fromisoformat(b)-datetime.date.fromisoformat(a)).days/365.25

# which names actually won over the decade? (pure hindsight, that is the point)
perf=[]
for t,s in us.items():
    if t.startswith("%5E"): continue
    ks=sorted(s)
    if len(ks)<2000: continue
    perf.append((s[ks[-1]]/s[ks[0]], t))
perf.sort(reverse=True)
print("THE DECADE'S BIGGEST WINNERS IN MY CANDIDATE LIST (hindsight):")
print("  " + ", ".join("%s %.0fx"%(t,m) for m,t in perf[:8]))
print()

def report(label, universe, uvol, s, e):
    Y=yrs(s,e)
    B=bench_run(universe,cal,s,e)
    EW=run(universe,uvol,cal,s,e,freq="monthly",top_n=100,cost_bp=2.6,signal="ew_universe")
    MO=run(universe,uvol,cal,s,e,freq="monthly",top_n=100,hold_k=20,cost_bp=2.6)
    sb,se,sm=stats(B["hist"],Y),stats(EW["hist"],Y),stats(MO["hist"],Y)
    r=vs(MO["hist"],EW["hist"],Y)
    print("%-38s %8.2f%% %8.2f%% %8.2f%% %9.2f%% %7.2f"
          % (label, sb["cagr"]*100, se["cagr"]*100, sm["cagr"]*100,
             r["alpha_ann"]*100, r["ir"]))

print("%-38s %8s %8s %8s %9s %7s"
      % ("test","S&P","EW univ","momentum","mom-EW","IR"))
report("full period, all names", us, uv, START, END)

for k in (1,3,5,10):
    drop={t for _,t in perf[:k]}
    u2={t:v for t,v in us.items() if t not in drop}
    v2={t:v for t,v in uv.items() if t in u2}
    report("drop the top %d winners (%s)"%(k, ",".join(sorted(drop))[:22]), u2, v2, START, END)

MID = cal[len(cal)//2]
print()
report("first half  %s..%s"%(START[:7],MID[:7]), us, uv, START, MID)
report("second half %s..%s"%(MID[:7],END[:7]), us, uv, MID, END)
