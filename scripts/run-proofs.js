// Runs every verify/*_proofs.js and prints one line each; exits 1 if any failed.
//   npm run proofs
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let bad = 0, passed = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'verify')).filter(x => x.endsWith('_proofs.js')).sort()) {
  const r = spawnSync(process.execPath, [path.join('verify', f)], { cwd: ROOT, encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop() || '';
  const m = /(\d+) passed, (\d+) failed/.exec(last);
  const ok = r.status === 0 && (!m || m[2] === '0');
  if (m) passed += Number(m[1]);
  if (!ok) { bad++; console.log(`✘ ${f}  ${last}`); console.log((r.stdout || '').split('\n').filter(l => l.includes('✘')).join('\n')); }
  else console.log(`✔ ${f}  ${last}`);
}
console.log(`──\n${passed} checks passed; ${bad} file(s) failing`);
process.exit(bad ? 1 : 0);
