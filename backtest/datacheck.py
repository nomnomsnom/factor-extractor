#!/usr/bin/env python3
"""Catch broken dividend adjustments before they reach a backtest.

Total return should exceed price return by roughly the dividend yield. When the
gap implies a yield no equity pays, the adjustment factor is corrupt -- Yahoo
does this on some SGX names, compounding an annual dividend as though it were a
huge fraction of price. Y92.SI's raw price fell 54% over the decade while its
adjusted series showed a 274x gain, and momentum chased the artefact.
"""
import json, glob, os, datetime, sys
SP=os.path.dirname(os.path.abspath(__file__))
MAX_IMPLIED_YIELD = float(os.environ.get("MAX_YIELD","0.15"))
bad=[]
rows=[]
for f in sorted(glob.glob(os.path.join(SP,"hist","*.json"))):
    d=json.load(open(f)); b=d.get("bars") or []
    if len(b)<500: continue
    t=d["symbol"]
    yrs=(datetime.date.fromisoformat(b[-1]["d"])-datetime.date.fromisoformat(b[0]["d"])).days/365.25
    if b[0]["c"]<=0 or b[0]["a"]<=0: continue
    pr=(b[-1]["c"]/b[0]["c"])**(1/yrs)-1
    tr=(b[-1]["a"]/b[0]["a"])**(1/yrs)-1
    implied=tr-pr
    rows.append((implied,t,pr,tr))
    if implied>MAX_IMPLIED_YIELD or implied< -0.02:
        bad.append(t)
rows.sort(reverse=True)
print("IMPLIED DIVIDEND YIELD = total-return CAGR - price-return CAGR")
print("anything above %.0f%% is a broken adjustment, not a dividend\n"%(MAX_IMPLIED_YIELD*100))
print("%-10s %12s %12s %12s"%("ticker","price CAGR","total CAGR","implied yld"))
for implied,t,pr,tr in rows[:10]:
    flag="  <-- BROKEN" if implied>MAX_IMPLIED_YIELD or implied<-0.02 else ""
    print("%-10s %11.2f%% %11.2f%% %11.2f%%%s"%(t,pr*100,tr*100,implied*100,flag))
print("\n...")
for implied,t,pr,tr in rows[-3:]:
    print("%-10s %11.2f%% %11.2f%% %11.2f%%"%(t,pr*100,tr*100,implied*100))
print("\nQUARANTINED (%d): %s"%(len(bad), ", ".join(sorted(bad)) or "none"))
json.dump(sorted(bad), open(os.path.join(SP,"quarantine.json"),"w"))
