'use strict';
// KWWindow (js/window.js, css/window.css) and design tokens (css/tokens.css).
// docs/LAYOUT_SPEC.md §3, §4 and §7. Focus, Tab and Escape in a real browser
// are checked by a Playwright pass (see the handover); these need no browser.
//   node verify/window_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const store = {};
const w = { console, sessionStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = String(v); } } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/window.js'), w);
const K = w.KWWindow;
const J = read('js/window.js'), C = read('css/window.css'), T = read('css/tokens.css'), H = read('index.html');

console.log('1. The markup');
{
  const h = K._html({ id: 'families', title: 'Families <&>', subtitle: '3 lines', icon: 'families', size: 'L', help: 'families',
    tabs: [{ key: 'lines', label: 'Family lines' }, { key: 'tree', label: 'Tree', badge: 2 }] }, 7, 'lines');
  check('1a. a modal dialog labelled by its title', /<section class="kww kww-L" role="dialog" aria-modal="true" aria-labelledby="kww-7-title" tabindex="-1"/.test(h));
  check('1b. one close button, labelled Close', (h.match(/aria-label="Close"/g) || []).length === 1 && /data-kww-act="close"/.test(h));
  check('1c. the title is escaped', /Families &lt;&amp;&gt;/.test(h));
  check('1d. a sprite icon, a subtitle and the help "?"', /<use href="#kw-i-families">/.test(h) && /class="kww-sub">3 lines/.test(h) && /data-kww-act="help" aria-label="How this works"/.test(h));
  check('1e. tabs are a tablist; the open tab is selected and focusable, others not', /role="tablist"/.test(h)
    && /id="kww-7-tab-lines"\s+aria-selected="true" aria-controls="kww-7-body" tabindex="0"/.test(h)
    && /id="kww-7-tab-tree"\s+aria-selected="false" aria-controls="kww-7-body" tabindex="-1"/.test(h));
  check('1f. the body is the tab panel', /class="kww-body" id="kww-7-body" role="tabpanel" aria-labelledby="kww-7-tab-lines"/.test(h));
  const plain = K._html({ id: 'x', title: 'Note', icon: '🍂' }, 8, null);
  check('1g. no tabs: no tablist, no tabpanel role; no help button; an emoji icon', !/tablist/.test(plain) && !/role="tabpanel"/.test(plain) && !/data-kww-act="help"/.test(plain) && /kww-emoji/.test(plain));
  check('1h. an unknown size falls back to M', /kww kww-M/.test(K._html({ id: 'y', title: 'Y', size: 'XL' }, 9, null)));
  check('1i. no inline onclick in the component', !/onclick=/.test(J));
}

console.log('2. Opening, stacking, tabs and memory');
{
  let renders = 0, closed = 0;
  const a = K.open({ id: 'a', title: 'A', tabs: [{ key: 'one', label: '1' }, { key: 'two', label: '2' }], render() { renders++; }, onClose() { closed++; } });
  const b = K.open({ id: 'b', title: 'B' });
  check('2a. windows stack in the order opened', K._stack.map(x => x.id).join() === 'a,b' && K.top() === b);
  const again = K.open({ id: 'a', title: 'A' });
  check('2b. opening an id again returns the same window and brings it to the front', again === a && K.top() === a && K._stack.length === 2);
  check('2c. the first tab opens by default', a.tab === 'one');
  a.setTab('two');
  check('2d. setTab switches and remembers the tab for the session', a.tab === 'two' && K._mem().a.tab === 'two');
  a.setTab('nope');
  check('2e. an unknown tab is ignored', a.tab === 'two');
  check('2f. close removes only that window and calls onClose', a.close() === true && closed === 1 && K.top() === b && !K.isOpen('a'));
  const a2 = K.open({ id: 'a', title: 'A', tabs: [{ key: 'one', label: '1' }, { key: 'two', label: '2' }] });
  check('2g. reopened, it comes back on the remembered tab', a2.tab === 'two');
  K.closeAll();
  check('2h. closeAll empties the stack', K._stack.length === 0 && !K.isOpen());
  check('2i. render runs on open and tab change (and on refresh)', /function draw\(w/.test(J) && /draw\(w\);\s*return w;\s*}\s*\n\s*function bringToFront/.test(J) && /refresh\(\) \{ draw\(w, \{ keepScroll: true \}\)/.test(J));
}

console.log('3. Keys, focus and layers (source)');
{
  check('3a. Escape closes the top window only, and not while a confirm is open', /e\.key === 'Escape'/.test(J) && /closeWindow\(w\)/.test(J) && /KWDialog\.isOpen\(\)\) return/.test(J) && /const w = top\(\)/.test(J));
  check('3b. a field with text keeps Escape (it clears first)', /INPUT\|TEXTAREA\|SELECT/.test(J) && /t\.value && w\.card\.contains\(t\)/.test(J));
  check('3c. Tab stays inside the window', /e\.key === 'Tab'/.test(J) && /f\[f\.length - 1\]\.focus\(\)/.test(J) && /f\[0\]\.focus\(\)/.test(J));
  check('3d. focus moves in on open and back to the opener on close', /w\.opener = doc\.activeElement/.test(J) && /back\.focus\(/.test(J) && /focusInto\(w\);\s*return w;/.test(J));
  check('3e. arrow keys move between tabs', /ArrowRight/.test(J) && /ArrowLeft/.test(J));
  check('3f. each window gets the window layer plus its place in the stack', /calc\(var\(--z-window\) \+ \$\{i\}\)/.test(J));
  check('3g. one click listener per window; data-action calls the window\'s actions', /addEventListener\('click', e => onClick\(w, e\)\)/.test(J) && /w\.opts\.actions && w\.opts\.actions\[a\.getAttribute\('data-action'\)\]/.test(J));
  check('3h. a render error shows a note instead of a blank window', /catch \(e\)[\s\S]{0,120}kw-note bad/.test(J));
  check('3i. the old Escape helper stands aside while a window is open', /KWWindow\.isOpen\(\)\) return/.test(read('js/a11y.js')));
  check('3j. phones: any open window hides the tab bar (no id list needed)', /document\.querySelector\('\.kww-backdrop'\)/.test(read('js/mobile-shell.js')));
}

console.log('4. Sizes and the phone sheet (CSS)');
{
  const rule = sel => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(C); return m ? m[1] : ''; };
  check('4a. S 420 · M 680 · L 980×720 · full', /width: 420px/.test(rule('.kww-S')) && /width: 680px/.test(rule('.kww-M')) && /width: 980px; height: min\(720px, 100%\)/.test(rule('.kww-L')) && /width: 100%;\s*height: 100%/.test(rule('.kww-full')));
  check('4b. every size has a fixed height, and the body scrolls (tabs never resize it)', ['.kww-S', '.kww-M', '.kww-L'].every(s => /height:/.test(rule(s))) && /overflow-y: auto/.test(rule('.kww-body')) && /min-height: 0/.test(rule('.kww-body')));
  check('4c. below 760px or on a landscape touch screen every size is a full-screen sheet',
    /@media \(max-width: 759px\), \(pointer: coarse\) and \(orientation: landscape\) and \(max-height: 560px\) \{[\s\S]*?\.kww, \.kww-S, \.kww-M, \.kww-L, \.kww-full \{\s*width: 100%; height: 100%;/.test(C));
  check('4d. touch targets: header buttons, tabs and buttons are at least the touch size', /width: var\(--kw-touch\); height: var\(--kw-touch\)/.test(C) && /\.kw-tabs-item \{[^}]*min-height: var\(--kw-touch\)/.test(C) && /\.kw-btn \{[^}]*min-height: var\(--kw-touch\)/.test(C));
}

console.log('5. Tokens and the style check');
{
  check('5a. tokens.css is loaded first', H.indexOf('/css/tokens.css?v=') > 0 && H.indexOf('/css/tokens.css?v=') < H.indexOf('/css/main.css?v='));
  check('5b. the palette moved there; hud-storybook no longer defines it', /--kw-ink:\s+#1d150d/.test(T) && !/--kw-ink:/.test(read('css/hud-storybook.css')));
  check('5c. the new roles exist: bad, warn, panel, panel-2, line', ['--kw-bad:', '--kw-warn:', '--kw-panel:', '--kw-panel-2:', '--kw-line:'].every(t => T.includes(t)));
  const Z = ['--z-view', '--z-hud', '--z-float', '--z-say', '--z-window', '--z-confirm', '--z-system'];
  check('5d. seven named layers, in order', Z.every(z => T.includes(z + ':')) && Z.map(z => Number(new RegExp(z + ':\\s*(\\d+)').exec(T)[1])).every((v, i, a) => i === 0 || v > a[i - 1]));
  check('5e. type scale 12 / 13.5 / 15 / 18 / 22 and space 4 / 8 / 12 / 16 / 24', /--kw-fs-1: 12px;[\s\S]*--kw-fs-2: 13.5px;[\s\S]*--kw-fs-3: 15px;[\s\S]*--kw-fs-4: 18px;[\s\S]*--kw-fs-5: 22px;/.test(T) && /--kw-s-1: 4px;[\s\S]*--kw-s-5: 24px;/.test(T));
  // New and migrated CSS: no raw colours, no raw z-index, no !important.
  const NEW_CSS = ['css/window.css', 'css/places.css', 'css/context.css', 'css/news.css'];
  const bad = [];
  for (const f of NEW_CSS) {
    read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((line, i) => {
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line)) bad.push(`${f}:${i + 1} colour`);
      if (/z-index:\s*-?\d/.test(line)) bad.push(`${f}:${i + 1} z-index`);
      if (/!important/.test(line)) bad.push(`${f}:${i + 1} !important`);
    });
  }
  check('5f. style check: new CSS uses tokens only (no raw colour, z-index or !important)', bad.length === 0, bad.slice(0, 6).join(', '));
  check('5g. confirms sit in the confirm layer, above windows', /z-index: var\(--z-confirm\)/.test(read('css/dialog.css')));
}

console.log('6. Shared pieces and wiring');
{
  check('6a. kw-btn (primary, quiet, danger, small), kw-tabs, kw-box, kw-chip (short), kw-bar, kw-list-row, kw-empty, kw-note (good, warn, bad)',
    ['.kw-btn {', '.kw-btn.primary', '.kw-btn.quiet', '.kw-btn.danger', '.kw-btn.small', '.kw-tabs {', '.kw-box {', '.kw-chip {', '.kw-chip.short', '.kw-bar {', '.kw-list-row {', '.kw-empty {', '.kw-note {', '.kw-note.good', '.kw-note.warn', '.kw-note.bad'].every(s => C.includes(s)));
  check('6b. none of them reuse a class the old screens own (kw-card, kw-tab, kw-row, kw-item)', !/\.kw-(card|tab|row|item)[\s.:{,]/.test(C));
  check('6c. the page loads window.css and window.js', /\/css\/window\.css\?v=/.test(H) && /\/js\/window\.js\?v=/.test(H));
  check('6d. the sprite has close, help, back and families icons', ['kw-i-close', 'kw-i-help', 'kw-i-back', 'kw-i-families'].every(i => H.includes(`<symbol id="${i}"`)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
