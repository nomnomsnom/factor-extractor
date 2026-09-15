#!/usr/bin/env python3
"""Write prices.js — a dated price snapshot the page can load without a server.

    python3 fetch_prices.py

Fetches every company in data-us.js and data-sg.js (plus the two benchmarks)
through the same sources serve.py uses, and writes prices.js next to the page.
Add prices.js to the artifact and the checklist opens with those prices already
applied, labelled with the date they were taken.

Use serve.py instead if you want prices you can refresh on demand.
"""

import json, re, sys, time
sys.path.insert(0, ".")
from serve import quote, BENCHMARKS


def load(path, var):
    text = open(path, encoding="utf-8").read()
    return json.loads(text.split("=", 1)[1].rstrip(";\n"))


def main():
    us = load("data-us.js", "DATA_US")
    sg = load("data-sg.js", "DATA_SG")
    targets = [(c["t"], "US") for c in us]
    targets += [(c["t"], "SGX" if c.get("mkt") == "SGX" else "US") for c in sg]
    targets += [(k, "US") for k in BENCHMARKS]

    bars, failed, sources = {}, [], {}
    for i, (t, mk) in enumerate(targets, 1):
        got = quote(t, mk)
        if got:
            px, d, hist, src = got
            bars[t] = {"px": px, "d": d, "h": hist[-120:], "n": len(hist), "src": "snapshot"}
            sources[src] = sources.get(src, 0) + 1
        else:
            failed.append(t)
        if i % 25 == 0 or i == len(targets):
            print(f"  {i}/{len(targets)} — {len(bars)} priced, {len(failed)} unavailable", flush=True)
        time.sleep(0.12)

    stamp = time.strftime("%Y-%m-%d %H:%M")
    with open("prices.js", "w", encoding="utf-8") as f:
        f.write("window.PRICES = " + json.dumps({"taken": stamp, "bars": bars},
                                                separators=(",", ":")) + ";\n")
    print(f"\nwrote prices.js — {len(bars)} prices, taken {stamp}")
    print("sources:", ", ".join(f"{v} from {k}" for k, v in sources.items()))
    if failed:
        print("unavailable:", ", ".join(failed[:20]), "..." if len(failed) > 20 else "")
    print('\nAdd <script src="prices.js"></script> before app.js in index.html to use it.')


if __name__ == "__main__":
    main()
