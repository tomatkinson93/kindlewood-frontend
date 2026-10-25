// ══════════════════════════════════════════════════════════════════════════
//  CRAFTING — the workshop panel for the Smithy, Jeweller and Workshop.
//
//  Server: /api/crafting (kindlewood-server lib/crafting). Quality odds and
//  craft times are computed here from the same js/career-math.js the server
//  rolls with, from each crafter's `bench` (level, stat, perks, tools,
//  station level) — so the odds shown are the odds rolled.
//
//  Open: window.openCrafting('smithy' | 'jeweller' | 'workshop', citizenId?)
//  Realtime (js/realtime.js → KWCrafting.onEvent): craft_done, craft_queue_updated,
//  recipe_discovered, recipe_learned, schematic_found.
//  Hidden recipes must be learned by the town (a discovery while crafting,
//  or a schematic studied from the inventory: KWCrafting.study(invId)).
//  "List at my stall when done" (per station, remembered): each finished
//  piece goes on a stall at its market price + the chosen markup.
//  Dev Tools: the 🛠 Recipes tab (loadRecipeAdmin).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const M = () => global.KWCareerMath;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };
  const byId = id => document.getElementById(id);
  const RES_ICON = { food: '🍞', timber: '🪵', stone: '🪨', metal: '⛓️', wealth: '🪙' };
  const QCOL = { basic: '#b8b0a0', sturdy: '#8fbf7a', fine: '#6aa8e0', superior: '#b77ff0', legendary: '#f4a83a' };
  const STATIONS = { smithy: '⚒️', jeweller: '💍', workshop: '🪚', smelter: '🔥' };

  async function call(method, path, body) {
    const res = await global.apiFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ── Pure bits (also used by verify/crafting_proofs.js) ─────────────────

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + 's';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + 'h' + (m ? ' ' + m + 'm' : '');
    return m + 'm' + (s && m < 10 ? ' ' + s + 's' : '');
  }
  function oddsFor(bench, recipe) {
    const score = M().qualityScore({ ...bench, minLevel: recipe.min_level });
    return M().qualityOdds(score, recipe.quality_cap, bench.level);
  }
  function secondsFor(bench, recipe) { return M().craftSeconds(recipe.base_seconds, bench.speed, bench.statMult); }
  // What one craft needs vs what's in the stores: [{ key, icon, label, need, have, short }].
  function needs(recipe, st, qty) {
    qty = qty || 1;
    const out = [];
    const inp = recipe.inputs || {};
    const R = global.KWResources, known = R ? R.knownSet(st.discovered || []) : null;
    for (const [k, v] of Object.entries(inp.resources || {})) {
      const need = Number(v) * qty, have = Math.floor(Number((st.resources || {})[k]) || 0);
      // Something the town hasn't discovered reads "?? ×1".
      if (R && !R.isKnown(k, known)) { out.push({ key: k, icon: '', label: 'Not yet discovered', need, have, short: true, unknown: true }); continue; }
      out.push({ key: k, icon: RES_ICON[k] || (R ? R.icon(k) : '•'), label: R ? R.label(k) : k, need, have, short: have < need });
    }
    for (const it of inp.items || []) {
      const t = (st.templates || {})[it.item_key] || {};
      const need = (Number(it.qty) || 1) * qty, have = Number((st.have || {})[it.item_key]) || 0;
      out.push({ key: it.item_key, icon: t.icon || '📦', label: t.name || it.item_key, need, have, short: have < need });
    }
    return out;
  }
  function oddsBar(odds) {
    const parts = M().QUALITIES.filter(q => odds[q] > 0.0005);
    return `<div class="cf-odds" role="img" aria-label="${esc(parts.map(q => `${M().QUALITY_LABEL[q]} ${pct(odds[q])}`).join(', '))}">${
      parts.map(q => `<span style="flex:${odds[q]};background:${QCOL[q]}" title="${esc(M().QUALITY_LABEL[q])} ${pct(odds[q])}"></span>`).join('')}</div>
      <div class="cf-odds-key">${parts.map(q => `<span><i style="background:${QCOL[q]}"></i>${esc(M().QUALITY_LABEL[q])} ${pct(odds[q])}</span>`).join('')}</div>`;
  }
  const pct = v => (v >= 0.995 ? '100%' : v < 0.01 ? '<1%' : Math.round(v * 100) + '%');
  function bonusText(t) {
    if (!t) return '';
    const b = Object.entries(t.stat_bonuses || {}).filter(([, v]) => Number(v)).map(([k, v]) => `+${v} ${k}`);
    const fx = Array.isArray(t.item_effects) ? t.item_effects.map(e => M().describeEffect(e)).filter(Boolean) : [];
    return [...b, ...fx].join(', ');
  }
  // The crafter's mark / quality line for an item (inventory, Market).
  function markHtml(meta) {
    const m = meta || {};
    if (!m.crafted_by && !m.quality) return '';
    const q = m.quality && m.quality !== 'basic' && M() ? `<span class="cf-q" style="color:${QCOL[m.quality] || '#ccc'}">${esc(M().QUALITY_LABEL[m.quality] || m.quality)}</span>` : '';
    const by = m.crafted_by ? `<span class="cf-mark">made by ${esc(m.crafted_by.name)}${m.crafted_by.settlement_name ? ' of ' + esc(m.crafted_by.settlement_name) : ''}</span>` : '';
    const extra = (m.named ? ' <span class="cf-tag">✨ named</span>' : '') + (m.guardian ? ' <span class="cf-tag" title="Saves its wearer from death once, then breaks">🛡 Guardian</span>' : '');
    return `<div class="cf-markline">${q}${q && by ? ' · ' : ''}${by}${extra}</div>`;
  }
  const qualityColour = q => QCOL[q] || null;

  // ── Straight to a stall: off | 0 | 0.1 | 0.25 | 0.5 (per station) ────────
  const LIST_OPTS = [['off', 'Keep in the stores'], ['0', 'List at market price'], ['0.1', 'List at +10%'], ['0.25', 'List at +25%'], ['0.5', 'List at +50%']];
  function listChoice(station) {
    try { const v = global.localStorage.getItem('kw_cf_list_' + station); return LIST_OPTS.some(o => o[0] === v) ? v : 'off'; } catch (_) { return 'off'; }
  }
  function setListChoice(station, v) { try { global.localStorage.setItem('kw_cf_list_' + station, v); } catch (_) {} }
  const markupLabel = m => (Number(m) ? `+${Math.round(Number(m) * 100)}%` : 'market price');

  // ── Panel ────────────────────────────────────────────────────────────────

  let _studyAt = 0;
  let _st = null, _station = null, _sel = null, _timer = null, _reloadAt = 0, _busy = false;

  function modal() {
    let o = byId('cf-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'cf-overlay';
    o.className = 'cf-overlay';
    o.innerHTML = `<div class="cf-panel" role="dialog" aria-modal="true" aria-labelledby="cf-title">
        <header class="cf-head"><div><h2 id="cf-title"></h2><div class="cf-sub" id="cf-sub"></div></div>
          <button type="button" class="cr-x" data-cf="close" aria-label="Close">✕</button></header>
        <div class="cf-body" id="cf-body"></div>
      </div>`;
    document.body.appendChild(o);
    o.addEventListener('click', onClick);
    o.addEventListener('input', e => { if (e.target.matches('[data-cf-qty]')) renderRecipes(); });
    o.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('cf-help')) _helpOpen = e.target.open; }, true);
    o.addEventListener('change', e => { if (e.target.id === 'cf-list' && _station) setListChoice(_station, e.target.value); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && o.classList.contains('open')) close(); });
    return o;
  }
  function close() {
    const o = byId('cf-overlay');
    if (o) o.classList.remove('open');
    clearInterval(_timer); _timer = null; _station = null;
  }

  async function open(station, citizenId) {
    if (!STATIONS[station]) return;
    const o = modal();
    _station = station;
    _helpOpen = firstVisitHelp();
    o.classList.add('open');
    byId('cf-title').textContent = `${STATIONS[station]} Workshop`;
    byId('cf-sub').textContent = 'Loading…';
    byId('cf-body').innerHTML = '<div class="cr-muted cf-pad">Lighting the lamps…</div>';
    try { if (global.KWCareers) await global.KWCareers.loadDefs(); } catch (_) {}
    await load();
    if (citizenId && _st && _st.crafters.some(c => c.id === Number(citizenId))) { _sel = Number(citizenId); render(); }
    clearInterval(_timer);
    _timer = setInterval(tick, 1000);
  }

  async function load() {
    if (!_station) return;
    try {
      _st = await call('GET', `/api/crafting/station/${_station}`);
    } catch (e) {
      byId('cf-body').innerHTML = `<div class="cr-err">${esc(e.message)}</div>`;
      return;
    }
    if (!_st.crafters.some(c => c.id === _sel)) _sel = _st.crafters.length ? _st.crafters[0].id : null;
    render();
  }

  function specLabel(spec) {
    const d = global.KWCareers && global.KWCareers.defs();
    const cls = d && d.classes[_st.class_key];
    const f = cls && cls.fork && cls.fork.find(x => x.key === spec);
    return f ? `${f.icon} ${f.label}` : '';
  }

  function render() {
    const st = _st;
    byId('cf-title').textContent = `${STATIONS[st.station]} ${st.label}`;
    const used = st.crafters.length;
    byId('cf-sub').innerHTML = st.level
      ? `Level ${st.level} · <b>${used}</b> / ${st.slots} ${esc(st.class_label)}${st.slots === 1 ? '' : 's'} at work`
      : `Build a ${esc(st.label)} first.`;
    const body = byId('cf-body');
    if (!st.level) { body.innerHTML = `<div class="cf-empty">No ${esc(st.label)} yet — build one from the settlement view.</div>`; return; }
    if (!st.crafters.length) {
      body.innerHTML = `<div class="cf-empty"><div class="cf-empty-icon">${st.class_icon}</div>
        <p>Nobody works here yet.</p>
        <p class="cr-muted">Give a citizen the <b>${esc(st.class_label)}</b> job (Citizens → profile → Job). The ${esc(st.label)} has room for ${st.slots}.</p></div>`;
      return;
    }
    body.innerHTML = helpHtml(st) + `
      <div class="cf-crafters" id="cf-crafters" role="tablist" aria-label="Crafters"></div>
      <div class="cf-main">
        <section class="cf-queue" id="cf-queue" aria-label="Queue"></section>
        <section class="cf-recipes" id="cf-recipes" aria-label="Recipes"></section>
      </div>`;
    renderCrafters();
    renderQueue();
    renderRecipes();
  }

  // "How this works": open by itself the first time a player visits.
  // _helpOpen is decided when the panel opens and then follows the player's
  // own folding, so re-renders (refreshes, picking a crafter) keep it as is.
  let _helpOpen = false;
  function firstVisitHelp() {
    try { const first = !global.localStorage.getItem('kw_cf_help_seen'); if (first) global.localStorage.setItem('kw_cf_help_seen', '1'); return first; }
    catch (_) { return false; }
  }
  function helpHtml(st) {
    if (st.station === 'smelter') return `<details class="cf-help"${_helpOpen ? ' open' : ''}><summary>ⓘ How the Smelter works</summary><ul>
      <li><b>Places:</b> one Smelter per building level (${st.slots} now). Upgrade the Smelter for more furnaces.</li>
      <li><b>Alloys:</b> copper and tin make bronze; iron and coal make steel (once your Library has studied Steelworking). They go straight into your ⛏ Stores.</li>
      <li><b>Queue:</b> up to ${st.max_queue} batches each. Ore is taken when you queue and comes back exactly if you cancel.</li>
      <li><b>Perks:</b> faster work, and a chance the ore goes further. At level 10 a Smelter becomes a Bronzesmith or a Steelmaker, with bigger batches.</li>
    </ul></details>`;
    return `<details class="cf-help"${_helpOpen ? ' open' : ''}><summary>ⓘ How the ${esc(st.label)} works</summary><ul>
      <li><b>Places:</b> one ${esc(st.class_label)} per building level (${st.slots} now). Upgrade the ${esc(st.label)} for more.</li>
      <li><b>Queue:</b> up to ${st.max_queue} pieces each. Materials are taken when you queue and come back exactly if you cancel. Work carries on while you're away.</li>
      <li><b>Quality:</b> the coloured bar shows the real chances. Higher level, a better ${esc((global.KWCareers && global.KWCareers.defs() && (global.KWCareers.defs().classes[st.class_key] || {}).primary) || 'main')} stat, perks, a good tool and a bigger workshop all help. Legendary needs level 15.</li>
      <li><b>🏪 When done:</b> finished equipment can go straight onto one of your stalls at its recent market price (plus your markup). If no stall can take it, it waits in your stores.</li>
      <li><b>📜 Recipes to learn:</b> some recipes must be learned by the town first. A crafter may work one out while working, or study a schematic (villages, quests and expeditions turn them up) from your inventory.</li>
    </ul></details>`;
  }

  function renderCrafters() {
    byId('cf-crafters').innerHTML = _st.crafters.map(c => `
      <button type="button" role="tab" aria-selected="${c.id === _sel}" class="cf-crafter${c.id === _sel ? ' on' : ''}" data-cf="sel" data-id="${c.id}">
        <span class="cf-c-name">${esc(c.name)}</span>
        <span class="cf-c-sub">Lv ${c.level}${c.spec ? ' · ' + esc(specLabel(c.spec)) : ''}</span>
        <span class="cf-c-q" title="Jobs queued">${'●'.repeat(c.queued)}${'○'.repeat(Math.max(0, _st.max_queue - c.queued))}</span>
        ${c.named_ready ? '<span class="cf-c-named" title="May name a blade this week">✨</span>' : ''}
      </button>`).join('');
  }

  function renderQueue() {
    const el = byId('cf-queue');
    if (!el) return;
    const mine = _st.jobs.filter(j => j.citizen_id === _sel);
    const live = mine.filter(j => j.status === 'active' || j.status === 'queued');
    const done = mine.filter(j => j.status === 'done' || j.status === 'ruined').slice(0, 4);
    const c = _st.crafters.find(x => x.id === _sel);
    el.innerHTML = `<div class="cf-h">At the bench <span class="cr-muted">${live.length} / ${_st.max_queue}</span></div>
      ${live.length ? live.map(j => jobRow(j)).join('') : `<div class="cr-muted cf-pad">${esc(c ? c.name : '')} is free — pick something to make.</div>`}
      ${done.length ? `<div class="cf-h cf-h-sm">Recently made</div>${done.map(j => doneRow(j)).join('')}` : ''}`;
  }
  function jobRow(j) {
    const active = j.status === 'active';
    const t0 = Date.parse(j.started_at), t1 = Date.parse(j.completes_at);
    const p = active && t1 > t0 ? Math.min(1, Math.max(0, (Date.now() - t0) / (t1 - t0))) : 0;
    const tpl = recipeOf(j.recipe_key);
    return `<div class="cf-job${active ? ' active' : ''}" data-job="${j.id}">
      <span class="cf-job-icon">${tpl && tpl.output ? tpl.output.icon : '🔨'}</span>
      <div class="cf-job-main"><div>${esc(j.options && j.options.named ? `“${j.options.named}”` : j.name)}${active ? '' : ' <span class="cr-muted">— waiting</span>'}${j.options && j.options.list ? ` <span class="cf-tag" title="Goes on a stall when it's done">🏪 ${esc(markupLabel(j.options.list.markup))}</span>` : ''}</div>
        ${active ? `<div class="cf-bar"><div class="cf-bar-fill" style="width:${Math.round(p * 100)}%"></div></div>
          <div class="cf-left cr-muted" data-left="${t1}">${fmtTime((t1 - Date.now()) / 1000)} left</div>` : ''}</div>
      <button type="button" class="cr-btn cf-cancel" data-cf="cancel" data-id="${j.id}" title="Cancel — materials come back">✕</button>
    </div>`;
  }
  function doneRow(j) {
    if (j.status === 'ruined') return `<div class="cf-job done"><span class="cf-job-icon">💥</span><div class="cf-job-main">${esc(j.name)} <span class="cr-muted">— ruined</span></div></div>`;
    const r = j.result || {};
    return `<div class="cf-job done"><span class="cf-job-icon">${esc(r.icon || '📦')}</span>
      <div class="cf-job-main"><span style="color:${QCOL[j.quality] || 'inherit'}">${esc(r.name || j.name)}</span>
      ${j.xp ? `<span class="cr-muted"> · +${Math.round(j.xp)} XP</span>` : ''}
      ${j.listed ? `<div class="cf-sub2">🏪 On a stall at ${esc(j.listed.price)} gold</div>` : ''}
      ${j.list_failed ? `<div class="cf-sub2 cf-warn">Kept in the stores — ${esc(j.list_failed)}</div>` : ''}
      ${j.discovered ? `<div class="cf-sub2">💡 Worked out how to make ${esc(j.discovered)}!</div>` : ''}</div></div>`;
  }
  const recipeOf = key => _st.recipes.find(r => r.recipe_key === key);

  function renderRecipes() {
    const el = byId('cf-recipes');
    if (!el) return;
    const c = _st.crafters.find(x => x.id === _sel);
    if (!c) { el.innerHTML = ''; return; }
    const qty = Math.max(1, Math.min(_st.max_queue, Number((byId('cf-qty') || {}).value) || 1));
    const room = _st.max_queue - c.queued;
    const open = _st.recipes.filter(r => !c.can[r.recipe_key]);
    // Still to learn: only what the town hasn't learned is in the way (not
    // another path's recipes, or ones needing a higher level).
    const onlyUnknown = r => r.hidden && !r.known && /^Not known yet/.test(c.can[r.recipe_key] || '');
    const toLearn = _st.recipes.filter(r => c.can[r.recipe_key] && onlyUnknown(r));
    const shut = _st.recipes.filter(r => c.can[r.recipe_key] && !onlyUnknown(r));
    const lc = listChoice(_st.station);
    el.innerHTML = `<div class="cf-h">Make <span class="cf-make-ctl">
        ${_station === 'smelter' ? '' : `<label class="cf-list-l" title="Finished equipment goes straight onto one of your stalls">🏪 <select id="cf-list" aria-label="When a piece is done">
          ${LIST_OPTS.map(([v, l]) => `<option value="${v}" ${v === lc ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
        <label class="cf-qty-l">× <input id="cf-qty" data-cf-qty type="number" min="1" max="${_st.max_queue}" value="${qty}" aria-label="How many"></label></span></div>
      <div class="cf-list">${open.map(r => recipeCard(r, c, qty, room)).join('')}</div>
      ${toLearn.length ? `<details class="cf-locked cf-learn" open><summary>📜 Still to learn (${toLearn.length}) — study a schematic, or a crafter may work one out</summary>
        <div class="cf-list">${toLearn.map(r => recipeCard(r, c, qty, room)).join('')}</div></details>` : ''}
      ${shut.length ? `<details class="cf-locked"><summary>Not yet (${shut.length})</summary><div class="cf-list">${shut.map(r => recipeCard(r, c, qty, room)).join('')}</div></details>` : ''}`;
  }
  function recipeCard(r, c, qty, room) {
    const why = c.can[r.recipe_key];
    const t = r.output || {};
    const n = needs(r, _st, qty);
    const short = n.some(x => x.short);
    const weapon = t.equip_slot === 'weapon';
    const canName = !why && c.named_ready && weapon;
    const odds = t.equip_slot ? oddsFor(c.bench, r) : null;
    const dis = why || short || room < qty;
    const title = why || (short ? 'Not enough materials' : room < qty ? `${c.name} can queue ${room} more` : '');
    return `<div class="cf-recipe${why ? ' locked' : ''}" data-recipe="${esc(r.recipe_key)}">
      <div class="cf-r-head"><span class="cf-r-icon">${esc(t.icon || '📦')}</span>
        <div class="cf-r-title"><div class="cf-r-name">${esc(r.name)}${r.output_qty > 1 ? ` ×${r.output_qty}` : ''}</div>
          <div class="cf-r-sub">${esc(t.resource ? 'Into your stores' : bonusText(t) || (t.equip_slot ? '' : 'Material'))}${r.spec ? ` · <span class="cf-tag">${esc(specLabel(r.spec))}</span>` : ''}${r.hidden && r.known ? ' · <span class="cf-tag" title="Your town learned this one">📜 learned</span>' : ''}</div></div>
        <div class="cf-r-time" title="Time per piece">⏱ ${fmtTime(secondsFor(c.bench, r))}</div></div>
      <div class="cf-needs">${n.map(x => x.unknown
        ? `<span class="cf-need res-unknown" title="Not yet discovered">?? ×${x.need}</span>`
        : `<span class="cf-need${x.short ? ' short' : ''}" title="${esc(x.label)}: have ${x.have}">${x.icon} ${x.need}<small>/${x.have}</small></span>`).join('') || '<span class="cr-muted">Free</span>'}</div>
      ${odds && !why ? oddsBar(odds) : ''}
      ${why ? `<div class="cf-why">🔒 ${esc(why)}</div>` : `<div class="cf-r-act">
        ${canName ? `<input class="cf-name" data-name-for="${esc(r.recipe_key)}" maxlength="40" placeholder="✨ Name it (once a week)" aria-label="Name this blade">` : ''}
        <button type="button" class="cr-btn cr-btn-primary" data-cf="craft" data-key="${esc(r.recipe_key)}" ${dis ? 'disabled' : ''} title="${esc(title)}">Craft${qty > 1 ? ' ' + qty : ''}</button></div>`}
    </div>`;
  }

  // Progress bars between reloads; reload when a job is due.
  function tick() {
    const o = byId('cf-overlay');
    if (!o || !o.classList.contains('open')) { clearInterval(_timer); _timer = null; return; }
    let due = false;
    o.querySelectorAll('[data-left]').forEach(el => {
      const t1 = Number(el.dataset.left), left = (t1 - Date.now()) / 1000;
      el.textContent = left > 0 ? fmtTime(left) + ' left' : 'finishing…';
      const job = el.closest('.cf-job'), bar = job && job.querySelector('.cf-bar-fill');
      const j = _st && _st.jobs.find(x => String(x.id) === job.dataset.job);
      if (bar && j) { const t0 = Date.parse(j.started_at); bar.style.width = Math.round(Math.min(1, (Date.now() - t0) / (t1 - t0)) * 100) + '%'; }
      if (left <= 0) due = true;
    });
    if (due && Date.now() > _reloadAt) { _reloadAt = Date.now() + 5000; setTimeout(load, 1200); }
  }

  async function onClick(e) {
    const t = e.target.closest('[data-cf]');
    if (e.target.id === 'cf-overlay') return close();
    if (!t) return;
    const act = t.dataset.cf;
    if (act === 'close') return close();
    if (act === 'sel') { _sel = Number(t.dataset.id); renderCrafters(); renderQueue(); renderRecipes(); return; }
    if (_busy) return;
    _busy = true;
    try {
      if (act === 'craft') {
        const key = t.dataset.key;
        const nameEl = document.querySelector(`[data-name-for="${CSS.escape(key)}"]`);
        const name = nameEl && nameEl.value.trim() ? nameEl.value.trim() : null;
        const qty = name ? 1 : Math.max(1, Number((byId('cf-qty') || {}).value) || 1);
        t.disabled = true;
        const rec = recipeOf(key), lc = listChoice(_st.station);
        const list = lc !== 'off' && rec && rec.output && rec.output.equip_slot ? { markup: Number(lc) } : null;
        const r = await call('POST', '/api/crafting/jobs', { citizen_id: _sel, recipe_key: key, qty, name, list });
        toast(`🔨 ${r.name} is making ${qty > 1 ? qty + '× ' : ''}${name ? `“${name}”` : r.recipe}.`);
        await load();
        refreshResources();
      } else if (act === 'cancel') {
        await call('DELETE', `/api/crafting/jobs/${t.dataset.id}`);
        toast('Cancelled — the materials are back in the stores.', 'info');
        await load();
        refreshResources();
      }
    } catch (err) { toast(err.message, 'error'); await load(); }
    finally { _busy = false; }
  }
  function refreshResources() {
    try { if (typeof global.loadGame === 'function') global.loadGame(); } catch (_) {}
    try { if (typeof global.loadInventory === 'function') global.loadInventory(); } catch (_) {}
  }

  function onEvent(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'craft_done') {
      if (ev.ruined) toast(`💥 ${ev.name}'s ${ev.recipe} was ruined — butterfingers!`, 'error');
      else if (ev.resource) {
        // The Smelter: alloy straight into the stores.
        toast(`${ev.item.icon} ${ev.name} smelted ${ev.item.name}${ev.first ? ' — their first!' : ''}${ev.saved ? ' ♻️ Some ore was saved.' : ''}`);
        const gs = global.gameData && global.gameData.settlement;
        if (gs) {
          gs.resources = gs.resources || {};
          gs.resources[ev.resource] = (Number(gs.resources[ev.resource]) || 0) + (Number(ev.qty) || 0);
          if (ev.new_resource && (gs.discovered || []).indexOf(ev.resource) < 0) (gs.discovered = gs.discovered || []).push(ev.resource);
        }
        if (ev.new_resource && global.KWStores) global.KWStores.showDiscoveries([{ key: ev.resource }]);
        else if (global.KWStores) global.KWStores.render();
      } else if (ev.item) {
        const q = ev.item.quality;
        const big = q === 'superior' || q === 'legendary';
        toast(`${ev.item.icon || '🔨'} ${ev.name} made ${/^[AEIOU]/i.test(ev.item.name) ? 'an' : 'a'} ${ev.item.name}${ev.first ? ' — their first!' : ''}${ev.guardian ? ' 🛡 A Guardian piece!' : ''}${big ? ' ✨' : ''}`
          + (ev.listed ? ` 🏪 On a stall at ${ev.listed.price} gold.` : ev.list_failed ? ` (Kept in the stores: ${ev.list_failed})` : ''));
      }
      try { if (typeof global.loadInventory === 'function') global.loadInventory(); } catch (_) {}
    }
    if (ev.type === 'recipe_discovered') toast(`💡 ${ev.name} worked out how to make ${/^[AEIOU]/i.test(ev.recipe) ? 'an' : 'a'} ${ev.recipe}! Every crafter in town can make it now.`);
    // (A schematic studied here already said so.)
    if (ev.type === 'recipe_learned' && Date.now() - _studyAt > 8000) toast(`📜 Your crafters can now make ${ev.recipe}.`);
    if (ev.type === 'schematic_found') {
      toast(`${ev.item && ev.item.icon || '📜'} ${ev.source === 'expedition' ? 'Your scout brought back' : 'Among the spoils:'} ${ev.item ? ev.item.name : 'a schematic'} — study it from your inventory.`);
      try { if (typeof global.loadInventory === 'function') global.loadInventory(); } catch (_) {}
    }
    if ((ev.type === 'craft_done' || ev.type === 'craft_queue_updated' || ev.type === 'recipe_discovered' || ev.type === 'recipe_learned') && _station && (!ev.station || ev.station === _station)) {
      if (Date.now() > _reloadAt - 4000) { _reloadAt = Date.now() + 1000; load(); }
    }
  }

  // Study a schematic (inventory id): the town learns its recipe.
  async function study(invId) {
    try {
      _studyAt = Date.now();   // its realtime echo arrives before this returns
      const r = await call('POST', `/api/crafting/schematics/${invId}/study`);
      toast(`📜 Studied — your ${r.class_label ? r.class_label.toLowerCase() + 's' : 'crafters'} can now make ${r.recipe}.`);
      try { if (typeof global.loadInventory === 'function') await global.loadInventory(); } catch (_) {}
      if (_station) load();
      return r;
    } catch (e) { toast(e.message, 'error'); return null; }
  }

  // ── Dev Tools: recipes ──────────────────────────────────────────────────

  let _ra = [];
  const RA_FIELDS = ['name', 'class_key', 'spec', 'station', 'min_level', 'min_station_level', 'output_key', 'output_qty', 'base_seconds', 'base_xp', 'unlock_node', 'quality_cap', 'sort_order', 'discovery', 'research'];
  async function loadRecipeAdmin() {
    const el = byId('ra-list');
    if (!el) return;
    el.innerHTML = '<div class="ra-muted">Loading…</div>';
    try { _ra = (await call('GET', '/api/crafting/admin/recipes')).recipes; }
    catch (e) { el.innerHTML = `<div class="ra-err">⚠️ ${esc(e.message)}</div>`; return; }
    const groups = {};
    _ra.forEach(r => (groups[r.class_key] = groups[r.class_key] || []).push(r));
    // Same building blocks as the Items tab (qa-row / qa-btn in main.css).
    el.innerHTML = Object.entries(groups).map(([k, rs]) => `<div class="qa-section-label">${esc(k)} (${rs.length})</div>${rs.map(r => `
      <div class="qa-row${r.archived ? ' qa-archived' : ''}">
        <span class="qa-row-icon">${r.discovery === 'hidden' ? '📜' : '🔨'}</span>
        <span class="qa-row-title" title="${esc(r.recipe_key)}">${esc(r.name)}</span>
        <span class="ra-meta">Lv${r.min_level}${r.spec ? ' · ' + esc(r.spec) : ''} · ${fmtTime(r.base_seconds)} · ${r.base_xp}xp${r.archived ? ' · archived' : ''}</span>
        <div class="qa-row-btns"><button type="button" class="qa-btn ra-edit" title="Edit" onclick="KWCrafting.editRecipe('${esc(r.recipe_key)}')">✏</button></div>
      </div>`).join('')}`).join('');
  }
  const RA_CHOICES = {
    class_key: ['blacksmith', 'jeweller', 'carpenter', 'smelter'], station: ['smithy', 'jeweller', 'workshop', 'smelter'],
    research: [''].concat(global.KWResearch ? global.KWResearch.KEYS : []),
    quality_cap: ['basic', 'sturdy', 'fine', 'superior', 'legendary'], discovery: ['known', 'hidden'],
  };
  const RA_NUM = ['min_level', 'min_station_level', 'output_qty', 'base_seconds', 'base_xp', 'sort_order'];
  function editRecipe(key) {
    const r = key ? _ra.find(x => x.recipe_key === key) : { class_key: 'blacksmith', station: 'smithy', min_level: 1, min_station_level: 1, output_qty: 1, base_seconds: 1200, base_xp: 20, quality_cap: 'legendary', sort_order: 0, discovery: 'known', inputs: { resources: {}, items: [] } };
    const wrap = byId('ra-form-wrap');
    if (!wrap || !r) return;
    wrap.style.display = 'block';
    const val = k => esc(r[k] == null ? '' : r[k]);
    const field = k => `<div class="ce-field"><label>${esc(k.replace(/_/g, ' '))}</label>${RA_CHOICES[k]
      ? `<select class="ce-input" data-ra="${k}">${RA_CHOICES[k].map(o => `<option value="${o}" ${String(r[k]) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input class="ce-input" data-ra="${k}" type="${RA_NUM.includes(k) ? 'number' : 'text'}" value="${val(k)}">`}</div>`;
    wrap.innerHTML = `<div class="qa-form">
      <div class="qa-form-header">${key ? 'Edit: ' + esc(r.name) : '＋ New Recipe'}
        <button type="button" onclick="document.getElementById('ra-form-wrap').style.display='none'" style="margin-left:auto;background:none;border:none;color:rgba(192,221,151,.5);cursor:pointer;font-size:14px" aria-label="Close">✕</button></div>
      <div class="ce-grid">
        ${key ? `<div class="ce-field"><label>recipe key</label><input class="ce-input" value="${esc(key)}" readonly></div>` : `<div class="ce-field"><label>recipe key</label><input class="ce-input" data-ra="recipe_key" placeholder="iron_dagger"></div>`}
        ${RA_FIELDS.map(field).join('')}
      </div>
      <div class="ce-field" style="margin-top:6px"><label>inputs (JSON) — {"resources":{"metal":8,"steel":2},"items":[{"item_key":"iron_ore","qty":1}]}</label>
        <textarea class="ce-input" data-ra="inputs" rows="3">${esc(JSON.stringify(r.inputs || {}))}</textarea></div>
      <div class="ra-btns">
        <button type="button" class="qa-btn ra-btn" onclick="KWCrafting.saveRecipe(${key ? `'${esc(key)}'` : 'null'})">💾 Save</button>
        ${key && !r.archived ? `<button type="button" class="qa-btn ra-btn" onclick="KWCrafting.archiveRecipe('${esc(key)}')">🗄 Archive</button>` : ''}
        ${key && r.archived ? `<button type="button" class="qa-btn ra-btn" onclick="KWCrafting.unarchiveRecipe('${esc(key)}')">♻ Restore</button>` : ''}
        ${key && r.discovery === 'hidden' ? `<button type="button" class="qa-btn ra-btn" onclick="KWCrafting.teachRecipe('${esc(key)}')">📜 Teach my town</button>` : ''}
      </div></div>`;
  }
  async function saveRecipe(key) {
    const body = {};
    document.querySelectorAll('#ra-form-wrap [data-ra]').forEach(el => { body[el.dataset.ra] = el.value; });
    try {
      body.inputs = JSON.parse(body.inputs || '{}');
      if (key) await call('PATCH', `/api/crafting/admin/recipes/${encodeURIComponent(key)}`, body);
      else await call('POST', '/api/crafting/admin/recipes', body);
      raFeedback('Saved.');
      byId('ra-form-wrap').style.display = 'none';
      loadRecipeAdmin();
    } catch (e) { raFeedback('⚠️ ' + e.message, true); }
  }
  async function archiveRecipe(key) {
    try { await call('DELETE', `/api/crafting/admin/recipes/${encodeURIComponent(key)}`); raFeedback('Archived.'); byId('ra-form-wrap').style.display = 'none'; loadRecipeAdmin(); }
    catch (e) { raFeedback('⚠️ ' + e.message, true); }
  }
  async function unarchiveRecipe(key) {
    try { await call('PATCH', `/api/crafting/admin/recipes/${encodeURIComponent(key)}`, { archived: false }); raFeedback('Restored.'); byId('ra-form-wrap').style.display = 'none'; loadRecipeAdmin(); }
    catch (e) { raFeedback('⚠️ ' + e.message, true); }
  }
  async function teachRecipe(key) {
    try { const r = await call('POST', `/api/crafting/admin/recipes/${encodeURIComponent(key)}/teach`); raFeedback(r.learned ? 'Your town knows it now.' : 'Your town already knew it.'); }
    catch (e) { raFeedback('⚠️ ' + e.message, true); }
  }
  function raFeedback(msg, bad) {
    const el = byId('ra-feedback');
    if (el) { el.textContent = msg; el.style.color = bad ? '#e07a6a' : ''; }
  }

  global.KWCrafting = {
    open, close, load, onEvent, markHtml, qualityColour, fmtTime, oddsFor, secondsFor, needs,
    loadRecipeAdmin, editRecipe, saveRecipe, archiveRecipe, unarchiveRecipe, teachRecipe, study, listChoice, STATIONS,
    _state: () => _st,
  };
  global.openCrafting = open;
  global.loadRecipeAdmin = loadRecipeAdmin;
})(typeof window !== 'undefined' ? window : this);
