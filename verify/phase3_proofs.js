// Phase 3 verification harness (node, no deps) — spec §12.3 (raised-terrain +
// feature-inert hit-testing), §12.10(a)(b) (layer-stack contract), TALL-buffer
// determinism, contact shadows, plus the P1/P2 suite still green.
// Run:  node verify/phase3_proofs.js
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;

const ISO_FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'main.js'];

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
};
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);

function isoEnv(worldJs, cam) {
  const e = makeEnv();
  H.loadTree(e, ISO_FILES);
  if (worldJs) vm.runInContext(worldJs, e.context);
  setUi(e, null, null, null, cam || { q: 20, r: 15 });
  vm.runInContext("KWMap.controller.setRenderer('iso');", e.context);
  return e;
}

// ── 1. Raised-terrain + feature-inert hit-testing (§12.3) ──────────────────
{
  // Flat plains world with isolated features around camera (20,20).
  const M = { q: 20, r: 18 };     // mountain
  const RIV = { q: 24, r: 22 };   // river (recessed)
  const FL = { q: 16, r: 20 };    // plains
  const FOR = { q: 22, r: 20 };   // forest (canopy = tall feature)
  const BEH = { q: 22, r: 19 };   // plains BEHIND the forest canopy (occluded visually)
  const SET = { q: 18, r: 21 };   // settlement (building = tall)
  const world = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
    const set=(q,r,f)=>{const x=tiles.find(z=>z.q===q&&z.r===r); if(x)Object.assign(x,f);};
    set(${M.q},${M.r},{terrain:'mountain'}); set(${RIV.q},${RIV.r},{terrain:'river'});
    set(${FOR.q},${FOR.r},{terrain:'forest'});
    set(${SET.q},${SET.r},{settlement:{settlement_type:'npc',name:'NPC'}});
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:20}});})();`;
  const e = isoEnv(world, { q: 20, r: 20 });
  const W = 1400, H2 = 800;
  const ELEV = { mountain: 2.5, river: -0.6 };
  const centre = (t, terrain) => {
    const gc = J(e, `KWMap.controller.active.hexToScreen(${t.q},${t.r},camera,${W},${H2})`);
    return gc ? { x: gc.x, y: Math.round(gc.y - (ELEV[terrain] || 0) * 14) } : null;
  };
  const hit = (x, y) => J(e, `KWMap.controller.active.screenToHex(${x},${y},camera,${W},${H2})`);
  const is = (h, t) => h && h.wq === t.q && h.wr === t.r;

  const mc = centre(M, 'mountain');
  check('1. mountain face → mountain', mc && is(hit(mc.x, mc.y), M), mc ? JSON.stringify(hit(mc.x, mc.y)) : 'off');
  const rc = centre(RIV, 'river');
  check('1. recessed river face → river (own footprint)', rc && is(hit(rc.x, rc.y), RIV), rc ? JSON.stringify(hit(rc.x, rc.y)) : 'off');
  const fc = centre(FL, 'plains');
  check('1. flat plains → itself', fc && is(hit(fc.x, fc.y), FL), fc ? JSON.stringify(hit(fc.x, fc.y)) : 'off');

  // feature-inert: the forest CANOPY (a tall sprite) must not capture clicks —
  // clicking the forest tile returns the forest tile, and the plains tile
  // behind it (visually under the canopy) is still pickable on its own face.
  const forC = centre(FOR, 'plains'); // forest elevation 0
  check('1. forest tile (with canopy) → forest, canopy inert', forC && is(hit(forC.x, forC.y), FOR),
    forC ? JSON.stringify(hit(forC.x, forC.y)) : 'off');
  const behC = centre(BEH, 'plains');
  check('1. plains behind a canopy → that plains tile (feature never captures)', behC && is(hit(behC.x, behC.y), BEH),
    behC ? JSON.stringify(hit(behC.x, behC.y)) : 'off');

  // building sprite never captures: clicking the settlement tile returns that
  // tile (screenToHex is terrain-only; the building token is cosmetic to picks).
  const setC = centre(SET, 'plains');
  check('1. settlement tile → that tile (building sprite inert to picks)', setC && is(hit(setC.x, setC.y), SET),
    setC ? JSON.stringify(hit(setC.x, setC.y)) : 'off');
}

// ── 2. Layer-stack contract (§12.10 a,b) via depth-sorted TALL order ────────
{
  // Buildings at (10,10) & (10,12), a test NPC-stand-in at (10,11); forest +
  // outpost co-located at (10,14).
  const world = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
    const set=(q,r,f)=>{const x=tiles.find(z=>z.q===q&&z.r===r); if(x)Object.assign(x,f);};
    set(10,10,{settlement:{settlement_type:'npc',name:'A'}});
    set(10,12,{settlement:{settlement_type:'npc',name:'B'}});
    set(10,14,{terrain:'forest',outpost:{id:1,terrain:'forest',mine:true}});
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:10,r:12}});})();`;
  const e = isoEnv(world, { q: 10, r: 12 });
  // register a dummy NPC provider on L.NPC (zero kwmap edits) at (10,11)
  run(e, `KWMap.controller.register({ id:'npc-test', layer:KWMap.L.NPC, space:'world',
    collect:()=>[{wq:10,wr:11}], draw:function(){} });`);
  const order = J(e, `KWMap.controller.active._computeTallOrder(1400,800,worldMapData)`);
  const idx = (wq, wr, layer) => order.findIndex(o => o.wq === wq && o.wr === wr && (layer == null || o.layer === layer));

  const iBack = idx(10, 10, 50), iNpc = idx(10, 11, 90), iFront = idx(10, 12, 50);
  check('2a. depth beats layer: back building < NPC(front tile) < front building',
    iBack >= 0 && iNpc >= 0 && iFront >= 0 && iBack < iNpc && iNpc < iFront,
    `idx back=${iBack} npc=${iNpc} front=${iFront}`);

  const iFeat = idx(10, 14, 15), iOut = idx(10, 14, 60);
  check('2b. within a tile, higher layer draws later: feature(15) < outpost(60)',
    iFeat >= 0 && iOut >= 0 && iFeat < iOut, `feature=${iFeat} outpost=${iOut}`);

  // (also confirm the dummy provider on an unused-by-iso tall layer needed zero
  // kwmap edits and appears in the order — the §3.0 extension contract)
  check('2. externally-registered NPC provider appears in the TALL pass', iNpc >= 0);
}

// ── 3. TALL-buffer determinism ─────────────────────────────────────────────
{
  const world = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++){const T=['plains','forest','hills','mountain'][(q+r)%4];tiles.push({q,r,terrain:T,revealed:true});}
    tiles.find(t=>t.q===20&&t.r===15).settlement={isOwn:true,name:'H'};
    tiles.find(t=>t.q===22&&t.r===16).outpost={id:1,terrain:'hills',mine:true};
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;
  const render = () => { const e = isoEnv(world, { q: 20, r: 15 }); run(e, 'KWMap.controller.renderFrame(500);'); return run(e, 'KWMap.controller.active._tall.canvas._log'); };
  const a = render(), b = render();
  const eq = JSON.stringify(a) === JSON.stringify(b);
  check('3. two independent TALL rebuilds produce identical ctx logs', eq, `${a.length} vs ${b.length} ops`);

  // contact shadow per drawable: one radial gradient per TALL item.
  const e = isoEnv(world, { q: 20, r: 15 });
  run(e, 'KWMap.controller.renderFrame(500);');
  const tallLog = run(e, 'KWMap.controller.active._tall.canvas._log');
  const gradients = tallLog.filter(op => op[0] === 'createRadialGradient').length;
  const items = J(e, 'KWMap.controller.active._computeTallOrder(1400,800,worldMapData)').length;
  check('3. one contact-shadow gradient per TALL drawable', gradients === items && items > 0, `${gradients} shadows / ${items} items`);
}

// ── 4. Content signature refreshes buffers without touching main.js ─────────
{
  const world = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;
  const e = isoEnv(world, { q: 20, r: 15 });
  run(e, 'KWMap.controller.renderFrame(100);');
  const rc0 = run(e, 'KWMap.controller.active._rebuildCount');
  run(e, 'KWMap.controller.renderFrame(116);');            // no change → no rebuild
  const rc1 = run(e, 'KWMap.controller.active._rebuildCount');
  run(e, "worldMapData.tiles.find(t=>t.q===20&&t.r===15).outpost={id:9,terrain:'plains',mine:true};");
  run(e, 'KWMap.controller.renderFrame(132);');            // content change → rebuild
  const rc2 = run(e, 'KWMap.controller.active._rebuildCount');
  check('4. unchanged content → no rebuild; content change → rebuild', rc1 === rc0 && rc2 === rc1 + 1,
    `rebuilds ${rc0}→${rc1}→${rc2}`);
}

// ── 5. Prior suites still green (P1 golden + P2) ───────────────────────────
{
  let ok = true, out = '';
  try { out = execFileSync('node', [path.join(__dirname, 'phase2_proofs.js')], { encoding: 'utf8' }); }
  catch (e) { ok = false; out = (e.stdout || '') + (e.stderr || ''); }
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  check('5. phase2_proofs.js (P1 golden + P2) still green', ok && m && m[2] === '0', m ? `${m[1]} passed, ${m[2]} failed` : 'no summary');
}

// ── 6. Grep gate (kwmap-*.js stay read-only consumers) ─────────────────────
{
  const files = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js'];
  const forbidden = [[/\bapiFetch\b/, 'apiFetch'], [/Math\.random/, 'Math.random'], [/\btickResources\b/, 'tickResources'], [/\bgameData\b/, 'gameData'], [/worldMapData\s*=[^=]/, 'worldMapData assign'], [/worldMapData\.\w+\s*=[^=]/, 'worldMapData.<f> write']];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  let clean = true, hits = [];
  for (const f of files) { const src = strip(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')); for (const [re, l] of forbidden) if (re.test(src)) { clean = false; hits.push(f + ':' + l); } }
  check('6. no apiFetch / Math.random / gameplay-state writes in kwmap-*.js', clean, hits.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
