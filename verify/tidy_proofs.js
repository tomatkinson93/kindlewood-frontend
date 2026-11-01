'use strict';
// Unfinished bits are hidden, not promised (R2 tidy-up).
//   node verify/tidy_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const html = read('index.html');
const menu = html.slice(html.indexOf('id="profile-menu"'), html.indexOf('</div>', html.indexOf('logout-item')));
check('1. the profile menu has no "soon" items and no duplicate Switch Realm', !/coming-soon|Friends|Achievements|Switch Realm/.test(menu));
check('2. honors and the trophy cabinet are hidden until honors exist', (html.match(/<div class="pm-honors" hidden>/g) || []).length === 2 && (html.match(/pm-honors-cabinet" hidden>/g) || []).length === 2
  && /show\(false\);/.test(read('js/profile.js')) && /const honorsHtml = honors\.live \?/.test(read('js/clan-profile.js')));
check('3. no avatar upload that only says "coming soon"', !/triggerAvatarUpload|Avatar upload coming soon/.test(html + read('js/profile.js')));
check('4. no "More coming soon" on map tiles', !/More coming soon/.test(read('js/kwmap-tileactions.js')));
check('5. no stray server files in js/', ['index.js', 'package.json', 'render.yaml', 'fishing.js.bak', 'main.css'].every(f => !fs.existsSync(path.join(ROOT, 'js', f))));
const tags = [...html.matchAll(/<script[^>]+src="(\/?js\/[^"]+)"/g)].map(m => m[1]);
const bare = tags.filter(s => !/\?v=/.test(s));
check('6. every script tag has a ?v= cache-buster', bare.length === 0, bare.join(', '));
check('7. citizen names in the resource breakdown open their profile directly', /openCitizenProfile\(Number\(span\.dataset\.citizenId\)\)/.test(read('js/resources.js')) && !/no citizen modal handler found/.test(read('js/resources.js')));
const all = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n');
check('8. nothing left saying "Check back soon" or "coming soon!" to players', !/Check back soon|coming soon!/i.test(all) && !/Coming soon —/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
