'use strict';
// The login screen's "fresh test account" button (js/main.js; the server's
// lib/test_accounts.js makes it and deletes it on sign-out).
//   node verify/test_account_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const H = read('index.html'), M = read('js/main.js'), LA = read('js/life-admin.js'), CSS = read('css/main.css');

console.log('1. The button');
check('1a. it is on the login screen, hidden until the server says it is offered', /<div class="test-account" id="login-test" hidden>/.test(H) && /id="login-test-btn" onclick="startTestAccount\(\)"/.test(H) && /box\.hidden = !\(res\.ok && d\.available\)/.test(M));
check('1b. it says plainly that the account is deleted on sign-out', /It is deleted when you sign out\./.test(H));
check('1c. one press: the account is made by the server and signed in, with nothing to fill in', /apiFetch\('\/api\/auth\/test-account', \{ method: 'POST' \}\)/.test(M) && /setStoredToken\(data\.token\);/.test(M) && /setTimeout\(\(\) => loadGame\(true\), 400\)/.test(M));
check('1d. it stays signed in until the player signs out (being away does not delete it)', /KWSession\.remember\(true\);   \/\/ it lasts until you sign out/.test(M));
check('1e. the button cannot be pressed twice at once', /if \(btn\) btn\.disabled = true;/.test(M) && /finally \{ if \(btn\) btn\.disabled = false; \}/.test(M));

console.log('2. Signing out');
check('2d. signing out reloads the page, so nothing of the last player (their citizens, homes, tour) is left for the next; what there is to say is said on the fresh page', /location\.reload\(\); return;/.test(M) && /sessionStorage\.setItem\(SIGNED_OUT_NOTE, JSON\.stringify\(n\)\)/.test(M) && /if \(n\.login && !getStoredToken\(\)\) \{ showScreen\('login'\); showMsg\('login-success', n\.login\); \}/.test(M));
check('2a. signing out tells the server (which deletes a test account) and says so', /apiFetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)/.test(M) && /d\.test_account_deleted/.test(M) && /The test account was deleted\./.test(M));
check('2b. nothing is deleted from here: the server decides what a test account is', !/DELETE|\/delete/.test(M.slice(M.indexOf('async function startTestAccount'), M.indexOf('let _loadGameLock'))));

console.log('3. Dev Tools');
check('3a. an admin can turn the button off before real players arrive', /data-kwld="ta-switch"/.test(LA) && /\/api\/auth\/test-account' \+ \(body \? '\/switch' : ''\)/.test(LA) && /Turn it off before real players arrive\./.test(LA));
check('3b. it has room on the login form', /\.test-account \{ margin-top: 14px;/.test(CSS));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
