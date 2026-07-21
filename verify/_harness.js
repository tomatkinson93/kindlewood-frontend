'use strict';
// Shared verification harness (node, no deps) — extends the phase1_proofs.js
// patterns: vm sandbox, recording 2d ctx proxy, DOM element stubs, the 40x40
// fixture world. Used by _gen_golden.js and phase2_proofs.js.
const fs = require('fs'), vm = require('vm');

function makeCtx(log) {
  const norm = a => a.map(v => typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v));
  const grad = () => ({ addColorStop(...a) { log.push(['gradStop', ...norm(a)]); } });
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

// An offscreen canvas stub whose 2d context RECORDS into its own log. Buffer
// canvases created by the iso renderer get their own recorder so we can hash
// GROUND/TALL buffer draw sequences deterministically.
function makeCanvasStub(w, h, tag) {
  const log = [];
  const c = {
    _tag: tag, _log: log, width: w || 0, height: h || 0, style: {},
    getContext: () => makeCtx(log),
    toDataURL: () => 'data:stub,' + tag,
  };
  return c;
}

function makeEl(id, ctxLog, created) {
  const el = {
    id, style: {}, dataset: {}, children: [],
    offsetWidth: 1400, offsetHeight: 800, clientWidth: 1400, clientHeight: 800,
    width: 0, height: 0, naturalWidth: 0, complete: false,
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setAttribute() {}, insertAdjacentElement(pos, c) { el._inserted = c; if (created) created.push(c); },
    appendChild(c) { el.children.push(c); if (created) created.push(c); return c; },
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => makeCtx(ctxLog),
  };
  return el;
}

function makeEnv(opts) {
  opts = opts || {};
  const logs = { map: [], uifx: [] };
  const created = [];              // canvases created via document.createElement
  const mapCanvas = makeEl('map-canvas', logs.map, created);
  const mapFrame = makeEl('map-frame', [], created);
  const els = { 'map-canvas': mapCanvas, 'map-frame': mapFrame };
  let createdCount = 0;
  const doc = {
    hidden: false, readyState: 'complete', activeElement: { tagName: 'BODY' },
    getElementById: (id) => els[id] || null,
    createElement: (tag) => {
      // First created canvas = uifx (matches phase1 harness); subsequent
      // canvases (iso buffers, HUD) record into their own logs.
      createdCount++;
      if (tag === 'canvas' && createdCount === 1) {
        const c = makeEl('created-uifx', logs.uifx, created);
        c.getContext = () => makeCtx(logs.uifx);
        created.push(c);
        return c;
      }
      const c = makeEl('created-' + tag + '-' + createdCount, [], created);
      const own = [];
      c._log = own;
      c.getContext = () => makeCtx(own);
      created.push(c);
      return c;
    },
    addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    body: makeEl('body', [], created),
  };
  const rafQ = [];
  const sandbox = {
    console, Math, JSON, Object, Array, Number, String, Boolean, Set, Map, Promise, Date,
    parseInt, parseFloat, isNaN, isFinite, performance: { now: () => 12345 },
    document: doc, navigator: { hardwareConcurrency: 8 }, screen: { width: 1920, height: 1080 },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem(k, v) { s[k] = String(v); }, removeItem(k) { delete s[k]; } }; })(),
    Image: function () { return { style: {}, addEventListener() {} }; },
    requestAnimationFrame: (f) => { rafQ.push(f); return rafQ.length; },
    cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    IntersectionObserver: class { constructor(cb) { sandbox.__ioCb = cb; } observe() {} },
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    fetch: () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
    alert() {}, confirm: () => false,
    location: { search: opts.search || '' },
    devicePixelRatio: opts.dpr || 1,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  return { context, logs, rafQ, sandbox, els, created };
}

const FIXTURE_JS = `
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
  _tileImagesLoaded = false;
  if (typeof getTileVariant !== 'function') globalThis.getTileVariant = () => null;
`;

// Load the production renderer tree. `files` lets phase2 add assets+iso.
function loadTree(env, files) {
  for (const f of (files || ['kwmap-core.js', 'kwmap-topdown.js', 'main.js'])) {
    vm.runInContext(fs.readFileSync('js/' + f, 'utf8'), env.context, { filename: f });
  }
  vm.runInContext('globalThis.__SET_WORLD = (w) => { worldMapData = w; };', env.context);
  vm.runInContext(FIXTURE_JS, env.context);
}
// Back-compat alias used by earlier scripts.
function loadNew(env) { return loadTree(env); }

function setUi(env, hovered, selected, selFog, cam) {
  cam = cam || { q: 20, r: 15 };
  vm.runInContext(`
    camera.q = ${cam.q}; camera.r = ${cam.r};
    _fogOffset = 777;
    _hoveredTile = ${JSON.stringify(hovered)};
    _selectedTile = ${JSON.stringify(selected)};
    _selectedFogTile = ${JSON.stringify(selFog)};
  `, env.context);
}

module.exports = { makeCtx, makeEl, makeEnv, makeCanvasStub, FIXTURE_JS, loadTree, loadNew, setUi, vm, fs };
