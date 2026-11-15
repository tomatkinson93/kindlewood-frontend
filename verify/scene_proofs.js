'use strict';
// The living Home scene (docs/HOME_SCENE.md §5). Step 2, the style test:
// the sprite packer (scripts/pack_sprites.js) and the villager helpers
// (js/villagers.js). Later steps add the cast, errands, chat and selection.
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
  check('4c. the scene tells it when it shows, hides and enters Build/Edit mode',
    /KWVillagers\.sceneShown\(/.test(S) && /KWVillagers\.sceneHidden\(\)/.test(S) && /KWVillagers\.setPaused\(_svEditMode\)/.test(S));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
