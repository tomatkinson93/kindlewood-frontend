// Phase 5 verification harness (node, no deps) — atmosphere polish (spec §7),
// invalidate('season') hook, winter decor variants, selection beacon, and the
// particle overlay's renderer-independence. Run: node verify/phase5_proofs.js
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;

const P5_FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'kwmap-decor.js', 'main.js'];

let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);

function env5(worldJs, cam) {
  const e = makeEnv(); H.loadTree(e, P5_FILES);
  if (worldJs) vm.runInContext(worldJs, e.context);
  setUi(e, null, null, null, cam || { q: 20, r: 15 });
  vm.runInContext("KWMap.controller.setRenderer('iso');", e.context);
  return e;
}
const PLAINS = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
  __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;

// ── 1. Haze / vignette — one radial gradient per frame on the map canvas ────
{
  const e = env5(PLAINS);
  run(e, 'KWMap.controller.renderFrame(100);');
  const grads = e.logs.map.filter(op => op[0] === 'createRadialGradient').length;
  const fullFill = e.logs.map.some(op => op[0] === 'fillRect' && op[3] === 1400 && op[4] === 800);
  check('1. haze draws exactly one radial gradient on the map canvas', grads === 1, `${grads} gradients`);
  check('1. haze is a full-frame gradient fill', fullFill);
  // ladder off-switch
  run(e, 'KWMap.controller.active._hazeOn = false;');
  e.logs.map.length = 0;
  run(e, 'KWMap.controller.active._invalid = true; KWMap.controller.renderFrame(116);');
  check('1. _hazeOn=false disables the haze gradient (Phase 6 ladder hook)',
    e.logs.map.filter(op => op[0] === 'createRadialGradient').length === 0);
}

// ── 2. invalidate('season') hook ───────────────────────────────────────────
{
  // source hook present in seasons.js
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'seasons.js'), 'utf8');
  check("2. seasons.js calls KWMap.controller.invalidate('season') on flip",
    /KWMap\.controller\.invalidate\(\s*['"]season['"]\s*\)/.test(src));
  // functional: invalidate('season') forces the next frame to rebuild
  const e = env5(PLAINS);
  run(e, 'KWMap.controller.renderFrame(100);');
  const rc0 = run(e, 'KWMap.controller.active._rebuildCount');
  run(e, "KWMap.controller.invalidate('season');");
  run(e, 'KWMap.controller.renderFrame(116);');
  const rc1 = run(e, 'KWMap.controller.active._rebuildCount');
  check("2. invalidate('season') triggers a buffer rebuild", rc1 === rc0 + 1, `rebuilds ${rc0}→${rc1}`);
}

// ── 3. Winter decor variants (season chain) — swap without reshuffle ────────
{
  const world = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15},seasonId:'summer'});})();`;
  const buffers = (season) => {
    const e = env5(world);
    run(e, `worldMapData.seasonId='${season}'; KWMap.controller.active._invalid=true; KWMap.controller.renderFrame(200);`);
    return { g: run(e, 'KWMap.controller.active._ground.canvas._log'), t: run(e, 'KWMap.controller.active._tall.canvas._log') };
  };
  const summer = buffers('summer'), winter = buffers('winter');
  const swapped = !eq(summer.g, winter.g) || !eq(summer.t, winter.t);
  check('3. season flip swaps decor variants (winter render differs)', swapped,
    `ground ${summer.g.length}/${winter.g.length}, tall ${summer.t.length}/${winter.t.length}`);

  // positions are hash-stable across the flip (no reshuffle)
  const e = env5();
  let stable = true, detail = '';
  const pos = (q, r, s) => J(e, `KWMap.decor.placement(${q},${r},'plains',1,'${s}').filter(p=>p.type!=='flower_red'&&p.type!=='snow_pile').map(p=>[p.type,Math.round(p.ox*1000),Math.round(p.oy*1000)])`);
  for (let q = 0; q < 12 && stable; q++) for (let r = 0; r < 12; r++) {
    if (!eq(pos(q, r, 'summer'), pos(q, r, 'winter'))) { stable = false; detail = `(${q},${r})`; break; }
  }
  check('3. decor positions unchanged across the season flip (no reshuffle)', stable, detail);
}

// ── 4. Selection beacon (occlusion relief) ─────────────────────────────────
{
  const e = env5(PLAINS);
  run(e, 'KWMap.controller.renderFrame(100);');
  const noSel = run(e, 'KWMap.controller.active') && e.logs.uifx.length;
  setUi(e, null, { wq: 20, wr: 15 }, null, { q: 20, r: 15 });
  run(e, 'KWMap.controller.renderFrame(116);');
  const beacon = e.logs.uifx.some(op => op[0] === 'set:fillStyle' && op[1] === 'rgba(255,205,60,0.95)');
  check('4. a selected tile draws a beacon on the uifx canvas', beacon);
}

// ── 5. Particle overlay is renderer-agnostic (works over iso unchanged) ─────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'season-atmosphere.js'), 'utf8');
  // It draws to its own canvas and never references the map renderer, so it
  // composits identically over top-down or iso (spec §7 / grounding note 7).
  check('5. season-atmosphere.js never references KWMap (independent overlay)', !/KWMap/.test(src));
  check('5. season-atmosphere.js owns its own canvas', /season-atmosphere-canvas/.test(src));
}

// ── 6. Prior suites still green ────────────────────────────────────────────
{
  let ok = true, out = '';
  try { out = execFileSync('node', [path.join(__dirname, 'phase4_proofs.js')], { encoding: 'utf8' }); }
  catch (e) { ok = false; out = (e.stdout || '') + (e.stderr || ''); }
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  check('6. phase4_proofs.js (→ P3 → P2 → P1 golden) still green', ok && m && m[2] === '0', m ? `${m[1]} passed, ${m[2]} failed` : 'no summary');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
