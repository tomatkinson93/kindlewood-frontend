'use strict';
// Talk to… and Praise (docs/HOME_SCENE.md Part F, step 18; js/social.js,
// js/villager-engine.js). The roll and the daily limits are the server's
// (kindlewood-server scripts/social_test.js); these are the screen's rules.
//   node verify/social_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const SJ = read('js/social.js'), E = read('js/villager-engine.js'), CSS = read('css/home-scene.css'), H = read('index.html');

const w = { console, Date, Promise, JSON, Math, Number, String, Array, Object }; w.window = w; vm.createContext(w);
vm.runInContext(SJ, w);
const K = w.KWSocial;
const e = { console, Math, Map, Set, JSON, Number, String, Array, Object, Infinity, setTimeout, document: { addEventListener() {}, querySelector: () => null }, addEventListener() {} };
e.window = e; vm.createContext(e); vm.runInContext(E, e);
const C = e.KWCast;

const DAY = { resets_at: 5000, talked: [1], praised: [2], praise_left: 2, praise_per_day: 3, known: {}, chats_today: [], topics: [] };

console.log('1. The buttons');
{
  const keys = (c, s) => C._menuItems(c, s).map(i => i.key).join();
  const fresh = { talked: false, praised: false, praiseLeft: 3, ready: true };
  check('1a. Talk to… and Praise join the menu after Inspect, for grown-ups, youths and children',
    keys({ stage: 'adult' }, fresh) === 'inspect,talk,praise,family,work,house' && keys({ stage: 'child' }, fresh) === 'inspect,talk,praise,family,house' && keys({ stage: 'youth' }, fresh) === 'inspect,talk,praise,family,apprentice,house');
  check('1b. without the day\'s state (the script did not load) the menu is as it was', keys({ stage: 'adult' }) === 'inspect,family,work,house');
  const item = (s, k) => C._menuItems({ stage: 'adult' }, s).find(i => i.key === k);
  check('1c. Praise says how many are left', item(fresh, 'praise').label === 'Praise (3)' && !item(fresh, 'praise').off && !item(fresh, 'talk').off);
  check('1d. used today: greyed, and it says so', item({ ...fresh, talked: true }, 'talk').off && item({ ...fresh, talked: true }, 'talk').label === 'Chatted today'
    && item({ ...fresh, praised: true }, 'praise').off && item({ ...fresh, praised: true }, 'praise').label === 'Praised today');
  check('1e. none left for the town: Praise is greyed for everyone', item({ ...fresh, praiseLeft: 0 }, 'praise').off && item({ ...fresh, praiseLeft: 0 }, 'praise').label === 'No praise left');
  check('1f. a greyed button says why and when it comes back, and the menu stays open',
    /aria-disabled="true"/.test(E) && /if \(b\.getAttribute\('aria-disabled'\) === 'true'\) \{[\s\S]{0,260}KWSocial\.why\(/.test(E) && /\.kwv-rb\.kwv-rb-off \{/.test(CSS));
  const six = C._arc(6, { sx: 500, viewW: 1000 }), four = C._arc(4, { sx: 500, viewW: 1000 });
  const gap = p => Math.min(...p.slice(1).map((q, i) => Math.hypot(q.x - p[i].x, q.y - p[i].y)));
  check('1g. six buttons take a wider, larger arc: at least 70 px apart, still centred', gap(six) >= 70 && Math.abs(six.reduce((a, q) => a + q.x, 0)) < 6 && gap(four) >= 70, `six ${Math.round(gap(six))} px, four ${Math.round(gap(four))} px`);
  const left = C._arc(6, { sx: 40, viewW: 390 }), right = C._arc(6, { sx: 350, viewW: 390 });
  check('1h. near an edge the six turn inward and stay on a phone\'s screen', left.every(q => 40 + q.x >= 24) && right.every(q => 350 + q.x <= 390 - 24) && gap(left) >= 56,
    `left min x ${Math.min(...left.map(q => 40 + q.x))}, gap ${Math.round(gap(left))}`);
  check('1i. Praise opens no window: they carry on; Talk to… holds them while its window is open',
    /if \(key === 'praise'\) \{ deselect\(true\); if \(global\.KWSocial\) global\.KWSocial\.praise\(id\); return; \}/.test(E) && /W\.isOpen\('talk'\)\) return \{ kww: 'talk' \}/.test(E));
}

console.log('2. The day');
{
  const m = K._menuState(DAY, 1, 1000);
  check('2a. who has had their chat, who has been praised, and how much praise is left come from the server', m.talked && !m.praised && m.praiseLeft === 2 && K._menuState(DAY, 2, 1000).praised && !K._menuState(DAY, 3, 1000).talked);
  const next = K._menuState(DAY, 1, 5000);
  check('2b. past the reset (dawn) it is a new day, and the state is read again', !next.talked && next.praiseLeft === 3 && next.stale && /if \(!m\.ready \|\| m\.stale\) load\(true\);/.test(SJ));
  check('2c. before it has loaded nothing is promised', K._menuState(null, 1, 0).ready === false);
  check('2d. when it comes back, in words', K._untilLine(30000) === 'in a moment' && K._untilLine(12 * 60000) === 'in 12 min' && K._untilLine(200 * 60000) === 'in 3 h 20 min' && K._untilLine(120 * 60000) === 'in 2 h');
  check('2e. nothing is counted here: both go to the server, and its refusal is shown',
    /send\('\/talk', \{ speaker_id:/.test(SJ) && /send\('\/praise', \{ citizen_id:/.test(SJ) && /d\.error \|\| 'That did not work/.test(SJ) && !/localStorage\.setItem/.test(SJ));
  check('2f. another device\'s chat or praise arrives on the live stream and the day is read again', /social\(ev\) \{ if \(global\.KWSocial\) global\.KWSocial\.onEvent\(ev\); \}/.test(read('js/realtime.js')) && /onEvent\(\) \{ load\(true\); \}/.test(SJ));
}

console.log('3. Who, and what about');
{
  const cits = [{ id: 1, name: 'Poppy Oak', partner_id: 4, parent_ids: [] }, { id: 2, name: 'Hazel Elm', parent_ids: [1, 4] }, { id: 3, name: 'Ash Fern' }, { id: 4, name: 'Bram Oak' },
    { id: 5, name: 'Gone', life_stage: 'deceased' }, { id: 6, name: 'Away' }, { id: 7, name: 'Kit Elm', parent_ids: [4, 9] }];
  const list = K._people(cits, 1, { 3: { score: 42, state: 'friends' }, 4: { score: 95, state: 'partners' } }, c => (c.id === 6 ? {} : null));
  check('3a. everyone living and in town but themselves, the closest first', list.map(p => p.c.id).join() === '4,3,2,7');
  check('3b. their partner and their family are marked', list[0].partner && !list[0].kin && list.find(p => p.c.id === 2).kin && !list.find(p => p.c.id === 3).kin);
  check('3c. family: parent and child, or sharing a parent', K._kin(cits[1], cits[0]) && K._kin(cits[1], cits[6]) && !K._kin(cits[0], cits[3]) && !K._kin(cits[2], cits[0]));
  const known = { 1: { likes: ['fishing'], dull: 'gossip', fine: ['stars'] }, 2: { likes: ['fishing', 'music'], dull: null, fine: ['stars'] } };
  const a = cits[0], b = cits[1];
  check('3d. a topic says what is known of the two', K._topicNote('fishing', a, b, known).text === '♥ Poppy, Hazel' && K._topicNote('fishing', a, b, known).tone === 'good'
    && K._topicNote('music', a, b, known).text === '♥ Hazel' && K._topicNote('gossip', a, b, known).tone === 'bad' && K._topicNote('gossip', a, b, known).text === '💤 Poppy');
  check('3e. tried and ordinary for both: "Neither minds"; never tried: nothing', K._topicNote('stars', a, b, known).text === 'Neither minds' && K._topicNote('herbs', a, b, known).text === '' && K._topicNote('herbs', a, b, {}).tone === '');
  check('3f. "Anything" comes first and sends no topic (the server picks)', /const list = \[ANY\]\.concat\(topics\(\)\)/.test(SJ) && /topic: el\.dataset\.topic === ANY\.key \? null : el\.dataset\.topic/.test(SJ));
  check('3g. the window is a KWWindow: who first, then what about, with a way back', /id: 'talk', icon: '💬', size: 'M'/.test(SJ) && /data-action="who"/.test(SJ) && /data-action="back"/.test(SJ) && /data-action="topic"/.test(SJ));
}

console.log('4. What a chat teaches, and how it is told');
{
  const people = [{ id: 1, name: 'Poppy Oak' }, { id: 2, name: 'Hazel Elm' }], label = k => ({ fishing: 'Fishing', gossip: 'Gossip' }[k] || k);
  const lines = K._learnedLines({ 1: { likes: [], dull: null } }, { 1: { likes: ['fishing'], dull: null }, 2: { likes: [], dull: 'fishing' } }, people, label);
  check('4a. interests are learned through chats: only what is new is told', lines.join(' ') === 'Poppy likes fishing. Hazel finds fishing dull.'
    && K._learnedLines({ 1: { likes: ['fishing'], dull: null } }, { 1: { likes: ['fishing'], dull: null } }, people, label).length === 0);
  const chat = { speaker: { name: 'Poppy Oak' }, listener: { name: 'Hazel Elm' }, topic: 'fishing', topic_label: 'Fishing', got_along: true, delta: 3, bond_state: 'friends' };
  check('4b. the line for a good chat', K._outcomeLine(chat) === 'Poppy and Hazel got along talking about fishing. Bond +3 (friends).');
  check('4c. and for a bad one', K._outcomeLine({ ...chat, got_along: false, delta: -2 }) === 'Poppy and Hazel did not get along talking about fishing. Bond −2.'
    && /Bond unchanged\./.test(K._outcomeLine({ ...chat, got_along: false, delta: 0 })));
  check('4d. how someone feels about a topic, or null before any chat touched it', K._feeling({ likes: ['a'], dull: 'b', fine: ['c'] }, 'a') === 'likes' && K._feeling({ likes: ['a'], dull: 'b', fine: ['c'] }, 'b') === 'dull'
    && K._feeling({ likes: ['a'], dull: 'b', fine: ['c'] }, 'c') === 'fine' && K._feeling({ likes: [] }, 'z') === null && K._feeling(undefined, 'a') === null);
  check('4e. the profile shows what is known, today\'s chats, and both buttons', /Likes to talk about/.test(SJ) && /of 3 likes found/.test(SJ) && /data-kws="talk"/.test(SJ) && /data-kws="praise"/.test(SJ)
    && /KWSocial\.profileHtml\(c\)/.test(read('js/citizens.js')));
}

console.log('5. In the scene');
{
  check('5a. the server has decided; the scene plays it: the speaker hurries over, the topic goes up, the listener answers',
    /function playTalk\(o, done\)/.test(E) && /v\.talk \? 1\.8 :/.test(E) && /setSay\(sp, t\.icon\)/.test(E) && /FELT\[t\.listenerFelt\]/.test(E) && C.TALK_MS >= 3000 && C.TALK_MS <= 5000);
  check('5b. a heart with the bond gained, or a storm cloud with the bond lost, floats up between them', /`💗\$\{n \? ' \+' \+ n : ''\}`/.test(E) && /`🌩️\$\{n \? ' −' \+ n : ''\}`/.test(E) && /\.kwv-float \{/.test(CSS) && /@keyframes kwv-float \{/.test(CSS));
  check('5c. the sign is above the night shade, and stays still under reduced motion', /\.kwv-float \{\s*position: absolute; z-index: 1500;/.test(CSS) && /prefers-reduced-motion: reduce\) \{\s*#settlement-view \.kwv-float \{ animation: kwv-float-still/.test(CSS));
  check('5d. a listener behind a building meets the speaker in the open; one indoors steps out', /they meet at the nearest spot in the open/.test(E) && /if \(x\.state === 'indoors'\) comeOut\(x, now\);/.test(E));
  check('5e. a listener elsewhere: the speaker says it where they stand', /a\.state = 'solo'/.test(E) && /if \(v\.state === 'solo'\)/.test(E));
  check('5f. cut short (someone picked, a moment, the scene closed) the result is still shown once, then told in words',
    /if \(v\.talk\) talkResult\(v\.talk\);/.test(E) && /if \(t\.shown\) return;/.test(E) && /if \(v\.talk\) endChat\(v, now\);/.test(E) && /const playing = !!\(C && C\.playTalk && C\.playTalk\(/.test(SJ) && /if \(!playing\) tell\(\);/.test(SJ));
  check('5g. praise: a happy bubble and "+2" over them', /function playPraise\(id, amount\)/.test(E) && /`👏 \+\$\{Number\(amount\) \|\| 2\}`/.test(E));
  check('5h. the script is on the page before the engine', H.indexOf('/js/social.js?v=') > 0 && H.indexOf('/js/social.js?v=') < H.indexOf('/js/villager-engine.js?v='));
}

console.log('6. The citizens list ("Choose a builder" and First steps lead here)');
{
  const CZ = read('js/citizens.js');
  const row = CZ.slice(CZ.indexOf('// Role cell — no dropdown'), CZ.indexOf("return '<tr class=\"ac-row"));
  check('6a. a row knows whether its citizen is away before it draws their job (it threw for every grown-up)', row.indexOf('const away = citizenAway(c);') >= 0 && row.indexOf('const away = citizenAway(c);') < row.indexOf(': away'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
