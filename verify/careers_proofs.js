'use strict';
// Careers UI (js/careers.js, js/career-tree.js, js/career-math.js).
//   node verify/careers_proofs.js
//   1. career-math.js is byte-identical to the server's lib/career_math.js.
//   2. Tree layout: no crowded leaves, deterministic, each path on its own
//      side, capstones at the tips (every class, from the server's defs).
//   3. Tree drawing: states (can learn / closed path / secret), season colours.
//   4. Job picker, profile badge, Career tab, learning a perk, the fork, the
//      reveal card, realtime toasts.
//   5. Wiring: script/style tags, realtime handlers, citizens.js hooks.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SERVER = process.env.KW_SERVER_DIR || path.join(ROOT, '..', 'kindlewood-server');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

// ── Server defs (or a small fixture when the server checkout is missing) ──
let DEFS = null;
try { DEFS = require(path.join(SERVER, 'lib', 'careers')).defs(); }
catch (e) { console.log('  ⚠ server defs unavailable (' + e.message.split('\n')[0] + ') — layout checks use the fixture only'); }
const FIX_CLASS = {
  key: 'farmer', label: 'Farmer', icon: '🌾', assignable: true, needs: ['farm'], needs_labels: ['Farm'], desc: 'Works the fields.',
  fork: [{ key: 'agronomist', label: 'Agronomist', icon: '🌱', desc: 'Crops.' }, { key: 'rancher', label: 'Rancher', icon: '🐑', desc: 'Herds.' }],
  tree: [
    { id: 'farmer.furrow', name: 'Furrow & Seed', icon: '🌱', branch: 'trunk', tier: 2, lane: 0, maxRank: 3, requires: [], effects: [{ type: 'output', per: 0.06 }] },
    { id: 'farmer.green_fingers', name: 'Green Fingers', icon: '🪴', branch: 'trunk', tier: 6, lane: -2, maxRank: 1, requires: [], secret: 'green_thumb', effects: [{ type: 'output', per: 0.1 }] },
    { id: 'farmer.crop_rotation', name: 'Crop Rotation', icon: '🔄', branch: 'agronomist', tier: 11, lane: 0, maxRank: 3, requires: [], effects: [{ type: 'output', per: 0.06 }] },
    { id: 'farmer.herd_lore', name: 'Herd Lore', icon: '🐑', branch: 'rancher', tier: 11, lane: 0, maxRank: 3, requires: [], effects: [{ type: 'output', per: 0.05 }] },
    { id: 'farmer.golden_fields', name: 'Golden Fields', icon: '🌾', branch: 'agronomist', tier: 20, lane: 0, maxRank: 1, requires: [], capstone: true, effects: [{ type: 'output', per: 0.25 }] },
    { id: 'farmer.prize_herd', name: 'Prize Herd', icon: '🏆', branch: 'rancher', tier: 20, lane: 0, maxRank: 1, requires: [], capstone: true, effects: [{ type: 'output', per: 0.15 }] },
  ],
};

// ── Tiny DOM ──
function makeEnv(routes) {
  const els = {}, toasts = [], calls = [], body = [];
  const mk = id => {
    const listeners = {};
    const el = {
      id, innerHTML: '', textContent: '', style: {}, dataset: {}, className: '', children: [],
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle() {} },
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); }, _listeners: listeners,
      querySelector: () => null, querySelectorAll: () => [], appendChild(c) { this.children.push(c); return c; },
      setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), offsetParent: {},
    };
    Object.defineProperty(el, 'onclick', { set(fn) { listeners.click = [fn]; }, get() { return (listeners.click || [])[0]; } });
    return el;
  };
  const getEl = id => (els[id] = els[id] || mk(id));
  const doc = {
    // Inner ids come from innerHTML (auto-created); the overlay roots are made by careers.js itself.
    getElementById: id => els[id] || (['cr-overlay', 'cr-fork', 'cr-reveal'].includes(id) ? null : getEl(id)),
    createElement: () => { const e = mk(null); return new Proxy(e, { set(t, k, v) { t[k] = v; if (k === 'id' && v) els[v] = t; return true; } }); },
    body: { appendChild(c) { body.push(c); if (c.id) els[c.id] = c; return c; } },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  };
  const win = {
    document: doc, console, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, setTimeout: () => 1, clearTimeout() {},
    __KW_NO_AUTOSTART: true, matchMedia: () => ({ matches: true }),
    showBuildToast: (m, t) => toasts.push([m, t || 'success']),
    confirm: () => true, calcCurrentSeason: () => ({ id: 'autumn' }),
    apiFetch: async (p, opts) => {
      calls.push([opts && opts.method || 'GET', p, opts && opts.body ? JSON.parse(opts.body) : null]);
      const key = Object.keys(routes).find(k => p.startsWith(k));
      const v = key ? routes[key] : { error: 'nope' };
      const b = typeof v === 'function' ? v(p, opts) : v;
      return { ok: !b.error, json: async () => b };
    },
  };
  win.window = win;
  vm.createContext(win);
  for (const f of ['js/career-math.js', 'js/career-tree.js', 'js/careers.js']) vm.runInContext(read(f), win, { filename: f });
  return { win, getEl, els, toasts, calls, body };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // 1 — shared maths
  {
    const srv = path.join(SERVER, 'lib', 'career_math.js');
    if (fs.existsSync(srv)) check('1. career-math.js is byte-identical to the server copy', fs.readFileSync(srv, 'utf8') === read('js/career-math.js'));
    else console.log('  ⚠ 1. skipped byte identity — no server checkout');
  }

  // 2 — layout
  {
    const env = makeEnv({});
    const T = env.win.KWCareerTree;
    const classes = DEFS ? Object.values(DEFS.classes) : [FIX_CLASS];
    let crowded = [], sides = true, caps = true, determ = true, bounds = true;
    for (const c of classes) {
      const L = T.layout(c), L2 = T.layout(c);
      const pts = Object.entries(L.nodes);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i][1].x - pts[j][1].x, pts[i][1].y - pts[j][1].y);
        if (d < 60) crowded.push(`${c.key}: ${pts[i][0]}~${pts[j][0]} (${Math.round(d)})`);
      }
      if (JSON.stringify(L) !== JSON.stringify(L2)) determ = false;
      if (pts.some(([, p]) => p.x < 20 || p.x > 980 || p.y < 30 || p.y > L.height)) bounds = false;
      if (c.fork) {
        const [a, b] = c.fork.map(f => f.key);
        for (const n of c.tree) {
          if (n.branch === a && L.nodes[n.id].x >= 500) sides = false;
          if (n.branch === b && L.nodes[n.id].x <= 500) sides = false;
        }
      }
      for (const n of c.tree.filter(x => x.capstone)) {
        const others = c.tree.filter(x => x.branch === n.branch && !x.capstone);
        if (others.some(o => L.nodes[o.id].y <= L.nodes[n.id].y)) caps = false;
      }
    }
    check(`2. no two leaves closer than their size (${classes.length} classes)`, !crowded.length, crowded.slice(0, 3).join(', '));
    check('2b. layout is deterministic', determ);
    check('2c. each path grows on its own side of the trunk', sides);
    check('2d. capstones crown their branch', caps);
    check('2e. everything stays on the canvas', bounds);
  }

  // 3 — drawing
  {
    const env = makeEnv({});
    const T = env.win.KWCareerTree;
    const el = env.getEl('tree');
    const row = { level: 12, spec: 'agronomist', nodes: { 'farmer.furrow': 3 } };
    T.render(el, { cls: FIX_CLASS, row, revealed: [], season: 'autumn' });
    const h = el.innerHTML;
    check('3. learned perk drawn as maxed, with rank pips', /data-node="farmer.furrow"/.test(h) && /ct-node ct-maxed/.test(h) && (h.match(/<circle cx="[^"]+" cy="[^"]+" r="4.5"/g) || []).length >= 3);
    check('3b. the path not taken is bare and closed', /ct-bough ct-bare" data-spec="rancher"/.test(h) && /ct-node ct-closed[^"]*" data-node="farmer.herd_lore"/.test(h));
    check('3c. a secret perk shows ??? until its talent is found', /ct-secret[^"]*" data-node="farmer.green_fingers"[\s\S]*?>\?\?\?</.test(h));
    check('3d. chosen path perk at level 12 can be learned', /ct-available" data-node="farmer.crop_rotation"/.test(h));
    T.render(el, { cls: FIX_CLASS, row, revealed: ['green_thumb'], season: 'winter' });
    const w = el.innerHTML;
    check('3e. revealed talent opens the secret perk', /ct-available" data-node="farmer.green_fingers"/.test(w) && /Green Fingers/.test(w));
    check('3f. leaves take the season\'s colours', h.includes(T.PALETTES.autumn.leafOwned) && w.includes(T.PALETTES.winter.leafOwned) && !w.includes(T.PALETTES.autumn.leafOwned));
  }

  // 4 — careers.js
  {
    const defs = DEFS ? JSON.parse(JSON.stringify(DEFS)) : null;
    if (!defs) { console.log('  ⚠ 4. skipped — needs server defs'); }
    else {
      let learned = null, forked = null;
      const career = {
        citizen_id: 7, name: 'Fenn Oakstride', role: 'farmer', life_stage: 'adult',
        classes: [
          { class_key: 'farmer', xp: 1800, level: 10, spec: null, nodes: { 'farmer.furrow': 1 }, hours_worked: 200, years: 7, into: 5, need: 626, pct: 0.01,
            free_points: 8, fork_ready: true, title: 'Farmer', retrain_cost: 25 },
          { class_key: 'porter', xp: 40, level: 3, spec: null, nodes: {}, hours_worked: 2, years: 0, into: 15, need: 50, pct: 0.3, free_points: 2, fork_ready: false, title: 'Apprentice Porter', retrain_cost: 0 },
        ],
        active: { class_key: 'farmer', effects: { output: 0.06, 'season:winter': 0.25 }, sources: [{ type: 'output', value: 0.06, source: 'Furrow & Seed' }],
          stats: {}, skills: {}, output_mult: 1.06, stat_mult: 1, mentor: 'Ash', apprentices: 0, xp_rate: { perHour: 12, parts: [{ label: 'Mentor', mult: 1.2 }] } },
        revealed_traits: [], hints: [], earned_traits: [], counters: {}, history: [{ narrative: 'Fenn became Farmer (Lv 10).', occurred_at: new Date().toISOString() }],
      };
      const env = makeEnv({
        '/api/careers/defs': { ok: true, ...defs },
        '/api/careers/citizen/7/nodes': (p, o) => { learned = JSON.parse(o.body); return { ok: true, nodes: { 'farmer.furrow': 2 }, free: 7 }; },
        '/api/careers/citizen/7/fork': (p, o) => { forked = JSON.parse(o.body); return { ok: true, spec: 'agronomist' }; },
        '/api/careers/citizen/7': { ok: true, career },
      });
      const K = env.win.KWCareers;
      await K.loadDefs();
      env.win.gameData = { buildings: [{ type: 'farm', level: 1 }] };
      const opts = K.roleOptionsHtml({ role: 'farmer', class_levels: { farmer: 10, porter: 3 } });
      check('4. job picker: levels per job; jobs without their building can\'t be picked', /🌾 Farmer · Lv 10/.test(opts) && /value="miner"\s+disabled>⛏️ Miner · needs a Mine/.test(opts) && /🎒 Porter · Lv 3/.test(opts) && !/merchant/.test(opts));
      const badge = K.badgeHtml({ career: { class_key: 'farmer', level: 10, title: 'Farmer', pct: 0.5, points_free: 8, fork_ready: true, years: 7 } });
      check('4b. profile badge: title, level, years, a ring, an alert when a path waits', /Farmer · Lv 10 · 7 yrs/.test(badge) && /--deg:180deg/.test(badge) && /cr-dot/.test(badge));
      const tab = env.getEl('cp-career-content');
      await K.renderTab(7, tab);
      const h = tab.innerHTML;
      check('4c. Career tab: title, XP to next level, rate, mentor, bonuses, story', /Farmer · Level 10 · 7 years on the job/.test(h) && /5 \/ 626 XP to level 11/.test(h) && /12 XP\/hr/.test(h)
        && /Learning from <b>Ash<\/b>/.test(h) && /\+6% work output/.test(h) && /\+25% output in winter/.test(h) && /Fenn became Farmer/.test(h));
      check('4d. fork ready: a Choose-a-path button; skill tree shows points', /data-cr="fork"/.test(h) && /Skill tree <b class="cr-pts">8<\/b>/.test(h));
      check('4e. other trades are listed (XP kept)', /Apprentice Porter <b>Lv 3<\/b>/.test(h));
      check('4f. no Dev Tools for players', !/cr-admin/.test(h));
      await K.openTree(7, 'farmer');
      const ov = env.els['cr-overlay'];
      check('4g. skill tree opens in its own overlay', ov && ov.classList.contains('open') && /cr-tree-panel/.test(ov.innerHTML));
      const btn = { dataset: { cr: 'learn', node: 'farmer.furrow' }, disabled: false };
      btn.closest = () => btn;
      await ov._listeners.click[0]({ target: btn });
      await tick();
      check('4h. learning a perk posts the class and the perk', learned && learned.class_key === 'farmer' && learned.node_id === 'farmer.furrow');
      await K.openFork(7, 'farmer');
      const fm = env.els['cr-fork'];
      check('4i. fork ceremony: both paths, their capstones, "for life"', /Agronomist/.test(fm.innerHTML) && /Rancher/.test(fm.innerHTML) && /Golden Fields/.test(fm.innerHTML) && /for life/.test(fm.innerHTML));
      const pathBtn = { dataset: { spec: 'agronomist' } }; pathBtn.closest = s => (s === '.cr-path' ? pathBtn : null);
      fm.querySelectorAll = () => [];
      await fm._listeners.click[0]({ target: pathBtn });
      const confirm = env.els['cr-fork-confirm'];
      check('4j. picking a path asks to confirm ("Become an Agronomist")', confirm && /Become an Agronomist/.test(confirm.innerHTML));
      const go = { dataset: { go: 'agronomist' }, disabled: false }; go.closest = s => (s === '[data-go]' ? go : null);
      await fm._listeners.click[0]({ target: go });
      await tick();
      check('4k. confirming posts the path', forked && forked.spec === 'agronomist' && forked.class_key === 'farmer');
      K.onEvent({ type: 'trait_revealed', citizen_id: 7, name: 'Fenn', trait: 'green_thumb', label: 'Green Thumb', icon: '🌱', desc: 'Plants thrive around them.', kind: 'aptitude' });
      await tick(); await tick();
      const rc = env.els['cr-reveal'];
      check('4l. a discovery unfurls a reveal card', rc && rc.classList.contains('open') && /A hidden talent/.test(rc.innerHTML) && /Green Thumb/.test(rc.innerHTML));
      K.onEvent({ type: 'career_level_up', name: 'Fenn', level: 5, title: 'Journeyman Farmer', fork_ready: false });
      K.onEvent({ type: 'career_level_up', name: 'Fenn', level: 10, title: 'Farmer', fork_ready: true });
      K.onEvent({ type: 'career_milestone', name: 'Fenn', label: 'Miner\'s Lung', icon: '😷', good: false });
      const ts = env.toasts.map(t => t[0]).join(' | ');
      check('4m. toasts: level up, path ready, a bad quirk', /Fenn is now Journeyman Farmer \(Lv 5\)/.test(ts) && /time to choose a path/.test(ts) && /Miner's Lung — the years took their toll/.test(ts));
      const traits = K.traitsHtml({ name: 'Fenn Oakstride', revealed_hidden_traits: ['green_thumb', 'seasick'], trait_hints: ['stone_sense'], earned_traits: [{ id: 'veteran', class: 'farmer' }] });
      check('4n. Traits tab: discovered (good and bad), a hint, earned', /cr-good[\s\S]*Green Thumb/.test(traits) && /cr-bad[\s\S]*Seasick/.test(traits) && /seems… different/.test(traits) && /Veteran Farmer/.test(traits));
    }
  }

  // 5 — wiring
  {
    const html = read('index.html'), rt = read('js/realtime.js'), cz = read('js/citizens.js');
    const order = ['career-math.js', 'career-tree.js', 'careers.js', 'citizens.js'].map(f => html.indexOf('/js/' + f + '?v='));
    check('5. versioned tags, careers before citizens', order.every(i => i > 0) && order.every((v, i) => !i || v > order[i - 1]) && /\/css\/careers\.css\?v=/.test(html));
    check('5b. realtime handlers for every career event', ['career_level_up', 'career_fork', 'career_milestone', 'career_find', 'trait_hint', 'trait_revealed'].every(t => new RegExp(t + '\\(ev\\) \\{ if \\(global\\.KWCareers\\)').test(rt)));
    check('5c. citizens.js: Career tab, badge, job list, hidden traits', /cp-tab-career/.test(cz) && /KWCareers\.renderTab/.test(cz) && /KWCareers\.badgeHtml/.test(cz) && /KWCareers\.roleOptionsHtml/.test(cz) && /KWCareers\.traitsHtml/.test(cz));
    check('5d. a refused job change says why', /Could not change job/.test(cz) && /res\.ok/.test(cz));
    check('5e. reduced motion calms the tree', /prefers-reduced-motion/.test(read('css/careers.css')) && /prefers-reduced-motion/.test(read('js/career-tree.js')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
