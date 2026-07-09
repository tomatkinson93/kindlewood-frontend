// ══════════════════════════════════════════════
//  DECK BUILDER  — deploys to js/deck-builder.js
//  View the settlement's deck templates, edit the active deck's contents,
//  add/remove cards from the full pool. Enforces 12–30 cards. For now any
//  card may be added (testing); unlock-gating comes later.
// ══════════════════════════════════════════════

let _dbData = null;        // { templates, catalog, deck_min, deck_max }
let _dbActiveId = null;    // currently-edited template id
let _dbDraft = null;       // { cardKey: count } working copy
const DB_TYPE_COLORS = { attack: '#a5563e', defense: '#4f7aa5', support: '#6ba55a', magic: '#9c5cc4' };

async function openDeckBuilder() {
  let modal = document.getElementById('deckbuilder-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deckbuilder-modal';
    modal.className = 'db-overlay';
    modal.addEventListener('click', (e) => { if (e.target === modal) closeDeckBuilder(); });
    modal.innerHTML = '<div class="db-modal"><div class="db-head"><span>🃏 Decks</span>'
      + '<button class="db-close" onclick="closeDeckBuilder()">✕</button></div>'
      + '<div class="db-body" id="db-body"><div class="db-muted">Loading…</div></div></div>';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  await _dbLoad();
}
function closeDeckBuilder() {
  const m = document.getElementById('deckbuilder-modal');
  if (m) m.style.display = 'none';
}

async function _dbLoad() {
  try {
    const r = await apiFetch('/api/decks');
    if (!r.ok) { _dbBody('<div class="db-err">Could not load decks (status ' + r.status + ')</div>'); return; }
    _dbData = await r.json();
    if (!_dbData.deck_min) _dbData.deck_min = 12;
    if (!_dbData.deck_max) _dbData.deck_max = 30;
    const active = (_dbData.templates || []).find(t => t.is_active) || _dbData.templates[0];
    _dbActiveId = active ? active.id : null;
    _dbDraft = active ? Object.assign({}, active.cards) : {};
    _dbRender();
  } catch (e) { _dbBody('<div class="db-err">' + e.message + '</div>'); }
}

function _dbCount(draft) { return Object.values(draft).reduce((a, b) => a + (b | 0), 0); }

function _dbRender() {
  const total = _dbCount(_dbDraft);
  const min = _dbData.deck_min, max = _dbData.deck_max;
  const valid = total >= min && total <= max;

  // Template selector tabs.
  const tabs = (_dbData.templates || []).map(t =>
    '<button class="db-tab' + (t.id === _dbActiveId ? ' on' : '') + '" onclick="_dbSwitch(' + t.id + ')">'
    + _dbEsc(t.name) + (t.is_active ? ' ★' : '') + '</button>').join('');

  // Current deck (cards with counts), sorted by cost then name.
  const inDeck = Object.keys(_dbDraft).filter(k => _dbDraft[k] > 0)
    .map(k => Object.assign({ key: k, count: _dbDraft[k] }, _dbData.catalog[k] || { name: k, cost: 0, type: 'attack' }))
    .sort((a, b) => (a.cost - b.cost) || a.name.localeCompare(b.name));
  const deckHtml = inDeck.length
    ? inDeck.map(c => _dbDeckRow(c)).join('')
    : '<div class="db-muted">Empty deck — add cards from the pool →</div>';

  // Full pool (everything in catalog).
  const pool = Object.values(_dbData.catalog).sort((a, b) => (a.cost - b.cost) || a.name.localeCompare(b.name));
  const poolHtml = pool.map(c => _dbPoolRow(c)).join('');

  _dbBody(
    '<div class="db-tabs">' + tabs + '<button class="db-tab db-tab-new" onclick="_dbNewTemplate()">＋ New</button></div>'
    + '<div class="db-cols">'
    + '  <div class="db-col">'
    + '    <div class="db-col-head">Current Deck <span class="db-count ' + (valid ? 'ok' : 'bad') + '">' + total + ' / ' + min + '–' + max + '</span></div>'
    + '    <div class="db-list">' + deckHtml + '</div>'
    + '  </div>'
    + '  <div class="db-col">'
    + '    <div class="db-col-head">Card Pool</div>'
    + '    <div class="db-list">' + poolHtml + '</div>'
    + '  </div>'
    + '</div>'
    + '<div class="db-foot">'
    + (valid ? '' : '<span class="db-warn">Deck must be ' + min + '–' + max + ' cards.</span>')
    + '<button class="db-save" ' + (valid ? '' : 'disabled') + ' onclick="_dbSave()">💾 Save Deck</button>'
    + '<span class="db-feedback" id="db-feedback"></span>'
    + '</div>'
  );
}

function _dbDeckRow(c) {
  const tc = DB_TYPE_COLORS[c.type] || '#888';
  return '<div class="db-row">'
    + '<span class="db-cost" style="background:' + tc + '">' + c.cost + '</span>'
    + '<span class="db-name">' + _dbEsc(c.name) + '</span>'
    + '<span class="db-qty">×' + c.count + '</span>'
    + '<button class="db-mini" onclick="_dbAdd(\'' + c.key + '\')">＋</button>'
    + '<button class="db-mini" onclick="_dbRemove(\'' + c.key + '\')">－</button>'
    + '</div>';
}
function _dbPoolRow(c) {
  const tc = DB_TYPE_COLORS[c.type] || '#888';
  const inDeck = _dbDraft[c.key] || 0;
  return '<div class="db-row db-pool-row" onclick="_dbAdd(\'' + c.key + '\')">'
    + '<span class="db-cost" style="background:' + tc + '">' + c.cost + '</span>'
    + '<span class="db-name">' + _dbEsc(c.name) + '</span>'
    + '<span class="db-type" style="color:' + tc + '">' + c.type + '</span>'
    + (inDeck ? '<span class="db-qty">in deck ×' + inDeck + '</span>' : '<span class="db-add-hint">＋ add</span>')
    + '</div>';
}

function _dbAdd(key) {
  if (_dbCount(_dbDraft) >= _dbData.deck_max) { _dbFeedback('⚠️ Max ' + _dbData.deck_max + ' cards.'); return; }
  _dbDraft[key] = (_dbDraft[key] || 0) + 1;
  _dbRender();
}
function _dbRemove(key) {
  if (!_dbDraft[key]) return;
  _dbDraft[key]--;
  if (_dbDraft[key] <= 0) delete _dbDraft[key];
  _dbRender();
}
function _dbSwitch(id) {
  const t = _dbData.templates.find(x => x.id === id);
  if (!t) return;
  _dbActiveId = id;
  _dbDraft = Object.assign({}, t.cards);
  _dbRender();
}

async function _dbNewTemplate() {
  const name = prompt('Name for the new deck:', 'New Deck');
  if (!name) return;
  // Seed a new template with a minimal valid deck (copy current draft if valid,
  // else the starter spread).
  const seed = _dbCount(_dbDraft) >= _dbData.deck_min ? _dbDraft : { strike: 5, defend: 5, quick_jab: 2 };
  const r = await apiFetch('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, cards: seed }) });
  const d = await r.json();
  if (!r.ok) { _dbFeedback('⚠️ ' + (d.error || 'Failed')); return; }
  await _dbLoad();
}

async function _dbSave() {
  if (!_dbActiveId) { _dbFeedback('⚠️ No deck selected.'); return; }
  const r = await apiFetch('/api/decks/' + _dbActiveId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (_dbData.templates.find(t => t.id === _dbActiveId) || {}).name || 'Deck', cards: _dbDraft }) });
  const d = await r.json();
  if (!r.ok) { _dbFeedback('⚠️ ' + (d.error || 'Failed')); return; }
  _dbFeedback('✓ Saved');
  // Refresh the cached template so tab switches reflect the save.
  await _dbLoad();
}

function _dbBody(html) { const b = document.getElementById('db-body'); if (b) b.innerHTML = html; }
function _dbFeedback(msg) {
  const el = document.getElementById('db-feedback');
  if (!el) return;
  el.textContent = msg; el.style.color = msg.startsWith('✓') ? '#8ecf7e' : '#e07a6a';
  setTimeout(() => { if (el) el.textContent = ''; }, 3000);
}
function _dbEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
