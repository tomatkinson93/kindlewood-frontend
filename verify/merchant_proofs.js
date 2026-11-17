'use strict';
// A visiting merchant (docs/HOME_SCENE.md Part F, F.13, step 25;
// js/merchant.js). The server decides when they come, what they offer and
// what has been taken (lib/merchant.js there).
//   node verify/merchant_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/merchant.js'), CSS = read('css/home-scene.css'), CR = read('js/crier.js'), RT = read('js/realtime.js'), SE = read('js/session.js'), LA = read('js/life-admin.js'), DT = read('js/dev-tools.js'), H = read('index.html');

const w = { console, Date, Math, JSON, Number, String, Array, Object, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWMerchant;

console.log('1. The server decides');
{
  check('1a. whether the merchant is here and what they offer are read from the server', /apiFetch\('\/api\/merchant'\)/.test(J) && /if \(d && d\.ok && d\.merchant\) take\(d\.merchant\);/.test(J));
  check('1b. a trade is sent, and the cart is redrawn from the answer', /apiFetch\('\/api\/merchant\/take', \{ method: 'POST'/.test(J) && /take\(d\.merchant\);/.test(J));
  check('1c. no stock is changed here: resources are read again from the server', /await global\.refreshResources\(\)/.test(J) && !/resources\[[^\]]+\] [-+]=/.test(J));
  check('1d. a refusal is shown and the cart is read again', /toast\('⚠️ ' \+ \(d\.error \|\| 'That did not work\. Try again\.'\)\); load\(\);/.test(J));
  check('1e. one trade at a time', /if \(S\.busy\) return;\n    S\.busy = true;/.test(J));
  check('1f. another device\'s trade arrives live, and coming back to the tab asks again', /merchant\(ev\) \{ if \(global\.KWMerchant\) global\.KWMerchant\.onEvent\(ev\); \}/.test(RT) && /global\.KWMerchant\.load\(\)/.test(SE));
  check('1g. when the day turns it asks again (the cart leaves, or arrives)', /const t = d\.here \? d\.leaves_at : d\.next_at; if \(t && Date\.now\(\) > t\) load\(\);/.test(J));
}

console.log('2. The trades');
{
  const d = { here: true, trades: [
    { idx: 0, give: { timber: 40 }, get: { wealth: 35 }, line: 'Give 40 timber, get 35 wealth.', taken: true },
    { idx: 1, give: { wealth: 30 }, get: { metal: 20 }, line: 'Give 30 wealth, get 20 iron.', taken: false },
    { idx: 2, give: { food: 100 }, get: { timber: 50 }, line: 'Give 100 food, get 50 timber.', taken: false },
  ] };
  const html = K._tradesHtml(d, { wealth: 500, food: 20 });
  check('2a. amounts in plain words with their icons (iron, not metal)', K._amount({ metal: 20 }) === '⛓️ 20 iron' && K._amount({ stone: 30, timber: 10 }) === '🪨 30 stone + 🪵 10 timber');
  check('2b. each trade shows what is given and what comes back', (html.match(/You give/g) || []).length === 3 && (html.match(/You get/g) || []).length === 3);
  check('2c. a trade already made is marked done and cannot be pressed', /kwm-taken[\s\S]*?data-idx="0" disabled[^>]*>✓ Done</.test(html));
  check('2d. one that cannot be afforded says what is short', /data-idx="2" disabled[^>]*>Not enough food</.test(html));
  check('2e. one that can be made has a Trade button', /data-idx="1" aria-label="Give 30 wealth, get 20 iron\.">Trade</.test(html));
  check('2f. the merchant away: nothing to trade', /not in town/.test(K._tradesHtml({ here: false, trades: [] }, {})) && /not in town/.test(K._tradesHtml(null, {})));
  check('2g. every trade made: it says so', /You have made every trade/.test(K._tradesHtml({ here: true, trades: [{ idx: 0, give: { food: 5 }, get: { wealth: 5 }, line: '', taken: true }] }, {})));
  check('2h. when they next come, in words', K._nextLine(30 * 60000) === 'The merchant comes within the hour.' && K._nextLine(5 * 3600000) === 'The merchant comes in about 5 hours.' && K._nextLine(26 * 3600000) === 'The merchant comes in about 1 day.' && K._nextLine(70 * 3600000) === 'The merchant comes in about 3 days.');
}

console.log('3. The cart');
{
  check('3a. only in Town, and only while the merchant is here', /homeOpen\(\) && area === 'town' \? view\.querySelector\('#sv-layer-fg-town'\) : null/.test(J) && /if \(!d \|\| !d\.here \|\| !L/.test(J));
  let n = 0;
  check('3b. it stands on the first of its spots that nothing stands on', K._spotFor(p => ++n <= 2) === K.SPOTS[2] && K._spotFor(() => false) === K.SPOTS[0] && K._spotFor(() => true) === K.SPOTS[0]);
  check('3c. a real button with a name; its badge counts the trades left', /b\.type = 'button'/.test(J) && /aria-label/.test(J) && /b\.textContent = left \? String\(left\) : '✓'/.test(J));
  check('3d. drawn by code until a picture named merchant_cart arrives', /<svg /.test(K.CART.html) && K.CART.w > 0 && /manifest\.props\.merchant_cart/.test(J));
  check('3e. it sorts by depth like everything that stands', /z-index:\$\{Math\.max\(1, Math\.round\(p\.y \* 10\)\)\}/.test(J));
  check('3f. Build mode and photo mode do not open it', /\.sv-build-mode \.kwm-cart \{ pointer-events: none;/.test(CSS) && /body\.kw-photo #settlement-view \.kwm-cart \{ pointer-events: none; \}/.test(CSS));
  check('3g. the badge\'s bob is transform only, and still under reduced motion', /@keyframes kwm-bob \{[^\n]*transform/.test(CSS) && /prefers-reduced-motion: reduce\) \{ #settlement-view \.kwm-badge \{ animation: none; \} \}/.test(CSS));
}

console.log('4. Around it');
{
  check('4a. the crier\'s news says the merchant is here, or when they come', /if \(o\.merchant\) today\.push\(\{ icon: '🛒', text: o\.merchant \}\);/.test(CR) && /global\.KWMerchant\.line\(\)/.test(CR));
  check('4b. Dev Tools can call the merchant today, and send them away', /data-kwld="me-call" data-on="1"/.test(LA) && /merchant\('\/admin\/call', \{ on:/.test(LA) && /life-admin\.js\?v=\d+/.test(DT));
  check('4c. the script is on the page', /\/js\/merchant\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
