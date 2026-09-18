#!/usr/bin/env python3
import sys, os, math, datetime, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats, vs

px, vol = load()
us={t:v for t,v in px.items() if not t.endswith(".SI") and t!="%5ESTI"}
uv={t:v for t,v in vol.items() if t in us}
cal=calendar(us,"%5EGSPC"); START,END=cal[260],cal[-1]
Y=(datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25

EW=run(us,uv,cal,START,END,freq="monthly",top_n=100,cost_bp=2.6,signal="ew_universe")
MO=run(us,uv,cal,START,END,freq="monthly",top_n=100,hold_k=20,cost_bp=2.6)
B =bench_run(us,cal,START,END)

print("IS THE EDGE DISTINGUISHABLE FROM LUCK?\n")
print("t-statistic = information ratio x sqrt(years). ~2.0 is the usual bar.\n")
for label, base in (("vs S&P 500", B), ("vs its own equal-weight universe", EW)):
    r=vs(MO["hist"], base["hist"], Y)
    t=r["ir"]*math.sqrt(Y)
    print("  %-36s alpha %+5.2f%%/yr  IR %4.2f  t = %4.2f   %s"
          % (label, r["alpha_ann"]*100, r["ir"], t,
             "SIGNIFICANT" if abs(t)>=2 else "not significant"))

print("\nHOW MUCH DATA WOULD IT TAKE TO PROVE IT?\n")
r=vs(MO["hist"],EW["hist"],Y)
need=(2.0/r["ir"])**2 if r["ir"] else float('inf')
print("  at the observed IR of %.2f, you would need %.0f years to reach t=2." % (r["ir"], need))
print("  we have %.1f." % Y)

print("\nWHAT TO ACTUALLY EXPECT, AFTER THE KNOWN HAIRCUTS\n")
gross=r["alpha_ann"]*100
print("  %-52s %+6.2f%%" % ("backtested alpha over its own universe", gross))
surv=gross*0.18
print("  %-52s %+6.2f%%" % ("less the bit that survives dropping 10 top winners", gross*0.82))
print("  %-52s %+6.2f%%" % ("less McLean-Pontiff out-of-sample decay (-26%)", gross*0.82*0.74))
print("  %-52s %+6.2f%%" % ("less post-publication decay instead (-58%)", gross*0.82*0.42))
print("  %-52s %+6.2f%%" % ("less monthly trading costs already charged", 0.0))
print("\n  and none of the above prices in the 11 candidates with NO data at all:")
dead=[]
for f in glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),"hist","*.json")):
    d=json.load(open(f))
    if not d.get("bars") and not d["symbol"].startswith("%5E"): dead.append(d["symbol"])
print("  %s" % ", ".join(sorted(dead)))
print("  These are companies that failed or were absorbed. A momentum book would")
print("  have held some of them on the way up and taken the loss. The backtest cannot.")
