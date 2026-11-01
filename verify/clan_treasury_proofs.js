'use strict';
// The clan Treasury and Goals tabs (js/clan-treasury.js, wired by
// js/clans.js), land release, honors on the clan profile, Dev Tools, Help.
//   node verify/clan_treasury_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const w = { console, Date, Math, Number, document: { getElementById: () => null }, apiFetch: async () => ({ ok: false, json: async () => ({}) }) };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/clan-treasury.js'), w);
const CT = w.ClanTreasury;
const CL = read('js/clans.js'), IDX = read('index.html');

console.log('1. Treasury');
{
  CT._st.treasury = {
    treasury: 1080, can_spend: true, members: 2,
    donate: { cap: 2000, given_today: 500, left_today: 1500, prestige_per: 10 },
    land: { tiles: 3, income_per_day: 6, outpost_bonus: 0.1, defence: 10 },
    boons: [
      { key: 'bountiful_fields', label: 'Bountiful Fields', icon: '🌾', desc: '+5% food.', cost: 420, days: 7, active: true, until: new Date(Date.now() + 3 * 86400e3).toISOString() },
      { key: 'iron_wall', label: 'Iron Wall', icon: '🛡️', desc: '+20 defence.', cost: 420, days: 7, active: false },
      { key: 'trade_pact', label: 'Trade Pact', icon: '💰', desc: '−5% fees.', cost: 1500, days: 7, active: false },
    ],
    log: [{ kind: 'donate', amount: 500, who: 'Wren', at: new Date().toISOString() }, { kind: 'boon', amount: -420, who: 'Ash', detail: { boon: 'bountiful_fields' }, at: new Date().toISOString() }],
  };
  const h = CT.html('treasury');
  check('1a. the balance, and what is left to give today', /💰 1,080/.test(h) && /1,500 of 2,000 left today/.test(h) && /data-ct="donate"/.test(h));
  check('1b. an active boon shows its time left; others can be bought (or are too dear)', /active · 2d|active · 3d/.test(h) && /data-ct="boon" data-key="iron_wall" >Buy · 420 for 7 days/.test(h) && /data-key="trade_pact" disabled>/.test(h));
  check('1c. the ledger names who gave and who spent', /<b>Wren<\/b> gave 500/.test(h) && /<b>Ash<\/b> bought bountiful fields for 420/.test(h));
  CT._st.treasury.can_spend = false;
  check('1d. ranks that can\'t spend see the price, no button', !/data-ct="boon"/.test(CT.html('treasury')) && /officers and above buy boons/.test(CT.html('treasury')));
}

console.log('2. Goals');
{
  CT._st.goals = {
    week: '2026-W44', ends_at: new Date(Date.now() + 2 * 86400e3 + 3600e3).toISOString(), reward: { prestige: 60, treasury: 150 },
    goals: [{ key: 'donate', icon: '💰', label: 'Give 1000 wealth to the treasury', target: 1000, progress: 1500, done: true },
            { key: 'quests', icon: '📜', label: 'Finish 10 quests', target: 10, progress: 4, done: false }],
    all_done: false, weeks_done: 2,
    honors: [{ key: 'goals_1', icon: '🎯', label: 'A Week\'s Work', desc: 'Met all three weekly goals.' }],
  };
  const h = CT.html('goals');
  check('2a. each goal with progress (capped) and a bar', /✓ Done/.test(h) && /4 \/ 10/.test(h) && /width:40%/.test(h) && /width:100%/.test(h));
  check('2b. the reward and when new goals come', /pays <b>60<\/b> prestige and <b>150<\/b>/.test(h) && /New goals in <b>2d/.test(h));
  check('2c. weeks completed and honors', /Weeks with every goal met: <b>2<\/b>/.test(h) && /🎯<span>A Week's Work<\/span>/.test(h));
}

console.log('3. Wiring');
check('3a. Goals and Treasury tabs in the clan panel', /'quests', 'goals', 'treasury', 'unlocks'/.test(CL) && /ClanTreasury\.html\(state\.tab\)/.test(CL));
check('3b. data-ct clicks go to ClanTreasury', /closest\('\[data-ct\]'\)/.test(CL) && /ClanTreasury\.onClick\(ct\)/.test(CL));
check('3c. leaders can give up land (not the hall\'s tile)', /data-act="terr-release"/.test(CL) && /can\('release_territory'\)/.test(CL) && /DELETE', `\/api\/clans\/territory\/\$\{q\}\/\$\{r\}`/.test(CL));
check('3d. new activity lines: boons, goals, honors, land given up', ['boon_bought', 'goal_met', 'honor_earned', 'territory_released'].every(k => CL.includes(`case '${k}':`)));
check('3e. the public profile lists honors', /honors\.items\.map\(h =>/.test(read('js/clan-profile.js')));
check('3f. Dev Tools: add to the treasury; scripts loaded', /ClanTreasury\.devAddTreasury\(1000\)/.test(IDX) && /js\/clan-treasury\.js\?v=/.test(IDX));
check('3g. Help explains treasury, boons, goals and honors', /treasury<\/b>/.test(read('js/help.js')) && /goals<\/b>/.test(read('js/help.js')) && /honors<\/b>/.test(read('js/help.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
