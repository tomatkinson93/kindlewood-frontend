'use strict';
// "Since you were gone…" splash proofs (node, no deps).
//   node verify/away_report_proofs.js
//   1. start(): the report is fetched BEFORE the first heartbeat (so the
//      heartbeat can't wipe the report it is about to show), once per load.
//   2. The splash shows only for show:true reports with content, and never
//      when turned off (Don't show again / Settings → General).
//   3. Content: resource tiles, citizen names as profile links, waiting
//      items, the season trail; HTML in event text is escaped.
//   4. "Don't show me this again" turns the setting off.
//   5. Wiring: script tag, loadGame hook, General settings tab + switch.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
};

// Tiny element stub: remembers innerHTML / textContent / style per selector.
function el() {
  const kids = {};
  return {
    style: {}, innerHTML: '', textContent: '', checked: false, _listeners: {},
    addEventListener(k, f) { (this._listeners[k] = this._listeners[k] || []).push(f); },
    querySelector(sel) { return kids[sel] || (kids[sel] = el()); },
  };
}

function makeEnv(report, opts) {
  opts = opts || {};
  const calls = [], store = Object.assign({}, opts.storage || {});
  let modal = null;
  const doc = {
    hidden: false,
    getElementById: (id) => (id === 'away-report-modal' ? modal : null),
    createElement: () => (modal = el()),
    addEventListener() {},
    body: { appendChild() {} },
  };
  const win = {
    document: doc,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener() {},
    apiFetch: (p, o) => { calls.push((o && o.method || 'GET') + ' ' + p); return Promise.resolve({ ok: true, json: () => Promise.resolve(report) }); },
    showToastNotification() {},
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { setInterval: () => 1, clearInterval() {}, console }));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/away-report.js'), 'utf8'), ctx);
  return { win, calls, store, modal: () => modal };
}

const NOW = Date.parse('2026-11-05T12:00:00Z'), H = 3600e3;
const REPORT = {
  ok: true, show: true, since: NOW - 9 * H, now: NOW, awayMs: 9 * H,
  resources: {
    food: { produced: 300, consumed: 120, net: 180, multiplier: 0.9, sources: [{ label: 'Farmers (×1)', amount: 300, citizens: [{ id: 1, name: 'Wren', amount: 300 }] }], consumers: [] },
    timber: { produced: 0, consumed: 0, net: 0, sources: [], consumers: [] },
    stone: { produced: 0, consumed: 0, net: 0, sources: [], consumers: [] },
    metal: { produced: 0, consumed: 0, net: 0, sources: [], consumers: [] },
    wealth: { produced: 0, consumed: 0, net: 0, sources: [], consumers: [] },
  },
  events: [
    { at: NOW - 2 * H, category: 'citizens', icon: '🍼', text: 'Wren and Pip welcome a son.', citizenIds: [1, 2] },
    { at: NOW - H, category: 'other', icon: '📜', text: '<img src=x onerror=alert(1)>', citizenIds: [] },
  ],
  citizens: { 1: 'Wren', 2: 'Pip' },
  happenings: [],
  seasons: [{ id: 'autumn', name: 'Autumn', emoji: '🍂', fromMs: NOW - 9 * H, toMs: NOW - 5 * H }, { id: 'winter', name: 'Winter', emoji: '❄️', fromMs: NOW - 5 * H, toMs: NOW }],
  waiting: [{ icon: '🎁', text: '1 quest reward ready to collect', action: 'quests' }],
};
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  {
    const env = makeEnv(REPORT);
    await env.win.KWAwayReport.start(); await tick();
    check('1. report fetched before the first heartbeat', env.calls[0] === 'GET /api/game/away-report' && env.calls[1] === 'POST /api/game/seen', env.calls.join(', '));
    await env.win.KWAwayReport.start(); await tick();
    check('1b. start() runs once per page load', env.calls.filter(c => /away-report/.test(c)).length === 1);
    const m = env.modal();
    check('2. a show:true report with content opens the splash', !!m && m.style.display === 'flex');
    const body = m.querySelector('.ar-body').innerHTML;
    check('3. resource tiles with net change (+180 food)', /data-res="food"/.test(body) && /\+180/.test(body));
    check('3b. citizen names become profile links', /data-cid="1">Wren<\/button>/.test(body) && /data-cid="2">Pip<\/button>/.test(body));
    check('3c. waiting items get an Open button', /data-action="quests"/.test(body));
    check('3d. the season trail is listed', /Autumn[\s\S]*Winter/.test(body));
    check('3e. HTML in event text is escaped', !/<img/.test(body) && /&lt;img/.test(body));
    check('3f. away duration in the header', /away 9h/.test(m.querySelector('.ar-away').textContent));
    m.querySelector('.ar-dont-box').checked = true;
    env.win.KWAwayReport.close();
    check('4. "Don\'t show me this again" turns the setting off', env.store.kw_away_splash === 'off' && !env.win.KWAwayReport.enabled() && m.style.display === 'none');
  }
  {
    const env = makeEnv(REPORT, { storage: { kw_away_splash: 'off' } });
    await env.win.KWAwayReport.start(); await tick();
    check('2b. turned off → no splash, heartbeat still runs', !env.modal() && env.calls.includes('POST /api/game/seen'));
  }
  {
    const env = makeEnv({ ok: true, show: false });
    await env.win.KWAwayReport.start(); await tick();
    check('2c. show:false (short absence) → no splash', !env.modal());
    const empty = Object.assign({}, REPORT, { events: [], waiting: [], happenings: [], resources: { food: { produced: 0, consumed: 0 } } });
    check('2d. nothing happened → hasContent false', env.win.KWAwayReport.hasContent(empty) === false && env.win.KWAwayReport.hasContent(REPORT) === true);
  }

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const sp = fs.readFileSync(path.join(ROOT, 'js/settings-panel.js'), 'utf8');
  check('5. away-report.js script tag (versioned)', /<script defer src="\/js\/away-report\.js\?v=[^"]+"><\/script>/.test(html));
  check('5b. loadGame starts it after the settlement load', /KWAwayReport\.start\(\)/.test(main.slice(main.indexOf('async function loadGame'), main.indexOf('function switchTab'))));
  check('5c. Settings → General tab with the switch', /data-settings-tab="general"/.test(html) && /data-settings-panel="general"[\s\S]*data-away-setting/.test(html));
  check('5d. settings-panel wires the switch to KWAwayReport.setEnabled', /KWAwayReport\.setEnabled\(away\.checked\)/.test(sp) && /KWAwayReport\.enabled\(\)/.test(sp));
  check('5e. no Math.random in away-report.js', !/Math\.random/.test(fs.readFileSync(path.join(ROOT, 'js/away-report.js'), 'utf8')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
