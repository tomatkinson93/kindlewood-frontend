'use strict';
// The build (scripts/build.js): the page's ~130 files become a handful, and
// behave exactly as the separate files did.
//   node verify/build_proofs.js       (works without esbuild: then nothing is minified)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const B = require('../scripts/build.js');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

console.log('1. What goes in');
const { scripts, styles } = B.pageFiles(src);
const allScripts = (src.match(/<script[^>]*\bsrc="\/js\//g) || []).length, allStyles = (src.match(/<link[^>]*rel="stylesheet"[^>]*href="\/css\//g) || []).length;
check('1a. every local script and stylesheet tag on the page is picked up', scripts.length === allScripts && styles.length === allStyles, `${scripts.length}/${allScripts} scripts, ${styles.length}/${allStyles} styles`);
check('1b. chunks keep page order and lose nothing', (() => { const c = B.chunk([5, 1, 4, 2, 6, 3], x => x, 3); return c.length === 3 && c.flat().join() === '5,1,4,2,6,3'; })());

console.log('2. What comes out');
const OUT = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kw-build-'));
const r = B.build({ allowPlain: true, outDir: OUT });
// The page's own files; Dev Tools' admin-only files are copied beside them (manifest.dev_tools).
const devFiles = new Set([...(r.manifest.dev_tools ? r.manifest.dev_tools.scripts.concat(r.manifest.dev_tools.styles) : [])]);
const js = Object.keys(r.manifest.js).filter(f => !devFiles.has(f)), css = Object.keys(r.manifest.css).filter(f => !devFiles.has(f));
check('2a. a handful of files: three script bundles, the config, one stylesheet', js.length === 4 && css.length === 1, js.concat(css).join(', '));
check('2b. names carry a content hash', js.concat(css).every(f => /-[0-9a-f]{10}\.(js|css)$/.test(f)));
const order = js.filter(f => /app-/.test(f)).flatMap(f => r.manifest.js[f]);
check('2c. every script is in a bundle once, in page order', order.join() === scripts.map(s => s.file).filter(f => f !== 'js/config.js').join());
check('2d. config.js stays on its own (it differs per host) and loads where it did', r.manifest.js[js.find(f => /config-/.test(f))].join() === 'js/config.js'
  && r.html.indexOf('/js/config-') > 0 && (src.indexOf('/js/config.js') < src.indexOf('/js/main.js')) === (r.html.indexOf('/js/config-') < r.html.lastIndexOf('/js/app-')));
check('2e. the built page loads only the bundles', !/\/(js|css)\/[^"]+\?v=/.test(r.html) && (r.html.match(/<script defer src=/g) || []).length === 4 && (r.html.match(/rel="stylesheet" href="\/css\//g) || []).length === 1);
check('2f. the load guard and inline scripts are untouched', r.html.includes('window.kwWhenReady = ') && (r.html.match(/<script>/g) || []).length === (src.match(/<script>/g) || []).length);
const cssBody = fs.readFileSync(path.join(OUT, css[0]), 'utf8');
check('2g. stylesheets keep their order; @import lines are hoisted to the top', /^@import /.test(cssBody) && cssBody.lastIndexOf('@import') < cssBody.indexOf('/* css/') + 10 && r.manifest.css[css[0]].join() === styles.map(s => s.file).join());
{
  const line = "@import url('https://fonts.googleapis.com/css2?family=A:wght@0,500;0,600&display=swap');\n.a{color:red}";
  const got = line.match(B.IMPORT_RE) || [];
  const firstLine = cssBody.split('\n')[0];
  check('2g2. an @import whose address contains semicolons is moved whole (cutting it short breaks every rule after it)', got.length === 1 && got[0].trim().endsWith("display=swap');") && /^@import url\('https:[^']+'\);$/.test(firstLine), firstLine.slice(0, 90));
  let depth = 0, min = 0; for (const ch of cssBody.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')) { if (ch === '{') depth++; else if (ch === '}') { depth--; min = Math.min(min, depth); } }
  check('2g3. the stylesheet\'s braces balance', depth === 0 && min === 0, `depth ${depth}, min ${min}`);
}
check('2h. /assets is not copied (uploaded on its own)', !fs.existsSync(path.join(OUT, 'assets')));

console.log('3. A bundle runs its files as separate scripts');
{
  // Each file becomes its own <script>, so `typeof laterVariable` is safe and
  // one file's error doesn't stop the next (pasting files together breaks both).
  const ran = [];
  const doc = { head: { appendChild(s) { ran.push(s.textContent); } }, createElement: () => ({ remove() {} }) };
  vm.runInNewContext(B.wrap([['js/a.js', 'var a=1'], ['js/b.js', 'throw 1'], ['js/c.js', 'let c=3']]), { document: doc });
  check('3a. in order, one script each, named for the debugger', ran.length === 3 && ran[0] === 'var a=1\n//# sourceURL=/js/a.js' && /sourceURL=\/js\/c\.js$/.test(ran[2]));
  const g = vm.createContext({});
  const doc2 = { head: { appendChild(s) { try { vm.runInContext(s.textContent, g); } catch (e) { /* that file only */ } } }, createElement: () => ({ remove() {} }) };
  g.document = doc2;
  vm.runInContext(B.wrap([['a.js', 'var early = typeof late'], ['b.js', 'throw new Error("boom")'], ['c.js', 'let late = 3; var after = late + 1']]), g);
  check('3b. `typeof` a later file\'s variable is "undefined", not an error; a failing file doesn\'t stop the rest', vm.runInContext('early', g) === 'undefined' && vm.runInContext('after', g) === 4);
}

console.log('4. Deploying');
const wf = fs.existsSync(path.join(ROOT, '.github/workflows/deploy.yml')) ? fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8') : '';
check('4a. on main: proofs, then build, then upload dist/ (never deleting what else is on the host)', /branches: \[main\]/.test(wf) && wf.indexOf('npm run proofs') < wf.indexOf('npm run build') && wf.indexOf('npm run build') < wf.indexOf('local-dir: ./dist/') && !/dangerous-clean-slate: true/.test(wf));
check('4b. the FTP login comes from repository secrets', /secrets\.FTP_SERVER/.test(wf) && /secrets\.FTP_USERNAME/.test(wf) && /secrets\.FTP_PASSWORD/.test(wf));
check('4c. browsers keep hashed files for a year; the page itself is never cached', /max-age=31536000, immutable/.test(fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8')) && /no-cache/.test(fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8')));

console.log('5. New-player funnel (Dev Tools)');
{
  const w = { document: { getElementById: () => null } }; w.window = w; vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/funnel-admin.js'), 'utf8'), w);
  const h = w.KWFunnel.html({ days: 30, players: 10, steps: [{ key: 'registered', label: 'Made an account', players: 10, pct: 100, median_minutes: 0 }, { key: 'first_building', label: 'Built something', players: 4, pct: 40, median_minutes: 12 }] });
  check('5a. a row per step: players, share, typical time, and the loss from the step above (flagged when large)', /Built something/.test(h) && /<b>40%<\/b>/.test(h) && /12 min/.test(h) && /fn-bad">−60%/.test(h));
  check('5b. times read naturally', w.KWFunnel.took(0) === 'under a minute' && w.KWFunnel.took(300) === '5 h' && w.KWFunnel.took(4320) === '3 days' && w.KWFunnel.took(null) === '—');
  // Dev Tools is dev.html, loaded for admins only with its scripts (js/dev-tools.js, Phase 4 step 5).
  const dev = fs.readFileSync(path.join(ROOT, 'dev.html'), 'utf8'), dt = fs.readFileSync(path.join(ROOT, 'js/dev-tools.js'), 'utf8');
  check('5c. in Dev Tools, its script loaded with it (admins only)', /KWFunnel\.load\(\)/.test(dev) && /id="dev-funnel"/.test(dev) && /'\/js\/funnel-admin\.js\?v=\w+'/.test(dt) && !/funnel-admin\.js/.test(src));
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
