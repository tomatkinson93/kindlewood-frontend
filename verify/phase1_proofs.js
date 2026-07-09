// Phase 1 verification harness (node, no deps).
// Proves the extraction is behavior-preserving per spec §1.4 / §12:
//   A. Render identity  — OLD _doRenderCanvas vs NEW controller.renderFrame:
//      identical map-canvas 2d call sequences (ui state null).
//   B. Stroke relocation — with hover/selection set: the uifx canvas ops are
//      an in-order subsequence of the OLD log, and OLD minus that subsequence
//      equals the NEW map-canvas log exactly.
//   C. Hit-test parity  — 30 screen points: OLD _canvasPixelToHex vs NEW
//      controller.screenToHex, identical (wq, wr).
//   D. Loop gating      — hidden ⇒ loop stops; visible ⇒ runs.
//   E. Registry         — register/dup-reject/layer-sort.
// Run: node verify/phase1_proofs.js OLD_MAIN NEW_DIR
'use strict';
const fs = require('fs');
const vm = require('vm');

const OLD_MAIN = process.argv[2];
const NEW_DIR  = process.argv[3];

// ── Recording 2d context ────────────────────────────────────────────────
function makeCtx(log) {
  const grad = () => ({ addColorStop(...a) { log.push(['gradStop', ...norm(a)]); } });
  const norm = (a) => a.map(v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v)));
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return undefined;
      if (typeof k !== 'string') return undefined;
      if (k === 'createRadialGradient' || k === 'createLinearGradient')
        return (...a) => { log.push([k, ...norm(a)]); return grad(); };
      if (k === 'measureText') return () => ({ width: 10 });
      return (...a) => { log.push([k, ...norm(a)]); };
    },
    set(t, k, v) {
      log.push(['set:' + String(k), typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v)]);
      return true;
    },
  });
}

function makeEl(id, ctxLog) {
  const el = {
    id, style: {}, dataset: {}, children: [],
    offsetWidth: 1400, offsetHeight: 800, clientWidth: 1400, clientHeight: 800,
    width: 0, height: 0, naturalWidth: 0, complete: false,
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setAttribute() {}, insertAdjacentElement(pos, c) { el._inserted = c; },
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => makeCtx(ctxLog),
  };
  return el;
}

function makeEnv() {
  const logs = { map: [], uifx: [] };
  const mapCanvas = makeEl('map-canvas', logs.map);
  const mapFrame = makeEl('map-frame', []);
  const els = { 'map-canvas': mapCanvas, 'map-frame': mapFrame };
  const doc = {
    hidden: false, readyState: 'complete', activeElement: { tagName: 'BODY' },
    getElementById: (id) => els[id] || null,
    createElement: (tag) => {
      const c = makeEl('created-' + tag, logs.uifx);   // first created canvas = uifx
      return c;
    },
    addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  };
  const rafQ = [];
  const sandbox = {
    console, Math, JSON, Object, Array, Number, String, Boolean, Set, Map, Promise, Date,
    parseInt, parseFloat, isNaN, isFinite, performance: { now: () => 12345 },
    document: doc, navigator: { hardwareConcurrency: 8 }, screen: { width: 1920, height: 1080 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Image: function () { return { style: {}, addEventListener() {} }; },
    requestAnimationFrame: (f) => { rafQ.push(f); return rafQ.length; },
    cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    IntersectionObserver: class { constructor(cb) { sandbox.__ioCb = cb; } observe() {} },
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    fetch: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    alert() {}, confirm: () => false,
    location: { search: '' },
    devicePixelRatio: 1,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  return { context, logs, rafQ, sandbox, els };
}

const FIXTURE_JS = `
  // Deterministic 40x40 fixture exercising every render branch.
  (function () {
    const terr = ['plains','forest','hills','mountain','river','marsh','ruins'];
    const tiles = [];
    for (let q = 0; q < 40; q++) for (let r = 0; r < 40; r++) {
      const t = { q, r, terrain: terr[(q * 7 + r * 3) % 7], revealed: true };
      if ((q * 13 + r * 5) % 11 === 0) t.terrain = 'fog';
      if (q === 20 && r === 15) t.settlement = { isOwn: true, name: 'Home', tier: 'village' };
      if (q === 24 && r === 15) t.settlement = { settlement_type: 'npc', disposition: 'friendly', name: 'NPC' };
      if (q === 26 && r === 17) t.settlement = { settlement_type: 'kingdom', is_kingdom: true, name: 'K' };
      if (q === 22 && r === 14) { t.outpost = { id: 1, terrain: t.terrain === 'fog' ? 'plains' : t.terrain, level: 1, mine: true, owner: 'Home' }; t.claimed_by_me = true; if (t.terrain === 'fog') t.terrain = 'plains'; }
      if (q === 18 && r === 16) { t.claim_owner = 'Rival'; if (t.terrain === 'fog') t.terrain = 'plains'; }
      tiles.push(t);
    }
    __SET_WORLD({ tiles, mapW: 40, mapH: 40, playerSettlement: { q: 20, r: 15 } });
  })();
  // Shared stubs for helpers both sides call identically:
  _tileImagesLoaded = false;                 // forces the flat-color path
  if (typeof getTileVariant !== 'function') globalThis.getTileVariant = () => null;
`;

function loadOld(env) {
  const code = fs.readFileSync(OLD_MAIN, 'utf8');
  vm.runInContext(code, env.context, { filename: 'old-main.js' });
  vm.runInContext('globalThis.__SET_WORLD = (w) => { worldMapData = w; };', env.context);
  vm.runInContext(FIXTURE_JS, env.context);
}

function loadNew(env) {
  for (const f of ['kwmap-core.js', 'kwmap-topdown.js', 'main.js']) {
    vm.runInContext(fs.readFileSync(NEW_DIR + '/js/' + f, 'utf8'), env.context, { filename: f });
  }
  vm.runInContext('globalThis.__SET_WORLD = (w) => { worldMapData = w; };', env.context);
  vm.runInContext(FIXTURE_JS, env.context);
}

const setUi = (env, hovered, selected, selFog) => vm.runInContext(`
  camera.q = 20; camera.r = 15;
  _fogOffset = 777;
  _hoveredTile = ${JSON.stringify(hovered)};
  _selectedTile = ${JSON.stringify(selected)};
  _selectedFogTile = ${JSON.stringify(selFog)};
`, env.context);

function renderOld(env) { env.logs.map.length = 0; vm.runInContext('_doRenderCanvas();', env.context); return env.logs.map.slice(); }
function renderNew(env) {
  env.logs.map.length = 0; env.logs.uifx.length = 0;
  vm.runInContext('KWMap.controller.renderFrame(12345);', env.context);
  return { map: env.logs.map.slice(), uifx: env.logs.uifx.slice() };
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// old minus (uifx as in-order subsequence) === newMap ?
function subtractSubsequence(oldLog, sub) {
  const out = []; let i = 0;
  for (const op of oldLog) {
    if (i < sub.length && eq(op, sub[i])) { i++; continue; }
    out.push(op);
  }
  return { rest: out, consumed: i };
}

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
};

// ── Test A: render identity, ui = null ──────────────────────────────────
{
  const o = makeEnv(); loadOld(o); setUi(o, null, null, null);
  const n = makeEnv(); loadNew(n); setUi(n, null, null, null);
  const oldLog = renderOld(o);
  const { map: newMap, uifx } = renderNew(n);
  check('A. map-canvas call sequence identical (ui null)', eq(oldLog, newMap),
        `old=${oldLog.length} new=${newMap.length} ops`);
  const uifxNonTrivial = uifx.filter(op => op[0] !== 'set:canvas' && op[0] !== 'setTransform' && op[0] !== 'clearRect');
  check('A. uifx canvas empty apart from clear/transform', uifxNonTrivial.length === 0, `${uifxNonTrivial.length} extra ops`);
  if (!eq(oldLog, newMap)) {
    for (let i = 0; i < Math.max(oldLog.length, newMap.length); i++) {
      if (!eq(oldLog[i], newMap[i])) { console.log('    first divergence @', i, '\n     old:', JSON.stringify(oldLog[i]), '\n     new:', JSON.stringify(newMap[i])); break; }
    }
  }
}

// ── Test B: stroke relocation, ui set ────────────────────────────────────
// Proof structure:
//   B1. NEW map log with ui === NEW map log without ui === OLD log without ui
//       (the world canvas is provably ui-independent AND still identical).
//   B2. OLD(null) is an in-order subsequence of OLD(ui)  (strokes were pure
//       insertions), and the op-multiset difference OLD(ui) − OLD(null)
//       equals the uifx stroke ops exactly (same ops, same args, same counts).
{
  const hovered = { wq: 21, wr: 16 }, selected = { wq: 23, wr: 14 }, selFog = { wx: 20, wy: 18 };

  const o = makeEnv(); loadOld(o);
  setUi(o, null, null, null);           const oldNull = renderOld(o);
  setUi(o, hovered, selected, selFog);  const oldUi   = renderOld(o);

  const n = makeEnv(); loadNew(n);
  setUi(n, null, null, null);           const newNull = renderNew(n);
  setUi(n, hovered, selected, selFog);  const newUi   = renderNew(n);

  check('B1. NEW world log is ui-independent', eq(newUi.map, newNull.map),
        `${newUi.map.length} vs ${newNull.map.length} ops`);
  check('B1. NEW world log === OLD baseline (no ui)', eq(newNull.map, oldNull),
        `${newNull.map.length} vs ${oldNull.length} ops`);

  const strokes = newUi.uifx.filter(op => op[0] !== 'setTransform' && op[0] !== 'clearRect');
  check('B2. uifx actually drew', strokes.length > 0, `${strokes.length} ops`);

  // subsequence existence: oldNull within oldUi
  let i = 0;
  for (const op of oldUi) if (i < oldNull.length && eq(op, oldNull[i])) i++;
  check('B2. OLD(null) is an in-order subsequence of OLD(ui)', i === oldNull.length,
        `${i}/${oldNull.length}`);

  // multiset difference oldUi − oldNull === strokes
  const counts = new Map();
  const bump = (op, d) => { const k = JSON.stringify(op); counts.set(k, (counts.get(k) || 0) + d); };
  oldUi.forEach(op => bump(op, +1));
  oldNull.forEach(op => bump(op, -1));
  strokes.forEach(op => bump(op, -1));
  const residue = [...counts.entries()].filter(([, v]) => v !== 0);
  check('B2. OLD(ui)−OLD(null) op-multiset === uifx strokes', residue.length === 0,
        residue.length ? `residue: ${residue.slice(0, 3).map(([k, v]) => v + '× ' + k).join(' | ')}` : '');
}

// ── Test C: hit-test parity ──────────────────────────────────────────────
{
  const o = makeEnv(); loadOld(o); setUi(o, null, null, null);
  const n = makeEnv(); loadNew(n); setUi(n, null, null, null);
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push([(i * 97) % 1400, (i * 53 + 7) % 800]);
  pts.push([0, 0], [1399, 799], [700, 400], [1, 799]);   // corners/centre/edges
  let all = true, mism = '';
  for (const [x, y] of pts) {
    const a = vm.runInContext(`JSON.stringify(_canvasPixelToHex(${x}, ${y}))`, o.context);
    const b = vm.runInContext(`JSON.stringify(KWMap.controller.screenToHex(${x}, ${y}))`, n.context);
    if (a !== b) { all = false; mism = `(${x},${y}): old=${a} new=${b}`; break; }
  }
  check('C. hit-test parity over ' + pts.length + ' points (incl. wrap window)', all, mism);
}

// ── Test D: loop gating ──────────────────────────────────────────────────
{
  const n = makeEnv(); loadNew(n); setUi(n, null, null, null);
  vm.runInContext('KWMap.controller.startLoop();', n.context);
  check('D. loop schedules while visible', n.rafQ.length === 1);
  // pump a few frames
  for (let i = 0; i < 3; i++) { const f = n.rafQ.shift(); f(1000 + i * 16); }
  check('D. loop keeps scheduling', n.rafQ.length === 1);
  n.sandbox.document.hidden = true;
  const f = n.rafQ.shift(); f(2000);
  check('D. loop stops when hidden', n.rafQ.length === 0);
  n.sandbox.document.hidden = false;
  vm.runInContext('KWMap.controller.requestRender();', n.context);
  check('D. requestRender restarts the loop when visible', n.rafQ.length === 1);
}

// ── Test E: registry ─────────────────────────────────────────────────────
{
  const n = makeEnv(); loadNew(n);
  const r = vm.runInContext(`
    const a = KWMap.controller.register({ id: 'roads-test', layer: KWMap.L.ROAD, collect: () => [] });
    const dup = KWMap.controller.register({ id: 'roads-test', layer: KWMap.L.ROAD });
    const b = KWMap.controller.register({ id: 'terrain-test', layer: KWMap.L.TERRAIN });
    JSON.stringify({ a, dup, b });
  `, n.context);
  const res = JSON.parse(r);
  check('E. provider registers on L.ROAD with zero kwmap edits', res.a === true);
  check('E. duplicate id rejected', res.dup === false);
  check('E. second provider accepted', res.b === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
