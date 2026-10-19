'use strict';
// Events panel (community bar → js/timed-events.js) + the slimmed clock list.
//   node verify/timed_events_proofs.js
//   1. Clock glance: only what's on now + the next one, and a "See all
//      events" link to the full view.
//   2. Events panel tabs: Now (effects, countdown), Upcoming (7-day strip +
//      list with reminders), Seasons & Moon (real season effects), Recent.
//   3. Reminders: toggle persists; a reminded window toasts once when it starts.
//   4. Season effects mirror the server numbers (no invented "Storage bonus").
//   5. Wiring: Events button → openTimedEvents (the Chronicle keeps
//      openEventsPanel); script tag versioned; no Math.random.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

function el() {
  const kids = {};
  return { style: {}, innerHTML: '', scrollTop: 0, addEventListener() {}, querySelector(sel) { return kids[sel] || (kids[sel] = el()); } };
}
function makeEnv(nowMs) {
  const store = {}, toasts = [];
  let modal = null;
  const doc = {
    readyState: 'complete', getElementById: (id) => (id === 'events-modal' ? modal : null),
    createElement: () => (modal = el()), addEventListener() {}, body: { appendChild() {} },
  };
  const win = {
    __KW_NO_AUTOSTART: true, document: doc, console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    KWClock: { now: () => win._now, wallNow: () => win._now, onChange() {} }, _now: nowMs,
    showToastNotification: (m) => toasts.push(m), setInterval: () => 1, clearInterval() {}, addEventListener() {},
  };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of ['js/day-cycle.js', 'js/happening-effects.js', 'js/seasons.js', 'js/happenings.js', 'js/timed-events.js'])
    vm.runInContext(read(f), ctx, { filename: f });
  return { win, store, toasts, modal: () => modal };
}

const T = Date.parse('2026-11-05T14:30:00Z'), H = 3600e3;
const DEFS = [
  { id: 'market', title: 'Night Market', icon: '🏮', flavour: 'Lanterns till dawn.', rule: { type: 'daily', start: '14:00', durationMin: 120 },
    effects: [{ type: 'banner' }, { type: 'modifier', stat: 'wealth_production', value: 0.25 }] },
  { id: 'hunt', title: 'Owl Hunt', icon: '🦉', rule: { type: 'daily', start: '20:00', durationMin: 60 }, effects: [{ type: 'modifier', stat: 'enemy_health', value: 0.2 }] },
  { id: 'fair', title: 'Spring Fair', icon: '🎪', rule: { type: 'daily', start: '23:00', durationMin: 60 }, effects: [] },
];

{
  const { win } = makeEnv(T);
  win.KWHappenings._setDefsForTest(DEFS);
  const html = win.KWHappenings.hudHtml(T);
  check('1. clock glance: the running one + only the next one', /Night Market[\s\S]*Owl Hunt/.test(html) && !/Spring Fair/.test(html) && (html.match(/class="hc-hap( hc-hap-active)?"/g) || []).length === 2);
  check('1b. clock links to the full view', /KWEventsPanel\.open\(\)/.test(html) && /See all events/.test(html));
}
{
  const env = makeEnv(T), P = env.win.KWEventsPanel;
  env.win.KWHappenings._setDefsForTest(DEFS);
  P.open();
  const m = env.modal(), body = (t) => { P._setTab(t); return m.querySelector('.ev-body').innerHTML; };
  check('2. opens on Now when something is running', m.style.display === 'flex' && /Night Market/.test(m.querySelector('.ev-body').innerHTML));
  const now = body('now');
  check('2b. Now: flavour, effects (good in green), ends-in countdown', /Lanterns till dawn/.test(now) && /ev-fx-good">\+25% wealth production/.test(now) && /ends in<br><b>1h 30m/.test(now));
  const up = body('upcoming');
  check('2c. Upcoming: 7-day strip, day headers, times and a Remind me button', /class="ev-strip"/.test(up) && /Today/.test(up) && /data-remind="hunt@/.test(up) && /UTC/.test(up));
  check('2d. Upcoming: a curse is red', /ev-fx-bad">\+20% enemy health/.test(up));
  const se = body('seasons');
  check('2e. Seasons & Moon: current season with its real effects + 4 coming seasons + 8 moons',
        /This season/.test(se) && (se.match(/class="ev-row"/g) || []).length === 4 && (se.match(/class="ev-moon( today)?"/g) || []).length === 8);
  const rec = body('recent');
  check('2f. Recent: past windows with "ago"', /Night Market/.test(rec) && /ago/.test(rec));
  const tabs = m.querySelector('.ar-tabs').innerHTML;
  check('2g. tab badges: 1 now, counts for upcoming / recent', /data-tab="now"[\s\S]*?ar-tab-n">1</.test(tabs) && /data-tab="recent"[\s\S]*?ar-tab-n">\d+</.test(tabs));
}
{
  const env = makeEnv(T), P = env.win.KWEventsPanel;
  env.win.KWHappenings._setDefsForTest(DEFS);
  const key = 'hunt@' + Date.parse('2026-11-05T20:00:00Z');
  check('3. toggling a reminder persists it', P.toggleReminder(key) === true && P.hasReminder(key) && /hunt@/.test(env.store.kw_event_reminders));
  env.win._now = Date.parse('2026-11-05T19:59:50Z'); P.checkReminders();
  env.win._now = Date.parse('2026-11-05T20:00:10Z'); P.checkReminders();
  env.win._now = Date.parse('2026-11-05T20:00:30Z'); P.checkReminders();
  check('3b. it toasts exactly once when the window starts, then clears', env.toasts.length === 1 && /Owl Hunt is starting now/.test(env.toasts[0]) && !P.hasReminder(key), env.toasts.join(' | '));
  check('3c. toggling again cancels', P.toggleReminder('fair@' + (T + 9 * H)) === true && P.toggleReminder('fair@' + (T + 9 * H)) === false && !P.hasReminder('fair@' + (T + 9 * H)));
}
{
  const { win } = makeEnv(T);
  const w = vm.runInContext('seasonEffectLines("winter").map(l => l.text + (l.good ? "+" : "-")).join("|")', vm.createContext(win));
  check('4. winter effects are the server numbers', /Food production −60%-/.test(w) && /Food eaten \+20%-/.test(w) && /Wood burned \+50%-/.test(w) && /Birth chance −5%-/.test(w), w);
  check('4b. no invented effects left in seasons.js', !/Storage bonus|Gathering \+20%/.test(read('js/seasons.js')));
}
{
  const html = read('index.html');
  check('5. Events button opens the Events panel', /id="nav-events" onclick="openTimedEvents\(\)"/.test(html));
  check('5b. the Chronicle bell keeps openEventsPanel (no name clash)', /btn-events-bell" onclick="openEventsPanel\(\)"/.test(html) && !/root\.openEventsPanel/.test(read('js/timed-events.js')));
  check('5c. timed-events.js script tag, versioned, after happenings.js', /happenings\.js\?v=[^"]+"><\/script>\s*<script defer src="\/js\/timed-events\.js\?v=[^"]+"/.test(html));
  check('5d. no Math.random in timed-events.js', !/Math\.random/.test(read('js/timed-events.js')));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
