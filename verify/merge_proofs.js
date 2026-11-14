'use strict';
// Phase 4 step 6: the small duplicate screens merge (docs/LAYOUT_SPEC.md §2.8):
// Journeys folds into The Land's panel; the stores drop-down folds into the
// one Stores screen (Home's Stores chip). The outpost trim has its own
// proofs (verify/outpost_store_proofs.js).
//   node verify/merge_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const JN = read('js/journeys.js'), CZ = read('js/citizens.js'), OP = read('js/outposts.js'), INV = read('js/inventory.js'), ST = read('js/stores.js'), H = read('index.html');

console.log('1. Journeys folds into The Land');
{
  check('1a. with the places it opens in the context panel (the sheet on phones), not its own window', /const inPanel = \(\) => !!global\.KWPlaces/.test(JN) && /if \(phone\(\)\) \{ if \(global\.KWShell\) global\.KWShell\.openPanel\(\); \} else if \(global\.KWContext\) global\.KWContext\.open\(\)/.test(JN));
  check('1b. its own view in the panel: on the road, at outposts, village requests', /id = 'panel-journeys-view'/.test(JN) && /id="jn-body"/.test(JN));
  check('1c. from Home it goes to The Land first', /if \(global\.KWPlaces\.current\(\) !== 'land'\) global\.KWPlaces\.go\('land'\)/.test(JN));
  check('1d. "Show on map" moves the map and keeps the list open beside it (a phone\'s sheet steps aside)', /Beside the map on desktop the list stays open/.test(JN));
  check('1e. another view taking the panel hides it (the map view, citizens, outposts)', /KWJourneys\.hideView\(\)/.test(CZ) && (CZ.match(/KWJourneys\.hideView\(\)/g) || []).length === 2 && /KWJourneys\.hideView\(\)/.test(OP));
  check('1f. its countdowns stop once it is closed', /if \(!isOpen\(\)\) \{ if \(_timer\) \{ clearInterval\(_timer\); _timer = null; \} return; \}/.test(JN));
}

console.log('2. One Stores screen');
{
  check('2a. the inventory is "Stores", with an Ores & alloys tab', /<div class="inv-title">🎒 Stores<\/div>/.test(H) && /data-cat="ores" onclick="invSetTab\('ores',this\)">⛏ Ores &amp; alloys/.test(H) && /aria-label="Stores"/.test(H));
  check('2b. that tab shows the ores, rare materials and alloys (the old drop-down\'s list)', /_inventoryTab === 'ores'/.test(INV) && /KWStores\.oresHtml\(\)/.test(INV) && /function oresHtml\(\)/.test(ST));
  check('2c. the top bar\'s chip opens Stores on that tab (the drop-down is gone with the places)', /openInventoryModal\('ores'\)/.test(ST) && /if \(window\.KWPlaces && typeof openInventoryModal === 'function'\)/.test(ST));
  check('2d. opened straight onto ores, the items load on the first switch', /if \(cat !== 'ores' && !_invLoadedAt\) \{ loadInventory\(\); return; \}/.test(INV));
  check('2e. the list stays current while it is showing', /if \(oresShowing\(\) && typeof renderInventory === 'function'\) renderInventory\(\)/.test(ST));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
