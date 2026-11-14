'use strict';
// Accessibility: labelled icon buttons, dialog roles, Escape, focus, toasts.
//   node verify/a11y_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
// Dev Tools' markup lives in dev.html since Phase 4 step 5 (loaded for admins
// only, js/dev-tools.js): reading the page includes it.
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8') + (f === 'index.html' ? '\n' + fs.readFileSync(path.join(ROOT, 'dev.html'), 'utf8') : '');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

// A <button> whose only content is a symbol (no letters, no template text).
function unlabelled(file) {
  const s = read(file), bad = [];
  const re = /<button\b([^>]*)>([^<]{0,12})<\/button>/g; let m;
  while ((m = re.exec(s))) {
    const [, attrs, inner] = m;
    if (/aria-label/.test(attrs) || /\$\{|' \+|" \+/.test(inner)) continue;
    const t = inner.replace(/&[a-z]+;/g, '').trim();
    if (!t || /[A-Za-z0-9]/.test(t.replace(/\\u2715/g, ''))) continue;
    bad.push(`${file}:${s.slice(0, m.index).split('\n').length} ${t}`);
  }
  return bad;
}

console.log('1. Icon buttons have names');
{
  const files = ['index.html', ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];
  const bad = files.flatMap(unlabelled);
  check('1a. every icon-only button (✕, arrows, ＋/－, ?, ✏, 🗑…) has an aria-label', bad.length === 0, bad.slice(0, 8).join(', '));
  const H = read('index.html');
  check('1b. e.g. map pan and zoom', /panCamera\(0,-3\)" aria-label="Pan up"/.test(H) && /aria-label="Zoom in">＋/.test(H) && /aria-label="Zoom out">－/.test(H));
  check('1c. every ✕ close button in the page is named', !/<button[^>]*class="[^"]*close[^"]*"(?![^>]*aria-label)[^>]*>✕<\/button>/.test(H));
}

console.log('2. Windows are dialogs');
{
  const H = read('index.html');
  const ids = ['diplomacy-modal', 'noticeboard-modal', 'quests-modal', 'inventory-modal', 'housing-modal', 'citizen-profile-modal', 'all-citizens-modal',
    'cheat-modal', 'online-modal', 'community-modal', 'tier-upgrade-modal', 'tier-celebration-modal', 'profile-modal', 'view-profile-modal', 'map-preview-modal', 'settings-backdrop'];
  const miss = ids.filter(id => { const i = H.indexOf(`id="${id}"`); if (i < 0) return true; const after = H.slice(i, i + 700); return !/role="dialog" aria-modal="true" aria-(label|labelledby)="[^"]+"/.test(after); });
  check('2a. each modal in the page is a named, modal dialog', miss.length === 0, miss.join(', '));
  const lb = [...H.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1]).filter(id => !H.includes(`id="${id}"`) && !/ar-title|jn-title|rs-title|kwd-title/.test(id));
  check('2b. every aria-labelledby points at a real title', lb.length === 0, lb.join(', '));
  check('2c. screens built in JS are dialogs too', /role="dialog" aria-modal="true" aria-labelledby="jn-title"/.test(read('js/journeys.js')) && /role="\$\{kind === 'alert' \? 'alertdialog' : 'dialog'\}" aria-modal="true"/.test(read('js/dialog.js')) && /role="dialog" aria-modal="true" aria-labelledby="ar-title"/.test(read('js/away-report.js')));
}

console.log('3. Keyboard and announcements');
{
  const A = read('js/a11y.js');
  check('3a. one Escape handler closes the topmost window via its own close button, and stops there', /addEventListener\('keydown', onKey, true\)/.test(A) && /function topmost\(\)/.test(A) && /e\.stopImmediatePropagation\(\);\s*btn\.click\(\);/.test(A));
  check('3b. …leaving in-game dialogs, and fields with text, to themselves', /KWDialog\.isOpen\(\)\) return/.test(A) && /INPUT\|TEXTAREA\|SELECT/.test(A));
  check('3c. loaded on the page', /\/js\/a11y\.js\?v=/.test(read('index.html')));
  check('3d. keyboard focus is always visible', /:where\(button, \[role="button"\], a, summary, select, input, textarea, \[tabindex\]\):focus-visible \{\s*outline: 2px solid/.test(read('css/dialog.css')));
  check('3e. toasts are announced', /id="toast-stack" class="toast-stack" role="status" aria-live="polite"/.test(read('index.html')) && /toast\.setAttribute\('role', 'status'\)/.test(read('js/buildings.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
