'use strict';
// The Dev Tools markup lives in kindlewood-server (admin/dev-tools.html),
// served only to admins by GET /api/dev-tools (Phase 4 step 5). The proofs
// that check its buttons read it from the server repo beside this one
// (KW_SERVER_DIR, else ../kindlewood-server). The deploy workflow runs these
// proofs with the frontend alone: there, checks about Dev Tools are skipped
// and say so; the full suite (kindlewood-server scripts/test_all.sh) runs them.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(process.env.KW_SERVER_DIR || path.join(ROOT, '..', 'kindlewood-server'), 'admin', 'dev-tools.html');

function devMarkup() {
  try { return fs.readFileSync(FILE, 'utf8'); } catch (e) { return ''; }
}
const HAVE = !!devMarkup();
// Wraps a proof's check(): without the markup, a check about Dev Tools is
// skipped (counted as passed, marked "skipped"), every other check runs.
function devAware(check) {
  if (HAVE) return check;
  return (name, ok, extra) => (/Dev Tools/i.test(name)
    ? (console.log('  – ' + name + ' — skipped: the Dev Tools markup is in kindlewood-server'), check(name, true))
    : check(name, ok, extra));
}
module.exports = { devMarkup, devAware, HAVE, FILE };
