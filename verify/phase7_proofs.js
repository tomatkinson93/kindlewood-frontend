// Phase 7 verification harness (node, no deps) — settings + persistence.
// Run: node verify/phase7_proofs.js
//
//   A. Season panel gains the Map View select + Reduce-map-detail toggle in the
//      retitled "✦ Map & Atmosphere" block, wired data-* + re-wire-on-render.
//   B. setRenderer switches + persists kw_map_view; restore-on-init re-applies.
//   C. Camera focus preserved across a renderer switch (spec §12.9) — the same
//      {q,r} centre lands at the screen centre in both views.
//   D. Reduce-map-detail persists kw_map_low_detail and pins the ladder.
//   E. Prior suites still green.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;

const P7_FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'kwmap-decor.js', 'main.js'];
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);
function env7() { const e = makeEnv(); H.loadTree(e, P7_FILES); setUi(e, null, null, null, { q: 20, r: 15 }); return e; }

// ── A. Season panel markup + wiring (source) ───────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'seasons.js'), 'utf8');
  check('A. settings block retitled "✦ Map & Atmosphere"', /Map\s*&amp;\s*Atmosphere/.test(src));
  check('A. Map View <select> with topdown + iso options', /data-kwmap-view/.test(src) && /value="topdown"/.test(src) && /value="iso"/.test(src));
  check('A. "Reduce map detail" checkbox present', /data-kwmap-setting="lowdetail"/.test(src) && /Reduce map detail/.test(src));
  check('A. select wired to controller.setRenderer', /KWMap\.controller\.setRenderer\(sel\.value\)/.test(src));
  check('A. low-detail wired to perf.setLowDetail', /KWMap\.perf\.setLowDetail\(low\.checked\)/.test(src));
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'hud-storybook.css'), 'utf8');
  check('A. hud-storybook.css styles the .sp-select', /\.sp-select\b/.test(css));
}

// ── B. setRenderer switch + persistence + restore ──────────────────────────
{
  const e = env7();
  run(e, "KWMap.controller.setRenderer('iso');");
  check('B. setRenderer switches the active renderer', run(e, 'KWMap.controller.activeId') === 'iso');
  check('B. setRenderer persists kw_map_view', run(e, "localStorage.getItem('kw_map_view')") === 'iso');
  run(e, "KWMap.controller.setRenderer('topdown');");
  check('B. switching back updates activeId + storage', run(e, 'KWMap.controller.activeId') === 'topdown' && run(e, "localStorage.getItem('kw_map_view')") === 'topdown');

  // restore-on-init: a saved 'iso' is re-applied when input initializes
  const e2 = env7();
  run(e2, "localStorage.setItem('kw_map_view','iso'); KWMap.controller.initInput();");
  check('B. persisted kw_map_view is restored on init', run(e2, 'KWMap.controller.activeId') === 'iso');
}

// ── C. Camera focus preserved across a switch (spec §12.9) ─────────────────
{
  const e = env7();
  const W = 1400, H2 = 800;
  const centreOf = () => J(e, `KWMap.controller.active.hexToScreen(camera.q,camera.r,camera,${W},${H2})`);
  run(e, "KWMap.controller.setRenderer('topdown');");
  const td = centreOf();
  const cam0 = J(e, '({q:camera.q,r:camera.r})');
  run(e, "KWMap.controller.setRenderer('iso');");
  const iso = centreOf();
  const cam1 = J(e, '({q:camera.q,r:camera.r})');
  check('C. camera {q,r} unchanged across the switch', cam0.q === cam1.q && cam0.r === cam1.r, JSON.stringify(cam1));
  const centred = (c) => c && Math.abs(c.x - W / 2) <= 48 && Math.abs(c.y - H2 / 2) <= 55;
  check('C. camera tile stays centred in top-down', centred(td), JSON.stringify(td));
  check('C. camera tile stays centred in iso', centred(iso), JSON.stringify(iso));
}

// ── D. Reduce-map-detail persistence + pin ─────────────────────────────────
{
  const e = env7();
  run(e, "KWMap.controller.setRenderer('iso'); KWMap.perf.setLowDetail(true);");
  check('D. setLowDetail persists kw_map_low_detail', run(e, "localStorage.getItem('kw_map_low_detail')") === '1');
  check('D. lowDetail pins the ladder ≥ step 2', J(e, 'KWMap.perf.detail()').level >= 2 && J(e, 'KWMap.perf.detail()').decorScale === 0);
  run(e, 'KWMap.perf.setLowDetail(false);');
  check('D. clearing restores auto detail + storage', run(e, "localStorage.getItem('kw_map_low_detail')") === '0' && J(e, 'KWMap.perf.detail()').level === 0);
}

// ── E. Prior suites still green ────────────────────────────────────────────
{
  let ok = true, out = '';
  try { out = execFileSync('node', [path.join(__dirname, 'phase6_proofs.js')], { encoding: 'utf8' }); }
  catch (err) { ok = false; out = (err.stdout || '') + (err.stderr || ''); }
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  check('E. phase6_proofs.js (→ P5 → … → P1 golden) still green', ok && m && m[2] === '0', m ? `${m[1]} passed, ${m[2]} failed` : 'no summary');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
