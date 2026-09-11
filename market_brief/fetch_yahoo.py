#!/usr/bin/env python3
"""Scrape daily OHLC from Yahoo Finance history pages.
Primary: query1 chart JSON. Fallback: the /history/ HTML table (same Yahoo data).
Writes one JSON file per symbol into raw/. Never invents a bar."""
import json, os, re, sys, time, html, urllib.request, urllib.error, datetime

SP = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(SP, "raw"); os.makedirs(RAW, exist_ok=True)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36")
MON = {m: i+1 for i, m in enumerate(
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"])}

def get(url, tries=3):
    last = None
    for t in range(tries):
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/json,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://finance.yahoo.com/",
        })
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(2 + 3*t)
    raise last

def num(s):
    s = s.replace(",", "").strip()
    if s in ("-", "", "null", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None

def from_chart_json(sym):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s"
           "?range=3mo&interval=1d" % sym)
    d = json.loads(get(url, tries=1))
    res = d["chart"]["result"][0]
    tz = res["meta"]["exchangeTimezoneName"]
    gmt = res["meta"].get("gmtoffset", 0)
    ts = res["timestamp"]
    closes = res["indicators"]["quote"][0]["close"]
    out = []
    for t, c in zip(ts, closes):
        if c is None:
            continue          # holiday or bad bar: skip, never zero-fill
        day = datetime.datetime.utcfromtimestamp(t + gmt).strftime("%Y-%m-%d")
        out.append({"d": day, "c": round(float(c), 4)})
    meta = {k: res["meta"].get(k) for k in
            ("marketState", "regularMarketTime", "exchangeTimezoneName",
             "exchangeName", "instrumentType", "regularMarketPrice",
             "chartPreviousClose", "currency", "shortName")}
    return out, "yahoo-chart-json", tz, meta

def from_history_html(sym):
    url = "https://finance.yahoo.com/quote/%s/history/" % sym
    s = get(url)
    m = re.search(r'<table[^>]*>(.*?)</table>', s, re.S)
    if not m:
        raise RuntimeError("no history table for %s" % sym)
    out = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(1), re.S):
        cells = [html.unescape(re.sub('<[^>]+>', ' ', c)).strip()
                 for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)]
        if len(cells) < 5:
            continue          # dividend / split rows
        dm = re.match(r'([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$', cells[0])
        if not dm:
            continue
        day = "%s-%02d-%02d" % (dm.group(3), MON[dm.group(1)], int(dm.group(2)))
        c = num(cells[4])
        if c is None:
            continue          # no close printed: skip the session
        out.append({"d": day, "c": c})
    out.reverse()             # page is newest-first; we want oldest-first
    return out, "yahoo-history-html", None, {}

SYMBOLS = sys.argv[1:]
for sym in SYMBOLS:
    rec = {"symbol": sym}
    try:
        bars, src, tz, meta = from_chart_json(sym)
        rec.update(bars=bars, source=src, tz=tz, meta=meta)
    except Exception as e1:
        try:
            bars, src, tz, meta = from_history_html(sym)
            rec.update(bars=bars, source=src, tz=tz, meta=meta,
                       note_json_fail=str(e1)[:120])
        except Exception as e2:
            rec.update(bars=[], source=None, error=str(e2)[:200])
    rec["fetched_utc"] = datetime.datetime.utcnow().isoformat() + "Z"
    fn = os.path.join(RAW, sym.replace("/", "_").replace("%5E", "^") + ".json")
    with open(fn, "w") as f:
        json.dump(rec, f, indent=1)
    n = len(rec["bars"])
    print("%-12s %-22s bars=%3d  last=%s" % (
        sym, rec.get("source") or "FAILED", n,
        rec["bars"][-1] if n else rec.get("error", "")[:60]), flush=True)
    time.sleep(1.5)
