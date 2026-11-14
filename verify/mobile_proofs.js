'use strict';
// Phones: landscape phones get the phone layouts, dialogs go full screen,
// the tab bar hides behind them, fishing speaks touch.
//   node verify/mobile_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const SHELL = /var SHELL_MQ = '\(max-width: 768px\), \(max-height: 560px\) and \(pointer: coarse\)'/;
console.log('1. Landscape phones');
{
  check('1a. the shell query covers short touch screens', SHELL.test(read('js/mobile-shell.js')));
  const widthOnly = ['css/research.css', 'css/careers.css', 'css/crafting.css', 'css/market.css']
    .flatMap(f => [...read(f).matchAll(/@media \(max-width: \d+px\)( \{|,)/g)].filter(m => m[1] === ' {').map(() => f));
  check('1b. research, careers, crafting and Market phone rules also apply to a landscape phone', widthOnly.length === 0, widthOnly.join(', '));
  check('1c. …with the same clause as the shell', ['css/research.css', 'css/careers.css', 'css/crafting.css', 'css/market.css'].every(f => /@media \(max-width: \d+px\), \(max-height: 560px\) and \(pointer: coarse\) \{/.test(read(f))));
}

console.log('2. Full-screen dialogs');
{
  const C = read('css/mobile-shell.css');
  const cards = ['#diplomacy-modal .nb-modal-card', '#noticeboard-modal .nb-modal-card', '#quests-modal .qm-card', '#away-report-modal .ar-card', '#tier-upgrade-modal .tier-upgrade-modal-card'];
  check('2a. diplomacy, notice board, quests, away report and tier upgrade fill the phone', cards.every(c => C.includes('body.kw-shell ' + c)) && /width: 100% !important; max-width: none !important;\s*height: 100% !important/.test(C));
  // The bell's list is a KWWindow now (js/news.js): a full-screen sheet on phones like every window.
  check('2b. the news is a full sheet (a window); Stores a sheet across the top', /id: ID, title: 'News'/.test(fs.readFileSync(path.join(ROOT, 'js/news.js'), 'utf8')) && /body\.kw-shell \.stores-pop\.open \{ left: 0 !important; right: 0 !important; top: 0 !important/.test(C));
  check('2c. big close buttons', /body\.kw-shell \.qm-close, body\.kw-shell \.nb-modal-close, body\.kw-shell \.tier-upgrade-modal-close \{ min-width: 44px; min-height: 44px; \}/.test(C));
  const S = read('js/mobile-shell.js');
  const ids = ['diplomacy-modal', 'noticeboard-modal', 'quests-modal', 'away-report-modal', 'tier-upgrade-modal', 'jn-overlay', 'rs-overlay', 'cr-overlay', 'cf-overlay', 'raid-sheet', 'call-sheet', 'community-modal'];
  check('2d. the tab bar hides behind each of them', ids.every(id => S.includes(`'${id}'`)));
  check('2e. Journeys and dialogs have their own phone layouts', /body\.kw-shell \.jn-card/.test(read('css/journeys.css')) && /\.kwd-backdrop \{ align-items: flex-end/.test(read('css/dialog.css')));
}

console.log('3. Fishing on touch screens');
{
  const F = read('js/fishing.js');
  check('3a. "Tap now!" / "Press and hold to reel" on touch, Click/Space with a mouse', /_fpTouch\(\) \? 'Tap now!' : 'Click or Space!'/.test(F) && /_fpTouch\(\) \? 'Press and hold to reel' : 'Hold <kbd>Space<\/kbd>/.test(F));
  check('3b. the touch test is a top-level helper', /^\/\/ Touch screens get "tap" wording[^\n]*\nfunction _fpTouch\(\)/.test(F));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
