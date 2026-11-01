'use strict';
// Rankings (js/leaderboard.js): every board is live.
//   node verify/leaderboard_proofs.js
//   1. No "check back soon" boards left; Achievement Points is gone.
//   2. A server board: podium, town line, your row, your place below the top.
//   3. Citizen boards don't open player profiles.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const content = { innerHTML: '' };
let reply = {};
const w = { console, Promise, document: { getElementById: id => (id === 'lb-content' ? content : null), querySelectorAll: () => [] },
  apiFetch: async () => ({ json: async () => reply }) };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/leaderboard.js'), w);
const src = read('js/leaderboard.js');

console.log('1. Boards');
check('1a. no board is left "check back soon"', !/live: false/.test(src));
check('1b. Achievement Points is gone (no system yet)', !/achpoints|Achievement Points/.test(src));
check('1c. settlements, citizens, fishing and both tavern games', ['score', 'wealth', 'population', 'skilled', 'adventurous', 'oldest', 'biggest', 'mostfish', 'squirrel', 'briar', 'clanprestige'].every(id => src.includes(`'${id}'`)));

(async () => {
  console.log('2. A server board');
  const row = (rank, name, sub, values, you) => ({ rank, name, sub, values, you: !!you });
  reply = { ok: true, columns: ['Score', 'Tier'], rows: [row(1, 'Bram', 'Oakhollow · City', ['12,400', 'City']), row(2, 'Wren', 'Fernby · Town', ['8,100', 'Town'], true),
    row(3, 'Pip', 'Mossgate · Village', ['3,000', 'Village']), row(4, 'Tam', 'Reedmere · Camp', ['900', 'Camp'])], you: null };
  w.Leaderboard._select('score'); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  let h = content.innerHTML;
  check('2a. podium names with their town', /lb-podium-name">Bram<\/div><div class="lb-sub-line">Oakhollow · City<\/div>/.test(h) && /12,400 · City/.test(h));
  check('2b. your row is marked', /place-2 lb-you/.test(h));
  check('2c. the table carries on after the podium', /<td class="lb-rank">4<\/td>/.test(h) && /Tam<div class="lb-sub-line">Reedmere · Camp/.test(h) && /<th>Score<\/th><th>Tier<\/th>/.test(h));
  check('2d. player rows open their profile', /Leaderboard\._viewProfile\('Bram'\)/.test(h));
  reply = { ok: true, columns: ['Wealth'], rows: [row(1, 'Bram', 'Oakhollow', ['99'])], you: row(40, 'Me', 'Smallhold', ['3']) };
  w.Leaderboard._select('wealth'); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  check('2e. below the top, "Your place" shows', /Your place: <b>#40<\/b> — Me \(Smallhold\) · 3/.test(content.innerHTML));
  reply = { ok: true, columns: ['Fish'], rows: [] };
  w.Leaderboard._select('mostfish'); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  check('2f. an empty board says how to get on it', /No catches yet/.test(content.innerHTML) && /Fishing Post/.test(content.innerHTML));

  console.log('3. Citizen boards');
  reply = { ok: true, columns: ['Career', 'Level'], rows: [row(1, 'Old Moss', 'Oakhollow', ['🌾 Farmer', 'Lv 20'])] };
  w.Leaderboard._select('skilled'); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  h = content.innerHTML;
  check('3a. a citizen with career, level and town — not a clickable profile', /Old Moss/.test(h) && /🌾 Farmer · Lv 20/.test(h) && !/_viewProfile/.test(h));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
