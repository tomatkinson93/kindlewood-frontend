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

    + '<div class="qa-section-label" style="margin-top:14px">Health Range <span class="qa-tip" title="If both set, each spawn rolls HP between min and max (seeded, so replays match). Leave blank to use Max HP flat.">?</span></div>'
    + '<div class="ce-grid" style="grid-template-columns:1fr 1fr">'
    +   numField('HP Min (optional)', 'ea-hpmin', (cur.hp_min != null ? cur.hp_min : ''), 1, 500)
    +   numField('HP Max (optional)', 'ea-hpmax', (cur.hp_max != null ? cur.hp_max : ''), 1, 500)
    + '</div>'

    + '<div class="qa-section-label" style="margin-top:14px">Moves '
    +   '<button class="ca-help-btn" type="button" onclick="ea_showFormulaHelp()">?</button></div>'
    + '<div class="ea-help-pop" id="ea-help-pop" style="display:none"></div>'
    + '<div class="ce-field"><label>Move Order</label>'
    +   '<select id="ea-movemode" class="ce-input">'
    +     '<option value="sequence"' + ((cur.move_mode || 'sequence') === 'sequence' ? ' selected' : '') + '>Sequence (cycle in order)</option>'
    +     '<option value="weighted"' + (cur.move_mode === 'weighted' ? ' selected' : '') + '>Weighted (random by weight)</option>'
    +   '</select></div>'
    + '<div id="ea-moves-list" style="margin-top:8px"></div>'
    + '<button class="qa-btn" style="margin-top:6px" onclick="ea_addMove()">＋ Add Move</button>'

    + '<div class="qa-section-label" style="margin-top:14px">Loot Drops <span class="qa-tip" title="Items rolled on death (seeded). chance is 0–1; qty rolls between min and max. Shown on the battle reward screen.">?</span></div>'
    + '<div id="ea-drops-list"></div>'
    + '<button class="qa-btn" style="margin-top:6px" onclick="ea_addDrop()">＋ Add Drop</button>'

    + '<div class="cheat-rel-feedback" id="ea-form-feedback" style="margin-top:8px"></div>'
    + '<button class="cheat-all-btn" style="margin-top:12px" onclick="ea_save(' + (!isNew ? "'" + String(cur.id).replace(/'/g, "\\'") + "'" : 'null') + ')">💾 ' + (isNew ? 'Create Enemy' : 'Save Changes') + '</button>'
    + '</div>';

  // Working copies of the moves/drops arrays, edited in place by the row UIs.
  _eaMoves = Array.isArray(cur.moves) ? JSON.parse(JSON.stringify(cur.moves)) : [];
  _eaDrops = Array.isArray(cur.drops) ? JSON.parse(JSON.stringify(cur.drops)) : [];
  _eaRenderMoves();
  _eaRenderDrops();
}

// ── Moves editor ──────────────────────────────────────────────────────────
let _eaMoves = [];
let _eaDrops = [];
const EA_INTENTS = ['attack', 'block', 'buff', 'debuff', 'move', 'special'];
const EA_HITS = ['choose', 'front', 'pierce', 'aoe'];
const EA_TARGETS = ['enemy', 'self', 'ally', 'all_enemies', 'all_allies'];

function _eaEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function _eaRenderMoves() {
  const el = document.getElementById('ea-moves-list');
  if (!el) return;
  if (!_eaMoves.length) {
    el.innerHTML = '<div style="color:rgba(192,221,151,.3);font-size:11px;padding:4px">No moves — this enemy will use a basic attack. Add moves for formation-aware abilities.</div>';
    return;
  }
  const opt = (arr, val) => arr.map(o => '<option value="' + o + '"' + (o === val ? ' selected' : '') + '>' + o + '</option>').join('');
  el.innerHTML = _eaMoves.map((m, i) =>
    '<div class="ea-move-row" style="border:1px solid #3a3120;border-radius:7px;padding:8px;margin-bottom:7px">'
    + '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'
    +   '<span style="color:#c9a45c;font-size:11px;font-weight:700">#' + (i + 1) + '</span>'
    +   '<input class="ce-input" style="flex:1" placeholder="Move name" value="' + _eaEsc(m.name || '') + '" oninput="_eaMoves[' + i + '].name=this.value">'
    +   '<button class="qa-btn" title="Move up" onclick="ea_moveMoveUp(' + i + ')" ' + (i === 0 ? 'disabled style="opacity:.3"' : '') + '>↑</button>'
    +   '<button class="qa-btn" title="Move down" onclick="ea_moveMoveDown(' + i + ')" ' + (i === _eaMoves.length - 1 ? 'disabled style="opacity:.3"' : '') + '>↓</button>'
    +   '<button class="qa-btn qa-btn-archive" title="Remove" onclick="ea_removeMove(' + i + ')">🗑</button>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px">'
    +   '<select class="ce-input" onchange="_eaMoves[' + i + '].intent=this.value" title="Intent (telegraph icon)">' + opt(EA_INTENTS, m.intent || 'attack') + '</select>'
    +   '<select class="ce-input" onchange="_eaMoves[' + i + '].target=this.value" title="Target">' + opt(EA_TARGETS, m.target || 'enemy') + '</select>'
    +   '<select class="ce-input" onchange="ea_moveHitChange(' + i + ',this.value)" title="Hit mode">' + opt(EA_HITS, m.hit || 'choose') + '</select>'
    + '</div>'
    + (((m.hit || 'choose') === 'pierce') ?
        '<div style="display:flex;gap:6px;margin-bottom:6px">'
      + '<input class="ce-input" type="number" min="1" placeholder="depth (blank=all)" value="' + (m.pierce_count != null ? m.pierce_count : '') + '" oninput="_eaMoves[' + i + '].pierce_count=this.value" title="Pierce depth">'
      + '<input class="ce-input" type="number" step="0.05" min="0" max="1" placeholder="falloff" value="' + (m.pierce_falloff != null ? m.pierce_falloff : 1) + '" oninput="_eaMoves[' + i + '].pierce_falloff=this.value" title="Damage falloff per step">'
      + '</div>' : '')
    + '<textarea class="ce-input" rows="2" placeholder="Formula, e.g. damage: strength*1.0+5" oninput="_eaMoves[' + i + '].formula=this.value" style="font-family:monospace;font-size:12px">' + _eaEsc(m.formula || '') + '</textarea>'
    + '<div style="display:flex;gap:6px;align-items:center;margin-top:6px">'
    +   '<input class="ce-input" style="flex:1" placeholder="Sound effect file, e.g. bite.mp3" value="' + _eaEsc(m.sfx || '') + '" oninput="_eaMoves[' + i + '].sfx=this.value" title="Plays from /assets/audio/enemies/<file> when this move is used">'
    +   '<button class="qa-btn" type="button" title="Test play" onclick="ea_testMoveSfx(' + i + ')">▶</button>'
    + '</div>'
    + (document.getElementById('ea-movemode') && document.getElementById('ea-movemode').value === 'weighted'
        ? '<div style="margin-top:6px"><label style="font-size:10px;color:#c9a45c">Weight</label> <input class="ce-input" style="width:70px;display:inline-block" type="number" min="1" value="' + (m.weight || 1) + '" oninput="_eaMoves[' + i + '].weight=parseInt(this.value)||1"></div>'
        : '')
    + '</div>'
  ).join('');
}

function ea_addMove() {
  _eaMoves.push({ key: 'move_' + (_eaMoves.length + 1), name: 'New Move', intent: 'attack', target: 'enemy', hit: 'choose', formula: 'damage: strength*1.0+3', weight: 1 });
  _eaRenderMoves();
}
function ea_removeMove(i) { _eaMoves.splice(i, 1); _eaRenderMoves(); }
function ea_moveHitChange(i, v) { _eaMoves[i].hit = v; _eaRenderMoves(); }
function ea_moveMoveUp(i) { if (i <= 0) return; const t = _eaMoves[i - 1]; _eaMoves[i - 1] = _eaMoves[i]; _eaMoves[i] = t; _eaRenderMoves(); }
function ea_moveMoveDown(i) { if (i >= _eaMoves.length - 1) return; const t = _eaMoves[i + 1]; _eaMoves[i + 1] = _eaMoves[i]; _eaMoves[i] = t; _eaRenderMoves(); }

function _eaRenderDrops() {
  const el = document.getElementById('ea-drops-list');
  if (!el) return;
  if (!_eaDrops.length) {
    el.innerHTML = '<div style="color:rgba(192,221,151,.3);font-size:11px;padding:4px">No drops.</div>';
    return;
  }
  el.innerHTML = _eaDrops.map((d, i) =>
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">'
    + '<input class="ce-input" style="flex:1" placeholder="item key" value="' + _eaEsc(d.item || '') + '" oninput="_eaDrops[' + i + '].item=this.value">'
    + '<input class="ce-input" style="width:80px" type="number" step="0.05" min="0" max="1" placeholder="chance" value="' + (d.chance != null ? d.chance : 1) + '" oninput="_eaDrops[' + i + '].chance=parseFloat(this.value)" title="Drop chance 0–1">'
    + '<input class="ce-input" style="width:60px" type="number" min="0" placeholder="min" value="' + (d.min != null ? d.min : 1) + '" oninput="_eaDrops[' + i + '].min=parseInt(this.value)" title="Min qty">'
    + '<input class="ce-input" style="width:60px" type="number" min="0" placeholder="max" value="' + (d.max != null ? d.max : 1) + '" oninput="_eaDrops[' + i + '].max=parseInt(this.value)" title="Max qty">'
    + '<button class="qa-btn qa-btn-archive" onclick="ea_removeDrop(' + i + ')">🗑</button>'
    + '</div>'
  ).join('');
}
function ea_addDrop() { _eaDrops.push({ item: '', chance: 0.5, min: 1, max: 1 }); _eaRenderDrops(); }
function ea_removeDrop(i) { _eaDrops.splice(i, 1); _eaRenderDrops(); }

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
    move_mode:     document.getElementById('ea-movemode') ? document.getElementById('ea-movemode').value : 'sequence',
    hp_min:        (document.getElementById('ea-hpmin').value || '') === '' ? null : parseInt(document.getElementById('ea-hpmin').value),
    hp_max:        (document.getElementById('ea-hpmax').value || '') === '' ? null : parseInt(document.getElementById('ea-hpmax').value),
    moves:         (_eaMoves || []).map((m, i) => ({
      key: (m.key || ('move_' + (i + 1))),
      name: m.name || 'Move',
      formula: m.formula || '',
      target: m.target || 'enemy',
      hit: m.hit || 'choose',
      pierce_count: (m.pierce_count === '' || m.pierce_count == null) ? null : parseInt(m.pierce_count),
      pierce_falloff: (m.pierce_falloff === '' || m.pierce_falloff == null) ? 1.0 : Number(m.pierce_falloff),
      intent: m.intent || 'attack',
      weight: m.weight || 1,
      sfx: (m.sfx || '').trim(),
    })),
    drops:         (_eaDrops || []).filter(d => d.item),
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

// ── Formula reference popup for enemy moves (mirrors the card editor) ──────
let _eaFormulaHelp = null;
async function ea_loadFormulaHelp() {
  if (_eaFormulaHelp) return _eaFormulaHelp;
  try {
    if (window.CARD_FORMULA && window.CARD_FORMULA.HELP) { _eaFormulaHelp = window.CARD_FORMULA.HELP; return _eaFormulaHelp; }
  } catch (e) {}
  try {
    const r = await apiFetch('/api/cards/meta');
    if (r.ok) { const d = await r.json(); _eaFormulaHelp = (d.help || (d.meta && d.meta.help)) || null; }
  } catch (e) {}
  return _eaFormulaHelp;
}

async function ea_showFormulaHelp() {
  const pop = document.getElementById('ea-help-pop');
  if (!pop) return;
  if (pop.style.display === 'block') { pop.style.display = 'none'; return; }
  const h = (await ea_loadFormulaHelp()) || {
    verbs: ['damage','block','heal','energy','buff','debuff','draw','discard','gold','stun','slow','poison','push','move'],
    stats: ['strength','agility','endurance','intelligence','charisma','combat'],
    examples: [], notes: [],
  };
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  pop.innerHTML =
    '<div class="ca-help-title">Enemy Move Formula Reference</div>'
    + '<div class="ca-help-sec"><b>Format:</b> one effect per line — <code>verb [name]: expression</code>. Target / hit mode / intent are set by the dropdowns above each move.</div>'
    + '<div class="ca-help-sec"><b>Verbs:</b> ' + (h.verbs || []).map(v => '<code>' + esc(v) + '</code>').join(' ') + '</div>'
    + '<div class="ca-help-sec"><b>Stats:</b> ' + (h.stats || []).map(s => '<code>' + esc(s) + '</code>').join(' ') + ' <span class="ca-muted">(+ numbers, + - * /, parentheses)</span></div>'
    + (h.notes && h.notes.length
        ? '<div class="ca-help-sec"><b>Conditions & notes:</b><ul style="margin:4px 0 0 16px;padding:0">'
          + h.notes.map(n => '<li style="margin:2px 0">' + esc(n) + '</li>').join('') + '</ul></div>'
        : '<div class="ca-help-sec"><b>Conditions:</b> prefix a line with <code>if &lt;condition&gt;:</code> — e.g. <code>if target_hp &lt; 30: damage: 100</code>, <code>if self_back: block: 8</code>. Chain with <code>and</code>.</div>')
    + '<div class="ca-help-sec"><b>Examples:</b></div>'
    + '<pre class="ca-help-pre">' + (h.examples || ['damage: strength*1.0+5','if target_hp < 40: damage: 30','damage: 6\npoison: 4','block: endurance*0.5+4']).map(esc).join('\n') + '</pre>'
    + '<button class="ca-cancel" style="margin-top:8px" onclick="document.getElementById(\'ea-help-pop\').style.display=\'none\'">Close</button>';
  pop.style.display = 'block';
}

// Preview an enemy move's sound effect from the editor.
function ea_testMoveSfx(i) {
  const m = _eaMoves[i];
  if (!m || !m.sfx) return;
  try {
    const a = new Audio('/assets/audio/enemies/' + m.sfx.trim());
    a.volume = (window.getSfxVolume ? getSfxVolume() : 0.6);
    a.play().catch(function () {});
  } catch (e) {}
}
