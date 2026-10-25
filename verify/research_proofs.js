'use strict';
// The Library's tech tree (js/research.js, js/research-defs.js).
//   node verify/research_proofs.js
//   1. Times, and what each project unlocks in words.
//   2. Layout: every project at its era and path; paths stack; phones tighter.
//   3. The screen: nodes by status, one connector per prerequisite, header.
//   4. Detail panel: unlocks, prerequisites, the right button; admins only.
//   5. No Library: the tree still shows, Study disabled; focus; realtime.
//   6. Wiring: tags, realtime, settlement view, Stores link, twin file.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

function makeEnv(admin, width) {
  const els = {}, toasts = [];
  const mk = id => ({
    id, innerHTML: '', textContent: '', hidden: false, scrollLeft: 0, scrollTop: 0, clientWidth: 900, clientHeight: 600, scrollHeight: 600,
    style: { setProperty() {} }, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); } },
    addEventListener() {}, setAttribute() {},
  });
  const ids = ['rs-sub', 'rs-now', 'rs-sch', 'rs-banner', 'rs-adminbar', 'rs-eras-in', 'rs-lanes-in', 'rs-viewport', 'rs-detail', 'rs-title'];
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => new Proxy(mk(null), { set(t, k, v) { t[k] = v; if (k === 'id') els[v] = t; if (k === 'innerHTML' && /rs-viewport/.test(v)) ids.forEach(i => { els[i] = els[i] || mk(i); }); return true; } }),
    body: { appendChild(c) { return c; }, classList: { add() {}, remove() {} } }, addEventListener() {},
  };
  const w = { document: doc, console, Math, JSON, Number, String, Object, Array, Set, Promise, isFinite, setTimeout,
    innerWidth: width || 1400, addEventListener() {}, showBuildToast: m => toasts.push(m), _kwIsAdmin: () => admin };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(read('js/research-defs.js'), w);
  vm.runInContext(read('js/research.js'), w);
  return { w, els, toasts };
}

// A view like GET /api/research builds it, from the defs.
function stateWith(over, done, active) {
  const x = {}; x.window = x; vm.createContext(x); vm.runInContext(read('js/research-defs.js'), x);
  const R = x.KWResearch, d = new Set(done || []);
  const projects = R.KEYS.map(k => {
    const p = R.PROJECTS[k];
    const status = d.has(k) ? 'done' : active === k ? 'active' : R.blockedBy(k, d) ? 'locked' : 'open';
    return { key: k, label: p.label, icon: p.icon, field: p.field, branch: p.branch, tier: p.tier, slot: p.slot || 0, cost: p.cost, desc: p.desc,
      requires: p.requires, progress: active === k ? Math.round(p.cost / 2) : d.has(k) ? p.cost : 0, status, blocked: status === 'locked' ? R.blockedBy(k, d) : null };
  });
  return Object.assign({ library_level: 2, seats: 2, scholars: [{ id: 1, name: 'Quill', perHour: 2.2 }], per_hour: 2.2, bank: 0, bank_cap: 100,
    active: active || null, eta_hours: active ? 27.3 : null, projects, effects: {}, branches: R.BRANCHES, eras: R.ERAS }, over || {});
}

console.log('1. Times and unlocks');
{
  const { w } = makeEnv(false);
  const L = w.KWLibrary;
  check('1a. hours read naturally', L.fmtHours(0.25) === '15m' && L.fmtHours(3.5) === '3h 30m' && L.fmtHours(50) === '2d 2h' && L.fmtHours(null) === '—');
  check('1b. unlocks: resources, buildings, recipes', /Gold Ore/.test(L.unlocksText('deep_veins')) && /Smelter/.test(L.unlocksText('smelting')) && /Falchion/.test(L.unlocksText('master_recipes')));
  check('1c. unlocks: effects in words', /\+15% Smelter speed/.test(L.unlocksText('furnaces')) && /\+10% research speed/.test(L.unlocksText('scriptorium'))
    && /−3% building and upgrade costs/.test(L.unlocksText('masonry')) && /\+3 craft quality/.test(L.unlocksText('guild_marks')));
}

console.log('2. Layout');
{
  const { w } = makeEnv(false);
  const st = stateWith();
  const L = w.KWLibrary.layout(st.projects, false);
  const pos = Object.values(L.pos);
  check('2a. every project has a place', pos.length === st.projects.length);
  check('2b. no two overlap', pos.every((a, i) => pos.every((b, j) => i === j || Math.abs(a.x - b.x) >= L.g.nodeW || Math.abs(a.y - b.y) >= L.g.nodeH)));
  check('2c. columns are eras: same era, same x', st.projects.every(p => L.pos[p.key].x === L.g.padX + (p.tier - 1) * L.g.colW));
  check('2d. rows are paths, in order; Mining has two rows (era IV)', L.lanes.map(l => l.key).join() === 'mining,metallurgy,crafts,building,trade,scholarship'
    && L.pos.volcanic_lore.y > L.pos.prospecting_3.y && L.pos.volcanic_lore.y < L.pos.smelting.y);
  check('2e. arrows run left to right', st.projects.every(p => p.requires.every(r => L.pos[r].x < L.pos[p.key].x)));
  check('2f. wide: five eras across', L.width >= 4 * L.g.colW && L.eras.length === 5);
  const N = w.KWLibrary.layout(st.projects, true);
  check('2g. phones: a tighter grid', N.g.nodeW < L.g.nodeW && N.width < L.width && N.g.labelW < L.g.labelW);
  check('2h. connector curves from right edge to left edge', /^M\d+,\d+(\.\d+)? C/.test(w.KWLibrary.linkPath({ x: 0, y: 0 }, { x: 300, y: 100 }, L.g)));
}

console.log('3. The screen');
{
  const { w, els } = makeEnv(false);
  w.KWLibrary.open();
  const st = stateWith({}, ['prospecting', 'smelting', 'masonry'], 'prospecting_2');
  w.KWLibrary._setState(st); w.KWLibrary._render({ focus: true });
  const tree = els['rs-viewport'].innerHTML;
  check('3a. one node per project', (tree.match(/class="rs-node /g) || []).length === 23);
  check('3b. statuses: studied, studying, open, locked', /rs-node rs-done[^"]*" data-rs="pick" data-key="prospecting"/.test(tree) && /rs-node rs-active[^"]*" data-rs="pick" data-key="prospecting_2"/.test(tree)
    && /rs-node rs-open[^"]*" data-rs="pick" data-key="furnaces"/.test(tree) && /rs-node rs-locked[^"]*" data-rs="pick" data-key="starmetal"/.test(tree));
  const reqs = st.projects.reduce((a, p) => a + p.requires.length, 0);
  check('3c. one connector per prerequisite', (tree.match(/class="rs-link /g) || []).length === reqs);
  check('3d. connectors: gold from what is done, dashed when locked', /rs-link rs-l-done" d="[^"]+" data-from="prospecting" data-to="prospecting_2"/.test(tree)
    && /rs-link rs-l-locked" d="[^"]+" data-from="volcanic_lore" data-to="starmetal"/.test(tree));
  check('3e. nodes are buttons with a spoken label', /<button type="button" class="rs-node[^>]*aria-label="Prospecting II: being studied, 260 points"/.test(tree));
  check('3f. the active node shows its progress', /data-key="prospecting_2"[\s\S]*?rs-n-bar"><i style="width:50%/.test(tree));
  check('3g. header: studying, time left, Scholars', /Studying/.test(els['rs-now'].innerHTML) && /27h 18m to go/.test(els['rs-now'].innerHTML) && /Quill <b>2\.2\/hr/.test(els['rs-sch'].innerHTML)
    && /Level 2 · 1 \/ 2 Scholars · 2\.2 points\/hr/.test(els['rs-sub'].textContent));
  check('3h. era labels and path labels', (els['rs-eras-in'].innerHTML.match(/class="rs-era"/g) || []).length === 5 && /Foundations/.test(els['rs-eras-in'].innerHTML)
    && (els['rs-lanes-in'].innerHTML.match(/class="rs-lane"/g) || []).length === 6 && /Metallurgy/.test(els['rs-lanes-in'].innerHTML));
  const far = stateWith({}, [], 'starmetal');
  w.KWLibrary._setState(far); w.KWLibrary._render({ focus: true });
  check('3i. opening scrolls to what is being studied', w.KWLibrary.focusKey(st) === 'prospecting_2' && w.KWLibrary.focusKey(far) === 'starmetal' && els['rs-viewport'].scrollLeft > 600);
  check('3j. nothing studied: focus the first open project', w.KWLibrary.focusKey(stateWith()) && stateWith().projects.find(p => p.key === w.KWLibrary.focusKey(stateWith())).tier === 1);
}

console.log('4. Detail panel');
{
  const { w, els } = makeEnv(false);
  w.KWLibrary.open();
  w.KWLibrary._setState(stateWith({}, ['prospecting', 'smelting']));
  w.KWLibrary._select('furnaces'); w.KWLibrary._render();
  let d = els['rs-detail'].innerHTML;
  check('4a. a chosen project opens its details', !els['rs-detail'].hidden && /Hotter Furnaces I/.test(d) && /Metallurgy/.test(d) && /Era II — Workings/.test(d));
  check('4b. unlocks, prerequisites ticked, cost', /\+15% Smelter speed/.test(d) && /rs-ok">✓ 🔥 Smelting/.test(d) && /260 research points/.test(d));
  check('4c. open: Study this next', /data-rs="start" data-key="furnaces"/.test(d) && /Study this next/.test(d) && !/Finish now/.test(d));
  w.KWLibrary._select('starmetal'); w.KWLibrary._render();
  d = els['rs-detail'].innerHTML;
  check('4d. locked: why, and what is missing', /🔒 Study Volcanic Lore and Steelworking first\./.test(d) && /rs-miss">✗ 🌋 Volcanic Lore/.test(d) && !/data-rs="start"/.test(d));
  w.KWLibrary._select(null); w.KWLibrary._render();
  check('4e. no choice: no panel', els['rs-detail'].hidden === true);
  const A = makeEnv(true);
  A.w.KWLibrary.open(); A.w.KWLibrary._setState(stateWith()); A.w.KWLibrary._select('starmetal'); A.w.KWLibrary._render();
  check('4f. admins: Finish now and Reset', /⚡ Finish now/.test(A.els['rs-detail'].innerHTML) && /Reset/.test(A.els['rs-adminbar'].innerHTML) && els['rs-adminbar'].innerHTML === '');
}

console.log('5. No Library; realtime');
{
  const { w, els } = makeEnv(false, 390);
  w.KWLibrary.open();
  w.KWLibrary._setState(stateWith({ library_level: 0, seats: 0, scholars: [], per_hour: 0 }));
  w.KWLibrary._select('prospecting'); w.KWLibrary._render();
  check('5a. no Library: a banner, and the tree still shows to plan with', /Build a <b>Library<\/b>/.test(els['rs-banner'].innerHTML) && (els['rs-viewport'].innerHTML.match(/class="rs-node /g) || []).length === 23);
  check('5b. …but Study is disabled', /data-rs="start" data-key="prospecting" disabled/.test(els['rs-detail'].innerHTML));
  const { w: w2, toasts } = makeEnv(false);
  w2.KWLibrary.onEvent({ type: 'research_done', label: 'Deep Veins', icon: '🕳️', desc: 'Gold and gems.' });
  check('5c. a finished project toasts', /Research finished: Deep Veins!/.test(toasts[0] || ''));
}

console.log('6. Wiring');
{
  const html = read('index.html');
  check('6a. research-defs and research.js load; css linked', /\/js\/research-defs\.js/.test(html) && /\/js\/research\.js/.test(html) && /css\/research\.css/.test(html)
    && html.indexOf('/js/research-defs.js') < html.indexOf('/js/research.js'));
  check('6b. its own screen: fixed and full-window, a bottom sheet on phones', /\.rs-screen \{[\s\S]*?position: fixed; inset: 0/.test(read('css/research.css')) && /max-width: 700px[\s\S]*\.rs-detail \{ left: 0; right: 0; bottom: 0/.test(read('css/research.css')));
  check('6c. drag to pan, wheel to scroll sideways, Esc closes', /pointerdown/.test(read('js/research.js')) && /addEventListener\('wheel'/.test(read('js/research.js')) && /e\.key !== 'Escape'/.test(read('js/research.js')));
  check('6d. realtime routes research_done', /research_done\(ev\) \{ if \(global\.KWLibrary\) global\.KWLibrary\.onEvent\(ev\)/.test(read('js/realtime.js')));
  check('6e. the Library building and the Stores open it', /occupant\.id === 'library'/.test(read('js/settlement-view.js')) && /openLibrary\(\)/.test(read('js/stores.js')));
  const twin = path.join(ROOT, '..', 'kindlewood-server', 'lib', 'research_defs.js');
  check('6f. research-defs twin of the server file', !fs.existsSync(twin) || read('js/research-defs.js') === fs.readFileSync(twin, 'utf8'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
