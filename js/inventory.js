
// ── Sell items ────────────────────────────────
async function invSellItem(itemId) {
  const id = parseInt(itemId);
  const item = _inventoryData.find(i => i.id === id);
  if (!item) return;
  const sellVal = item.metadata?.sell_value || Math.floor((item.quantity || 1) * 2);
  if (!confirm('Sell ' + item.name + ' for ' + sellVal + ' gold?')) return;
  try {
    await apiFetch('/api/inventory/' + id + '/sell', { method: 'POST' });
    document.getElementById('inv-detail-overlay')?.remove();
    await loadInventory();
  } catch(e) { console.error(e); }
}

async function invSellAll(category) {
  const items = _inventoryData.filter(i => i.category === category && !i.equip_slot);
  if (!items.length) return;
  const totalGold = items.reduce((sum, i) => sum + (i.metadata?.sell_value || 2) * i.quantity, 0);
  if (!confirm('Sell all ' + INV_CATEGORY_LABELS[category] + ' items for ' + totalGold + ' gold?')) return;
  for (const item of items) {
    await apiFetch('/api/inventory/' + item.id + '/sell', { method: 'POST' });
  }
  await loadInventory();
}

// ══════════════════════════════════════════════
//  INVENTORY SYSTEM
// ══════════════════════════════════════════════

let _inventoryData = [];
let _inventoryTab  = 'all';

// RARITY_COLORS is defined in fishing.js — shared across the game
const INV_RARITY_LABELS = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary'
};
const INV_CATEGORY_LABELS = {
  misc: 'Misc', equipment: 'Equipment', material: 'Material',
  food: 'Food', quest_item: 'Quest Item', trophy: 'Trophy'
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
  // Sell All button for single-tab view
  if (_inventoryTab !== 'all') {
    const sellableTotal = items.filter(i => i.metadata?.sell_value && !i.equip_slot)
      .reduce((s, i) => s + (i.metadata.sell_value * i.quantity), 0);
    if (sellableTotal > 0) {
      html += '<div class="inv-sell-all-row"><button class="inv-sell-all-btn" data-cat="' + _inventoryTab + '" onclick="invSellAll(this.dataset.cat)">Sell All · 🪙 ' + sellableTotal + 'g</button></div>';
    }
  }

  if (_inventoryTab === 'all') {
    const groups = {};
    items.forEach(i => { if (!groups[i.category]) groups[i.category] = []; groups[i.category].push(i); });
    const catOrder = ['equipment','material','food','quest_item','trophy','misc'];
    catOrder.filter(c => groups[c]).forEach(cat => {
      const catItems = groups[cat];
      const sellableTotal = catItems
        .filter(i => i.metadata?.sell_value && !i.equip_slot)
        .reduce((s, i) => s + (i.metadata.sell_value * i.quantity), 0);
      const sellAllBtn = sellableTotal > 0
        ? '<button class="inv-sell-all-btn" data-cat="' + cat + '" onclick="invSellAll(this.dataset.cat)">Sell All · 🪙 ' + sellableTotal + 'g</button>'
        : '';
      html += '<div class="inv-group-label">' + (INV_CATEGORY_LABELS[cat] || cat) + ' (' + catItems.length + ')' + sellAllBtn + '</div>';
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
        '<span class="inv-stat-badge">+' + v + ' ' + k + '</span>'
      ).join('') + '</div>'
    : '';
  const equippedHtml = item.equipped_to_name
    ? '<div class="inv-card-equipped">⚔ ' + item.equipped_to_name + '</div>'
    : '';
  const qtyHtml = item.quantity > 1
    ? '<span class="inv-card-qty">×' + item.quantity + '</span>'
    : '';
  const sellVal = item.metadata?.sell_value || null;
  const sellHtml = sellVal
    ? '<div class="inv-card-sell">🪙 ' + (sellVal * (item.quantity || 1)) + 'g</div>'
    : '';

  return '<div class="inv-card" data-id="' + item.id + '" onclick="openItemDetail(' + item.id + ')" style="--rarity-color:' + rarityColor + '">'
    + '<div class="inv-card-icon">' + item.icon + qtyHtml + '</div>'
    + '<div class="inv-card-name">' + item.name + '</div>'
    + '<div class="inv-card-rarity" style="color:' + rarityColor + '">' + INV_RARITY_LABELS[item.rarity] + '</div>'
    + statHtml + equippedHtml + sellHtml
    + '</div>';
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
    .filter(c => c.life_stage !== 'child');

  const equipSection = isEquipment
    ? '<div class="inv-detail-section">'
      + '<div class="inv-detail-section-title">Equip to Citizen</div>'
      + '<select class="pa-select" id="inv-equip-select">'
      + '<option value="">— Unequipped —</option>'
      + availableCitizens.map(c => '<option value="' + c.id + '"' + (item.equipped_to === c.id ? ' selected' : '') + '>' + c.name + '</option>').join('')
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
    + '<span class="inv-detail-icon">' + item.icon + '</span>'
    + '<div>'
    + '<div class="inv-detail-name">' + item.name + '</div>'
    + '<div class="inv-detail-rarity" style="color:' + rarityColor + '">' + INV_RARITY_LABELS[item.rarity] + ' · ' + (INV_CATEGORY_LABELS[item.category] || item.category) + (item.equip_slot ? ' · ' + item.equip_slot : '') + '</div>'
    + '</div>'
    + '<button class="inv-detail-close" onclick="document.getElementById(\'inv-detail-overlay\').remove()">✕</button>'
    + '</div>'
    + '<div class="inv-detail-desc">' + (item.description || 'No description.') + '</div>'
    + (hasStats ? '<div class="inv-detail-section"><div class="inv-detail-section-title">Stat Bonuses</div><div class="inv-card-stats">'
      + Object.entries(item.stat_bonuses).map(([k,v]) => '<span class="inv-stat-badge">+' + v + ' ' + k + '</span>').join('')
      + '</div></div>' : '')
    + equipSection
    + (item.source ? '<div class="inv-detail-source">Obtained from: ' + item.source + '</div>' : '')
    + '<div class="inv-detail-meta-row">'
    + (item.metadata?.food_value ? '<span class="inv-meta-badge">🌿 +' + item.metadata.food_value + ' food</span>' : '')
    + (item.metadata?.sell_value ? '<span class="inv-meta-badge">🪙 ' + item.metadata.sell_value + ' gold each</span>' : '')
    + '</div>'
    + '<div class="inv-detail-actions">'
    + (item.quantity > 1 ? '<span class="inv-detail-qty">×' + item.quantity + ' in stock</span>' : '')
    + (item.metadata?.sell_value
        ? '<button class="inv-sell-btn" data-id="' + item.id + '" onclick="invSellItem(this.dataset.id)">🪙 Sell</button>'
        : '')
    + '<button class="inv-discard-btn" data-id="' + item.id + '" onclick="invDiscard(this.dataset.id)">🗑 Discard</button>'
    + '</div>'
    + '</div>';

  document.querySelector('#inventory-modal .inv-modal-card').appendChild(overlay);
}

async function invEquipItem(itemId) {
  const sel = document.getElementById('inv-equip-select');
  const citizenId = sel?.value ? parseInt(sel.value) : null;
  await apiFetch('/api/inventory/' + itemId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipped_to: citizenId }),
  });
  document.getElementById('inv-detail-overlay')?.remove();
  await loadInventory();
}

async function invDiscard(itemId) {
  if (!confirm('Discard this item? This cannot be undone.')) return;
  await apiFetch('/api/inventory/' + itemId, { method: 'DELETE' });
  document.getElementById('inv-detail-overlay')?.remove();
  await loadInventory();
}

// ── Helper: add item to inventory (called from quest collect, raids etc.) ──
async function awardInventoryItem(itemDef) {
  try {
    await apiFetch('/api/inventory/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(itemDef),
    });
  } catch(e) { console.error('Failed to award item:', e); }
}
