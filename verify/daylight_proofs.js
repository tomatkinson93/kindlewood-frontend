'use strict';
// Spec 021 Phase 3 — map lighting proofs (node, no deps). Run from the repo root:
//   node verify/daylight_proofs.js
//   1. Day no-op: at noon UTC the pass makes zero canvas calls, in both
//      renderers (direct spy + whole-frame logs identical to no-daylight).
//   2. Wired: at night both renderers shade, pool and glow.
//   3. Positions come from the renderers' own visible lists and match where
//      the settlement was drawn (labelAnchor footing).
//   4. Fog of war: a settlement on a hidden tile emits no light.
//   5. Flicker deterministic + bounded; none under reduced motion; no
//      Math.random in the new / touched files.
//   6. Settings: Off → darkness 0; Soft → exactly half; Off at night draws
//      only lit windows at ≤50% alpha.
//   7. Hostile: violet light, no window glow. Windows stagger; ~15% never light.
//   8. Golden: tileactions_proofs.js (→ phase7 → … → P1 golden) still green.
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const { makeEnv, makeCtx, setUi, vm, fs } = H;

const NOON = Date.parse('2026-11-05T12:00:00Z');
const NIGHT = Date.parse('2026-11-05T03:00:00Z');
const BASE = ['kwmap-core.js', 'kwmap-settlements.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'main.js'];
const LIT = ['day-cycle.js', 'server-clock.js', 'kwmap-core.js', 'kwmap-settlements.js', 'kwmap-daylight.js',
             'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'main.js'];

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
};
const run = (env, stmt) => vm.runInContext(stmt, env.context);
const J = (env, expr) => JSON.parse(run(env, 'JSON.stringify(' + expr + ')'));

// Fixture world + a hostile settlement and a settlement on a fog tile.
const EXTRA = `(function(){
  const at = (q, r) => worldMapData.tiles.find(t => t.q === q && t.r === r);
  Object.assign(at(17, 14), { terrain: 'plains', settlement: { settlement_type: 'hostile', disposition: 'hostile', name: 'W' } });
  Object.assign(at(21, 17), { terrain: 'fog', settlement: { settlement_type: 'npc', disposition: 'friendly', tier: 'town', name: 'Hidden' } });
  Object.assign(at(19, 13), { terrain: 'plains', settlement: { tier: 'camp', name: 'Camp' } });
})();`;

function env(files, view, pinMs) {
  const e = makeEnv();
  e.sandbox.__KW_NO_AUTOSTART = true;
  e.sandbox.matchMedia = () => ({ matches: false });
  H.loadTree(e, files);
  run(e, EXTRA);
  setUi(e, null, null, null, { q: 20, r: 15 });
  if (view) run(e, `KWMap.controller.setRenderer('${view}');`);
  if (pinMs && e.sandbox.KWClock) e.sandbox.KWClock.pin(pinMs);
  return e;
}
const frame = (e, ts) => { e.logs.map.length = 0; run(e, `KWMap.controller.renderFrame(${ts || 1000});`); return e.logs.map.slice(); };
const ops = (log, k) => log.filter(x => x[0] === 'set:globalCompositeOperation' && x[1] === k).length;

// ── 1. Day no-op ───────────────────────────────────────────────────────────
for (const view of ['topdown', 'iso']) {
  const lit = env(LIT, view, NOON);
  const plain = env(BASE, view);
  const a = JSON.stringify(frame(lit)), b = JSON.stringify(frame(plain));
  const bufs = (e) => JSON.stringify(e.created.map(c => c._log || []));
  check(`1. ${view}: noon frame (map canvas + every offscreen buffer) byte-identical with and without the daylight pass`,
        a === b && a.length > 100 && lit.created.length === plain.created.length && bufs(lit) === bufs(plain),
        a === b ? a.length + ' chars · ' + lit.created.length + ' canvases' : 'differs');
  const spy = [];
  let asked = 0;
  const r = { visibleSettlements() { asked++; return run(lit, 'KWMap.controller.active.visibleSettlements()'); } };
  const drew = lit.sandbox.KWDaylight.draw(makeCtx(spy), 1400, 800, 1, r, 1000);
  check(`1. ${view}: noon KWDaylight.draw → false, 0 canvas calls, positions never requested`,
        drew === false && spy.length === 0 && asked === 0, spy.length + ' calls');
}

// ── 2. Wired at night ──────────────────────────────────────────────────────
for (const view of ['topdown', 'iso']) {
  const e = env(LIT, view, NIGHT);
  const log = frame(e);
  const shade = e.created.filter(c => c._log && c._log.some(x => x[0] === 'set:globalCompositeOperation' && x[1] === 'destination-out'));
  check(`2. ${view}: night frame multiplies the shade, adds halos, punches pools`,
        ops(log, 'multiply') === 1 && ops(log, 'lighter') === 1 && shade.length === 1,
        `multiply ${ops(log, 'multiply')} · lighter ${ops(log, 'lighter')} · pool canvases ${shade.length}`);
}

// ── 3. Positions from the renderer's visible list ─────────────────────────
for (const view of ['topdown', 'iso']) {
  const e = env(LIT, view, NIGHT);
  frame(e);
  const vis = J(e, 'KWMap.controller.active.visibleSettlements().map(v => ({ q: v.wq, r: v.wr, x: v.cx, y: v.baseY }))');
  let worst = 0, n = 0;
  for (const v of vis) {
    const a = J(e, `KWMap.controller.active.labelAnchor(${v.q}, ${v.r}, camera, 1400, 800)`);
    if (!a || a.x < 0 || a.x > 1400 || a.y < 0 || a.y > 800) continue;
    worst = Math.max(worst, Math.abs(a.x - v.x), Math.abs(a.y - v.y)); n++;
  }
  check(`3. ${view}: light footing = drawn footing (labelAnchor) for every on-screen settlement`,
        n >= 4 && worst <= 1.5, `${n} compared · max Δ ${worst.toFixed(2)}px`);
}

// ── 4. Fog of war ──────────────────────────────────────────────────────────
for (const view of ['topdown', 'iso']) {
  const e = env(LIT, view, NIGHT);
  frame(e);
  const listed = J(e, 'KWMap.controller.active.visibleSettlements().some(v => v.wq === 21 && v.wr === 17)');
  const src = J(e, 'KWDaylight.sourcesFor(KWMap.controller.active, 1400, 800).map(s => s.q + "," + s.r)');
  const total = J(e, 'KWMap.controller.active.visibleSettlements().length');
  check(`4. ${view}: hidden-tile settlement is in the visible list but emits no light`,
        listed && src.indexOf('21,17') < 0 && src.length === total - 1, `${src.length}/${total} sources`);
}
{
  const e = env(LIT, null, NIGHT);
  check('4b. lightFor(): missing tile / fog tile → null',
        J(e, `[KWDaylight.lightFor(null), KWDaylight.lightFor({ q: 1, r: 1, terrain: 'fog', settlement: { tier: 'city' } })]`).every(x => x === null));
}

// ── 5. Flicker determinism ────────────────────────────────────────────────
{
  const e = env(LIT, null, NIGHT);
  const F = (t, q, r, k, rm) => J(e, `KWDaylight.flicker(${t}, ${q}, ${r}, '${k}', ${!!rm})`);
  const same = JSON.stringify(F(12.34, 20, 15, 'lamp')) === JSON.stringify(F(12.34, 20, 15, 'lamp'));
  const differs = JSON.stringify(F(12.34, 20, 15, 'lamp')) !== JSON.stringify(F(12.34, 21, 15, 'lamp'));
  let ok = true;
  for (let i = 0; i < 400; i++) {
    const f = F(i * 0.37, i % 40, (i * 7) % 40, 'lamp'), p = F(i * 0.37, i % 40, (i * 7) % 40, 'pulse');
    if (Math.abs(f.radius - 1) > 0.06 + 1e-9 || Math.abs(f.alpha - 1) > 0.10 + 1e-9) ok = false;
    if (Math.abs(p.radius - 1) > 0.06 + 1e-9 || Math.abs(p.alpha - 1) > 0.10 + 1e-9) ok = false;
  }
  const rm = F(5, 3, 4, 'fire', true);
  check('5. flicker(t,q,r) deterministic, varies by tile, within ±6% radius / ±10% alpha', same && differs && ok);
  check('5b. reduced motion → no flicker', rm.radius === 1 && rm.alpha === 1);
  const src = ['kwmap-daylight.js', 'kwmap-settlements.js', 'dev-time.js', 'server-clock.js', 'day-cycle.js']
    .map(f => fs.readFileSync('js/' + f, 'utf8')).join('\n');
  check('5c. no Math.random in kwmap-daylight / kwmap-settlements / dev-time / clock files', !/Math\.random/.test(src));
}

// ── 6. Settings ────────────────────────────────────────────────────────────
{
  const e = env(LIT, null, NIGHT);
  const D = e.sandbox.KWDaylight;
  const raw = J(e, 'KWClock.lighting()');
  D.setSetting('on'); const on = D.state();
  D.setSetting('soft'); const soft = D.state();
  D.setSetting('off'); const off = D.state();
  check('6. On = raw lighting (night darkness > 0)', on.darkness === raw.darkness && on.darkness > 0.4, 'darkness ' + on.darkness.toFixed(3));
  check('6. Soft = exactly half darkness', soft.darkness === on.darkness / 2 && soft.lightLevel === on.lightLevel);
  check('6. Off = darkness 0 (lights still on for windows)', off.darkness === 0 && off.tintStrength === 0 && off.lightLevel === on.lightLevel);
  check('6b. setting persists in localStorage kw_night_lighting', e.sandbox.localStorage.getItem('kw_night_lighting') === 'off');
  // Off at night through the real renderer: windows only, at ≤ 50%.
  run(e, "KWMap.controller.setRenderer('topdown');");
  const log = frame(e);
  // 9-arg drawImage = a window cell; record the globalAlpha in force for each.
  let cur = 1; const winAlpha = [];
  for (const x of log) {
    if (x[0] === 'set:globalAlpha') cur = x[1];
    else if (x[0] === 'drawImage' && x.length === 10) winAlpha.push(cur);
  }
  check('6c. Off at night: no shade/pool/halo compositing, lit windows drawn at ≤50% alpha',
        ops(log, 'multiply') === 0 && ops(log, 'lighter') === 0 && winAlpha.length > 0 && Math.max(...winAlpha) <= 0.5,
        `${winAlpha.length} window blits · max alpha ${Math.max(...winAlpha)}`);
  D.setSetting('on');
}

// ── 7. Hostile + windows ───────────────────────────────────────────────────
{
  const e = env(LIT, null, NIGHT);
  const D = e.sandbox.KWDaylight, S = e.sandbox.KWSettlements;
  const hostile = { q: 17, r: 14, terrain: 'plains', settlement: { settlement_type: 'hostile', disposition: 'hostile' } };
  const L = D.lightFor(hostile);
  check('7. hostile light is sickly violet #9a5cff, slow pulse, no windows',
        L.color === '#9a5cff' && L.flicker === 'pulse' && L.windows === false);
  const spy = []; S.drawGlow(makeCtx(spy), hostile, 100, 100, 64, 1, 1);
  check('7b. drawGlow on a hostile settlement makes 0 canvas calls', spy.length === 0);
  const own = D.lightFor({ q: 1, r: 1, terrain: 'plains', settlement: { tier: 'city', isOwn: true } });
  check('7c. player\'s own city light = 1.6 × 1.15', Math.abs(own.r - 1.6 * 1.15) < 1e-9 && own.color === '#ffd080');
  // Stagger: count lit windows over 300 village tiles at three light levels.
  const count = (level) => {
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const s = []; S.drawGlow(makeCtx(s), { q: i % 40, r: Math.floor(i / 40), terrain: 'plains', settlement: { tier: 'village' } }, 100, 100, 64, 1, level);
      n += s.filter(x => x[0] === 'drawImage').length;
    }
    return n;
  };
  const cells = S.glowFor({ q: 0, r: 0, settlement: { tier: 'village' } }, 64 * 1.05).cells.length;
  const n0 = count(0.001), n1 = count(0.15), n2 = count(1);
  const share = n2 / (300 * cells);
  check('7d. windows switch on staggered with lightLevel; ~15% never light',
        n0 < n1 && n1 < n2 && share > 0.78 && share < 0.92, `${n0} < ${n1} < ${n2} of ${300 * cells} · lit share ${share.toFixed(3)}`);
  const camp = []; S.drawGlow(makeCtx(camp), { q: 19, r: 13, terrain: 'plains', settlement: { tier: 'camp' } }, 100, 100, 64, 1, 1);
  check('7e. camp glow includes the campfire core', camp.some(x => x[0] === 'drawImage'));
}

// ── 8. Golden chain ────────────────────────────────────────────────────────
{
  let out = '', ok = false;
  try { out = execFileSync('node', [path.join(__dirname, 'tileactions_proofs.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); ok = /\b0 failed/.test(out.trim().split('\n').pop()); }
  catch (err) { out = String(err.stdout || err); }
  check('8. tileactions_proofs.js (→ phase7 → … → P1 golden) still green', ok, out.trim().split('\n').pop());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
