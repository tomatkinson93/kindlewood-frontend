'use strict';
// The Library's tech tree (js/research.js). The browser never gets the full
// tree — only GET /api/research — so the fake views here are built from the
// server's lib/research_defs.js (the sibling checkout, or KW_SERVER_DIR).
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
const SERVER_DEFS = path.join(process.env.KW_SERVER_DIR || path.join(ROOT, '..', 'kindlewood-server'), 'lib', 'research_defs.js');
if (!fs.existsSync(SERVER_DEFS)) { console.error('research_proofs needs the server checkout next to this one (or KW_SERVER_DIR): ' + SERVER_DEFS); process.exit(1); }
const defsSrc = fs.readFileSync(SERVER_DEFS, 'utf8');
const loadDefs = () => { const x = {}; x.window = x; vm.createContext(x); vm.runInContext(defsSrc, x); return x.KWResearch; };
const ALL = loadDefs().KEYS;
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
  const ids = ['rs-sub', 'rs-now', 'rs-sch', 'rs-queue', 'rs-banner', 'rs-adminbar', 'rs-eras-in', 'rs-lanes-in', 'rs-viewport', 'rs-detail', 'rs-title'];
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => new Proxy(mk(null), { set(t, k, v) { t[k] = v; if (k === 'id') els[v] = t; if (k === 'innerHTML' && /rs-viewport/.test(v)) ids.forEach(i => { els[i] = els[i] || mk(i); }); return true; } }),
    body: { appendChild(c) { return c; }, classList: { add() {}, remove() {} } }, addEventListener() {},
  };
  const w = { document: doc, console, Math, JSON, Number, String, Object, Array, Set, Promise, isFinite, setTimeout,
    innerWidth: width || 1400, addEventListener() {}, showBuildToast: m => toasts.push(m), _kwIsAdmin: () => admin };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(read('js/research.js'), w);
  return { w, els, toasts };
}

// A view like GET /api/research builds it, from the defs: distant projects
// redacted to ?? (opaque id, no name/cost), queue positions, queue_adds.
function stateWith(over, done, active, queue) {
  const R = loadDefs(), d = new Set(done || []), q = queue || [];
  const dist = R.distances(d), hide = k => dist[k] > R.HIDE_BEYOND;
  const idOf = {}; R.KEYS.forEach((k, i) => { idOf[k] = hide(k) ? 'unknown_' + i : k; });
  const planned = new Set([active, ...q].filter(Boolean));
  const projects = R.KEYS.map(k => {
    const p = R.PROJECTS[k];
    const base = { key: idOf[k], branch: p.branch, tier: p.tier, slot: p.slot || 0, requires: p.requires.map(r => idOf[r]) };
    if (hide(k)) return Object.assign(base, { hidden: true, status: 'hidden', label: '??', icon: '❔' });
    const status = d.has(k) ? 'done' : active === k ? 'active' : R.blockedBy(k, d) ? 'locked' : 'open';
    return Object.assign(base, { label: p.label, icon: p.icon, field: p.field, cost: p.cost, desc: p.desc,
      unlocks: { resources: p.resources || [], buildings: p.buildings || [], recipes: p.recipes || [], effects: p.effects || {} },
      progress: active === k ? Math.round(p.cost / 2) : d.has(k) ? p.cost : 0, status, blocked: status === 'locked' ? R.blockedBy(k, d) : null,
      queued: q.indexOf(k) >= 0 ? q.indexOf(k) + 1 : null, queue_adds: R.pathTo(k, d).filter(z => z !== k && !planned.has(z)).length });
  });
  return Object.assign({ library_level: 2, seats: 2, scholars: [{ id: 1, name: 'Quill', perHour: 2.2 }], per_hour: 2.2, bank: 0, bank_cap: 100,
    active: active || null, queue: q, queue_max: 10, eta_hours: active ? 27.3 : null, projects, effects: {}, branches: R.BRANCHES, eras: R.ERAS }, over || {});
}

console.log('1. Times and unlocks');
{
  const { w } = makeEnv(false);
  const L = w.KWLibrary;
  const known = stateWith({}, ALL.slice());   // everything visible, for its unlocks
  const P = k => known.projects.find(p => p.key === k);
  check('1a. hours read naturally', L.fmtHours(0.25) === '15m' && L.fmtHours(3.5) === '3h 30m' && L.fmtHours(50) === '2d 2h' && L.fmtHours(null) === '—');
  check('1b. unlocks: resources, buildings, recipes', /Gold Ore/.test(L.unlocksText(P('deep_veins'))) && /Smelter/.test(L.unlocksText(P('smelting'))) && /Falchion/.test(L.unlocksText(P('master_recipes'))));
  check('1c. unlocks: effects in words', /\+15% Smelter speed/.test(L.unlocksText(P('furnaces'))) && /\+8% research speed/.test(L.unlocksText(P('scriptorium')))
    && /−3% building and upgrade costs/.test(L.unlocksText(P('masonry'))) && /\+2 craft quality/.test(L.unlocksText(P('guild_marks')))
    && /\+25% Copper/.test(L.unlocksText(P('shoring'))) && /\+15% Smithy speed/.test(L.unlocksText(P('smithing_lore'))) && /100 more research points bank/.test(L.unlocksText(P('quills'))));
}


console.log('2. Layout');
{
  const { w } = makeEnv(false);
  const st = stateWith({}, ALL);   // everything known: real keys everywhere
  const L = w.KWLibrary.layout(st.projects, false, st);
  const pos = Object.values(L.pos);
  check('2a. every project has a place', pos.length === st.projects.length && pos.length === 48);
  check('2b. no two overlap', pos.every((a, i) => pos.every((b, j) => i === j || Math.abs(a.x - b.x) >= L.g.nodeW || Math.abs(a.y - b.y) >= L.g.nodeH)));
  check('2c. columns are eras: same era, same x', st.projects.every(p => L.pos[p.key].x === L.g.padX + (p.tier - 1) * L.g.colW));
  check('2d. rows are paths, in order; Mining has two rows', L.lanes.map(l => l.key).join() === 'mining,metallurgy,crafts,building,trade,scholarship'
    && L.pos.mine_pumps.y > L.pos.volcanic_lore.y && L.pos.mine_pumps.y < L.pos.smelting.y);
  check('2e. arrows run left to right', st.projects.every(p => p.requires.every(r => L.pos[r].x < L.pos[p.key].x)));
  check('2f. very wide: eight eras across', L.eras.length === 8 && L.width >= 7 * L.g.colW);
  const N = w.KWLibrary.layout(st.projects, true, st);
  check('2g. phones: a tighter grid', N.g.nodeW < L.g.nodeW && N.width < L.width && N.g.labelW < L.g.labelW);
  check('2h. connector curves from right edge to left edge', /^M\d+,\d+(\.\d+)? C/.test(w.KWLibrary.linkPath({ x: 0, y: 0 }, { x: 300, y: 100 }, L.g)));
}

console.log('3. The screen');
{
  const { w, els } = makeEnv(false);
  w.KWLibrary.open();
  const st = stateWith({}, ['prospecting', 'smelting', 'masonry'], 'prospecting_2', ['shoring', 'furnaces']);
  w.KWLibrary._setState(st); w.KWLibrary._render({ focus: true });
  const tree = els['rs-viewport'].innerHTML;
  check('3a. one node per project, the distant ones too', (tree.match(/class="rs-node /g) || []).length === 48);
  check('3b. statuses: studied, studying, open, locked', /rs-node rs-done[^"]*" data-rs="pick" data-key="prospecting"/.test(tree) && /rs-node rs-active[^"]*" data-rs="pick" data-key="prospecting_2"/.test(tree)
    && /rs-node rs-open[^"]*" data-rs="pick" data-key="surveying"/.test(tree) && /rs-node rs-locked[^"]*" data-rs="pick" data-key="assaying"/.test(tree));
  const hidden = (tree.match(/rs-node rs-hidden/g) || []).length;
  check('3c. distant technology shows as ??, greyed, nameless', hidden > 20 && /<span class="rs-n-name">\?\?<\/span>/.test(tree) && !/Starmetal|Moon Lore|Meteor/.test(tree) && /aria-label="Unknown technology"/.test(tree));
  const reqs = st.projects.reduce((a, p) => a + p.requires.length, 0);
  check('3d. one connector per prerequisite; dotted into the unknown', (tree.match(/class="rs-link /g) || []).length === reqs && /rs-link rs-l-done" d="[^"]+" data-from="prospecting" data-to="prospecting_2"/.test(tree)
    && /rs-link rs-l-hidden/.test(tree));
  check('3e. nodes are buttons with a spoken label', /<button type="button" class="rs-node[^>]*aria-label="Prospecting II: being studied, 300 points"/.test(tree));
  check('3f. the active node shows its progress', /data-key="prospecting_2"[\s\S]*?rs-n-bar"><i style="width:50%/.test(tree));
  check('3g. queued nodes wear their number', /data-key="shoring"[\s\S]*?class="rs-n-q"[^>]*>#1</.test(tree) && /data-key="furnaces"[\s\S]*?class="rs-n-q"[^>]*>#2</.test(tree));
  const qh = els['rs-queue'].innerHTML;
  check('3h. the queue in the header: numbered chips with ✕', !els['rs-queue'].hidden && /1\. 🪵 Shoring/.test(qh) && /2\. 🌡️ Hotter Furnaces I/.test(qh) && (qh.match(/data-rs="dequeue"/g) || []).length === 2);
  check('3i. header: studying, time left, Scholars', /Studying/.test(els['rs-now'].innerHTML) && /27h 18m to go/.test(els['rs-now'].innerHTML) && /Quill <b>2\.2\/hr/.test(els['rs-sch'].innerHTML));
  check('3j. eight eras, six paths', (els['rs-eras-in'].innerHTML.match(/class="rs-era"/g) || []).length === 8 && /Legends/.test(els['rs-eras-in'].innerHTML)
    && (els['rs-lanes-in'].innerHTML.match(/class="rs-lane"/g) || []).length === 6);
  const far = stateWith({}, ALL.filter(k => k !== 'starmetal'), 'starmetal');
  w.KWLibrary._setState(far); w.KWLibrary._render({ focus: true });
  check('3k. opening scrolls to what is being studied', w.KWLibrary.focusKey(st) === 'prospecting_2' && els['rs-viewport'].scrollLeft > 1000);
  const empty = stateWith({}, [], null, []);
  w.KWLibrary._setState(empty); w.KWLibrary._render();
  check('3l. nothing studied: era I open, era II locked, the rest ??', empty.projects.find(p => p.key === w.KWLibrary.focusKey(empty)).tier === 1
    && empty.projects.filter(p => !p.hidden).every(p => p.tier <= 2) && els['rs-queue'].hidden === true);
}

console.log('4. Detail panel');
{
  const { w, els } = makeEnv(false);
  w.KWLibrary.open();
  w.KWLibrary._setState(stateWith({}, ['prospecting', 'smelting'], null, ['shoring']));
  w.KWLibrary._select('furnaces'); w.KWLibrary._render();
  let d = els['rs-detail'].innerHTML;
  check('4a. a chosen project opens its details', !els['rs-detail'].hidden && /Hotter Furnaces I/.test(d) && /Metallurgy/.test(d) && /Era II — Workings/.test(d));
  check('4b. unlocks, prerequisites ticked, cost', /\+15% Smelter speed/.test(d) && /rs-ok">✓ 🔥 Smelting/.test(d) && /300 research points/.test(d));
  check('4c. open: Study now and Add to queue', /data-rs="start" data-key="furnaces"/.test(d) && /Study now/.test(d) && /data-rs="queue" data-key="furnaces"/.test(d) && !/Finish now/.test(d));
  w.KWLibrary._select('assaying'); w.KWLibrary._render();
  d = els['rs-detail'].innerHTML;
  check('4d. locked: why, what is missing, and queueing adds it first', /🔒 Study Shoring first\./.test(d) && /rs-miss">✗ 🪵 Shoring/.test(d) && !/data-rs="start"/.test(d) && /Add to queue<\/button>/.test(d));
  w.KWLibrary._select('bellows'); w.KWLibrary._render();
  check('4e. "adds 1 first" when a prerequisite isn\'t planned yet', /Add to queue \(adds 1 first\)/.test(els['rs-detail'].innerHTML));
  w.KWLibrary._select('shoring'); w.KWLibrary._render();
  d = els['rs-detail'].innerHTML;
  check('4f. queued: Remove from queue', /data-rs="dequeue" data-key="shoring">Remove from queue/.test(d) && /Queued #1/.test(d));
  const hid = w.KWLibrary._state().projects.find(p => p.hidden);
  w.KWLibrary._select(hid.key); w.KWLibrary._render();
  d = els['rs-detail'].innerHTML;
  check('4g. ??: a distant technology, no buttons, nothing given away', /<h3>\?\?<\/h3>/.test(d) && /research more of what leads here/.test(d) && !/data-rs="(start|queue)"/.test(d));
  w.KWLibrary._setState(stateWith({}, ['prospecting'], 'prospecting_2'));
  w.KWLibrary._select('prospecting_2'); w.KWLibrary._render();
  check('4h. the active project can be stopped', /data-rs="dequeue" data-key="prospecting_2">Stop/.test(els['rs-detail'].innerHTML));
  // Reorder: Masonry → Surveying (needs Masonry) → Shoring.
  const mq = stateWith({}, ['prospecting'], null, ['masonry', 'surveying', 'shoring']);
  const M = (i, dir) => w.KWLibrary.canMove(mq, i, dir);
  check('4k. reorder: never past what a project needs, or what needs it', !M(0, -1) && !M(0, 1) && !M(1, -1) && M(1, 1) && M(2, -1) && !M(2, 1));
  w.KWLibrary._setState(mq); w.KWLibrary._select('surveying'); w.KWLibrary._render();
  const qh2 = els['rs-queue'].innerHTML;
  check('4l. queue chips get ◀ ▶ only where a move is allowed', (qh2.match(/data-rs="move"/g) || []).length === 2
    && /data-rs="move" data-key="surveying" data-to="2"[^>]*>▶/.test(qh2) && /data-rs="move" data-key="shoring" data-to="1"[^>]*>◀/.test(qh2));
  d = els['rs-detail'].innerHTML;
  check('4m. the detail panel: Move down (no Move up past Masonry)', /data-rs="move" data-key="surveying" data-to="2">▼ Move down/.test(d) && !/Move up/.test(d));
  check('4n. a move posts { project, to }', /call\('POST', '\/api\/research\/queue\/move', \{ project: key, to: Number\(b\.dataset\.to\) \}\)/.test(fs.readFileSync(path.join(ROOT, 'js', 'research.js'), 'utf8')));
  w.KWLibrary._select(null); w.KWLibrary._render();
  check('4i. no choice: no panel', els['rs-detail'].hidden === true);
  const A = makeEnv(true);
  A.w.KWLibrary.open(); A.w.KWLibrary._setState(stateWith()); A.w.KWLibrary._select('shoring'); A.w.KWLibrary._render();
  check('4j. admins: Finish now and Reset', /⚡ Finish now/.test(A.els['rs-detail'].innerHTML) && /Reset/.test(A.els['rs-adminbar'].innerHTML) && els['rs-adminbar'].innerHTML === '');
}

console.log('5. No Library; realtime');
{
  const { w, els } = makeEnv(false, 390);
  w.KWLibrary.open();
  w.KWLibrary._setState(stateWith({ library_level: 0, seats: 0, scholars: [], per_hour: 0 }));
  w.KWLibrary._select('prospecting'); w.KWLibrary._render();
  check('5a. no Library: a banner, and the tree still shows to plan with', /Build a <b>Library<\/b>/.test(els['rs-banner'].innerHTML) && (els['rs-viewport'].innerHTML.match(/class="rs-node /g) || []).length === 48);
  check('5b. …but Study and Queue are disabled', /data-rs="start" data-key="prospecting" disabled/.test(els['rs-detail'].innerHTML) && /data-rs="queue" data-key="prospecting" disabled/.test(els['rs-detail'].innerHTML));
  const { w: w2, toasts } = makeEnv(false);
  w2.KWLibrary.onEvent({ type: 'research_done', label: 'Deep Veins', icon: '🕳️', desc: 'Gold and gems.' });
  check('5c. a finished project toasts', /Research finished: Deep Veins!/.test(toasts[0] || ''));
}

console.log('6. Wiring');
{
  const html = read('index.html');
  check('6a. research.js loads, css linked — and no copy of the tree is shipped', /\/js\/research\.js/.test(html) && /css\/research\.css/.test(html)
    && !/research-defs/.test(html) && !fs.existsSync(path.join(ROOT, 'js', 'research-defs.js')));
  check('6b. its own screen: fixed and full-window, a bottom sheet on phones', /\.rs-screen \{[\s\S]*?position: fixed; inset: 0/.test(read('css/research.css')) && /max-width: 700px[\s\S]*\.rs-detail \{ left: 0; right: 0; bottom: 0/.test(read('css/research.css')));
  check('6c. drag to pan, wheel to scroll sideways, Esc closes', /pointerdown/.test(read('js/research.js')) && /addEventListener\('wheel'/.test(read('js/research.js')) && /e\.key !== 'Escape'/.test(read('js/research.js')));
  check('6d. realtime routes research_done', /research_done\(ev\) \{ if \(global\.KWLibrary\) global\.KWLibrary\.onEvent\(ev\)/.test(read('js/realtime.js')));
  check('6e. the Library building and the Stores open it', /occupant\.id === 'library'/.test(read('js/settlement-view.js')) && /openLibrary\(\)/.test(read('js/stores.js')));
  const twin = path.join(ROOT, '..', 'kindlewood-server', 'lib', 'research_defs.js');
  const R = loadDefs();
  const late = R.KEYS.filter(k => R.PROJECTS[k].tier >= 3).map(k => R.PROJECTS[k].label);
  const jsAll = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');   // code, not comments
  const leaked = late.filter(l => jsAll.includes(l));
  check('6f. no distant project is named anywhere in the browser code', leaked.length === 0, leaked.join(', '));
  void twin;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
