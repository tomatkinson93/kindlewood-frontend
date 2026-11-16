#!/usr/bin/env node
'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  stamp_versions — every local script and stylesheet in index.html gets
//  ?v=<hash of its contents>.
//
//    node scripts/stamp_versions.js           rewrite index.html
//    node scripts/stamp_versions.js --check   list stale stamps; exit 1 if any
//
//  The site is served from the repository's files as they are (Porkbun), so
//  the ?v= is the only thing that tells a browser a file changed. Without it
//  a phone can keep yesterday's stylesheet beside today's script. Run this
//  before committing a change to any file under js/ or css/; the proofs
//  (verify/assets_proofs.js) fail when a stamp is out of date.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TAG = /(["'])\/((?:js|css)\/[^"'?]+)\?v=([^"']*)\1/g;

const stampOf = buf => 'h' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);

// → [{ file, current, want }] for every local tag in `html`.
function stamps(html, root = ROOT) {
  const out = [];
  for (const m of html.matchAll(TAG)) {
    const p = path.join(root, m[2]);
    if (!fs.existsSync(p)) { out.push({ file: m[2], current: m[3], want: null }); continue; }
    out.push({ file: m[2], current: m[3], want: stampOf(fs.readFileSync(p)) });
  }
  return out;
}

function stamp(html, root = ROOT) {
  return html.replace(TAG, (all, q, file, v) => {
    const p = path.join(root, file);
    return fs.existsSync(p) ? `${q}/${file}?v=${stampOf(fs.readFileSync(p))}${q}` : all;
  });
}

if (require.main === module) {
  const file = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  if (process.argv.includes('--check')) {
    const stale = stamps(html).filter(s => s.want && s.current !== s.want);
    stale.forEach(s => console.log(`stale: ${s.file} ?v=${s.current} (should be ${s.want})`));
    console.log(stale.length ? `${stale.length} stale — run node scripts/stamp_versions.js` : 'all stamps current');
    process.exit(stale.length ? 1 : 0);
  }
  const next = stamp(html);
  const changed = stamps(html).filter(s => s.want && s.current !== s.want).length;
  fs.writeFileSync(file, next);
  console.log(`stamped ${changed} file(s)`);
}

module.exports = { stamps, stamp, stampOf };
