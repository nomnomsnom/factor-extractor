#!/usr/bin/env python3
"""A small, explicit backtest engine. No dependencies beyond the stdlib.

Design decisions that matter more than the strategy:

* NO LOOK-AHEAD. The signal is computed from data up to and including day t;
  the portfolio is held from t+1 onward. One day is skipped between formation
  and investment, which is also what Frazzini/Israel/Moskowitz do, and it kills
  the fake profits that bid-ask bounce otherwise hands to reversal signals.

* POINT-IN-TIME UNIVERSE, as far as the data allows. "Large cap" is defined at
  each rebalance as the top N by trailing 60-day average dollar volume, computed
  only from bars on or before that date. We have no historical constituent list,
  so this is a proxy; it is at least not a list of today's winners applied to
  the past. The candidate list still carries survivorship bias and the report
  says so out loud.

* DELISTING IS NOT A FREE EXIT. A name whose data stops is held to its last
  print and sold there at the next rebalance. It is never silently dropped from
  the return series, which is the usual way a backtest launders a bankruptcy.

* COSTS ARE CHARGED ON TURNOVER, inside the loop, not subtracted at the end.
"""
import json, os, glob, math, datetime

SP = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- data loading
def load(dirname="hist", use_quarantine=True):
    """Load history, skipping names datacheck.py flagged as having a corrupt
    dividend adjustment. Y92.SI is the reason this exists: its raw price fell
    54% over the decade while its adjusted series showed a 274x gain."""
    bad = set()
    qf = os.path.join(SP, "quarantine.json")
    if use_quarantine and os.path.exists(qf):
        bad = set(json.load(open(qf)))
    px, vol = {}, {}
    for f in glob.glob(os.path.join(SP, dirname, "*.json")):
        d = json.load(open(f))
        if not d.get("bars"):
            continue
        t = d["symbol"]
        if t in bad:
            continue
        px[t]  = {b["d"]: b["a"] for b in d["bars"]}      # adjusted, for returns
        vol[t] = {b["d"]: b["c"] * b["v"] for b in d["bars"]}   # dollar volume
    return px, vol

def calendar(px, bench):
    if bench in px:
        return sorted(px[bench])
    days = set()
    for t in px: days |= set(px[t])
    return sorted(days)

# ------------------------------------------------------------------- utilities
def rebal_dates(cal, freq):
    """Last trading day of each period, from the calendar itself."""
    if freq == "daily":
        return cal[:]
    out, prev = [], None
    for i, d in enumerate(cal):
        y, m, dd = map(int, d.split("-"))
        if freq == "monthly":    key = (y, m)
        elif freq == "quarterly": key = (y, (m-1)//3)
        elif freq == "weekly":
            key = datetime.date(y, m, dd).isocalendar()[:2]
        else: raise ValueError(freq)
        if prev is not None and key != prev:
            out.append(cal[i-1])
        prev = key
    out.append(cal[-1])
    return out

def price_on_or_before(series, d):
    """Last print at or before d. Returns (date, price) or None."""
    best = None
    for k in series:
        if k <= d and (best is None or k > best):
            best = k
    return (best, series[best]) if best else None

class Series:
    """Sorted-key lookup that does not rescan the dict every call."""
    def __init__(self, m):
        self.k = sorted(m); self.m = m
        self.idx = {d: i for i, d in enumerate(self.k)}
    def asof(self, d):
        import bisect
        i = bisect.bisect_right(self.k, d) - 1
        return (self.k[i], self.m[self.k[i]]) if i >= 0 else None
    def back(self, d, n):
        """Price n trading days before d, on this name's own calendar."""
        import bisect
        i = bisect.bisect_right(self.k, d) - 1
        j = i - n
        return self.m[self.k[j]] if j >= 0 else None
    def has_recent(self, d, tol=10):
        """Is the name still trading as of d? Guards against stale/dead lines."""
        a = self.asof(d)
        if not a: return False
        return (datetime.date.fromisoformat(d) -
                datetime.date.fromisoformat(a[0])).days <= tol

# ---------------------------------------------------------------- the backtest
def run(px, vol, cal, start, end, freq="monthly", top_n=100, hold_k=20,
        cost_bp=2.6, signal="mom12_1", bench="%5EGSPC", min_hist=260):
    P = {t: Series(px[t]) for t in px}
    V = {t: Series(vol[t]) for t in vol}
    dates = [d for d in cal if start <= d <= end]
    rebs  = set(rebal_dates(dates, freq))

    w, nav, hist = {}, 1.0, []
    turn_total, cost_total = 0.0, 0.0
    pending = None            # weights formed at t, invested from t+1

    for i, d in enumerate(dates):
        # --- accrue one day of return on yesterday's weights
        if i > 0 and w:
            prev = dates[i-1]
            r = 0.0
            for t, wt in w.items():
                a, b = P[t].asof(prev), P[t].asof(d)
                if a and b and a[1] > 0:
                    r += wt * (b[1]/a[1] - 1.0)
            nav *= (1.0 + r)
        # --- put yesterday's formed portfolio to work today
        if pending is not None:
            new = pending; pending = None
            turn = sum(abs(new.get(t,0)-w.get(t,0)) for t in set(new)|set(w))/2.0
            cost = turn * 2 * cost_bp / 10000.0
            nav *= (1.0 - cost)
            turn_total += turn; cost_total += cost
            w = new
        # --- form a new portfolio using data through today
        if d in rebs:
            cands = []
            for t in P:
                if t.startswith("%5E") or t == bench: continue
                if not P[t].has_recent(d): continue
                if len(P[t].k) < 40: continue
                a = V[t].asof(d)
                if not a: continue
                ks = [k for k in V[t].k if k <= d][-60:]
                if len(ks) < 40: continue
                adv = sum(V[t].m[k] for k in ks)/len(ks)
                cands.append((adv, t))
            cands.sort(reverse=True)
            uni = [t for _, t in cands[:top_n]]

            scored = []
            for t in uni:
                s = P[t]
                if len(s.k) < min_hist: continue
                p_now  = s.back(d, 21)
                p_then = s.back(d, 252)
                if not p_now or not p_then or p_then <= 0: continue
                scored.append((p_now/p_then - 1.0, t))
            if signal == "ew_universe":
                # Hold the whole point-in-time universe, equally weighted. This
                # is the benchmark that matters: it carries the SAME survivorship
                # bias as the strategy, so the gap between them is the signal's
                # real contribution rather than the candidate list's.
                if uni:
                    pending = {t: 1.0/len(uni) for t in uni}
                hist.append((d, nav))
                continue
            if signal == "mom12_1":
                scored.sort(reverse=True)
            elif signal == "rev1m":
                scored = sorted([(-( (P[t].asof(d)[1]/P[t].back(d,21)) -1), t)
                                 for _, t in scored
                                 if P[t].back(d,21)], reverse=True)
            elif signal == "equal":
                scored.sort(key=lambda x: x[1])
            pick = [t for _, t in scored[:hold_k]]
            if pick:
                pending = {t: 1.0/len(pick) for t in pick}
        hist.append((d, nav))
    yrs = max(1e-9, (datetime.date.fromisoformat(dates[-1]) -
                     datetime.date.fromisoformat(dates[0])).days / 365.25)
    return {"hist": hist, "nav": nav, "years": yrs,
            "turnover_per_yr": turn_total/yrs, "cost_per_yr": cost_total/yrs}

def bench_run(px, cal, start, end, bench="%5EGSPC"):
    S = Series(px[bench]); dates=[d for d in cal if start<=d<=end]
    nav, hist = 1.0, []
    for i,d in enumerate(dates):
        if i>0:
            a,b = S.asof(dates[i-1]), S.asof(d)
            if a and b and a[1]>0: nav *= b[1]/a[1]
        hist.append((d,nav))
    return {"hist":hist,"nav":nav}

# ------------------------------------------------------------------- statistics
def stats(hist, years):
    navs = [v for _, v in hist]
    rets = [navs[i]/navs[i-1]-1 for i in range(1,len(navs)) if navs[i-1]>0]
    n = len(rets)
    if n < 2: return {}
    mu = sum(rets)/n
    sd = math.sqrt(sum((r-mu)**2 for r in rets)/(n-1))
    cagr = navs[-1]**(1/years)-1
    vol  = sd*math.sqrt(252)
    peak, mdd = navs[0], 0.0
    for v in navs:
        peak = max(peak, v); mdd = min(mdd, v/peak-1)
    return {"cagr":cagr, "vol":vol, "sharpe":(mu*252)/vol if vol else 0,
            "maxdd":mdd, "final":navs[-1]}

def vs(a_hist, b_hist, years):
    A={d:v for d,v in a_hist}; B={d:v for d,v in b_hist}
    ds=sorted(set(A)&set(B))
    ar=[A[ds[i]]/A[ds[i-1]]-1 for i in range(1,len(ds))]
    br=[B[ds[i]]/B[ds[i-1]]-1 for i in range(1,len(ds))]
    ex=[x-y for x,y in zip(ar,br)]
    n=len(ex); mu=sum(ex)/n
    sd=math.sqrt(sum((r-mu)**2 for r in ex)/(n-1))
    te=sd*math.sqrt(252)
    return {"alpha_ann":mu*252, "te":te, "ir":(mu*252)/te if te else 0}
