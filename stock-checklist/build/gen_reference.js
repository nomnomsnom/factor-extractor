/* Generate the industry reference section of rulebook-explained.html
   straight from rulebook.js, so the guide cannot drift from the tool. */
const fs = require('fs');
global.window = {};
require('/home/user/factor-extractor/stock-checklist/rulebook.js');
eval(fs.readFileSync('/home/user/factor-extractor/stock-checklist/data-us.js', 'utf8'));
eval(fs.readFileSync('/home/user/factor-extractor/stock-checklist/data-sg.js', 'utf8'));
const ALL = [].concat(window.DATA_US, window.DATA_SG);

const num = s => {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  s = String(s).replace(/[,$%]/g, '').trim();
  if (!s || s === '-' || s === 'n/a' || s === 'Upgrade') return null;
  const m = /^-?\d*\.?\d+/.exec(s); if (!m) return null;
  const mult = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }[s.slice(m[0].length).trim()[0]] || 1;
  return parseFloat(m[0]) * mult;
};
const comp = (c, key) => {
  const M = c.M;
  if (key === 'spread') { const r = num(M.roic), w = num(M.wacc); return r != null && w != null ? r - w : null; }
  if (key === 'rev5') return c.rev5 == null ? null : c.rev5;
  if (key === 'rule40') { const g = c.rev5, f = num(M.fcfm); return (g != null && f != null) ? g + f : null; }
  if (key === 'capexPct') { const cx = Math.abs(num(M.capex) || 0), rv = num(M.rev); return rv ? cx / rv * 100 : null; }
  if (key === 'fcfConv') { const fc = num(M.fcf), ni = num(M.ni); return (fc && ni && ni > 0) ? fc / ni * 100 : null; }
  if (key === 'divCover') { const d = num(M.dps), f = num(M.fcfps); return (d && f && f > 0) ? d / f * 100 : null; }
  return null;
};
const median = a => {
  a = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
  if (a.length < 3) return null;
  const h = Math.floor(a.length / 2);
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
};
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (v, unit) => {
  if (v == null) return null;
  if (unit === 'money') return (v >= 1e9 ? (v / 1e9).toFixed(1) + 'bn' : (v / 1e6).toFixed(0) + 'm');
  if (unit === 'days') return Math.round(v) + ' days';
  if (unit === 'x') return v.toFixed(1) + '×';
  return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + '%';
};
/* which M keys are ratios (x) rather than percentages */
const XKEYS = new Set(['pe', 'pb', 'ps', 'pfcf', 'evebitda', 'peg', 'de', 'debitda', 'icov', 'current']);

const groups = {};
ALL.forEach(c => {
  const rb = window.rulebookFor(c);
  (groups[rb.name] = groups[rb.name] || { rb, cos: [] }).cos.push(c);
});

const order = Object.keys(groups).sort((a, b) => groups[b].cos.length - groups[a].cos.length);
let out = '';
out += '<nav class="reflist" aria-label="Jump to an industry">' +
  order.map(n => '<a href="#rb-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '">' + esc(n) +
    ' <span>' + groups[n].cos.length + '</span></a>').join('') + '</nav>';

order.forEach(name => {
  const { rb, cos } = groups[name];
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  out += '<article class="refbiz" id="rb-' + id + '">';
  out += '<h3>' + esc(name) + ' <span class="refn">' + cos.length + ' companies</span></h3>';
  out += '<p class="refdecides">' + esc(rb.decides) + '</p>';
  out += '<div class="scroller"><table class="reftab"><thead><tr>' +
    '<th>Measure</th><th>Healthy level</th><th>Typical here</th></tr></thead><tbody>';
  rb.watch.forEach(w => {
    let vals = [], unit = w.u === '%' ? '%' : w.u === 'days' ? 'days' : w.u === 'money' ? 'money' : null;
    if (w.fill) vals = cos.map(c => (c.F && c.F[w.fill]) ? c.F[w.fill].v : null);
    else if (w.k) { vals = cos.map(c => num(c.M[w.k])); unit = XKEYS.has(w.k) ? 'x' : '%'; }
    else if (w.c) { vals = cos.map(c => comp(c, w.c)); unit = w.c === 'divCover' || w.c === 'fcfConv' || w.c === 'capexPct' || w.c === 'rev5' || w.c === 'rule40' || w.c === 'spread' ? '%' : null; }
    const med = median(vals);
    const tested = !!w.ok;
    const where = w.f ? '<span class="refwhere">' + esc(w.f) + '</span>' : '';
    out += '<tr>' +
      '<td><span class="refdot ' + (tested ? 'ok' : 'na') + '" title="' +
        (tested ? 'the checklist tests this for you' : 'judge it in context') + '"></span>' +
        esc(w.l) + (w.f && !w.fill ? ' <em>read the filing</em>' : '') + '</td>' +
      '<td>' + esc(w.t) + where + '</td>' +
      '<td class="refmed">' + (med != null ? esc(fmt(med, unit)) : '&mdash;') + '</td>' +
      '</tr>';
  });
  out += '</tbody></table></div>';
  if (rb.ignore && rb.ignore.length) {
    out += '<p class="refignore"><b>Ignore here:</b> ' +
      rb.ignore.map(x => '<span class="tagx">' + esc(x) + '</span>').join(' ') + '</p>';
  }
  out += '</article>';
});

fs.writeFileSync('/tmp/industry_ref.html', out);
console.log('rulebooks:', order.length, '| bytes:', out.length);
console.log('rows:', order.reduce((n, k) => n + groups[k].rb.watch.length, 0));
