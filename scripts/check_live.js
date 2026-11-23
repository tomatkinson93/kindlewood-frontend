#!/usr/bin/env node
'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  check_live — is the site that is live the site in this folder?
//
//    node scripts/check_live.js                      checks https://kindlewood.quest
//    node scripts/check_live.js https://example.org  another address
//
//  The site is uploaded by hand, and a file left behind does not show as an
//  error: the page simply runs yesterday's stylesheet beside today's script
//  (2026-11-22: the battle's end screen came up unstyled because
//  css/tactics.css had not gone up, and the browser was playing by older
//  rules than the server because js/tactics-engine.js had not either).
//
//  This fetches index.html and every script and stylesheet it names, plus the
//  lists the game reads art and sound from and the files those lists name,
//  and compares each with the copy here (line endings aside: an upload from
//  Windows may change them). It prints what to upload, and exits 1 if
//  anything differs. Run it after every upload, from the branch that was
//  uploaded (normally main).
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE = (process.argv[2] || 'https://kindlewood.quest').replace(/\/+$/, '');
const TEXT = /\.(js|css|html|json|txt|svg)$/i;

const sha = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
// A text file's fingerprint ignores \r, so CRLF and LF copies of the same file agree.
const fingerprint = (file, buf) => sha(TEXT.test(file) ? Buffer.from(buf.toString('utf8').replace(/\r/g, '')) : buf);

// Node's own fetch (Node 18 and later). → { status (0 when it could not be reached), body, modified }
async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'check_live', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()), modified: res.headers.get('last-modified') || '' };
  } catch (e) { return { status: 0, body: Buffer.alloc(0), modified: '' }; }
}

// Every file the page needs that this folder can vouch for: [path relative to the site's root].
function wanted() {
  const files = new Set();
  // The game's page, and the pages that stand on their own (the jukebox), with every script and stylesheet they name.
  for (const page of ['index.html', 'jukebox.html']) {
    if (!fs.existsSync(path.join(ROOT, page))) continue;
    files.add(page);
    for (const m of fs.readFileSync(path.join(ROOT, page), 'utf8').matchAll(/["']\/((?:js|css)\/[^"'?]+)\?v=/g)) files.add(m[1]);
  }
  // Dev Tools loads its own scripts and stylesheets (js/dev-tools.js lists them).
  const dt = fs.existsSync(path.join(ROOT, 'js/dev-tools.js')) ? fs.readFileSync(path.join(ROOT, 'js/dev-tools.js'), 'utf8') : '';
  for (const m of dt.matchAll(/'\/((?:js|css)\/[^'?]+)(?:\?[^']*)?'/g)) files.add(m[1]);
  // The battle's art, sound and music, by the list the game reads.
  const add = f => { if (fs.existsSync(path.join(ROOT, f))) files.add(f); };
  const man = 'assets/tactics/manifest.json';
  if (fs.existsSync(path.join(ROOT, man))) {
    files.add(man);
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, man), 'utf8')), bare = s => String(s).replace(/\?.*$/, '');
    for (const f of Object.values(j.sounds || {})) add('assets/audio/tactics/' + bare(f));
    for (const f of j.music || []) add('assets/audio/tactics/music/' + bare(f));
    for (const f of Object.values(j.icons || {})) add('assets/tactics/icons/' + bare(f));
    for (const f of Object.values(j.status || {})) add('assets/tactics/status/' + bare(f));
    add('assets/tactics/demo.json');      // the battles the jukebox page shows
    for (const c of Object.values(j.creatures || {})) for (const k of ['front', 'back']) if (c[k]) add('assets/sprites/creatures/' + bare(c[k]));
  }
  // The villagers' sheets.
  const vil = 'assets/sprites/villagers/villagers.json';
  if (fs.existsSync(path.join(ROOT, vil))) {
    files.add(vil);
    for (const m of fs.readFileSync(path.join(ROOT, vil), 'utf8').matchAll(/"file"\s*:\s*"([^"]+)"/g)) add('assets/sprites/villagers/' + m[1]);
  }
  return [...files].filter(f => fs.existsSync(path.join(ROOT, f)));
}

async function main() {
  const files = wanted();
  console.log(`Checking ${files.length} files on ${SITE} against ${ROOT}\n`);
  const stale = [], missing = [], unreachable = [];
  let i = 0;
  const work = async () => {
    while (i < files.length) {
      const f = files[i++];
      const r = await get(`${SITE}/${f}?check=${Date.now()}${i}`);
      if (r.status === 0) unreachable.push(f);
      else if (r.status !== 200) missing.push({ f, status: r.status });
      else if (fingerprint(f, r.body) !== fingerprint(f, fs.readFileSync(path.join(ROOT, f)))) stale.push({ f, modified: r.modified });
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  if (unreachable.length === files.length) { console.log('The site could not be reached.'); process.exit(2); }
  const by = (a, b) => (a.f < b.f ? -1 : 1);
  if (stale.length) {
    console.log(`OUT OF DATE on the site (${stale.length}): upload these again`);
    for (const s of stale.sort(by)) console.log(`  ${s.f}${s.modified ? `   (the site's copy is from ${s.modified})` : ''}`);
  }
  if (missing.length) {
    console.log(`${stale.length ? '\n' : ''}NOT ON THE SITE (${missing.length}): upload these`);
    for (const s of missing.sort(by)) console.log(`  ${s.f}   (HTTP ${s.status})`);
  }
  if (unreachable.length) console.log(`\n${unreachable.length} could not be fetched (try again): ${unreachable.slice(0, 5).join(', ')}${unreachable.length > 5 ? ', …' : ''}`);
  if (!stale.length && !missing.length && !unreachable.length) console.log(`All ${files.length} files on the site match this folder.`);
  process.exit(stale.length || missing.length || unreachable.length ? 1 : 0);
}
if (require.main === module) main();
module.exports = { wanted, fingerprint };
