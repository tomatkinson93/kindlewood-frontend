// ══════════════════════════════════════════════════════════════════════════
//  build — makes the site that is uploaded to the host, in dist/.
//
//    npm run build            (needs `npm install` once, for esbuild)
//
//  Development uses the plain files (index.html loading ~105 scripts and ~30
//  stylesheets). The host turned requests away when a page asked for that
//  many at once, so the build joins them:
//
//    dist/index.html          the same page, pointing at the bundles
//    dist/js/app-N-<hash>.js  the page's scripts, in page order, minified
//    dist/js/config-<hash>.js the API address (kept apart: it differs per host)
//    dist/css/app-<hash>.css  every stylesheet, in page order, minified
//    dist/.htaccess, favicon.ico, License.txt
//    dist/build.json          what went into each bundle
//
//  /assets is NOT copied (116 MB of art and audio that rarely changes): it is
//  uploaded on its own. Pass --with-assets to copy it too.
//
//  File names carry a hash of their contents, so browsers can keep them for a
//  year (.htaccess) and still pick up every change: no ?v= bumping.
//
//  How scripts are joined: each file is minified on its own (top-level names
//  are never renamed: the page calls many from onclick="…" attributes) and
//  stored in the bundle as text. The bundle then runs them one after another
//  in page order, each as its own <script>, exactly as the browser would have
//  run the separate files. That matters: simply pasting the files together
//  breaks code that asks `typeof someLaterFilesVariable`, and lets one
//  file's error stop every file after it. `//# sourceURL` keeps the original
//  file names in error messages and the browser's debugger.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const DEFAULT_DIST = path.join(ROOT, 'dist');
const JS_BUNDLES = 3;
const SEPARATE = new Set(['js/config.js']);   // never bundled

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

// The page's local scripts and stylesheets, in order: [{ tag, file }].
function pageFiles(html) {
  const scripts = [...html.matchAll(/[ \t]*<script defer src="\/(js\/[^"?]+)\?v=[^"]*"><\/script>\n?/g)].map(m => ({ tag: m[0], file: m[1] }));
  const styles = [...html.matchAll(/[ \t]*<link rel="stylesheet" href="\/(css\/[^"?]+)\?v=[^"]*">\n?/g)].map(m => ({ tag: m[0], file: m[1] }));
  return { scripts, styles };
}

// Split an ordered list into `n` runs of roughly equal size, keeping order.
function chunk(items, sizeOf, n) {
  const total = items.reduce((t, x) => t + sizeOf(x), 0);
  const out = [[]];
  let acc = 0;
  for (const it of items) {
    if (out.length < n && acc >= (total / n) * out.length && out[out.length - 1].length) out.push([]);
    out[out.length - 1].push(it);
    acc += sizeOf(it);
  }
  return out;
}

// A bundle: [[file, code], …] run in order, each as its own classic script.
function wrap(files) {
  const list = files.map(([f, code]) => `[${JSON.stringify(f)},${JSON.stringify(code)}]`).join(',\n');
  return `(function(){var F=[\n${list}\n];for(var i=0;i<F.length;i++){var s=document.createElement("script");`
    + `s.textContent=F[i][1]+"\\n//# sourceURL=/"+F[i][0];(document.head||document.documentElement).appendChild(s);s.remove()}})();\n`;
}

// A whole `@import …;` line. The address may itself contain semicolons
// (Google Fonts: wght@0,500;0,600), so quoted and url(…) parts are matched whole.
const IMPORT_RE = /^[ \t]*@import\s+(?:url\(\s*(?:'[^']*'|"[^"]*"|[^)]*)\s*\)|'[^']*'|"[^"]*")[^;\n]*;[ \t]*\n?/gm;

function build(opts = {}) {
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { if (!opts.allowPlain) throw new Error('esbuild is not installed — run `npm install` first.'); }
  const minJs = code => (esbuild ? esbuild.transformSync(code, { minify: true, legalComments: 'none' }).code : code);
  const minCss = code => (esbuild ? esbuild.transformSync(code, { loader: 'css', minify: true, legalComments: 'none' }).code : code);

  let html = read('index.html');
  const { scripts, styles } = pageFiles(html);
  const missing = [...scripts, ...styles].filter(x => !fs.existsSync(path.join(ROOT, x.file))).map(x => x.file);
  if (missing.length) throw new Error('index.html points at files that do not exist: ' + missing.join(', '));

  const DIST = opts.outDir || DEFAULT_DIST;   // proofs build into a temporary folder
  // Empty the folder but keep it, so a local preview server pointed at it keeps working.
  fs.mkdirSync(DIST, { recursive: true });
  for (const f of fs.readdirSync(DIST)) fs.rmSync(path.join(DIST, f), { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'css'), { recursive: true });
  const manifest = { built_at: new Date().toISOString(), minified: !!esbuild, js: {}, css: {} };

  // ── Scripts ──
  const bundled = scripts.filter(s => !SEPARATE.has(s.file));
  const sources = new Map(bundled.map(s => [s.file, read(s.file)]));
  const groups = chunk(bundled, s => sources.get(s.file).length, JS_BUNDLES);
  groups.forEach((group, i) => {
    const body = wrap(group.map(s => [s.file, minJs(sources.get(s.file)).trimEnd()]));
    const name = `js/app-${i + 1}-${sha(body)}.js`;
    fs.writeFileSync(path.join(DIST, name), body);
    manifest.js[name] = group.map(s => s.file);
    // The bundle takes the place of its first script; the rest are dropped.
    html = html.replace(group[0].tag, `  <script defer src="/${name}"></script>\n`);
    for (const s of group.slice(1)) html = html.replace(s.tag, '');
  });
  for (const s of scripts.filter(x => SEPARATE.has(x.file))) {
    const body = minJs(read(s.file));
    const name = s.file.replace(/\.js$/, `-${sha(body)}.js`);
    fs.writeFileSync(path.join(DIST, name), body);
    manifest.js[name] = [s.file];
    html = html.replace(s.tag, `  <script defer src="/${name}"></script>\n`);
  }

  // ── Stylesheets: one file; @import lines must come first, so they are hoisted ──
  const imports = [];
  const css = styles.map(s => {
    const body = read(s.file).replace(IMPORT_RE, m => { imports.push(m.trim()); return ''; });
    return `/* ${s.file} */\n${minCss(body).trimEnd()}\n`;
  }).join('');
  const cssBody = [...new Set(imports)].join('\n') + (imports.length ? '\n' : '') + css;
  const cssName = `css/app-${sha(cssBody)}.css`;
  fs.writeFileSync(path.join(DIST, cssName), cssBody);
  manifest.css[cssName] = styles.map(s => s.file);
  html = html.replace(styles[0].tag, `  <link rel="stylesheet" href="/${cssName}">\n`);
  for (const s of styles.slice(1)) html = html.replace(s.tag, '');

  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  for (const f of ['.htaccess', 'favicon.ico', 'License.txt']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
  if (opts.withAssets) fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'build.json'), JSON.stringify(manifest, null, 1) + '\n');

  const kb = f => Math.round(fs.statSync(path.join(DIST, f)).size / 1024);
  return {
    scripts: scripts.length, styles: styles.length,
    files: [...Object.keys(manifest.js), ...Object.keys(manifest.css)].map(f => ({ file: f, kb: kb(f) })),
    manifest, html,
  };
}

if (require.main === module) {
  try {
    const r = build({ withAssets: process.argv.includes('--with-assets'), allowPlain: process.argv.includes('--no-minify') });
    console.log(`Built dist/: ${r.scripts} scripts and ${r.styles} stylesheets → ${r.files.length} files`);
    for (const f of r.files) console.log(`  ${String(f.kb).padStart(5)} KB  ${f.file}`);
  } catch (e) { console.error('Build failed: ' + e.message); process.exit(1); }
}

module.exports = { build, pageFiles, chunk, wrap, IMPORT_RE };
