// Phase 4 verification harness (node, no deps) — decoration system (spec §5).
// Run:  node verify/phase4_proofs.js
//
//   A. Deterministic placement — placement(q,r,terrain,seed,season) is a pure
//      function (identical across calls); positions are season-INDEPENDENT.
//   B. Season flip changes sprite keys only — base positions/scales are hash-
//      stable: placement(summer) minus flowers === placement(winter) minus snow.
//   C. worldSeed — seed changes reshuffle; worldSeedOf reads seed / world_meta /
//      falls back to the constant 1.
//   D. Decor is inert to hit-testing (spec §5.1) — a decorated tile still picks
//      as its terrain tile; tall decor never captures.
//   E. Buffer determinism with decor — two rebuilds → byte-identical GROUND and
//      TALL ctx logs.
//   F. Top-down still golden with decor loaded (renderer untouched).
//   G. No Math.random / apiFetch / gameplay writes in kwmap-*.js (incl. decor).
//   H. Prior suites (P1 golden + P2 + P3) still green.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;

const P4_FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'kwmap-decor.js', 'main.js'];
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase1_topdown_golden.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);

function env4(worldJs, cam, activate) {
  const e = makeEnv(); H.loadTree(e, P4_FILES);
  if (worldJs) vm.runInContext(worldJs, e.context);
  setUi(e, null, null, null, cam || { q: 20, r: 15 });
  if (activate) vm.runInContext("KWMap.controller.setRenderer('iso');", e.context);
  return e;
}
const PLACE = (e, q, r, terr, seed, season) =>
  J(e, `KWMap.decor.placement(${q},${r},'${terr}',${seed},'${season}').map(p=>({t:p.type,ox:Math.round(p.ox*1000),oy:Math.round(p.oy*1000),sc:Math.round(p.scale*1000),tall:p.tall}))`);

// ── A. Deterministic + season-independent positions ────────────────────────
{
  const e = env4();
  let ok = true, detail = '';
  for (const [q, r, terr] of [[5, 7, 'plains'], [9, 3, 'forest'], [12, 12, 'hills'], [2, 8, 'marsh'], [15, 4, 'ruins']]) {
    const a = PLACE(e, q, r, terr, 1, 'summer');
    const b = PLACE(e, q, r, terr, 1, 'summer');
    if (!eq(a, b)) { ok = false; detail = `(${q},${r}) not deterministic`; break; }
  }
  check('A. placement is deterministic (identical across calls)', ok, detail);
}

// ── B. Season flip changes sprite keys only (base positions hash-stable) ───
{
  const e = env4();
  let ok = true, detail = '';
  for (const [q, r, terr] of [[5, 7, 'plains'], [3, 3, 'plains'], [8, 11, 'plains'], [14, 6, 'plains'], [1, 1, 'plains']]) {
    const summer = PLACE(e, q, r, terr, 1, 'summer').filter(p => p.t !== 'flower_red');
    const winter = PLACE(e, q, r, terr, 1, 'winter').filter(p => p.t !== 'snow_pile');
    if (!eq(summer, winter)) { ok = false; detail = `(${q},${r}) base moved between seasons`; break; }
  }
  check('B. base placement is season-stable (summer−flowers === winter−snow)', ok, detail);

  // and the season DOES change which sprites appear
  let changed = false;
  for (let q = 0; q < 20 && !changed; q++) for (let r = 0; r < 20; r++) {
    const s = PLACE(e, q, r, 'plains', 1, 'summer').map(p => p.t).join(',');
    const w = PLACE(e, q, r, 'plains', 1, 'winter').map(p => p.t).join(',');
    if (s !== w) { changed = true; break; }
  }
  check('B. season flip visibly changes the sprite set somewhere', changed);
}

// ── C. worldSeed ───────────────────────────────────────────────────────────
{
  const e = env4();
  let differs = false;
  for (let q = 0; q < 40 && !differs; q++) for (let r = 0; r < 40; r++) {
    if (!eq(PLACE(e, q, r, 'plains', 1, 'summer'), PLACE(e, q, r, 'plains', 2, 'summer'))) { differs = true; break; }
  }
  check('C. changing worldSeed reshuffles placement', differs);
  const ws = J(e, `[KWMap.decor.worldSeedOf({seed:42}), KWMap.decor.worldSeedOf({world_meta:{current_seed:7}}), KWMap.decor.worldSeedOf({}), KWMap.decor.worldSeedOf(null)]`);
  check('C. worldSeedOf: seed / world_meta / fallback 1', eq(ws, [42, 7, 1, 1]), JSON.stringify(ws));
}

// ── D. Decor inert to hit-testing ──────────────────────────────────────────
{
  // A plains tile carrying a tall decor prop must still pick as itself.
  const world = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:20}});})();`;
  const e = env4(world, { q: 20, r: 20 }, true);
  const W = 1400, H2 = 800;
  let ok = true, detail = '';
  for (let q = 12; q <= 28 && ok; q++) for (let r = 12; r <= 28; r++) {
    const c = J(e, `KWMap.controller.active.hexToScreen(${q},${r},camera,${W},${H2})`);
    if (!c) continue;
    const h = J(e, `KWMap.controller.active.screenToHex(${c.x},${c.y},camera,${W},${H2})`);
    if (!h || h.wq !== q || h.wr !== r) { ok = false; detail = `(${q},${r}) → ${JSON.stringify(h)}`; break; }
  }
  check('D. decorated tiles still pick as their terrain tile (decor inert)', ok, detail);
}

// ── E. Buffer determinism with decor ───────────────────────────────────────
{
  const world = `(function(){const T=['plains','forest','hills','mountain','marsh','ruins'];const tiles=[];
    for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:T[(q*3+r)%6],revealed:true});
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;
  const render = () => {
    const e = env4(world, { q: 20, r: 15 }, true);
    run(e, 'KWMap.controller.renderFrame(700);');
    return { g: run(e, 'KWMap.controller.active._ground.canvas._log'), t: run(e, 'KWMap.controller.active._tall.canvas._log') };
  };
  const a = render(), b = render();
  check('E. GROUND buffer byte-identical across rebuilds (with decor)', eq(a.g, b.g), `${a.g.length} vs ${b.g.length}`);
  check('E. TALL buffer byte-identical across rebuilds (with decor)', eq(a.t, b.t), `${a.t.length} vs ${b.t.length}`);
}

// ── F. Top-down still golden with decor loaded ─────────────────────────────
{
  const e = makeEnv(); H.loadTree(e, P4_FILES); setUi(e, null, null, null);
  e.logs.map.length = 0; run(e, 'KWMap.controller.renderFrame(12345);');
  check('F. top-down render identical to golden (decor loaded, providers registered)',
    eq(e.logs.map, GOLDEN.render), `${e.logs.map.length} vs ${GOLDEN.render.length} ops`);
}

// ── G. Grep gate (kwmap-*.js incl. decor) ──────────────────────────────────
{
  const files = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'kwmap-decor.js'];
  const forbidden = [[/\bapiFetch\b/, 'apiFetch'], [/Math\.random/, 'Math.random'], [/\btickResources\b/, 'tickResources'], [/\bgameData\b/, 'gameData'], [/worldMapData\s*=[^=]/, 'worldMapData assign'], [/worldMapData\.\w+\s*=[^=]/, 'worldMapData.<f> write']];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  let clean = true, hits = [];
  for (const f of files) { const src = strip(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')); for (const [re, l] of forbidden) if (re.test(src)) { clean = false; hits.push(f + ':' + l); } }
  check('G. no apiFetch / Math.random / gameplay-state writes in kwmap-*.js', clean, hits.join(' | '));
}

// ── H. Prior suites still green (P3 spawns P2 which carries the P1 golden) ──
{
  let ok = true, out = '';
  try { out = execFileSync('node', [path.join(__dirname, 'phase3_proofs.js')], { encoding: 'utf8' }); }
  catch (e) { ok = false; out = (e.stdout || '') + (e.stderr || ''); }
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  check('H. phase3_proofs.js (→ spawns phase2 → P1 golden) still green', ok && m && m[2] === '0', m ? `${m[1]} passed, ${m[2]} failed` : 'no summary');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
