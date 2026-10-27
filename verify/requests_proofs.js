'use strict';
// Village request alerts (js/village-requests.js) and where they lead.
//   node verify/requests_proofs.js
//   1. Fresh requests toast once and refresh the bell; old ones stay quiet.
//   2. The diplomacy side panel line, with or without a Market.
//   3. "Fill in the Market" opens the Wanted tab filtered to the request.
//   4. Wiring: script tag, polling, bell icon, no double toast.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const REQS = [
  { npc: { id: 7, name: 'Burrowmere' }, kind: 'resource', resource: 'copper', item: null, qty: 120, remaining: 120, by: 'Friday', trust_bonus: 3,
    message: '📣 Burrowmere needs 120 copper by Friday — +3 trust.', fresh: true },
  { npc: { id: 9, name: 'Thistledown' }, kind: 'item', resource: null, item: { item_key: 'iron_pick', name: 'Iron Pick' }, qty: 3, remaining: 1, by: 'Sunday', trust_bonus: 3,
    message: '📣 Thistledown needs 3 Iron Pick by Sunday — +3 trust.', fresh: false },
];

function makeEnv(hasMarket) {
  const toasts = [], opened = [];
  let events = 0;
  const w = {
    console, setTimeout: fn => fn(), setInterval: () => 1, clearInterval() {},
    apiFetch: async () => ({ ok: true, json: async () => ({ ok: true, requests: REQS, has_market: hasMarket }) }),
    showToastNotification: (m, t) => toasts.push([m, t]),
    loadEvents: () => { events++; },
    openMarket: o => opened.push(o),
  };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(read('js/village-requests.js'), w);
  return { w, toasts, opened, events: () => events };
}

(async () => {
  console.log('1. Alerts');
  {
    const e = makeEnv(true);
    const fresh = await e.w.KWRequests.check();
    check('1a. only the fresh request toasts, with its message', e.toasts.length === 1 && e.toasts[0][0] === REQS[0].message && fresh.length === 1);
    check('1b. …and the bell refreshes to show it', e.events() === 1);
    e.w.apiFetch = async () => ({ ok: true, json: async () => ({ ok: true, requests: REQS.map(r => ({ ...r, fresh: false })), has_market: true }) });
    await e.w.KWRequests.check();
    check('1c. the next check (server says not fresh) stays quiet', e.toasts.length === 1 && e.events() === 1);
    e.w.apiFetch = async () => ({ ok: false, json: async () => ({}) });
    check('1d. a failed check is silent', (await e.w.KWRequests.check()).length === 0 && e.toasts.length === 1);
  }

  console.log('2. Diplomacy panel');
  {
    const e = makeEnv(true);
    await e.w.KWRequests.check();
    const h = e.w.KWRequests.panelHtml(7);
    check('2a. the village\'s request: what, by when, the trust', /📣 Needs <b>120 copper<\/b> by Friday — \+3 trust/.test(h) && /Fill in the Market/.test(h));
    const h2 = e.w.KWRequests.panelHtml(9);
    check('2b. items by name, and how many are left', /<b>3 Iron Pick<\/b>/.test(h2) && / · 1 left/.test(h2));
    check('2c. a village with no request: nothing', e.w.KWRequests.panelHtml(42) === '');
    const n = makeEnv(false);
    await n.w.KWRequests.check();
    const h3 = n.w.KWRequests.panelHtml(7);
    check('2d. without a Market: says to build one, no button', /Build a Market to fill it/.test(h3) && !/vr-fill/.test(h3));
    e.w.KWRequests._set([{ ...REQS[0], remaining: 0 }], true);
    check('2e. a filled request drops off the panel', e.w.KWRequests.panelHtml(7) === '');
  }

  console.log('3. Fill in the Market');
  {
    const e = makeEnv(true);
    await e.w.KWRequests.check();
    e.w.KWRequests.fill(7); e.w.KWRequests.fill(9);
    check('3a. resource → Wanted tab filtered to it; item → by item', JSON.stringify(e.opened) === JSON.stringify([{ wanted: { resource: 'copper' } }, { wanted: { itemKey: 'iron_pick', itemName: 'Iron Pick' } }]));
    const m = read('js/market.js');
    check('3b. the Market opens Wanted with its own filter (not the Buy one)', /opts\.wanted && opts\.wanted\.resource\) Object\.assign\(state, \{ tab: 'wanted', cat: 'resources', wantResource/.test(m)
      && /qs\.set\('resource', state\.wantResource \|\| 'resources'\)/.test(m));
    check('3c. …shown as a chip that clears it', /data-act="clear-want"/.test(m) && /act === 'clear-want'\) \{[^}]*state\.wantResource = ''/.test(m));
  }

  console.log('4. Wiring');
  {
    const html = read('index.html');
    check('4a. village-requests.js loads', /<script defer src="\/js\/village-requests\.js\?v=\w+"><\/script>/.test(html));
    check('4b. checks start with the game (every 10 minutes)', /KWRequests\.start\(\)/.test(read('js/main.js')) && /POLL_MS = 10 \* 60 \* 1000/.test(read('js/village-requests.js')));
    const ev = read('js/events.js');
    check('4c. the bell shows 📣, and doesn\'t toast it a second time', /village_request_new: '📣'/.test(ev) && /e\.type !== 'village_request_new'/.test(ev));
    check('4d. the diplomacy side panel includes the line', /KWRequests\.panelHtml\(npcId\)/.test(read('js/diplomacy.js')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
