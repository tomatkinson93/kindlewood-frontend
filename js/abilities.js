// ══════════════════════════════════════════════════════════════════════════
//  KWAbilities — the Abilities tab on a citizen (docs/TACTICS.md §6).
//
//  What a citizen knows in their class, by the level that taught it, what
//  is still to come, and which five they bring to a battle on the board.
//  A Guard, Archer, Wizard or Hearthkeeper who knows more than five chooses
//  here; the choice is kept until changed. Anyone else has a villager's
//  three and nothing to choose.
//
//  The server decides what is known and keeps the choice
//  (lib/tactics_abilities.js there: GET /api/tactics/abilities/:id,
//  POST …/ready). This file shows the answer and sends the five. The
//  pictures and the words for what an ability does are the battle screen's
//  own (KWTactics.icon, effectText, reachText).
//
//  The tab shows only where battles on the board are open: to admins, and to
//  everyone once dungeons are switched on for players.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  // page: what the server last said; pick: the keys ticked now (null until the player changes something).
  const S = { id: null, page: null, pick: null, busy: false, wired: null };

  const isAdmin = () => typeof global._kwIsAdmin === 'function' && !!global._kwIsAdmin();
  const available = () => isAdmin() || !!(global.KWDungeon && global.KWDungeon._state && global.KWDungeon._state.on);

  // ── Words (pure) ────────────────────────────────────────────────────────
  const T = () => global.KWTactics || {};
  const icon = a => (T().icon ? T().icon(a) : esc(a.icon || '•'));
  const effect = a => (T().effectText ? T().effectText(a) : '');
  const reach = a => (T().reachText ? T().reachText(a) : '');
  // "every 3rd turn", "twice a battle", "quick".
  function pace(a) {
    const bits = [];
    if (a.quick) bits.push('quick: does not end the turn');
    if (a.uses != null) bits.push(a.uses === 1 ? 'once a battle' : a.uses === 2 ? 'twice a battle' : `${a.uses} times a battle`);
    else if (a.cooldown > 0) bits.push(a.cooldown === 1 ? 'every other turn' : `every ${a.cooldown + 1}${a.cooldown + 1 === 3 ? 'rd' : 'th'} turn`);
    return bits.join(' · ');
  }
  const chosen = p => (S.pick && S.id === p.citizen.id ? S.pick : p.abilities.filter(a => a.ready).map(a => a.key));
  const sameSet = (a, b) => a.length === b.length && a.every(k => b.includes(k));

  // ── Markup (pure) ───────────────────────────────────────────────────────
  function rowHtml(p, a, pick) {
    const on = pick.includes(a.key), can = p.can_choose && !p.busy && a.known;
    const state = !a.known ? `<span class="kwab-when">🔒 Level ${esc(a.at)}</span>`
      : can ? `<label class="kwab-tick"><input type="checkbox" data-kwab="toggle" data-key="${esc(a.key)}"${on ? ' checked' : ''}${!on && pick.length >= p.max ? ' disabled' : ''}> <span>${on ? 'Brought' : 'At home'}</span></label>`
        : `<span class="kwab-when is-on">${on ? '✓ Brought' : 'At home'}</span>`;
    const words = [effect(a), reach(a), pace(a)].filter(Boolean).join(' · ');
    return `<li class="kwab-row${a.known ? '' : ' is-locked'}${a.known && on ? ' is-ready' : ''}" aria-label="${esc(a.name)}: ${esc(a.known ? (on ? 'known and brought to battle' : 'known, left at home') : 'learned at level ' + a.at)}">`
      + `<span class="kwab-ico" aria-hidden="true">${icon(a)}</span>`
      + `<span class="kwab-what"><b>${esc(a.name)}</b><span class="kwab-does">${esc(words)}</span>${a.desc ? `<span class="kwab-desc">${esc(a.desc)}</span>` : ''}</span>`
      + state + `</li>`;
  }
  function pageHtml(p, pickNow) {
    if (!p) return '<div class="cp-rel-loading">Reading what they know…</div>';
    const pick = pickNow || p.abilities.filter(a => a.ready).map(a => a.key);
    const known = p.abilities.filter(a => a.known), next = p.abilities.find(a => !a.known);
    const need = Math.min(p.max, known.length), was = p.abilities.filter(a => a.ready).map(a => a.key);
    const pct = p.xp && p.xp.need ? Math.max(0, Math.min(100, Math.round(p.xp.into / p.xp.need * 100))) : 100;
    const head = p.career
      ? `<div class="kwab-head"><span class="kwab-big" aria-hidden="true">${esc(p.icon || '')}</span><div><div class="kwab-title">${esc(p.label)} · level ${esc(p.level)}</div>`
        + `<div class="kwab-xp" role="img" aria-label="${p.xp && p.xp.need ? `${esc(p.xp.into)} of ${esc(p.xp.need)} experience towards level ${p.level + 1}` : 'the highest level'}"><span style="width:${pct}%"></span></div>`
        + `<div class="kwab-sub">${next ? `Next: <b>${esc(next.name)}</b> at level ${esc(next.at)}.` : 'Every ability of the class is known.'} Levels come from battles won, and from working at the job.</div></div></div>`
      : `<div class="kwab-head"><span class="kwab-big" aria-hidden="true">${esc(p.icon || '🧺')}</span><div><div class="kwab-title">Villager</div>`
        + `<div class="kwab-sub">${esc(p.citizen.name)} has no fighting class, so they fight with a villager's three: a swing, a duck, and what their trade taught them. As a Guard, Archer, Wizard or Hearthkeeper they would learn ten.</div></div></div>`;
    const choose = !p.career ? ''
      : p.busy ? `<p class="kwab-note">${esc(p.citizen.name)} is in a dungeon. Abilities are readied at home.</p>`
        : p.can_choose ? `<p class="kwab-note"><b>${esc(p.citizen.name)} knows ${known.length} and brings ${need} to a battle.</b> Tick the ${need} to bring.</p>`
          : `<p class="kwab-note">${esc(p.citizen.name)} brings everything they know. Once they know more than ${esc(p.max)}, the ${esc(p.max)} to bring are chosen here.</p>`;
    const bar = p.can_choose && !p.busy
      ? `<div class="kwab-bar"><span class="kwab-count${pick.length === need ? ' is-full' : ''}" role="status">${pick.length} of ${need} chosen</span>`
        + `<button type="button" class="kw-btn primary" data-kwab="save"${pick.length !== need || sameSet(pick, was) ? ' disabled' : ''}>Save</button></div>`
      : '';
    return `<div class="kwab">${head}${choose}<ul class="kwab-list">${p.abilities.map(a => rowHtml(p, a, pick)).join('')}</ul>${bar}</div>`;
  }

  // ── The tab on a citizen's page (js/citizens.js) ────────────────────────
  // The button and its panel, or nothing where battles on the board are not open (or for a child).
  const tabHtml = c => (available() && c && c.life_stage !== 'child'
    ? `<button class="cp-tab" data-cp="abilities" onclick="cpSwitchTab(this,'cp-tab-abilities'); KWAbilities.renderTab(${Number(c.id)})">⚔ Abilities</button>` : '');
  const panelHtml = c => (available() && c && c.life_stage !== 'child'
    ? `<div class="cp-tab-panel" id="cp-tab-abilities" style="display:none"><div id="cp-abilities-content">${pageHtml(null)}</div></div>` : '');

  function paint() {
    const el = doc.getElementById('cp-abilities-content');
    if (!el) return;
    el.innerHTML = pageHtml(S.page, S.page ? chosen(S.page) : null);
    if (S.wired !== el) {
      S.wired = el;
      el.addEventListener('change', ev => { const t = ev.target.closest('[data-kwab="toggle"]'); if (t) toggle(t.getAttribute('data-key'), t.checked); });
      el.addEventListener('click', ev => { const t = ev.target.closest('[data-kwab="save"]'); if (t && !t.disabled) save(); });
    }
  }
  function toggle(key, on) {
    if (!S.page) return;
    const pick = chosen(S.page).filter(k => k !== key);
    if (on && pick.length < S.page.max) pick.push(key);
    S.pick = pick;
    paint();
    // Redrawing moved the keyboard's place: put it back on the box that was ticked.
    const again = doc.querySelector(`#cp-abilities-content [data-kwab="toggle"][data-key="${key}"]`);
    if (again) again.focus();
  }
  async function call(path, body) {
    const res = await global.apiFetch('/api/tactics/abilities/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.error || 'That did not work. Try again.');
    return d;
  }
  async function renderTab(id) {
    if (S.id !== id) { S.id = id; S.page = null; S.pick = null; }
    paint();
    try {
      if (T().loadAssets) await T().loadAssets();      // the pictures, before the list is drawn
      S.page = await call(String(id));
    } catch (e) { const el = doc.getElementById('cp-abilities-content'); if (el) el.innerHTML = `<p class="kwab-note">⚠️ ${esc(e.message)}</p>`; return; }
    if (S.id === id) paint();
  }
  async function save() {
    if (S.busy || !S.page || !S.pick) return;
    S.busy = true;
    try { S.page = await call(S.id + '/ready', { keys: S.pick }); S.pick = null; toast('⚔ Saved: these go into the next battle.'); }
    catch (e) { toast('⚠️ ' + e.message); }
    finally { S.busy = false; paint(); }
  }

  global.KWAbilities = { available, tabHtml, panelHtml, renderTab, _pageHtml: pageHtml, _rowHtml: rowHtml, _pace: pace, _state: S, _toggle: toggle, _save: save };
})(typeof window !== 'undefined' ? window : globalThis);
