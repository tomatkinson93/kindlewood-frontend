#!/usr/bin/env node
// Lists the tactics battles' art and sound for the game (docs/TACTICS_ASSETS.md).
// Run it after adding or removing files:
//
//   node scripts/pack_tactics.js
//
// It reads
//   assets/sprites/creatures/<creature>_front.png and <creature>_back.png
//   assets/tactics/icons/<ability key>.png
//   assets/audio/tactics/<name>.mp3 (or .ogg, .wav)
//   assets/audio/tactics/music/*.mp3
// and writes assets/tactics/manifest.json, which js/tactics.js loads. Whatever
// is not listed keeps its stand-in (a creature's icon, an older sound, the
// card battles' music), so a half-finished set of files is fine.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const list = (dir, re) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f)).sort(); } catch (e) { return []; } };
// file → "file?v=stamp", the stamp from its contents: a file that is replaced is fetched afresh, not taken from a cache.
const stamped = (dir, f) => f + '?v=' + require('crypto').createHash('sha1').update(fs.readFileSync(path.join(ROOT, dir, f))).digest('hex').slice(0, 8);
// A PNG's size, from its header.
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function build() {
  const creatures = {};
  for (const f of list('assets/sprites/creatures', /^[a-z0-9_]+_(front|back)\.png$/)) {
    const m = f.match(/^([a-z0-9_]+)_(front|back)\.png$/), size = pngSize(path.join(ROOT, 'assets/sprites/creatures', f));
    if (!size) continue;
    const c = creatures[m[1]] = creatures[m[1]] || {};
    c[m[2]] = stamped('assets/sprites/creatures', f);
    if (m[2] === 'front') { c.w = size.w; c.h = size.h; }
  }
  for (const k of Object.keys(creatures)) if (!creatures[k].front) delete creatures[k];   // a back view alone is no use
  const sounds = {};
  for (const f of list('assets/audio/tactics', /\.(mp3|ogg|wav)$/)) sounds[f.replace(/\.[a-z0-9]+$/, '')] = stamped('assets/audio/tactics', f);
  const icons = {};
  for (const f of list('assets/tactics/icons', /^[a-z0-9_]+\.png$/)) icons[f.replace(/\.png$/, '')] = stamped('assets/tactics/icons', f);
  return { creatures, sounds, icons, music: list('assets/audio/tactics/music', /\.(mp3|ogg)$/).map(f => stamped('assets/audio/tactics/music', f)) };
}
if (require.main === module) {
  const out = build();
  fs.mkdirSync(path.join(ROOT, 'assets/tactics'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'assets/tactics/manifest.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`creatures with art: ${Object.keys(out.creatures).length} · ability icons: ${Object.keys(out.icons).length} · sounds: ${Object.keys(out.sounds).length} · music tracks: ${out.music.length}`);
}
module.exports = { build, pngSize };
