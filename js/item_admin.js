// ══════════════════════════════════════════════
//  ITEM ADMIN — cheat menu Items tab
// ══════════════════════════════════════════════

let _iaItems = [];

const IA_QUALITIES = ['basic','sturdy','fine','superior','legendary'];
const IA_RARITIES  = ['common','uncommon','rare','epic','legendary'];
const IA_SLOTS     = ['weapon','armour','trinket','tool'];
const IA_SEASONS   = ['spring','summer','autumn','winter'];
const IA_CATEGORIES = ['fish','equipment','material','food','quest_item','trophy','misc'];
const IA_RARITY_COLORS = { common:'#a0c880', uncommon:'#70b8e0', rare:'#e8a020', epic:'#c060e0', legendary:'#ff8020' };

// Item admin always uses /api/game/items (consolidated route)
async function _iaFetch(path, opts) {
  return apiFetch('/api/game/items' + path, opts);
}

async function loadItemAdmin() {
  const list = document.getElementById('ia-list');
  if (list) list.innerHTML = '<div style="color:rgba(192,221,151,.3);font-size:11px;padding:8px">Loading…</div>';
  try {
    const r = await _iaFetch('');
    if (!r.ok) {
      if (list) list.innerHTML = '<div style="color:#e07a6a;font-size:11px;padding:8px">⚠️ Could not load items (status ' + r.status + ')</div>';
      return;
    }
    const d = await r.json();
    _iaItems = d.items || [];
    _iaRenderList();
  } catch(e) {
    if (list) list.innerHTML = '<div style="color:#e07a6a;font-size:11px;padding:8px">⚠️ ' + e.message + '</div>';
  }
}

function _iaRenderList() {
  const el = document.getElementById('ia-list');
  if (!el) return;
  if (!_iaItems.length) {
    el.innerHTML = '<div style="color:rgba(192,221,151,.3);font-size:11px;padding:8px">No items yet. Click Seed All Items or New Item.</div>';
    return;
  }
  const groups = {};
  _iaItems.forEach(i => { if (!groups[i.category]) groups[i.category] = []; groups[i.category].push(i); });
  const html = Object.entries(groups).map(([cat, items]) =>
    '<div class="qa-section-label">' + cat + ' (' + items.length + ')</div>'
    + items.map(item => {
      const rc = IA_RARITY_COLORS[item.rarity] || '#888';
      return '<div class="qa-row">'
        + '<span class="qa-row-icon">' + item.icon + '</span>'
        + '<span style="font-size:9px;color:' + rc + ';min-width:60px">' + item.rarity + '</span>'
        + '<span class="qa-row-title">' + item.name + '</span>'
        + '<span style="font-size:9px;color:rgba(220,185,80,.5)">' + (item.sell_value ? '🪙' + item.sell_value : '') + '</span>'
        + '<div class="qa-row-btns">'
        + '<button class="qa-btn" data-key="' + item.item_key + '" onclick="ia_showForm(this.dataset.key)">✏</button>'
        + '<button class="qa-btn" data-key="' + item.item_key + '" onclick="ia_spawn(this.dataset.key)" title="Add to inventory">⬇</button>'
        + '<button class="qa-btn qa-btn-archive" data-key="' + item.item_key + '" onclick="ia_delete(this.dataset.key)">🗑</button>'
        + '</div></div>';
    }).join('')
  ).join('');
  el.innerHTML = html;
}

function ia_showForm(key) {
  const item = key ? _iaItems.find(i => i.item_key === key) : null;
  const isNew = !item;
  const wrap = document.getElementById('ia-form-wrap');
  if (!wrap) return;
  wrap.style.display = 'block';

  const tip = (t) => '<span class="qa-tip" title="' + t + '">?</span>';
  const sel = (id, opts, cur) => '<select class="ce-input" id="' + id + '">'
    + opts.map(o => '<option value="' + o + '"' + (cur===o?' selected':'') + '>' + o + '</option>').join('')
    + '</select>';

  const cat = item?.category || 'misc';
  const fishSeasons = Array.isArray(item?.fish_seasons) ? item.fish_seasons : [];

  wrap.innerHTML = '<div class="qa-form">'
    + '<div class="qa-form-header">' + (isNew ? '＋ New Item' : 'Edit: ' + item.name)
    + '<button onclick="document.getElementById(\'ia-form-wrap\').style.display=\'none\'" style="margin-left:auto;background:none;border:none;color:rgba(192,221,151,.5);cursor:pointer;font-size:14px">✕</button></div>'

    // Identity
    + '<div class="qa-section-label">Identity</div>'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>Item Key ' + tip('Unique snake_case ID. e.g. iron_sword, trout, ancient_heartwood') + '</label><input class="ce-input" id="ia-key" value="' + (item?.item_key||'') + '"' + (!isNew?' readonly':'') + ' placeholder="my_item_key"></div>'
    + '<div class="ce-field"><label>Icon</label><input class="ce-input" id="ia-icon" value="' + (item?.icon||'📦') + '"></div>'
    + '</div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Name</label><input class="ce-input" id="ia-name" value="' + (item?.name||'') + '" placeholder="Iron Sword"></div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Description</label><textarea class="ce-input" id="ia-desc" rows="2" placeholder="A sturdy blade, well-balanced.">' + (item?.description||'') + '</textarea></div>'

    // Category & Rarity
    + '<div class="qa-section-label" style="margin-top:8px">Category & Rarity</div>'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>Category</label>' + sel('ia-cat', IA_CATEGORIES, cat) + '</div>'
    + '<div class="ce-field"><label>Rarity</label>' + sel('ia-rarity', IA_RARITIES, item?.rarity||'common') + '</div>'
    + '<div class="ce-field"><label>Sell Value 🪙</label><input class="ce-input" type="number" id="ia-sell" value="' + (item?.sell_value||0) + '"></div>'
    + '</div>'

    // ── Category-specific sections ──
    + '<div id="ia-fish-section">'
    + '<div class="qa-section-label" style="margin-top:8px">Fish Properties</div>'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>Difficulty ' + tip('1=very easy, 10=legendary. Controls minigame speed & pool weight') + '</label><input class="ce-input" type="number" id="ia-fish-diff" min="1" max="10" value="' + (item?.fish_difficulty||3) + '"></div>'
    + '<div class="ce-field"><label>Weight ' + tip('Higher = appears more often. Common=40-60, Rare=5-10, Legendary=1-2') + '</label><input class="ce-input" type="number" id="ia-fish-weight" value="' + (item?.fish_weight||30) + '"></div>'
    + '<div class="ce-field"><label>Gold Value ' + tip('How much it sells for') + '</label><input class="ce-input" type="number" id="ia-fish-val" value="' + (item?.fish_value||2) + '"></div>'
    + '</div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Flavour text</label><input class="ce-input" id="ia-fish-flavour" value="' + (item?.fish_flavour||'') + '" placeholder="A quick silver-sided fish."></div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Seasons ' + tip('Which seasons this fish appears in. Check all that apply.') + '</label>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:4px 0">'
    + IA_SEASONS.map(s => '<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer"><input type="checkbox" id="ia-fish-s-' + s + '"' + (fishSeasons.includes(s)?' checked':'') + '> ' + s + '</label>').join('')
    + '</div></div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Food Value ' + tip('How much food/hunger restored when eaten') + '</label><input class="ce-input" type="number" id="ia-food" value="' + (item?.food_value||3) + '"></div>'
    + '</div>'

    + '<div id="ia-equip-section">'
    + '<div class="qa-section-label" style="margin-top:8px">Equipment</div>'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>Slot</label>' + sel('ia-slot', [''].concat(IA_SLOTS), item?.equip_slot||'') + '</div>'
    + '<div class="ce-field"><label>Quality ' + tip('basic → sturdy → fine → superior → legendary. Affects stat multipliers later.') + '</label>' + sel('ia-quality', IA_QUALITIES, item?.quality||'basic') + '</div>'
    + '</div>'
    + '<div id="ia-armour-section">'
    + '<div class="ce-field" style="margin-top:6px"><label>Armour Class (AC) ' + tip('Flat damage reduction. 1=light leather, 5=plate. Added to citizen\'s defence roll.') + '</label><input class="ce-input" type="number" id="ia-ac" min="0" max="20" value="' + (item?.armor_class||0) + '"></div>'
    + '</div>'
    + '<div id="ia-weapon-section">'
    + '<div class="ce-grid" style="margin-top:6px">'
    + '<div class="ce-field"><label>Damage Dice ' + tip('Dice notation: 1d6, 2d4+2, 1d8. Used in combat rolls.') + '</label><input class="ce-input" id="ia-dmg" value="' + (item?.damage_dice||'1d4') + '" placeholder="1d6"></div>'
    + '<div class="ce-field"><label>Damage Bonus ' + tip('Flat bonus added to every damage roll. e.g. +2') + '</label><input class="ce-input" type="number" id="ia-dmg-bonus" value="' + (item?.damage_bonus||0) + '"></div>'
    + '</div></div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Stat Bonuses ' + tip('JSON: {"combat":2,"scouting":1}. These bonus apply when equipped.') + '</label><input class="ce-input" id="ia-stats" value="' + JSON.stringify(item?.stat_bonuses||{}) + '"></div>'
    + '</div>'

    + '<div id="ia-food-section">'
    + '<div class="qa-section-label" style="margin-top:8px">Food Properties</div>'
    + '<div class="ce-field"><label>Food Value ' + tip('Food/hunger restored when consumed') + '</label><input class="ce-input" type="number" id="ia-food-val" value="' + (item?.food_value||5) + '"></div>'
    + '</div>'

    + '<button class="cheat-all-btn" style="margin-top:12px" onclick="ia_save(' + (!isNew ? JSON.stringify(key) : 'null') + ')">💾 ' + (isNew ? 'Create Item' : 'Save Changes') + '</button>'
    + '</div>';

  // Show/hide sections based on category
  const catEl = wrap.querySelector('#ia-cat');
  const slotEl = wrap.querySelector('#ia-slot');
  const updateSections = () => {
    const c = catEl.value;
    const slot = slotEl?.value;
    wrap.querySelector('#ia-fish-section').style.display   = c === 'fish' ? '' : 'none';
    wrap.querySelector('#ia-equip-section').style.display  = c === 'equipment' ? '' : 'none';
    wrap.querySelector('#ia-food-section').style.display   = (c === 'food' && c !== 'fish') ? '' : 'none';
    wrap.querySelector('#ia-armour-section').style.display = slot === 'armour' ? '' : 'none';
    wrap.querySelector('#ia-weapon-section').style.display = slot === 'weapon' ? '' : 'none';
  };
  catEl.addEventListener('change', updateSections);
  slotEl?.addEventListener('change', updateSections);
  updateSections();
}

async function ia_save(existingKey) {
  const isNew = !existingKey;
  const cat   = document.getElementById('ia-cat')?.value || 'misc';
  const slot  = document.getElementById('ia-slot')?.value || null;

  let stat_bonuses = {};
  try { stat_bonuses = JSON.parse(document.getElementById('ia-stats')?.value || '{}'); } catch(e) {}

  const seasons = IA_SEASONS.filter(s => document.getElementById('ia-fish-s-' + s)?.checked);

  const body = {
    item_key:    document.getElementById('ia-key')?.value?.trim(),
    name:        document.getElementById('ia-name')?.value?.trim(),
    description: document.getElementById('ia-desc')?.value?.trim() || '',
    icon:        document.getElementById('ia-icon')?.value?.trim() || '📦',
    category:    cat,
    rarity:      document.getElementById('ia-rarity')?.value || 'common',
    quality:     document.getElementById('ia-quality')?.value || 'basic',
    sell_value:  parseInt(document.getElementById('ia-sell')?.value) || 0,
    equip_slot:  slot || null,
    stat_bonuses,
    // Fish
    food_value:      cat === 'fish' ? parseInt(document.getElementById('ia-food')?.value) || 0
                   : cat === 'food' ? parseInt(document.getElementById('ia-food-val')?.value) || 0 : 0,
    fish_seasons:    cat === 'fish' ? seasons : null,
    fish_difficulty: cat === 'fish' ? parseInt(document.getElementById('ia-fish-diff')?.value) || 3 : null,
    fish_weight:     cat === 'fish' ? parseInt(document.getElementById('ia-fish-weight')?.value) || 30 : null,
    fish_value:      cat === 'fish' ? parseInt(document.getElementById('ia-fish-val')?.value) || 0 : null,
    fish_flavour:    cat === 'fish' ? document.getElementById('ia-fish-flavour')?.value || null : null,
    // Equipment
    armor_class:  slot === 'armour' ? parseInt(document.getElementById('ia-ac')?.value) || 0 : null,
    damage_dice:  slot === 'weapon' ? document.getElementById('ia-dmg')?.value || null : null,
    damage_bonus: slot === 'weapon' ? parseInt(document.getElementById('ia-dmg-bonus')?.value) || 0 : 0,
  };

  if (!body.item_key || !body.name) { _iaFeedback('⚠️ Key and name required.'); return; }

  const url    = isNew ? '/api/item-admin' : '/api/item-admin/' + existingKey;
  const method = isNew ? 'POST' : 'PATCH';
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { _iaFeedback('⚠️ ' + (d.error || 'Failed')); return; }
  _iaFeedback('✓ Saved: ' + body.name);
  document.getElementById('ia-form-wrap').style.display = 'none';
  await loadItemAdmin();
}

async function ia_spawn(key) {
  const r = await _iaFetch('/' + key + '/spawn', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: 1 }),
  });
  const d = await r.json();
  _iaFeedback(d.ok ? '✓ Added to inventory.' : '⚠️ ' + d.error);
}

async function ia_delete(key) {
  if (!confirm('Delete item template "' + key + '"? This does not remove existing inventory items.')) return;
  await _iaFetch('/' + key, { method: 'DELETE' });
  await loadItemAdmin();
}

function _iaFeedback(msg) {
  const el = document.getElementById('ia-feedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = msg.startsWith('✓') ? '#8ecf7e' : '#e07a6a';
  setTimeout(() => { if (el) el.textContent = ''; }, 3000);
}

async function ia_seedDefaults() {
  const fb = document.getElementById('ia-feedback');
  if (fb) { fb.textContent = 'Seeding…'; fb.style.color = '#e8c76a'; }

  // Check route is available first
  const check = await _iaFetch('');
  if (!check.ok) {
    _iaFeedback('⚠️ Server not ready — deploy server first, then try again.');
    return;
  }

  const defaults = _iaGetDefaultItems();
  let seeded = 0;
  for (const item of defaults) {
    const r = await _iaFetch('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item),
    });
    if (r.ok) seeded++;
  }
  _iaFeedback('✓ Seeded ' + seeded + ' items.');
  await loadItemAdmin();
}

function _iaGetDefaultItems() {
  // Fish
  const fishItems = [
    { item_key:'fish_minnow', name:'Minnow', icon:'🐟', category:'fish', rarity:'common', sell_value:2, food_value:3, fish_difficulty:1, fish_weight:60, fish_value:2, fish_seasons:['spring','summer','autumn','winter'], fish_flavour:'A small, darting thing. Common but plentiful.' },
    { item_key:'fish_gudgeon', name:'Gudgeon', icon:'🐟', category:'fish', rarity:'common', sell_value:2, food_value:3, fish_difficulty:1, fish_weight:55, fish_value:2, fish_seasons:['spring','summer','autumn'], fish_flavour:'Barely worth the trouble, but the river is full of them.' },
    { item_key:'fish_dace', name:'Dace', icon:'🐠', category:'fish', rarity:'common', sell_value:4, food_value:5, fish_difficulty:2, fish_weight:45, fish_value:4, fish_seasons:['spring','summer','winter'], fish_flavour:'Quick and silver-sided. Slips the hook easily.' },
    { item_key:'fish_perch', name:'Perch', icon:'🐠', category:'fish', rarity:'common', sell_value:5, food_value:6, fish_difficulty:2, fish_weight:40, fish_value:5, fish_seasons:['spring','summer','autumn'], fish_flavour:'Spiny and stubborn. Puts up a decent fight.' },
    { item_key:'fish_roach', name:'Roach', icon:'🐟', category:'fish', rarity:'common', sell_value:4, food_value:5, fish_difficulty:2, fish_weight:42, fish_value:4, fish_seasons:['spring','autumn','winter'], fish_flavour:'Red-finned and restless. A staple of the river.' },
    { item_key:'fish_trout', name:'Trout', icon:'🐡', category:'fish', rarity:'uncommon', sell_value:10, food_value:8, fish_difficulty:4, fish_weight:22, fish_value:10, fish_seasons:['spring','autumn','winter'], fish_flavour:'A strong swimmer. Worth the effort.' },
    { item_key:'fish_chub', name:'Chub', icon:'🐡', category:'fish', rarity:'uncommon', sell_value:8, food_value:7, fish_difficulty:3, fish_weight:28, fish_value:8, fish_seasons:['summer','autumn'], fish_flavour:'Thick-bodied and suspicious.' },
    { item_key:'fish_catfish', name:'Catfish', icon:'🐊', category:'fish', rarity:'uncommon', sell_value:14, food_value:9, fish_difficulty:5, fish_weight:18, fish_value:14, fish_seasons:['summer','autumn'], fish_flavour:'Bottom-dwelling and fierce.' },
    { item_key:'fish_bream', name:'Bream', icon:'🐡', category:'fish', rarity:'uncommon', sell_value:11, food_value:8, fish_difficulty:4, fish_weight:20, fish_value:11, fish_seasons:['spring','summer'], fish_flavour:'Deep-bodied and slow to start, then suddenly wild.' },
    { item_key:'fish_pike', name:'Pike', icon:'🦷', category:'fish', rarity:'uncommon', sell_value:18, food_value:10, fish_difficulty:6, fish_weight:14, fish_value:18, fish_seasons:['autumn','winter'], fish_flavour:'Teeth like needles and a temper to match.' },
    { item_key:'fish_salmon', name:'Salmon', icon:'🍣', category:'fish', rarity:'rare', sell_value:28, food_value:18, fish_difficulty:7, fish_weight:8, fish_value:28, fish_seasons:['autumn'], fish_flavour:'Runs against the current with furious strength.' },
    { item_key:'fish_eel', name:'River Eel', icon:'〰️', category:'fish', rarity:'rare', sell_value:25, food_value:15, fish_difficulty:7, fish_weight:9, fish_value:25, fish_seasons:['summer','autumn'], fish_flavour:'Writhes and twists. Keeping it on the line takes nerve.' },
    { item_key:'fish_golden_carp', name:'Golden Carp', icon:'✨', category:'fish', rarity:'rare', sell_value:35, food_value:20, fish_difficulty:8, fish_weight:5, fish_value:35, fish_seasons:['winter'], fish_flavour:'Gleams beneath the ice.' },
    { item_key:'fish_shadowfin', name:'Shadowfin', icon:'🌑', category:'fish', rarity:'legendary', sell_value:60, food_value:40, fish_difficulty:9, fish_weight:2, fish_value:60, fish_seasons:['autumn','winter'], fish_flavour:'Dark as river-bottom mud. Few have seen one.' },
    { item_key:'fish_moontrout', name:'Moontrout', icon:'🌕', category:'fish', rarity:'legendary', sell_value:100, food_value:55, fish_difficulty:10, fish_weight:1, fish_value:100, fish_seasons:['winter'], fish_flavour:'Said to swim only on clear winter nights.' },
    // Equipment — weapons
    { item_key:'iron_sword', name:'Iron Sword', icon:'⚔️', category:'equipment', rarity:'common', quality:'sturdy', equip_slot:'weapon', sell_value:20, damage_dice:'1d6', damage_bonus:0, stat_bonuses:{combat:2} },
    { item_key:'steel_sword', name:'Steel Sword', icon:'🗡️', category:'equipment', rarity:'rare', quality:'fine', equip_slot:'weapon', sell_value:55, damage_dice:'1d8', damage_bonus:2, stat_bonuses:{combat:4} },
    { item_key:'hunters_dagger', name:"Hunter's Dagger", icon:'🔪', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'weapon', sell_value:30, damage_dice:'1d4+1', damage_bonus:1, stat_bonuses:{combat:2,scouting:1} },
    // Equipment — armour
    { item_key:'leather_armour', name:'Leather Armour', icon:'🛡️', category:'equipment', rarity:'common', quality:'basic', equip_slot:'armour', sell_value:18, armor_class:2, stat_bonuses:{combat:1} },
    { item_key:'chainmail', name:'Chainmail', icon:'🔗', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'armour', sell_value:40, armor_class:4, stat_bonuses:{combat:2} },
    { item_key:'dragonscale_armour', name:'Dragonscale Armour', icon:'🐉', category:'equipment', rarity:'epic', quality:'fine', equip_slot:'armour', sell_value:120, armor_class:8, stat_bonuses:{combat:5,scouting:2} },
    // Equipment — tools/trinkets
    { item_key:'scouts_cloak', name:"Scout's Cloak", icon:'🧥', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'trinket', sell_value:35, stat_bonuses:{scouting:3} },
    { item_key:'fishers_rod', name:"Fisher's Rod", icon:'🎣', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'tool', sell_value:25, stat_bonuses:{fishing:3} },
    { item_key:'hunters_cloak', name:"Hunter's Cloak", icon:'🧥', category:'equipment', rarity:'rare', quality:'fine', equip_slot:'armour', sell_value:60, armor_class:3, stat_bonuses:{scouting:2,combat:1} },
    // Materials
    { item_key:'timber_bundle', name:'Timber Bundle', icon:'🪵', category:'material', rarity:'common', sell_value:5 },
    { item_key:'iron_ore', name:'Iron Ore', icon:'⚫', category:'material', rarity:'common', sell_value:8 },
    { item_key:'rare_sap', name:'Rare Sap', icon:'🫙', category:'material', rarity:'uncommon', sell_value:20 },
    { item_key:'ancient_heartwood', name:'Ancient Heartwood', icon:'🪵', category:'material', rarity:'rare', sell_value:45 },
    { item_key:'gemstone', name:'Gemstone', icon:'💎', category:'material', rarity:'rare', sell_value:50 },
    // Quest items
    { item_key:'luminous_scale', name:'Luminous Scale', icon:'✨', category:'quest_item', rarity:'rare', sell_value:40 },
    { item_key:'ancient_blueprint', name:'Ancient Blueprint', icon:'📜', category:'quest_item', rarity:'epic', sell_value:80 },
    { item_key:'blightbane_herb', name:'Blightbane Herb', icon:'🌿', category:'material', rarity:'rare', sell_value:35 },
    // Trophies
    { item_key:'beast_horn', name:'Beast Horn', icon:'📯', category:'trophy', rarity:'uncommon', sell_value:30 },
    { item_key:'ancient_coin', name:'Ancient Coin', icon:'🪙', category:'trophy', rarity:'rare', sell_value:40 },
    { item_key:'dragon_tooth', name:'Dragon Tooth', icon:'🦷', category:'trophy', rarity:'epic', sell_value:100 },
  ];
  return fishItems;
}
