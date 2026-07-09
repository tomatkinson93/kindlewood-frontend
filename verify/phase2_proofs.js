// Phase 2 verification harness (node, no deps) — spec §12 items 1,2,3,5,6 +
// buffer correctness (§12.6) + registry. Extends the Phase-1 harness patterns
// (verify/_harness.js). Run:  node verify/phase2_proofs.js
//
//   A. Top-down untouched — with kwmap-assets.js + kwmap-iso.js loaded and the
//      iso providers registered, the top-down render log (ui null AND ui set),
//      its uifx strokes, and its 34-point hit table are byte-identical to the
//      committed golden (verify/phase1_topdown_golden.json).
//   B. Iso round-trip — on a FLAT world (elevation 0 everywhere, isolating the
//      projection inverse), every on-screen tile: hexToScreen(centre) →
//      screenToHex returns the same (wq,wr), at 5 cameras incl. both wrap seams
//      and a corner.
//   C. Elevation rules — points CONSTRUCTED from the forward transform on a
//      crafted fixture: mountain face → mountain; recessed river face → river;
//      flat plains → itself; tile directly behind a peak (occluded by face+
//      skirt) → the peak; visible sliver two rows behind a peak → that tile.
//   D. Buffer correctness — pan < margin ⇒ pure blit (no rebuild); pan past
//      margin ⇒ exactly one rebuild; after the rebuild the blit fully covers
//      the viewport (no gap at the old margin edge).
//   E. Determinism — two independent rebuilds with identical inputs produce
//      identical GROUND-buffer ctx logs.
//   F. Registry — provider register / dup-reject / layer-sort still hold with
//      the iso built-ins present.
//   G. Grep gates — no apiFetch / Math.random / gameplay-state writes in any
//      kwmap-*.js.
'use strict';
const path = require('path');
const H = require('./_harness');
const { makeEnv, setUi, vm, fs } = H;

const ISO_FILES = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'main.js'];
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase1_topdown_golden.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Load the full iso tree into a fresh env and (optionally) activate iso.
function isoEnv(activate, cam, worldJs) {
  const e = makeEnv();
  H.loadTree(e, ISO_FILES);
  if (worldJs) vm.runInContext(worldJs, e.context);
  setUi(e, null, null, null, cam || { q: 20, r: 15 });
  if (activate) vm.runInContext("KWMap.controller.setRenderer('iso');", e.context);
  return e;
}
const J = (env, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', env.context));
const run = (env, stmt) => vm.runInContext(stmt, env.context);

// ── A. Top-down untouched (iso loaded + providers registered) ──────────────
{
  const e = makeEnv(); H.loadTree(e, ISO_FILES);
  setUi(e, null, null, null); e.logs.map.length = 0;
  run(e, 'KWMap.controller.renderFrame(12345);');
  check('A. top-down render(ui=null) identical to golden (iso loaded)',
    eq(e.logs.map, GOLDEN.render), `${e.logs.map.length} vs ${GOLDEN.render.length} ops`);
  if (!eq(e.logs.map, GOLDEN.render)) {
    for (let i = 0; i < Math.max(e.logs.map.length, GOLDEN.render.length); i++)
      if (!eq(e.logs.map[i], GOLDEN.render[i])) { console.log('    first divergence @', i, JSON.stringify(e.logs.map[i]), 'vs', JSON.stringify(GOLDEN.render[i])); break; }
  }

  const e2 = makeEnv(); H.loadTree(e2, ISO_FILES);
  const u = GOLDEN.uifxUi;
  setUi(e2, u.hovered, u.selected, u.selectedFog);
  e2.logs.map.length = 0; e2.logs.uifx.length = 0;
  run(e2, 'KWMap.controller.renderFrame(12345);');
  check('A. top-down render(ui set) identical to golden', eq(e2.logs.map, GOLDEN.renderUiSet),
    `${e2.logs.map.length} vs ${GOLDEN.renderUiSet.length}`);
  check('A. top-down uifx strokes identical to golden', eq(e2.logs.uifx, GOLDEN.uifxStrokes),
    `${e2.logs.uifx.length} vs ${GOLDEN.uifxStrokes.length}`);

  const e3 = makeEnv(); H.loadTree(e3, ISO_FILES); setUi(e3, null, null, null);
  let hitsOk = true, hm = '';
  for (const [x, y, want] of GOLDEN.hits) {
    const got = J(e3, `KWMap.controller.screenToHex(${x},${y})`);
    if (!eq(got, want)) { hitsOk = false; hm = `(${x},${y}) got ${JSON.stringify(got)} want ${JSON.stringify(want)}`; break; }
  }
  check('A. top-down hit-test table identical to golden (' + GOLDEN.hits.length + ' pts)', hitsOk, hm);
}

// ── B. Iso round-trip on a flat world ──────────────────────────────────────
{
  const FLAT = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});__SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:15}});})();`;
  const cams = [
    { q: 20, r: 15, label: 'centre' },
    { q: 0, r: 15, label: 'q-seam' },
    { q: 20, r: 0, label: 'r-seam' },
    { q: 0, r: 0, label: 'corner' },
    { q: 39, r: 39, label: 'far-corner' },
  ];
  const W = 1400, H2 = 800;
  let allOk = true, detail = '', tested = 0;
  for (const cam of cams) {
    const e = isoEnv(true, cam, FLAT);
    for (let q = 0; q < 40 && allOk; q++) for (let r = 0; r < 40; r++) {
      const c = J(e, `KWMap.controller.active.hexToScreen(${q},${r},camera,${W},${H2})`);
      if (!c) continue;                        // off-screen at this camera
      tested++;
      const back = J(e, `KWMap.controller.active.screenToHex(${c.x},${c.y},camera,${W},${H2})`);
      if (!back || back.wq !== q || back.wr !== r) {
        allOk = false; detail = `${cam.label}: tile (${q},${r}) centre (${c.x},${c.y}) → ${JSON.stringify(back)}`; break;
      }
    }
    if (!allOk) break;
  }
  check('B. iso round-trip hexToScreen→screenToHex over ' + tested + ' on-screen tiles × 5 cameras', allOk, detail);
}

// ── C. Elevation rules (points constructed from the forward transform) ──────
{
  // Crafted flat world with isolated features around camera (20,20).
  const M = { q: 20, r: 18 };          // mountain (elev 2.5)
  const RIV = { q: 24, r: 22 };        // river    (elev -0.6, recessed)
  const FLAT = { q: 16, r: 20 };       // isolated plains
  const BEHIND1 = { q: 20, r: 17 };    // directly behind M (occluded)
  const BEHIND2 = { q: 20, r: 16 };    // two rows behind M (visible sliver)
  const world = `(function(){const tiles=[];for(let q=0;q<40;q++)for(let r=0;r<40;r++)tiles.push({q,r,terrain:'plains',revealed:true});
    const set=(q,r,t)=>{const x=tiles.find(z=>z.q===q&&z.r===r); if(x)x.terrain=t;};
    set(${M.q},${M.r},'mountain'); set(${RIV.q},${RIV.r},'river');
    __SET_WORLD({tiles,mapW:40,mapH:40,playerSettlement:{q:20,r:20}});})();`;
  const e = isoEnv(true, { q: 20, r: 20 }, world);
  const W = 1400, H2 = 800;
  const ELEV = { mountain: 2.5, river: -0.6 };
  const ELEV_PX = 14;
  // face centre = ground-plane centre lifted by elevation*ELEV_PX
  const faceCentre = (t, terrain) => {
    const gc = J(e, `KWMap.controller.active.hexToScreen(${t.q},${t.r},camera,${W},${H2})`);
    if (!gc) return null;
    return { x: gc.x, y: Math.round(gc.y - (ELEV[terrain] || 0) * ELEV_PX), gc };
  };
  const hit = (x, y) => J(e, `KWMap.controller.active.screenToHex(${x},${y},camera,${W},${H2})`);
  const is = (h, t) => h && h.wq === t.q && h.wr === t.r;

  const mfc = faceCentre(M, 'mountain');
  check('C(a). mountain face centre → mountain tile', mfc && is(hit(mfc.x, mfc.y), M),
    mfc ? JSON.stringify(hit(mfc.x, mfc.y)) : 'off-screen');

  const rfc = faceCentre(RIV, 'river');
  check('C(c). recessed river face centre → river tile', rfc && is(hit(rfc.x, rfc.y), RIV),
    rfc ? JSON.stringify(hit(rfc.x, rfc.y)) : 'off-screen');

  const ffc = faceCentre(FLAT, 'plains');
  check('C(d). flat plains face centre → itself', ffc && is(hit(ffc.x, ffc.y), FLAT),
    ffc ? JSON.stringify(hit(ffc.x, ffc.y)) : 'off-screen');

  // (b1) tile directly behind the peak, clicked at ITS ground-plane centre, is
  // occluded by the mountain's face+skirt → returns the mountain.
  const b1 = J(e, `KWMap.controller.active.hexToScreen(${BEHIND1.q},${BEHIND1.r},camera,${W},${H2})`);
  check('C(b1). directly-behind tile’s centre → occluding peak', b1 && is(hit(b1.x, b1.y), M),
    b1 ? JSON.stringify(hit(b1.x, b1.y)) : 'off-screen');

  // (b2) two rows behind: its UPPER sliver peeks above the peak → returns it.
  const b2 = J(e, `KWMap.controller.active.hexToScreen(${BEHIND2.q},${BEHIND2.r},camera,${W},${H2})`);
  // scan upward within the face for the visible sliver (top vertex region)
  let sliverOk = false, sy = 0;
  if (b2) for (let off = 4; off <= 15; off++) { const h = hit(b2.x, b2.y - off); if (h && h.wq === BEHIND2.q && h.wr === BEHIND2.r) { sliverOk = true; sy = off; break; } }
  check('C(b2). visible sliver two rows behind peak → that tile', sliverOk, b2 ? `at -${sy}px` : 'off-screen');
}

// ── D. Buffer correctness ──────────────────────────────────────────────────
{
  const e = isoEnv(true, { q: 20, r: 15 });
  const rc = () => run(e, 'KWMap.controller.active._rebuildCount');
  const frame = (q, r, ts) => { setUi(e, null, null, null, { q, r }); run(e, `KWMap.controller.renderFrame(${ts});`); };

  frame(20, 15, 100);
  const c0 = rc();
  frame(23, 15, 116);                 // ΔcamWX = 3*48 = 144 < MARGIN(160)
  const c1 = rc();
  check('D. pan within margin (144px) → pure blit, no rebuild', c1 === c0, `rebuilds ${c0}→${c1}`);

  frame(24, 15, 132);                 // ΔcamWX from origin = 192 > 160
  const c2 = rc();
  check('D. pan past margin (192px) → exactly one rebuild', c2 === c1 + 1, `rebuilds ${c1}→${c2}`);

  frame(25, 15, 148);                 // still within new margin
  const c3 = rc();
  check('D. subsequent within-margin pan → no extra rebuild', c3 === c2, `rebuilds ${c2}→${c3}`);

  // No gap: the freshly-rebuilt buffer must fully cover the viewport.
  const cov = J(e, `(function(){var g=KWMap.controller.active._ground;var geo={cx:700,cy:400};
    var K=KWMap.ISO.K, hexW=48, hexVert=41; var camWX=hexW*(camera.q+camera.r/2), camWY=hexVert*K*camera.r;
    var bx=Math.round(700+g.bufWX-camWX), by=Math.round(400+g.bufWY-camWY);
    return {bx:bx,by:by,bw:g.bwCss,bh:g.bhCss,coversX:(bx<=0 && bx+g.bwCss>=1400),coversY:(by<=0 && by+g.bhCss>=800)};})()`);
  check('D. rebuilt buffer fully covers viewport (no pop-in gap)', cov.coversX && cov.coversY,
    `blit (${cov.bx},${cov.by}) buf ${cov.bw}x${cov.bh}`);
}

// ── E. Determinism ─────────────────────────────────────────────────────────
{
  const render = () => {
    const e = isoEnv(true, { q: 20, r: 15 });
    run(e, 'KWMap.controller.renderFrame(500);');
    return run(e, 'KWMap.controller.active._ground.canvas._log');
  };
  const a = render(), b = render();
  check('E. two independent GROUND rebuilds produce identical ctx logs', eq(a, b),
    `${a.length} vs ${b.length} ops`);
}

// ── F. Registry (with iso built-ins present) ───────────────────────────────
{
  const e = makeEnv(); H.loadTree(e, ISO_FILES);
  const r = J(e, `(function(){
    const before = KWMap.controller.listProviders().length;
    const a = KWMap.controller.register({ id:'roads-test', layer:KWMap.L.ROAD, collect:()=>[] });
    const dup = KWMap.controller.register({ id:'roads-test', layer:KWMap.L.ROAD });
    const dupTerrain = KWMap.controller.register({ id:'terrain', layer:KWMap.L.TERRAIN });
    const list = KWMap.controller.listProviders();
    const sorted = list.every((p,i)=> i===0 || list[i-1].layer <= p.layer);
    return { before, a, dup, dupTerrain, hasTerrain: list.some(p=>p.id==='terrain'), hasClaims: list.some(p=>p.id==='claims'), sorted };
  })()`);
  check('F. iso registers terrain + claims providers', r.hasTerrain && r.hasClaims, `${r.before} providers pre-test`);
  check('F. new provider on L.ROAD accepted', r.a === true);
  check('F. duplicate id rejected', r.dup === false && r.dupTerrain === false);
  check('F. provider list stays layer-sorted', r.sorted === true);
}

// ── G. Grep gates (kwmap-*.js are read-only consumers) ─────────────────────
{
  const files = ['kwmap-core.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js'];
  const forbidden = [
    [/\bapiFetch\b/, 'apiFetch'],
    [/Math\.random/, 'Math.random'],
    [/\btickResources\b/, 'tickResources'],
    [/\bgameData\b/, 'gameData'],
    [/worldMapData\s*=[^=]/, 'worldMapData assignment'],
    [/worldMapData\.\w+\s*=[^=]/, 'worldMapData.<field> write'],
  ];
  // Strip block + line comments so header prose ("no apiFetch, no Math.random")
  // isn't mistaken for actual usage — the gate targets code, not documentation.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  let clean = true, hits = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
    for (const [re, label] of forbidden) if (re.test(src)) { clean = false; hits.push(`${f}: ${label}`); }
  }
  check('G. no apiFetch / Math.random / gameplay-state writes in kwmap-*.js', clean, hits.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
