#!/usr/bin/env python3
"""Compute the state of the tape from an assembled market/latest document.

This module produces FACTS, never prose. The narrative in `why` is written
fresh each run by whoever runs the job, because a narrative is a reading of
what happened and a template cannot do that: on 11 Sep 2026 the tape reversed
(equities up, oil down, VIX down) while the bullets still led with "Oil is the
origin", because only the numbers were refreshing and the sentences were fixed.

The job quotes figures from here so they cannot drift from the series the
charts plot, and writes the sentences itself so they describe this session.

    python3 why_facts.py market-latest.json          # human-readable
    python3 why_facts.py market-latest.json --json   # machine-readable
"""
import json, sys

EQUITY = ("spx", "ndx", "dji", "rut", "nikkei", "hsi", "sti")

def _chg(s, k):
    if len(s) <= k:
        return None
    return (s[-1]["v"] / s[-1-k]["v"] - 1) * 100

def _bp(s, k):
    if len(s) <= k:
        return None
    return (s[-1]["v"] - s[-1-k]["v"]) * 100

def facts(doc):
    F = {"session": None, "instruments": {}, "signals": []}
    byid = {}
    for i in doc.get("instruments", []):
        s = i.get("series") or []
        if not s:
            continue
        rec = {
            "name": i["name"], "kind": i["kind"], "unit": i["unit"],
            "last": s[-1]["v"], "date": s[-1]["d"],
            "d1": _chg(s, 1), "d5": _chg(s, 5), "d20": _chg(s, 20),
            "bp1": _bp(s, 1) if i["unit"] == "percent" else None,
            "bp5": _bp(s, 5) if i["unit"] == "percent" else None,
        }
        if rec["d1"] is not None and rec["d5"] is not None:
            rec["reversal"] = (rec["d1"] > 0) != (rec["d5"] > 0)
        byid[i["id"]] = rec
        F["instruments"][i["id"]] = rec
        F["session"] = max(F["session"] or "", s[-1]["d"])

    have = lambda k: {k2: v for k2, v in byid.items() if v.get(k) is not None}

    d1 = have("d1")
    if d1:
        order = sorted(d1.items(), key=lambda kv: -kv[1]["d1"])
        F["day"] = {"leaders": [(k, v["name"], round(v["d1"], 2)) for k, v in order[:3]],
                    "laggards": [(k, v["name"], round(v["d1"], 2)) for k, v in order[-3:]][::-1]}
        F["reversals"] = sorted(k for k, v in byid.items() if v.get("reversal"))
        F["confirms"]  = sorted(k for k, v in byid.items()
                                if v.get("reversal") is False)
    d5 = have("d5")
    if d5:
        order5 = sorted(d5.items(), key=lambda kv: -kv[1]["d5"])
        F["week"] = {"leaders": [(k, v["name"], round(v["d5"], 2)) for k, v in order5[:3]],
                     "laggards": [(k, v["name"], round(v["d5"], 2)) for k, v in order5[-3:]][::-1]}

    eq = [byid[k] for k in EQUITY if k in byid and byid[k].get("d1") is not None]
    if eq:
        F["equity_breadth"] = {"up": sum(1 for e in eq if e["d1"] > 0), "total": len(eq)}

    t10, t2 = byid.get("ust10"), byid.get("ust2")
    if t10 and t2:
        F["curve"] = {"t10": t10["last"], "t2": t2["last"],
                      "spread": round(t10["last"] - t2["last"], 3),
                      "t10_bp1": t10.get("bp1"), "t2_bp1": t2.get("bp1")}
    v = byid.get("vix")
    if v:
        lv = v["last"]
        F["vix"] = {"last": lv, "d1": v["d1"], "d5": v["d5"],
                    "band": "calm" if lv < 18 else "elevated" if lv < 25
                            else "stressed" if lv < 35 else "disorderly"}

    days = doc.get("movers") or []
    if days:
        items = sorted(days[0].get("items") or [], key=lambda m: -m["p"])
        F["movers"] = {"day": days[0]["d"], "best": items[:3], "worst": items[-3:][::-1],
                       "up": sum(1 for m in items if m["p"] > 0), "total": len(items)}

    # ---- signals: machine-detected narrative hooks, so the writer is told what
    # ---- actually changed rather than reaching for last run's framing.
    sig = F["signals"]
    oil = byid.get("brent")
    if oil and t10:
        if oil["d1"] is not None and t10.get("bp1") is not None:
            if oil["d1"] < -0.5 and t10["bp1"] > 2:
                sig.append("oil_fell_but_yields_rose: the rate move has decoupled "
                           "from the oil move; it is no longer a pass-through story")
            elif oil["d1"] > 0.5 and t10["bp1"] > 2:
                sig.append("oil_and_yields_rose_together: still a pass-through story")
    if F.get("equity_breadth"):
        b = F["equity_breadth"]
        if b["up"] == b["total"]:
            sig.append("all_equity_indices_up_on_the_session")
        elif b["up"] == 0:
            sig.append("all_equity_indices_down_on_the_session")
    if v and v.get("d1") is not None:
        if v["d1"] < -8:
            sig.append("vix_collapsed_on_the_session: stress coming out")
        elif v["d1"] > 8:
            sig.append("vix_jumped_on_the_session: stress going in")
    if F.get("reversals") and len(F["reversals"]) >= max(3, len(byid) // 2):
        sig.append("broad_reversal: most instruments moved against their own "
                   "five-session trend, so the session is a turn, not a continuation")
    spx, rut = byid.get("spx"), byid.get("rut")
    if spx and rut and None not in (spx.get("d1"), rut.get("d1")):
        gap = rut["d1"] - spx["d1"]
        if abs(gap) > 0.3:
            sig.append("small_caps_%s_large_by_%.2fpp_on_the_session"
                       % ("led" if gap > 0 else "lagged", abs(gap)))
    if not sig:
        sig.append("no_strong_signal: the session broadly continued the trend")
    return F

if __name__ == "__main__":
    doc = json.load(open(sys.argv[1]))
    F = facts(doc)
    if "--json" in sys.argv:
        print(json.dumps(F, indent=1)); raise SystemExit
    print("session:", F["session"])
    print("\nSIGNALS (what actually changed this session):")
    for s in F["signals"]: print("  *", s)
    print("\nday leaders :", F.get("day", {}).get("leaders"))
    print("day laggards:", F.get("day", {}).get("laggards"))
    print("5d leaders  :", F.get("week", {}).get("leaders"))
    print("5d laggards :", F.get("week", {}).get("laggards"))
    print("breadth     :", F.get("equity_breadth"))
    print("curve       :", F.get("curve"))
    print("vix         :", F.get("vix"))
    print("reversed    :", F.get("reversals"))
    print("confirmed   :", F.get("confirms"))
