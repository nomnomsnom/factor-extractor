/* Two Hundred Filings — a stock research checklist over 200 companies. */
(function () {
  'use strict';

  var ALL = [].concat(window.DATA_US || [], window.DATA_SG || []);
  var NOTE_KEY = 'tf.notes.v1';
  var CHECK_IDS = ['s1a','s1b','s1c','s1d','s2a','s2b','s2c','s2d','s2e','s2f','s3a','s3b','s3c','s3d','s4a','s4b','s4c','s4d','s5a','s5b','s5c','s5d','s5e'];
  var TOTAL_CHECKS = CHECK_IDS.length;

  /* ---------------- numbers ---------------- */
  function num(s) {
    if (s === null || s === undefined) return null;
    if (typeof s === 'number') return s;
    s = String(s).replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '').trim();
    if (!s || s === '-' || s === 'n/a' || s === 'Upgrade' || s === '--') return null;
    var neg = /^\(.*\)$/.test(s);
    if (neg) s = s.slice(1, -1);
    var m = /^-?\d*\.?\d+/.exec(s);
    if (!m) return null;
    var v = parseFloat(m[0]);
    var suf = s.slice(m[0].length).trim().charAt(0).toUpperCase();
    var mult = suf === 'T' ? 1e12 : suf === 'B' ? 1e9 : suf === 'M' ? 1e6 : suf === 'K' ? 1e3 : 1;
    return (neg ? -1 : 1) * v * mult;
  }
  function money(v, cur) {
    if (v === null || v === undefined) return '—';
    var sign = v < 0 ? '−' : '';
    v = Math.abs(v);
    var p = cur === 'SGD' ? 'S$' : 'US$';
    if (v >= 1e12) return sign + p + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return sign + p + (v / 1e9).toFixed(v >= 1e11 ? 0 : 1) + 'B';
    if (v >= 1e6) return sign + p + (v / 1e6).toFixed(0) + 'M';
    return sign + p + v.toFixed(0);
  }
  function txt(v) { return (v === null || v === undefined || v === '' || v === 'n/a') ? '—' : String(v); }
  function pct(v, d) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(d === undefined ? 1 : d) + '%'; }
  function median(a) {
    a = a.filter(function (x) { return x !== null && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var h = Math.floor(a.length / 2);
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- derive ---------------- */
  var SECTORS = {};
  ALL.forEach(function (c) {
    c.mcapN = num(c.M.mcap);
    c.peN = num(c.M.pe);
    c.divN = num(c.M.divy);
    c.roicN = num(c.M.roic);
    c.waccN = num(c.M.wacc);
    c.growthN = c.rev5;
    c.secKey = c.sec || 'Other';
    c.list = c.list || (c.mkt === 'US' ? 'US' : 'SG');
    c.hay = [c.t, c.n, c.sec, c.indu, c.ceo, c.desc, c.country,
      c.q.what, c.q.rev, c.q.gm, c.q.mgmt, c.q.comp, c.q.moat, c.q.ind, c.q.risk, c.q.implied, c.q.debate, c.q.disprove,
      (c.q.moatTags || []).join(' '), (c.segs || []).map(function (s) { return s.n; }).join(' ')
    ].join(' ').toLowerCase();
    (SECTORS[c.secKey] = SECTORS[c.secKey] || []).push(c);
  });
  var PEERS = {};
  Object.keys(SECTORS).forEach(function (k) {
    ['US', 'SG'].forEach(function (mk) {
      var g = SECTORS[k].filter(function (c) { return c.list === mk; });
      if (g.length >= 3) {
        PEERS[k + '|' + mk] = {
          n: g.length,
          pe: median(g.map(function (c) { return c.peN; })),
          div: median(g.map(function (c) { return c.divN; })),
          roic: median(g.map(function (c) { return c.roicN; }))
        };
      }
    });
    var all = SECTORS[k];
    PEERS[k + '|ALL'] = {
      n: all.length,
      pe: median(all.map(function (c) { return c.peN; })),
      div: median(all.map(function (c) { return c.divN; })),
      roic: median(all.map(function (c) { return c.roicN; }))
    };
  });
  function peersOf(c) { return PEERS[c.secKey + '|' + c.list] || PEERS[c.secKey + '|ALL']; }

  var SECTOR_NAMES = Object.keys(SECTORS).filter(Boolean).sort();
  var MOAT_TAGS = ['Brand', 'Switching costs', 'Network effects', 'Scale', 'Regulation', 'IP/Patents'];

  /* ---------------- notes ---------------- */
  var notes = {};
  try { notes = JSON.parse(localStorage.getItem(NOTE_KEY) || '{}') || {}; } catch (e) { notes = {}; }
  var db = null, syncTimer = null;

  function rec(t) {
    if (!notes[t]) notes[t] = { c: {}, n: {}, u: 0 };
    if (!notes[t].c) notes[t].c = {};
    if (!notes[t].n) notes[t].n = {};
    return notes[t];
  }
  function checkCount(t) {
    var r = notes[t]; if (!r || !r.c) return 0;
    return CHECK_IDS.filter(function (id) { return r.c[id]; }).length;
  }
  function startedCount() {
    return Object.keys(notes).filter(function (t) {
      var r = notes[t];
      return checkCount(t) > 0 || (r.n && Object.keys(r.n).some(function (k) { return (r.n[k] || '').trim(); }));
    }).length;
  }
  function save(t) {
    if (t) rec(t).u = Date.now();
    try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); } catch (e) {}
    if (db) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(function () {
        try { db.doc('notes/v1').set({ records: notes, u: Date.now() }); } catch (e) {}
      }, 900);
    }
    paintStatus();
  }
  function connectSync() {
    if (!window.claude || !claude.use) return;
    claude.use('db').then(function (d) {
      if (!d) return;
      db = d;
      return d.doc('notes/v1').get().then(function (doc) {
        var remote = (doc && doc.records) || null;
        if (remote) {
          var changed = false;
          Object.keys(remote).forEach(function (t) {
            var r = remote[t], l = notes[t];
            if (!l || (r.u || 0) > (l.u || 0)) { notes[t] = r; changed = true; }
          });
          if (changed) {
            try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); } catch (e) {}
            render();
          }
        }
        var el = document.getElementById('syncstate');
        if (el) el.innerHTML = 'Notes saved <b>on this device and to your account</b>';
        paintStatus();
        return d.doc('prices/v1').get().then(function (pd) {
          if (pd && pd.bars && Object.keys(pd.bars).length && !Object.keys(bars).length) {
            bars = pd.bars;
            try { localStorage.setItem(BAR_KEY, JSON.stringify(bars)); } catch (e) {}
            render();
          }
        }).catch(function () {});
      });
    }).catch(function () {});
  }

  /* ---------------- price bars (optional, supplied by you) ---------------- */
  var BAR_KEY = 'tf.bars.v1';
  var bars = {};
  try { bars = JSON.parse(localStorage.getItem(BAR_KEY) || '{}') || {}; } catch (e) { bars = {}; }

  function saveBars() {
    try { localStorage.setItem(BAR_KEY, JSON.stringify(bars)); } catch (e) {}
    if (db) {
      clearTimeout(barTimer);
      barTimer = setTimeout(function () {
        try { db.doc('prices/v1').set({ bars: bars, u: Date.now() }); } catch (e) {}
      }, 900);
    }
  }
  var barTimer = null;

  function parseBars(text, fallbackTicker) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return { rows: {}, skipped: 0, err: 'Nothing to read.' };
    var delim = /\t/.test(lines[0]) ? '\t' : /;/.test(lines[0]) && !/,/.test(lines[0]) ? ';' : ',';
    var cells = lines.map(function (l) {
      return l.split(delim).map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
    });
    var head = cells[0].map(function (x) { return x.toLowerCase(); });
    var hasHeader = head.some(function (h) { return /^(date|close|adj close|adjclose|symbol|ticker|code|open|high|low|price|last)$/.test(h); });
    var iT = -1, iD = -1, iC = -1;
    if (hasHeader) {
      head.forEach(function (h, i) {
        if (iT < 0 && /^(symbol|ticker|code|stock)$/.test(h)) iT = i;
        if (iD < 0 && /^date|^time/.test(h)) iD = i;
        if (/^adj ?close$/.test(h)) iC = i;
        if (iC < 0 && /^(close|price|last)$/.test(h)) iC = i;
      });
      cells = cells.slice(1);
    }
    if (iC < 0) {
      var w = cells[0] ? cells[0].length : 0;
      if (w === 2) { iT = 0; iC = 1; }
      else if (w === 3) { iT = 0; iD = 1; iC = 2; }
      else if (w >= 5) {
        var firstIsText = cells[0] && isNaN(parseFloat(cells[0][0])) && !/^\d{4}-\d{2}-\d{2}/.test(cells[0][0]);
        if (firstIsText) { iT = 0; iD = 1; iC = 5; }
        else { iD = 0; iC = 4; }
      } else if (w === 1) { iC = 0; }
    }
    if (iC < 0) return { rows: {}, skipped: 0, err: 'Could not find a close-price column.' };
    var rows = {}, skipped = 0;
    cells.forEach(function (r) {
      var t = iT >= 0 ? (r[iT] || '').toUpperCase() : (fallbackTicker || '').toUpperCase();
      var px = parseFloat(String(r[iC] || '').replace(/[^0-9.\-]/g, ''));
      if (!t || !isFinite(px) || px <= 0) { skipped++; return; }
      var d = iD >= 0 ? r[iD] : '';
      (rows[t] = rows[t] || []).push({ d: d, c: px });
    });
    return { rows: rows, skipped: skipped, err: null };
  }

  function ingest(text, fallbackTicker) {
    var out = parseBars(text, fallbackTicker);
    if (out.err) return { n: 0, err: out.err };
    var known = {}, added = 0, unknown = [];
    ALL.forEach(function (c) { known[c.t.toUpperCase()] = c.t; });
    Object.keys(out.rows).forEach(function (t) {
      var real = known[t] || known[t.replace(/\.(SI|US)$/i, '')];
      if (!real) { unknown.push(t); return; }
      var list = out.rows[t];
      list.sort(function (a, b) { return String(a.d).localeCompare(String(b.d)); });
      var closes = list.map(function (x) { return x.c; }).slice(-90);
      var last = list[list.length - 1];
      bars[real] = { px: last.c, d: last.d || '', s: closes, n: list.length };
      added++;
    });
    if (added) saveBars();
    return { n: added, unknown: unknown, skipped: out.skipped, err: null };
  }

  function latestBarDate() {
    var d = '';
    Object.keys(bars).forEach(function (t) { if (bars[t].d && bars[t].d > d) d = bars[t].d; });
    return d;
  }

  /* Recompute the price-based multiples from YOUR close and the per-share fundamentals. */
  function adj(c) {
    var b = bars[c.t];
    if (!b || !b.px) return null;
    var px = b.px, M = c.M;
    var N = num(M.shares), eps = num(M.eps), bvps = num(M.bvps), fcfps = num(M.fcfps),
        dps = num(M.dps), rev = num(M.rev);
    var o = { px: px, d: b.d, s: b.s || [], n: b.n || 0 };
    o.pe = (eps && eps > 0) ? px / eps : null;
    o.pb = (bvps && bvps > 0) ? px / bvps : null;
    o.pfcf = (fcfps && fcfps > 0) ? px / fcfps : null;
    o.ps = (rev && N) ? px / (rev / N) : null;
    o.divy = (dps && dps > 0) ? (dps / px) * 100 : null;
    o.mcap = N ? px * N : null;
    o.vsHist = (o.pe && c.pe_med) ? Math.round((o.pe / c.pe_med - 1) * 100) : null;
    var oldPe = num(M.pe);
    o.peMove = (o.pe && oldPe) ? Math.round((o.pe / oldPe - 1) * 100) : null;
    return o;
  }

  /* ---------------- charts ---------------- */
  function barChart(rawVals, labels, opts) {
    opts = opts || {};
    var vals = rawVals.map(num);
    var pairs = [];
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] !== null && isFinite(vals[i]) && vals[i] > 0) pairs.push({ v: vals[i], l: labels[i] || '' });
    }
    pairs.reverse(); // oldest first
    if (pairs.length < 3) return '';
    var W = 330, H = 86, padT = 16, padB = 18, n = pairs.length;
    var max = Math.max.apply(null, pairs.map(function (p) { return p.v; })) * 1.12;
    var slot = W / n, bw = Math.min(30, slot * 0.54);
    var accent = opts.color || 'var(--ink-2)';
    var fmt = opts.fmt || function (v) { return v.toFixed(1); };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:352px;height:auto;display:block" role="img" aria-label="' + esc(opts.label || '') + '">';
    out += '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="var(--rule)" stroke-width="1"/>';
    pairs.forEach(function (p, idx) {
      var h = Math.max(2, (p.v / max) * (H - padT - padB));
      var x = idx * slot + (slot - bw) / 2, y = H - padB - h;
      var last = idx === n - 1;
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) +
        '" rx="3" fill="' + (last ? accent : 'var(--rule)') + '"><title>' + esc(p.l) + ': ' + esc(fmt(p.v)) + '</title></rect>';
      if (last || idx === 0) {
        out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle" font-size="10" font-family="IBM Plex Mono, monospace" fill="' + (last ? accent : 'var(--ink-3)') + '">' + esc(fmt(p.v)) + '</text>';
      }
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9.5" font-family="IBM Plex Sans, sans-serif" fill="var(--ink-3)">' + esc(p.l.replace('FY ', "'").replace('TTM', 'TTM').replace('Current', 'Now')) + '</text>';
    });
    out += '</svg>';
    return out;
  }

  function lineChart(vals, opts) {
    opts = opts || {};
    vals = (vals || []).filter(function (v) { return v !== null && isFinite(v); });
    if (vals.length < 4) return '';
    var W = 330, H = 64, padT = 10, padB = 12, padR = 52;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = (max - min) || (max * 0.02) || 1;
    var stepX = (W - padR) / (vals.length - 1);
    var y = function (v) { return padT + (1 - (v - min) / span) * (H - padT - padB); };
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + (i * stepX).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    var lastX = ((vals.length - 1) * stepX), lastY = y(vals[vals.length - 1]);
    var col = opts.color || 'var(--ink-2)';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:352px;height:auto;display:block" role="img" aria-label="' +
      esc(opts.label || 'price') + '">' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="3.2" fill="' + col + '"/>' +
      '<text x="' + (lastX + 6).toFixed(1) + '" y="' + (lastY + 3.5).toFixed(1) + '" font-size="10.5" font-family="IBM Plex Mono, monospace" fill="' + col + '">' +
      esc(vals[vals.length - 1].toFixed(2)) + '</text>' +
      '<title>' + vals.length + ' closes, ' + esc(min.toFixed(2)) + ' to ' + esc(max.toFixed(2)) + '</title></svg>';
  }

  /* ---------------- rulebook card ---------------- */
  function computed(c, key) {
    var M = c.M, n = num;
    if (key === 'spread') { var r = n(M.roic), w = n(M.wacc); return r !== null && w !== null ? { v: r - w, d: (r - w).toFixed(1) + ' pts' } : null; }
    if (key === 'rev5') return c.rev5 == null ? null : { v: c.rev5, d: c.rev5.toFixed(1) + '%' };
    if (key === 'rule40') { var g = c.rev5, f = n(M.fcfm); return (g != null && f != null) ? { v: g + f, d: Math.round(g + f) + ' (' + g.toFixed(0) + ' growth + ' + f.toFixed(0) + ' FCF margin)' } : null; }
    if (key === 'capexPct') { var cx = Math.abs(n(M.capex) || 0), rv = n(M.rev); return rv ? { v: (cx / rv) * 100, d: ((cx / rv) * 100).toFixed(1) + '% of revenue' } : null; }
    if (key === 'fcfConv') { var fc = n(M.fcf), ni = n(M.ni); return (fc && ni && ni > 0) ? { v: (fc / ni) * 100, d: Math.round((fc / ni) * 100) + '% of net income' } : null; }
    if (key === 'divCover') { var dp = n(M.dps), fp = n(M.fcfps); return (dp && fp && fp > 0) ? { v: (dp / fp) * 100, d: Math.round((dp / fp) * 100) + '% of free cash flow' } : null; }
    if (key === 'omRange') {
      var a = (series(c, 'om') || []).map(n).filter(function (x) { return x !== null; });
      return a.length >= 3 ? { v: null, d: Math.min.apply(null, a).toFixed(1) + '% to ' + Math.max.apply(null, a).toFixed(1) + '% over the period' } : null;
    }
    if (key === 'dpsTrend') {
      var dd = (series(c, 'dps') || []).map(n).filter(function (x) { return x !== null; });
      if (dd.length < 3) return null;
      var now = dd[0], then = dd[dd.length - 1];
      var word = now > then * 1.05 ? 'rising' : now < then * 0.95 ? 'falling' : 'flat';
      return { v: now >= then * 0.95 ? 1 : 0, d: word + ' (' + then + ' to ' + now + ')' };
    }
    if (key === 'topSeg') {
      if (!c.segs || !c.segs.length) return null;
      var tot = 0, top = 0, name = '';
      c.segs.forEach(function (sg) { var v = n(sg.v[0]); if (v && v > 0) { tot += v; if (v > top) { top = v; name = sg.n; } } });
      return tot ? { v: (top / tot) * 100, d: Math.round((top / tot) * 100) + '% from ' + name } : null;
    }
    return null;
  }

  function rbOf(c) {
    return (window.rulebookFor ? window.rulebookFor(c) : null) || window.RULEBOOK_DEFAULT || null;
  }
  /* If this industry's rulebook says a metric means little, say so where that metric appears. */
  function caution(rb, re) {
    if (!rb || !rb.ignore) return '';
    for (var i = 0; i < rb.ignore.length; i++) {
      if (re.test(rb.ignore[i])) {
        return '<p class="caution"><b>' + esc(rb.name) + ' rulebook:</b> ' + esc(rb.ignore[i]) +
          ' tells you little about this kind of business &mdash; use the rulebook measures at the top of this section instead.</p>';
      }
    }
    return '';
  }
  function rulebookCard(c) {
    var rb = rbOf(c);
    if (!rb) return '';
    var rows = rb.watch.map(function (w) {
      var got = null, disp = '', cls = 'na', extra = '';
      if (w.k) { var v = num(c.M[w.k]); if (v !== null) { got = v; disp = txt(c.M[w.k]); } }
      else if (w.c) { var r = computed(c, w.c); if (r) { got = r.v; disp = r.d; } }
      if (w.f) { disp = disp || 'not in this data'; extra = 'read it in the ' + w.f; }
      if (got !== null && w.ok) cls = w.ok(got) ? 'ok' : 'no';
      else if (got !== null) cls = 'have';
      return '<li class="rl"><span class="rl-dot ' + cls + '" aria-hidden="true"></span>' +
        '<span class="rl-l">' + esc(w.l) + '</span>' +
        '<span class="rl-v">' + esc(disp || '—') + '</span>' +
        '<span class="rl-t">' + esc(w.t) + (extra ? ' · ' + esc(extra) : '') + '</span></li>';
    }).join('');
    var ign = (rb.ignore || []).map(function (x) { return '<span class="tag ignore">' + esc(x) + '</span>'; }).join('');
    return '<div class="rulecard">' +
      '<div class="rulehead"><span class="rulebadge">Rulebook</span><b>' + esc(rb.name) + '</b>' +
      '<span class="rulelegend">&#9679; meets the rule of thumb &nbsp;&#9675; does not &nbsp;&#9678; read the filing</span></div>' +
      '<p class="ruledecides"><strong>What decides it:</strong> ' + esc(rb.decides) + '</p>' +
      '<ul class="rulelist">' + rows + '</ul>' +
      (ign ? '<p class="ruleignore"><strong>Means little here:</strong></p><div class="tagrow">' + ign + '</div>' : '') +
      '</div>';
  }

  /* ---------------- detail rendering ---------------- */
  function cell(label, value, sub, flag) {
    return '<div class="cell' + (flag ? ' flag-' + flag : '') + '"><dt>' + esc(label) + '</dt><dd>' + value +
      (sub ? '<small>' + sub + '</small>' : '') + '</dd></div>';
  }
  function item(c, id, question, hint, body) {
    var on = (notes[c.t] && notes[c.t].c && notes[c.t].c[id]) ? ' checked' : '';
    return '<div class="item"><input class="cbx" type="checkbox" id="' + c.t + '-' + id + '" data-t="' + esc(c.t) + '" data-id="' + id +
      '"' + on + ' aria-label="Mark as checked: ' + esc(question) + '"><div><p class="qn">' + esc(question) + '</p>' +
      (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') + body + '</div></div>';
  }
  function series(c, key) { return (c.S && c.S[key]) || []; }

  function finTable(c) {
    var yrs = c.fy || [];
    var unit = c.cur === 'SGD' ? 'S$m' : 'US$m';
    var rows = [
      ['Revenue (' + unit + ')', series(c, 'revenue'), 'plain'],
      ['Revenue growth', series(c, 'revg'), 'sign'],
      ['Gross margin', series(c, 'gm'), 'plain'],
      ['Operating margin', series(c, 'om'), 'plain'],
      ['Net margin', series(c, 'pm'), 'plain'],
      ['Free cash flow (' + unit + ')', series(c, 'fcf'), 'sign'],
      ['Earnings per share', series(c, 'eps'), 'sign'],
      ['Dividend per share', series(c, 'dps'), 'plain']
    ].filter(function (r) { return r[1] && r[1].length; });
    if (!rows.length) return '<p class="ans">No annual history available for this listing.</p>';
    var h = '<div class="scroller"><table class="fin"><thead><tr><th>Fiscal year</th>';
    yrs.forEach(function (y) { h += '<th>' + esc(y.replace('FY ', '')) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td>' + esc(r[0]) + '</td>';
      for (var i = 0; i < yrs.length; i++) {
        var v = r[1][i], cls = '';
        if (r[2] === 'sign') { var n2 = num(v); cls = n2 === null ? '' : n2 < 0 ? ' class="neg"' : ' class="pos"'; }
        h += '<td' + cls + '>' + esc(v === undefined || v === '' ? '—' : v) + '</td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function segTable(c) {
    if (!c.segs || !c.segs.length) return '';
    var yrs = (c.fy || []).slice(0, (c.segs[0].v || []).length);
    var unit = c.cur === 'SGD' ? 'S$m' : 'US$m';
    var tot = 0;
    c.segs.forEach(function (s) { var v = num(s.v[0]); if (v && v > 0) tot += v; });
    var h = '<div class="scroller"><table class="fin"><thead><tr><th>Reported segment (' + unit + ')</th>';
    yrs.forEach(function (y) { h += '<th>' + esc(y.replace('FY ', '')) + '</th>'; });
    h += '<th>Share</th></tr></thead><tbody>';
    c.segs.forEach(function (s) {
      h += '<tr><td>' + esc(s.n) + '</td>';
      for (var i = 0; i < yrs.length; i++) h += '<td>' + esc(s.v[i] === undefined ? '—' : s.v[i]) + '</td>';
      var v0 = num(s.v[0]);
      h += '<td>' + (tot && v0 && v0 > 0 ? Math.round((v0 / tot) * 100) + '%' : '—') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function noteField(c, id, label, ph, big) {
    var v = esc((notes[c.t] && notes[c.t].n && notes[c.t].n[id]) || '');
    var el = big
      ? '<textarea id="n-' + c.t + '-' + id + '" data-t="' + esc(c.t) + '" data-n="' + id + '" placeholder="' + esc(ph) + '">' + v + '</textarea>'
      : '<input id="n-' + c.t + '-' + id + '" data-t="' + esc(c.t) + '" data-n="' + id + '" value="' + v + '" placeholder="' + esc(ph) + '">';
    return '<span class="note"><label for="n-' + c.t + '-' + id + '">' + esc(label) + '</label>' + el + '</span>';
  }

  function links(c) {
    var out = '<div class="srcbar">';
    if (c.mkt === 'US') {
      out += '<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=' + encodeURIComponent(c.t) +
        '&type=10-K&dateb=&owner=include&count=40" target="_blank" rel="noopener">SEC EDGAR filings</a>';
    } else {
      out += '<a href="https://www.sgx.com/securities/equities/' + encodeURIComponent(c.t) + '" target="_blank" rel="noopener">SGX company page</a>';
      out += '<a href="https://www.sgx.com/securities/company-announcements?value=' + encodeURIComponent(c.t) + '" target="_blank" rel="noopener">SGX announcements</a>';
    }
    out += '<a href="' + (c.mkt === 'US' ? 'https://stockanalysis.com/stocks/' + encodeURIComponent(c.t.toLowerCase()) + '/'
      : 'https://stockanalysis.com/quote/sgx/' + encodeURIComponent(c.t) + '/') + '" target="_blank" rel="noopener">Source figures</a>';
    if (c.site) out += '<a href="https://' + esc(c.site) + '" target="_blank" rel="noopener">' + esc(c.site) + '</a>';
    out += '<button class="copybtn" data-t="' + esc(c.t) + '">Copy my page for ' + esc(c.t) + '</button>';
    return out + '</div>';
  }

  function detail(c) {
    var M = c.M, accent = c.list === 'US' ? 'var(--us)' : 'var(--sg)';
    var rb = rbOf(c);
    var p = peersOf(c);
    var h = '<div class="detail">';

    /* 1 — business */
    h += '<section class="sec"><div class="sechead"><span class="secnum">1</span><h3 class="sectitle">The business</h3></div>';
    h += item(c, 's1a', 'What does it sell, and to whom?', 'One sentence, no jargon.',
      '<p class="ans">' + esc(c.q.what || c.desc) + '</p>');
    h += item(c, 's1b', 'Where does revenue actually come from?', 'The biggest segment is the company.',
      '<p class="ans">' + esc(c.q.rev || '') + '</p>' + segTable(c));
    h += item(c, 's1c', 'How does it make money on each sale?', 'Gross margin. Understand why it is high or low.',
      '<p class="ans">' + esc(c.q.gm || '') + '</p>' + caution(rb, /Gross margin/) + '<div class="grid">' +
      cell('Gross margin', txt(M.gm)) + cell('Operating margin', txt(M.om)) + cell('Net margin', txt(M.pm)) +
      cell('Revenue per employee', txt(M.rps)) + '</div>');
    h += item(c, 's1d', 'Who runs it, and do they own shares?', 'Insider ownership. Check pay structure in the proxy statement.',
      '<p class="ans">' + esc(c.q.mgmt || '') + '</p><div class="grid">' +
      cell('Chief executive', '<span style="font-size:13px">' + esc(txt(c.ceo)) + '</span>') +
      cell('Owned by insiders', txt(M.insiders), null, num(M.insiders) >= 5 ? 'good' : null) +
      cell('Owned by institutions', txt(M.inst)) +
      cell('Founded', txt(c.founded), esc(c.country || '')) +
      cell('Employees', txt(M.employees)) + '</div>');
    h += '</section>';

    /* 2 — numbers */
    var roic = num(M.roic), wacc = num(M.wacc), spread = (roic !== null && wacc !== null) ? roic - wacc : null;
    var nde = num(M.debitda), icov = num(M.icov), shchg = num(M.shchg);
    h += '<section class="sec"><div class="sechead"><span class="secnum">2</span><h3 class="sectitle">The numbers, last five years</h3></div>';
    h += rulebookCard(c);
    h += item(c, 's2a', 'Revenue growth', 'Direction and consistency matter more than any single year.',
      '<p class="ans">' + (c.rev5 !== null && c.rev5 !== undefined
        ? 'Revenue has compounded at <strong>' + c.rev5.toFixed(1) + '% a year</strong> over the period below. Read across the row, not at the last number: consistency is the signal.'
        : 'Not enough annual history here to compute a five-year growth rate. Read the row below.') + '</p>' +
      caution(rb, /Revenue growth/) + finTable(c) +
      '<figure class="chart"><figcaption>Revenue by fiscal year (' + (c.cur === 'SGD' ? 'S$m' : 'US$m') + ')</figcaption>' +
      barChart(series(c, 'revenue'), c.fy || [], { color: accent, label: 'Revenue by year', fmt: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0); } }) + '</figure>');
    h += item(c, 's2b', 'Operating and net margin', 'Rising, flat, or eroding?',
      '<div class="grid">' + cell('Operating margin', txt(M.om)) + cell('Net margin', txt(M.pm)) +
      cell('EBITDA margin', txt(M.ebitdam)) + cell('Effective tax rate', txt(M.tax)) +
      '</div><p class="hint" style="margin-top:8px">Compare against the margin rows in the five-year table above.</p>');
    h += item(c, 's2c', 'Free cash flow', 'Operating cash flow minus capex. Profit can be an accounting opinion; cash is not.',
      caution(rb, /Free cash flow/) + '<div class="grid">' + cell('Operating cash flow', money(num(M.ocf), c.cur)) +
      cell('Capital expenditure', money(num(M.capex), c.cur)) +
      cell('Free cash flow', money(num(M.fcf), c.cur), null, num(M.fcf) > 0 ? 'good' : 'bad') +
      cell('FCF margin', txt(M.fcfm)) +
      cell('FCF yield', txt(M.fcfy)) + '</div>');
    h += item(c, 's2d', 'Return on invested capital', 'Does reinvested money earn more than it costs?',
      caution(rb, /ROIC/) + '<div class="grid">' + cell('ROIC', txt(M.roic), null, roic >= 15 ? 'good' : roic !== null && roic < 7 ? 'warn' : null) +
      cell('Cost of capital (WACC)', txt(M.wacc)) +
      cell('Spread over cost', spread === null ? '—' : pct(spread), spread === null ? '' : (spread > 0 ? 'Creating value' : 'Destroying value'), spread === null ? null : spread > 0 ? 'good' : 'bad') +
      cell('Return on equity', txt(M.roe)) + cell('Return on capital employed', txt(M.roce)) + '</div>');
    h += item(c, 's2e', 'Debt and interest cover', 'Net debt / EBITDA, and EBIT / interest expense.',
      caution(rb, /Debt \/ EBITDA/) + '<div class="grid">' + cell('Total debt', money(num(M.debt), c.cur)) +
      cell('Net cash (debt)', money(num(M.netcash), c.cur), null, num(M.netcash) > 0 ? 'good' : null) +
      cell('Debt / EBITDA', txt(M.debitda), null, nde === null ? null : nde > 3.5 ? 'bad' : nde > 2.5 ? 'warn' : 'good') +
      cell('Interest coverage', txt(M.icov), null, icov === null ? null : icov < 3 ? 'warn' : 'good') +
      cell('Debt / equity', txt(M.de)) + cell('Current ratio', txt(M.current)) +
      (M.altman ? cell('Altman Z-score', txt(M.altman), 'Distress screen') : '') + '</div>');
    h += item(c, 's2f', 'Share count', 'Rising count quietly dilutes you.',
      '<div class="grid">' + cell('Shares outstanding', txt(M.shares)) +
      cell('Change over the year', txt(M.shchg), shchg === null ? '' : shchg < 0 ? 'Buying back stock' : 'Diluting you', shchg === null ? null : shchg < -0.3 ? 'good' : shchg > 1.5 ? 'bad' : null) +
      cell('Buyback yield', txt(M.buyback)) +
      cell('Dividend yield', txt(M.divy)) + cell('Payout ratio', txt(M.payout)) +
      (M.divgrow ? cell('Years of dividend growth', txt(M.divgrow)) : '') + '</div>');
    h += '</section>';

    /* 3 — competition */
    var tags = (c.q.moatTags || []).map(function (t) {
      return '<span class="tag ' + (t === 'None' ? 'none' : 'moat') + '">' + esc(t) + '</span>';
    }).join('');
    h += '<section class="sec"><div class="sechead"><span class="secnum">3</span><h3 class="sectitle">The competitive position</h3></div>';
    h += item(c, 's3a', 'Who are the three main competitors?', '', '<p class="ans">' + esc(c.q.comp || '') + '</p>');
    h += item(c, 's3b', 'What stops them taking the customers?', 'Brand, switching costs, network effects, scale, regulation. If nothing, margins will fall.',
      '<p class="ans">' + esc(c.q.moat || '') + '</p><div class="tagrow">' + tags + '</div>');
    h += item(c, 's3c', 'Is the industry growing or shrinking?', '', '<p class="ans">' + esc(c.q.ind || '') + '</p>');
    h += item(c, 's3d', 'What single event would damage this business most?', 'Regulation, a key customer leaving, input cost spike, technology shift.',
      '<p class="ans">' + esc(c.q.risk || '') + '</p>');
    h += '</section>';

    /* 4 — price */
    var vs = c.vs_hist, peerPE = p && p.pe, myPE = c.peN;
    var vsPeer = (peerPE && myPE) ? Math.round((myPE / peerPE - 1) * 100) : null;
    h += '<section class="sec"><div class="sechead"><span class="secnum">4</span><h3 class="sectitle">The price</h3></div>';
    var A = adj(c);
    var priceBlock = '';
    if (A) {
      var f2 = function (v) { return v === null ? '—' : v.toFixed(v < 10 ? 2 : 1); };
      priceBlock = '<div class="atprice"><div class="apthead"><span class="aptbadge">At your price</span>' +
        '<b>' + esc(c.cur === 'SGD' ? 'S$' : 'US$') + A.px.toFixed(A.px < 10 ? 3 : 2) + '</b>' +
        (A.d ? '<span class="aptdate">close of ' + esc(A.d) + '</span>' : '') +
        (A.peMove !== null ? '<span class="aptdate">P/E ' + (A.peMove > 0 ? 'up ' : 'down ') + Math.abs(A.peMove) + '% vs the compiled figure</span>' : '') +
        '</div><div class="grid">' +
        cell('P/E', f2(A.pe), 'price / EPS ' + esc(txt(M.eps))) +
        cell('Price / book', f2(A.pb), 'book value ' + esc(txt(M.bvps))) +
        cell('Price / free cash flow', f2(A.pfcf), 'FCF/share ' + esc(txt(M.fcfps))) +
        cell('Price / sales', f2(A.ps)) +
        cell('Dividend yield', A.divy === null ? '—' : A.divy.toFixed(2) + '%', 'DPS ' + esc(txt(M.dps))) +
        cell('Market cap', money(A.mcap, c.cur), esc(txt(M.shares)) + ' shares') +
        '</div>' + (A.s && A.s.length > 3 ? '<figure class="chart"><figcaption>Your last ' + A.s.length + ' closes</figcaption>' +
          lineChart(A.s, { color: accent, label: 'Recent closes' }) + '</figure>' : '') +
        '<p class="hint" style="margin-top:8px">Computed from your close times the per-share figures from the filings. EV-based multiples below are not recalculated — enterprise value needs the debt and cash of the same date.</p></div>';
    }
    h += item(c, 's4a', 'Current valuation multiple', 'P/E, EV/EBITDA, or P/FCF. Use what fits the industry.',
      caution(rb, /P\/E/) + priceBlock +
      '<p class="hint"' + (A ? '' : ' hidden') + '>As compiled on ' + esc(window.AS_OF || '') + ':</p>' +
      '<div class="grid">' + cell('P/E', txt(M.pe)) + cell('Forward P/E', txt(M.fpe)) +
      cell('EV / EBITDA', txt(M.evebitda)) + cell('Price / free cash flow', txt(M.pfcf)) +
      cell('Price / book', txt(M.pb)) + cell('Price / sales', txt(M.ps)) +
      cell('Market cap', money(c.mcapN, c.cur)) + cell('Enterprise value', txt(M.ev)) + '</div>');
    var vsUse = (A && A.vsHist !== null) ? A.vsHist : vs;
    h += item(c, 's4b', 'Versus its own five-year history', '',
      caution(rb, /P\/E/) + '<p class="ans">' + (vsUse === null || vsUse === undefined
        ? 'Not enough clean history to compare. Check the multiple against the years below yourself.'
        : 'It trades at <strong>' + (vsUse > 0 ? vsUse + '% above' : Math.abs(vsUse) + '% below') + '</strong> its own five-year median P/E of ' + c.pe_med +
          (A && A.vsHist !== null ? ', using your ' + esc(A.d || 'latest') + ' close.' : '.')) + '</p>' +
      '<figure class="chart"><figcaption>P/E ratio by fiscal year</figcaption>' +
      barChart((c.R && c.R.pe) || [], c.ry || [], { color: accent, label: 'P/E by year', fmt: function (v) { return v.toFixed(0); } }) + '</figure>');
    h += item(c, 's4c', 'Versus its competitors', '',
      '<p class="ans">' + (p && peerPE
        ? 'Against the other <strong>' + p.n + ' ' + esc(c.secKey) + '</strong> companies on this list' + (c.list === 'US' ? ' in the S&amp;P 100' : ' in Singapore') +
          ', the median P/E is <strong>' + peerPE.toFixed(1) + '</strong>' +
          (vsPeer === null ? '.' : ' — this one is ' + (vsPeer > 0 ? vsPeer + '% more expensive' : Math.abs(vsPeer) + '% cheaper') + '.') +
          ' Median return on capital in that group is ' + (p.roic === null ? 'not available' : p.roic.toFixed(1) + '%') +
          ', median dividend yield ' + (p.div === null ? 'not available' : p.div.toFixed(1) + '%') + '.'
        : 'Too few companies in this sector on the list to form a useful median. Compare it against named competitors yourself.') + '</p>');
    h += item(c, 's4d', 'What growth rate does this price imply?', 'A great company at a demanding price is still a bad buy.',
      '<p class="ans">' + esc(c.q.implied || '') + '</p><div class="grid">' +
      cell('PEG ratio', txt(M.peg)) + cell('Earnings yield', txt(M.ey)) +
      cell('Forecast revenue growth', txt(M.revf3), 'Analyst 3-year') +
      cell('Forecast EPS growth', txt(M.epsf3), 'Analyst 3-year') +
      cell('Analyst view', '<span style="font-size:13px">' + esc(txt(M.cons)) + '</span>', M.analysts ? esc(M.analysts) + ' analysts' : '') + '</div>' +
      '<p class="ans" style="margin-top:10px"><strong>The argument.</strong> ' + esc(c.q.debate || '') + '</p>');
    h += '</section>';

    /* 5 — before you buy */
    h += '<section class="sec"><div class="sechead"><span class="secnum">5</span><h3 class="sectitle">Before you click buy</h3></div>';
    h += item(c, 's5a', 'Why is the price wrong?', 'Write it in two sentences. If you cannot, do not buy.',
      noteField(c, 'why', 'Your answer', 'The market is assuming… but I think… because…', true));
    h += item(c, 's5b', 'What would prove me wrong?', 'Name specific, observable things. Not the price falls.',
      '<p class="hint">Things worth watching for this company: ' + esc(c.q.disprove || '') + '</p>' +
      noteField(c, 'disprove', 'Your answer', 'I will know I am wrong if…', true));
    h += item(c, 's5c', 'At what point do I sell?', 'Decide now. You will rationalise later.',
      noteField(c, 'sell', 'Your answer', 'I sell if… (a business event, not a share price)', true));
    h += item(c, 's5d', 'Position size', 'How much of the portfolio, and can I accept losing all of it?',
      noteField(c, 'size', 'Your answer', 'e.g. 4% of the portfolio; yes, I could lose it all', false));
    h += item(c, 's5e', 'Time horizon', '',
      noteField(c, 'horizon', 'Your answer', 'e.g. five years, reviewed each annual report', false));
    h += links(c);
    h += '</section></div>';
    return h;
  }

  /* ---------------- row rendering ---------------- */
  function pips(c) {
    var f = c.flags || {}, out = [];
    if (!f.profit) out.push(['bad', 'Lossmaking']);
    if (f.netcash) out.push(['good', 'Net cash']);
    if (f.highroic) out.push(['good', 'ROIC 15%+']);
    if (f.growth) out.push(['good', 'Grower']);
    if (f.buyback) out.push(['good', 'Buybacks']);
    if (f.diluting) out.push(['warn', 'Diluting']);
    if (f.cheapvshist) out.push(['', 'Below own P/E']);
    if (f.richvshist) out.push(['warn', 'Above own P/E']);
    if (!f.fcfpos) out.push(['warn', 'No free cash']);
    return out.slice(0, 3).map(function (p) {
      return '<span class="pip ' + p[0] + '">' + p[1] + '</span>';
    }).join('');
  }
  function progressDot(t) {
    var n = checkCount(t);
    if (!n) return '<span class="progdot" title="No checks ticked"></span>';
    if (n >= TOTAL_CHECKS) return '<span class="progdot done" title="All checks ticked"></span>';
    return '<span class="progdot part" style="--p:' + Math.round((n / TOTAL_CHECKS) * 100) + '%" title="' + n + ' of ' + TOTAL_CHECKS + ' checked"></span>';
  }
  function rowHTML(c, idx) {
    var A = adj(c);
    var peCell = A && A.pe ? '<span class="adjv" title="From your ' + esc(A.d || 'supplied') + ' close">' + A.pe.toFixed(1) + '</span>' : txt(c.M.pe);
    var mcCell = A && A.mcap ? '<span class="adjv" title="From your ' + esc(A.d || 'supplied') + ' close">' + money(A.mcap, c.cur) + '</span>' : money(c.mcapN, c.cur);
    var dyCell = A && A.divy !== null ? '<span class="adjv" title="From your ' + esc(A.d || 'supplied') + ' close">' + A.divy.toFixed(2) + '%</span>' : txt(c.M.divy);
    return '<article class="row" data-mkt="' + (c.list === 'SG' ? 'SGX' : 'US') + '" data-t="' + esc(c.t) + '">' +
      '<button class="rowhead" aria-expanded="false">' +
      '<span class="rk">' + (idx + 1) + '</span>' +
      '<span class="nm"><span class="tick">' + esc(c.t) + '</span>' +
      '<span class="coname">' + progressDot(c.t) + esc(c.n) + '</span>' +
      '<span class="subline">' + esc(c.sec || '') + (c.indu ? ' · ' + esc(c.indu) : '') + '</span></span>' +
      '<span class="num strong">' + mcCell + '<small>Mkt cap</small></span>' +
      '<span class="num">' + peCell + '<small>P/E</small></span>' +
      '<span class="num c-yield">' + dyCell + '<small>Yield</small></span>' +
      '<span class="num c-roic">' + txt(c.M.roic) + '<small>ROIC</small></span>' +
      '<span class="num c-rev">' + (c.rev5 === null || c.rev5 === undefined ? '—' : c.rev5.toFixed(1) + '%') + '<small>5y rev</small></span>' +
      '<span class="pips c-pips">' + pips(c) + '</span>' +
      '<svg class="chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>' +
      '</button></article>';
  }

  /* ---------------- state + filtering ---------------- */
  var state = { q: '', market: 'all', sectors: [], flags: [], moats: [], prog: 'any', sort: 'rank' };
  var FLAG_DEFS = [
    ['profit', 'Profitable'], ['fcfpos', 'Positive free cash flow'], ['netcash', 'Net cash'],
    ['divpay', 'Pays a dividend'], ['buyback', 'Buying back shares'], ['highroic', 'ROIC 15% or better'],
    ['growth', 'Revenue CAGR 10%+'], ['cheapvshist', 'Below its own 5-year P/E']
  ];

  function matches(c) {
    if (state.market === 'us' && c.list !== 'US') return false;
    if (state.market === 'sg' && c.list !== 'SG') return false;
    if (state.sectors.length && state.sectors.indexOf(c.secKey) < 0) return false;
    for (var i = 0; i < state.flags.length; i++) if (!c.flags[state.flags[i]]) return false;
    if (state.moats.length) {
      var t = c.q.moatTags || [];
      for (var j = 0; j < state.moats.length; j++) if (t.indexOf(state.moats[j]) < 0) return false;
    }
    if (state.prog !== 'any') {
      var n = checkCount(c.t), started = n > 0 || hasNotes(c.t);
      if (state.prog === 'started' && !started) return false;
      if (state.prog === 'none' && started) return false;
      if (state.prog === 'done' && n < TOTAL_CHECKS) return false;
    }
    if (state.q) {
      var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var k = 0; k < terms.length; k++) if (c.hay.indexOf(terms[k]) < 0) return false;
    }
    return true;
  }
  function hasNotes(t) {
    var r = notes[t];
    return !!(r && r.n && Object.keys(r.n).some(function (k) { return (r.n[k] || '').trim(); }));
  }
  function livePE(c) { var A = adj(c); var v = (A && A.pe) ? A.pe : c.peN; return (v === null || v <= 0) ? 1e9 : v; }
  function liveDiv(c) { var A = adj(c); return (A && A.divy !== null) ? A.divy : (c.divN || 0); }
  function sortList(list) {
    var s = state.sort;
    var by = {
      rank: function (a, b) { return (b.mcapN || 0) - (a.mcapN || 0); },
      pe: function (a, b) { return livePE(a) - livePE(b); },
      yield: function (a, b) { return liveDiv(b) - liveDiv(a); },
      roic: function (a, b) { return (b.roicN === null ? -1e9 : b.roicN) - (a.roicN === null ? -1e9 : a.roicN); },
      growth: function (a, b) { return (b.growthN === null || b.growthN === undefined ? -1e9 : b.growthN) - (a.growthN === null || a.growthN === undefined ? -1e9 : a.growthN); },
      vshist: function (a, b) { return (a.vs_hist === null || a.vs_hist === undefined ? 1e9 : a.vs_hist) - (b.vs_hist === null || b.vs_hist === undefined ? 1e9 : b.vs_hist); },
      name: function (a, b) { return a.n.localeCompare(b.n); }
    }[s];
    return list.slice().sort(by);
  }

  var ledger = document.getElementById('ledger');
  var openTickers = {};

  function render() {
    var list = sortList(ALL.filter(matches));
    if (!list.length) {
      ledger.innerHTML = '<p class="empty">Nothing matches that. Try fewer filters, or search for a business instead of a ticker &mdash; <em>palm oil</em>, <em>data centre</em>, <em>insurance</em>.</p>';
    } else {
      ledger.innerHTML = list.map(rowHTML).join('');
      Object.keys(openTickers).forEach(function (t) {
        var row = ledger.querySelector('.row[data-t="' + cssEsc(t) + '"]');
        if (row) expand(row, true);
      });
    }
    document.getElementById('showing').innerHTML = 'Showing <b>' + list.length + '</b> of ' + ALL.length + ' companies &middot; 23 checks each';
    paintStatus();
    var n = state.sectors.length + state.flags.length + state.moats.length + (state.prog !== 'any' ? 1 : 0);
    var fc = document.getElementById('fcount');
    fc.hidden = !n; fc.textContent = n;
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function paintStatus() {
    var nb = Object.keys(bars).length;
    var pe = document.getElementById('pricestate');
    if (pe) {
      var d = latestBarDate();
      pe.innerHTML = nb
        ? 'Prices <b>yours' + (d ? ', to ' + esc(d) : '') + '</b> for ' + nb + ' of ' + ALL.length
        : 'Prices <b>not loaded</b> — multiples are as compiled';
    }
    var started = startedCount();
    document.getElementById('notestat').innerHTML = started
      ? 'Your notes: <b>' + started + '</b> ' + (started === 1 ? 'company' : 'companies') + ' started'
      : 'Tick a box or write a note and it saves automatically';
  }

  function expand(row, silent) {
    var t = row.getAttribute('data-t');
    var c = ALL.filter(function (x) { return x.t === t; })[0];
    if (!c) return;
    if (!row.querySelector('.detail')) row.insertAdjacentHTML('beforeend', detail(c));
    row.classList.add('open');
    row.querySelector('.rowhead').setAttribute('aria-expanded', 'true');
    openTickers[t] = 1;
    if (!silent) history.replaceState(null, '', '#' + t);
  }
  function collapse(row) {
    var t = row.getAttribute('data-t');
    row.classList.remove('open');
    row.querySelector('.rowhead').setAttribute('aria-expanded', 'false');
    var d = row.querySelector('.detail');
    if (d) d.remove();
    delete openTickers[t];
  }

  /* ---------------- filter panel ---------------- */
  function buildPanel() {
    var h = '';
    h += '<div class="fgroup"><span class="flabel">Sector</span>';
    SECTOR_NAMES.forEach(function (s) {
      h += '<button class="chip" data-kind="sector" data-v="' + esc(s) + '" aria-pressed="false">' + esc(s) + '</button>';
    });
    h += '<button class="resetbtn" id="resetall">Clear everything</button></div>';
    h += '<div class="fgroup"><span class="flabel">Quality</span>';
    FLAG_DEFS.forEach(function (f) {
      h += '<button class="chip" data-kind="flag" data-v="' + f[0] + '" aria-pressed="false">' + esc(f[1]) + '</button>';
    });
    h += '</div><div class="fgroup"><span class="flabel">Moat</span>';
    MOAT_TAGS.forEach(function (m) {
      h += '<button class="chip" data-kind="moat" data-v="' + esc(m) + '" aria-pressed="false">' + esc(m) + '</button>';
    });
    h += '</div><div class="fgroup"><span class="flabel">My checklist</span>';
    [['any', 'All'], ['none', 'Not started'], ['started', 'Started'], ['done', 'All 23 ticked']].forEach(function (p) {
      h += '<button class="chip" data-kind="prog" data-v="' + p[0] + '" aria-pressed="' + (p[0] === 'any') + '">' + esc(p[1]) + '</button>';
    });
    h += '</div>';
    document.getElementById('filterpanel').innerHTML = h;
  }

  /* ---------------- events ---------------- */
  document.getElementById('filterbtn').addEventListener('click', function () {
    var p = document.getElementById('filterpanel');
    p.hidden = !p.hidden;
    this.setAttribute('aria-expanded', String(!p.hidden));
  });
  document.getElementById('filterpanel').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (b) {
      var kind = b.getAttribute('data-kind'), v = b.getAttribute('data-v');
      if (kind === 'prog') {
        state.prog = v;
        this.querySelectorAll('[data-kind="prog"]').forEach(function (x) {
          x.setAttribute('aria-pressed', String(x.getAttribute('data-v') === v));
        });
      } else {
        var arr = kind === 'sector' ? state.sectors : kind === 'flag' ? state.flags : state.moats;
        var i = arr.indexOf(v);
        if (i < 0) { arr.push(v); b.setAttribute('aria-pressed', 'true'); }
        else { arr.splice(i, 1); b.setAttribute('aria-pressed', 'false'); }
      }
      render();
    }
    if (e.target.id === 'resetall') {
      state.sectors = []; state.flags = []; state.moats = []; state.prog = 'any';
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x.getAttribute('data-kind') === 'prog' && x.getAttribute('data-v') === 'any'));
      });
      render();
    }
  });
  var qEl = document.getElementById('q'), qTimer;
  qEl.addEventListener('input', function () {
    document.getElementById('clearq').hidden = !this.value;
    clearTimeout(qTimer);
    var v = this.value;
    qTimer = setTimeout(function () { state.q = v.trim(); render(); }, 130);
  });
  document.getElementById('clearq').addEventListener('click', function () {
    qEl.value = ''; state.q = ''; this.hidden = true; render(); qEl.focus();
  });
  [['m-all', 'all'], ['m-us', 'us'], ['m-sg', 'sg']].forEach(function (pair) {
    document.getElementById(pair[0]).addEventListener('click', function () {
      state.market = pair[1];
      ['m-all', 'm-us', 'm-sg'].forEach(function (id) {
        document.getElementById(id).setAttribute('aria-pressed', String(id === pair[0]));
      });
      render();
    });
  });
  document.getElementById('sort').addEventListener('change', function () { state.sort = this.value; render(); });

  document.getElementById('pricebtn').addEventListener('click', function () {
    var p = document.getElementById('pricepanel');
    p.hidden = !p.hidden;
    this.setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) document.getElementById('pastebars').focus();
  });
  document.getElementById('loadbars').addEventListener('click', function () {
    var ta = document.getElementById('pastebars');
    var tk = (document.getElementById('bartick').value || '').trim();
    var res = ingest(ta.value, tk);
    var msg = document.getElementById('barmsg');
    if (res.err) { msg.className = 'barmsg bad'; msg.textContent = res.err; return; }
    if (!res.n) {
      msg.className = 'barmsg bad';
      msg.textContent = 'No rows matched a ticker on this list.' +
        (res.unknown && res.unknown.length ? ' Not recognised: ' + res.unknown.slice(0, 6).join(', ') : '') +
        ' If your file has no ticker column, put the ticker in the box on the left.';
      return;
    }
    msg.className = 'barmsg ok';
    msg.textContent = 'Loaded ' + res.n + (res.n === 1 ? ' company' : ' companies') +
      (res.unknown && res.unknown.length ? ' · ignored ' + res.unknown.length + ' unknown ticker' + (res.unknown.length === 1 ? '' : 's') : '') + '.';
    ta.value = '';
    render();
  });
  document.getElementById('clearbars').addEventListener('click', function () {
    bars = {}; saveBars();
    document.getElementById('barmsg').textContent = 'Cleared. Multiples are back to the compiled figures.';
    document.getElementById('barmsg').className = 'barmsg';
    render();
  });

  ledger.addEventListener('click', function (e) {
    var head = e.target.closest('.rowhead');
    if (head) {
      var row = head.closest('.row');
      if (row.classList.contains('open')) collapse(row); else expand(row);
      return;
    }
    var cp = e.target.closest('.copybtn');
    if (cp) {
      var c = ALL.filter(function (x) { return x.t === cp.getAttribute('data-t'); })[0];
      copyPage(c, cp);
    }
  });
  ledger.addEventListener('change', function (e) {
    var cb = e.target.closest('.cbx');
    if (!cb) return;
    var t = cb.getAttribute('data-t'), id = cb.getAttribute('data-id');
    rec(t).c[id] = cb.checked;
    if (!cb.checked) delete rec(t).c[id];
    save(t);
    var row = ledger.querySelector('.row[data-t="' + cssEsc(t) + '"] .coname .progdot');
    if (row) row.outerHTML = progressDot(t);
  });
  ledger.addEventListener('input', function (e) {
    var f = e.target.closest('[data-n]');
    if (!f) return;
    var t = f.getAttribute('data-t');
    rec(t).n[f.getAttribute('data-n')] = f.value;
    clearTimeout(f._tm);
    f._tm = setTimeout(function () { save(t); }, 500);
  });

  function copyPage(c, btn) {
    if (!c) return;
    var r = notes[c.t] || { c: {}, n: {} };
    var L = [];
    L.push(c.n + ' (' + c.t + ') — ' + (c.list === 'US' ? 'S&P 500 top 100' : 'Singapore top 100') + ' — ' + (c.sec || ''));
    L.push('Market cap ' + money(c.mcapN, c.cur) + ' · P/E ' + txt(c.M.pe) + ' · Yield ' + txt(c.M.divy) + ' · ROIC ' + txt(c.M.roic));
    L.push('');
    L.push('1. THE BUSINESS');
    L.push('What it sells: ' + (c.q.what || ''));
    L.push('Revenue mix: ' + (c.q.rev || ''));
    L.push('Margin: ' + (c.q.gm || ''));
    L.push('Management: ' + (c.q.mgmt || '') + ' CEO on file: ' + txt(c.ceo) + '. Insiders ' + txt(c.M.insiders) + '.');
    L.push('');
    L.push('2. THE NUMBERS');
    L.push('5-year revenue CAGR ' + (c.rev5 === null || c.rev5 === undefined ? 'n/a' : c.rev5 + '%') +
      ' · Operating margin ' + txt(c.M.om) + ' · Net margin ' + txt(c.M.pm) +
      ' · FCF ' + money(num(c.M.fcf), c.cur) + ' · ROIC ' + txt(c.M.roic) + ' vs WACC ' + txt(c.M.wacc) +
      ' · Debt/EBITDA ' + txt(c.M.debitda) + ' · Share count change ' + txt(c.M.shchg));
    L.push('');
    L.push('3. COMPETITIVE POSITION');
    L.push('Competitors: ' + (c.q.comp || ''));
    L.push('Moat: ' + (c.q.moat || '') + ' [' + (c.q.moatTags || []).join(', ') + ']');
    L.push('Industry: ' + (c.q.ind || ''));
    L.push('Biggest risk: ' + (c.q.risk || ''));
    L.push('');
    L.push('4. THE PRICE');
    L.push('P/E ' + txt(c.M.pe) + ' (5-yr median ' + txt(c.pe_med) + ') · EV/EBITDA ' + txt(c.M.evebitda) + ' · P/FCF ' + txt(c.M.pfcf));
    L.push('Implied: ' + (c.q.implied || ''));
    L.push('The argument: ' + (c.q.debate || ''));
    L.push('');
    L.push('5. BEFORE I BUY (my answers)');
    L.push('Why the price is wrong: ' + ((r.n && r.n.why) || '—'));
    L.push('What would prove me wrong: ' + ((r.n && r.n.disprove) || '—'));
    L.push('Watch for: ' + (c.q.disprove || ''));
    L.push('When I sell: ' + ((r.n && r.n.sell) || '—'));
    L.push('Position size: ' + ((r.n && r.n.size) || '—'));
    L.push('Time horizon: ' + ((r.n && r.n.horizon) || '—'));
    L.push('');
    L.push('Checks ticked: ' + checkCount(c.t) + ' of ' + TOTAL_CHECKS);
    L.push('Figures from stockanalysis.com. Verify against primary filings before acting.');
    var text = L.join('\n');
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
      setTimeout(function () { btn.textContent = old; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(text, done); });
    } else fallback(text, done);
  }
  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); done(ok);
  }

  /* ---------------- boot ---------------- */
  document.getElementById('asof').textContent = window.AS_OF || 'September 2026';
  buildPanel();
  render();
  var hash = (location.hash || '').replace('#', '');
  if (hash) {
    var row = ledger.querySelector('.row[data-t="' + cssEsc(hash) + '"]');
    if (row) { expand(row, true); row.scrollIntoView({ block: 'center' }); }
  }
  connectSync();
})();
