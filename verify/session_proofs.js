'use strict';
// "Keep me signed in" and pausing while nobody is there (js/session.js).
//   node verify/session_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const SJ = read('js/session.js'), H = read('index.html'), MJ = read('js/main.js');

const w = { console, Date, Promise, setInterval() { return 1; } }; w.window = w; vm.createContext(w);
vm.runInContext(SJ, w);
const K = w.KWSession, MIN = 60000;

console.log('1. Keep me signed in');
{
  check('1a. a tick box on the sign-in and register forms, ticked to begin with, with what unticking does',
    /id="login-keep" checked> Keep me signed in/.test(H) && /id="reg-keep" checked> Keep me signed in/.test(H) && /On a shared computer, untick this/.test(H));
  check('1b. the choice goes to the server (a shorter token) and to KWSession; signing out forgets it',
    /remember: _keepSignedIn\('login-keep'\)/.test(MJ) && /remember: _keepSignedIn\('reg-keep'\)/.test(MJ) && /KWSession\.remember\(_keepSignedIn\('login-keep'\)\)/.test(MJ) && /KWSession\.forget\(\)/.test(MJ));
  const now = 1e12;
  check('1c. ticked: never ended by this', K._ended({ only: false, alive: false, seen: 0, now }) === false);
  check('1d. unticked: ended when the browser was closed (its session cookie is gone)', K._ended({ only: true, alive: false, seen: now - MIN, now }) === true);
  check('1e. unticked: ended when the page was closed for more than 15 minutes; a reload within that carries on',
    K._ended({ only: true, alive: true, seen: now - 16 * MIN, now }) === true && K._ended({ only: true, alive: true, seen: now - 2 * MIN, now }) === false);
  check('1f. the page checks before anything reads the token', H.indexOf("localStorage.getItem('kw_session_only') === '1'") > 0
    && H.indexOf("localStorage.getItem('kw_session_only') === '1'") < H.indexOf("try { t = localStorage.getItem('kw_token'); }") && /localStorage\.removeItem\('kw_token'\); localStorage\.removeItem\('kw_session_only'\)/.test(H));
  check('1g. unticked: 15 minutes without input signs out, and says why', /if \(sessionOnly\(\)\) \{[\s\S]{0,200}global\.logout\(\)/.test(SJ) && /You were signed out after 15 minutes away/.test(SJ));
}

console.log('2. Paused while nobody is there');
{
  check('2a. away after 15 minutes without input', K.IDLE_MS === 15 * MIN && K._isAway(16 * MIN, 0) && !K._isAway(14 * MIN, 0));
  check('2b. while away every request to the API answers at once, unsent (status 499); anything else goes through',
    K._isApi('https://api.example/api/game/settlement') && K._isApi({ url: '/api/moments' }) && !K._isApi('/assets/x.png') && /status: 499/.test(SJ) && /if \(S\.away && isApi\(input\)\) return Promise\.resolve/.test(SJ));
  check('2c. a hidden tab closes its live stream; a showing one keeps it (the town can still be watched)', /if \(doc\.hidden\) closeStream\(\);/.test(SJ) && /if \(doc\.hidden\) \{ if \(S\.away\) closeStream\(\); \}/.test(SJ));
  check('2d. any input, or coming back to the tab, carries on: the stream reopens and the stores, moments and citizens are read again',
    /function input\(\) \{ S\.last = S\.now\(\); if \(S\.away\) comeBack\(\); \}/.test(SJ) && /else if \(S\.away\) input\(\);/.test(SJ) && /global\.restartRealtime\(\)/.test(SJ)
    && /global\.refreshResources\(\)/.test(SJ) && /global\.KWMoments\.load\(\)/.test(SJ) && /global\.loadCitizens\(\)/.test(SJ));
  check('2e. a pill says it is paused; the script is on the page before main.js', /Paused while you were away\. Move or tap to carry on\./.test(SJ) && /\.kw-away-pill \{/.test(read('css/main.css'))
    && H.indexOf('/js/session.js?v=') > 0 && H.indexOf('/js/session.js?v=') < H.indexOf('/js/main.js?v='));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
