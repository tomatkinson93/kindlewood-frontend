// ══════════════════════════════════════════════
//  CARD ADMIN — dev tools "Cards" tab
//  A visual card editor: the form IS a card preview. Click the cost, name,
//  description, type, etc. to edit. Mirrors item_admin's fetch/save pattern.
// ══════════════════════════════════════════════

let _caCards = [];
let _caMeta = { card_types: ['attack', 'defense', 'support', 'magic'], targets: [], rarities: [], help: null };
let _caEditing = null; // card_key being edited, or '__new__'
let _caFilter = { type: 'all', rarity: 'all', search: '', sort: 'name' };

const CA_TYPE_COLORS = { attack: '#a5563e', defense: '#4f7aa5', support: '#6ba55a', magic: '#9c5cc4' };
const CA_RARITY_COLORS = { common: '#a0c880', uncommon: '#70b8e0', rare: '#e8a020', epic: '#c060e0', legendary: '#ff8020' };

async function _caFetch(path, opts) { return apiFetch('/api/card-admin' + path, opts); }

async function loadCardAdmin() {
  const list = document.getElementById('ca-list');
  if (list) list.innerHTML = '<div class="ca-muted">Loading…</div>';
  try {
    const r = await _caFetch('');
    if (!r.ok) { if (list) list.innerHTML = '<div class="ca-err">⚠️ Could not load cards (status ' + r.status + ')</div>'; return; }
    const d = await r.json();
    _caCards = d.cards || [];
    _caMeta = { card_types: d.card_types || _caMeta.card_types, targets: d.targets || [], rarities: d.rarities || [], help: d.help || null };
    // Also push into the live registry so battles/preview reflect edits.
    if (window.CARD_REGISTRY && typeof CARD_REGISTRY.loadRows === 'function') CARD_REGISTRY.loadRows(_caCards);
    _caRenderFilters();
    _caRenderList();
  } catch (e) { if (list) list.innerHTML = '<div class="ca-err">⚠️ ' + e.message + '</div>'; }
}

function _caRenderFilters() {
  var bar = document.getElementById('ca-filters');
  if (!bar) return;
  var types = ['all'].concat(_caMeta.card_types);
  var rarities = ['all'].concat(_caMeta.rarities.length ? _caMeta.rarities : ['common','uncommon','rare','epic','legendary']);
  var typeBtns = types.map(function (t) {
    return '<button class="ca-fbtn' + (_caFilter.type === t ? ' on' : '') + '" onclick="_caSetFilter(\'type\',\'' + t + '\')">' + t + '</button>';
  }).join('');
  var rarOpts = rarities.map(function (r) {
    return '<option value="' + r + '"' + (_caFilter.rarity === r ? ' selected' : '') + '>' + r + '</option>';
  }).join('');
  bar.innerHTML =
    '<div class="ca-filter-row"><div class="ca-ftypes">' + typeBtns + '</div></div>'
    + '<div class="ca-filter-row">'
    + '<input class="ca-search" id="ca-search" placeholder="🔎 search name / key…" value="' + _caEsc(_caFilter.search) + '" oninput="_caSetFilter(\'search\', this.value)">'
    + '<select class="ca-fsort" onchange="_caSetFilter(\'rarity\', this.value)">' + rarOpts + '</select>'
    + '<select class="ca-fsort" onchange="_caSetFilter(\'sort\', this.value)">'
    +   ['name','cost','rarity','type'].map(function (s) { return '<option value="' + s + '"' + (_caFilter.sort === s ? ' selected' : '') + '>sort: ' + s + '</option>'; }).join('')
    + '</select>'
    + '</div>';
}

function _caSetFilter(key, val) {
  _caFilter[key] = val;
  // Don't re-render the whole filter bar on search keystroke (keeps focus);
  // only the type buttons / selects need the bar redrawn.
  if (key !== 'search') _caRenderFilters();
  _caRenderList();
}

function _caFilteredCards() {
  var rarOrder = { common:1, uncommon:2, rare:3, epic:4, legendary:5 };
  var out = _caCards.filter(function (c) {
    if (_caFilter.type !== 'all' && c.card_type !== _caFilter.type) return false;
    if (_caFilter.rarity !== 'all' && c.rarity !== _caFilter.rarity) return false;
    if (_caFilter.search) {
      var q = _caFilter.search.toLowerCase();
      if ((c.name || '').toLowerCase().indexOf(q) === -1 && (c.card_key || '').toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  });
  out.sort(function (a, b) {
    switch (_caFilter.sort) {
      case 'cost': return (a.cost - b.cost) || a.name.localeCompare(b.name);
      case 'rarity': return ((rarOrder[a.rarity]||0) - (rarOrder[b.rarity]||0)) || a.name.localeCompare(b.name);
      case 'type': return (a.card_type || '').localeCompare(b.card_type || '') || a.name.localeCompare(b.name);
      default: return (a.name || '').localeCompare(b.name || '');
    }
  });
  return out;
}

function _caRenderList() {
  const el = document.getElementById('ca-list');
  if (!el) return;
  const cards = _caFilteredCards();
  if (!_caCards.length) { el.innerHTML = '<div class="ca-muted">No cards yet. Click ＋ New Card.</div>'; return; }
  if (!cards.length) { el.innerHTML = '<div class="ca-muted">No cards match the filter.</div>'; return; }
  el.innerHTML = cards.map(c => {
    const tc = CA_TYPE_COLORS[c.card_type] || '#888';
    const rc = CA_RARITY_COLORS[c.rarity] || '#888';
    return '<div class="ca-row" onclick="ca_edit(\'' + c.card_key + '\')">'
      + '<span class="ca-row-cost" style="background:' + tc + '">' + c.cost + '</span>'
      + '<span class="ca-row-name">' + _caEsc(c.name) + '</span>'
      + '<span class="ca-row-type" style="color:' + tc + '">' + c.card_type + '</span>'
      + '<span class="ca-row-rarity" style="color:' + rc + '">' + c.rarity + '</span>'
      + '<div class="ca-row-btns" onclick="event.stopPropagation()">'
      + '<button class="ca-btn" onclick="ca_edit(\'' + c.card_key + '\')">✏</button>'
      + '<button class="ca-btn ca-btn-del" onclick="ca_delete(\'' + c.card_key + '\')">🗑</button>'
      + '</div></div>';
  }).join('');
}

function ca_new() { _caEditing = '__new__'; _caRenderEditor(null); }
function ca_edit(key) { _caEditing = key; _caRenderEditor(_caCards.find(c => c.card_key === key) || null); }
function ca_cancel() {
  _caEditing = null;
  const ov = document.getElementById('ca-modal-overlay');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}

// Render the editor as a pop-out modal (card preview + fields), in front of the
// dev-tools window.
function _caRenderEditor(card) {
  // Remove any existing modal first.
  const existing = document.getElementById('ca-modal-overlay');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const isNew = !card;
  const c = card || { card_key: '', name: 'New Card', cost: 1, card_type: 'attack', target: 'enemy', rarity: 'common', description: '', formula: '', art_url: '' };
  const tc = CA_TYPE_COLORS[c.card_type] || '#888';

  const typeOpts = _caMeta.card_types.map(t => '<option value="' + t + '"' + (t === c.card_type ? ' selected' : '') + '>' + t + '</option>').join('');
  const targetOpts = (_caMeta.targets.length ? _caMeta.targets : ['self','enemy','ally','ally_or_self','any','all_enemies','all_allies','none'])
    .map(t => '<option value="' + t + '"' + (t === c.target ? ' selected' : '') + '>' + t + '</option>').join('');
  const rarityOpts = (_caMeta.rarities.length ? _caMeta.rarities : ['common','uncommon','rare','epic','legendary'])
    .map(t => '<option value="' + t + '"' + (t === c.rarity ? ' selected' : '') + '>' + t + '</option>').join('');

  const artStyle = c.art_url
    ? 'background-image:linear-gradient(180deg,rgba(20,16,10,.2),rgba(20,16,10,.85)),url(' + _caEsc(c.art_url) + ');background-size:cover;background-position:center;'
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'ca-modal-overlay';
  overlay.className = 'ca-modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) ca_cancel(); });

  overlay.innerHTML =
    '<div class="ca-modal">'
    + '<div class="ca-modal-head"><span>' + (isNew ? '＋ New Card' : 'Edit: ' + _caEsc(c.name)) + '</span>'
    +   '<button class="ca-modal-close" onclick="ca_cancel()">✕</button></div>'
    + '<div class="ca-editor-grid">'
    // ── Live card preview ──
    + '<div class="ca-card-preview ca-type-' + c.card_type + '" id="ca-preview" style="' + artStyle + '">'
    +   '<input class="ca-pv-cost" id="ca-cost" type="number" min="0" value="' + c.cost + '" title="Energy cost" style="background:' + tc + '">'
    +   '<input class="ca-pv-name" id="ca-name" value="' + _caEsc(c.name) + '" placeholder="Card Name">'
    +   '<select class="ca-pv-type" id="ca-type" onchange="_caPreviewType()">' + typeOpts + '</select>'
    +   '<textarea class="ca-pv-desc" id="ca-desc" rows="3" placeholder="What the card does, in words.">' + _caEsc(c.description) + '</textarea>'
    + '</div>'
    // ── Field column ──
    + '<div class="ca-fields">'
    +   '<label class="ca-lbl">Card Key ' + _caTip('Unique snake_case ID. Cannot change after creation. e.g. fire_bolt') + '</label>'
    +   '<input class="ca-in" id="ca-key" value="' + _caEsc(c.card_key) + '"' + (isNew ? '' : ' readonly') + ' placeholder="fire_bolt">'
    +   '<label class="ca-lbl">Target ' + _caTip('Who the card affects. enemy/ally prompt a click; all_* are AoE; none/self need no target.') + '</label>'
    +   '<select class="ca-in" id="ca-target">' + targetOpts + '</select>'
    +   '<label class="ca-lbl">Hit mode ' + _caTip('How a damaging card spreads across the enemy formation. choose = pick any; front = frontmost only; pierce = through the line (set count/falloff); aoe = all (use with all_enemies target).') + '</label>'
    +   '<select class="ca-in" id="ca-hit" onchange="_caTogglePierce()">' + ['choose','front','pierce','aoe'].map(function(h){return '<option value="'+h+'"'+((c.hit||'choose')===h?' selected':'')+'>'+h+'</option>';}).join('') + '</select>'
    +   '<div class="ca-pierce-row" id="ca-pierce-row" style="' + ((c.hit==='pierce')?'':'display:none') + '">'
    +     '<div><label class="ca-lbl">Pierce depth ' + _caTip('How many units deep. Blank = all.') + '</label><input class="ca-in" id="ca-pierce-count" type="number" min="1" value="' + (c.pierce_count != null ? c.pierce_count : '') + '" placeholder="all"></div>'
    +     '<div><label class="ca-lbl">Falloff ' + _caTip('Damage multiplier per step back. 1 = full through; 0.5 = halve each.') + '</label><input class="ca-in" id="ca-pierce-falloff" type="number" step="0.05" min="0" max="1" value="' + (c.pierce_falloff != null ? c.pierce_falloff : 1) + '"></div>'
    +   '</div>'
    +   '<label class="ca-lbl">Rarity</label>'
    +   '<select class="ca-in" id="ca-rarity">' + rarityOpts + '</select>'
    +   '<label class="ca-lbl">Background image URL ' + _caTip('Optional. Leave blank for the default card frame.') + '</label>'
    +   '<input class="ca-in" id="ca-art" value="' + _caEsc(c.art_url || '') + '" placeholder="/assets/cards/fire_bolt.png" oninput="_caPreviewArt()">'
    +   '<label class="ca-lbl">Sound effect ' + _caTip('Filename only, e.g. strike_1.mp3 — played from /assets/audio/cards/ when the card is used. Blank = silent.') + '</label>'
    +   '<div class="ca-sfx-row"><input class="ca-in" id="ca-sfx" value="' + _caEsc(c.sfx || '') + '" placeholder="strike_1.mp3"><button class="ca-help-btn ca-sfx-test" onclick="_caTestSfx()" title="Test play">▶</button></div>'
    +   '<label class="ca-lbl" style="display:flex;align-items:center;gap:8px;margin-top:8px">'
    +     '<input type="checkbox" id="ca-wither" style="width:auto"' + (c.wither ? ' checked' : '') + '> Withers '
    +     _caTip('A withering card can be played only ONCE per combat. When played it crumbles to the Withered pile (never reshuffled, never redrawn this battle) and poofs into purple smoke. Shown with a cracked purple-glass frame.')
    +   '</label>'
    +   '<label class="ca-lbl">Formula ' + _caTip('Click the ? for the formula reference') + ' <button class="ca-help-btn" onclick="_caShowHelp()">?</button></label>'
    +   '<textarea class="ca-in ca-formula" id="ca-formula" rows="4" placeholder="damage: strength*0.6 + combat*0.8 + 4" oninput="_caValidateDebounced()">' + _caEsc(c.formula || '') + '</textarea>'
    +   '<div class="ca-formula-status" id="ca-formula-status"></div>'
    +   '<div class="ca-editor-actions">'
    +     '<button class="ca-save" onclick="ca_save()">' + (isNew ? '＋ Create Card' : '💾 Save') + '</button>'
    +     '<button class="ca-cancel" onclick="ca_cancel()">Cancel</button>'
    +   '</div>'
    +   '<div class="ca-feedback" id="ca-feedback"></div>'
    + '</div>'
    + '</div>'
    + '<div class="ca-help-pop" id="ca-help-pop" style="display:none"></div>'
    + '</div>';

  document.body.appendChild(overlay);
}

// Live preview: recolor card when type changes.
function _caPreviewType() {
  const t = document.getElementById('ca-type').value;
  const pv = document.getElementById('ca-preview');
  const cost = document.getElementById('ca-cost');
  if (pv) pv.className = 'ca-card-preview ca-type-' + t;
  if (cost) cost.style.background = CA_TYPE_COLORS[t] || '#888';
}
function _caPreviewArt() {
  const url = document.getElementById('ca-art').value.trim();
  const pv = document.getElementById('ca-preview');
  if (!pv) return;
  pv.style.backgroundImage = url
    ? 'linear-gradient(180deg,rgba(20,16,10,.2),rgba(20,16,10,.85)),url(' + url + ')'
    : '';
  pv.style.backgroundSize = 'cover'; pv.style.backgroundPosition = 'center';
}

let _caValTimer = null;
function _caValidateDebounced() {
  clearTimeout(_caValTimer);
  _caValTimer = setTimeout(_caValidate, 350);
}
async function _caValidate() {
  const f = document.getElementById('ca-formula');
  const status = document.getElementById('ca-formula-status');
  if (!f || !status) return;
  const formula = f.value;
  if (!formula.trim()) { status.textContent = ''; return; }
  try {
    const r = await _caFetch('/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formula }) });
    const d = await r.json();
    if (d.ok) { status.textContent = '✓ Formula valid'; status.className = 'ca-formula-status ok'; }
    else { status.textContent = '⚠ ' + d.errors.join(' '); status.className = 'ca-formula-status err'; }
  } catch (e) { status.textContent = ''; }
}

function _caShowHelp() {
  const pop = document.getElementById('ca-help-pop');
  if (!pop) return;
  if (pop.style.display === 'block') { pop.style.display = 'none'; return; }
  const h = _caMeta.help || { verbs: ['damage','block','heal','energy','buff','debuff'], stats: ['strength','agility','endurance','intelligence','charisma','combat'], examples: [] };
  pop.innerHTML =
    '<div class="ca-help-title">Formula Reference</div>'
    + '<div class="ca-help-sec"><b>Format:</b> one effect per line — <code>verb [name]: expression</code></div>'
    + '<div class="ca-help-sec"><b>Verbs:</b> ' + h.verbs.map(v => '<code>' + v + '</code>').join(' ') + '</div>'
    + '<div class="ca-help-sec"><b>Stats:</b> ' + h.stats.map(s => '<code>' + s + '</code>').join(' ') + '<br><span class="ca-muted">(plus numbers and + - * / and parentheses)</span></div>'
    + '<div class="ca-help-sec"><b>Examples:</b></div>'
    + '<pre class="ca-help-pre">' + (h.examples || []).map(_caEsc).join('\n') + '</pre>'
    + '<div class="ca-help-sec ca-muted">buff/debuff need a name: <code>debuff weak: 2</code>, <code>buff damage_bonus: charisma*0.4+2</code>. Known debuffs: weak (less damage dealt), vulnerable (more damage taken).</div>'
    + '<button class="ca-cancel" style="margin-top:8px" onclick="document.getElementById(\'ca-help-pop\').style.display=\'none\'">Close</button>';
  pop.style.display = 'block';
}

async function ca_save() {
  const isNew = _caEditing === '__new__';
  const body = {
    card_key: document.getElementById('ca-key').value.trim(),
    name: document.getElementById('ca-name').value.trim(),
    cost: parseInt(document.getElementById('ca-cost').value) || 0,
    card_type: document.getElementById('ca-type').value,
    target: document.getElementById('ca-target').value,
    rarity: document.getElementById('ca-rarity').value,
    description: document.getElementById('ca-desc').value,
    formula: document.getElementById('ca-formula').value,
    art_url: document.getElementById('ca-art').value.trim() || null,
    sfx: document.getElementById('ca-sfx').value.trim() || null,
    hit: document.getElementById('ca-hit').value,
    wither: document.getElementById('ca-wither') ? document.getElementById('ca-wither').checked : false,
    pierce_count: (function(){ var v = document.getElementById('ca-pierce-count').value.trim(); return v === '' ? null : (parseInt(v,10) || null); })(),
    pierce_falloff: (function(){ var v = document.getElementById('ca-pierce-falloff').value; return v === '' ? 1.0 : Number(v); })(),
  };
  if (!body.card_key || !body.name) { _caFeedback('⚠️ Key and name required.'); return; }

  const url = isNew ? '' : '/' + _caEditing;
  const method = isNew ? 'POST' : 'PATCH';
  const r = await _caFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { _caFeedback('⚠️ ' + (d.error || 'Failed')); return; }
  _caFeedback('✓ Saved: ' + body.name);
  _caEditing = null;
  ca_cancel();
  await loadCardAdmin();
}

async function ca_delete(key) {
  if (!confirm('Delete card "' + key + '"? Decks referencing it will simply skip it.')) return;
  await _caFetch('/' + key, { method: 'DELETE' });
  await loadCardAdmin();
}

function _caFeedback(msg) {
  const el = document.getElementById('ca-feedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = msg.startsWith('✓') ? '#8ecf7e' : '#e07a6a';
  setTimeout(() => { if (el) el.textContent = ''; }, 3500);
}

function _caTogglePierce() {
  const hit = document.getElementById('ca-hit').value;
  const row = document.getElementById('ca-pierce-row');
  if (row) row.style.display = (hit === 'pierce') ? '' : 'none';
}

function _caTestSfx() {
  const fn = (document.getElementById('ca-sfx').value || '').trim();
  if (!fn) { _caFeedback('⚠️ No sound filename set.'); return; }
  try {
    const a = new Audio('/assets/audio/cards/' + fn);
    a.volume = (window.getSfxVolume ? getSfxVolume() : 0.6);
    a.play().catch(() => _caFeedback('⚠️ Could not play /assets/audio/cards/' + fn));
  } catch (e) { _caFeedback('⚠️ ' + e.message); }
}

function _caTip(t) { return '<span class="ca-tip" title="' + _caEsc(t) + '">?</span>'; }
function _caEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
