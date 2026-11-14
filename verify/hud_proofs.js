'use strict';
// The top bar and the map's controls (docs/LAYOUT_SPEC.md §2.6, §2.7, Phase 4
// step 4): js/hud.js, css/hud.css, and the place bar's filigree.
//   node verify/hud_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/hud.js'), CSS = read('css/hud.css'), P = read('js/places.js'), PC = read('css/places.css'), MS = read('js/mobile-shell.js'), ST = read('js/stores.js'), H = read('index.html');

console.log('1. The top bar');
{
  check('1a. the version string leaves the bar for Settings › General (About)', /body\.kwh-on \.topbar-version \{ display: none; \}/.test(CSS) && /settings-eyebrow">About/.test(J) && /\.topbar-version/.test(J));
  check('1b. "+N in Stores" as a chip beside the five resources', /`\+\$\{extras\.length\} in Stores`/.test(ST) && /body\.kwh-on #res-stores \{[^}]*border-radius: 999px/.test(CSS));
  check('1c. phones: the resources scroll; wealth is pinned at the end', /body\.kw-shell\.kwh-on #res-wealth \{[^}]*order: 99;[^}]*position: sticky;[^}]*right: 0;/.test(CSS));
}

console.log('2. The map\'s controls');
{
  check('2a. one stack: Centre on town, Paths, zoom', /textContent = 'Centre on town'/.test(J) && /getElementById\('map-paths-btn'\)/.test(J) && /getElementById\('map-zoom-ctrls'\)/.test(J) && /stack\.appendChild\(paths\)/.test(J) && /stack\.appendChild\(zoom\)/.test(J));
  check('2b. lower left on desktop (the mockup), lower right on phones above the places, away from the stick', /\.kwh-stack \{[^}]*left: var\(--kw-s-4\);[^}]*bottom: var\(--kw-s-4\);/.test(CSS) && /body\.kw-shell \.kwh-stack \{[^}]*right: var\(--kw-s-3\);[^}]*bottom: calc\(var\(--kw-tabbar-h\)/.test(CSS));
  check('2c. "Paths: on" / "Paths: off", following the toggle', /'Paths: on' : 'Paths: off'/.test(J) && /attributeFilter: \['aria-pressed'\]/.test(J));
  check('2d. the Land\'s Centre chip went into the stack', !/key: 'centre'/.test(P));
  check('2e. it steps aside on Home and under full-screen overlays', /body\.kwp-home \.kwh-stack, body\.kw-shell\.kw-overlay \.kwh-stack \{ display: none; \}/.test(CSS));
}

console.log('3. The pan stick');
{
  check('3a. off unless chosen (dragging the map pans)', /return v === '1';\s*\} catch \(_\) \{ return false; \}/.test(MS));
  check('3b. a switch in Settings › General turns it on', /data-stick-setting/.test(J) && /KWShell\.setStick\(box\.checked\)/.test(J));
  check('3c. its cover check measures from the places\' bar (the chips moved to the top)', /var bar = document\.querySelector\('\.kwp-bar'\) \|\| document\.querySelector\('\.kw-tabbar'\);/.test(MS));
  check('3d. with it on, the moment cards sit above it', /classList\.toggle\('kw-stick-on', stickEnabled\(\)\)/.test(MS) && /body\.kw-shell\.kw-stick-on #kw-moments \{ bottom:/.test(CSS));
}

console.log('4. The place bar\'s filigree');
{
  check('4a. either side of the places: a line, a dot, a curl and a diamond, in currentColor', /orn\('l'\)/.test(P) && /orn\('r'\)/.test(P) && /stroke="currentColor"/.test(P) && /<circle cx="32"/.test(P));
  check('4b. gold, fading out towards the edges both ways; the right side mirrored', /\.kwp-orn \{[^}]*color: var\(--kw-gold-deep\)/.test(PC) && /linear-gradient\(to right, transparent, var\(--kw-gold-deep\)\)/.test(PC) && /\.kwp-orn-r \.kwp-orn-line \{ background: linear-gradient\(to left/.test(PC) && /\.kwp-orn-r \.kwp-orn-f \{ transform: scaleX\(-1\); \}/.test(PC));
  check('4c. desktop only; hidden from screen readers', /body\.kw-shell \.kwp-orn \{ display: none; \}/.test(PC) && /kwp-orn kwp-orn-\$\{side\}" aria-hidden="true"/.test(P));
  check('4d. hud.js and hud.css are loaded', /js\/hud\.js/.test(H) && /css\/hud\.css/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
