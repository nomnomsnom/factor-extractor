#!/usr/bin/env python3
"""Serve the checklist locally with live prices.

    python3 serve.py            # then open http://localhost:8765

The published Artifact cannot reach the internet — its sandbox blocks every
outbound request. Run this instead and the page gains a "Refresh prices"
button that pulls real quotes through this process.

Prices come from Yahoo Finance; if Yahoo refuses (rate limits by IP), it falls
back to stockanalysis.com. No API key, no dependencies outside the standard
library.
"""

import json, re, sys, time, urllib.error, urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = 8765
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")
BENCHMARKS = {"^GSPC": "S&P 500", "^STI": "Straits Times Index"}


def yahoo_symbol(ticker, market):
    """Map a ticker as the page knows it to the symbol Yahoo expects."""
    if ticker in BENCHMARKS:
        return ticker
    if market == "SGX":
        return ticker + ".SI"
    return ticker.replace(".", "-")          # BRK.B -> BRK-B


def get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def from_yahoo(symbol, rng="6mo"):
    """-> (last_close, last_date, [[date, close], ...]) or None."""
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(symbol)}?range={rng}&interval=1d")
    data = json.loads(get(url))
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        return None
    r = result[0]
    stamps = r.get("timestamp") or []
    closes = ((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    hist = []
    for t, c in zip(stamps, closes):
        if c is None:
            continue
        hist.append([time.strftime("%Y-%m-%d", time.gmtime(t)), round(float(c), 4)])
    if not hist:
        return None
    return hist[-1][1], hist[-1][0], hist[-120:]


def _strip_tags(t):
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def from_stockanalysis(ticker, market):
    """Fallback: the ratios statement carries a 'Last Close Price' row.

    One price per fiscal period, so no daily history — the current column is
    all that is used.
    """
    if market == "SGX":
        url = f"https://stockanalysis.com/quote/sgx/{ticker}/financials/ratios/"
    else:
        url = f"https://stockanalysis.com/stocks/{ticker.lower()}/financials/ratios/"
    html = get(url, timeout=25)
    for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", html, re.S):
        cells = [_strip_tags(td) for td in re.findall(r"<td\b[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) >= 2 and cells[0].startswith("Last Close Price"):
            try:
                px = float(cells[1].replace(",", ""))
            except ValueError:
                return None
            today = time.strftime("%Y-%m-%d")
            return px, today, [[today, px]]
    return None


def quote(ticker, market):
    sym = yahoo_symbol(ticker, market)
    try:
        out = from_yahoo(sym)
        if out:
            return out + ("yahoo",)
    except Exception as e:
        sys.stderr.write(f"  yahoo {sym}: {e}\n")
    if ticker in BENCHMARKS:
        return None
    try:
        out = from_stockanalysis(ticker, market)
        if out:
            return out + ("stockanalysis",)
    except Exception as e:
        sys.stderr.write(f"  fallback {ticker}: {e}\n")
    return None


class Handler(SimpleHTTPRequestHandler):
    def _json(self, payload, code=200):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = urlparse(self.path)
        if parts.path == "/api/health":
            return self._json({"ok": True, "service": "two-hundred-filings"})
        if parts.path == "/api/prices":
            q = parse_qs(parts.query)
            names = [t for t in (q.get("tickers", [""])[0]).split(",") if t]
            markets = (q.get("markets", [""])[0]).split(",")
            bars, failed, sources = {}, [], {}
            for i, t in enumerate(names):
                mk = markets[i] if i < len(markets) else "US"
                got = quote(t, mk)
                if got:
                    px, d, hist, src = got
                    bars[t] = {"px": px, "d": d, "h": hist, "n": len(hist)}
                    sources[src] = sources.get(src, 0) + 1
                else:
                    failed.append(t)
                time.sleep(0.12)
            return self._json({"ok": True, "bars": bars, "failed": failed,
                               "sources": sources, "fetched": time.strftime("%Y-%m-%d %H:%M")})
        return SimpleHTTPRequestHandler.do_GET(self)

    def guess_type(self, path):
        base = SimpleHTTPRequestHandler.guess_type(self, path)
        if base.startswith("text/") or base in ("application/javascript", "application/json"):
            return base + "; charset=utf-8"
        return base

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("  " + (fmt % args) + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    print(f"Two Hundred Filings — live mode on http://localhost:{port}")
    print("Open that address, then use Prices -> Refresh from Yahoo.\n")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
