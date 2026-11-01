'use strict';
// Saved battle decks (js/deck-builder.js): rename, set active, delete, name new decks inline.
//   node verify/decks_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const body = { innerHTML: '' };
const w = { console, Object, document: { getElementById: id => (id === 'db-body' ? body : null) } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/deck-builder.js') + `
;this.setup = (templates, activeId, extra) => { _dbData = { templates, catalog: { strike: { key: 'strike', name: 'Strike', cost: 1, type: 'attack' } }, deck_min: 12, deck_max: 30 };
  _dbActiveId = activeId; _dbDraft = { strike: 12 }; _dbName = templates.find(t => t.id === activeId).name; Object.assign(this, extra || {}); };
this.render = () => _dbRender(); this.set = (k, v) => { eval(k + ' = v'); };`, w);
const T = [{ id: 1, name: 'Starter', is_active: true, cards: {} }, { id: 2, name: 'Ambush', is_active: false, cards: {} }];

console.log('Decks');
w.setup(T, 2); w.render();
let h = body.innerHTML;
check('1. the edited deck\'s name is editable in place', /id="db-name" maxlength="60" value="Ambush"/.test(h));
check('2. an inactive deck can be made the one battles use', /_dbActivate\(2\)/.test(h) && /Use in battles/.test(h));
check('3. delete takes two taps', /_dbConfirmDelete=true;_dbRender\(\)/.test(h));
w.set('_dbConfirmDelete', true); w.render();
check('4. …the second tap deletes', /_dbDelete\(2\)/.test(body.innerHTML) && /Tap again to delete/.test(body.innerHTML));
w.set('_dbConfirmDelete', false); w.setup(T, 1); w.render(); h = body.innerHTML;
check('5. the active deck shows ★ Active and can\'t be deleted (says why)', /★ Active/.test(h) && /disabled title="Make another deck active first\."/.test(h));
w.setup([T[0]], 1); w.render();
check('6. your only deck can\'t be deleted', /disabled title="You need at least one deck\."/.test(body.innerHTML));
w.set('_dbNaming', true); w.render();
check('7. "＋ New" asks for a name inline (no browser prompt)', /id="db-new-name"/.test(body.innerHTML) && !/prompt\(/.test(read('js/deck-builder.js')));
const src = read('js/deck-builder.js');
check('8. activate and delete use the server routes; Save sends the new name', /\/api\/decks\/' \+ id \+ '\/activate', \{ method: 'POST' \}/.test(src) && /\/api\/decks\/' \+ id, \{ method: 'DELETE' \}/.test(src) && /name: \(_dbName \|\| ''\)\.trim\(\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
