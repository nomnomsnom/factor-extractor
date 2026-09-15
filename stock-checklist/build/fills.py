import re, html, json, os

def strip(t):
    t = re.sub(r'<!--.*?-->', '', t, flags=re.S); t = re.sub(r'<[^>]+>', ' ', t)
    return html.unescape(re.sub(r'\s+', ' ', t)).strip()

def bs_rows(path):
    if not os.path.exists(path): return {}, []
    h = open(path, encoding='utf-8', errors='replace').read()
    d, order = {}, []
    for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>', h, re.S):
        tds = re.findall(r'<td\b[^>]*>(.*?)</td>', tr, re.S)
        if len(tds) >= 3:
            lab = strip(tds[0])
            lab = re.sub(r'\s+(Growth|Change)$', '', lab)
            if lab not in d:
                d[lab] = [strip(x) for x in tds[1:]]
                order.append(lab)
    return d, order

def n(s):
    if s is None: return None
    s = str(s).replace(',', '').replace('$', '').replace('%', '').strip()
    if not s or s in ('-', 'n/a', 'Upgrade', '--'): return None
    neg = s.startswith('(') and s.endswith(')')
    if neg: s = s[1:-1]
    m = re.match(r'^-?\d*\.?\d+', s)
    if not m: return None
    v = float(m.group(0))
    suf = s[m.end():].strip()[:1].upper()
    v *= {'T': 1e12, 'B': 1e9, 'M': 1e6, 'K': 1e3}.get(suf, 1)
    return -v if neg else v

# Read out of each bank's own results document — these are not in any feed.
MANUAL = {
 'D05': {
   'cti':  {'v': 38.6, 'p': '2Q26', 's': 'DBS 2Q26 performance summary, cost/income ratio'},
   'nim':  {'v': 1.88, 'p': '2Q26', 's': 'DBS 2Q26 performance summary, group net interest margin'},
   'npl':  {'v': 1.0,  'p': '2Q26', 's': 'DBS 2Q26 performance summary, NPL ratio'},
   'cet1': {'v': 16.6, 'p': '2Q26', 's': 'DBS 2Q26 performance summary, Common Equity Tier 1 ratio'},
 },
 'O39': {
   'cti':  {'v': 38.5, 'p': '1H26', 's': 'OCBC 1H26 results release, cost-to-income ratio'},
   'nim':  {'v': 1.73, 'p': '1H26', 's': 'OCBC 1H26 results release, net interest margin'},
   'npl':  {'v': 0.9,  'p': '1H26', 's': 'OCBC 1H26 results release, NPL ratio'},
   'cet1': {'v': 15.7, 'p': '30 Jun 2026', 's': 'OCBC 1H26 results release, CET1 CAR'},
 },
 'U11': {
   'cti':  {'v': 44.9, 'p': '1H26', 's': 'UOB 1H26 results release, cost-to-income ratio'},
   'nim':  {'v': 1.74, 'p': '2Q26', 's': 'UOB 1H26 results release, net interest margin'},
   'npl':  {'v': 1.6,  'p': '2Q26', 's': 'UOB 1H26 results release, non-performing loan ratio'},
   'cet1': {'v': 15.4, 'p': '1H26', 's': 'UOB 1H26 results release, Common Equity Tier 1 CAR'},
 },
}

sec = json.load(open('sec_metrics.json'))
us = json.load(open('us100.json')); sg = json.load(open('sg100.json'))
universe = [(u['ticker'], u['ticker'], 'US') for u in us]
for s in sg:
    universe.append((s['ticker'], s['ticker'] if s['mkt'] == 'US' else 'SGX_' + s['ticker'], 'SG'))

fills = {}
for tk, key, lst in universe:
    bs, _ = bs_rows('cache/%s_bs.html' % key)
    f = {}
    ta = n((bs.get('Total Assets') or [None])[0])
    debt = n((bs.get('Total Debt') or [None])[0])
    if not debt:
        debt = sum([n((bs.get(k) or [None])[0]) or 0 for k in
                    ['Short-Term Debt', 'Current Portion of Long-Term Debt', 'Long-Term Debt',
                     'Short-Term Borrowings', 'Long-Term Borrowings', 'Current Portion of Leases', 'Long-Term Leases']])
    if ta and debt > 0:
        f['gearing'] = {'v': round(debt / ta * 100, 1), 'p': 'latest balance sheet',
                        's': 'computed: total debt over total assets'}
    gl = n((bs.get('Gross Loans') or [None])[0])
    al = n((bs.get('Allowance for Loan Losses') or [None])[0])
    dep = n((bs.get('Total Deposits') or [None])[0])
    nl = n((bs.get('Net Loans') or [None])[0])
    if gl and al:
        f['allowPct'] = {'v': round(abs(al) / gl * 100, 2), 'p': 'latest balance sheet',
                         's': 'computed: allowance for loan losses over gross loans'}
    if nl and dep:
        f['ldr'] = {'v': round(nl / dep * 100), 'p': 'latest balance sheet',
                    's': 'computed: net loans over total deposits'}
    for k, v in (MANUAL.get(tk) or {}).items():
        f[k] = dict(v)
    for k, v in (sec.get(tk) or {}).items():
        lab = {'rdPct': 'SEC XBRL, R&D expense over revenue',
               'sbcPct': 'SEC XBRL, share-based compensation over revenue',
               'invDays': 'SEC XBRL, inventory over cost of sales',
               'rpo': 'SEC XBRL, remaining performance obligation',
               'cti': 'SEC XBRL, noninterest expense over total income',
               'tier1': 'SEC XBRL, Tier 1 risk-based capital ratio (this is Tier 1, not CET1)'}[k]
        key = 'cet1' if k == 'tier1' else k
        if key in f: continue
        f[key] = {'v': v['v'], 'p': v.get('p', ''), 's': lab}
        if k == 'rpo': f[k]['pct'] = v.get('pct')
    if f: fills[tk] = f

json.dump(fills, open('fills.json', 'w'), indent=0)
cnt = {}
for t, f in fills.items():
    for k in f: cnt[k] = cnt.get(k, 0) + 1
print('companies with at least one filled metric:', len(fills), 'of 200')
for k, v in sorted(cnt.items(), key=lambda x: -x[1]): print('  %-9s %3d' % (k, v))
print()
for t in ['A17U', 'C38U', 'M44U', 'D05', 'JPM', 'BAC', 'C09', 'MSFT']:
    if t in fills: print(t, json.dumps(fills[t])[:240])
