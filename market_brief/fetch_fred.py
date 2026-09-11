#!/usr/bin/env python3
"""Pull Treasury constant-maturity yields from FRED as CSV.

fredgraph.csv needs no API key, which is why it is used here rather than the
api.stlouisfed.org endpoint. Missing days arrive as an empty field (FRED's "."
in the JSON API) and are dropped downstream, never carried forward.
"""
import os, sys, urllib.request

SP = os.path.dirname(os.path.abspath(__file__))
SERIES = sys.argv[1:] or ["DGS10", "DGS2", "DGS20", "DGS30"]
START = os.environ.get("FRED_START", "2026-06-01")

for sid in SERIES:
    url = ("https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s"
           % (sid, START))
    with urllib.request.urlopen(url, timeout=40) as r:
        body = r.read()
    out = os.path.join(SP, "fred_%s.csv" % sid)
    with open(out, "wb") as f:
        f.write(body)
    last = [l for l in body.decode().strip().splitlines()[1:]
            if l.split(",")[1].strip() not in ("", ".")]
    print("%-6s rows=%d last=%s" % (sid, len(last), last[-1] if last else "-"))
