// Tile Actions + Detail View verification (node, no deps) — spec 11, increment 1.
// Run: node verify/tileactions_proofs.js
//
//   A. buttonFor — fog/undiscovered → 'scout'; discovered → 'zoom'.
//   B. waterSubtype — Pond / Riverside / Lake / Great Lake by neighbour count.
//   C. renderBody — header/coords, terrain bonus, ownership, outpost, settlement.
//   D. renderScene — terrain glyph + a structure badge.
//   E. Overlay is inert to the renderer — top-down still matches the golden with
//      kwmap-tileactions.js loaded.
//   F. Grep gate — no apiFetch / Math.random / gameplay writes.
//   G. Prior map suites still green.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;

const FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'kwmap-decor.js', 'main.js', 'kwmap-tileactions.js'];
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase1_topdown_golden.json'), 'utf8'));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);

// A river world: a compact lake blob at (10..13,10..13), a lone pond at (2,2),
// a 2-neighbour river run, plus an outpost + settlement tile.
const WORLD = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
  const set=(q,r,f)=>{const x=tiles.find(z=>z.q===q&&z.r===r); if(x)Object.assign(x,f);};
  // lake blob
  for(let q=10;q<=13;q++)for(let r=10;r<=13;r++)set(q,r,{terrain:'river'});
  // isolated pond
  set(2,2,{terrain:'river'});
  // short river run (each interior tile has 2 river neighbours)
  set(20,20,{terrain:'river'});set(21,20,{terrain:'river'});set(22,20,{terrain:'river'});
  // structures
  set(5,5,{outpost:{id:1,terrain:'plains',mine:true,owner:'Home'},claimed_by_me:true});
  set(6,6,{settlement:{settlement_type:'npc',name:'Otterby',username:'otto',tier:'village'}});
  set(7,7,{claim_owner:'Rival'});
  __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;

function env() {
  const e = makeEnv(); H.loadTree(e, FILES);
  run(e, WORLD);
  // Inject the terrain maps (const in main.js → not visible across vm scripts).
  run(e, `globalThis.WORLD_EMOJI={plains:'🌿',forest:'🌲',hills:'⛰',river:'🌊',ruins:'🏚',mountain:'🗻',marsh:'🌾'};
    globalThis.TERRAIN_LABELS={plains:'Open Plains',forest:'Dense Forest',river:'Riverside'};
    globalThis.TERRAIN_BONUSES_DISPLAY={plains:'+3 food/hr'};
    globalThis.TERRAIN_COLORS={plains:'#3D3820',river:'#1a3d35'};
    globalThis.OUTPOST_ICONS={plains:'🌾'};`);
  setUi(e, null, null, null, { q: 20, r: 15 });
  return e;
}
const tileOf = (e, q, r) => J(e, `worldMapData.tiles.find(t=>t.q===${q}&&t.r===${r})`);
const RB = (e, q, r) => run(e, `KWMap.tileActions.renderBody(worldMapData.tiles.find(t=>t.q===${q}&&t.r===${r}))`);
const WS = (e, q, r) => run(e, `KWMap.tileActions.waterSubtype(worldMapData.tiles.find(t=>t.q===${q}&&t.r===${r}))`);

// ── A. buttonFor ────────────────────────────────────────────────────────────
{
  const e = env();
  check('A. discovered tile → zoom (inspect)', run(e, `KWMap.tileActions.buttonFor(worldMapData.tiles.find(t=>t.q===5&&t.r===5))`) === 'zoom');
  check('A. fog/undiscovered tile → scout', run(e, `KWMap.tileActions.buttonFor({q:0,r:0,terrain:'fog'})`) === 'scout' && run(e, `KWMap.tileActions.buttonFor(null)`) === 'scout');
}

// ── B. waterSubtype ─────────────────────────────────────────────────────────
{
  const e = env();
  check('B. isolated river tile → Pond', WS(e, 2, 2) === 'Pond', WS(e, 2, 2));
  check('B. 2-neighbour river run → Riverside', WS(e, 21, 20) === 'Riverside', WS(e, 21, 20));
  const lake = WS(e, 11, 11);
  check('B. dense river blob → Lake / Great Lake', lake === 'Lake' || lake === 'Great Lake', lake);
}

// ── C. renderBody ───────────────────────────────────────────────────────────
{
  const e = env();
  const plains = RB(e, 30, 30);
  check('C. header shows terrain label + coords', /Open Plains/.test(plains) && /\(30, 30\)/.test(plains));
  check('C. terrain bonus row', /Terrain bonus/.test(plains) && /\+3 food\/hr/.test(plains));
  check('C. ownership row (unclaimed)', /Ownership/.test(plains) && /Unclaimed/.test(plains));

  const op = RB(e, 5, 5);
  check('C. outpost tile shows Outpost + Yours', /Outpost/.test(op) && /Yours/.test(op));
  check('C. your-claim tile shows "Your claim"', /Your claim/.test(op));

  const set = RB(e, 6, 6);
  check('C. settlement tile shows Settlement + name', /Settlement/.test(set) && /Otterby/.test(set));

  const rival = RB(e, 7, 7);
  check('C. rival-claimed tile shows "Claimed by Rival"', /Claimed by Rival/.test(rival));

  const water = RB(e, 11, 11);
  check('C. water tile header uses the water sub-type', /(Lake|Great Lake)/.test(water));
}

// ── D. renderScene ──────────────────────────────────────────────────────────
{
  const e = env();
  const scene = run(e, `KWMap.tileActions.renderScene(worldMapData.tiles.find(t=>t.q===5&&t.r===5))`);
  check('D. scene has the terrain glyph', /td-scene-glyph/.test(scene) && /🌿/.test(scene));
  check('D. scene badges the outpost', /td-scene-badge/.test(scene) && /🌾/.test(scene));
}

// ── E. Inert to the renderer (top-down golden unchanged) ───────────────────
{
  const e = makeEnv(); H.loadTree(e, FILES); setUi(e, null, null, null);
  e.logs.map.length = 0; run(e, 'KWMap.controller.renderFrame(12345);');
  check('E. top-down render identical to golden (tileactions loaded)', eq(e.logs.map, GOLDEN.render), `${e.logs.map.length} vs ${GOLDEN.render.length} ops`);
}

// ── F. Grep gate ────────────────────────────────────────────────────────────
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const src = strip(fs.readFileSync(path.join(__dirname, '..', 'js', 'kwmap-tileactions.js'), 'utf8'));
  const bad = [[/\bapiFetch\b/, 'apiFetch'], [/Math\.random/, 'Math.random'], [/\btickResources\b/, 'tickResources'], [/worldMapData\s*=[^=]/, 'worldMapData assign'], [/worldMapData\.\w+\s*=[^=]/, 'worldMapData.<f> write']];
  const hits = bad.filter(([re]) => re.test(src)).map(([, l]) => l);
  check('F. tileactions is a read-only consumer (no apiFetch / Math.random / world writes)', hits.length === 0, hits.join(' | '));
}

// ── G. Prior map suites still green ────────────────────────────────────────
{
  let ok = true, out = '';
  try { out = execFileSync('node', [path.join(__dirname, 'phase7_proofs.js')], { encoding: 'utf8' }); }
  catch (err) { ok = false; out = (err.stdout || '') + (err.stderr || ''); }
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  check('G. phase7_proofs.js (→ P6 → … → P1 golden) still green', ok && m && m[2] === '0', m ? `${m[1]} passed, ${m[2]} failed` : 'no summary');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
