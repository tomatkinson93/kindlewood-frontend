'use strict';
// The Library panel (js/research.js).
//   node verify/research_proofs.js
//   1. Times and unlock text.
//   2. The panel: active project, scholars, project cards by field, statuses.
//   3. No Library: what to do. Dev Tools buttons only for admins.
//   4. Wiring: tags, realtime, settlement view, Stores link, twin file.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

function makeEnv(admin) {
  const els = {}, toasts = [];
  const mk = id => ({ id, innerHTML: '', textContent: '', className: '', classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } }, addEventListener() {} });
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => { const e = mk(null); return new Proxy(e, { set(t, k, v) { t[k] = v; if (k === 'innerHTML' && /id="rs-body"/.test(v)) { els['rs-body'] = mk('rs-body'); els['rs-sub'] = mk('rs-sub'); } return true; } }); },
    body: { appendChild(c) { els['rs-overlay'] = c; return c; } }, addEventListener() {},
  };
  const w = { document: doc, console, Math, JSON, Number, String, Object, Array, Set, Promise, isFinite,
    showBuildToast: m => toasts.push(m), _kwIsAdmin: () => admin };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(read('js/research-defs.js'), w);
  vm.runInContext(read('js/research.js'), w);
  return { w, els, toasts };
}

function stateWith(over) {
  const R = (() => { const x = {}; x.window = x; vm.createContext(x); vm.runInContext(read('js/research-defs.js'), x); return x.KWResearch; })();
  const projects = R.KEYS.map(k => ({ key: k, label: R.PROJECTS[k].label, icon: R.PROJECTS[k].icon, field: R.PROJECTS[k].field, cost: R.PROJECTS[k].cost,
    desc: R.PROJECTS[k].desc, requires: R.PROJECTS[k].requires, progress: 0, status: R.PROJECTS[k].requires.length ? 'locked' : 'open',
    blocked: R.PROJECTS[k].requires.length ? 'Study ' + R.PROJECTS[k].requires.map(R.label).join(' and ') + ' first.' : null }));
  return Object.assign({ library_level: 2, seats: 2, scholars: [{ id: 1, name: 'Quill', perHour: 2.2 }], per_hour: 2.2, bank: 0, bank_cap: 100,
    active: null, eta_hours: null, projects, effects: {} }, over || {});
}

console.log('1. Times and unlocks');
{
  const { w } = makeEnv(false);
  const L = w.KWLibrary;
  check('1a. hours read naturally', L.fmtHours(0.25) === '15m' && L.fmtHours(3.5) === '3h 30m' && L.fmtHours(50) === '2d 2h' && L.fmtHours(null) === '—');
  check('1b. what a project unlocks', /Gold Ore/.test(L.unlocksText('deep_veins')) && /Gems/.test(L.unlocksText('deep_veins')) && /Smelter/.test(L.unlocksText('smelting')) && /Falchion/.test(L.unlocksText('master_recipes')));
}

console.log('2. The panel');
{
  const { w, els } = makeEnv(false);
  w.KWLibrary.open();
  const st = stateWith();
  st.projects[0].status = 'active'; st.projects[0].progress = 60; st.active = st.projects[0].key; st.eta_hours = 27.3;
  st.projects.find(p => p.key === 'smelting').status = 'done';
  w.KWLibrary._setState(st); w.KWLibrary._render();
  const html = els['rs-body'].innerHTML;
  check('2a. the active project with its bar and time left', /Studying/.test(html) && /🧭 Prospecting/.test(html) && /60 \/ 120/.test(html) && /27h 18m to go/.test(html));
  check('2b. Scholars and their points per hour', /Quill <b>2\.2\/hr<\/b>/.test(html) && /Level 2 · 1 \/ 2 Scholars studying · 2\.2 points\/hr/.test(els['rs-sub'].textContent));
  check('2c. projects grouped by Nature and Lore', /🔭 Nature/.test(html) && /📜 Lore/.test(html) && (html.match(/class="rs-card /g) || []).length === 9);
  check('2d. statuses: studied, locked with the reason, open with a button', /✓ Studied/.test(html) && /🔒 Study Prospecting first\./.test(html) && /data-rs="start" data-key="record_keeping"/.test(html));
  check('2e. no Dev Tools buttons for players', !/Finish now/.test(html) && !/Reset research/.test(html));
  const banked = stateWith({ bank: 42 });
  w.KWLibrary._setState(banked); w.KWLibrary._render();
  check('2f. nothing chosen: banked points explained', /42 points banked \(up to 100\)/.test(els['rs-body'].innerHTML));
}

console.log('3. No Library; Dev Tools');
{
  const { w, els } = makeEnv(true);
  w.KWLibrary.open();
  w.KWLibrary._setState(stateWith({ library_level: 0, seats: 0, scholars: [], per_hour: 0 }));
  w.KWLibrary._render();
  const html = els['rs-body'].innerHTML;
  check('3a. no Library: build one and hire a Scholar', /Build a <b>Library<\/b>/.test(html) && /Scholar/.test(html) && !/data-rs="start"/.test(html));
  check('3b. admins get Finish now and Reset', /⚡ Finish now/.test(html) && /Reset research/.test(html));
  const { w: w2, toasts } = makeEnv(false);
  w2.KWLibrary.onEvent({ type: 'research_done', label: 'Deep Veins', icon: '🕳️', desc: 'Gold and gems.' });
  check('3c. a finished project toasts', /Research finished: Deep Veins!/.test(toasts[0] || ''));
}

console.log('4. Wiring');
{
  const html = read('index.html');
  check('4a. research-defs and research.js load; css linked', /\/js\/research-defs\.js/.test(html) && /\/js\/research\.js/.test(html) && /css\/research\.css/.test(html)
    && html.indexOf('/js/research-defs.js') < html.indexOf('/js/research.js'));
  check('4b. realtime routes research_done', /research_done\(ev\) \{ if \(global\.KWLibrary\) global\.KWLibrary\.onEvent\(ev\)/.test(read('js/realtime.js')));
  check('4c. the Library building opens the panel', /occupant\.id === 'library'/.test(read('js/settlement-view.js')) && /openLibrary\(\)/.test(read('js/settlement-view.js')));
  check('4d. the Stores popover links to the Library', /openLibrary\(\)/.test(read('js/stores.js')));
  const twin = path.join(ROOT, '..', 'kindlewood-server', 'lib', 'research_defs.js');
  check('4e. research-defs twin of the server file', !fs.existsSync(twin) || read('js/research-defs.js') === fs.readFileSync(twin, 'utf8'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
