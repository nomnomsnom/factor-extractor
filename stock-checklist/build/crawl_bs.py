import json, os, subprocess, time, random
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
us = json.load(open('us100.json')); sg = json.load(open('sg100.json'))
targets = []
for u in us: targets.append((u['ticker'], "https://stockanalysis.com/stocks/%s/financials/balance-sheet/" % u['ticker'].lower()))
for s in sg:
    if s['mkt'] == 'US': targets.append((s['ticker'], "https://stockanalysis.com/stocks/%s/financials/balance-sheet/" % s['ticker'].lower()))
    else: targets.append(("SGX_" + s['ticker'], "https://stockanalysis.com/quote/sgx/%s/financials/balance-sheet/" % s['ticker']))
done = fail = skip = 0
for key, url in targets:
    out = "cache/%s_bs.html" % key
    if os.path.exists(out) and os.path.getsize(out) > 20000:
        skip += 1; continue
    good = False
    for attempt in range(3):
        r = subprocess.run(['curl', '-sS', '-m', '30', '-A', UA, url, '-o', out], capture_output=True)
        if r.returncode == 0 and os.path.getsize(out) > 20000:
            if 'Just a moment' not in open(out, encoding='utf-8', errors='replace').read(400):
                good = True; break
        time.sleep(3 + attempt * 4)
    done += good; fail += (not good)
    if not good: print('FAIL', key, flush=True)
    time.sleep(0.5 + random.random() * 0.3)
print('BALANCE SHEETS DONE', done, 'fetched,', fail, 'failed,', skip, 'cached')
