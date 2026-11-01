'use strict';
// Letters between players (js/mail.js).
//   node verify/mail_proofs.js
//   1. Inbox and Sent lists; unread letters stand out; the badge follows.
//   2. Reading a letter: Reply, Delete, Report (reasons, private), Block (two taps).
//   3. Writing: a profile pre-fills who it's for; replies carry "Re:".
//   4. Wiring: the Messages button, realtime, the profile button, phone layout.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

// A tiny DOM: elements by id, classList, attributes.
function makeEnv(api) {
  const els = {};
  const mk = id => ({ id, innerHTML: '', textContent: '', value: '', dataset: {}, _a: {}, className: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k]; }, addEventListener() {}, focus() {} });
  els['nav-messages'] = mk('nav-messages');
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => { const e = mk(null); return new Proxy(e, { set(t, k, v) { t[k] = v; if (k === 'id') els[v] = t; if (k === 'innerHTML' && /id="mail-body"/.test(v)) els['mail-body'] = els['mail-body'] || mk('mail-body'); return true; } }); },
    body: { appendChild: c => c },
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
  };
  const toasts = [];
  const w = { console, Date, Math, JSON, Number, String, setInterval: () => 1, clearInterval() {}, document: doc,
    showBuildToast: (m, t) => toasts.push([m, t]), apiFetch: api };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/mail.js'), w);
  return { w, els, toasts };
}
const L = (o) => Object.assign({ id: 1, subject: 'Hello', body: 'Fancy some copper?', removed: false, created_at: new Date().toISOString(), read: false,
  from: { id: 7, username: 'Bram' }, to: { id: 9, username: 'Me' }, mine: false }, o || {});
const okJson = d => async () => ({ ok: true, json: async () => d });

(async () => {
  console.log('1. Lists and the badge');
  const inbox = [L(), L({ id: 2, subject: 'Old news', read: true }), L({ id: 3, removed: true })];
  const E = makeEnv(okJson({ ok: true, letters: inbox, unread: 1 }));
  await E.w.KWMail.open('inbox');
  const body = () => E.els['mail-body'].innerHTML;
  check('1a. the inbox lists letters, unread ones marked', /mail-row unread" data-mail="read" data-id="1"/.test(body()) && /data-id="2"/.test(body()) && !/mail-row unread" data-mail="read" data-id="2"/.test(body()));
  check('1b. a removed letter says so', /Removed by a moderator/.test(body()));
  check('1c. the Messages button gets a dot and a readable label', E.els['nav-messages'].classList.contains('has-dot') && /1 unread/.test(E.els['nav-messages'].getAttribute('aria-label')));
  const E0 = makeEnv(okJson({ ok: true, letters: [], unread: 0 }));
  await E0.w.KWMail.open('sent');
  check('1d. an empty Sent box says so', /haven't sent any letters/.test(E0.els['mail-body'].innerHTML) && !E0.els['nav-messages'].classList.contains('has-dot'));

  console.log('2. Reading a letter');
  const st = E.w.KWMail._state();
  st.letter = st.letters[0]; E.w.KWMail._render();
  let h = body();
  check('2a. from whom, the text, and the actions', /From Bram/.test(h) && /Fancy some copper\?/.test(h) && /data-mail="reply"/.test(h) && /data-mail="delete"/.test(h) && /data-mail="report-open"/.test(h) && /data-mail="block-ask"/.test(h));
  st.reporting = true; E.w.KWMail._render(); h = body();
  check('2b. reporting: four reasons, a note, private to the moderators', (h.match(/name="mail-reason"/g) || []).length === 4 && /mail-report-note/.test(h) && /won't know who sent it/.test(h) && /data-mail="report-send"/.test(h));
  st.reporting = false; st.confirmBlock = true; E.w.KWMail._render();
  check('2c. blocking takes a second tap (no browser pop-up)', /Tap again to block Bram/.test(body()) && /data-mail="block"/.test(body()) && !/confirm\(/.test(read('js/mail.js')));
  st.confirmBlock = false; st.letter = L({ removed: true }); E.w.KWMail._render(); h = body();
  check('2d. a removed letter: no text, no reply/report', /removed by a moderator/.test(h) && !/Fancy/.test(h) && !/data-mail="reply"/.test(h) && !/report-open/.test(h));
  st.letter = L({ mine: true }); E.w.KWMail._render(); h = body();
  check('2e. your own sent letter: no report or block', /To Me/.test(h) && !/report-open/.test(h) && !/block-ask/.test(h));

  console.log('3. Writing');
  E.w.KWMail.compose('Bram');
  h = body();
  check('3a. a profile opens a letter already addressed', /id="mail-f-to" data-draft="to" value="Bram"/.test(h) && /maxlength="2000"/.test(h) && /data-mail="send"/.test(h));
  check('3b. replies keep the thread with "Re:"', /compose\(l\.from\.username, \/\^re:\/i\.test/.test(read('js/mail.js')));
  check('3c. names in letters are escaped', (() => { st.letter = L({ subject: '<img src=x onerror=alert(1)>' }); E.w.KWMail._render(); return !/<img src=x/.test(body()) && /&lt;img/.test(body()); })());

  console.log('4. Wiring');
  const html = read('index.html');
  check('4a. mail.js and mail.css load; Messages has an id for its badge', /src="\/js\/mail\.js\?v=\w+"/.test(html) && /href="\/css\/mail\.css\?v=\w+"/.test(html) && /id="nav-messages" onclick="showCommunityTab\('messages'\)"/.test(html));
  const main = read('js/main.js');
  check('4b. Messages opens the letters; the badge starts with the game', /tab === 'messages' && window\.KWMail\) \{ KWMail\.open\(\); return; \}/.test(main) && /KWMail\.start\(\)/.test(main));
  check('4c. a realtime "mail" event lights the badge', /mail\(ev\) \{ if \(global\.KWMail\) global\.KWMail\.onEvent\(ev\); \}/.test(read('js/realtime.js')));
  check('4d. a player\'s profile has "Send a letter"', /id="vp-mail-btn"/.test(html) && /KWMail\.compose\(username\)/.test(read('js/profile.js')));
  check('4f. moderators see reported letters labelled as private letters', /if \(c\.kind === 'mail'\) return '✉ A private letter';/.test(read('js/chat-hub.js')));
  check('4e. a full-screen sheet on phones', /@media \(max-width: 768px\), \(max-height: 560px\) and \(pointer: coarse\)[\s\S]*\.mail-card \{ width: 100%/.test(read('css/mail.css')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
