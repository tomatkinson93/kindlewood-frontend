'use strict';
// In-game dialogs (js/dialog.js) instead of the browser's alert/confirm/prompt.
//   node verify/dialog_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const w = { console, Promise, setTimeout };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/dialog.js'), w);
const D = w.KWDialog;

console.log('1. The dialog');
{
  const c = D._html('confirm', { title: 'Demolish <Farm>?', message: 'Gone for good.\nNo refund.', ok: 'Demolish', danger: true }, 7);
  check('1a. a modal dialog, labelled by its title and described by its message', /role="dialog" aria-modal="true" aria-labelledby="kwd-title-7" aria-describedby="kwd-msg-7"/.test(c));
  check('1b. text is escaped; new lines become breaks', /Demolish &lt;Farm&gt;\?/.test(c) && /Gone for good\.<br>No refund\./.test(c));
  check('1c. confirm: Cancel and a red Demolish', /data-kwd="cancel">Cancel</.test(c) && /class="kwd-btn kwd-ok kwd-danger" data-kwd="ok">Demolish</.test(c));
  const a = D._html('alert', { title: 'Oops', message: 'Failed.' }, 8);
  check('1d. alert: an alertdialog with one OK', /role="alertdialog"/.test(a) && /data-kwd="ok">OK</.test(a) && !/data-kwd="cancel"/.test(a));
  const p = D._html('prompt', { title: 'Name your deck', value: 'Deck "1"', maxLength: 30 }, 9);
  check('1e. prompt: a labelled text field with its value', /<input class="kwd-input" type="text" id="kwd-input-9" value="Deck &quot;1&quot;"[^>]* maxlength="30" aria-label="Name your deck">/.test(p));
  const J = read('js/dialog.js');
  check('1f. keyboard: Esc cancels, Enter confirms, Tab stays inside; focus returns after', /e\.key === 'Escape'/.test(J) && /e\.key === 'Enter'/.test(J) && /e\.key === 'Tab'/.test(J) && /prev\.focus\(\)/.test(J));
  check('1g. one at a time (queued)', /queue\.push/.test(J) && /function next\(\)/.test(J));
  check('1h. phones get a bottom sheet with big buttons', /@media \(max-width: 600px\)[^{]*\{[^]*\.kwd-backdrop \{ align-items: flex-end/.test(read('css/dialog.css')) && /min-height: 46px/.test(read('css/dialog.css')));
  check('1i. loaded on the page', /\/js\/dialog\.js\?v=/.test(read('index.html')) && /\/css\/dialog\.css\?v=/.test(read('index.html')));
}

(async () => {
  console.log('2. Promises');
  check('2a. with no page, confirm answers false, prompt null, alert undefined', (await D.confirm('x')) === false && (await D.prompt({ title: 'y' })) === null && (await D.alert('z')) === undefined);

  console.log('3. No browser pop-ups in the game');
  // Admin and Dev Tools code may keep them.
  const ADMIN_FILES = ['js/card-admin.js', 'js/enemy_admin.js', 'js/happenings-admin.js', 'js/item_admin.js', 'js/quest-admin.js', 'js/quest_admin.js'];
  const ADMIN_FUNCS = ['cheatHealAllInjuries', 'debugSeedNpcs', 'debugRunMigrations', 'applyMapRegenerate', 'restoreArchivedMap', 'debugResetDiplomacy', '_applyDevTileTerrain', '_svResetLayout'];
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)) {
    if (ADMIN_FILES.includes(f) || f === 'js/dialog.js') continue;
    const L = read(f).split('\n');
    L.forEach((l, i) => {
      if (!/(^|[^.\w])(window\.)?(alert|confirm|prompt)\(/.test(l) || /^\s*\/\//.test(l)) return;
      let j = i, fn = '?';
      while (j >= 0) { const m = L[j].match(/^(?:async )?function (\w+)/); if (m) { fn = m[1]; break; } j--; }
      if (!ADMIN_FUNCS.includes(fn)) bad.push(`${f}:${i + 1} (${fn})`);
    });
  }
  check('3a. every player-facing alert/confirm/prompt uses KWDialog', bad.length === 0, bad.join(', '));
  const uses = ['js/buildings.js', 'js/settlement-view.js', 'js/main.js', 'js/inventory.js', 'js/battles.js', 'js/chat-hub.js', 'js/feedback.js', 'js/tavern.js', 'js/placement.js', 'js/arrival.js'].filter(f => /KWDialog\.(confirm|alert)\(/.test(read(f)));
  check('3b. demolish, dismantle, discard, forfeit, chat deletes, feedback, tavern, placement and arrival use it', uses.length === 10, uses.length + '/10');
  check('3c. destructive actions are marked danger', /title: 'Dismantle this outpost\?'[^\n]*danger: true/.test(read('js/main.js')) && /title: 'Discard this item\?'[^}]*danger: true/.test(read('js/inventory.js')) && /title: 'Forfeit this battle\?'[^}]*danger: true/.test(read('js/battles.js')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
