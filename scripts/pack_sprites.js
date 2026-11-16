#!/usr/bin/env node
'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  pack_sprites — villager GIFs into sprite sheets (docs/HOME_SCENE.md §3.1).
//
//    node scripts/pack_sprites.js            packs every species in art/villagers/
//    node scripts/pack_sprites.js mouse      just one
//
//  In:  art/villagers/<species>/<anim>_<dir>.gif
//       anim: walk, idle (and later dance, work: any name is packed)
//       dir:  s, sw, w, nw, n, ne, e, se
//  Out: assets/sprites/villagers/<species>_<anim>.png, one row per direction
//       in the order S, SW, W, NW, N, NE, E, SE, one column per frame;
//       assets/sprites/villagers/villagers.json: frame size, frame count and
//       time, the foot point, and which rows were mirrored.
//
//  A missing direction is mirrored from its opposite (W from E, NW from NE,
//  SW from SE and back). N or S with nothing to mirror borrows the nearest
//  direction that exists. No dependencies: the GIF decoder and PNG encoder
//  below are small and only need Node's zlib.
//
//  Every frame gets its 1 px dark outline (#2a180c) and a slight lift (×1.07)
//  baked in here, so the scene draws villagers with no filter of their own
//  (docs/HOME_SCENE.md §3.1, ART_GUIDE.md §4.7).
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIRS = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
const MIRROR = { w: 'e', e: 'w', nw: 'ne', ne: 'nw', sw: 'se', se: 'sw' };
const DEFAULT_MS = 200;

// ── GIF ────────────────────────────────────────────────────────────────────
// → { width, height, frames: [{ rgba: Uint8Array(w*h*4), delay }] }, each
// frame already composited (disposal and transparency applied).
function decodeGif(buf) {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; };
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('not a GIF');
  p = 6;
  const width = u16(), height = u16(), flags = u8();
  p += 2;   // background index, aspect
  const readTable = n => { const t = buf.subarray(p, p + n * 3); p += n * 3; return t; };
  const gct = flags & 0x80 ? readTable(1 << ((flags & 7) + 1)) : null;
  const subBlocks = () => {
    const parts = [];
    for (let n = u8(); n; n = u8()) { parts.push(buf.subarray(p, p + n)); p += n; }
    return Buffer.concat(parts);
  };

  const canvas = new Uint8Array(width * height * 4);
  const frames = [];
  let gce = { disposal: 0, delay: 0, trans: -1 };
  let pending = null;   // the last frame's disposal, applied before the next draws

  while (p < buf.length) {
    const b = u8();
    if (b === 0x3B) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xF9) {
        const d = subBlocks();
        gce = { disposal: (d[0] >> 2) & 7, delay: d[1] | (d[2] << 8), trans: d[0] & 1 ? d[3] : -1 };
      } else subBlocks();
      continue;
    }
    if (b !== 0x2C) throw new Error('bad GIF block 0x' + b.toString(16));
    const fx = u16(), fy = u16(), fw = u16(), fh = u16(), f = u8();
    const table = f & 0x80 ? readTable(1 << ((f & 7) + 1)) : gct;
    if (!table) throw new Error('GIF frame without a colour table');
    const minCode = u8();
    const idx = lzwDecode(subBlocks(), minCode, fw * fh);

    if (pending) {
      if (pending.disposal === 2) clearRect(canvas, width, pending);
      else if (pending.disposal === 3 && pending.saved) canvas.set(pending.saved);
    }
    const saved = gce.disposal === 3 ? canvas.slice() : null;
    const rows = f & 0x40 ? interlaceRows(fh) : null;
    for (let y = 0; y < fh; y++) {
      const ty = fy + (rows ? rows[y] : y);
      if (ty >= height) continue;
      for (let x = 0; x < fw; x++) {
        const tx = fx + x;
        if (tx >= width) continue;
        const c = idx[y * fw + x];
        if (c === gce.trans) continue;
        const o = (ty * width + tx) * 4;
        canvas[o] = table[c * 3]; canvas[o + 1] = table[c * 3 + 1]; canvas[o + 2] = table[c * 3 + 2]; canvas[o + 3] = 255;
      }
    }
    frames.push({ rgba: canvas.slice(), delay: gce.delay * 10 });
    pending = { disposal: gce.disposal, x: fx, y: fy, w: fw, h: fh, saved };
    gce = { disposal: 0, delay: 0, trans: -1 };
  }
  return { width, height, frames };
}

// Row i of the image data holds image row interlaceRows(h)[i].
function interlaceRows(h) {
  const out = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) out.push(y);
  return out;
}

function clearRect(canvas, width, r) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const o = (y * width + x) * 4;
    if (o >= 0 && o < canvas.length) canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0;
  }
}

function lzwDecode(data, minCode, count) {
  const out = new Uint8Array(count);
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, prev = -1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = first[i] = i; len[i] = 1; }
  let bits = 0, acc = 0, o = 0, bp = 0;
  while (o < count) {
    while (bits < size && bp < data.length) { acc |= data[bp++] << bits; bits += 8; }
    if (bits < size) break;
    const code = acc & ((1 << size) - 1);
    acc >>>= size; bits -= size;
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let c = code;
    if (code >= next) {           // the KwKwK case: prev + first(prev)
      if (prev < 0) break;
      c = prev;
    }
    // Write the string for c (back to front), then the extra char if KwKwK.
    const l = len[c];
    let end = o + l;
    for (let k = c, i = end - 1; k >= 0 && i >= o; k = prefix[k], i--) if (i < count) out[i] = suffix[k];
    o = Math.min(end, count);
    if (code >= next) { if (o < count) out[o] = first[prev]; o++; }
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = code >= next ? first[prev] : first[c];
      first[next] = first[prev];
      len[next] = len[prev] + 1;
      next++;
      if (next === (1 << size) && size < 12) size++;
    }
    prev = code;
  }
  return out;
}

// ── PNG (RGBA, 8 bits) ─────────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── Packing ────────────────────────────────────────────────────────────────
function flipFrame(rgba, w, h) {
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = (y * w + (w - 1 - x)) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return out;
}

// Where each of the 8 rows comes from, given the directions that have a GIF:
// → { s: { from: 's', flip: false }, … }, or throws when there is nothing.
function rowSources(have) {
  const set = new Set(have);
  if (!set.size) throw new Error('no directions');
  const out = {};
  for (const d of DIRS) {
    if (set.has(d)) out[d] = { from: d, flip: false };
    else if (MIRROR[d] && set.has(MIRROR[d])) out[d] = { from: MIRROR[d], flip: true };
  }
  // N or S (or a pair missing both sides): the nearest direction round the compass.
  for (const d of DIRS) {
    if (out[d]) continue;
    const i = DIRS.indexOf(d);
    for (let k = 1; k < 8 && !out[d]; k++) {
      for (const j of [(i + k) % 8, (i - k + 8) % 8]) if (set.has(DIRS[j])) { out[d] = { from: DIRS[j], flip: false }; break; }
    }
  }
  return out;
}

// The outline and lift (§4.7): every empty pixel next to a drawn one (left,
// right, up or down) becomes OUTLINE; drawn pixels are lifted by LIFT. Returns
// a new frame; the one passed in is left alone.
const OUTLINE = [0x2a, 0x18, 0x0c], LIFT = 1.07;
function outlineFrame(rgba, w, h) {
  const out = new Uint8Array(rgba.length);
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] > 0) {
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.round(rgba[i + c] * LIFT));
      out[i + 3] = rgba[i + 3];
    } else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) {
      out[i] = OUTLINE[0]; out[i + 1] = OUTLINE[1]; out[i + 2] = OUTLINE[2]; out[i + 3] = 255;
    }
  }
  return out;
}

// The foot point: bottom centre of everything drawn across the frames.
function footPoint(frames, w, h) {
  let minX = w, maxX = -1, maxY = -1;
  for (const f of frames) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (f[(y * w + x) * 4 + 3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  }
  return maxX < 0 ? { x: Math.round(w / 2), y: h } : { x: Math.round((minX + maxX + 1) / 2), y: maxY + 1 };
}

// Packs one species. `gifs`: { 'walk_e': Buffer, … }. → { sheets: { walk: { png, … } }, meta }
function packSpecies(gifs) {
  const anims = {};
  for (const [name, buf] of Object.entries(gifs)) {
    const m = /^([a-z]+)_(s|sw|w|nw|n|ne|e|se)$/.exec(name);
    if (!m) continue;
    (anims[m[1]] = anims[m[1]] || {})[m[2]] = decodeGif(buf);
  }
  if (!Object.keys(anims).length) throw new Error('no <anim>_<dir>.gif files');
  let fw = 0, fh = 0;
  for (const dirs of Object.values(anims)) for (const g of Object.values(dirs)) {
    if (!fw) { fw = g.width; fh = g.height; }
    else if (g.width !== fw || g.height !== fh) throw new Error(`frames differ in size (${g.width}×${g.height}, expected ${fw}×${fh})`);
  }
  const sheets = {}, meta = { frame: { w: fw, h: fh }, foot: null, anims: {} };
  for (const [anim, dirs] of Object.entries(anims)) {
    const src = rowSources(Object.keys(dirs));
    const count = Math.max(...Object.values(dirs).map(g => g.frames.length));
    const firstGif = dirs.s || dirs.e || Object.values(dirs)[0];
    const ms = (firstGif.frames[0] && firstGif.frames[0].delay) || DEFAULT_MS;
    const W = fw * count, H = fh * DIRS.length, out = new Uint8Array(W * H * 4);
    DIRS.forEach((d, row) => {
      const g = dirs[src[d].from];
      for (let col = 0; col < count; col++) {
        let f = g.frames[col % g.frames.length].rgba;
        if (src[d].flip) f = flipFrame(f, fw, fh);
        f = outlineFrame(f, fw, fh);
        for (let y = 0; y < fh; y++) Buffer.from(f.buffer, f.byteOffset + y * fw * 4, fw * 4)
          .copy(Buffer.from(out.buffer), ((row * fh + y) * W + col * fw) * 4);
      }
    });
    sheets[anim] = encodePng(W, H, out);
    meta.anims[anim] = { frames: count, ms, mirrored: DIRS.filter(d => src[d].flip), borrowed: DIRS.filter(d => !src[d].flip && src[d].from !== d) };
  }
  const footFrom = (anims.idle && (anims.idle.s || Object.values(anims.idle)[0])) || Object.values(Object.values(anims)[0])[0];
  meta.foot = footPoint(footFrom.frames.map(f => f.rgba), fw, fh);
  return { sheets, meta };
}

function main(argv) {
  const root = path.join(__dirname, '..');
  const artDir = path.join(root, 'art', 'villagers');
  const outDir = path.join(root, 'assets', 'sprites', 'villagers');
  if (!fs.existsSync(artDir)) { console.error('No art/villagers/ folder. Put GIFs in art/villagers/<species>/walk_se.gif and so on.'); process.exit(1); }
  const only = argv.slice(2).map(s => s.toLowerCase());
  const species = fs.readdirSync(artDir).filter(d => fs.statSync(path.join(artDir, d)).isDirectory() && (!only.length || only.includes(d.toLowerCase())));
  if (!species.length) { console.error('Nothing to pack.'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'villagers.json');
  const json = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : { order: DIRS, species: {} };
  json.order = DIRS;
  for (const sp of species) {
    const key = sp.toLowerCase();
    const dir = path.join(artDir, sp);
    const gifs = {};
    for (const f of fs.readdirSync(dir)) if (/\.gif$/i.test(f)) gifs[f.replace(/\.gif$/i, '').toLowerCase()] = fs.readFileSync(path.join(dir, f));
    const { sheets, meta } = packSpecies(gifs);
    for (const [anim, png] of Object.entries(sheets)) {
      const file = `${key}_${anim}.png`;
      fs.writeFileSync(path.join(outDir, file), png);
      meta.anims[anim].file = file;
    }
    json.species[key] = meta;
    const notes = Object.entries(meta.anims).map(([a, m]) => `${a}: ${m.frames} frames × ${m.ms} ms` + (m.mirrored.length ? `, mirrored ${m.mirrored.join(' ').toUpperCase()}` : '') + (m.borrowed.length ? `, borrowed ${m.borrowed.join(' ').toUpperCase()}` : ''));
    console.log(`${key}: ${meta.frame.w}×${meta.frame.h}, foot at ${meta.foot.x},${meta.foot.y} — ${notes.join('; ')}`);
  }
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n');
  console.log('Wrote ' + path.relative(root, jsonPath));
}

module.exports = { DIRS, MIRROR, OUTLINE, LIFT, decodeGif, lzwDecode, encodePng, rowSources, footPoint, packSpecies, flipFrame, outlineFrame };
if (require.main === module) main(process.argv);
