// ══════════════════════════════════════════════════════════════════════════
//  ENEMY ADMIN — Dev Tools › Creatures tab
//
//  CRUD for enemy_definitions. Mirrors the item_admin / quest_admin patterns
//  so the styling and feedback widgets all reuse existing classes.
//
//  Live-loaded by the combat engine via CombatEngine.loadEnemies(); calling
//  loadEnemies(true) forces a refresh after edits, so the very next test
//  battle uses the new stats.
// ══════════════════════════════════════════════════════════════════════════

let _eaList = [];

async function _eaFetch(path, opts) {
  return apiFetch('/api/combat/enemies' + path, opts);
}

async function loadEnemyAdmin() {
  const list = document.getElementById('ea-list');
  if (list) list.innerHTML = '<div style="color:rgba(192,221,151,.3);font-size:11px;padding:8px">Loading…</div>';
  try {
    const r = await _eaFetch('?include_archived=1');
    if (!r.ok) {
      if (list) list.innerHTML = '<div style="color:#e07a6a;font-size:11px;padding:8px">⚠️ Could not load enemies (status ' + r.status + ')</div>';
      return;
    }
    const d = await r.json();
    _eaList = d.enemies || [];
    _eaRenderList();
  } catch (e) {
    if (list) list.innerHTML = '<div style="color:#e07a6a;font-size:11px;padding:8px">⚠️ ' + e.message + '</div>';
  }
}

function _eaRenderList() {
  const el = document.getElementById('ea-list');
  if (!el) return;
  if (!_eaList.length) {
    el.innerHTML = '<div style="color:rgba(192,221,151,.3);font-size:11px;padding:8px">No enemies yet. Click "Seed Defaults" to bring in the bundled three.</div>';
    return;
  }
  const active = _eaList.filter(e => !e.archived);
  const archived = _eaList.filter(e => e.archived);

  const renderRow = (enemy) => {
    const stat = (lbl, val) =>
      '<span class="ea-stat"><span class="ea-stat-lbl">' + lbl + '</span> <b>' + val + '</b></span>';
    return '<div class="qa-row" style="' + (enemy.archived ? 'opacity:.5' : '') + '">'
      + '<span class="qa-row-icon" style="font-size:18px">' + enemy.icon + '</span>'
      + '<span class="qa-row-title" style="min-width:90px;flex:0 0 auto">' + enemy.name + '</span>'
      + '<span class="ea-stats">'
      +   stat('HP', enemy.max_hp)
      +   stat('STR', enemy.strength)
      +   stat('DEX', enemy.agility)
      +   stat('END', enemy.endurance)
      +   stat('CMB', enemy.combat_skill)
      +   stat('🪙w', enemy.reward_weight)
      + '</span>'
      + '<div class="qa-row-btns">'
      +   '<button class="qa-btn" data-key="' + enemy.id + '" onclick="ea_showForm(this.dataset.key)" title="Edit">✏</button>'
      +   '<button class="qa-btn qa-btn-archive" data-key="' + enemy.id + '" onclick="ea_delete(this.dataset.key)" title="' + (enemy.archived ? 'Hard delete' : 'Archive') + '">🗑</button>'
      + '</div></div>';
  };

  let html = '<div class="qa-section-label">Active (' + active.length + ')</div>'
    + active.map(renderRow).join('');
  if (archived.length) {
    html += '<div class="qa-section-label" style="margin-top:10px;color:rgba(192,221,151,.3)">Archived (' + archived.length + ')</div>'
      + archived.map(renderRow).join('');
  }
  el.innerHTML = html;
}

function ea_showForm(key) {
  const enemy = key ? _eaList.find(e => e.id === key) : null;
  const isNew = !enemy;
  const wrap = document.getElementById('ea-form-wrap');
  if (!wrap) return;
  wrap.style.display = 'block';

  // Sensible defaults for new entries.
  const cur = enemy || {
    id: '', name: '', icon: '👹', flavour: '',
    max_hp: 25, strength: 6, agility: 6, endurance: 5, combat_skill: 2,
    attack_verb: 'strikes', reward_weight: 1, sort_order: 100,
  };

  const numField = (label, id, val, min, max) =>
    '<div class="ce-field"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" class="ce-input" value="' + val + '"'
      + ' min="' + min + '" max="' + max + '"></div>';

  wrap.innerHTML = '<div class="qa-form">'
    + '<div class="qa-form-header">' + (isNew ? '＋ New Enemy' : 'Edit: ' + cur.name)
    + '<button class="qa-btn" onclick="ea_cancelForm()" title="Cancel">✕</button></div>'
    + '<div class="ce-grid" style="grid-template-columns:1fr 1fr">'
    +   '<div class="ce-field"><label>Id <span class="qa-tip" title="Permanent unique key, lowercase + underscores. Cannot be changed after creation.">?</span></label>'
    +     '<input type="text" id="ea-id" class="ce-input" value="' + cur.id + '"'
    +     (isNew ? '' : ' disabled style="opacity:.5"') + '></div>'
    +   '<div class="ce-field"><label>Name</label><input type="text" id="ea-name" class="ce-input" value="' + cur.name.replace(/"/g,'&quot;') + '"></div>'
    +   '<div class="ce-field"><label>Icon (emoji)</label><input type="text" id="ea-icon" class="ce-input" value="' + cur.icon + '" maxlength="4"></div>'
    +   '<div class="ce-field"><label>Attack Verb <span class="qa-tip" title="Used in the battle log: \'Marsh Rat <verb> Petra for X damage.\'">?</span></label>'
    +     '<input type="text" id="ea-verb" class="ce-input" value="' + (cur.attack_verb || 'strikes').replace(/"/g,'&quot;') + '"></div>'
    + '</div>'
    + '<div class="ce-field" style="margin-top:8px"><label>Flavour <span class="qa-tip" title="Optional one-line description. Currently shown in the admin list only; future: tooltip in combat.">?</span></label>'
    +   '<input type="text" id="ea-flavour" class="ce-input" value="' + (cur.flavour || '').replace(/"/g,'&quot;') + '" maxlength="280"></div>'

    + '<div class="qa-section-label" style="margin-top:14px">Combat Stats</div>'
    + '<div class="ce-grid" style="grid-template-columns:1fr 1fr 1fr">'
    +   numField('Max HP', 'ea-hp', cur.max_hp, 1, 500)
    +   numField('Strength', 'ea-str', cur.strength, 0, 50)
    +   numField('Agility (DEX)', 'ea-agi', cur.agility, 0, 50)
    +   numField('Endurance', 'ea-end', cur.endurance, 0, 50)
    +   numField('Combat Skill', 'ea-cmb', cur.combat_skill, 0, 20)
    +   numField('Reward Weight', 'ea-rw', cur.reward_weight, 0, 10)
    + '</div>'

    + '<div class="qa-section-label" style="margin-top:14px">Display</div>'
    + '<div class="ce-grid" style="grid-template-columns:1fr">'
    +   numField('Sort Order', 'ea-sort', cur.sort_order || 100, 0, 9999)
    + '</div>'

    + '<div class="cheat-rel-feedback" id="ea-form-feedback" style="margin-top:8px"></div>'
    + '<button class="cheat-all-btn" style="margin-top:12px" onclick="ea_save(' + (!isNew ? JSON.stringify(cur.id) : 'null') + ')">💾 ' + (isNew ? 'Create Enemy' : 'Save Changes') + '</button>'
    + '</div>';
}

function ea_cancelForm() {
  const wrap = document.getElementById('ea-form-wrap');
  if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
}

function _eaFormFeedback(msg, ok) {
  const el = document.getElementById('ea-form-feedback');
  if (el) {
    el.textContent = msg;
    el.style.color = ok ? '#8ecf7e' : '#e07a6a';
  }
}

async function ea_save(existingId) {
  const isNew = !existingId;
  const body = {
    id:            document.getElementById('ea-id').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    name:          document.getElementById('ea-name').value.trim(),
    icon:          document.getElementById('ea-icon').value.trim() || '👹',
    flavour:       document.getElementById('ea-flavour').value.trim(),
    max_hp:        parseInt(document.getElementById('ea-hp').value),
    strength:      parseInt(document.getElementById('ea-str').value),
    agility:       parseInt(document.getElementById('ea-agi').value),
    endurance:     parseInt(document.getElementById('ea-end').value),
    combat_skill:  parseInt(document.getElementById('ea-cmb').value),
    attack_verb:   document.getElementById('ea-verb').value.trim() || 'strikes',
    reward_weight: parseInt(document.getElementById('ea-rw').value),
    sort_order:    parseInt(document.getElementById('ea-sort').value),
  };
  if (!body.name) { _eaFormFeedback('Name is required.', false); return; }
  if (isNew && !body.id) { _eaFormFeedback('Id is required.', false); return; }

  try {
    const r = await _eaFetch(isNew ? '' : '/' + encodeURIComponent(existingId), {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { _eaFormFeedback('⚠️ ' + (d.error || 'Save failed.'), false); return; }
    _eaFormFeedback('✓ Saved.', true);
    ea_cancelForm();
    await loadEnemyAdmin();
    // Force the engine to repick definitions on the next battle.
    if (window.CombatEngine && CombatEngine.loadEnemies) {
      try { await CombatEngine.loadEnemies(true); } catch (e) {}
    }
  } catch (e) {
    _eaFormFeedback('⚠️ ' + e.message, false);
  }
}

async function ea_delete(id) {
  const enemy = _eaList.find(e => e.id === id);
  if (!enemy) return;
  const confirmMsg = enemy.archived
    ? 'Permanently delete "' + enemy.name + '"? This cannot be undone.'
    : 'Archive "' + enemy.name + '"? It will no longer appear in random battles.';
  if (!confirm(confirmMsg)) return;
  try {
    const r = await _eaFetch('/' + encodeURIComponent(id), { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) { alert('⚠️ ' + (d.error || 'Delete failed.')); return; }
    await loadEnemyAdmin();
    if (window.CombatEngine && CombatEngine.loadEnemies) {
      try { await CombatEngine.loadEnemies(true); } catch (e) {}
    }
  } catch (e) { alert('⚠️ ' + e.message); }
}

async function ea_seedDefaults(force) {
  if (force && !confirm('Force-overwrite all defaults? Custom stat changes on bundled enemies will be lost.')) return;
  try {
    const r = await _eaFetch('/seed' + (force ? '?force=1' : ''), { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { alert('⚠️ ' + (d.error || 'Seed failed.')); return; }
    await loadEnemyAdmin();
    if (window.CombatEngine && CombatEngine.loadEnemies) {
      try { await CombatEngine.loadEnemies(true); } catch (e) {}
    }
  } catch (e) { alert('⚠️ ' + e.message); }
}
