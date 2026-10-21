// Pre-publish checks — the things unit tests do not touch:
//   · every JS file parses, every import points at a file that exists and exports what is imported (UI code included)
//   · every /assets/… and /data/… path the code, CSS and HTML mention exists
//   · all JSON is valid, the manifest's icons exist, licence/credit files are present
//   · (after `npm run build`) the offline snapshot lists only files that exist and the build is stamped
//   --strict also turns the publishing reminders (source link, site URL, trademark) into failures
//
//   node scripts/check-release.mjs [--strict]

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const strict = process.argv.includes('--strict');
let failures = 0;
let warnings = 0;
let checks = 0;
const ok = (cond, msg, detail = '') => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  ✗ ${msg}${detail ? `\n      ${detail}` : ''}`);
  }
  return cond;
};
const warn = (cond, msg) => {
  checks++;
  if (!cond) {
    warnings++;
    if (strict) failures++;
    console.log(`  ${strict ? '✗' : '!'} ${msg}`);
  }
};
const section = t => console.log(`\n== ${t}`);

const walk = (dir, filter) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter));
    else if (!filter || filter(p)) out.push(p);
  }
  return out;
};
const read = f => fs.readFileSync(f, 'utf8');
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

// ---- JS modules ------------------------------------------------------------------------------------------------------
section('JavaScript modules');
const jsFiles = [...walk(path.join(PUBLIC, 'js'), f => f.endsWith('.js')), ...['analytics', 'server', 'netlify'].flatMap(d => walk(path.join(ROOT, d), f => f.endsWith('.mjs')))];
const exportsOf = new Map();
function collectExports(file, seen = new Set()) {
  if (exportsOf.has(file)) return exportsOf.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default\b/.test(src)) names.add('default');
  for (const m of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(target)) for (const n of collectExports(target, seen)) names.add(n);
  }
  exportsOf.set(file, names);
  return names;
}
let imports = 0;
for (const file of jsFiles) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  ok(syntax.status === 0, `${rel(file)} parses`, syntax.stderr.split('\n').find(l => /Error/.test(l)));
  const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  for (const m of src.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:\*\s+as\s+[\w$]+\s*)?from\s*['"]([^'"]+)['"]/g)) {
    if (!m[3].startsWith('.')) continue;
    imports++;
    const target = path.resolve(path.dirname(file), m[3]);
    if (!ok(fs.existsSync(target), `${rel(file)} imports ${m[3]}`, 'no such file')) continue;
    const have = collectExports(target);
    if (m[1]) ok(have.has('default'), `${rel(file)}: ${m[3]} has a default export`);
    for (const part of (m[2] || '').split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) ok(have.has(name), `${rel(file)} imports { ${name} } from ${m[3]}`, `${rel(target)} does not export it`);
    }
  }
}
console.log(`  ${jsFiles.length} files, ${imports} imports checked`);

// ---- asset references ------------------------------------------------------------------------------------------------
section('Asset references');
let refs = 0;
const refSources = [...jsFiles, ...walk(path.join(PUBLIC, 'css'), f => f.endsWith('.css')), path.join(PUBLIC, 'index.html'), path.join(PUBLIC, 'manifest.webmanifest')];
for (const file of refSources) {
  const src = read(file);
  const seen = new Set();
  for (const m of src.matchAll(/['"(]\s*(\/(?:assets|data)\/[A-Za-z0-9_\-./]+\.[a-z0-9]+)/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    refs++;
    ok(fs.existsSync(path.join(PUBLIC, m[1])), `${rel(file)} references ${m[1]}`, 'missing from public/');
  }
}
console.log(`  ${refs} references checked`);

// ---- data & metadata -------------------------------------------------------------------------------------------------
section('Data, manifest and legal files');
for (const f of walk(path.join(PUBLIC, 'data'), f => f.endsWith('.json')).concat(path.join(PUBLIC, 'manifest.webmanifest'))) {
  let good = true;
  try {
    JSON.parse(read(f));
  } catch (e) {
    good = false;
  }
  ok(good, `${rel(f)} is valid JSON`);
}
for (const f of ['privacy.html', 'admin/index.html', 'admin/admin.js', 'admin/admin.css', 'css/doc.css', 'LICENSE.txt', 'CREDITS.txt', 'assets/fonts/OFL-Jersey15.txt', 'assets/icons/share.png', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png']) ok(fs.existsSync(path.join(PUBLIC, f)), `public/${f} is present`);
ok(/GNU GENERAL PUBLIC LICENSE/.test(read(path.join(PUBLIC, 'LICENSE.txt'))), 'LICENSE.txt is the GPL text');
const html = read(path.join(PUBLIC, 'index.html'));
for (const name of ['aeii-version', 'aeii-server', 'aeii-online', 'aeii-source', 'aeii-analytics']) ok(html.includes(`name="${name}"`), `index.html carries <meta name="${name}">`);
ok(html.includes('og:image') && html.includes('boot-guard.js'), 'index.html has link-preview tags and the boot guard');

const { BRAND } = await import(pathToFileURL(path.join(PUBLIC, 'js/config/brand.js')).href);
warn(BRAND.name !== 'Ancient Empires', `the game is still called "${BRAND.name}", a name owned by its original publisher — set your own in public/js/config/brand.js before a public launch`);
warn(!!process.env.SOURCE_URL, 'SOURCE_URL is not set — the GPL asks that players can find the source code (shown in the About box)');
warn(!!process.env.SITE_URL, 'SITE_URL is not set — link previews need an absolute address (og:image, canonical)');

// ---- the built folder --------------------------------------------------------------------------------------------------
section('Build output (dist/)');
if (!fs.existsSync(DIST)) console.log('  (no dist/ yet — run `npm run build`)');
else {
  const sw = read(path.join(DIST, 'sw.js'));
  const list = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(sw)?.[1] || '[]');
  ok(list.length > 100, `the service worker pre-caches ${list.length} files`);
  const missing = list.filter(u => u !== '/' && !fs.existsSync(path.join(DIST, u)));
  ok(!missing.length, 'every pre-cached file exists in dist/', missing.slice(0, 3).join(', '));
  const built = read(path.join(DIST, 'index.html'));
  const version = /name="aeii-version" content="([^"]*)"/.exec(built)?.[1];
  ok(version && version !== 'dev' && sw.includes(version.split('+')[1]), `dist/index.html is stamped (${version}) and matches the service worker`);
  ok(fs.existsSync(path.join(DIST, '_headers')) && fs.existsSync(path.join(DIST, 'robots.txt')), 'dist/ has _headers and robots.txt');
  ok(!/(?:src|href)="\/js\/legacy\.js"/.test(built), 'dist/index.html has no stale script references');
  const analyticsMeta = /name="aeii-analytics" content="([^"]*)"/.exec(built)?.[1];
  if (analyticsMeta) ok(sw.includes("startsWith('/api/')") && !list.some(u => u.startsWith('/admin')), 'statistics are on: the service worker leaves /api/ and /admin/ alone and does not pre-cache the dashboard');
}

console.log(failures ? `\n${failures} problem(s) found` : `\nRelease checks passed ✓ (${checks} checks${warnings ? `, ${warnings} reminder(s)` : ''})`);
process.exit(failures ? 1 : 0);
