'use strict';
// The guide's tour (docs/PHASE_3_ONBOARDING.md; js/guide.js, KWSay.tell in
// js/say.js). The server holds the tour and decides when a beat is done
// (lib/guide.js there); the screen shows it and points.
//   node verify/guide_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/guide.js'), SAY = read('js/say.js'), CSS = read('css/guide.css'), P = read('js/places.js'), FS = read('js/first-steps.js'), HELP = read('js/help.js'), H = read('index.html'), SE = read('js/session.js');

const w = { console, Date, Math, JSON, Number, String, Array, Object, Map, Promise, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(SAY, w); vm.runInContext(J, w);
const K = w.KWGuide, S = w.KWSay;

console.log('1. A character speaks');
{
  const html = S._tellHtml({ character: '/assets/images/guide/mice.webp', emoji: '🐭', speaker: 'Old Bramble', lines: ['One.', 'Two <b>.'], skip: 'Skip the tour', count: '1 of 14' }, 0);
  check('1a. the character stands at the lower left, with a box carrying their name, one line and an arrow', /class="kwst-char"/.test(html) && /class="kwst-img" src="\/assets\/images\/guide\/mice\.webp"/.test(html) && /id="kwst-name">Old Bramble/.test(html) && /id="kwst-text" aria-live="polite">One\.</.test(html) && /class="kwst-arrow"/.test(html));
  check('1b. one line at a time; text is never markup', /Two &lt;b&gt; \./.test(S._tellHtml({ speaker: 'x', lines: ['One.', 'Two <b> .'] }, 1)) && !/One\./.test(S._tellHtml({ speaker: 'x', lines: ['One.', 'Two.'] }, 1)));
  check('1c. the box is a named dialog that takes the keyboard; Enter, Space or the arrow key go on', /role="dialog" aria-modal="false" aria-labelledby="kwst-name" aria-describedby="kwst-text" tabindex="0"/.test(html) && /e\.key === 'Enter' \|\| e\.key === ' ' \|\| e\.key === 'ArrowRight'/.test(SAY));
  check('1d. "Skip the tour" is on every line', /data-kwst-skip>Skip the tour</.test(html) && /data-kwst-skip/.test(S._tellHtml({ speaker: 'x', lines: ['a', 'b'], skip: 'Skip the tour' }, 1)));
  check('1e. with no picture yet, the species\' emoji stands in', /img\.addEventListener\('error'/.test(SAY) && /<span class="kwst-emoji" hidden>🐭/.test(html) && /<span class="kwst-emoji">🐭/.test(S._tellHtml({ emoji: '🐭', speaker: 'x', lines: ['a'] }, 0)));
  check('1f. only the box and the character take clicks: the game behind stays usable', /\.kwst \{[^}]*pointer-events: none/.test(CSS) && /\.kwst-box \{[^}]*pointer-events: auto/.test(CSS));
  check('1h. the box is the game\'s aged parchment with brown ink in the game\'s typefaces, and the chip its dark wood and gold: none of the reference picture\'s blue', /\.kwst-box \{[^}]*color: var\(--kw-on-gold\);[^}]*radial-gradient\(circle at 20% 0%, #efe2c4, #e3d2ac 60%, #d3bd90\)/.test(CSS) && /\.kwst-name \{[^}]*var\(--kw-font-title\)/.test(CSS) && /\.kwst-text \{[^}]*var\(--kw-font-body\)/.test(CSS) && /#kwgd-chip \{[^}]*color: var\(--kw-cream\); border: 1px solid var\(--kw-gold-dim\)/.test(CSS) && !/16, 26, 46|160, 190, 235|220, 230, 250|system-ui/.test(CSS));
  check('1i. what was received is said under his line, from the line at which he hands it over: a receipt, not speech', /class="kwst-note" role="note">You received 240 timber\.</.test(S._tellHtml({ speaker: 'x', lines: ['a', 'b'], note: 'You received 240 timber.', noteFrom: 1 }, 1)) && !/kwst-note/.test(S._tellHtml({ speaker: 'x', lines: ['a', 'b'], note: 'You received 240 timber.', noteFrom: 1 }, 0)) && !/kwst-note/.test(S._tellHtml({ speaker: 'x', lines: ['a'] }, 0)) && /note: got \? `You received \$\{got\}\.` : '', noteFrom: b\.gift_at \|\| 0/.test(J) && /\.kwst-note \{/.test(CSS) && /if \(g\.state !== 'active'\) toast\(/.test(J));
  check('1j. while a character speaks the moment cards stay on the screen (he may be saying "press the card")', !/doc\.body\.classList\.add\('kws-open'\);\s*draw\(\);/.test(SAY) && /isTelling: \(\) => !!\(current && current\.story\)/.test(SAY));
  check('1g. the character is large (up to 62% of the screen\'s height), and stands above a full-width box on a phone', /\.kwst \{[^}]*height: min\(62vh, 560px\)/.test(CSS) && /@media \(max-width: 700px\) \{[\s\S]*\.kwst-box \{ position: relative; left: 0; bottom: 0; width: 100%/.test(CSS));
  check('1h. it sits above an open window, since the tour often speaks just after one opens', /\.kws-layer\.kws-story \{[^}]*z-index: calc\(var\(--z-window\) \+ 60\)/.test(CSS));
  check('1i. each elder\'s picture has one place: /assets/images/guide/<species>.webp', K._characterUrl('Mice') === '/assets/images/guide/mice.webp' && K._characterUrl('Foxes') === '/assets/images/guide/foxes.webp' && Object.keys(K.EMOJI).join() === 'Mice,Badgers,Otters,Moles,Foxes,Hares');
}

console.log('2. The server holds the tour');
{
  check('2a. the beat, its lines and what it waits for come from the server', /call\(''\)/.test(J) && /if \(d\.guide\) take\(d\.guide\);/.test(J) && /lines: b\.say/.test(J));
  check('2b. a beat with nothing to do is passed when its last line is read', /how === 'done' && !b\.until && S\.g && S\.g\.beat && S\.g\.beat\.key === b\.key\) await send\('\/advance', \{ key: b\.key \}\)/.test(J));
  const page = { selected: true, familiesWindow: false, area: 'town', place: 'home' };
  check('2c. the screen reports only what changes nothing: a villager pressed, a window opened, a walk, a place', K._clientDid('client:selected:villager', page) === 'selected:villager' && K._clientDid('client:opened:families', page) === null && K._clientDid('client:opened:families', { familiesWindow: true }) === 'opened:families'
    && K._clientDid('client:area:neighbourhood', { area: 'neighbourhood' }) === 'area:neighbourhood' && K._clientDid('client:place:families', { place: 'families' }) === 'place:families' && K._clientDid('homes:1', page) === null && K._clientDid('client:built:lumber_camp', page) === null);
  check('2d. everything else is asked of the server, which decides', /call\('\/check', \{\}\)/.test(J) && /if \(b\.client\) \{ const did = clientDid\(b\.until, page\(\)\); if \(did\) await send\('\/advance', \{ key: b\.key, did \}\); return; \}/.test(J));
  check('2e. gifts are announced from what the server says it gave; nothing is added here', /for \(const j of g\.just \|\| \[\]\) if \(j\.given && giftLine\(j\.given\)\)/.test(J) && K._giftLine({ timber: 240, stone: 120 }) === '240 timber and 120 stone' && K._giftLine({ metal: 5 }) === '5 iron' && K._giftLine({}) === '');
  check('2f. skipping asks first, says the gifts are kept, and is the server\'s to do', /title: 'Skip the tour\?'/.test(J) && /You keep everything the tour would have given you/.test(J) && /await send\('\/skip'\)/.test(J));
  check('2g. one request at a time', /if \(S\.busy\) return null;\n    S\.busy = true;/.test(J));
  check('2h. coming back to the tab asks again', /global\.KWGuide\.load\(\)/.test(SE));
}

console.log('3. Pointing');
{
  const T = K._targets, who = { a: 11, b: 22 };
  check('3a. a villager first, then their menu\'s button once the menu is open', T('villager-menu:family', { menu: false }, who).join() === 'villager:11,villager' && T('villager-menu:family', { menu: true }, who).join() === 'menu:family' && T('villager-menu:work', { menu: false }, who)[0] === 'villager:22');
  check('3b. Build, then a plot once Build mode is on, then the choice once the panel is open: the row of the building the beat wants, never another', T('tool:build', {}, who).join() === 'tool:build' && T('tool:build', { building: true }, who).join() === 'plot' && T('tool:build', { building: true, panel: true }, who).join() === 'panel:build,plot' && T('tool:build', { building: true, panel: true }, who, null, 'scout_post').join() === 'panel:type:scout_post' && T('plot:any', {}, who).join() === 'tool:build' && /`#sv-build-panel\.open \.sv-bp-build-btn\[onclick\*="'\$\{t\[1\]\}'"\]`/.test(J) && /wantOf = b => \{ const m = \/\^built:\(\[a-z_\]\+\)\$\//.test(J));
  check('3c. the Neighbourhood from Town; the way back to town from anywhere else', T('building:neighbourhood', { area: 'town' }).join() === 'building:neighbourhood' && T('building:neighbourhood', { area: 'outskirts' }).join() === 'signpost:town');
  check('3d. a home with a bed to spare, then Enter on its menu, then Move in once its window is open', T('house:any', {}).join() === 'house:free,house' && T('house:any', { bmenu: true }).join() === 'bmenu:enter' && T('house:any', { houseWindow: true }).join() === 'house:in' && T('house:any', { building: true }).join() === 'tool:build');
  check('3e. the Families place, The Land and the waiting moment each have their mark', T('place:families', {}).join() === 'place:families' && T('place:land', {}).join() === 'place:land' && T('moment:first', {}).join() === 'moment,villager:marked' && T('nothing', {}).length === 0);
  check('3f. every named target has something to look for', ['villager', 'menu:family', 'menu:work', 'building:neighbourhood', 'signpost:town', 'tool:build', 'plot', 'panel:build', 'house', 'house:in', 'place:families', 'place:land', 'place:home', 'land:dispatch', 'moment', 'villager:marked'].every(k => typeof K.SELECTOR[k] === 'string' && K.SELECTOR[k].length > 5));
  check('3g. behind an open window, the window\'s close button is ringed first', /if \(covered\) \{ const x = doc\.querySelector\('\.kww:last-of-type \.kww-close, \.kww \.kww-close'\)/.test(J));
  check('3h. the ring is at least 44 px, takes no clicks, and is still under reduced motion', /Math\.max\(44, r\.width \+ pad \* 2\)/.test(J) && /#kwgd-ring \{[^}]*pointer-events: none/.test(CSS) && /prefers-reduced-motion: reduce\) \{ #kwgd-ring \{ animation: none; \} \}/.test(CSS));
  check('3j. a villager being pointed at stands still, so they are easy to press', /global\.KWCast\.pause\(Number\(cid\), 5000\)/.test(J) && /pause: \(id, ms = 4000\) =>/.test(read('js/villager-engine.js')));
  check('3k. a beat that belongs in another part of Home leads there first: the way to town, or the Neighbourhood from Town', T('tool:build', { area: 'neighbourhood', building: true }, who, 'town').join() === 'tool:totown,signpost:town' && T('tool:build', { area: 'town' }, who, 'neighbourhood').join() === 'building:neighbourhood' && T('tool:build', { area: 'outskirts' }, who, 'neighbourhood').join() === 'tool:totown,signpost:town' && T('tool:build', { area: 'town' }, who, 'town').join() === 'tool:build' && /targets\(g\.beat\.point, page\(\), g\.beat\.who, g\.beat\.area, wantOf\(g\.beat\)\)/.test(J));
  check('3l. villagers hide while building, so Done is ringed first for anything that needs one', T('villager-menu:work', { building: true }, who).join() === 'tool:build' && T('villager:any', { building: true }, who).join() === 'tool:build' && T('moment:first', { building: true }).join() === 'tool:build');
  check('3m. once a villager\'s page is open the job chooser in it is ringed; for any other beat, its close button', T('villager-menu:work', { profile: true }, who).join() === 'modal:role,modal:close' && T('villager-menu:family', { profile: true }, who).join() === 'modal:close' && /'modal:role': '#citizen-profile-modal\.open \.cp-role-select'/.test(J));
  check('3n. something standing behind something else is passed over while anything else can be pressed', /if \(strict && doc\.elementFromPoint\)/.test(J) && /for \(const strict of \[true, false\]\)/.test(J));
  check('3o. building time: while something is being built and the elder\'s help is left, Finish now on the chip is ringed', T('tool:build', { building: true, finish: true }, who).join() === 'chip:finish' && T('plot:any', { finish: true, area: 'town' }, who, 'neighbourhood').join() === 'chip:finish' && T('tool:build', { building: true, finish: true, panel: true }, who)[0] === 'panel:build' && T('house:any', { finish: true }).join() === 'house:free,house' && /'chip:finish': '#kwgd-chip \[data-kwgd="finish"\]'/.test(J) && /addEventListener\('kw:build', \(\) =>/.test(J));
  check('3p. a job chosen in a villager\'s page is checked at once', /addEventListener\('change', e => \{ if \(S\.g && S\.g\.state === 'active' && e\.target && e\.target\.closest && e\.target\.closest\('\.cp-role-select'\)\) setTimeout\(tick, 700\); \}\)/.test(J));
  check('3i. what he says to press glows while he says it (not under a moment\'s own dialogue), and the rest is dimmed a little unless something is already laid over the game', /asking = Say && Say\.isOpen && Say\.isOpen\(\) && !\(Say\.isTelling && Say\.isTelling\(\)\)/.test(J) && /on = g && g\.state === 'active' && g\.beat && g\.beat\.point && gameShowing\(\) && !asking/.test(J) && /el\.classList\.toggle\('kwgd-dim', !overlayUp\(\)\)/.test(J) && /#kwgd-ring\.kwgd-dim::before \{[^}]*box-shadow: 0 0 0 200vmax rgba\(10, 6, 2, 0\.26\); pointer-events: none;/.test(CSS));
  check('3q. already in the Neighbourhood there is nothing left to point at (it flashed the way back to town); on The Land, Home comes first for anything on Home', T('building:neighbourhood', { area: 'neighbourhood' }).length === 0 && T('tool:build', { place: 'land', area: 'town' }, who, 'town').join() === 'place:home' && T('villager-menu:work', { place: 'families' }, who)[0] === 'villager:22');
  check('3r. The Land: the place, then a tile in the mist beside the town, then Dispatch once that tile\'s panel is up', T('land:fog', { place: 'home' }).join() === 'place:land' && T('land:fog', { place: 'land' }).join() === 'land:tile' && T('land:fog', { place: 'land', scoutPanel: true }).join() === 'land:dispatch,land:tile' && /if \(name === 'land:tile'\) return landTile\(\);/.test(J) && /K\.hexToScreen\(q, r\)/.test(J) && /if \(hit === canvas\) return rect;/.test(J));
  check('3s. the chip steps aside when it would sit on the thing to press', /chip\.classList\.toggle\('kwgd-away'\)/.test(J) && /#kwgd-chip\.kwgd-away \{ left: auto; right: 14px; \}/.test(CSS) && /body\.kw-shell #kwgd-chip\.kwgd-away \{[^}]*bottom: auto; top:/.test(CSS));
  check('3t. a press in the game is checked at once; while he speaks only a press moves the tour on, and his lines give way to the next beat\'s', /S\.clickT = setTimeout\(\(\) => tick\(true\), 450\)/.test(J) && /if \(S\.telling && pressed !== true\) return;/.test(J) && /if \(g\.beat\.key !== was\) \{ if \(S\.telling\) closeTell\(\); else speak\(\); \}/.test(J) && /if \(S\.g && S\.g\.state === 'active' && S\.g\.beat && S\.g\.beat\.key !== b\.key\) \{ S\.told = null; speak\(\); return; \}/.test(J));
}

console.log('4. While it waits');
{
  const g = { state: 'active', elder: { name: 'Old Bramble', species: 'Mice' }, beat: { key: 'first_home', n: 5, of: 14, hint: 'Build a home', until: 'homes:1', say: ['Press Build.'] }, finish: { left: 6, sites: [] } };
  const chip = K._chipHtml(g, 0);
  check('4a. the chip says who, what to do, and where in the tour', /<b>Old Bramble<\/b>/.test(chip) && /Build a home/.test(chip) && /aria-label="Step 5 of 14">5\/14/.test(chip));
  check('4b. "hear that again" and "Skip the tour" are always on it', /data-kwgd="again"/.test(chip) && /data-kwgd="skip">Skip the tour</.test(chip));
  check('4c. Finish now appears only while something is being built and the elder\'s help is left', !/data-kwgd="finish"/.test(chip) && /data-kwgd="finish" data-site="7"/.test(K._chipHtml({ ...g, finish: { left: 3, sites: [{ id: 7 }] } }, 0)) && !/data-kwgd="finish"/.test(K._chipHtml({ ...g, finish: { left: 0, sites: [{ id: 7 }] } }, 0)));
  const away = { ...g, beat: { key: 'away', n: 12, of: 15, hint: 'Cob is out scouting', until: 'scout:back', say: [], wait_until: new Date(100000).toISOString() } };
  check('4d. a quiet wait: who is out and how long is left, and no "hear that again" (nothing was said)', /Cob is out scouting/.test(K._chipHtml(away, 0)) && /back in 2 min/.test(K._chipHtml(away, 0)) && /back in 30 s/.test(K._chipHtml(away, 70000)) && /any moment now/.test(K._chipHtml(away, 100001)) && !/data-kwgd="again"/.test(K._chipHtml(away, 0)) && /data-kwgd="skip"/.test(K._chipHtml(away, 0)) && /if \(!\(b\.say \|\| \[\]\)\.length\) \{ S\.told = b\.key; paint\(\); return; \}/.test(J));
  check('4e. no chip when there is no tour', K._chipHtml({ state: 'done', elder: g.elder }, 0) === '' && K._chipHtml(null, 0) === '' && K._chipHtml({ state: 'none' }, 0) === '');
  check('4f. the chip is a live region with buttons big enough for a finger, above an open window', /chip\.setAttribute\('role', 'status'\)/.test(J) && /\.kwgd-act \{[^}]*min-height: 36px/.test(CSS) && /#kwgd-chip \{[^}]*z-index: calc\(var\(--z-window\) \+ 40\)/.test(CSS));
  check('4h. of several matches the ring takes the first on the screen, and leads the view to one when none is', /for \(const el of all\) \{\s*const b = el\.getBoundingClientRect\(\);\s*if \(!onScreen\(b\)\) continue;/.test(J) && /S\.led !== key[^\n]*lead\(all\[0\]\)/.test(J) && !/scrollIntoView\(/.test(J) && /if \(\/auto\|scroll\/\.test\(cs\.overflowX\) && a\.scrollWidth > a\.clientWidth \+ 4\)/.test(J));
  check('4i. while the view is led to the exact thing nothing less exact is ringed in its place', /return S\.led === key && now - \(S\.ledAt \|\| 0\) < LED_MS \? WAIT : null;/.test(J) && /if \(r === WAIT\) \{ r = null; wait = true; break; \}/.test(J));
  check('4j. something built is checked at once (not at the next poll), and an instant build says so like the builders do', /addEventListener\('kw:built', \(\) => \{ if \(S\.g && S\.g\.state === 'active'\) \{ setTimeout\(tick, 400\); return; \}/.test(J) && /new CustomEvent\('kw:built', \{ detail: \{ site: \{ type: id, level: data\.newLevel, kind: 'building' \} \} \}\)/.test(read('js/buildings.js')));
  check('4k. on a phone the waiting moments stand above the chip, and the villager (not the "!" over them) is what is ringed', /body\.kw-shell\.kwgd-on #kw-moments \{ bottom: calc\([^}]*var\(--kwgd-h, 84px\)/.test(CSS) && /classList\.toggle\('kwgd-on', !!show\)/.test(J) && /setProperty\('--kwgd-h', h \+ 'px'\)/.test(J) && /'villager:marked': '#settlement-view \.kwv-cit:not\(\.kwv-gone\):has\(\.kwv-mark\)'/.test(J));
  check('4g. photo mode hides the chip and the ring', /body\.kw-photo #kwgd-chip, body\.kw-photo #kwgd-ring/.test(CSS));
}

console.log('5. Around it');
{
  check('5a. a town founded with the tour sees The Road and The Clan when the server says they are open', /KWPlaces\.setLocked\(\{ road: !g\.unlock\.road, clan: !g\.unlock\.clan \}\)/.test(J) && /locked\(p\.key\) \? '' :/.test(P) && /if \(!KEYS\.includes\(key\) \|\| locked\(key\)\) return;/.test(P));
  check('5b. the first-steps list is hidden during the tour and becomes the elder\'s "what next?" after', /if \(gs === 'active'\) return '';/.test(FS) && /: what next\?/.test(FS));
  check('5g. the list is repainted the moment the tour begins or ends, not at the next visit', /if \(wasState !== g\.state && global\.KWFirstSteps && global\.KWFirstSteps\.load\)/.test(J));
  check('5h. someone who signs in after the page loaded gets their own tour, not the last player\'s', /other = S\.token !== undefined && S\.token !== t; S\.token = t; if \(other\) \{ S\.g = null; S\.told = null; \}/.test(J));
  check('5i. the elder waits for the loading screen to go (after Start playing) before he speaks', /ls = doc\.getElementById\('loading-screen'\)/.test(J) && /return !\(ls && ls\.style && ls\.style\.display && ls\.style\.display !== 'none'\);/.test(J) && /id="loading-screen" style="display:none"/.test(H));
  check('5j. the moment the tour waits on is always on the screen: asked for when the beat begins, and again while no card shows', /if \(g\.beat\.key === 'moment' && was !== 'moment' && global\.KWMoments && global\.KWMoments\.load\)/.test(J) && /b\.key === 'moment' && !doc\.querySelector\('#kw-moments \[data-kwm\]'\)/.test(J));
  check('5k. the stand-in errand is gone from the screen: no picker, no buttons on the chip', !/pickErrand|data-kwgd="errand"|data-kwgd="collect"|\/errand/.test(J) && !/kwgd-pick/.test(CSS));
  check('5l. when the rest find their own beds, the homes and their open window are read again', /if \(was === 'move_in' && g\.beat\.key !== 'move_in'\) \{\s*try \{ if \(global\.KWHood && global\.KWHood\.reload\)/.test(J));
  check('5c. Help has "Take the tour again"', /KWHelp\.replayTour\(\)/.test(HELP) && /function replayTour\(\)/.test(HELP) && /global\.KWGuide\.replay\(\)/.test(HELP));
  check('5d. a one-off line the first time a merchant comes or something is lost, once the tour is over', /later\('merchant'\)/.test(J) && /later\('lost'\)/.test(J) && /S\.g\.state === 'active' \|\| S\.g\.state === 'none'/.test(J));
  check('5f. when a Tavern or a Guild Hall opens a place, the elder says so once', /if \(!before\.road && g\.unlock\.road\) setTimeout\(\(\) => S\.later && S\.later\('road'\), 800\)/.test(J) && /!before\.clan && g\.unlock\.clan/.test(J));
  check('5e. the script and its stylesheet are on the page', /\/js\/guide\.js\?v=h[0-9a-f]+/.test(H) && /\/css\/guide\.css\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
