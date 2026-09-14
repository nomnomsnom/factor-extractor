import json, os, subprocess, time, sys, random

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
CACHE = "cache"
os.makedirs(CACHE, exist_ok=True)

us = json.load(open('us100.json'))
sg = json.load(open('sg100.json'))

targets = []
for u in us:
    targets.append((u['ticker'], f"https://stockanalysis.com/stocks/{u['ticker'].lower()}/"))
for s in sg:
    if s['mkt'] == 'US':
        targets.append((s['ticker'], f"https://stockanalysis.com/stocks/{s['ticker'].lower()}/"))
    else:
        targets.append(("SGX_" + s['ticker'], f"https://stockanalysis.com/quote/sgx/{s['ticker']}/"))

PAGES = [('stats', 'statistics/'), ('fin', 'financials/'), ('ratios', 'financials/ratios/'), ('co', 'company/')]

def fetch(url, out):
    for attempt in range(3):
        r = subprocess.run(['curl', '-sS', '-m', '30', '-A', UA, url, '-o', out],
                           capture_output=True)
        if r.returncode == 0 and os.path.getsize(out) > 20000:
            h = open(out, encoding='utf-8', errors='replace').read(400)
            if 'Just a moment' not in h:
                return True
        time.sleep(3 + attempt * 4)
    return False

done = fail = skip = 0
for key, base in targets:
    for tag, suffix in PAGES:
        out = f"{CACHE}/{key}_{tag}.html"
        if os.path.exists(out) and os.path.getsize(out) > 20000:
            skip += 1
            continue
        ok = fetch(base + suffix, out)
        if ok:
            done += 1
        else:
            fail += 1
            print(f"FAIL {key} {tag}", flush=True)
        time.sleep(0.5 + random.random() * 0.4)
    print(f"{key} done={done} fail={fail} skip={skip}", flush=True)
print("CRAWL COMPLETE", done, fail, skip)
