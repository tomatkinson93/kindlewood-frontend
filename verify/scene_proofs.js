'use strict';
// The living Home scene (docs/HOME_SCENE.md §5). Step 2, the style test:
// the sprite packer (scripts/pack_sprites.js) and the villager helpers
// (js/villagers.js). Step 3, buildings are the buttons (js/home-scene.js).
// Step 4, Build mode (js/settlement-view.js).
// Later steps add the cast, errands, chat and selection.
//   node verify/scene_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const P = require(path.join(ROOT, 'scripts', 'pack_sprites.js'));
const w = { console, document: { addEventListener() {}, hidden: false }, addEventListener() {}, location: { search: '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Math };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/villagers.js'), w);
const V = w.KWVillagers;

// A tiny GIF writer for fixtures: 256-colour table, each pixel its own LZW
// code, a clear code every 250 so the code size stays at 9 bits.
function gif(width, height, frames, { delay = 20, trans = 0 } = {}) {   // trans: null for none
  const pal = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) { pal[i * 3] = i; pal[i * 3 + 1] = (i * 3) & 255; pal[i * 3 + 2] = 255 - i; }
  const parts = [Buffer.from('GIF89a'), Buffer.from([width & 255, width >> 8, height & 255, height >> 8, 0xF7, 0, 0]), pal];
  for (const idx of frames) {
    parts.push(Buffer.from([0x21, 0xF9, 4, (2 << 2) | (trans == null ? 0 : 1), delay & 255, delay >> 8, trans || 0, 0]));
    parts.push(Buffer.from([0x2C, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0]));
    const codes = [256];
    idx.forEach((c, i) => { if (i && i % 250 === 0) codes.push(256); codes.push(c); });
    codes.push(257);
    const bytes = []; let acc = 0, bits = 0;
    for (const c of codes) { acc |= c << bits; bits += 9; while (bits >= 8) { bytes.push(acc & 255); acc >>>= 8; bits -= 8; } }
    if (bits) bytes.push(acc & 255);
    parts.push(Buffer.from([8]));
    for (let i = 0; i < bytes.length; i += 255) { const b = bytes.slice(i, i + 255); parts.push(Buffer.from([b.length]), Buffer.from(b)); }
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3B]));
  return Buffer.concat(parts);
}
// Reads back our own PNGs (filter 0 rows only, which is all we write).
function readPng(buf) {
  const sig = buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let p = 8, width = 0, height = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  return { sig, width, height, at: (x, y) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] };
}

console.log('1. Directions');
{
  const cases = [[1, 0, 'e'], [1, 1, 'se'], [0, 1, 's'], [-1, 1, 'sw'], [-1, 0, 'w'], [-1, -1, 'nw'], [0, -1, 'n'], [1, -1, 'ne']];
  check('1a. a movement picks its row, for all 8 (screen y grows downward)', cases.every(([dx, dy, d]) => V._dirFromVector(dx, dy) === d),
    cases.map(([dx, dy]) => V._dirFromVector(dx, dy)).join(' '));
  check('1b. nearly east is still east; standing still faces the camera', V._dirFromVector(10, 3) === 'e' && V._dirFromVector(0, 0) === 's');
  check('1c. rows in the order S, SW, W, NW, N, NE, E, SE (packer and runtime agree)', V.DIRS.join() === 's,sw,w,nw,n,ne,e,se' && P.DIRS.join() === V.DIRS.join());
}

console.log('2. Choosing a sheet');
{
  const meta = { order: V.DIRS, species: {
    mouse: { frame: { w: 96, h: 96 }, foot: { x: 48, y: 90 }, anims: { walk: { file: 'mouse_walk.png', frames: 6, ms: 200 }, idle: { file: 'mouse_idle.png', frames: 6, ms: 200 } } },
    fox: { frame: { w: 96, h: 96 }, foot: { x: 48, y: 92 }, anims: { walk: { file: 'fox_walk.png', frames: 6, ms: 180, dirs: ['s', 'se', 'e', 'ne', 'n'] } } } } };
  const s = V._spriteFor(meta, 'Mice', 'walk', 'nw');
  check('2a. the account species name finds its sheet (Mice → mouse)', s.species === 'mouse' && s.url === '/assets/sprites/villagers/mouse_walk.png' && s.row === 3 && !s.flip);
  check('2b. a species with no sheet yet uses the mouse', V._spriteFor(meta, 'Badgers', 'walk', 'e').species === 'mouse');
  const fw = V._spriteFor(meta, 'Foxes', 'walk', 'w'), fsw = V._spriteFor(meta, 'Foxes', 'walk', 'sw');
  check('2c. a direction the sheet lacks is its opposite, mirrored (W from E, SW from SE)', fw.row === 6 && fw.flip && fsw.row === 7 && fsw.flip);
  check('2d. a missing animation falls back to one that exists', V._spriteFor(meta, 'Foxes', 'idle', 's').anim === 'walk' && V._spriteFor(meta, 'Mice', 'dance', 's').anim === 'idle');
  check('2e. the foot point comes with it', s.foot.y === 90 && fw.foot.y === 92);
  check('2f. no sheets at all: nothing to draw, no crash', V._spriteFor({ species: {} }, 'Mice', 'walk', 's') === null);
}

console.log('3. The style test loop');
{
  for (const [W, Hh, label] of [[1512, 880, 'desktop'], [421, 760, 'phone'], [920, 420, 'landscape phone']]) {
    const path = V._loopPath(W * 0.5, Hh * 0.87, W, Hh);
    const end = V._along(path, path.reduce((a, l) => a + l.len, 0) - 0.001);
    const closes = Math.abs(end.x - path[0].x) < 0.1 && Math.abs(end.y - path[0].y) < 0.1;
    let inside = true;
    for (let d = 0; d < path.reduce((a, l) => a + l.len, 0); d += 5) {
      const p = V._along(path, d);
      if (p.x < 0 || p.x > W || p.y < Hh * 0.66 || p.y > Hh * 0.94) inside = false;
    }
    check(`3a. ${label}: eight legs, one per direction, and the loop closes`, path.length === 8 && new Set(path.map(l => l.dir)).size === 8 && closes);
    check(`3b. ${label}: it stays on the ground (y 66–94 %) and on screen`, inside);
  }
  const path = V._loopPath(700, 700, 1400);
  check('3c. each leg walks the way its sprite faces', path.every(l => V._dirFromVector(l.ux, l.uy) === l.dir));
}

console.log('4. Turning it on');
{
  check('4a. ?villagers=test turns it on, ?villagers=off off; otherwise the device remembers',
    V._flagFrom('?villagers=test', null) === 'test' && V._flagFrom('?a=1&villagers=off', 'test') === null
    && V._flagFrom('', 'test') === 'test' && V._flagFrom('', null) === null);
  const J = read('js/villagers.js'), S = read('js/settlement-view.js'), H = read('index.html');
  check('4b. off by default: nothing shows for players who have not asked', /T\.on = readFlag\(\)/.test(J) && !/T = \{ on: true/.test(J));
  check('4c. the scene tells it when it shows, hides and enters Build mode',
    /KWVillagers\.sceneShown\(/.test(S) && /KWVillagers\.sceneHidden\(\)/.test(S) && /KWVillagers\.setPaused\(_svBuildMode\)/.test(S));
  check('4d. loaded by index.html after the scene', H.indexOf('/js/villagers.js?v=') > H.indexOf('/js/settlement-view.js?v='));
  check('4e. moves with transform only, pixelated, whole-number scale', /translate3d/.test(J) && /image-rendering: pixelated/.test(J) && /T\.scale = Number\(k\)/.test(J) && !/scale\s*=\s*0\.\d/.test(J));
  check('4f. stops when the tab is hidden; respects reduced motion', /visibilitychange/.test(J) && /prefers-reduced-motion/.test(J) && /document\.hidden/.test(J));
}

console.log('5. The packer');
{
  const W = 8, Hh = 8;
  // A figure: a 3×5 block of colour 9 on the left half, feet at row 6; 0 is transparent.
  const frame = (shift, col) => { const a = new Array(W * Hh).fill(0); for (let y = 2; y < 7; y++) for (let x = 1; x < 4; x++) a[y * W + x + shift] = col; return a; };
  const walkE = gif(W, Hh, [frame(0, 9), frame(1, 10), frame(0, 11)], { delay: 15 });
  const walkN = gif(W, Hh, [frame(2, 20), frame(2, 21)]);
  const idleS = gif(W, Hh, [frame(2, 30)]);
  const g = P.decodeGif(walkE);
  check('5a. the GIF reader: size, frames and frame time', g.width === 8 && g.height === 8 && g.frames.length === 3 && g.frames[0].delay === 150);
  check('5b. transparent pixels stay clear; drawn ones take their colour', g.frames[0].rgba[3] === 0 && g.frames[0].rgba[(2 * W + 1) * 4 + 3] === 255 && g.frames[0].rgba[(2 * W + 1) * 4] === 9);
  check('5c. disposal "restore to background" clears the last frame before the next', g.frames[1].rgba[(2 * W + 1) * 4 + 3] === 0);
  const big = new Array(40 * 40).fill(0).map((_, i) => (i * 7) % 256);
  const gb = P.decodeGif(gif(40, 40, [big], { trans: null }));
  check('5d. long images (many clear codes) decode exactly', gb.frames[0].rgba.every((v, i) => i % 4 !== 0 || v === big[i / 4]));

  const { sheets, meta } = P.packSpecies({ walk_e: walkE, walk_n: walkN, idle_s: idleS, notes: Buffer.from('x') });
  const png = readPng(sheets.walk);
  check('5e. one sheet per animation: frames across, 8 directions down', png.sig && png.width === 3 * W && png.height === 8 * Hh && Object.keys(sheets).sort().join() === 'idle,walk');
  const rowE = 6, rowW = 2, rowS = 0;
  check('5f. the E row holds the E frames, in order', png.at(1, rowE * Hh + 3)[0] === 9 && png.at(W + 2, rowE * Hh + 3)[0] === 10);
  check('5g. W is E mirrored', png.at(W - 1 - 1, rowW * Hh + 3)[0] === 9 && png.at(1, rowW * Hh + 3)[3] === 0 && meta.anims.walk.mirrored.includes('w'));
  check('5h. a direction with no mirror (S) borrows the nearest that exists, and says so', meta.anims.walk.borrowed.includes('s') && png.at(0, rowS * Hh)[3] >= 0);
  check('5i. a shorter animation repeats to fill the row (N has 2 frames of 3)', png.at(2 * W + 3, 4 * Hh + 3)[0] === 20);
  check('5j. villagers.json facts: frame size, frames, time, foot point from idle S',
    meta.frame.w === 8 && meta.anims.walk.frames === 3 && meta.anims.walk.ms === 150 && meta.anims.idle.frames === 1
    && Math.abs(meta.foot.x - 4.5) <= 0.5 && meta.foot.y === 7);
  let threw = '';
  try { P.packSpecies({ walk_e: walkE, walk_w: gif(10, 10, [new Array(100).fill(0)]) }); } catch (e) { threw = e.message; }
  check('5k. frames of different sizes are refused with a clear message', /differ in size/.test(threw), threw);
  check('5l. no dependencies: only Node built-ins', !/require\('(?!fs|path|zlib)/.test(read('scripts/pack_sprites.js')));
}

// ── Step 3: buildings are the buttons (js/home-scene.js) ─────────────────
const calls = [];
const rec = name => (...a) => { calls.push([name, ...a]); };
const store3 = {};
const h = { console, Math, Date, JSON, Promise, setTimeout, clearTimeout,
  document: { getElementById: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: k => (k in store3 ? store3[k] : null), setItem: (k, v) => { store3[k] = String(v); }, removeItem: k => { delete store3[k]; } } };
for (const f of ['openInventoryModal', 'visitTavern', 'openMarket', 'openLibrary', 'openCrafting', 'openTierUpgradeModal', '_openHousingModal',
  'visitFishingPost', 'closeSettlementView', '_svSwitchArea', 'openCraftingAny', 'closeProfileMenu']) h[f] = rec(f);
h.KWTown = { open: rec('KWTown.open') };
h.window = h; vm.createContext(h);
vm.runInContext(read('js/home-scene.js'), h);
const KH = h.KWHome;
const SVJ = read('js/settlement-view.js');
const visualKeys = [...SVJ.slice(SVJ.indexOf('const SV_VISUALS = {'), SVJ.indexOf('};', SVJ.indexOf('const SV_VISUALS = {'))).matchAll(/^\s{2}([a-z_]+):/gm)].map(m => m[1]);

console.log('6. What a building opens (§2.2)');
{
  const expect = { granary: 'openInventoryModal', tavern: 'visitTavern', market: 'openMarket', library: 'openLibrary', workshop: 'openCrafting',
    smithy: 'openCrafting', jeweller: 'openCrafting', guild_hall: 'openTierUpgradeModal', neighbourhood: '_openHousingModal', fishing_post: 'visitFishingPost' };
  const wrong = Object.entries(expect).filter(([k, fnName]) => { calls.length = 0; KH.open(k, () => calls.push(['panel'])); return !calls.some(c => c[0] === fnName); });
  check('6a. each building in the table opens its screen', !wrong.length, wrong.map(w => w[0]).join(' '));
  calls.length = 0; KH.open('smithy');
  check('6b. a crafting building opens Crafting on that station', calls.some(c => c[0] === 'openCrafting' && c[1] === 'smithy'));
  const leavers = Object.keys(KH.ROUTES).filter(k => KH.ROUTES[k].leave).sort().join();
  calls.length = 0; KH.open('tavern');
  check('6c. the tavern, market and fishing post open over the map: the scene closes first', leavers === 'fishing_post,market,tavern'
    && calls[0][0] === 'closeSettlementView' && calls[1][0] === 'visitTavern');
  let panelled = 0; calls.length = 0;
  KH.open('farm', () => panelled++); KH.open('mine', () => panelled++); KH.open('watchtower', () => panelled++);
  check('6d. every other building opens its own panel (workers, output, upgrade)', panelled === 3 && !calls.length);
  const dead = visualKeys.filter(k => k !== 'starter_house' && !(KH.route(k).panel || typeof KH.route(k).run === 'function'));
  check('6e. every key in SV_VISUALS opens something', visualKeys.length >= 18 && !dead.length, `${visualKeys.length} keys`);
  check('6f. every route says what it opens, for the nameplate and the label', visualKeys.every(k => KH.route(k).opens && KH.route(k).opens.length < 30));
  check('6g. the label reads as a sentence: "Granary, open the Stores"', KH.label('Granary', KH.route('granary').opens) === 'Granary, open the Stores');
}

console.log('7. Props: the green, the wonder site, the signposts');
{
  const ids = st => KH.props(st).map(p => p.id).sort().join();
  check('7a. a Camp: both signposts and the village green', ids({ tier: 'camp', festivals: true }) === 'green,signpost-out,signpost-town');
  check('7b. the wonder site from City tier', ids({ tier: 'city', festivals: true }).includes('wonder-site') && !ids({ tier: 'town', festivals: true }).includes('wonder-site'));
  calls.length = 0; KH.openProp('signpost-out'); KH.openProp('signpost-town'); KH.openProp('green'); KH.openProp('wonder-site');
  check('7c. signposts switch area; the green opens Festivals; the site opens Wonders',
    JSON.stringify(calls) === JSON.stringify([['_svSwitchArea', 'outskirts'], ['_svSwitchArea', 'town'], ['KWTown.open', 'festival'], ['KWTown.open', 'wonders']]));
  check('7d. the town\'s signpost stays clear of the desktop town card (left of 76 %); the other inside the left edge',
    KH.PROPS.find(p => p.id === 'signpost-out').x <= 72 && KH.PROPS.find(p => p.id === 'signpost-town').x >= 5);
  check('7e. the header\'s Town / Outskirts tabs are gone (the signposts replace them)', !/sv-area-tab/.test(SVJ.slice(SVJ.indexOf('root.innerHTML ='), SVJ.indexOf("+ '<div class=\"sv-build-panel\""))));
}

console.log('8. Art: the manifest and the placeholder (§2.6)');
{
  const m = { tavern: { file: 'tavern.png', w: 300, h: 240, door: [140, 230] }, mill: { file: 'mill.png', w: 200, h: 160, native: true } };
  const t = KH.art('tavern', m), mill = KH.art('mill', m);
  check('8a. an entry gives the image, its size and its door', t.url === '/assets/images/buildings/tavern.png' && t.door.x === 140 && t.door.y === 230 && !t.native);
  check('8b. no door given: the bottom centre', mill.door.x === 100 && mill.door.y === 160);
  check('8c. no entry: no image (the placeholder) and no door', KH.art('smithy', m) === null && KH.door('smithy', m) === null);
  const ph = KH.artHtml('smithy', { emoji: '⚒️', bodyColor: '#5a4a40', roofColor: '#3a2c24' }, 72, m);
  check('8d. the placeholder is a hut in the building\'s colours with its glyph on a hanging sign', /<svg class="kwh-hut"/.test(ph.html) && /#5a4a40/.test(ph.html) && /#3a2c24/.test(ph.html) && /class="kwh-sign"[^>]*>⚒️</.test(ph.html));
  check('8e. native art is drawn at its own size (1×), older art at the slot\'s size', /width:200px/.test(KH.artHtml('mill', {}, 72, m).html) && /width:110px/.test(KH.artHtml('tavern', {}, 72, m).html));
  const man = JSON.parse(read('assets/images/buildings/manifest.json'));
  const bad = Object.entries(man).filter(([, e]) => {
    const f = path.join(ROOT, 'assets/images/buildings', e.file);
    if (!fs.existsSync(f)) return true;
    const b = fs.readFileSync(f);
    return b.readUInt32BE(16) !== e.w || b.readUInt32BE(20) !== e.h || !Array.isArray(e.door) || e.door[0] > e.w || e.door[1] > e.h;
  });
  check('8f. assets/images/buildings/manifest.json: every file exists, sizes match, doors inside the image', Object.keys(man).length >= 6 && !bad.length, bad.map(b => b[0]).join(' '));
  check('8g. SV_VISUALS no longer names images (one source: the manifest)', !/image:'\/assets\/images\/buildings/.test(SVJ));
}

console.log('9. Bubbles (§2.4)');
{
  const none = () => false;
  check('9a. nothing waiting: no bubble', KH.bubble('library', {}, none) === null && KH.bubble('granary', { famine: { state: 'ok' } }, none) === null);
  KH.note('research_done', {});
  check('9b. research done: a bubble on the Library', KH.bubble('library', {}, none).text === 'Research done');
  KH.note('craft_done', { station: 'smithy', item: { name: 'Iron Sickle' } });
  KH.note('craft_done', { station: 'jeweller', ruined: true, item: { name: 'Ring' } });
  check('9c. a craft finished: "<item> ready" on its station (a ruined one says nothing)', KH.bubble('smithy', {}, none).text === 'Iron Sickle ready' && KH.bubble('jeweller', {}, none) === null);
  KH.note('craft_done', { resource: 'bronze', qty: 2 });
  check('9d. smelting finished: on the Smelter', KH.bubble('smelter', {}, none).text === 'Smelting ready');
  calls.length = 0; KH.open('library');
  check('9e. opening the building clears its bubble', KH.bubble('library', {}, none) === null);
  check('9f. the granary warns of famine (urgent) and of food running low', KH.bubble('granary', { famine: { state: 'famine' } }, none).text === 'Famine!'
    && KH.bubble('granary', { famine: { state: 'low' } }, none).text === 'Food running low');
  check('9g. the Neighbourhood counts who has no bed', KH.bubble('neighbourhood', { beds: 4, living: 10 }, none).text === 'No bed for 6' && KH.bubble('neighbourhood', { beds: 12, living: 10 }, none) === null);
  check('9h. the market carries the place bar\'s market dot', KH.bubble('market', {}, id => id === 'nav-market').text === 'Market news');
  check('9i. the green: a festival on, or ready to hold', KH.bubble('green', { town: { festival: { active: true } } }, none).text === 'Festival on!'
    && KH.bubble('green', { town: { festival: { can_start: true } } }, none).text === 'Festival ready');
  KH.note('quest_resolved', {});
  check('9j. a quest back: on the tavern', KH.bubble('tavern', {}, none).text === 'Back from a quest');
  KH.note('craft_done', { station: 'smithy', item: { name: 'A Very Long Name For A Blade' } });
  check('9k. bubble text stays short', KH.bubble('smithy', {}, none).text.length <= 24);
  check('9l. one bubble per building: the most urgent wins', KH.bubble('granary', { famine: { state: 'famine' } }, none).rank === 0);
  const RT = read('js/realtime.js');
  check('9m. realtime passes research_done, craft_done and quest_resolved on', /KWHome\.note\('research_done'/.test(RT) && /KWHome\.note\('craft_done'/.test(RT) && /KWHome\.note\('quest_resolved'/.test(RT));
}

console.log('10. Names, buttons and the profile menu (§2.4, §2.5)');
{
  const DAY = 86400000, now = Date.now();
  const get = o => k => (k in o ? o[k] : null);
  check('10a. Show names is on for the first 3 days, then off', KH.namesOn(now, get({})) && KH.namesOn(now, get({ kw_home_first_seen: String(now - 2 * DAY) }))
    && !KH.namesOn(now, get({ kw_home_first_seen: String(now - 4 * DAY) })));
  check('10b. the player\'s own choice wins', !KH.namesOn(now, get({ kw_show_names: 'off' })) && KH.namesOn(now, get({ kw_show_names: 'on', kw_home_first_seen: '1' })));
  h._hasBuilding = t => t === 'library';
  const list = KH.townList().map(t => t.key).join();
  check('10c. the profile menu lists the same screens; locked ones are absent', list === 'stores,upgrade,tavern,fishing,research,festival');
  const C = read('css/home-scene.css'), H = read('index.html');
  check('10d. nameplates show on hover, focus, Show names and the 4-second peek; hidden otherwise',
    /\.kwh-plate \{[^}]*opacity: 0/.test(C) && /:hover \.kwh-plate/.test(C) && /:focus-visible \.kwh-plate/.test(C) && /kwh-names \.kwh-plate/.test(C) && /kwh-peek \.kwh-plate/.test(C) && /4000/.test(read('js/home-scene.js')));
  check('10e. buildings, props and empty plots are real buttons with labels', /createElement\('button'\)/.test(SVJ) && /setAttribute\('aria-label', H \? H\.label\(/.test(SVJ) && /div\.setAttribute\('aria-label'/.test(SVJ));
  check('10f. Tab goes left to right; the hidden area is inert', /function _svTabOrder/.test(SVJ) && /\.inert = area/.test(SVJ));
  check('10g. a building click goes through KWHome.open', /_svOpenBuilding\(o\.id/.test(SVJ) && /KWHome\.open\(id, panel\)/.test(SVJ));
  check('10h. loaded: home-scene.js, its stylesheet, and the menu\'s #pm-town', /\/js\/home-scene\.js\?v=/.test(H) && /\/css\/home-scene\.css\?v=/.test(H) && /id="pm-town"/.test(H) && /KWHome\.fillProfile\(\)/.test(read('js/main.js')));
}

console.log('11. Build mode (§2.3)');
{
  const S = read('js/settlement-view.js'), PL = read('js/places.js');
  const grab = name => { const i = S.indexOf('function ' + name + '('); let d = 0, j = S.indexOf('{', i); for (let k = j; k < S.length; k++) { if (S[k] === '{') d++; else if (S[k] === '}' && !--d) return S.slice(i, k + 1); } return ''; };
  const b = { Math, Object }; vm.createContext(b);
  vm.runInContext(grab('_svDropTarget') + '\n' + grab('_svMoveAssignment'), b);
  const plots = { a: { x: 20, y: 70, area: 'town' }, b: { x: 40, y: 72, area: 'town' }, c: { x: 44, y: 74, area: 'town' }, n: { x: 60, y: 72, area: 'town', fixed: true },
    o: { x: 41, y: 72, area: 'outskirts' } };
  check('11a. a dragged building lands on the nearest plot in its area', b._svDropTarget('a', 41, 72, plots) === 'b' && b._svDropTarget('a', 44, 75, plots) === 'c');
  check('11b. not on itself, the Neighbourhood, the other area, or open ground', b._svDropTarget('a', 21, 70, plots) === null && b._svDropTarget('a', 60, 72, plots) === null
    && b._svDropTarget('a', 80, 40, plots) === null && b._svDropTarget('o', 40, 72, plots) === null);
  const occ = m => id => m[id] || null;
  const moved = b._svMoveAssignment({ a: 'farm' }, 'a', 'b', occ({ a: 'farm' }));
  check('11c. onto an empty plot the building moves', moved.b === 'farm' && !('a' in moved));
  const swapped = b._svMoveAssignment({ a: 'farm' }, 'a', 'b', occ({ a: 'farm', b: 'mine' }));
  check('11d. onto a building, the two swap (a building shown by default is pinned where it goes)', swapped.a === 'mine' && swapped.b === 'farm');
  check('11e. the map passed in is left alone', JSON.stringify(b._svMoveAssignment({ a: 'x' }, 'a', 'a', occ({ a: 'x' }))) === '{"a":"x"}');
  check('11f. empty plots show only in Build mode', /el\.hidden = !_svBuildMode;/.test(S) && /\.sv-slot\[hidden\] \{ display: none; \}/.test(read('css/home-scene.css')));
  check('11g. in Build mode a building opens its manage panel; otherwise its screen', /if \(_svBuildMode\) _openBuildPanel\(s, o\);\s*else _svOpenBuilding\(o\.id/.test(S));
  check('11h. a drag that just ended does not also click', /if \(_svJustDragged\) return;/.test(S) && /_SV_DRAG_PX = 6/.test(S));
  check('11i. Esc closes an open panel first, then leaves Build mode; windows keep their own Escape',
    /function _svBuildKey/.test(S) && /KWWindow\.isOpen\(\)\)\) return;/.test(grab('_svBuildKey')) && /_closeBuildPanel\(\); return;/.test(grab('_svBuildKey')) && /_svToggleBuildMode\(false\)/.test(grab('_svBuildKey')));
  check('11j. a town with nothing built opens in Build mode', /if \(!_svBuildMode && _svNothingBuilt\(\)\) _svToggleBuildMode\(true\)/.test(S));
  check('11k. one Build button: the Edit button and resize handles are gone', !/sv-edit-btn/.test(S) && !/sv-slot-resize/.test(S) && !/_svBeginResize/.test(S));
  check('11l. the Build chip turns it on and reads "Done" while on', /onLabel: 'Done'/.test(PL) && /_svToggleBuildMode/.test(PL) && /aria-pressed/.test(PL) && /KWPlaces\.refreshTools\(\)/.test(S));
  check('11m. villagers hide and props (but the signposts) step aside while building', /KWVillagers\.setPaused\(_svBuildMode\)/.test(S) && /_svBuildMode && p\.kind !== 'signpost'/.test(S));
  check('11n. leaving Home leaves Build mode', /function closeSettlementView\(\) \{\s*if \(_svBuildMode\) _svToggleBuildMode\(false\);/.test(S));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
