'use strict';
// Moments in the client (docs/PHASE_2_MOMENTS.md §2.4): the dialogue box
// (js/say.js), the card stack and the bell (js/moments.js), live events and
// the away report.
//   node verify/moments_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const S = read('js/say.js'), MJ = read('js/moments.js'), H = read('index.html'), C = read('css/window.css'), RT = read('js/realtime.js'), AR = read('js/away-report.js');

const w = { console, setTimeout, setInterval }; w.window = w; vm.createContext(w);
vm.runInContext(S, w); vm.runInContext(MJ, w);

console.log('1. The dialogue box (js/say.js)');
{
  const h = w.KWSay._html({ icon: '⛈️', speaker: 'Your crew <at> the Farmstead', title: 'A storm', text: 'Black clouds.', fallback: 'ride', note: 'If you do nothing: ride it out.',
    options: [{ key: 'shore', label: 'Shore up', hint: '40 timber' }, { key: 'ride', label: 'Ride it out', hint: 'lose 10%' }, { key: 'c', label: 'C', hint: 'h' }, { key: 'd', label: 'D', hint: 'h' }] });
  check('1a. a portrait, the speaker (escaped) and the title', /kws-portrait" aria-hidden="true">⛈️/.test(h) && /Your crew &lt;at&gt; the Farmstead/.test(h) && /id="kws-title">A storm/.test(h));
  check('1b. options carry their hints; the default is marked', /Shore up<\/span>\s*<span class="kws-opt-h">40 timber/.test(h) && /Ride it out <span class="kws-default">default/.test(h));
  check('1c. three options at most', (h.match(/class="kws-opt"/g) || []).length === 3);
  check('1d. what happens if you do nothing; an outcome area announced politely', /kws-note">If you do nothing/.test(h) && /kws-outcome" role="status" aria-live="polite" hidden/.test(h));
  check('1e. one close button labelled Close', (h.match(/aria-label="Close"/g) || []).length === 1);
  check('1f. the outcome replaces the options for a few seconds, then it folds away', /\.kws-opts'\)\.hidden = true/.test(S) && /OUTCOME_MS/.test(S) && /setTimeout\(\(\) => \{ if \(current && current\.el === el\) close\(key\)/.test(S));
  check('1g. an error keeps it open with the options back', /res && res\.error/.test(S) && /x\.disabled = false/.test(S));
  check('1h. above the map, below windows; a bottom sheet on phones', /\.kws-layer \{[^}]*z-index: var\(--z-say\)/.test(C) && /\.kws \{ width: 100%; border-radius: var\(--kw-radius-l\) var\(--kw-radius-l\) 0 0/.test(C));
  check('1i. Escape closes it, unless a window or confirm is on top', /e\.key === 'Escape'/.test(S) && /KWWindow\.isOpen\(\)/.test(S) && /KWDialog\.isOpen\(\)/.test(S));
}

console.log('2. The card stack and the bell (js/moments.js)');
{
  const soon = new Date(Date.now() + 3 * 3600e3 + 60e3).toISOString();
  const list = [1, 2, 3, 4, 5].map(i => ({ id: i, icon: '🌻', title: 'Moment <' + i + '>', expires_at: soon }));
  const st = w.KWMoments._stackHtml(list);
  check('2a. a card per moment (titles escaped), with the time left', /data-kwm="1"/.test(st) && /Moment &lt;1&gt;/.test(st) && /3 h left/.test(st));
  check('2b. four cards at most, then "+N more"', (st.match(/class="kwm-card"/g) || []).length === 4 && /\+1 more/.test(st));
  check('2c. nothing when nothing waits', w.KWMoments._stackHtml([]) === '' && w.KWMoments._bellHtml([]) === '');
  const NJ = fs.readFileSync(path.join(ROOT, 'js/news.js'), 'utf8');
  check('2d. the bell lists them on top (the News window: waiting first, then the feed)', /Waiting for you/.test(w.KWMoments._bellHtml(list)) && NJ.indexOf('kwn-waiting') < NJ.indexOf('kwn-feed" role="list"') && /KWNews\.refresh\(\)/.test(MJ));
  const so = w.KWMoments._sayOptions({ icon: '🌻', speaker: null, title: 'A bumper crop', text: 't', fallback: 'gather', expires_at: soon, options: [{ key: 'gather', label: 'Gather it in', hint: '~80 food' }] });
  check('2e. the box says who speaks (or "Your town") and what the default will be', so.speaker === 'Your town' && /If you don't decide \(3 h left\): gather it in\./.test(so.note));
  check('2f. answering posts the choice; a vanished moment leaves the stack', /\/api\/moments\/\$\{m\.id\}`, \{ method: 'POST'/.test(MJ) && /res\.status === 404/.test(MJ));
  check('2g. one click listener for cards and bell rows (no inline handlers)', /closest\('\[data-kwm\]'\)/.test(MJ) && !/onclick=/.test(MJ));
  check('2h. the stack steps aside for windows, overlays and the dialogue box', /body\.kww-open #kw-moments, body\.kw-overlay #kw-moments, body\.kws-open #kw-moments \{ display: none; \}/.test(C) && /classList\.add\('kws-open'\)/.test(S));
  check('2i. on phones it sits above the tab bar', /#kw-moments \{ top: auto; bottom: calc\(76px/.test(C));
}

console.log('3. Live events, the away report, the page');
{
  check('3a. live: a new moment adds a card; a default taken while watching removes it with a toast', /moment\(ev\) \{ if \(global\.KWMoments\)/.test(RT) && /moment_resolved\(ev\)/.test(RT) && /Decided for you/.test(MJ));
  check('3b. the away report opens the moments from "waiting"', /go\.dataset\.action === 'moments' && root\.KWMoments\) root\.KWMoments\.openFirst\(\)/.test(AR));
  check('3c. both scripts are on the page', /\/js\/say\.js\?v=/.test(H) && /\/js\/moments\.js\?v=/.test(H));
  check('3d. the outpost window shows each option\'s cost and the default', /x\.hint \? ` <span class="kwop-muted">· \$\{esc\(x\.hint\)\}/.test(read('js/outposts.js')) && /\(default\)/.test(read('js/outposts.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
