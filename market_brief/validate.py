import json, os, re, sys, datetime, zoneinfo
SP=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(SP,"market-latest.json")))
TODAY=os.environ.get("BRIEF_TODAY") or datetime.datetime.now(
    zoneinfo.ZoneInfo("Asia/Singapore")).strftime("%Y-%m-%d")
RAW=os.path.join(SP,"raw")
err=[]; warn=[]

UNITS={"index","percent","USD per barrel"}; KINDS={"eq","oil","rate"}; CATS={"mkt","ai","flag"}

kpi=sum(1 for i in d["instruments"] if i.get("kpi"))
if kpi!=4: err.append("kpi count is %d, must be 4"%kpi)

ids=set()
for i in d["instruments"]:
    p="[%s]"%i["id"]
    if i["id"] in ids: err.append(p+" duplicate id")
    ids.add(i["id"])
    if i["unit"] not in UNITS: err.append(p+" bad unit "+i["unit"])
    if i["kind"] not in KINDS: err.append(p+" bad kind "+i["kind"])
    s=i["series"]
    if not s: err.append(p+" empty series")
    ds=[x["d"] for x in s]
    if ds!=sorted(ds): err.append(p+" series not sorted ascending")
    if len(set(ds))!=len(ds): err.append(p+" duplicate dates")
    for x in s:
        if x.get("v") is None: err.append(p+" null v at "+x["d"])
        if not re.match(r"^\d{4}-\d{2}-\d{2}$",x["d"]): err.append(p+" bad date "+x["d"])
        if x["d"]>=TODAY: err.append(p+" contains an unfinished session "+x["d"])
        if "pct" in x and x["pct"] is not None and not isinstance(x["pct"],(int,float)):
            err.append(p+" pct not a number at "+x["d"])
    # pct reconciliation against the shipped closes
    for a,b in zip(s,s[1:]):
        if b.get("pct") is None: continue
        exp=(b["v"]/a["v"]-1)*100
        if abs(exp-b["pct"])>0.011:
            err.append("%s pct at %s is %.3f but closes imply %.3f"%(p,b["d"],b["pct"],exp))
    if i["unit"]=="percent" and any(x.get("pct") is not None for x in s):
        err.append(p+" yield series must have null pct")
    if "<" in i["note"] or "&" in i["note"] and "&amp;" not in i["note"] and "S&P" not in i["note"]:
        warn.append(p+" note contains a raw markup character")
    if "%%" in i["note"] or "0.2f" in i["note"] or "{" in i["note"]:
        err.append(p+" note has an unformatted placeholder")

DIRS={"up","down","flat"}
wy=d.get("why")
if not isinstance(wy,list) or not wy:
    err.append("why missing or empty - the page hides the panel and the read is lost")
else:
    if not 4<=len(wy)<=8: warn.append("why has %d bullets; 4-8 reads best"%len(wy))
    for w in wy:
        lab="why[%s]"%str(w.get("t"))[:34]
        if w.get("d") not in DIRS: err.append(lab+" bad direction %r"%w.get("d"))
        for f in ("t","b"):
            v=w.get(f)
            if not isinstance(v,str) or not v.strip(): err.append(lab+" empty "+f); continue
            if "%%" in v or "{" in v or "0.1f" in v or "0.2f" in v:
                err.append(lab+" placeholder left in "+f)
            if "<" in v: err.append(lab+" raw markup in "+f)
            if re.search(r"\d{4}-\d{2}-\d{2}", v): warn.append(lab+" raw ISO date in "+f)
        if len(w.get("t",""))>90: warn.append(lab+" lead is long for a bullet")

for n in d["news"]:
    if n["cat"] not in CATS: err.append("news bad cat "+n["cat"])
    if not re.match(r"^\d{4}-\d{2}-\d{2}$",n["d"]): err.append("news bad date "+n["d"])
    if not n["u"].startswith("https://"): err.append("news bad url "+n["u"])
    if n["d"] > TODAY: err.append("news dated in the future: "+n["d"])
    for f in ("t","b","un"):
        if "%%" in n[f] or "{" in n[f] or "0.2f" in n[f] or "0.1f" in n[f]:
            err.append("news placeholder left in %s: %s"%(f,n["t"][:40]))
        if "<" in n[f]: err.append("news raw markup in "+f)
if not 8<=len(d["news"])<=12: warn.append("news count %d outside 8-12"%len(d["news"]))

for i in d["instruments"]:
    if re.search(r"\d{4}-\d{2}-\d{2}", i["note"]):
        warn.append("[%s] note shows a raw ISO date"%i["id"])
for n in d["news"]:
    if re.search(r"\d{4}-\d{2}-\d{2}", n["b"]):
        warn.append("news body shows a raw ISO date: "+n["t"][:40])

for g in d["gaps"]:
    if "%%" in g or "{" in g or "0.3f" in g: err.append("gap placeholder left")
    if re.search(r"\d{4}-\d{2}-\d{2}", g): warn.append("gap shows a raw ISO date")

# cross-check every equity/oil level against the raw Yahoo file it came from
MAP={"spx":"^GSPC","ndx":"^IXIC","dji":"^DJI","rut":"^RUT","vix":"^VIX",
     "brent":"BZ%3DF","wti":"CL%3DF","nikkei":"^N225","hsi":"^HSI","sti":"^STI",
     "nvda":"NVDA"}
for i in d["instruments"]:
    if i["id"] not in MAP: continue
    raw=json.load(open(os.path.join(RAW,MAP[i["id"]]+".json")))
    rb={b["d"]:b["c"] for b in raw["bars"]}
    for x in i["series"]:
        if x["d"] not in rb: err.append("%s date %s not in raw Yahoo"%(i["id"],x["d"]))
        elif abs(rb[x["d"]]-x["v"])>0.005+abs(rb[x["d"]])*1e-9:
            err.append("%s %s level %s != yahoo %s"%(i["id"],x["d"],x["v"],rb[x["d"]]))

# cross-check yields against the FRED csv
import csv as _csv
for iid,sid in (("ust10","DGS10"),("ust2","DGS2")):
    inst=next(x for x in d["instruments"] if x["id"]==iid)
    fr={}
    for r in _csv.DictReader(open(os.path.join(SP,"fred_%s.csv"%sid))):
        if r[sid].strip() not in ("","."): fr[r["observation_date"]]=float(r[sid])
    for x in inst["series"]:
        if x["d"] not in fr: err.append("%s %s not in FRED"%(iid,x["d"]))
        elif abs(fr[x["d"]]-x["v"])>1e-9: err.append("%s %s != FRED"%(iid,x["d"]))

# movers chips must reconcile against raw closes too
for day in d["movers"]:
    for m in day["items"]:
        raw=json.load(open(os.path.join(RAW,m["t"]+".json")))
        bars=[b for b in raw["bars"] if b["d"]<TODAY]
        lab=day["d"].split(" close")[0]
        MONS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        mon=MONS.index(lab.split()[1])+1
        dd="%s-%02d-%02d"%(TODAY[:4],mon,int(lab.split()[0]))
        k=next(k for k,b in enumerate(bars) if b["d"]==dd)
        exp=(bars[k]["c"]/bars[k-1]["c"]-1)*100
        if abs(exp-m["p"])>0.011:
            err.append("mover %s %s %.3f vs %.3f"%(m["t"],dd,m["p"],exp))

print("instruments=%d kpi=%d why=%d news=%d gaps=%d movers_days=%d"%(
    len(d["instruments"]),kpi,len(d.get("why") or []),len(d["news"]),len(d["gaps"]),len(d["movers"])))
print("bytes=%d"%os.path.getsize(os.path.join(SP,"market-latest.json")))
for w in warn: print("WARN:",w)
for e in err: print("FAIL:",e)
print("RESULT:", "PASS" if not err else "FAIL (%d)"%len(err))
sys.exit(1 if err else 0)
