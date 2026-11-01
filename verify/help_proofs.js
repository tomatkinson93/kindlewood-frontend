'use strict';
// The Help page (js/help.js).
//   node verify/help_proofs.js
//   1. Every topic renders; buttons only for screens that exist; going closes Help first.
//   2. The numbers it quotes match the game's own (server files when present).
//   3. Wiring: Help and Messages have real titles; help.js loads.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const els = { 'community-title': { textContent: '' }, 'community-body': { innerHTML: '' }, 'community-modal': { classList: { _s: new Set(), add(c) { this._s.add(c); }, contains(c) { return this._s.has(c); } } } };
const calls = [];
const w = { console, document: { getElementById: id => els[id] || (id.startsWith('help-') ? (els[id] = els[id] || { open: false }) : null) },
  openLibrary: () => calls.push('library'), openResourceModal: r => calls.push('res:' + r), closeCommunity: () => calls.push('close'),
  KWMail: { open() { calls.push('mail:' + (this === w.KWMail)); } } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/help.js'), w);

console.log('1. Topics');
w.KWHelp.open('food');
const h = els['community-body'].innerHTML;
check(`1a. all ${w.KWHelp.TOPICS.length} topics render, titled "❓ Help"`, w.KWHelp.TOPICS.length >= 10 && (h.match(/<details class="help-topic"/g) || []).length === w.KWHelp.TOPICS.length && els['community-title'].textContent === '❓ Help');
check('1b. opening on a topic unfolds it', els['help-food'].open === true);
check('1c. buttons only for screens that exist here', /KWHelp\.go\('openLibrary'\)/.test(h) && /KWHelp\.go\('openResourceModal','food'\)/.test(h) && !/openMarket/.test(h) && !/visitTavern/.test(h));
w.KWHelp.go('openResourceModal', 'food'); w.KWHelp.go('KWMail.open');
check('1d. a button closes Help, then opens the screen (with its argument, on its owner)', calls.join() === 'close,res:food,close,mail:true');
check('1e. covers food, research, trade, reporting', ['food', 'research', 'market', 'safety'].every(id => w.KWHelp.TOPICS.some(t => t.id === id)));

check('1f. every topic icon is one emoji (joined emoji split apart on some systems)', w.KWHelp.TOPICS.every(t => !/\u200d/.test(t.icon) && Array.from(t.icon.replace(/\ufe0f/g, '')).length === 1)
  && !/width: 22px/.test(read('css/mail.css')));

console.log('2. Numbers match the game');
const text = w.KWHelp.TOPICS.map(t => t.body).join(' ');
const srv = path.join(ROOT, '..', 'kindlewood-server');
if (fs.existsSync(srv)) {
  const pay = require(path.join(srv, 'lib', 'tavern_pay.js'));
  check('2a. tavern pay and the daily cap', text.includes(`<b>${pay.WIN_GOLD} wealth</b>`) && text.includes(`up to ${pay.DAILY_PAID_WINS} wins a day`));
  const trust = /const MIN_TRUST = (\d+)/.exec(fs.readFileSync(path.join(srv, 'lib', 'npc_trade.js'), 'utf8'))[1];
  check('2b. villages trade from Familiar trust', text.includes(`trust ${trust}+`));
  const cm = fs.readFileSync(path.join(srv, 'lib', 'career_math.js'), 'utf8');
  check('2c. career levels and the fork level', text.includes(`from 1 to ${/var MAX_LEVEL = (\d+)/.exec(cm)[1]}`) && text.includes(`<b>level ${/var FORK_LEVEL = (\d+)/.exec(cm)[1]}</b>`));
  const oc = require(path.join(srv, 'outposts_config.js'));
  check('2d. outposts upgrade to their real max level', text.includes(`upgraded to level ${oc.OUTPOST_MAX_LEVEL}`));
} else console.log('  (server checkout not found — number checks skipped)');

console.log('3. Wiring');
const main = read('js/main.js'), html = read('index.html');
check('3a. Help opens this page; Messages and Help have real titles', /tab === 'help' && window\.KWHelp\) \{ KWHelp\.open\(\); return; \}/.test(main) && /messages: '✉ Letters'/.test(main) && /help: '❓ Help'/.test(main));
check('3b. help.js loads', /<script defer src="\/js\/help\.js\?v=\w+"><\/script>/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
