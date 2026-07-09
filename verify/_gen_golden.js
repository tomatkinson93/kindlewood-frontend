'use strict';
// Generate the golden top-down oracle from the current renderer tree.
// Run whenever the top-down path legitimately changes (it should NOT during
// Phase 2). phase2_proofs.js asserts byte-identity against this file.
const { makeEnv, loadNew, setUi, vm, fs } = require('./_harness');

const e = makeEnv(); loadNew(e); setUi(e, null, null, null);
e.logs.map.length = 0; vm.runInContext('KWMap.controller.renderFrame(12345);', e.context);
const golden = { render: e.logs.map.slice() };

const pts = [];
for (let i = 0; i < 30; i++) pts.push([(i * 97) % 1400, (i * 53 + 7) % 800]);
pts.push([0, 0], [1399, 799], [700, 400], [1, 799]);
golden.hits = pts.map(([x, y]) => [x, y,
  JSON.parse(vm.runInContext(`JSON.stringify(KWMap.controller.screenToHex(${x},${y}))`, e.context))]);

const e2 = makeEnv(); loadNew(e2);
setUi(e2, { wq: 21, wr: 16 }, { wq: 23, wr: 14 }, { wx: 20, wy: 18 });
e2.logs.map.length = 0; e2.logs.uifx.length = 0;
vm.runInContext('KWMap.controller.renderFrame(12345);', e2.context);
golden.uifxUi = { hovered: { wq: 21, wr: 16 }, selected: { wq: 23, wr: 14 }, selectedFog: { wx: 20, wy: 18 } };
golden.uifxStrokes = e2.logs.uifx.slice();
golden.renderUiSet = e2.logs.map.slice();
golden.camera = { q: 20, r: 15 };
golden.fixtureNote = '40x40 phase1 fixture';
fs.writeFileSync('verify/phase1_topdown_golden.json', JSON.stringify(golden, null, 0));
console.log('golden written:', golden.render.length, 'render ops,', golden.hits.length, 'hit pts,', golden.uifxStrokes.length, 'uifx ops');
