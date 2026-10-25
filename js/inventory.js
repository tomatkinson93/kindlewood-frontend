
// ── Selling ───────────────────────────────────
// No instant selling any more: list the item at the Market for players, or
// send a porter to sell it to Ironhaven for a low price (js/market.js).
function invSellVia(where, itemId) {
  if (typeof openMarket !== 'function') return;
  document.getElementById('inv-detail-overlay')?.remove();
  closeInventoryModal();
  openMarket({ tab: where === 'ironhaven' ? 'ironhaven' : 'sell', item: parseInt(itemId) });
}

// ══════════════════════════════════════════════
//  INVENTORY SYSTEM
// ══════════════════════════════════════════════

let _inventoryData = [];
let _inventoryTab  = 'all';

// RARITY_COLORS is defined in fishing.js — shared across the game
// Item text comes from the server (templates, quest drops, named blades,
// trades): always escape it before it goes into HTML.
const _invEsc = s => (typeof escHtml === 'function' ? escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

const INV_RARITY_LABELS = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary'
};
const INV_CATEGORY_LABELS = {
  misc: 'Misc', equipment: 'Equipment', material: 'Material',
  food: 'Food', quest_item: 'Quest Item', trophy: 'Trophy', schematic: 'Schematic', fish: 'Fish'
};

async function openInventoryModal() {
  const modal = document.getElementById('inventory-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  await loadInventory();
}

function closeInventoryModal() {
  const modal = document.getElementById('inventory-modal');
  if (modal) modal.style.display = 'none';
}

function invSetTab(cat, btn) {
  _inventoryTab = cat;
  document.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderInventory();
}

async function loadInventory() {
  const body = document.getElementById('inv-body');
  if (body) body.innerHTML = '<div class="inv-loading">Loading…</div>';
  try {
    const res = await apiFetch('/api/inventory');
    const data = await res.json();
    _inventoryData = data.items || [];
    renderInventory();
  } catch(e) {
    if (body) body.innerHTML = '<div class="inv-empty">Could not load inventory.</div>';
  }
}

function renderInventory() {
  const body = document.getElementById('inv-body');
  if (!body) return;

  let items = _inventoryData;
  if (_inventoryTab !== 'all') items = items.filter(i => i.category === _inventoryTab);

  if (!items.length) {
    body.innerHTML = '<div class="inv-empty">'
      + (_inventoryTab === 'all'
        ? '🎒 Your inventory is empty.<br><span>Items from quests, raids, and crafting will appear here.</span>'
        : 'No ' + (INV_CATEGORY_LABELS[_inventoryTab] || _inventoryTab) + ' items yet.')
      + '</div>';
    return;
  }

  // Group by category when showing all
  let html = '';

  if (_inventoryTab === 'all') {
    const groups = {};
    items.forEach(i => { if (!groups[i.category]) groups[i.category] = []; groups[i.category].push(i); });
    // Known categories first, then anything else (nothing is ever hidden).
    const known = ['equipment','schematic','material','food','fish','quest_item','trophy','misc'];
    const catOrder = known.concat(Object.keys(groups).filter(c => !known.includes(c)).sort());
    catOrder.filter(c => groups[c]).forEach(cat => {
      const catItems = groups[cat];
      html += '<div class="inv-group-label">' + (INV_CATEGORY_LABELS[cat] || cat) + ' (' + catItems.length + ')</div>';
      html += '<div class="inv-grid">' + catItems.map(invItemCard).join('') + '</div>';
    });
  } else {
    html = '<div class="inv-grid">' + items.map(invItemCard).join('') + '</div>';
  }

  body.innerHTML = html;
}

function invItemCard(item) {
  const rarityColor = RARITY_COLORS[item.rarity] || '#b0a890';
  const hasStats = item.stat_bonuses && Object.keys(item.stat_bonuses).length > 0;
  const statHtml = hasStats
    ? '<div class="inv-card-stats">' +
      Object.entries(item.stat_bonuses).map(([k,v]) =>
        '<span class="inv-stat-badge">+' + _invEsc(v) + ' ' + _invEsc(k) + '</span>'
      ).join('') + '</div>'
    : '';
  const equippedHtml = item.equipped_to_name
    ? '<div class="inv-card-equipped">⚔ ' + _invEsc(item.equipped_to_name) + '</div>'
    : '';
  const qtyHtml = item.quantity > 1
    ? '<span class="inv-card-qty">×' + item.quantity + '</span>'
    : '';
  const sellVal = item.metadata?.sell_value || null;
  const sellHtml = sellVal
    ? '<div class="inv-card-sell">🪙 ' + (sellVal * (item.quantity || 1)) + 'g</div>'
    : '';

  return '<div class="inv-card" data-id="' + item.id + '" onclick="openItemDetail(' + item.id + ')" style="--rarity-color:' + rarityColor + '">'
    + '<div class="inv-card-icon">' + _invEsc(item.icon) + qtyHtml + '</div>'
    + '<div class="inv-card-name"' + (_invQualityColour(item) ? ' style="color:' + _invQualityColour(item) + '"' : '') + '>' + _invEsc(item.name) + '</div>'
    + '<div class="inv-card-rarity" style="color:' + rarityColor + '">' + INV_RARITY_LABELS[item.rarity] + '</div>'
    + statHtml + equippedHtml + sellHtml
    + '</div>';
}

// Crafted pieces (js/crafting.js): quality colour and the crafter's mark.
function _invQualityColour(item) {
  const q = item.metadata && item.metadata.quality;
  return q && q !== 'basic' && window.KWCrafting ? window.KWCrafting.qualityColour(q) : null;
}
function _invMarkHtml(item) {
  return window.KWCrafting ? window.KWCrafting.markHtml(item.metadata) : '';
}

function openItemDetail(itemId) {
  const item = _inventoryData.find(i => i.id === parseInt(itemId));
  if (!item) return;

  // Close any existing detail
  document.getElementById('inv-detail-overlay')?.remove();

  const rarityColor = RARITY_COLORS[item.rarity] || '#b0a890';
  const hasStats = item.stat_bonuses && Object.keys(item.stat_bonuses).length > 0;
  const isEquipment = !!item.equip_slot;

  const availableCitizens = (typeof citizensData !== 'undefined' ? citizensData : [])
    .filter(c => c.life_stage !== 'child' && c.life_stage !== 'deceased');

  const equipSection = isEquipment
    ? '<div class="inv-detail-section">'
      + '<div class="inv-detail-section-title">Equip to Citizen <span style="opacity:.6;font-weight:400">(one per slot — adds to their skills)</span></div>'
      + '<select class="pa-select" id="inv-equip-select">'
      + '<option value="">— Unequipped —</option>'
      + availableCitizens.map(c => '<option value="' + c.id + '"' + (item.equipped_to === c.id ? ' selected' : '') + '>' + _invEsc(c.name) + '</option>').join('')
      + '</select>'
      + '<button class="inv-equip-btn" data-id="' + item.id + '" onclick="invEquipItem(this.dataset.id)">Apply</button>'
      + '</div>'
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'inv-detail-overlay';
  overlay.className = 'inv-detail-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="inv-detail-card" style="--rarity-color:' + rarityColor + '">'
    + '<div class="inv-detail-header">'
    + '<span class="inv-detail-icon">' + _invEsc(item.icon) + '</span>'
    + '<div>'
    + '<div class="inv-detail-name">' + _invEsc(item.name) + '</div>'
    + '<div class="inv-detail-rarity" style="color:' + rarityColor + '">' + INV_RARITY_LABELS[item.rarity] + ' · ' + (INV_CATEGORY_LABELS[item.category] || item.category) + (item.equip_slot ? ' · ' + item.equip_slot : '') + '</div>'
    + _invMarkHtml(item)
    + '</div>'
    + '<button class="inv-detail-close" onclick="document.getElementById(\'inv-detail-overlay\').remove()">✕</button>'
    + '</div>'
    + '<div class="inv-detail-desc">' + _invEsc(item.description || 'No description.') + '</div>'
    + (hasStats ? '<div class="inv-detail-section"><div class="inv-detail-section-title">Stat Bonuses</div><div class="inv-card-stats">'
      + Object.entries(item.stat_bonuses).map(([k,v]) => '<span class="inv-stat-badge">+' + _invEsc(v) + ' ' + _invEsc(k) + '</span>').join('')
      + '</div></div>' : '')
    + _invEffectsHtml(item)
    + equipSection
    + (item.source ? '<div class="inv-detail-source">Obtained from: ' + _invEsc(item.source) + '</div>' : '')
    + '<div class="inv-detail-meta-row">'
    + (item.metadata?.food_value ? '<span class="inv-meta-badge">🌿 +' + item.metadata.food_value + ' food</span>' : '')
    + (item.metadata?.sell_value ? '<span class="inv-meta-badge" title="Town value — Ironhaven pays a share of this">🪙 ' + item.metadata.sell_value + ' value</span>' : '')
    + '</div>'
    + (_invIsSchematic(item)
        ? '<div class="inv-detail-section inv-schematic">📜 Studying it teaches every crafter in your town to make <b>'
          + _invEsc((item.name || '').replace(/^Schematic:\s*/, '')) + '</b>. It is used up; if your town already knows it, keep it to sell.</div>'
        : '')
    + '<div class="inv-detail-actions">'
    + (item.quantity > 1 ? '<span class="inv-detail-qty">×' + item.quantity + ' in stock</span>' : '')
    + (_invIsSchematic(item) ? '<button class="inv-equip-btn inv-study-btn" data-id="' + item.id + '" onclick="invStudy(this.dataset.id)">📜 Study</button>' : '')
    + (item.equipped_to ? ''
        : '<button class="inv-sell-btn" data-id="' + item.id + '" onclick="invSellVia(\'market\', this.dataset.id)" title="Sell to other players">⚖️ List at Market</button>'
        + '<button class="inv-sell-btn" data-id="' + item.id + '" onclick="invSellVia(\'ironhaven\', this.dataset.id)" title="Send a porter to sell it to Ironhaven for a low price">🏰 Sell to Ironhaven</button>')
    + '<button class="inv-discard-btn" data-id="' + item.id + '" onclick="invDiscard(this.dataset.id)">🗑 Discard</button>'
    + '</div>'
    + '</div>';

  document.querySelector('#inventory-modal .inv-modal-card').appendChild(overlay);
}

// A crafted piece's own effects (a shield's lower injury risk, a cart's carry).
function _invEffectsHtml(item) {
  const fx = (item.metadata && Array.isArray(item.metadata.item_effects)) ? item.metadata.item_effects : [];
  const M = window.KWCareerMath;
  if (!fx.length || !M) return '';
  return '<div class="inv-detail-section"><div class="inv-detail-section-title">Effects</div><div class="inv-card-stats">'
    + fx.map(e => '<span class="inv-stat-badge">' + M.describeEffect(e) + '</span>').join('') + '</div></div>';
}

// Schematics (js/crafting.js KWCrafting.study): the town learns a recipe.
function _invIsSchematic(item) { return item && (item.category === 'schematic' || String(item.item_key || '').startsWith('schematic_')); }
async function invStudy(itemId) {
  if (!window.KWCrafting) return;
  const r = await window.KWCrafting.study(parseInt(itemId, 10));
  if (r) document.getElementById('inv-detail-overlay')?.remove();
}

async function invEquipItem(itemId) {
  const sel = document.getElementById('inv-equip-select');
  const citizenId = sel?.value ? parseInt(sel.value) : null;
  const res = await apiFetch('/api/inventory/' + itemId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipped_to: citizenId }),
  });
  // Gear counts now (careers): one piece per slot; refusals say why.
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { if (typeof showBuildToast === 'function') showBuildToast(d.error || 'Could not equip that.', 'error'); return; }
  if (d.replaced && typeof showBuildToast === 'function') showBuildToast(`${d.replaced} went back to the stores.`, 'success');
  document.getElementById('inv-detail-overlay')?.remove();
  await loadInventory();
  if (typeof loadCitizens === 'function') loadCitizens();   // effective skills changed
}

async function invDiscard(itemId) {
  if (!confirm('Discard this item? This cannot be undone.')) return;
  await apiFetch('/api/inventory/' + itemId, { method: 'DELETE' });
  document.getElementById('inv-detail-overlay')?.remove();
  await loadInventory();
}

// Items are only ever granted by the server (fishing lands via
// /api/fishing/land; quests and battles grant on the server). There is no
// client-side "add item" call.
