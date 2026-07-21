// Phase 6 verification harness (node, no deps) — performance & degradation
// ladder (spec §6). Run: node verify/phase6_proofs.js
//
//   A. Ladder adaptation — sustained slow rebuilds step detail DOWN (after 2),
//      sustained fast rebuilds recover UP (after 6, slowly), clamped 0..5.
//   B. detail() mapping — each level maps to the right decor/haze/shadow/suggest
//      state (drop order: decor ×0.5 → decor 0 → haze off → shadows off →
//      suggest top-down).
//   C. "Reduce map detail" toggle pins the ladder ≥ step 2 (decor off).
//   D. Decor honours decorScale (0 → none, 0.5 → subset, 1 → all).
//   E. Ladder actually reduces work — ground ops drop when decor is off; tall
//      ops drop when shadows are off.
//   F. Device tier picks a sane margin/budget; determinism holds at a fixed
//      level; prior suites green.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;

const P6_FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'kwmap-decor.js', 'main.js'];
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);

function env6(worldJs, cam) {
  const e = makeEnv(); H.loadTree(e, P6_FILES);
  if (worldJs) vm.runInContext(worldJs, e.context);
  setUi(e, null, null, null, cam || { q: 20, r: 15 });
  vm.runInContext("KWMap.controller.setRenderer('iso');", e.context);
  return e;
}
const PLAINS = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
  __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;
const MIXED = `(function(){const T=['plains','forest','hills','mountain','marsh','ruins'];const tiles=[];
  for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:T[(q*3+r)%6],revealed:true});
  __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;

// ── A. Ladder adaptation ───────────────────────────────────────────────────
{
  const e = env6();
  const P = run(e, 'KWMap.perf._raw');
  const budget = run(e, 'KWMap.perf.budget');
  const setl = (lvl) => run(e, `KWMap.perf._raw.level=${lvl}; KWMap.perf._raw._slow=0; KWMap.perf._raw._fast=0;`);
  setl(0);
  run(e, `KWMap.perf._adapt(${budget * 2}); KWMap.perf._adapt(${budget * 2});`);  // 2 slow
  check('A. two slow rebuilds step the ladder down (0→1)', run(e, 'KWMap.perf._raw.level') === 1, `level ${run(e, 'KWMap.perf._raw.level')}`);
  run(e, `for(let i=0;i<12;i++)KWMap.perf._adapt(${budget * 2});`);               // many slow
  check('A. ladder clamps at 5 under sustained slowness', run(e, 'KWMap.perf._raw.level') === 5);
  run(e, `KWMap.perf._raw._fast=0; for(let i=0;i<6;i++)KWMap.perf._adapt(${budget * 0.3});`); // 6 fast
  check('A. six fast rebuilds recover one step (5→4)', run(e, 'KWMap.perf._raw.level') === 4, `level ${run(e, 'KWMap.perf._raw.level')}`);
  // mid-range rebuild neither steps nor recovers
  setl(2); run(e, `KWMap.perf._adapt(${budget}); KWMap.perf._adapt(${budget});`);
  check('A. on-budget rebuilds hold the level', run(e, 'KWMap.perf._raw.level') === 2);
}

// ── B. detail() mapping (drop order) ───────────────────────────────────────
{
  const e = env6();
  const at = (lvl) => { run(e, `KWMap.perf._raw.level=${lvl}; KWMap.perf._raw.lowDetail=false;`); return J(e, 'KWMap.perf.detail()'); };
  const rows = [0, 1, 2, 3, 4, 5].map(at);
  check('B. L0 = full detail', eq(rows[0], { level: 0, decorScale: 1, haze: true, shadows: true, suggestTopdown: false }));
  check('B. L1 = decor ×0.5', rows[1].decorScale === 0.5 && rows[1].haze && rows[1].shadows);
  check('B. L2 = decor off', rows[2].decorScale === 0 && rows[2].haze && rows[2].shadows);
  check('B. L3 = haze off', rows[3].decorScale === 0 && rows[3].haze === false && rows[3].shadows);
  check('B. L4 = shadows off', rows[4].shadows === false && rows[4].haze === false);
  check('B. L5 = suggest top-down (never auto-switch)', rows[5].suggestTopdown === true);
}

// ── C. Reduce-map-detail toggle pins ≥ step 2 ──────────────────────────────
{
  const e = env6();
  run(e, 'KWMap.perf._raw.level=0; KWMap.perf.setLowDetail(true);');
  const d = J(e, 'KWMap.perf.detail()');
  check('C. lowDetail pins effective level ≥ 2 (decor off)', d.level >= 2 && d.decorScale === 0, `level ${d.level}`);
  check('C. lowDetail persists to localStorage', run(e, "localStorage.getItem('kw_map_low_detail')") === '1');
  run(e, 'KWMap.perf.setLowDetail(false);');
  check('C. clearing lowDetail restores auto level', J(e, 'KWMap.perf.detail()').level === 0);
}

// ── D. Decor honours decorScale ────────────────────────────────────────────
{
  const e = env6(PLAINS);
  const collect = (scale) => J(e, `KWMap.decor._provider.collect({seasonId:'summer',visible:null,detail:{decorScale:${scale}}}, worldMapData).length`);
  const full = collect(1), half = collect(0.5), none = collect(0);
  check('D. decorScale 0 → no decor drawables', none === 0, `${none}`);
  check('D. decorScale 0.5 → a nonempty subset of full', half > 0 && half < full, `${half} of ${full}`);
  check('D. decorScale 1 → all decor', full > 0, `${full}`);
}

// ── E. Ladder reduces work (ops as a proxy for rebuild cost) ───────────────
{
  const bufsAt = (lvl) => {
    const e = env6(MIXED);
    run(e, `KWMap.perf._raw.level=${lvl}; KWMap.perf._raw.lowDetail=false; KWMap.controller.active._invalid=true; KWMap.controller.renderFrame(300);`);
    return { g: run(e, 'KWMap.controller.active._ground.canvas._log').length, t: run(e, 'KWMap.controller.active._tall.canvas._log').length };
  };
  const full = bufsAt(0), noDecor = bufsAt(2), noShadow = bufsAt(4);
  check('E. decor-off (L2) shrinks the GROUND buffer work', noDecor.g < full.g, `${noDecor.g} < ${full.g}`);
  check('E. shadows-off (L4) shrinks the TALL buffer work', noShadow.t < full.t, `${noShadow.t} < ${full.t}`);
}

// ── F. Device tier / margin, determinism, suites ───────────────────────────
{
  const e = env6();
  const tier = run(e, 'KWMap.perf.tier'), margin = run(e, 'KWMap.perf.margin'), budget = run(e, 'KWMap.perf.budget');
  check('F. device tier picks a sane margin + budget', (margin >= 80 && margin <= 260) && (budget === 16 || budget === 50), `${tier} m${margin} b${budget}`);

  const render = () => { const x = env6(MIXED); run(x, 'KWMap.controller.renderFrame(300);'); return run(x, 'KWMap.controller.active._ground.canvas._log'); };
  check('F. determinism holds at a fixed detail level', eq(render(), render()));

  let ok = true, out = '';
  try { out = execFileSync('node', [path.join(__dirname, 'phase5_proofs.js')], { encoding: 'utf8' }); }
  catch (err) { ok = false; out = (err.stdout || '') + (err.stderr || ''); }
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  check('F. phase5_proofs.js (→ P4 → … → P1 golden) still green', ok && m && m[2] === '0', m ? `${m[1]} passed, ${m[2]} failed` : 'no summary');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
