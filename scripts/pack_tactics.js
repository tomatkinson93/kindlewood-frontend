#!/usr/bin/env node
// Lists the tactics battles' art and sound for the game (docs/TACTICS_ASSETS.md).
// Run it after adding or removing files:
//
//   node scripts/pack_tactics.js
//
// It reads
//   assets/sprites/creatures/foes.json and the sheets it names (scripts/pack_foes.py makes them from art/tactics/foes/)
//   assets/tactics/icons/<ability key>.png
//   assets/audio/tactics/<name>.mp3 (or .ogg, .wav)
//   assets/audio/tactics/music/<place>-<title>.mp3
//   assets/tactics/status/<status>.png
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
// A music file is named <place>-<title-in-words>.mp3. The place is a land (plains, forest, hills, mountain,
// river, marsh, ruins), or boss, or boss-withered; the game plays a track where it belongs, and the jukebox
// page shows that place behind it. → [{ key, file, place, title }]
const PLACES = ['boss-withered', 'boss', 'plains', 'forest', 'hills', 'mountain', 'river', 'marsh', 'ruins'];
const SMALL = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'and', 'but', 'or', 'for', 'no']);
function tracks() {
  return list('assets/audio/tactics/music', /\.(mp3|ogg)$/).map(f => {
    const key = f.replace(/\.[a-z0-9]+$/, ''), place = PLACES.find(p => key === p || key.startsWith(p + '-')) || null;
    const words = (place ? key.slice(place.length + 1) : key).split(/[-_]+/).filter(Boolean);
    const title = words.map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ') || key;
    return { key, file: stamped('assets/audio/tactics/music', f), place, title };
  });
}
function build() {
  // Foes with art: what scripts/pack_foes.py made of each PixelLab export (one row of four facings, and a face).
  const creatures = {};
  let foes = {};
  try { foes = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/sprites/creatures/foes.json'), 'utf8')); } catch (e) { /* none packed yet */ }
  for (const key of Object.keys(foes).sort()) {
    const f = foes[key];
    if (!fs.existsSync(path.join(ROOT, 'assets/sprites/creatures', f.file))) continue;
    creatures[key] = { file: stamped('assets/sprites/creatures', f.file), face: f.face && fs.existsSync(path.join(ROOT, 'assets/sprites/creatures', f.face)) ? stamped('assets/sprites/creatures', f.face) : null,
      dirs: f.dirs, w: f.w, h: f.h, foot: f.foot, scale: f.scale };
  }
  const sounds = {};
  for (const f of list('assets/audio/tactics', /\.(mp3|ogg|wav)$/)) sounds[f.replace(/\.[a-z0-9]+$/, '')] = stamped('assets/audio/tactics', f);
  const icons = {};
  for (const f of list('assets/tactics/icons', /^[a-z0-9_]+\.png$/)) icons[f.replace(/\.png$/, '')] = stamped('assets/tactics/icons', f);
  const status = {};
  for (const f of list('assets/tactics/status', /^[a-z0-9_]+\.png$/)) status[f.replace(/\.png$/, '')] = stamped('assets/tactics/status', f);
  return { creatures, sounds, icons, status, tracks: tracks(), music: list('assets/audio/tactics/music', /\.(mp3|ogg)$/).map(f => stamped('assets/audio/tactics/music', f)) };
}
if (require.main === module) {
  const out = build();
  fs.mkdirSync(path.join(ROOT, 'assets/tactics'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'assets/tactics/manifest.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`creatures with art: ${Object.keys(out.creatures).length} · ability icons: ${Object.keys(out.icons).length} · status pips: ${Object.keys(out.status).length} · sounds: ${Object.keys(out.sounds).length} · music tracks: ${out.music.length}`);
}
module.exports = { build, pngSize, tracks, PLACES };
