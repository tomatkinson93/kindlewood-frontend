'use strict';
// Loading the page on the cPanel host: every file versioned, failed files
// retried, scripts that arrive late still start, browser caching.
//   node verify/assets_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const H = read('index.html');

console.log('1. Every file is versioned');
{
  const tags = [...H.matchAll(/<script[^>]*\bsrc="([^"]+)"/g), ...H.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));
  const bad = tags.filter(u => !/^\/(js|css)\/[^?]+\?v=[A-Za-z0-9_.-]+$/.test(u));
  check('1a. every local script and stylesheet is /js/… or /css/… with ?v=', bad.length === 0, bad.join(', '));
  check('1b. settlement-view.js is absolute and re-versioned', /src="\/js\/settlement-view\.js\?v=r5g"/.test(H));
  const missing = tags.map(u => u.split('?')[0].slice(1)).filter(f => !fs.existsSync(path.join(ROOT, f)));
  check('1c. every tag points at a file that exists', missing.length === 0, missing.join(', '));
}

// (1d retired: the uploaded site is built by scripts/build.js, whose file
// names carry a hash of their contents — see verify/build_proofs.js.)

console.log('2. Failed files are retried');
{
  const first = H.indexOf('<script');
  const guard = H.slice(first, H.indexOf('</script>', first));
  check('2a. the load guard is the first script on the page', /window\.addEventListener\('error'/.test(guard) && /window\.kwWhenReady = /.test(guard));
  check('2b. same-origin scripts and stylesheets only, 3 retries (0.5s, 1.5s, 4s), then a Reload banner', /DELAYS = \[500, 1500, 4000\]/.test(guard) && /url\.indexOf\(location\.origin \+ '\/'\) !== 0/.test(guard) && /role', 'alert'/.test(guard) && /location\.reload\(\)/.test(guard));
  // Run the guard against a fake page: one failure → one retry with kwr=1.
  const added = [], timers = [], listeners = {};
  const mkEl = tag => ({ tagName: tag.toUpperCase(), parentNode: null, style: {}, _on: {}, setAttribute() {}, appendChild() {}, addEventListener(t, f) { this._on[t] = f; } });
  const head = { insertBefore(x) { added.push(x); }, removeChild() {} };
  const doc = { body: null, head, addEventListener(t, f) { (listeners['doc:' + t] = listeners['doc:' + t] || []).push(f); }, createElement: mkEl, getElementById: () => null };
  const w = { document: doc, location: { origin: 'https://kw.test', reload() {} }, console: { warn() {} },
    setTimeout: (f, ms) => timers.push([f, ms]), addEventListener(t, f) { (listeners['win:' + t] = listeners['win:' + t] || []).push(f); } };
  w.window = w; vm.createContext(w);
  vm.runInContext(guard.replace(/^<script>/, ''), w);
  const el = { tagName: 'SCRIPT', src: 'https://kw.test/js/market.js?v=g5', parentNode: head };
  const retry = () => { const i = timers.findIndex(t => t[1] !== 10000); if (i >= 0) timers.splice(i, 1)[0][0](); };
  const retries = () => timers.filter(t => t[1] !== 10000).length;
  listeners['win:error'][0]({ target: el });
  check('2c0. while it is retried, boot code waits (pending 1)', w.KWLoad.pending() === 1);
  retry();
  check('2c. a 503 on market.js is fetched again as market.js?v=g5&kwr=1, in order (async=false)', added.length === 1 && added[0].src === 'https://kw.test/js/market.js?v=g5&kwr=1' && added[0].async === false);
  // A second file fails, is retried and loads: boot code is released.
  const ran0 = [];
  listeners['doc:DOMContentLoaded'].forEach(f => f());   // page loaded, but a retry is pending
  w.kwWhenReady(() => ran0.push('boot'));
  const held = ran0.length === 0;
  added[0]._on.load();
  timers.filter(t => t[1] === 0).forEach(([f]) => f());
  check('2c1. boot code waits for the retried file, then runs once it loads', held && ran0.join() === 'boot' && w.KWLoad.pending() === 0);
  listeners['win:error'][0]({ target: { tagName: 'SCRIPT', src: 'https://other.example/x.js', parentNode: head } });
  check('2d. other sites are left alone', retries() === 0);
  for (let n = 1; n <= 3; n++) { listeners['win:error'][0]({ target: { ...el, src: `https://kw.test/js/market.js?v=g5&kwr=${n}` } }); retry(); }
  check('2e. after three retries it gives up, records the file, and stops holding boot code', w.KWLoad.failed.includes('https://kw.test/js/market.js?v=g5') && w.KWLoad.pending() === 0);
  // kwWhenReady: before DOMContentLoaded it waits; after, it runs.
  const ran = [];
  w.kwWhenReady(() => ran.push('early'));
  listeners['doc:DOMContentLoaded'].forEach(f => f());
  w.kwWhenReady(() => ran.push('late'));
  timers.forEach(([f]) => f());
  check('2f. kwWhenReady: waits for the page before it loads, runs at once after', ran.join() === 'early,late');
}

console.log('3. Late scripts still start');
{
  const offenders = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
    const L = read('js/' + f).split('\n');
    L.forEach((l, i) => {
      if (!/addEventListener\(\s*'DOMContentLoaded'/.test(l) || /^\s*\/\//.test(l) || /var kwWhenReady =/.test(l)) return;   // the fallback helper itself
      const near = L.slice(Math.max(0, i - 2), i + 1).join('\n');
      if (!/readyState/.test(near)) offenders.push(`js/${f}:${i + 1}`);
    });
  }
  check('3a. no module starts only on DOMContentLoaded (kwWhenReady or a readyState check)', offenders.length === 0, offenders.join(', '));
}

console.log('4. Browser caching on the host');
{
  const A = fs.existsSync(path.join(ROOT, '.htaccess')) ? read('.htaccess') : '';
  check('4a. .htaccess: scripts and styles cached a year (they are versioned)', /<FilesMatch "\\\.\(js\|css\)\$">\s*Header set Cache-Control "public, max-age=31536000, immutable"/.test(A));
  check('4b. index.html is never cached, so an upload shows at once', /<FilesMatch "\\\.html\?\$">\s*Header set Cache-Control "no-cache"/.test(A));
  check('4c. compression on', /AddOutputFilterByType DEFLATE[^\n]*application\/javascript/.test(A) && /text\/css/.test(A));
}

console.log('5. The loading screen waits for everything');
{
  const M = read('js/main.js');
  check('5a. signed-in players see it from the start, counting the files in (and who is being retried)', /if \(!t \|\| !window\.KWLoad\) return;[^]*Fetching the game files… ' \+ p\.done \+ ' of ' \+ p\.total/.test(H) && /The host is busy — trying ' \+ p\.retrying\[0\]\.file/.test(H));
  check('5b. KWLoad.progress() and ready() for it', /progress: function \(\)/.test(H) && /ready: function \(\)/.test(H));
  check('5c. each step is awaited for real, with a cap (map, citizens, buildings, scouts, art)', ["lsRun('map'", "lsRun('citizens'", "lsRun('buildings'", "lsRun('expeditions'", "lsRun('art'"].every(k => M.includes(k)) && /function lsWithin\(p, ms\)/.test(M));
  check('5d. a sleeping server is woken with retries and says so', /const WAKE_DELAYS = \[/.test(M) && /server is waking up — this can take up to a minute/.test(M) && /apiFetchWaking\('\/api\/game\/settlement'/.test(M) && /apiFetchWaking\('\/api\/auth\/me'/.test(M));
  check('5e. files still missing: named on the loading screen, with Reload or Carry on', /await lsProblem\(missing\)/.test(M) && /data-ls="reload">Reload/.test(M) && /data-ls="go">Carry on/.test(M) && /KWLoad\.acknowledged = true/.test(M));
  check('5f. signed out or 401: the early loading screen closes again', /if \(res\.status === 401\) localStorage\.removeItem\('kw_token'\);\s*hideLoadingScreen\(\);/.test(M));
  check('5g. only the first load gets the full checklist (later reloads stay quick)', /const first = !_gameShownOnce;/.test(M));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
