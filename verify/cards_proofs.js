'use strict';
// The card collection on the client: locked cards in the deck builder
// (js/deck-builder.js), village teaching (js/cards.js), the server's battle
// spoils on the result screen (js/combat-ui.js), realtime toasts, Dev Tools.
//   node verify/cards_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const DB = read('js/deck-builder.js'), CU = read('js/combat-ui.js'), RT = read('js/realtime.js'), DIP = read('js/diplomacy.js'), IDX = read('index.html');
const take = (src, start) => { const i = src.indexOf(start); if (i < 0) throw new Error('missing ' + start); return src.slice(i, src.indexOf('\n}', i) + 2); };

console.log('1. Deck builder');
{
  const w = { console, Object, String, DB_TYPE_COLORS: { attack: '#c55' }, _dbDraft: {}, _dbData: { how_to_get: 'Won in battle now and then.', catalog: {}, deck_max: 30 } };
  w.window = w; vm.createContext(w);
  vm.runInContext([take(DB, 'function _dbPoolRow('), DB.split('\n').find(l => l.startsWith('function _dbEsc(')), take(DB, 'function _dbAdd('),
    'function _dbCount(d){return Object.values(d).reduce((a,b)=>a+(b|0),0);} let fb=""; function _dbFeedback(m){fb=m;} function _dbRender(){}',
    'this.row=_dbPoolRow; this.add=_dbAdd; this.fb=()=>fb;'].join('\n'), w);
  const locked = { key: 'venom_edge', name: 'Venom Edge', cost: 1, type: 'attack', rarity: 'uncommon', owned: false, desc: 'Poison.' };
  const owned = { key: 'strike', name: 'Strike', cost: 1, type: 'attack', owned: true };
  w._dbData.catalog = { venom_edge: locked, strike: owned };
  const h = w.row(locked);
  check('1a. a locked card is greyed with a padlock, its rarity and how to get it', /db-locked/.test(h) && /🔒 Venom Edge/.test(h) && /uncommon/.test(h) && /Won in battle now and then/.test(h));
  check('1b. an owned card can be added', /onclick="_dbAdd\('strike'\)"/.test(w.row(owned)));
  w.add('venom_edge');
  check('1c. adding a locked card is refused with the reason', !w._dbDraft.venom_edge && /isn't unlocked yet/.test(w.fb()));
  w.add('strike');
  check('1d. adding an owned card works', w._dbDraft.strike === 1);
  check('1e. the pool shows owned first and "n / m collected"', /isOwned\(b\) - isOwned\(a\)/.test(DB) && /collected<\/span>/.test(DB));
}

console.log('2. Village teaching');
{
  const w = { console, document: { getElementById: () => null }, showToastNotification: () => {} };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/cards.js'), w);
  const base = { village: { id: 7, name: 'Burrowmere' }, needs_trust: 71, cards: [{ key: 'venom_edge', name: 'Venom Edge', rarity: 'uncommon', cost: 1, price: 200, owned: false, desc: 'Poison.' }, { key: 'bulwark', name: 'Bulwark', rarity: 'rare', cost: 2, price: 320, owned: true }] };
  const allied = w.KWCards._villageHtml({ ...base, allied: true });
  const not = w.KWCards._villageHtml({ ...base, allied: false });
  check('2a. Allied: Learn buttons with the price; known cards marked', /KWCards\.learn\(7, 'venom_edge', this\)/.test(allied) && /Learn · 🪙 200/.test(allied) && /✓ Known/.test(allied));
  check('2b. not yet Allied: padlocked, with the trust it needs', /🔒 Allied/.test(not) && /trust 71\+/.test(not) && !/KWCards\.learn/.test(not));
  check('2c. the village panel loads it', /id="dm-cards-\$\{npcId\}"/.test(DIP) && /KWCards\.loadVillage\(npcId\)/.test(DIP));
}

console.log('3. Battles');
check('3a. the result screen shows what the server granted (names, icons, a new card)', /function _renderSpoils\(body, sp\)/.test(CU) && /if \(data\.spoils\) _renderSpoils\(body, data\.spoils\)/.test(CU) && /New card: <b>/.test(CU));
check('3b. realtime: auto-resolved spoils and unlocked cards toast', /battle_spoils\(ev\) \{ if \(global\.KWCards\)/.test(RT) && /card_unlocked\(ev\) \{ if \(global\.KWCards\)/.test(RT));
check('3c. Dev Tools: Unlock all cards', /KWCards\.devUnlockAll\(\)/.test(IDX) && /js\/cards\.js\?v=/.test(IDX));
check('3d. the card list stays in step with the server copy', read('js/card-definitions.js').includes("last_stand: {") && read('js/card-definitions.js').includes("venom_edge: {"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
