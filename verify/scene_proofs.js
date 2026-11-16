'use strict';
// The living Home scene (docs/HOME_SCENE.md §5). Step 2, the style test:
// the sprite packer (scripts/pack_sprites.js) and the villager helpers
// (js/villagers.js). Step 3, buildings are the buttons (js/home-scene.js).
// Step 4, Build mode (js/settlement-view.js). Step 5, the villager engine
// (js/villager-engine.js). Step 6, behaviour (the same file).
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
  check('7c. signposts switch area (to the near end); the green opens Festivals; the site opens Wonders',
    JSON.stringify(calls) === JSON.stringify([['_svSwitchArea', 'outskirts', false, 'start'], ['_svSwitchArea', 'town', false, 'end'], ['KWTown.open', 'festival'], ['KWTown.open', 'wonders']]));
  check('7d. the signposts stand at the two ends of the walk: Town\'s right end, the Outskirts\' left end (and land you at the matching end)',
    KH.PROPS.find(p => p.id === 'signpost-out').x >= 95 && KH.PROPS.find(p => p.id === 'signpost-town').x <= 5);
  check('7e. the header\'s Town / Outskirts tabs are gone (the signposts replace them)', !/sv-area-tab/.test(SVJ.slice(SVJ.indexOf('root.innerHTML ='), SVJ.indexOf("+ '<div class=\"sv-build-panel\""))));
}

console.log('8. Art: the manifest and the placeholder (§2.6)');
{
  const m = { tavern: { file: 'tavern.png', w: 300, h: 240, door: [140, 230] }, mill: { file: 'mill.png', w: 200, h: 160, native: true } };
  const t = KH.art('tavern', m), mill = KH.art('mill', m);
  check('8a. an entry gives the image (from scene_v2), its size and its door; native and smooth unless it says not', t.url === '/assets/images/scene_v2/buildings/tavern.png' && t.door.x === 140 && t.door.y === 230 && t.native && t.smooth);
  check('8b. no door given: the bottom centre', mill.door.x === 100 && mill.door.y === 160);
  check('8c. no entry: no image (the placeholder) and no door', KH.art('smithy', m) === null && KH.door('smithy', m) === null);
  const ph = KH.artHtml('smithy', { emoji: '⚒️', bodyColor: '#5a4a40', roofColor: '#3a2c24' }, 72, m);
  check('8d. the placeholder is a hut in the building\'s colours with its glyph on a hanging sign', /<svg class="kwh-hut"/.test(ph.html) && /#5a4a40/.test(ph.html) && /#3a2c24/.test(ph.html) && /class="kwh-sign"[^>]*>⚒️</.test(ph.html));
  check('8e. art is drawn at the manifest\'s size, the lit image on top (shown in the evening and at night)',
    /class="kwh-art" style="width:200px;height:160px"/.test(KH.artHtml('mill', {}, 72, m).html) && !/kwh-lit/.test(KH.artHtml('mill', {}, 72, m).html)
    && /kwh-day[\s\S]*kwh-lit/.test(KH.artHtml('tavern', {}, 72, { tavern: { file: 't.webp', lit: 't_lit.webp', w: 331, h: 320 } }).html));
  // WebP sizes without a library: VP8X, VP8L (lossless) or VP8 (lossy).
  const webpSize = buf => {
    const t = buf.toString('ascii', 12, 16);
    if (t === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    if (t === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    return null;
  };
  const dir2 = 'assets/images/scene_v2/buildings';
  const man = JSON.parse(read(dir2 + '/manifest.v2.json'));
  const bad = Object.entries(man).filter(([, e]) => [e.file, e.lit].filter(Boolean).some(f => {
    const fp = path.join(ROOT, dir2, f);
    if (!fs.existsSync(fp)) return true;
    const z = webpSize(fs.readFileSync(fp)), sc = e.scale || 1;
    return !z || Math.abs(z.w - e.w * sc) > 2 || Math.abs(z.h - e.h * sc) > 2 || !Array.isArray(e.door) || e.door[0] > e.w || e.door[1] > e.h;
  }));
  check('8f. scene_v2/buildings/manifest.v2.json: every file (and lit file) exists at scale × its size; doors inside', Object.keys(man).length >= 11 && !bad.length, bad.map(b => b[0]).join(' '));
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

console.log('12. The cast and walking (§3.2–3.4)');
{
  const e = { console, Math, Map, Set, JSON, Number, String, Array, Object, Infinity, setTimeout, document: { addEventListener() {}, querySelector: () => null }, addEventListener() {} };
  e.window = e; vm.createContext(e);
  vm.runInContext(read('js/villager-engine.js'), e);
  const C = e.KWCast;
  const mk = (id, o = {}) => Object.assign({ id, name: 'C' + id, life_stage: 'adult', stage: 'adult', role: 'forager', family_id: id, parent_ids: [] }, o);
  const town = [mk(1, { family_id: 10 }), mk(2, { family_id: 10 }), mk(3, { family_id: 11 }), mk(4, { family_id: 12 }), mk(5, { family_id: 12, stage: 'elder' }),
    mk(6, { family_id: 10, stage: 'child', life_stage: 'child', parent_ids: [1, 2] }), mk(7, { family_id: 13, stage: 'child', life_stage: 'child', parent_ids: [99] }),
    mk(8, { life_stage: 'deceased', stage: 'deceased' }), mk(9, { family_id: 14, active_quest: {} }), mk(10, { family_id: 15, role: 'farmer' }),
    mk(11, { family_id: 16 }), mk(12, { family_id: 17 }), mk(13, { family_id: 18 })];
  const away = c => (c.active_quest ? { label: 'On Quest' } : null);
  const builtArea = b => ({ farm: 'outskirts', tavern: 'town' }[b] || null);
  const areaOf = c => C._areaOf(c, builtArea);
  const pick = (o = {}) => C._pickCast(town, Object.assign({ cap: 14, area: 'town', areaOf, away, momentIds: [], rand: C._seeded(7) }, o));
  const all = pick();
  check('12a. never anyone dead or away', !all.includes(8) && !all.includes(9));
  check('12b. the area decides: a farmer works out in the Outskirts; children and elders are in town', !all.includes(10) && pick({ area: 'outskirts' }).join() === '10' && all.includes(5));
  check('12c. never a child without a parent (a child whose parent is not here stays indoors)', all.includes(6) && !all.includes(7)
    && all.every(id => { const c = town.find(x => x.id === id); return !(c.stage === 'child') || c.parent_ids.some(p => all.includes(p)); }));
  let capOk = true, kidOk = true;
  for (let seed = 1; seed < 60; seed++) for (const cap of [1, 2, 3, 5, 8]) {
    const r = pick({ cap, rand: C._seeded(seed) });
    if (r.length > cap) capOk = false;
    if (r.some(id => { const c = town.find(x => x.id === id); return c.stage === 'child' && !c.parent_ids.some(p => r.includes(p)); })) kidOk = false;
  }
  check('12d. never more than the cap, whatever the seed (60 seeds × 5 caps)', capOk);
  check('12e. and never a lone child at any cap', kidOk);
  const m = pick({ cap: 2, momentIds: [12, 6] });
  check('12f. anyone with an open moment is always in (a child comes with a parent)', m.includes(12) || (m.includes(6) && (m.includes(1) || m.includes(2))));
  check('12g. a moment subject first even when the cast is small', pick({ cap: 1, momentIds: [13] }).join() === '13');
  const small = pick({ cap: 4, rand: C._seeded(3) });
  check('12h. an elder if the town has one, even at a small cap', small.includes(5));
  const fams = new Set(small.map(id => town.find(x => x.id === id).family_id));
  check('12i. spread across families (4 people, 4 families)', fams.size === 4);
  check('12j. the same seed picks the same cast (tests can replay a scene)', pick({ rand: C._seeded(5) }).join() === pick({ rand: C._seeded(5) }).join());
  check('12k. caps: 14 on desktop, 8 on a phone', C.CAP.desktop === 14 && C.CAP.phone === 8);

  const rnd = C._seeded(11);
  let inside = true;
  for (const area of ['town', 'outskirts']) for (let i = 0; i < 300; i++) { const p = C._groundPoint(area, rnd); if (!C._inPolygon(p.x, p.y, C.GROUND[area])) inside = false; }
  check('12l. every place on open ground they walk to lies on the ground (600 samples)', inside);
  check('12m. every named spot lies on the ground', ['town', 'outskirts'].every(a => C.SPOTS[a].every(s => C._inPolygon(s.x, s.y, C.GROUND[a]))));
  check('12n. the ground is the whole meadow below the horizon (25 %), less a margin', ['town', 'outskirts'].every(a => C.GROUND[a].every(([x, y]) => x >= 0 && x <= 100 && y >= 30 && y <= 97)) || ['town', 'outskirts'].every(a => C.GROUND[a].every(([x, y]) => x >= 0 && x <= 100 && y >= 66 && y <= 94)));
  const g = C._onGround('town', 60, 40);
  check('12o. a door up in the sky is brought down to the ground', C._inPolygon(g.x, g.y, C.GROUND.town) && C._onGround('town', 30, 85).y === 85);
  const art = { w: 300, h: 240, door: { x: 150, y: 230 } };
  const d1 = C._doorPoint({ left: 100, top: 200, width: 150, height: 120 }, art), d2 = C._doorPoint({ left: 400, top: 210, width: 150, height: 120 }, art);
  check('12p. a door comes from the manifest, scaled to the drawn size', d1.x === 175 && d1.y === 315);
  check('12q. a door follows a moved building', d2.x - d1.x === 300 && d2.y - d1.y === 10);
  check('12r. the placeholder hut\'s door; else the bottom centre', C._doorPoint({ left: 0, top: 0, width: 120, height: 105 }, { hut: true }).x === 55 && C._doorPoint({ left: 0, top: 0, width: 80, height: 60 }, null).y === 60);
  check('12s. speeds: adults 40, elders 30, children 55 px a second', C.SPEED.adult === 40 && C.SPEED.elder === 30 && C.SPEED.child === 55);

  const E = read('js/villager-engine.js'), VJ = read('js/villagers.js'), H = read('index.html');
  check('12t. depth from the foot: villagers and buildings share one z-index scale', /el\.style\.zIndex = String\(depth\(v\.y\)\)/.test(E) && /slot\.style\.zIndex = String\(depth\(foot\)\)/.test(E));
  check('12u. one loop, transform only; it stops off Home, with the tab hidden, in Build mode, and stands still under reduced motion',
    /const running = \(\) => S\.shown && !S\.paused && S\.layer && !doc\.hidden && !\(V\(\) && V\(\)\.reducedMotion\(\)\)/.test(E) && /visibilitychange/.test(E)
    && /draw\(v, true\)/.test(E) && /translate3d/.test(VJ) && !/style\.(left|top) =/.test(E));
  check('12v. children are drawn at 0.75×; each family has its own gentle look', /v\.child \? 0\.75 : 1/.test(E) && /TINTS\[Math\.abs\(Number\(c\.family_id\)/.test(E));
  check('12w. leaving town: walk to the nearest door and fade; arriving: out of a door; nobody pops up except when Home opens',
    /function leave\(v\)/.test(E) && /nearestDoor\(v\.x, v\.y\)/.test(E) && /make\(c, at, !first\)/.test(E));
  check('12x. a picture only: the engine never calls the server', !/apiFetch|fetch\(/.test(E));
  check('12y. loaded after js/villagers.js; the scene\'s hooks reach it', H.indexOf('/js/villager-engine.js?v=') > H.indexOf('/js/villagers.js?v=') && /cast\(\)\.sceneShown\(T\.layer\)/.test(VJ) && /cast\(\)\.setPaused\(T\.paused\)/.test(VJ));
  check('12z. the loop measures its own cost per frame (the phone pass targets under 2 ms)', /S\.ms = S\.ms \* 0\.95/.test(E) && /get frameMs\(\)/.test(E));
}

console.log('13. Behaviour (§3.5)');
{
  const e = { console, Math, Map, Set, JSON, Number, String, Array, Object, Infinity, setTimeout, document: { addEventListener() {}, querySelector: () => null }, addEventListener() {} };
  e.window = e; vm.createContext(e);
  vm.runInContext(read('js/villager-engine.js'), e);
  const C = e.KWCast;
  const work = { key: 'farm', x: 100, y: 500 }, tavern = { key: 'tavern', x: 300, y: 520 }, home = { key: 'neighbourhood', x: 600, y: 510 };
  const ctx = (phase, o = {}) => Object.assign({ phase, work, tavern, home, doors: [work, tavern, home], spots: [{ x: 50, y: 600 }], ground: () => ({ x: 400, y: 600 }), owl: false }, o);
  const tally = (c, n = 2000, seed = 3) => { const r = C._seeded(seed), t = {}; for (let i = 0; i < n; i++) { const g = C._chooseErrand(c, r); const k = g.kind === 'door' ? g.key : g.kind; t[k] = (t[k] || 0) + 1; } return t; };
  const day = tally(ctx('day')), dawn = tally(ctx('dawn')), dusk = tally(ctx('dusk')), night = tally(ctx('night')), owl = tally(ctx('night', { owl: true }));
  const share = (t, k) => (t[k] || 0) / 2000;
  check('13a. morning sends workers to their buildings; by day now and then', share(dawn, 'farm') > 0.35 && share(day, 'farm') > 0.08 && share(day, 'farm') < share(dawn, 'farm'));
  check('13b. by day most errands are outdoors (doors are sparing: indoors lasts 20–60 s)', (share(day, 'spot') + share(day, 'ground')) > 0.75);
  check('13c. in the evening the tavern and home', share(dusk, 'tavern') > 0.25 && share(dusk, 'neighbourhood') > 0.1 && !dusk.farm);
  check('13d. at night everyone goes home …', share(night, 'neighbourhood') === 1);
  check('13e. … except the two or three still out, who stay out', !owl.neighbourhood && !owl.farm && !owl.tavern);
  check('13f. no home door: any door, then open ground', C._chooseErrand(ctx('night', { home: null }), C._seeded(1)).kind === 'door' && C._chooseErrand(ctx('night', { home: null, doors: [] }), C._seeded(1)).kind !== 'door');
  const owls = C._nightOwls([12, 4, 9, 30, 7]);
  check('13g. night owls: three at most, always the same ones (never flickers)', owls.size === 3 && [...owls].join() === '4,7,9' && [...C._nightOwls([9, 7, 4, 12, 30])].join() === '4,7,9' && C.NIGHT_OUT === 3);
  const vs = [{ id: 1, x: 0, y: 0, free: true }, { id: 2, x: 150, y: 0, free: true }, { id: 3, x: 900, y: 0, free: true }, { id: 4, x: 20, y: 10, free: true, selected: true },
    { id: 5, x: 30, y: 0, free: true, child: true }, { id: 6, x: 10, y: 5, free: false }];
  const pairs = C._chatPairs(vs, 1e6, {});
  check('13h. chat: two free grown-ups within about 200 px pair up', pairs.length === 1 && pairs[0].join() === '1,2');
  check('13i. a selected villager, a child or a busy one never starts a chat; far apart, no chat', !pairs.flat().some(id => [3, 4, 5, 6].includes(id)));
  check('13j. a pair does not chat again for 2 minutes', C._chatPairs(vs, 1e6, { '1_2': 1e6 - 60000 }).length === 0 && C._chatPairs(vs, 1e6, { '1_2': 1e6 - 121000 }).length === 1 && C.CHAT_COOLDOWN === 120000);
  const f = C._followPoint({ x: 500, y: 500, tx: 700, ty: 500 });
  check('13k. a child walks a little behind a parent', f.x < 500 && Math.abs(f.x - 500) <= 30 && C._followPoint({ x: 500, y: 500, tx: 500, ty: 500 }).x < 500);
  const E = read('js/villager-engine.js'), CSS = read('css/home-scene.css');
  check('13l. indoors: fade at the door, stay 20–60 s (night: till morning), the building bounces', C.INDOORS_MS[0] === 20000 && C.INDOORS_MS[1] === 60000 && /kwh-bounce/.test(E) && /@keyframes kwh-bounce/.test(CSS) && /S\.phase === 'night' && !S\.owls\.has\(v\.id\)/.test(E));
  check('13m. a chat lasts 4–7 s with a bubble passed back and forth (dots or a tiny picture)', /CHAT_MS = \[4000, 7000\]/.test(E) && /SAY = \['…'/.test(E) && /\.kwv-say \{/.test(CSS));
  check('13n. children go indoors with their parent and come out after', /k\.child && k\.state !== 'indoors' && live\(k\) && parentsOf\(k\.c\)\.includes\(v\.id\)/.test(E) && /parentOf\(v\)\.state === 'indoors'/.test(E));
  check('13o. evening and night: buildings with a lit image glow; no chats at night; the cast stops changing at night',
    /setAttribute\('data-phase', S\.phase\)/.test(E) && /\[data-phase="night"\] \.kwh-lit \{ opacity: 1; \}|\[data-phase="night"\] \.kwh-lit/.test(CSS) && /\(S\.phase !== 'night'\)/.test(E) && /if \(S\.phase !== 'night'\) rotate\(\)/.test(E));
  check('13p. the time of day is the game clock (Dev Tools time included)', /global\.KWClock \? global\.KWClock\.phase\(\)\.phase/.test(E));
  check('13q. a chat gives up if the two never meet', /a\.until = now \+ 8000/.test(E) && /now >= v\.until\) endChat\(v, now\)/.test(E));
}

console.log('14. The new look (docs/ART_GUIDE.md)');
{
  const S2 = read('js/settlement-view.js'), CSS = read('css/home-scene.css'), HJ = read('js/home-scene.js'), E = read('js/villager-engine.js'), MAP = read('js/kwmap-core.js'), VJ = read('js/villagers.js');
  const grab = (src, name) => { const i = src.indexOf('function ' + name + '('); let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && !--d) return src.slice(i, k + 1); } return ''; };
  const bx = { Math }; vm.createContext(bx); vm.runInContext(grab(S2, '_svClampPan'), bx);
  check('14a. the backdrop: a sky by code, mountains and trees that tile sideways, a meadow that tiles both ways', /backdrop\/mountains\.webp/.test(S2) && /backdrop\/trees\.webp/.test(S2) && /backdrop\/ground\.webp/.test(S2)
    && /\.sv-bd-ground \{[^}]*background-repeat: repeat;/.test(CSS) && /\.sv-bd-trees \{[^}]*repeat-x/.test(CSS) && /data-phase="night"\] \.sv-scene \{ background: linear-gradient/.test(CSS)
    && ['mountains', 'trees', 'ground'].every(k => fs.existsSync(path.join(ROOT, 'assets/images/scene_v2/backdrop', k + '.webp'))));
  check('14b. the horizon at a quarter of the height; the tree line overlaps the meadow by 12 px; haze on the far strips (18 %, 25 %)',
    /SV_HORIZON = 0\.25/.test(S2) && /\.sv-bd-ground \{[^}]*top: 25%/.test(CSS) && /top: calc\(25% \+ 12px - var\(--bd-h\)\)/.test(CSS) && /\.sv-bd-trees::after \{ opacity: 0\.18; \}/.test(CSS) && /\.sv-bd-mountains::after \{ opacity: 0\.25; \}/.test(CSS));
  check('14c. no drift: nothing in the scene follows the mouse', !/_onParallaxMove|_tickParallax|_bindParallax/.test(S2) && !/SV_LAYER_DEFS/.test(S2));
  check('14d. Town and the Outskirts pan: drag, sideways wheel, arrow keys, the edge of the screen', /SV_WORLD_W = 2600/.test(S2) && /addEventListener\('pointerdown'/.test(S2) && /addEventListener\('wheel'/.test(S2)
    && /'ArrowLeft'/.test(S2) && /function _svEdgeWatch/.test(S2));
  check('14e. a pan stays inside the world', bx._svClampPan(-50, 1400, 2600) === 0 && bx._svClampPan(5000, 1400, 2600) === 1200 && bx._svClampPan(300, 1400, 2600) === 300 && bx._svClampPan(300, 3000, 2600) === 0);
  check('14f. a drag that pans never clicks the building it started on; in Build mode a building drag moves it instead', /if \(_svPanned\) \{ e\.stopPropagation\(\); e\.preventDefault\(\); \}/.test(S2) && /_svBuildMode && slot && slot\.dataset\.slot && _svDraggable/.test(S2));
  check('14g. the map leaves the arrow keys alone while Home shows', /window\._svIsOpen\(\)\) return;/.test(MAP));
  check('14h. the far strips pan a little slower (the only depth), and only with the pan', /pan: 0\.45/.test(S2) && /pan: 0\.75/.test(S2) && /el\.dataset\.pan/.test(S2));
  const slots = [...S2.matchAll(/\{ id:'([a-z-]+)',\s+area:'(town|outskirts)',\s+x:([\d.]+),\s+y:([\d.]+)/g)].map(m => ({ id: m[1], area: m[2], x: +m[3], y: +m[4] }));
  check('14i. slots for a flat field: two rows, feet in the meadow (back row under the tree line)', slots.length === 18 && slots.every(q => q.y >= 50 && q.y <= 95 && q.x > 2 && q.x < 98)
    && new Set(slots.map(q => q.y)).size === 2 && /\.sv-world \.sv-slot \{ transform: translate\(-50%, -100%\); \}/.test(CSS));
  check('14j. the old hand-made layout is not carried over (new keys)', /'sv_slot_positions_v2'/.test(S2) && /'sv_slot_sizes_v2'/.test(S2));
  check('14k. smooth art: buildings are never pixelated; only villagers are', !/kwh-native \{ image-rendering: pixelated/.test(CSS) && /image-rendering: pixelated/.test(VJ));
  check('14l. shadows by code under buildings (92 % wide) and villagers', /\.kwh-art::before \{[^}]*left: 4%; right: 4%/.test(CSS) && /\.kwv-shadow \{/.test(CSS) && /kwv-shadow/.test(VJ));
  const T = vm.runInContext('KWHome.NIGHT_TINTS', h);
  check('14m. night: ×0.42, ×0.48, ×0.78; lit images ×0.72, ×0.72, ×0.92; the lit image fades in over 3 s', T['kwn-night'].join() === '0.42,0.48,0.78' && T['kwn-lit'].join() === '0.72,0.72,0.92'
    && /\.kwh-lit \{ opacity: 0; transition: opacity 3s ease; \}/.test(CSS) && /data-phase="night"\] \.kwv-villager \{ filter: url\(#kwn-night\)|\.kwv-villager \{ filter: url\(#kwn-night\); \}/.test(CSS));
  check('14n. villagers stand out: a 1 px dark outline and a slight lift, with the family look', /drop-shadow\(1px 0 0 #2a180c\) drop-shadow\(-1px 0 0 #2a180c\) drop-shadow\(0 1px 0 #2a180c\) drop-shadow\(0 -1px 0 #2a180c\) brightness\(1\.07\)/.test(CSS) && /--kwv-tint/.test(E));
  const cm = { house_timber: { file: 'a.webp', lit: 'a_lit.webp', w: 219, h: 209, door: [92, 205] }, house_stone: { file: 'b.webp', w: 216, h: 208, door: [89, 204] }, house_thatch: { file: 'c.webp', lit: 'c_lit.webp', w: 212, h: 196, door: [89, 192] } };
  const cl = KH.art('neighbourhood', cm);
  check('14o. the Neighbourhood\'s door is a cluster of the house drawings until its own art exists; its door is the front house\'s',
    cl && cl.cluster.length === 3 && Math.abs(cl.door.x - (62 + 89 * 0.62)) < 0.01 && /kwh-cluster/.test(KH.artHtml('neighbourhood', {}, 72, cm).html) && KH.art('neighbourhood', {}) === null);
  check('14p. an empty Neighbourhood stays dark at night', /if \(!houseCount\) btn\.classList\.add\('kwh-dark'\)/.test(S2) && /\.kwh-dark \.kwh-lit \{ opacity: 0 !important; \}/.test(CSS));
  check('14q. keys with no new art keep the placeholder (the painted scene\'s images are not mixed in)', /manifest\.v2\.json/.test(HJ) && !/'\/assets\/images\/buildings\/manifest\.json'/.test(HJ) && KH.PH_SIZE >= 150);
  check('14r. KWCast.preview(phase) shows another time of day until cleared', /preview: p => \{ S\.hold = p \|\| null;/.test(E) && /S\.hold \|\| clockPhase\(\)/.test(E));
  check('14s. villagers walk the whole meadow; their spots lie in the gaps between buildings', C2ok());
  function C2ok() { const e2 = { console, Math, Map, Set, JSON, Number, String, Array, Object, Infinity, setTimeout, document: { addEventListener() {}, querySelector: () => null }, addEventListener() {} }; e2.window = e2; vm.createContext(e2); vm.runInContext(E, e2);
    const G = e2.KWCast.GROUND.town; return G.every(([, y]) => y >= 30) && e2.KWCast.SPOTS.town.every(q => e2.KWCast._inPolygon(q.x, q.y, G)); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
