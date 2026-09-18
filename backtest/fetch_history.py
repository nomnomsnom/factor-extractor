#!/usr/bin/env python3
"""Pull long daily price+volume history from Yahoo for a candidate ticker list.

Separate from market_brief/ on purpose: the brief is a live product and must not
be disturbed by research code. Same two-door approach (chart JSON, then the
history page) because query1/query2 rate-limit this egress IP intermittently.

Volume is kept as well as close, because the backtest defines "large cap" from
trailing dollar volume rather than from a constituent list it does not have.
"""
import json, os, re, sys, time, html, urllib.request, datetime

SP  = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(SP, "hist"); os.makedirs(RAW, exist_ok=True)
UA  = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36")
MON = {m: i+1 for i, m in enumerate(
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"])}
RANGE = os.environ.get("BT_RANGE", "10y")

def get(url, tries=2):
    last = None
    for t in range(tries):
        req = urllib.request.Request(url, headers={
            "User-Agent": UA, "Accept": "application/json,text/html,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://finance.yahoo.com/"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e; time.sleep(1.5 + 2*t)
    raise last

def from_json(sym):
    d = json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/"
                       "%s?range=%s&interval=1d" % (sym, RANGE), tries=1))
    res = d["chart"]["result"][0]
    gmt = res["meta"].get("gmtoffset", 0)
    q   = res["indicators"]["quote"][0]
    adj = (res["indicators"].get("adjclose") or [{}])[0].get("adjclose")
    out = []
    for i, ts in enumerate(res["timestamp"]):
        c = q["close"][i]
        if c is None:
            continue                      # holiday or bad bar: skip, never fill
        v = q["volume"][i] or 0
        a = adj[i] if adj and adj[i] is not None else c
        out.append({"d": datetime.datetime.utcfromtimestamp(ts+gmt).strftime("%Y-%m-%d"),
                    "c": round(float(c), 6), "a": round(float(a), 6), "v": float(v)})
    return out, "chart-json"

def num(s):
    s = s.replace(",", "").strip()
    try: return float(s)
    except ValueError: return None

def from_html(sym):
    s = get("https://finance.yahoo.com/quote/%s/history/" % sym)
    m = re.search(r'<table[^>]*>(.*?)</table>', s, re.S)
    if not m: raise RuntimeError("no table")
    out = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(1), re.S):
        cs = [html.unescape(re.sub('<[^>]+>', ' ', c)).strip()
              for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)]
        if len(cs) < 6: continue
        dm = re.match(r'([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$', cs[0])
        if not dm: continue
        c, a, v = num(cs[4]), num(cs[5]), num(cs[6]) if len(cs) > 6 else None
        if c is None: continue
        out.append({"d": "%s-%02d-%02d" % (dm.group(3), MON[dm.group(1)], int(dm.group(2))),
                    "c": c, "a": a if a is not None else c, "v": v or 0})
    out.reverse()
    return out, "history-html"

todo = [t for t in sys.argv[1:]]
ok = fail = 0
for sym in todo:
    fn = os.path.join(RAW, sym.replace("/", "_") + ".json")
    if os.path.exists(fn) and os.path.getsize(fn) > 200:
        ok += 1; continue
    rec = {"symbol": sym}
    try:
        bars, src = from_json(sym); rec.update(bars=bars, source=src)
    except Exception:
        try:
            bars, src = from_html(sym); rec.update(bars=bars, source=src)
        except Exception as e2:
            rec.update(bars=[], source=None, error=str(e2)[:120])
    json.dump(rec, open(fn, "w"))
    n = len(rec["bars"])
    if n: ok += 1
    else: fail += 1
    print("%-8s %-14s bars=%5d %s" % (sym, rec.get("source") or "FAILED", n,
          rec["bars"][0]["d"]+".."+rec["bars"][-1]["d"] if n else rec.get("error","")[:50]),
          flush=True)
    time.sleep(0.7)
print("done: %d ok, %d failed" % (ok, fail))
