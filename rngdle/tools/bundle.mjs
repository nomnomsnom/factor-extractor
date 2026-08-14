// Packs the whole game into one self-contained HTML file.
//
// Two outputs, from the same sources:
//   dist/rngdle.html   a standalone page. No server, no modules, no network —
//                      it runs straight off the filesystem, so you can mail it
//                      to someone or drop it on any static host.
//   dist/embed.html    the same page as a bare fragment (style + markup +
//                      script), for hosts that supply their own <head>.
//
// Usage: node tools/bundle.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const read = name => readFileSync(join(ROOT, name), 'utf8');

// Dependency order. defs has no imports; engine needs defs + the generated
// table; app needs engine.
const MODULES = ['defs.js', 'badges.gen.js', 'engine.js', 'app.js'];

/**
 * Flatten an ES module into plain script source.
 *
 * These are first-party files with a deliberately boring import style — static
 * `import ... from './x.js'` at the top and `export` prefixes on declarations —
 * so concatenating them in dependency order and stripping the module syntax is
 * enough. It is not a general bundler and does not try to be.
 */
function flatten(src, name) {
  const out = src
    .replace(/^import\s+[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^export\s+\{[\s\S]*?\};\s*$/gm, '')
    .replace(/^export\s+(?=(const|let|var|function|class)\b)/gm, '');

  const leftover = out.match(/^\s*(import|export)\b.*/m);
  if (leftover) throw new Error(`${name}: unhandled module syntax -> ${leftover[0].trim()}`);
  return `// ---- ${name} ${'-'.repeat(Math.max(0, 66 - name.length))}\n${out.trim()}\n`;
}

const script = MODULES.map(name => flatten(read(name), name)).join('\n');

// Reuse the real page markup so the bundle can never drift from the served app.
const html = read('index.html');
// Strip only the module tag — the inline error guard has to survive into the
// bundle, and it must still sit ahead of the inlined game script.
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script type="module"[\s\S]*?<\/script>/g, '')
  .trim();
const title = html.match(/<title>([^<]*)<\/title>/)[1];
const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
// The favicon is an inline SVG data URI, so it contains '>' characters. Match
// the quoted href rather than scanning to the first '>', which would truncate
// the tag mid-attribute and corrupt the whole document.
const faviconHref = html.match(/<link rel="icon" href="([^"]*)"\s*>/)[1];
const favicon = `<link rel="icon" href="${faviconHref}">`;

const page = `<style>
${read('styles.css').trim()}
</style>

${body}

<script>
${script}</script>
`;

// The fragment leads with the title, because embedding hosts scan only the start
// of the file for one and the stylesheet alone overruns that budget. The
// standalone build carries its title in <head> instead, so it isn't repeated.
const fragment = `<title>${title}</title>\n\n${page}`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${favicon}
</head>
<body>
${page}</body>
</html>
`;

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'rngdle.html'), standalone);
writeFileSync(join(DIST, 'embed.html'), fragment);

const kb = n => `${(n / 1024).toFixed(0)} KB`;
console.log(`dist/rngdle.html  ${kb(standalone.length)}  (standalone)`);
console.log(`dist/embed.html   ${kb(fragment.length)}  (fragment)`);
