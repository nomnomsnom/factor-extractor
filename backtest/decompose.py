#!/usr/bin/env python3
import sys, os, math, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import load, calendar, run, bench_run, stats

px, vol = load()
us = {t:v for t,v in px.items() if not t.endswith(".SI") and t!="%5ESTI"}
uv = {t:v for t,v in vol.items() if t in us}
cal= calendar(us, "%5EGSPC")
START, END = cal[260], cal[-1]
YRS=(datetime.date.fromisoformat(END)-datetime.date.fromisoformat(START)).days/365.25

B = bench_run(us, cal, START, END)
EW= run(us,uv,cal,START,END,freq="monthly",top_n=100,cost_bp=2.6,signal="ew_universe")
MO= run(us,uv,cal,START,END,freq="monthly",top_n=100,hold_k=20,cost_bp=2.6)

def dret(h):
    d={k:v for k,v in h}; ks=sorted(d)
    return ks, {ks[i]: d[ks[i]]/d[ks[i-1]]-1 for i in range(1,len(ks))}

def beta_alpha(a,b):
    ka,ra=dret(a); kb,rb=dret(b)
    ds=sorted(set(ra)&set(rb))
    x=[rb[d] for d in ds]; y=[ra[d] for d in ds]
    mx=sum(x)/len(x); my=sum(y)/len(y)
    cov=sum((xi-mx)*(yi-my) for xi,yi in zip(x,y))/(len(x)-1)
    var=sum((xi-mx)**2 for xi in x)/(len(x)-1)
    beta=cov/var
    alpha=(my-beta*mx)*252
    resid=[yi-(my-beta*mx+beta*xi) for xi,yi in zip(x,y)]
    sd=math.sqrt(sum(r*r for r in resid)/(len(resid)-1))*math.sqrt(252)
    return beta, alpha, (alpha/sd if sd else 0)

print("RISK-ADJUSTED, NOT JUST RAW RETURN\n")
print("%-44s %8s %8s %8s" % ("","CAGR","vol","Sharpe"))
for nm,h in (("S&P 500",B["hist"]),("equal-weight universe",EW["hist"]),
             ("momentum top-20",MO["hist"])):
    s=stats(h,YRS)
    print("%-44s %7.2f%% %7.2f%% %8.2f"%(nm,s["cagr"]*100,s["vol"]*100,s["sharpe"]))

print()
for nm,base in (("S&P 500",B["hist"]),("its own equal-weight universe",EW["hist"])):
    be,al,ir=beta_alpha(MO["hist"],base)
    print("momentum vs %-32s beta %0.2f  CAPM alpha %+0.2f%%/yr  appraisal IR %0.2f"
          % (nm,be,al*100,ir))

print("\nYEAR BY YEAR (calendar-year total return)\n")
def yearly(h):
    d={k:v for k,v in h}; ks=sorted(d); out={}
    for y in sorted({k[:4] for k in ks}):
        kk=[k for k in ks if k[:4]==y]
        if len(kk)<2: continue
        out[y]=d[kk[-1]]/d[kk[0]]-1
    return out
yb,ye,ym = yearly(B["hist"]), yearly(EW["hist"]), yearly(MO["hist"])
print("%-6s %10s %10s %10s %12s" % ("year","S&P 500","EW univ","momentum","mom - S&P"))
wins=0; tot=0
for y in sorted(yb):
    if y not in ym: continue
    diff=ym[y]-yb[y]; wins+= diff>0; tot+=1
    print("%-6s %9.1f%% %9.1f%% %9.1f%% %11.1f%%"%(y,yb[y]*100,ye[y]*100,ym[y]*100,diff*100))
print("\n  momentum beat the index in %d of %d calendar years" % (wins,tot))
