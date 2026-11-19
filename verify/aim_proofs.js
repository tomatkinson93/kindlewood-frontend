'use strict';
// Aiming a card on the battle screen (js/combat-ui.js, js/card-hand-ui.js,
// css/card-hand-ui.css). One click on a card selects it; every unit it could
// be played on stands in a ring; the one under the pointer is marked, an arrow
// runs to it and a line names it; a click there plays the card.
//   node verify/aim_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const CU = read('js/combat-ui.js'), HU = read('js/card-hand-ui.js'), CSS = read('css/card-hand-ui.css');

console.log('1. One click with a mouse, wherever the mouse is');
{
  check('1a. the pointer in use decides between mouse and touch, not the device', /var _lastPointer = null;/.test(HU) && /\['pointerdown', 'pointermove'\]\.forEach\(function \(t\) \{\s*document\.addEventListener\(t, function \(e\) \{ if \(e && e\.pointerType\) _lastPointer = e\.pointerType; \}, true\);/.test(HU));
  check('1b. the "(hover: none)" answer is used only before any pointer has moved', /function _isTouchInput\(\) \{\s*if \(_lastPointer\) return _lastPointer === 'touch';\s*return !!\(window\.matchMedia && window\.matchMedia\('\(hover: none\)'\)\.matches\);/.test(HU));
  check('1c. a finger still gets the two taps: the first lifts the card to read it', /if \(_isTouchInput\(\) && idx !== pendingIndex &&\s*!btn\.classList\.contains\('kw-card-tap-selected'\)\) \{/.test(HU));
  check('1d. a card played on a unit: the first click selects it, a click on a unit plays it', /_pendingCard = \{ handIndex: handIndex, card: card, targetsUnits: targetsUnits \};/.test(CU) && /if \(_pendingCard && _pendingCard\.targetsUnits\) \{\s*const handIndex = _pendingCard\.handIndex;\s*_pendingCard = null;\s*_executeCardPlay\(handIndex, targetId\);/.test(CU));
  check('1e. the words match what a second click does: cancel a unit card, play a self card', /Choose a target for <b>' \+ _escapeHtml\(cardName\) \+ '<\/b> \\u2014 or click the card again to cancel\./.test(CU) && /Click <b>' \+ _escapeHtml\(cardName\) \+ '<\/b> again to play it \\u2014 or pick another card\./.test(CU));
}

console.log('2. Who the card would hit');
{
  check('2a. only a unit the card can be played on can be aimed at', /const valid = CC\.validTargets\(_battle, cur, card\)\.map\(u => u\.id\);\s*if \(valid\.indexOf\(unitId\) === -1\) return \[\];/.test(CU));
  check('2b. an area card marks everyone it hits', /if \(mode && mode\.aoe\) return valid;/.test(CU));
  check('2c. a piercing card marks the line it runs down', /if \(card\.hit === 'pierce'\) \{[\s\S]*?return line\.slice\(0, card\.pierce_count != null \? card\.pierce_count : line\.length\)\.map\(u => u\.id\);/.test(CU));
  check('2d. otherwise only the unit under the pointer', /return \[unitId\];\n  \}\n  function _aimLine/.test(CU));
  check('2e. the sprite and the info card of an aimed unit are both marked', /modal\.querySelectorAll\('\.cm-bf-sprite, \.cm-unit'\)\.forEach\(n => \{\s*const id = n\.getAttribute\('data-sprite-id'\) \|\| n\.getAttribute\('data-unit-id'\);\s*n\.classList\.toggle\('is-aimed', hits\.indexOf\(id\) !== -1\);/.test(CU));
  check('2f. pointing at either one aims (and so does keyboard focus)', /closest\('\.cm-bf-sprite\.is-targetable, \.cm-unit\.is-targetable'\)/.test(CU) && /root\.addEventListener\('mouseover', over\);\s*root\.addEventListener\('focusin', over\);/.test(CU));
  check('2g. nothing is aimed unless a unit card is selected in a live battle', /const aiming = !!\(_battle && _battle\.status === 'active' && _pendingCard && _pendingCard\.targetsUnits\);\s*if \(!aiming\) _aim\.id = null;/.test(CU));
  check('2h. aiming plays nothing: a click still goes through combatSelectTarget', !/_executeCardPlay/.test(CU.slice(CU.indexOf('function _aimHits'), CU.indexOf('function _showModal'))));
  check('2i. it is worked out again after every redraw, and cleared when the screen closes', /_applyAim\(\);\s*if \(_pendingCard && _pendingCard\.targetsUnits\) requestAnimationFrame/.test(CU) && /_pendingCard = null;\s*_applyAim\(\);   \/\/ no card selected/.test(CU));
}

console.log('3. What the player sees');
{
  check('3a. a line in the scene: choose a target, then the card and the unit by name', /return '🎯 ' \+ name \+ ': choose a target';/.test(CU) && /return '🎯 ' \+ name \+ ' → ' \+ who;/.test(CU) && /id="cm-aim-banner" role="status" aria-live="polite"/.test(CU));
  check('3b. an arrow from the selected card to the aimed unit, or to the pointer on the way', /querySelector\('#combat-modal \.kw-card\.kw-card-pending'\)/.test(CU) && /if \(!to && aiming && _aim\.x != null\) to = \{ x: _aim\.x, y: _aim\.y \};/.test(CU) && /svg\.querySelector\('\.cm-aim-line'\)/.test(CU));
  check('3c. the arrow never takes a click', /#combat-modal \.cm-aim \{[^}]*pointer-events: none;/.test(CSS) && /#combat-modal \.cm-aim-banner \{[^}]*pointer-events: none;/.test(CSS));
  check('3d. a ring under every unit the card could be played on', /#combat-modal \.cm-bf-sprite\.is-targetable::after \{[^}]*border: 2px dashed var\(--kw-gold\);[^}]*pointer-events: none;/.test(CSS));
  check('3e. the aimed unit: a solid ring, red for a creature and green for a friend', /#combat-modal \.cm-bf-sprite\.is-aimed::after \{[^}]*border: 4px solid var\(--kw-bad\);/.test(CSS) && /#combat-modal \.cm-bf-sprite\.face-right\.is-aimed::after \{\s*border-color: var\(--kw-good\);/.test(CSS));
  check('3f. the arrow turns solid when it locks on', /#combat-modal \.cm-aim\.is-locked \.cm-aim-line \{ stroke: var\(--kw-bad\); stroke-dasharray: none;/.test(CSS));
  check('3g. the bobbing stops for reduced motion', /@media \(prefers-reduced-motion: reduce\) \{\s*#combat-modal \.cm-bf-sprite\.is-targetable, #combat-modal \.cm-unit\.is-targetable \{ animation: none; \}/.test(CSS));
  check('3h. a unit can be chosen from the keyboard', /tabindex="0" role="button" aria-label="Play the selected card on \$\{_escapeHtml\(unit\.name\)\}" onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/.test(CU) && /\.cm-unit\.is-targetable:focus-visible \{ outline: 3px solid var\(--kw-focus\)/.test(CSS));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
