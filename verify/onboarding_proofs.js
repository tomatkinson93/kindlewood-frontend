'use strict';
// First steps (js/first-steps.js) and "How this works" links to Help.
//   node verify/onboarding_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const w = { console, Date, Math, localStorage: { _: {}, getItem(k) { return this._[k] || null; }, setItem(k, v) { this._[k] = v; } } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/first-steps.js'), w);
const F = w.KWFirstSteps;
const steps = [
  { key: 'lumber', icon: '🪵', title: 'Build a Lumber Camp', hint: 'Timber builds <everything>.', show: 'build', done: true },
  { key: 'jobs', icon: '👷', title: 'Give a citizen a new job', hint: 'Open Manage Citizens.', show: 'citizens', done: false },
  { key: 'quest', icon: '⚔️', title: 'Take a quest', hint: 'The Tavern board.', show: 'tavern', done: false },
];

console.log('1. The card');
{
  const h = F.cardHtml({ steps, done: 1, total: 3, dismissed: false });
  check('1a. a collapsible card with a progress bar: 1/3', /<details class="fs-card" open/.test(h) && /fs-count">1\/3</.test(h) && /role="progressbar"[^>]*aria-valuenow="1"/.test(h) && /width:33%/.test(h));
  check('1b. done steps are ticked; open ones have a hint and Show me', /fs-step done[^]*✔[^]*Build a Lumber Camp/.test(h) && /data-fs-show="citizens">Show me/.test(h) && !/data-fs-show="build"/.test(h));
  check('1c. names the next step', /Next: 👷 Give a citizen a new job/.test(h));
  check('1d. text is escaped', !/<everything>/.test(F.cardHtml({ steps: steps.map(s => ({ ...s, done: false })), done: 0, total: 3 })));
  check('1e. hidden when dismissed or all done', F.cardHtml({ steps, done: 1, total: 3, dismissed: true }) === '' && F.cardHtml({ steps, done: 3, total: 3 }) === '');
  w.localStorage.setItem('kw_first_steps_open', '0');
  check('1f. remembers being folded', !/fs-card" open/.test(F.cardHtml({ steps, done: 1, total: 3 })));
  check('1g. Show me opens the right screens', ['build', 'citizens', 'tavern', 'map', 'research', 'market'].every(k => typeof F._show[k] === 'function'));
  const J = read('js/first-steps.js');
  check('1h. Hide asks in-game, then tells the server', /KWDialog\.confirm\(\{ title: 'Hide the first steps\?'/.test(J) && /\/api\/game\/first-steps\/dismiss/.test(J));
  check('1i. a toast once every step is done', /First steps complete/.test(J) && /DONE_KEY/.test(J));
  const M = read('js/main.js');
  check('1j. at the top of your own settlement panel, refreshed when it opens', /_settlementTierCard\(s\.tier, s\.name, true\)\n\s*\+ '<div id="fs-slot">'/.test(M) && /KWFirstSteps\.load\(\)/.test(M));
  check('1k. loaded on the page', /\/js\/first-steps\.js\?v=/.test(read('index.html')) && /\/css\/first-steps\.css\?v=/.test(read('index.html')));
}

console.log('2. How this works');
{
  const where = { 'js/research.js': 'research', 'js/careers.js': 'careers', 'js/main.js': 'outposts', 'js/expeditions.js': 'expeditions', 'js/journeys.js': 'travel', 'js/stores.js': 'stores', 'js/settlement-view.js': 'raids', 'js/raids.js': 'raids' };
  const miss = Object.entries(where).filter(([f, t]) => !new RegExp(`class="kw-help-q" aria-label="How this works"[^>]*KWHelp\\.open\\(\\\\?'${t}\\\\?'\\)`).test(read(f)));
  check('2a. a labelled "?" in research, careers, outposts, scouting, journeys, Stores, walls and raids', miss.length === 0, miss.map(m => m[0]).join(', '));
  const H = read('js/help.js');
  check('2b. Help has topics for scouting, journeys and Stores', /id: 'expeditions'/.test(H) && /id: 'travel'/.test(H) && /id: 'stores'/.test(H) && /<b>Recall<\/b>/.test(H));
  check('2c. opening a topic unfolds it, scrolls to it, and sits above the screen that asked', /d\.open = true; try \{ d\.scrollIntoView/.test(H) && /classList\.add\('kw-help-top'\)/.test(H) && /\.community-modal\.kw-help-top \{ z-index: 100030/.test(read('css/dialog.css')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
