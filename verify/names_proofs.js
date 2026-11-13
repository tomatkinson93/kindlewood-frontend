'use strict';
// Player-chosen names are escaped wherever they are put into HTML
// (SECURITY_REVIEW.md S1). The server also refuses < > " & in new usernames
// and town names, but the client must not rely on that.
//   node verify/names_proofs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

// Fields that hold another player's username, town name or owner.
const NAME_FIELD = /\b(username|owner|claim_owner|settlement_name|settlementName|town_name|from_town|ownerName|owner_name|author)\b/;
// An expression counts as escaped when it starts with one of these calls.
const ESCAPED = /^\s*(escHtml|esc|_esc|escapeHtml|h|encodeURIComponent|Number|String\(Number)\s*\(/;
// Lines that build HTML: a tag in a string, or an innerHTML/insertAdjacentHTML write.
const HTMLISH = /<[a-z][^>]*>|<\/[a-z]+>|innerHTML|insertAdjacentHTML|outerHTML/i;

// Pull ${…} bodies (balanced braces) and ' + expr + ' pieces out of a line.
function expressions(line) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i + 1] === '{') {
      let depth = 1, j = i + 2;
      while (j < line.length && depth) { if (line[j] === '{') depth++; else if (line[j] === '}') depth--; j++; }
      out.push(line.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  const concat = /['"`]\s*\+\s*([^'"`+]+?)\s*\+\s*['"`]/g;
  let m;
  while ((m = concat.exec(line))) out.push(m[1]);
  // + (s.username || '—') + … : a bracketed piece, which may hold quotes.
  const paren = /\+\s*(\([^()]*\))/g;
  while ((m = paren.exec(line))) out.push(m[1]);
  return out;
}

console.log('1. No unescaped names in HTML');
{
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && !f.startsWith('vendor'));
  const bad = [];
  for (const f of files) {
    read('js/' + f).split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line) || !HTMLISH.test(line)) return;
      for (const e of expressions(line)) {
        if (!NAME_FIELD.test(e) || ESCAPED.test(e)) continue;
        // Comparisons and conditions only read the name (m.author === me ? …).
        if (/===|!==|\?\s*['"` ]/.test(e) && !/\?\s*[A-Za-z_]+\.(username|owner)/.test(e)) continue;
        bad.push(`js/${f}:${i + 1}  ${e.trim()}`);
      }
    });
  }
  check('1a. every username, owner and town name joined into HTML is escaped', bad.length === 0, bad.slice(0, 12).join('\n      '));
}

console.log('2. The known places');
{
  const M = read('js/main.js');
  check('2a. outpost owner and claim owner on the tile panel', /\$\{escHtml\(tile\.outpost\.owner\)\}'s outpost stands here/.test(M) && /claimed by \$\{escHtml\(tile\.claim_owner\)\}/.test(M));
  check('2b. the town name on the tier card', /tier-card-sett-name">' \+ escHtml\(settlementName\)/.test(M));
  check('2c. Ruler box and View Profile data attributes', /escHtml\(s\.username\|\|'—'\)/.test(M) && /data-username="' \+ escHtml\(s\.username/.test(M) && /data-name="' \+ escHtml\(s\.name/.test(M));
  check('2d. event toasts are plain text', /toast\.querySelector\('\.toast-msg'\)\.textContent = message/.test(M) && !/'<span class="toast-msg">' \+ message/.test(M));
  check('2e. the events feed escapes each message', /ef-message">\$\{escHtml\(ev\.message\)\}/.test(read('js/events.js')));
  check('2f. escHtml escapes < > " & and \'', /&amp;/.test(read('js/profile.js')) && /&lt;/.test(read('js/profile.js')) && /&quot;/.test(read('js/profile.js')) && /&#39;/.test(read('js/profile.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
