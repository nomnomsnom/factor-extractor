import json
F = json.load(open('sec_raw.json'))

def g(k, t):
    return F.get(k, {}).get(t)

def num(s):
    if s is None: return None
    s = str(s).replace(',', '').replace('$', '').replace('%', '').strip()
    if not s or s in ('-', 'n/a'): return None
    try:
        v = float(s[:-1]) if s and s[-1] in 'TBMK' else float(s)
    except ValueError:
        return None
    mult = {'T': 1e12, 'B': 1e9, 'M': 1e6, 'K': 1e3}.get(s[-1] if s else '', 1)
    return v * mult

us = json.load(open('us100.json'))
agg = {}
import re
for var, fn in [('DATA_US', 'data-us.js')]:
    txt = open(fn).read()
    data = json.loads(txt.split('=', 1)[1].rstrip(';\n'))
    for c in data: agg[c['t']] = c

def fy(rec):
    return (rec or {}).get('fr', '').replace('CY', 'FY').replace('Q2I', ' Q2').replace('Q1I', ' Q1').replace('Q4I', '')

out = {}
for u in us:
    t = u['ticker']
    c = agg.get(t, {})
    M = c.get('M', {})
    o = {}
    revSec = g('rev1', t) or g('rev2', t)
    revAgg = num(M.get('rev'))
    def ratio(numer, label):
        n = g(numer, t)
        if not n: return None
        base, note = None, ''
        if revSec and revSec['fr'] == n['fr']:
            base, note = revSec['v'], fy(n)
        elif revAgg:
            base, note = revAgg, fy(n) + ' over TTM revenue'
        if not base: return None
        return {'v': round(n['v'] / base * 100, 1), 'p': note}
    r = ratio('rd', 'rd');   o['rdPct'] = r
    r = ratio('sbc', 'sbc'); o['sbcPct'] = r
    inv, cogs = g('inv', t), (g('cogs', t) or g('cogs2', t))
    if inv and cogs and cogs['v']:
        o['invDays'] = {'v': round(inv['v'] / cogs['v'] * 365), 'p': fy(inv) + ' inventory over ' + fy(cogs) + ' cost of sales'}
    rpo = g('rpo', t)
    if rpo:
        o['rpo'] = {'v': rpo['v'], 'p': fy(rpo),
                    'pct': round(rpo['v'] / revAgg * 100) if revAgg else None}
    nie, nii, nim = g('nie', t), g('nii', t), g('nim', t)
    if nie and nim:
        inc = nim['v'] + (nii['v'] if nii else 0)
        if inc > 0:
            o['cti'] = {'v': round(nie['v'] / inc * 100, 1), 'p': fy(nie)}
    tier1 = g('tier1', t)
    if tier1:
        o['tier1'] = {'v': round(tier1['v'] * (100 if tier1['v'] < 1 else 1), 2), 'p': fy(tier1)}
    o = {k: v for k, v in o.items() if v}
    if o: out[t] = o

json.dump(out, open('sec_metrics.json', 'w'), indent=0)
cnt = {}
for t, o in out.items():
    for k in o: cnt[k] = cnt.get(k, 0) + 1
print('companies with at least one SEC-derived metric:', len(out), 'of 100')
for k, v in sorted(cnt.items(), key=lambda x: -x[1]): print('  %-9s %3d' % (k, v))
print()
for t in ['MSFT', 'LLY', 'NVDA', 'JPM', 'BAC', 'GS', 'BA', 'COST', 'CRM']:
    if t in out: print(t, json.dumps(out[t]))
