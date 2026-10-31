'use strict';
// Tavern winnings come from the server (js/tavern.js), and feedback
// management is admin-only (js/feedback.js).
//   node verify/tavern_proofs.js
//   1. The browser never asks for gold or reports a win itself.
//   2. Solo games: a ticket at the start, handed back with the result.
//   3. Multiplayer: the server's 'payout' event updates the purse.
//   4. Feedback: players see their own reports, without Resolve/Delete.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const TAV = read('js/tavern.js');
const take = start => { const i = TAV.indexOf(start); if (i < 0) throw new Error('missing ' + start); return TAV.slice(i, TAV.indexOf('\n}', i) + 2); };

(async () => {
  console.log('1. No client-side gold');
  const all = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n');
  check('1a. nothing calls /api/game/award-gold or /api/stats/record', !/award-gold|stats\/record/.test(all));
  check('1b. the old helpers are gone', !/_awardGold|_bcRecordResult/.test(TAV));

  console.log('2. Solo tickets');
  check('2a. every solo game starts with a ticket (Briar ×2, Squirrel)',
    /ticket: _tvSoloStart\('briar'\)/.test(TAV) && (TAV.match(/_tvSoloStart\('briar'\)/g) || []).length === 2 && /ticket: _tvSoloStart\('squirrel'\)/.test(TAV));
  check('2b. …and hands it back: a win, a loss, or leaving early',
    /_tvSoloFinish\(_bcmp\.ticket, won\)/.test(TAV) && /_tvSoloFinish\(_bcmp\.ticket, false\)/.test(TAV) && /_tvSoloFinish\(_sq\.ticket, mineWon\)/.test(TAV)
    && /_tvSoloFinish\(session\.ticket, true\)/.test(TAV) && /_tvSoloFinish\(session\.ticket, false\)/.test(TAV));
  const posts = [], toasts = [];
  const w = {
    console, JSON, Number, Math,
    gameData: { settlement: { resources: { wealth: 100 } } },
    updateTopbarDisplay: () => {},
    showToastNotification: m => toasts.push(m),
    apiFetch: async (p, o) => {
      posts.push([p, JSON.parse(o.body)]);
      if (p.endsWith('solo-start')) return { ok: true, json: async () => ({ ticket: 'abc' }) };
      const won = JSON.parse(o.body).won;
      return { ok: true, json: async () => ({ ok: true, won, paid: won ? 4 : 0, capped: false, wealth: won ? 104 : 100 }) };
    },
  };
  w.window = w; vm.createContext(w);
  vm.runInContext([take('function _tvSoloStart('), take('async function _tvSoloFinish('), take('function _tvShowPayout('), take('function _tvToast('),
    'this.start = _tvSoloStart; this.finish = _tvSoloFinish; this.show = _tvShowPayout;'].join('\n'), w);
  const t = w.start('briar');
  const out = await w.finish(t, true);
  check('2c. the ticket goes back with the result; the purse shows what the server paid',
    posts[0][0] === '/api/game/tavern/solo-start' && posts[0][1].game === 'briar' && posts[1][0] === '/api/game/tavern/solo-finish'
    && posts[1][1].ticket === 'abc' && posts[1][1].won === true && out.paid === 4 && w.gameData.settlement.resources.wealth === 104);
  w.apiFetch = async () => ({ ok: true, json: async () => ({ ok: true, won: true, paid: 0, capped: true, wealth: 104 }) });
  await w.finish(Promise.resolve('def'), true);
  check('2d. past the daily cap: a toast says so, no gold added', w.gameData.settlement.resources.wealth === 104 && /No more tavern winnings today/.test(toasts[0] || ''));
  w.apiFetch = async () => ({ ok: false, json: async () => ({ error: 'That game was too quick to count.' }) });
  await w.finish(Promise.resolve('ghi'), true);
  check('2e. a refused win says why', /too quick/.test(toasts[1] || '') && w.gameData.settlement.resources.wealth === 104);
  check('2f. no ticket (offline): nothing is sent', (await w.finish(Promise.resolve(null), true)) === null);

  console.log('3. Multiplayer');
  check('3a. Briar and Squirrel tables pass the server\'s payout to the purse',
    (TAV.match(/if \(msg\.type === 'payout'\) \{ _tvShowPayout\(msg\.paid, msg\.capped\); return; \}/g) || []).length === 2);
  w.show(4, false);
  check('3b. a payout without a total adds what was paid', w.gameData.settlement.resources.wealth === 108);

  console.log('4. Feedback');
  const fb = read('js/feedback.js');
  const fw = { console, Date, _fbEsc: s => String(s) }; vm.createContext(fw);
  const fbTake = start => { const i = fb.indexOf(start); return fb.slice(i, fb.indexOf('\n}', i) + 2); };
  vm.runInContext(fbTake('function _fbCard(') + '; this.card = _fbCard;', fw);
  const row = { id: 3, title: 'Bug', created_at: '2026-10-29T10:00:00Z', status: 'open', reporter_name: 'me' };
  check('4a. players: their report and its status, no Resolve/Delete', !/_fbToggle|_fbDelete/.test(fw.card(row, false)) && /Open/.test(fw.card(row, false)));
  check('4b. admins: Resolve and Delete', /_fbToggle\(3,'resolved'\)/.test(fw.card(row, true)) && /_fbDelete\(3\)/.test(fw.card(row, true)));
  check('4c. the list passes the server\'s admin flag', /rows\.map\(r => _fbCard\(r, !!d\.admin\)\)/.test(fb));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
