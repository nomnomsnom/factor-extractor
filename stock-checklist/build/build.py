import re, html, json, glob, os, statistics

def strip(t):
    t = re.sub(r'<!--.*?-->', '', t, flags=re.S)
    t = re.sub(r'<[^>]+>', ' ', t)
    return html.unescape(re.sub(r'\s+', ' ', t)).strip()

def rows(path, minc=2):
    if not os.path.exists(path): return []
    h = open(path, encoding='utf-8', errors='replace').read()
    out = []
    for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>', h, re.S):
        tds = re.findall(r'<td\b[^>]*>(.*?)</td>', tr, re.S)
        if len(tds) >= minc:
            out.append([strip(x) for x in tds])
    return out

def pairs(path):
    d = {}
    for c in rows(path, 2):
        if len(c) == 2 and c[0] and c[1] and len(c[0]) < 45 and c[0] not in d:
            d[c[0]] = c[1]
    return d

def headers(path):
    if not os.path.exists(path): return []
    h = open(path, encoding='utf-8', errors='replace').read()
    m = re.search(r'<thead>(.*?)</thead>', h, re.S)
    if not m: return []
    ths = re.findall(r'<th\b[^>]*>(.*?)</th>', m.group(1), re.S)
    labs = [strip(t) for t in ths]
    out = []
    for l in labs:
        if l.startswith('Period Ending'): break
        if not l or l == 'Fiscal Year': continue
        mm = re.match(r'(TTM|Current|FY \d{4})', l)
        out.append(mm.group(1) if mm else l[:8])
    return out[:7]

STD = ['Revenue Growth','Revenue (Total)','Revenue','Gross Profit','Operating Income','Net Income',
       'Earnings Per Share','EPS Growth','Cash & Investments','Total Debt','Net Cash (Debt)','Net Cash Growth',
       'Net Cash Per Share','Operating Cash Flow','Capital Expenditures','Free Cash Flow Growth','Free Cash Flow',
       'Gross Margin','Operating Margin','Pretax Margin','Profit Margin','FCF Margin','Dividend Per Share Growth',
       'Dividend Per Share','Dividend Yield','PE Ratio','Forward PE','P/FCF Ratio','PS Ratio','Research & Development',
       'Selling, General & Administrative','Operating Expenses','Interest Expense','Income Tax','EBITDA','EBIT',
       'Shares Outstanding','Depreciation & Amortization','Pretax Income','Gross Profit Growth','Operating Income Growth',
       'Net Income Growth','Market Capitalization','Market Cap Growth','Enterprise Value','Last Close Price','Total Revenue']

def label_of(raw):
    for s in sorted(STD, key=len, reverse=True):
        if raw.startswith(s): return s
    # segment rows look like "Services Services Growth" -> take first half
    w = raw.split()
    if len(w) > 1 and raw.endswith('Growth'):
        base = raw[:-len('Growth')].strip()
        half = len(base) // 2
        if base[:half].strip() and base[:half].strip() == base[half:].strip():
            return base[:half].strip()
        # fallback: drop the trailing duplicate
        for i in range(1, len(w)):
            cand = ' '.join(w[:i])
            if base.startswith(cand) and base[len(cand):].strip().startswith(cand):
                return cand
    return raw

def series(path):
    out, order = {}, []
    for c in rows(path, 3):
        lab = label_of(c[0])
        if lab in out: continue
        out[lab] = c[1:]
        order.append(lab)
    return out, order

def num(s):
    if s is None: return None
    s = s.strip().replace(',', '').replace('$', '').replace('%', '')
    if s in ('', '-', 'n/a', 'N/A', 'Upgrade', '--'): return None
    neg = s.startswith('(') and s.endswith(')')
    if neg: s = s[1:-1]
    m = re.match(r'^-?\d*\.?\d+', s)
    if not m: return None
    v = float(m.group(0))
    suf = s[m.end():].strip()
    mult = {'T': 1e12, 'B': 1e9, 'M': 1e6, 'K': 1e3}.get(suf[:1].upper() if suf else '', 1)
    return -v * mult if neg else v * mult

def pick(d, *keys):
    for k in keys:
        if k in d and d[k] not in ('', '-', 'n/a', 'Upgrade'): return d[k]
    return None

def build(listfile, out_var, outfile, qglob, market_default):
    universe = json.load(open(listfile))
    qual = {}
    for f in sorted(glob.glob(qglob)): qual.update(json.load(open(f)))
    res = []
    for i, u in enumerate(universe, 1):
        tk = u['ticker']
        mkt = u.get('mkt', market_default)
        key = ('SGX_' + tk) if mkt == 'SGX' else tk
        st = pairs(f'cache/{key}_stats.html')
        co = pairs(f'cache/{key}_co.html')
        fs, forder = series(f'cache/{key}_fin.html')
        rs, _ = series(f'cache/{key}_ratios.html')
        fyears = headers(f'cache/{key}_fin.html')
        ryears = headers(f'cache/{key}_ratios.html')
        coh = open(f'cache/{key}_co.html', encoding='utf-8', errors='replace').read() if os.path.exists(f'cache/{key}_co.html') else ''
        m = re.search(r'Company Description(.*?)(Contact Details|Stock Details|<footer)', coh, re.S)
        desc = strip(m.group(1)) if m else ''
        desc = re.sub(r'^p\]:mb-\S*\s*', '', desc)[:900]
        ceo = co.get('CEO', ''); founded = co.get('Founded', ''); site = co.get('Website', '')
        OVERRIDE = {
         'K6S': ('Financials', 'Insurance - Life'),
         'Q0F': ('Healthcare', 'Medical Care Facilities'),
         '8A8': ('Healthcare', 'Drug Manufacturers - Specialty'),
         'T14': ('Healthcare', 'Drug Manufacturers - Traditional Medicine'),
         'H15': ('Consumer Discretionary', 'Lodging & Property'),
         'S07': ('Consumer Discretionary', 'Lodging'),
         'NC2': ('Materials', 'Rubber & Agricultural Processing'),
         'EH5': ('Real Estate', 'Real Estate - Development'),
         'P9D': ('Industrials', 'Engineering & Construction'),
         '5WJ': ('Financials', 'Credit Services - Pawnbroking'),
        }
        sector = co.get('Sector') or pick(st, 'Sector') or ''
        industry = co.get('Industry') or pick(st, 'Industry') or ''
        if tk in OVERRIDE and not sector:
            sector, industry = OVERRIDE[tk]
        country = co.get('Country', ''); exch = co.get('Exchange', '')
        rcur = co.get('Reporting Currency', ''); fyend = co.get('Fiscal Year', '')
        execs = [[k, v] for k, v in co.items() if re.search(r'Chief|Head of|President|Chairman|Officer', v or '')][:5]

        segs = []
        started = False
        for lab in forder:
            if lab in ('Revenue', 'Revenue (Total)', 'Total Revenue'): started = True; continue
            if lab in STD: continue
            nm = re.sub(r'\s*(Total Income|Total Revenue|Revenue|Segment)$', '', lab).strip() or lab
            if nm.lower() in ('total', 'others total', 'total segment'): continue
            if started and len(segs) < 8 and fs[lab] and any(num(x) for x in fs[lab][:3]):
                segs.append({'n': nm[:46], 'v': fs[lab][:6]})
        M = {
         'mcap': pick(st,'Market Cap'), 'ev': pick(st,'Enterprise Value'),
         'pe': pick(st,'PE Ratio'), 'fpe': pick(st,'Forward PE'), 'ps': pick(st,'PS Ratio'),
         'pb': pick(st,'PB Ratio'), 'pfcf': pick(st,'P/FCF Ratio'), 'peg': pick(st,'PEG Ratio'),
         'evebitda': pick(st,'EV / EBITDA'), 'evfcf': pick(st,'EV / FCF'),
         'gm': pick(st,'Gross Margin'), 'om': pick(st,'Operating Margin'), 'pm': pick(st,'Profit Margin'),
         'fcfm': pick(st,'FCF Margin'), 'ebitdam': pick(st,'EBITDA Margin'),
         'roe': pick(st,'Return on Equity (ROE)'), 'roa': pick(st,'Return on Assets (ROA)'),
         'roic': pick(st,'Return on Invested Capital (ROIC)'), 'roce': pick(st,'Return on Capital Employed (ROCE)'),
         'wacc': pick(st,'Weighted Average Cost of Capital (WACC)'),
         'de': pick(st,'Debt / Equity'), 'debitda': pick(st,'Debt / EBITDA'), 'dfcf': pick(st,'Debt / FCF'),
         'icov': pick(st,'Interest Coverage'), 'current': pick(st,'Current Ratio'),
         'rev': pick(st,'Revenue'), 'ni': pick(st,'Net Income'), 'ebitda': pick(st,'EBITDA'),
         'fcf': pick(st,'Free Cash Flow'), 'ocf': pick(st,'Operating Cash Flow'), 'capex': pick(st,'Capital Expenditures'),
         'netcash': pick(st,'Net Cash'), 'debt': pick(st,'Total Debt'), 'eps': pick(st,'Earnings Per Share (EPS)'),
         'bvps': pick(st,'Book Value Per Share'), 'shares': pick(st,'Shares Outstanding'),
         'shchg': pick(st,'Shares Change (YoY)'), 'insiders': pick(st,'Owned by Insiders (%)'),
         'inst': pick(st,'Owned by Institutions (%)'), 'employees': pick(st,'Employee Count'),
         'divy': pick(st,'Dividend Yield'), 'dps': pick(st,'Dividend Per Share'), 'payout': pick(st,'Payout Ratio'),
         'divgrow': pick(st,'Years of Dividend Growth'), 'buyback': pick(st,'Buyback Yield'),
         'fcfy': pick(st,'FCF Yield'), 'ey': pick(st,'Earnings Yield'),
         'beta': pick(st,'Beta (5Y)'), 'chg52': pick(st,'52-Week Price Change'),
         'altman': pick(st,'Altman Z-Score'), 'piotroski': pick(st,'Piotroski F-Score'),
         'pt': pick(st,'Price Target'), 'ptd': pick(st,'Price Target Difference'),
         'cons': pick(st,'Analyst Consensus'), 'analysts': pick(st,'Analyst Count'),
         'revf3': pick(st,'Revenue Growth Forecast (3Y)'), 'epsf3': pick(st,'EPS Growth Forecast (3Y)'),
         'earnings': pick(st,'Earnings Date'), 'tax': pick(st,'Effective Tax Rate'),
         'rps': pick(st,'Revenue Per Employee'),
        }
        S = {k: v[:6] for k, v in {
         'revenue': fs.get('Revenue', []), 'revg': fs.get('Revenue Growth', []),
         'gm': fs.get('Gross Margin', []), 'om': fs.get('Operating Margin', []),
         'pm': fs.get('Profit Margin', []), 'fcf': fs.get('Free Cash Flow', []),
         'fcfm': fs.get('FCF Margin', []), 'ni': fs.get('Net Income', []),
         'eps': fs.get('Earnings Per Share', []), 'dps': fs.get('Dividend Per Share', []),
         'ocf': fs.get('Operating Cash Flow', []), 'capex': fs.get('Capital Expenditures', []),
         'netcash': fs.get('Net Cash (Debt)', []),
        }.items() if v}
        R = {k: v[:6] for k, v in {
         'pe': rs.get('PE Ratio', []), 'ps': rs.get('PS Ratio', []), 'pb': rs.get('PB Ratio', []),
         'pfcf': rs.get('P/FCF Ratio', []), 'evebitda': rs.get('EV/EBITDA Ratio', []),
         'roic': rs.get('Return on Invested Capital (ROIC)', []), 'roe': rs.get('Return on Equity (ROE)', []),
         'de': rs.get('Debt / Equity Ratio', []), 'nde': rs.get('Net Debt / EBITDA Ratio', []),
         'divy': rs.get('Dividend Yield', []), 'buyback': rs.get('Buyback Yield / Dilution', []),
         'payout': rs.get('Payout Ratio', []),
        }.items() if v}

        pe_now = num(M['pe']); pe_hist = [num(x) for x in R.get('pe', [])[1:6]]
        pe_hist = [x for x in pe_hist if x and 0 < x < 300]
        pe_med = round(statistics.median(pe_hist), 1) if len(pe_hist) >= 3 else None
        vs_hist = None
        if pe_now and pe_med:
            vs_hist = round((pe_now / pe_med - 1) * 100)
        revs = [num(x) for x in S.get('revenue', [])]
        rev5 = None
        rr = [x for x in revs if x]
        if len(rr) >= 5 and rr[-1] and rr[0] and rr[-1] > 0:
            n = len(rr) - 1
            rev5 = round(((rr[0] / rr[-1]) ** (1 / n) - 1) * 100, 1)
        bb = num(M['shchg'])
        flags = {
         'profit': (num(M['ni']) or 0) > 0,
         'fcfpos': (num(M['fcf']) or 0) > 0,
         'netcash': (num(M['netcash']) or -1) > 0,
         'divpay': (num(M['divy']) or 0) > 0,
         'buyback': bb is not None and bb < -0.3,
         'diluting': bb is not None and bb > 1.5,
         'cheapvshist': vs_hist is not None and vs_hist < -10,
         'richvshist': vs_hist is not None and vs_hist > 25,
         'highroic': (num(M['roic']) or 0) >= 15,
         'growth': (rev5 or 0) >= 10,
        }
        q = qual.get(tk, {})
        res.append({
         'r': i, 't': tk, 'n': u['name'], 'mkt': mkt, 'list': ('US' if out_var=='DATA_US' else 'SG'),
         'cur': 'USD' if mkt == 'US' else 'SGD',
         'sec': sector, 'indu': industry, 'ceo': ceo, 'founded': founded, 'site': site,
         'country': country, 'exch': exch, 'rcur': rcur, 'fyend': fyend, 'execs': execs,
         'desc': desc, 'M': M, 'S': S, 'R': R, 'fy': fyears, 'ry': ryears, 'segs': segs,
         'pe_med': pe_med, 'vs_hist': vs_hist, 'rev5': rev5, 'flags': flags, 'q': q,
        })
    with open(outfile, 'w') as f:
        f.write(f'window.{out_var} = ' + json.dumps(res, separators=(',', ':')) + ';\n')
    print(outfile, len(res), 'companies', os.path.getsize(outfile) // 1024, 'KB')
    return res

us = build('us100.json', 'DATA_US', 'data-us.js', 'qual/us_*.json', 'US')
sg = build('sg100.json', 'DATA_SG', 'data-sg.js', 'qual/sg_*.json', 'SGX')
for c in (us[0], us[9], sg[3], sg[18], sg[99]):
    print(c['t'], '|', c['sec'], '|', c['M']['pe'], '| roic', c['M']['roic'], '| 5y rev cagr', c['rev5'],
          '| vs hist', c['vs_hist'], '| segs', [s['n'] for s in c['segs']][:4], '| ceo', c['ceo'][:25])
