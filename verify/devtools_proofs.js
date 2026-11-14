'use strict';
// Dev Tools for admins only (docs/LAYOUT_SPEC.md §6, Phase 4 step 5): its
// markup comes from the API to signed-in admins (GET /api/dev-tools; the file
// is kindlewood-server admin/dev-tools.html) and its admin scripts load with
// it (js/dev-tools.js); nothing of it is in the page every player downloads,
// and the old static dev.html is never served.
//   node verify/devtools_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = require('./_devmarkup').devAware((name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; });
const H = read('index.html'), J = read('js/dev-tools.js'), BJ = read('js/buildings.js'), HT = read('.htaccess');
const D = require('./_devmarkup').devMarkup();
const ADMIN = ['life-admin.js', 'funnel-admin.js', 'item_admin.js', 'happenings-admin.js', 'enemy_admin.js', 'card-admin.js'];

console.log('1. Out of the page');
{
  check('1a. no ⚗ panel markup in index.html (about 480 lines lighter)', !/id="cheat-modal"/.test(H) && !/class="cheat-tab"/.test(H) && H.split('\n').length < 1600, H.split('\n').length + ' lines');
  check('1b. nor its admin-only scripts and stylesheet', ADMIN.every(f => !H.includes('/js/' + f)) && !H.includes('card-admin.css'));
  check('1c. index.html loads only the small loader, and keeps the ⚗ button (hidden until admin)', /js\/dev-tools\.js/.test(H) && /class="btn-cheat"[^>]*style="display:none"/.test(H));
  // The host (Porkbun static hosting, NGINX) ignores .htaccess: the file is off the site because it isn't in the repo.
check('1d. no static dev.html in the site\'s files (the host serves the repo as it is)', !fs.existsSync(path.join(ROOT, 'dev.html')) && !/dev\.html\?v=/.test(J));
}

console.log('2. The markup (from kindlewood-server)');
{
  check('2a. Dev Tools markup: the backdrop, 14 tabs, their panels', /<div class="cheat-backdrop" id="cheat-modal">/.test(D) && (D.match(/class="cheat-tab( active)?"/g) || []).length === 14 && (D.match(/class="cheat-tab-panel"/g) || []).length >= 14);
  check('2b. Dev Tools markup is a balanced fragment', (D.match(/<div/g) || []).length === (D.match(/<\/div>/g) || []).length && !/<html|<body/.test(D));
}

console.log('3. Loading it');
{
  check('3a. only for admins (KWClock.me().isAdmin via _kwIsAdmin)', /if \(!isAdmin\(\)\) return Promise\.resolve\(false\)/.test(J));
  check('3b. the markup from the API, signed in (the server answers admins only)', /apiFetch\('\/api\/dev-tools'\)/.test(J) && !/dev\.html\?v=/.test(J));
  check('3c. once: the markup, the stylesheet, then the six scripts in their old order', /if \(_p\) return _p;/.test(J) && ADMIN.every(f => J.includes(`'/js/${f}`)) && ADMIN.map(f => J.indexOf(f)).every((v, i, a) => i === 0 || v > a[i - 1]) && /for \(const src of SCRIPTS\) await script\(src\)/.test(J) && /s\.async = false/.test(J));
  check('3d. fetched as soon as the ⚗ button shows; opening waits for it, and says so if it fails', /if \(admin && window\.KWDevTools\) KWDevTools\.load\(\)/.test(BJ) && /async function openCheatMenu\(\)/.test(BJ) && /await KWDevTools\.load\(\)/.test(BJ) && /Dev Tools did not load/.test(BJ));
  check('3e. a failed load can be tried again', /catch\(e => \{ _p = null;/.test(J));
  check('3f. it stays its own overlay below windows, so what it opens shows above it (not a KWWindow, on purpose)', /below windows, on purpose/.test(J) && /z-index: 5000/.test(read('css/main.css')));
}

console.log('4. The build ships the scripts');
{
  const B = require('../scripts/build');
  const OUT = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kw-dev-'));
  const r = B.build({ allowPlain: true, outDir: OUT });
  const dt = r.manifest.dev_tools || {};
  check('4a. the admin scripts and stylesheet keep their paths (dev-tools.js asks for them there)', ADMIN.every(f => fs.existsSync(path.join(OUT, 'js', f))) && fs.existsSync(path.join(OUT, 'css', 'card-admin.css')) && (dt.scripts || []).length === 6);
  check('4b. no dev.html in the build; the built page has no Dev Tools markup', !fs.existsSync(path.join(OUT, 'dev.html')) && !/id="cheat-modal"/.test(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')));
  fs.rmSync(OUT, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
