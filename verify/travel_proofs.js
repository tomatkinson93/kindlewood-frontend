'use strict';
// Citizen travel paths (js/travel.js + js/kwmap-travel.js).
//   node verify/travel_proofs.js
//   1. hexLine: shortest way round the wrapping map, continuous offsets.
//   2. phase(): outbound, return leg, done; one-way journeys end on arrival.
//   3. Layer off or nobody travelling → zero ops on the uifx context, so the
//      golden render logs can't change.
//   4. Real renderers: projectAxial matches hexToScreen (top-down + iso); a
//      frame with a journey draws a dashed trail, an ✕ and the traveller.
//   5. Dashes march (offset changes with time); hit-testing finds the walker.
//   6. Toggle persists kw_map_paths; the path layer obeys it.
//   7. Wiring: core hook, map button, Graphics setting, realtime refresh,
//      versioned tags; no apiFetch / Math.random in kwmap-travel.js.
const path = require('path');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);

const FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'main.js'];
function env(iso) {
  const e = makeEnv();
  H.loadTree(e, FILES);
  for (const f of ['travel.js', 'kwmap-travel.js']) vm.runInContext(read('js/' + f), e.context, { filename: f });
  setUi(e, null, null, null, { q: 20, r: 15 });
  if (iso) run(e, "KWMap.controller.setRenderer('iso');");
  return e;
}
const T0 = Date.parse('2026-10-20T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const JOURNEY = {
  id: 'market:1', kind: 'market', icon: '⚖️', citizen: { name: 'Ash', species: 'mice' },
  from: { q: 20, r: 15 }, to: { q: 24, r: 15 },
  departs_at: iso(T0 - 60e3), arrives_at: iso(T0 + 60e3), returns_at: iso(T0 + 180e3),
  title: 'Carrying 100 timber', cargo: { resource: 'timber', qty: 100, icon: '🪵' }, open: 'market',
};
// Freeze "now" for the travel module: skew = T0 − Date.now().
const setJourneys = (e, list) => run(e, `KWTravel._setForTest(${JSON.stringify(list)}, ${T0} - Date.now());`);

// ── 1. hexLine ───────────────────────────────────────────────────────────
{
  const e = env();
  const a = J(e, 'KWTravel.hexLine({q:2,r:5},{q:6,r:5},40,40)');
  check('1. straight line: 5 steps, unwrapped offsets', a.length === 5 && a[4].dq === 4 && a[4].dr === 0);
  const w = J(e, 'KWTravel.hexLine({q:38,r:5},{q:1,r:5},40,40)');
  check('1b. crosses the map edge the short way (3 hexes, not 37)', w.length === 4 && w[3].dq === 3);
  const cont = w.every((s, i) => i === 0 || Math.max(Math.abs(s.dq - w[i - 1].dq), Math.abs(s.dr - w[i - 1].dr), Math.abs((s.dq + s.dr) - (w[i - 1].dq + w[i - 1].dr))) === 1);
  check('1c. every step is one hex', cont);
}
// ── 2. phase ─────────────────────────────────────────────────────────────
{
  const e = env();
  const P = (j, t) => J(e, `KWTravel.phase(${JSON.stringify(j)}, ${t})`);
  check('2. halfway out', P(JOURNEY, T0).leg === 'out' && Math.abs(P(JOURNEY, T0).p - 0.5) < 1e-9);
  const back = P(JOURNEY, T0 + 120e3);
  check('2b. on the way home', back.leg === 'back' && Math.abs(back.p - 0.5) < 1e-9);
  check('2c. home → done', P(JOURNEY, T0 + 200e3).leg === 'done');
  const oneWay = { ...JOURNEY, returns_at: null };
  check('2d. one-way journeys end on arrival', P(oneWay, T0 + 61e3).leg === 'done');
}
// ── 3. no ops when off / empty ───────────────────────────────────────────
{
  const e = env();
  setJourneys(e, []);
  e.logs.uifx.length = 0;
  run(e, 'KWTravelLayer.draw(KWMap.controller._uifxCtx || {}, 1400, 800, KWMap.controller.active, camera, 1000);');
  check('3. nobody travelling → no ctx calls', e.logs.uifx.length === 0);
  const e2 = env();
  setJourneys(e2, [JOURNEY]);
  run(e2, 'KWTravel.setEnabled(false);');
  run(e2, 'KWMap.controller.renderFrame(12345);');
  const before = e2.logs.uifx.length;
  const e3 = env();
  setJourneys(e3, []);
  run(e3, 'KWMap.controller.renderFrame(12345);');
  check('3b. layer off → frame identical to no journeys', before === e3.logs.uifx.length && JSON.stringify(e2.logs.uifx) === JSON.stringify(e3.logs.uifx));
}
// ── 4. projection + drawing ──────────────────────────────────────────────
for (const view of ['topdown', 'iso']) {
  const e = env(view === 'iso');
  const p = J(e, 'KWMap.controller.active.projectAxial(21, 16, camera, 1400, 800)');
  const h = J(e, 'KWMap.controller.active.hexToScreen(21, 16, camera, 1400, 800)');
  check(`4. ${view}: projectAxial matches hexToScreen`, h && Math.abs(p.x - h.x) <= 1 && Math.abs(p.y - h.y) <= 1, `${JSON.stringify(p)} vs ${JSON.stringify(h)}`);
  const wrapped = J(e, 'KWMap.controller.active.projectAxial(61, 16, camera, 1400, 800)');
  check(`4b. ${view}: unwrapped copy one map-width away is off to the right`, wrapped.x > p.x + 1000);
  setJourneys(e, [JOURNEY]);
  e.logs.uifx.length = 0;
  run(e, 'KWMap.controller.renderFrame(12345);');
  const ops = e.logs.uifx;
  check(`4c. ${view}: trail is dashed`, ops.some(o => o[0] === 'setLineDash' ) && ops.some(o => o[0] === 'set:lineDashOffset'));
  check(`4d. ${view}: traveller token drawn (arc + fill)`, ops.some(o => o[0] === 'arc') && ops.some(o => o[0] === 'fill'));
  check(`4e. ${view}: save/restore balanced`, ops.filter(o => o[0] === 'save').length === ops.filter(o => o[0] === 'restore').length);
}
// ── 5. animation + hit-testing ───────────────────────────────────────────
{
  const e = env();
  setJourneys(e, [JOURNEY]);
  const offsets = [];
  for (const t of [1000, 1600]) {
    e.logs.uifx.length = 0;
    run(e, `KWMap.controller.renderFrame(${t});`);
    offsets.push(e.logs.uifx.filter(o => o[0] === 'set:lineDashOffset').map(o => o[1]).join());
  }
  check('5. dashes march: offset differs between frames', offsets[0] !== offsets[1], offsets.join(' | '));
  const hits = J(e, 'KWTravelLayer._hits().map(h => ({x:h.x,y:h.y,r:h.r,id:h.j.id}))');
  check('5b. one traveller hit circle recorded', hits.length === 1 && hits[0].id === 'market:1');
  const mid = J(e, 'KWMap.controller.active.projectAxial(22, 15, camera, 1400, 800)');
  check('5c. halfway out, the walker is near the middle of the road', Math.abs(hits[0].x - mid.x) < 30, `${hits[0].x} vs ${mid.x}`);
  check('5d. hitAt finds the walker; empty space finds nothing',
    J(e, `!!KWTravelLayer.hitAt(${hits[0].x}, ${hits[0].y})`) && !J(e, '!!KWTravelLayer.hitAt(5, 5)'));
  // A path across the edge: drawn as one short trail near the camera.
  const edge = { ...JOURNEY, id: 'scout:9', from: { q: 38, r: 15 }, to: { q: 1, r: 15 }, returns_at: null };
  const e2 = makeEnv(); H.loadTree(e2, FILES);
  for (const f of ['travel.js', 'kwmap-travel.js']) vm.runInContext(read('js/' + f), e2.context, { filename: f });
  setUi(e2, null, null, null, { q: 39, r: 15 });
  setJourneys(e2, [edge]);
  run(e2, 'KWMap.controller.renderFrame(1000);');
  const lines = e2.logs.uifx.filter(o => o[0] === 'lineTo').map(o => +o[1]);
  const span = Math.max(...lines) - Math.min(...lines);
  check('5e. edge-crossing path is one short continuous trail', lines.length > 0 && span < 48 * 5, `span ${Math.round(span)}px`);
}
// ── 6. toggle ────────────────────────────────────────────────────────────
{
  const e = env();
  run(e, 'KWTravel.setEnabled(false);');
  check('6. switching off persists kw_map_paths=0', J(e, "localStorage.getItem('kw_map_paths')") === '0' && J(e, 'KWTravel.enabled()') === false);
  run(e, 'KWTravel.toggle();');
  check('6b. toggle back on persists 1', J(e, "localStorage.getItem('kw_map_paths')") === '1' && J(e, 'KWTravel.enabled()') === true);
}
// ── 7. wiring ────────────────────────────────────────────────────────────
{
  const html = read('index.html'), core = read('js/kwmap-core.js'), layer = read('js/kwmap-travel.js');
  check('7. core renderFrame calls the travel layer, guarded', /if \(window\.KWTravelLayer && this\._uifxCtx\) window\.KWTravelLayer\.draw\(/.test(core));
  check('7b. 🐾 Paths map button', /id="map-paths-btn"[\s\S]*?KWTravel\.toggle\(\)/.test(html));
  check('7c. Graphics setting row', /data-travel-setting/.test(html) && /data-travel-setting/.test(read('js/settings-panel.js')));
  check('7d. realtime market + quest events refresh paths', (read('js/realtime.js').match(/KWTravel\.soon\(\)/g) || []).length >= 6);
  check('7e. versioned tags for travel.js, kwmap-travel.js, travel.css',
    /\/js\/travel\.js\?v=\w+/.test(html) && /\/js\/kwmap-travel\.js\?v=\w+/.test(html) && /\/css\/travel\.css\?v=\w+/.test(html));
  check('7f. kwmap-travel.js: no apiFetch, no Math.random', !/apiFetch|Math\.random/.test(layer));
  const starts = eval(read('js/travel.js').match(/const STARTS = (\/.*\/);/)[1]);
  check('7g. every porter dispatch refreshes the paths (village, Ironhaven, fill, pickup)',
    ['/api/market/npc/12/s0', '/api/market/ironhaven/sell', '/api/market/wants/9/fill', '/api/market/orders/4/pickup', '/api/market/orders/4/buy']
      .every(p => starts.test(p)) && !starts.test('/api/market/wants'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
