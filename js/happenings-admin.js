// ══════════════════════════════════════════════════════════════════════════
//  Dev Tools → 🏮 Happenings (spec 021 §6.6). Admin only — the server checks
//  requireAdmin on every /api/happenings/admin route.
//
//  List · create / edit form with a rule builder for the six rule types ·
//  effects as a JSON textarea (validated as you type) · a live 7-day × 24-hour
//  UTC coverage heatmap with the fairness warning inline · the next 5 windows
//  in local time. Rule validation and fairness use the shared KWDayCycle
//  (validateRule / fairnessOf), so the preview matches the server's verdict.
// ══════════════════════════════════════════════════════════════════════════

let _haList = [];
const HA_TYPES = [['daily', 'Daily'], ['weekly', 'Weekly'], ['rotating', 'Rotating (moves each day)'], ['phase', 'Day phase'], ['moon', 'Moon + phase'], ['once', 'One-off']];
const HA_PHASES = [['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']];
const HA_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HA_EFFECTS_HELP = '[{"type":"banner"}]  ·  {"type":"enemy_pool","add":["enemy_id"]}  ·  {"type":"map_flourish","kind":"lanterns"}';

function _haEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _haNow() { return window.KWClock ? KWClock.now() : Date.now(); }
function _haLocal(ms) {
  try { return new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch (e) { return new Date(ms).toISOString(); }
}

async function loadHappeningsAdmin() {
  const el = document.getElementById('ha-list');
  if (!el) return;
  try {
    const r = await apiFetch('/api/happenings/admin');
    const d = await r.json();
    if (!r.ok) { el.innerHTML = '<div class="ha-empty">⚠️ ' + _haEsc(d.error || 'Could not load.') + '</div>'; return; }
    _haList = d.happenings || [];
    _haRenderList();
  } catch (e) { el.innerHTML = '<div class="ha-empty">⚠️ ' + _haEsc(e.message) + '</div>'; }
}

// Plain-English rule summary for the list.
function _haDescribe(rule) {
  const r = rule || {};
  const moonName = (id) => { const i = KWDayCycle.MOON_IDS.indexOf(id); return i >= 0 ? KWDayCycle.MOON_GLYPHS[i] : id; };
  const hrs = (m) => (m % 60 ? (m / 60).toFixed(1) : m / 60) + 'h';
  switch (r.type) {
    case 'once': return 'Once · ' + _haLocal(Date.parse(r.start)) + ' → ' + _haLocal(Date.parse(r.end));
    case 'daily': return 'Daily ' + r.start + ' UTC · ' + hrs(r.durationMin);
    case 'weekly': return (r.days || []).map(d => HA_DAYS[d]).join('/') + ' ' + r.start + ' UTC · ' + hrs(r.durationMin);
    case 'rotating': return 'Rotating from ' + r.start + ' UTC, +' + r.shiftHours + 'h a day · ' + hrs(r.durationMin);
    case 'phase': return 'Every ' + (r.phases || []).join(' + ');
    case 'moon': return (r.moons || []).map(moonName).join('') + ' · ' + (r.phases || []).join(' + ');
    default: return '?';
  }
}

function _haRenderList() {
  const el = document.getElementById('ha-list');
  if (!el) return;
  if (!_haList.length) { el.innerHTML = '<div class="ha-empty">No Happenings yet. Create one with ＋ New Happening.</div>'; return; }
  const now = _haNow();
  el.innerHTML = _haList.map(h => {
    const on = !h.archived && h.enabled && KWDayCycle.windowsBetween(h.rule, now, now + 1).length > 0;
    const badges = (on ? '<span class="ha-badge ha-badge-on">On now</span>' : '')
      + (h.archived ? '<span class="ha-badge">Archived</span>' : !h.enabled ? '<span class="ha-badge">Disabled</span>' : '')
      + (h.rewarding ? '<span class="ha-badge">Rewarding</span>' : '')
      + (h.fairness && h.fairness.warn ? '<span class="ha-badge ha-badge-warn" title="Fairness warning — see the editor">⚠ fairness</span>' : '');
    return '<div class="qa-row" style="' + (h.archived ? 'opacity:.5' : '') + '">'
      + '<span class="qa-row-icon" style="font-size:18px">' + _haEsc(h.icon) + '</span>'
      + '<span class="qa-row-title" style="flex:1;min-width:0">' + _haEsc(h.title)
      +   '<span class="ha-rule">' + _haEsc(_haDescribe(h.rule)) + '</span></span>'
      + badges
      + '<div class="qa-row-btns">'
      +   '<button class="qa-btn" data-id="' + _haEsc(h.id) + '" onclick="ha_showForm(this.dataset.id)" title="Edit">✏</button>'
      +   '<button class="qa-btn qa-btn-archive" data-id="' + _haEsc(h.id) + '" onclick="ha_archive(this.dataset.id)" title="' + (h.archived ? 'Restore' : 'Archive') + '">' + (h.archived ? '♻' : '🗑') + '</button>'
      + '</div></div>';
  }).join('');
}

// ── Form ──────────────────────────────────────────────────────────────────
function ha_showForm(id) {
  const h = id ? _haList.find(x => x.id === id) : null;
  const isNew = !h;
  const cur = h || { id: '', title: '', icon: '🏮', flavour: '', rule: { type: 'daily', start: '18:00', durationMin: 120 },
                     effects: [{ type: 'banner' }], rewarding: false, enabled: true, sort_order: 0 };
  const wrap = document.getElementById('ha-form-wrap');
  if (!wrap) return;
  wrap.style.display = 'block';
  wrap.innerHTML = '<div class="qa-form" oninput="ha_preview()" onchange="ha_preview()">'
    + '<div class="qa-form-header">' + (isNew ? '＋ New Happening' : 'Edit: ' + _haEsc(cur.title))
    +   '<button class="qa-btn" onclick="ha_cancelForm()" title="Cancel">✕</button></div>'
    + '<div class="ce-grid" style="grid-template-columns:1fr 1fr">'
    +   '<div class="ce-field"><label>Id <span class="qa-tip" title="Permanent unique key: lowercase letters, digits and underscores. Cannot be changed later.">?</span></label>'
    +     '<input type="text" id="ha-id" class="ce-input" value="' + _haEsc(cur.id) + '"' + (isNew ? '' : ' disabled style="opacity:.5"') + '></div>'
    +   '<div class="ce-field"><label>Title</label><input type="text" id="ha-title" class="ce-input" maxlength="80" value="' + _haEsc(cur.title) + '"></div>'
    +   '<div class="ce-field"><label>Icon (emoji)</label><input type="text" id="ha-icon" class="ce-input" maxlength="4" value="' + _haEsc(cur.icon) + '"></div>'
    +   '<div class="ce-field"><label>Sort order</label><input type="number" id="ha-sort" class="ce-input" min="0" max="9999" value="' + (cur.sort_order || 0) + '"></div>'
    + '</div>'
    + '<div class="ce-field" style="margin-top:8px"><label>Flavour <span class="qa-tip" title="One line shown in the HUD list and the start toast.">?</span></label>'
    +   '<input type="text" id="ha-flavour" class="ce-input" maxlength="280" value="' + _haEsc(cur.flavour) + '"></div>'
    + '<div style="display:flex;gap:16px;margin-top:8px">'
    +   '<label class="ha-check"><input type="checkbox" id="ha-rewarding"' + (cur.rewarding ? ' checked' : '') + '> Rewarding '
    +     '<span class="qa-tip" title="Rewarding Happenings get the fairness check: they should move around the clock (3+ start hours a week) or last 8h+, so every time zone can catch them.">?</span></label>'
    +   '<label class="ha-check"><input type="checkbox" id="ha-enabled"' + (cur.enabled !== false ? ' checked' : '') + '> Enabled</label>'
    + '</div>'

    + '<div class="qa-section-label" style="margin-top:14px">When (UTC) <span class="qa-tip" title="All times are UTC. The preview below shows the coverage and the next windows in your local time.">?</span></div>'
    + '<div class="ce-field"><label>Rule type</label><select id="ha-type" class="ce-input" onchange="ha_renderRuleFields()">'
    +   HA_TYPES.map(([v, l]) => '<option value="' + v + '"' + (cur.rule.type === v ? ' selected' : '') + '>' + l + '</option>').join('')
    + '</select></div>'
    + '<div id="ha-rule-fields" style="margin-top:8px"></div>'

    + '<div class="qa-section-label" style="margin-top:14px">Effects <span class="qa-tip" title="JSON array. banner = HUD list + start toast. enemy_pool = these enemies can appear in random encounters during the window. map_flourish lanterns = extra warm lights around settlements at night. No economy multipliers in v1.">?</span></div>'
    + '<textarea id="ha-effects" class="ce-input" rows="3" style="width:100%;font-family:monospace;font-size:11px">' + _haEsc(JSON.stringify(cur.effects || [])) + '</textarea>'
    + '<div class="ha-hint">' + _haEsc(HA_EFFECTS_HELP) + '</div>'
    + '<div id="ha-effects-msg" class="ha-msg"></div>'

    + '<div class="qa-section-label" style="margin-top:14px">Coverage — this week, UTC hours</div>'
    + '<div id="ha-preview"></div>'

    + '<div class="cheat-rel-feedback" id="ha-form-feedback" style="margin-top:8px"></div>'
    + '<button class="cheat-all-btn" style="margin-top:12px" onclick="ha_save(' + (isNew ? 'null' : "'" + String(cur.id).replace(/'/g, "\\'") + "'") + ')">💾 ' + (isNew ? 'Create Happening' : 'Save Changes') + '</button>'
    + '</div>';
  window._haEditing = cur;
  ha_renderRuleFields(cur.rule);
}

// Rule builder fields for the selected type, pre-filled from rule (or defaults).
function ha_renderRuleFields(rule) {
  const type = document.getElementById('ha-type').value;
  let r = (rule && rule.type === type) ? rule : (window._haEditing && window._haEditing.rule.type === type ? window._haEditing.rule : {});
  // Switching between daily / weekly / rotating keeps the start + duration typed so far.
  const prevStart = document.getElementById('ha-start'), prevDur = document.getElementById('ha-dur');
  if (!r.start && prevStart) r = Object.assign({}, r, { start: prevStart.value, durationMin: Number(prevDur && prevDur.value) || 120 });
  const el = document.getElementById('ha-rule-fields');
  const time = (id, label, v) => '<div class="ce-field"><label>' + label + '</label><input type="time" id="' + id + '" class="ce-input" value="' + _haEsc(v || '18:00') + '"></div>';
  const num = (id, label, v, min, max) => '<div class="ce-field"><label>' + label + '</label><input type="number" id="' + id + '" class="ce-input" min="' + min + '" max="' + max + '" value="' + v + '"></div>';
  const checks = (cls, items, sel) => '<div style="display:flex;gap:10px;flex-wrap:wrap">' + items.map(([v, l]) =>
    '<label class="ha-check"><input type="checkbox" class="' + cls + '" value="' + v + '"' + ((sel || []).indexOf(v) >= 0 ? ' checked' : '') + '> ' + l + '</label>').join('') + '</div>';
  const moons = (sel) => '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-bottom:8px">' + KWDayCycle.MOON_IDS.map((id, i) =>
    '<label title="' + _haEsc(KWDayCycle.MOON_NAMES[i]) + '" style="display:flex;flex-direction:column;align-items:center;font-size:16px;cursor:pointer">' + KWDayCycle.MOON_GLYPHS[i]
    + '<input type="checkbox" class="ha-moon" value="' + id + '"' + ((sel || []).indexOf(id) >= 0 ? ' checked' : '') + '></label>').join('') + '</div>';
  const toLocalInput = (iso, dflt) => (iso ? new Date(iso).toISOString().slice(0, 16) : dflt);
  let html = '';
  if (type === 'once') {
    const d0 = new Date(Date.now() + 86400000).toISOString().slice(0, 11);
    html = '<div class="ce-grid" style="grid-template-columns:1fr 1fr">'
      + '<div class="ce-field"><label>Start (UTC)</label><input type="datetime-local" id="ha-once-start" class="ce-input" value="' + toLocalInput(r.start, d0 + '18:00') + '"></div>'
      + '<div class="ce-field"><label>End (UTC)</label><input type="datetime-local" id="ha-once-end" class="ce-input" value="' + toLocalInput(r.end, d0 + '22:00') + '"></div></div>';
  } else if (type === 'daily' || type === 'weekly' || type === 'rotating') {
    html = '<div class="ce-grid" style="grid-template-columns:1fr 1fr' + (type === 'rotating' ? ' 1fr' : '') + '">'
      + time('ha-start', 'Start (UTC)', r.start)
      + num('ha-dur', 'Duration (minutes, 15–1440)', r.durationMin || 120, 15, 1440)
      + (type === 'rotating' ? num('ha-shift', 'Shift per day (hours)', r.shiftHours || 8, 1, 23) : '')
      + '</div>'
      + (type === 'weekly' ? '<div style="margin-top:6px">' + checks('ha-day', HA_DAYS.map((d, i) => [String(i), d]), (r.days || [1, 4]).map(String)) + '</div>' : '');
  } else if (type === 'phase') {
    html = checks('ha-phase', HA_PHASES, r.phases || ['night']);
  } else if (type === 'moon') {
    html = moons(r.moons || ['full']) + checks('ha-phase', HA_PHASES, r.phases || ['dusk', 'night']);
  }
  el.innerHTML = html;
  ha_preview();
}

function _haVals(cls) { return Array.prototype.map.call(document.querySelectorAll('#ha-form-wrap .' + cls + ':checked'), x => x.value); }

// The rule currently described by the form (unvalidated).
function _haFormRule() {
  const type = document.getElementById('ha-type').value;
  const v = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  if (type === 'once') return { type, start: v('ha-once-start') ? v('ha-once-start') + ':00Z' : '', end: v('ha-once-end') ? v('ha-once-end') + ':00Z' : '' };
  if (type === 'phase') return { type, phases: _haVals('ha-phase') };
  if (type === 'moon') return { type, moons: _haVals('ha-moon'), phases: _haVals('ha-phase') };
  const r = { type, start: v('ha-start'), durationMin: Number(v('ha-dur')) };
  if (type === 'weekly') r.days = _haVals('ha-day').map(Number);
  if (type === 'rotating') r.shiftHours = Number(v('ha-shift'));
  return r;
}

function _haParseEffects() {
  const raw = (document.getElementById('ha-effects') || {}).value || '[]';
  let fx;
  try { fx = JSON.parse(raw); } catch (e) { return { ok: false, error: 'Not valid JSON: ' + e.message }; }
  if (!Array.isArray(fx)) return { ok: false, error: 'Effects must be a JSON array.' };
  for (const e of fx) {
    if (!e || ['banner', 'enemy_pool', 'map_flourish'].indexOf(e.type) < 0) return { ok: false, error: 'Unknown effect type "' + (e && e.type) + '".' };
    if (e.type === 'enemy_pool' && !(Array.isArray(e.add) && e.add.length)) return { ok: false, error: 'enemy_pool needs "add": ["enemy_id", …].' };
    if (e.type === 'map_flourish' && ['lanterns', 'fireflies', 'aurora'].indexOf(e.kind) < 0) return { ok: false, error: 'map_flourish kind must be lanterns, fireflies or aurora.' };
  }
  return { ok: true, effects: fx };
}

// Live heatmap + fairness + next 5 windows, from the shared day cycle.
function ha_preview() {
  const box = document.getElementById('ha-preview');
  if (!box) return;
  const fx = _haParseEffects();
  const msg = document.getElementById('ha-effects-msg');
  if (msg) { msg.textContent = fx.ok ? '' : '⚠ ' + fx.error; msg.className = 'ha-msg' + (fx.ok ? '' : ' ha-msg-warn'); }
  const v = KWDayCycle.validateRule(_haFormRule());
  if (!v.ok) { box.innerHTML = '<div class="ha-msg ha-msg-warn">⚠ ' + _haEsc(v.error) + '</div>'; return; }
  const now = _haNow();
  const f = KWDayCycle.fairnessOf(v.rule, now);
  const day0 = now - (((now % 86400000) + 86400000) % 86400000);
  const rewarding = document.getElementById('ha-rewarding') && document.getElementById('ha-rewarding').checked;
  let grid = '<div class="ha-heat"><div></div>';
  for (let h = 0; h < 24; h++) grid += '<div class="ha-heat-h">' + (h % 3 === 0 ? h : '') + '</div>';
  f.coverage.forEach((row, d) => {
    grid += '<div class="ha-heat-d">' + HA_DAYS[new Date(day0 + d * 86400000).getUTCDay()] + '</div>';
    row.forEach((on, h) => { grid += '<div class="ha-heat-c' + (on ? ' on' : '') + '" title="' + HA_DAYS[new Date(day0 + d * 86400000).getUTCDay()] + ' ' + (h < 10 ? '0' : '') + h + ':00 UTC"></div>'; });
  });
  grid += '</div>';
  const longH = (f.longestMs / 3600000).toFixed(f.longestMs % 3600000 ? 1 : 0);
  let fair;
  if (!rewarding) fair = '<div class="ha-msg">Not rewarding — no fairness check. ' + f.startHours + ' start hour(s), longest ' + longH + 'h.</div>';
  else if (f.exempt) fair = '<div class="ha-msg ha-msg-ok">✓ Phase / moon rules are exempt from the start-hour test (longest ' + longH + 'h).</div>';
  else if (f.warn) fair = '<div class="ha-msg ha-msg-warn">⚠ Fairness: only ' + f.startHours + ' distinct UTC start hour(s) this week and the longest window is ' + longH
    + 'h. Rewarding Happenings should start at 3+ different hours or last 8h+, so every time zone can catch them. (A warning — you can still save.)</div>';
  else fair = '<div class="ha-msg ha-msg-ok">✓ Fair: ' + f.startHours + ' start hour(s), longest ' + longH + 'h.</div>';
  const next = KWDayCycle.windowsBetween(v.rule, now, now + 30 * 86400000).filter(w => w.endMs > now).slice(0, 5);
  const nextHtml = '<div class="qa-section-label" style="margin-top:10px">Next windows (your time)</div>'
    + (next.length ? next.map(w => '<div class="ha-next">' + (w.startMs <= now ? '<b>On now</b> → ' + _haEsc(_haLocal(w.endMs))
        : _haEsc(_haLocal(w.startMs)) + ' → ' + _haEsc(_haLocal(w.endMs))) + '</div>').join('') : '<div class="ha-msg">None in the next 30 days.</div>');
  box.innerHTML = grid + fair + nextHtml;
}

function ha_cancelForm() {
  const wrap = document.getElementById('ha-form-wrap');
  if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
}

function _haFeedback(msg, ok) {
  const el = document.getElementById('ha-form-feedback');
  if (el) { el.textContent = msg; el.style.color = ok ? '#9fc97a' : '#e8a06a'; }
}

async function ha_save(existingId) {
  const isNew = !existingId;
  const fx = _haParseEffects();
  if (!fx.ok) { _haFeedback('⚠️ Effects: ' + fx.error, false); return; }
  const v = KWDayCycle.validateRule(_haFormRule());
  if (!v.ok) { _haFeedback('⚠️ Rule: ' + v.error, false); return; }
  const body = {
    id: (document.getElementById('ha-id').value || '').trim().toLowerCase(),
    title: document.getElementById('ha-title').value.trim(),
    icon: document.getElementById('ha-icon').value.trim() || '🏮',
    flavour: document.getElementById('ha-flavour').value.trim(),
    sort_order: parseInt(document.getElementById('ha-sort').value) || 0,
    rewarding: document.getElementById('ha-rewarding').checked,
    enabled: document.getElementById('ha-enabled').checked,
    rule: v.rule, effects: fx.effects,
  };
  if (!body.title) { _haFeedback('⚠️ Title is required.', false); return; }
  try {
    const r = await apiFetch('/api/happenings/admin' + (isNew ? '' : '/' + encodeURIComponent(existingId)), {
      method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { _haFeedback('⚠️ ' + (d.error || 'Save failed.'), false); return; }
    ha_cancelForm();
    await loadHappeningsAdmin();
    if (window.KWHappenings) KWHappenings.load();
    if (typeof showToastNotification === 'function')
      showToastNotification('🏮 Saved "' + body.title + '"' + (d.fairness && d.fairness.warn ? ' — with a fairness warning' : ''), 'default');
  } catch (e) { _haFeedback('⚠️ ' + e.message, false); }
}

async function ha_archive(id) {
  const h = _haList.find(x => x.id === id);
  if (!h) return;
  if (!h.archived && !confirm('Archive "' + h.title + '"? It stops running and leaves the schedule. You can restore it later.')) return;
  try {
    const r = await apiFetch('/api/happenings/admin/' + encodeURIComponent(id) + '/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: !h.archived }),
    });
    if (r.ok) { await loadHappeningsAdmin(); if (window.KWHappenings) KWHappenings.load(); }
  } catch (e) {}
}
