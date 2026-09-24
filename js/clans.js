// ══════════════════════════════════════════════════════════════════════════
//  CLANS — Clan panel (spec 016, Phase 1)
//
//  Opened from the Clan comm-btn (#nav-clan) and the Guild Hall row in the
//  buildings panel. One call to GET /api/clans/me feeds every view:
//    · clanless → pending invites + founding (needs a Guild Hall)
//    · in a clan → Overview / Roster tabs, actions gated by the viewer's
//      permission list from the server (the server re-checks everything)
//
//  #clan-panel is registered in mobile-shell.js watchOverlays(), so on
//  phones the tab bar hides while it is open. It must use display:none
//  when closed for that check to work.
//
//  Depends on: apiFetch (main.js), escHtml (profile.js), ClanPalette
//  (clan-palette.js), showBuildToast (buildings.js, optional).
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const P = () => global.ClanPalette;
  const esc = s => (typeof global.escHtml === 'function' ? global.escHtml(s) : String(s ?? ''));
  const RANK_ORDER = { founder: 5, leader: 4, officer: 3, member: 2, recruit: 1 };
  const RANKS = ['founder', 'leader', 'officer', 'member', 'recruit'];
  const RANK_ICON = { founder: '👑', leader: '⚜️', officer: '🎖️', member: '🛡️', recruit: '🌱' };

  const state = {
    data: null,        // last /api/clans/me response
    tab: 'overview',   // overview | roster | activity
    activity: null,    // loaded feed rows (newest first), null = not loaded
    activityMore: false,
    view: 'main',      // main | found | edit
    draft: null,       // banner/name draft for found/edit forms
    busy: false,
  };

  function toast(msg, type) {
    if (typeof global.showBuildToast === 'function') global.showBuildToast(msg, type || 'success');
  }

  async function call(method, path, body) {
    const res = await global.apiFetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ── DOM scaffold ────────────────────────────────────────────────────────

  function panel() {
    let el = document.getElementById('clan-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'clan-panel';
    el.className = 'clan-backdrop';
    el.innerHTML = `
      <div class="clan-card" role="dialog" aria-modal="true" aria-labelledby="clan-title">
        <div class="clan-head">
          <div class="clan-head-banner" id="clan-head-banner"></div>
          <div class="clan-head-text">
            <div class="clan-title" id="clan-title">Clan</div>
            <div class="clan-sub" id="clan-sub"></div>
          </div>
          <button class="clan-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="clan-tabs" id="clan-tabs"></div>
        <div class="clan-body" id="clan-body"></div>
        <div class="clan-sheet-wrap" id="clan-sheet-wrap"></div>
      </div>`;
    el.addEventListener('click', e => { if (e.target === el) closeClanPanel(); });
    el.querySelector('.clan-close').addEventListener('click', closeClanPanel);
    el.addEventListener('click', onAction);
    el.addEventListener('submit', onSubmit);
    document.body.appendChild(el);
    return el;
  }

  function isOpen() {
    const el = document.getElementById('clan-panel');
    return !!el && el.classList.contains('open');
  }

  async function openClanPanel() {
    const el = panel();
    el.classList.add('open');
    state.view = 'main';
    closeSheet();
    renderLoading();
    await refresh();
  }

  function closeClanPanel() {
    const el = document.getElementById('clan-panel');
    if (el) el.classList.remove('open');
    closeSheet();
  }

  async function refresh() {
    state.activity = null;   // refetched when the Activity tab renders
    try {
      state.data = await call('GET', '/api/clans/me');
      if (!state.data.clan && state.tab !== 'overview') state.tab = 'overview';
      updateBadge();
      if (isOpen()) render();
    } catch (e) {
      if (isOpen()) byId('clan-body').innerHTML = `<div class="clan-empty">${esc(e.message)}</div>`;
    }
  }

  const byId = id => document.getElementById(id);

  function renderLoading() {
    byId('clan-title').textContent = 'Clan';
    byId('clan-sub').textContent = '';
    byId('clan-head-banner').innerHTML = '';
    byId('clan-tabs').innerHTML = '';
    byId('clan-body').innerHTML = '<div class="clan-empty">Gathering the banners…</div>';
  }

  // ── Banner chip ─────────────────────────────────────────────────────────

  function bannerHtml(b, size) {
    const s = size || 44;
    return `<span class="clan-banner" style="--c1:${esc(b.primaryHex)};--c2:${esc(b.secondaryHex)};width:${s}px;height:${Math.round(s * 1.2)}px;font-size:${Math.round(s * 0.5)}px">
      <span class="clan-banner-glyph">${esc(b.glyph)}</span></span>`;
  }

  function draftBanner(d) {
    const p = P();
    const e = p.emblem(d.emblem), a = p.swatch(d.primary), c = p.swatch(d.secondary);
    return { glyph: e ? e.glyph : '🏳️', primaryHex: a ? a.hex : '#5b646c', secondaryHex: c ? c.hex : '#c9a14a' };
  }

  // ── Render ──────────────────────────────────────────────────────────────

  function render() {
    const d = state.data;
    if (!d) return renderLoading();
    if (state.view === 'found') return renderFoundForm();
    if (state.view === 'edit') return renderEditForm();
    if (!d.clan) return renderClanless();

    const c = d.clan;
    byId('clan-title').textContent = c.name;
    byId('clan-sub').textContent = `Level ${c.level} · ${c.member_count}/${c.member_cap} members · you are ${d.me.rank_label}`;
    byId('clan-head-banner').innerHTML = bannerHtml(c.banner, 40);
    const TAB_LABEL = { overview: 'Overview', roster: `Roster (${c.member_count})`, territory: 'Territory', activity: 'Activity' };
    byId('clan-tabs').innerHTML = ['overview', 'roster', 'territory', 'activity'].map(t =>
      `<button type="button" class="clan-tab${state.tab === t ? ' on' : ''}" data-act="tab" data-tab="${t}">${TAB_LABEL[t]}</button>`
    ).join('');
    byId('clan-body').innerHTML = state.tab === 'roster' ? rosterHtml()
      : state.tab === 'activity' ? activityHtml()
      : state.tab === 'territory' ? territoryHtml() : overviewHtml();
    if (state.tab === 'activity' && state.activity === null) loadActivity();
  }

  // ── Activity feed ───────────────────────────────────────────────────────

  const SOURCE_LABEL = { quest: 'a quest', battle: 'a battle', outpost: 'a new outpost', tier: 'a settlement upgrade' };

  function activityLine(a) {
    const p = a.payload || {}, who = `<b>${esc(a.actor || 'Someone')}</b>`, name = `<b>${esc(p.username || '')}</b>`;
    switch (a.type) {
      case 'clan_founded':           return ['🏛️', `${who} founded the clan.`];
      case 'member_joined':          return ['🌱', `${who} joined the clan.`];
      case 'member_left':            return ['🚪', `${who} left the clan.`];
      case 'member_kicked':          return ['✂️', `${who} removed ${name}.`];
      case 'rank_changed':           return ['🎖️', `${who} made ${name} ${esc(cap(p.rank || ''))}.`];
      case 'leadership_transferred': return ['👑', `${who} passed leadership to ${name}.`];
      case 'invite_sent':            return ['✉️', `${who} invited ${name}.`];
      case 'profile_updated':        return ['🖌️', `${who} updated the clan banner and description.`];
      case 'level_up':               return ['🎉', `The clan reached <b>level ${esc(p.level)}</b>!`];
      case 'prestige_adjusted':      return ['🛠️', `${who} ${p.amount > 0 ? 'added' : 'removed'} <b>${esc(Math.abs(p.amount))}</b> prestige <span class="clan-muted">(Dev Tools)</span>.`];
      case 'prestige_earned':        return ['✦', `${who} earned <b>${esc(p.amount)}</b> prestige from ${esc(SOURCE_LABEL[p.source] || p.source)}${
        p.amount < p.raw ? ` <span class="clan-muted">(daily cap: ${esc(p.raw)} earned)</span>` : ''}.`];
      default:                       return ['·', esc(a.type)];
    }
  }

  function activityHtml() {
    if (state.activity === null) return '<div class="clan-empty">Reading the ledger…</div>';
    if (!state.activity.length) return '<div class="clan-empty">Nothing has happened yet.</div>';
    return `<ul class="clan-feed">${state.activity.map(a => {
      const [ic, text] = activityLine(a);
      return `<li><span class="clan-feed-ic">${ic}</span><span class="clan-feed-text">${text}
        <span class="clan-feed-when">${esc(timeAgo(a.created_at))}</span></span></li>`;
    }).join('')}</ul>${state.activityMore ? '<button type="button" class="clan-btn ghost block" data-act="activity-more">Older entries</button>' : ''}`;
  }

  function timeAgo(ts) {
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  async function loadActivity(older) {
    try {
      const before = older && state.activity && state.activity.length ? state.activity[state.activity.length - 1].id : null;
      const d = await call('GET', '/api/clans/activity' + (before ? `?before=${before}` : ''));
      state.activity = before ? state.activity.concat(d.activity) : d.activity;
      state.activityMore = d.activity.length === 30;
    } catch (e) {
      if (!older) state.activity = [];
    }
    if (isOpen() && state.view === 'main' && state.tab === 'activity') render();
  }

  function can(flag) {
    return !!(state.data && state.data.me && state.data.me.permissions.includes(flag));
  }

  function overviewHtml() {
    const d = state.data, c = d.clan;
    const lifetime = c.prestige_lifetime;
    let progress = '<div class="clan-muted">Highest level reached.</div>';
    if (c.next_level_at) {
      const prev = (P().levelRow(c.level) || {}).lifetime || 0;
      const pct = Math.max(0, Math.min(100, Math.round(100 * (lifetime - prev) / (c.next_level_at - prev))));
      progress = `<div class="clan-bar"><span style="width:${pct}%"></span></div>
        <div class="clan-muted">${lifetime.toLocaleString()} / ${c.next_level_at.toLocaleString()} lifetime prestige to level ${c.level + 1}</div>`;
    }
    const unlocks = [
      { lv: P().FORUM_UNLOCK_LEVEL, label: 'Clan forum' },
      { lv: P().CHAT_UNLOCK_LEVEL, label: 'Clan live chat' },
    ].map(u => `<li class="${c.level >= u.lv ? 'ok' : ''}">${c.level >= u.lv ? '✓' : '🔒'} ${u.label} <span class="clan-muted">— level ${u.lv}</span></li>`).join('');

    let html = `
      <section class="clan-sec">
        <div class="clan-overview-top">
          ${bannerHtml(c.banner, 64)}
          <div>
            <div class="clan-level">Level ${c.level}</div>
            <div class="clan-muted">${Number(c.prestige).toLocaleString()} prestige to spend</div>
          </div>
        </div>
        ${progress}
        <p class="clan-desc">${c.description ? esc(c.description) : '<span class="clan-muted">No description yet.</span>'}</p>
        <ul class="clan-unlocks">${unlocks}</ul>
        ${can('edit_profile') ? '<button type="button" class="clan-btn ghost" data-act="edit">Edit banner & description</button>' : ''}
      </section>`;

    if (can('invite')) {
      const out = d.outgoing_invites || [];
      html += `
        <section class="clan-sec">
          <h3>Invite a player</h3>
          <form class="clan-inline-form" data-form="invite">
            <input name="username" type="text" placeholder="Player name" autocomplete="off" maxlength="40" required>
            <button type="submit" class="clan-btn">Invite</button>
          </form>
          ${out.length ? `<ul class="clan-list">${out.map(i => `
            <li><span>${esc(i.username)} <span class="clan-muted">invited by ${esc(i.invited_by)}</span></span>
              <button type="button" class="clan-btn small ghost" data-act="revoke" data-id="${i.id}">Revoke</button></li>`).join('')}</ul>` : ''}
        </section>`;
    }

    const founder = d.me.rank === 'founder';
    const alone = c.member_count === 1;
    html += `<section class="clan-sec clan-danger">`;
    if (!founder || alone) {
      html += `<button type="button" class="clan-btn danger" data-act="leave">${founder ? 'Leave (disbands the clan)' : 'Leave clan'}</button>`;
    } else {
      html += `<div class="clan-muted">As founder, transfer leadership from the roster before leaving.</div>`;
    }
    if (can('disband') && !alone) html += `<button type="button" class="clan-btn danger" data-act="disband">Disband clan</button>`;
    html += `</section>`;
    return html;
  }

  function rosterHtml() {
    const d = state.data;
    return `<ul class="clan-roster">${d.roster.map(m => `
      <li>
        <button type="button" class="clan-member" data-act="member" data-id="${m.user_id}">
          <span class="clan-rank-ic" title="${esc(m.rank_label)}">${RANK_ICON[m.rank] || ''}</span>
          <span class="clan-member-main">
            <span class="clan-member-name">${esc(m.username)}${m.user_id === d.me.user_id ? ' <span class="clan-muted">(you)</span>' : ''}</span>
            <span class="clan-muted">${esc(m.rank_label)} · ${esc(m.species || '')} · ${esc(m.settlement_name || '')}</span>
          </span>
          <span class="clan-member-pts" title="Prestige contributed">${Number(m.prestige_contributed).toLocaleString()}</span>
        </button>
      </li>`).join('')}</ul>`;
  }

  function renderClanless() {
    const d = state.data, f = d.founding;
    byId('clan-title').textContent = 'Clans';
    byId('clan-sub').textContent = 'Band together under one banner';
    byId('clan-head-banner').innerHTML = '';
    byId('clan-tabs').innerHTML = '';

    let html = '';
    if (d.invites.length) {
      html += `<section class="clan-sec"><h3>Invitations</h3><ul class="clan-invites">${d.invites.map(i => `
        <li>
          ${bannerHtml(i.banner, 36)}
          <span class="clan-inv-main">
            <span class="clan-member-name">${esc(i.clan_name)}</span>
            <span class="clan-muted">Level ${i.level} · ${i.member_count}/${i.member_cap} members · from ${esc(i.invited_by)}</span>
          </span>
          <span class="clan-inv-actions">
            <button type="button" class="clan-btn small" data-act="accept" data-id="${i.id}">Join</button>
            <button type="button" class="clan-btn small ghost" data-act="decline" data-id="${i.id}">Decline</button>
          </span>
        </li>`).join('')}</ul></section>`;
    }

    html += `<section class="clan-sec"><h3>Found a clan</h3>`;
    if (!f.placed) {
      html += `<p class="clan-muted">Place your settlement on the map first.</p>`;
    } else if (!f.has_guild_hall) {
      html += `<p class="clan-muted">Founding a clan needs a <b>Guild Hall</b> 🏛️, which a settlement can build once it reaches <b>Town</b> tier. Anyone can join a clan by invitation — no hall needed.</p>`;
    } else {
      html += `<p class="clan-muted">Your Guild Hall stands ready. Founding costs ${f.cost.wealth} wealth (you have ${f.wealth}).</p>
        <button type="button" class="clan-btn" data-act="found">Found a clan</button>`;
    }
    html += `</section>`;
    if (!d.invites.length) html = `<p class="clan-empty">You're not in a clan. Accept an invitation or found your own.</p>` + html;
    byId('clan-body').innerHTML = html;
  }

  // ── Banner picker (found + edit) ────────────────────────────────────────

  function pickerHtml(level) {
    const p = P(), d = state.draft;
    const grid = (key, items, isEmblem) => `
      <div class="clan-pick-grid" role="radiogroup">${items.map(x => {
        const locked = !p.isUnlocked(x, level);
        const on = d[key] === x.id;
        const inner = isEmblem ? esc(x.glyph) : '';
        const style = isEmblem ? '' : ` style="background:${x.hex}"`;
        return `<button type="button" class="clan-pick${on ? ' on' : ''}${locked ? ' locked' : ''}"${style}
          data-act="pick" data-key="${key}" data-id="${x.id}" role="radio" aria-checked="${on}"
          title="${esc(x.name)}${locked ? ` — clan level ${x.unlock.level || '?'}` : ''}">${inner}${locked ? '<span class="clan-lock">🔒</span>' : ''}</button>`;
      }).join('')}</div>`;
    return `
      <div class="clan-preview">${bannerHtml(draftBanner(d), 64)}</div>
      <label class="clan-label">Emblem</label>${grid('emblem', p.CLAN_EMBLEMS, true)}
      <label class="clan-label">Primary colour</label>${grid('primary', p.CLAN_SWATCHES)}
      <label class="clan-label">Secondary colour</label>${grid('secondary', p.CLAN_SWATCHES)}`;
  }

  function renderFoundForm() {
    byId('clan-title').textContent = 'Found a clan';
    byId('clan-sub').textContent = `Costs ${state.data.founding.cost.wealth} wealth`;
    byId('clan-head-banner').innerHTML = '';
    byId('clan-tabs').innerHTML = '';
    const d = state.draft;
    byId('clan-body').innerHTML = `
      <form class="clan-form" data-form="found">
        <label class="clan-label" for="clan-f-name">Name</label>
        <input id="clan-f-name" name="name" type="text" minlength="3" maxlength="24" required
          value="${esc(d.name || '')}" placeholder="The Rootbound">
        <div class="clan-muted">3–24 letters, numbers, spaces, ' or -. The name can't be changed later.</div>
        ${pickerHtml(1)}
        <label class="clan-label" for="clan-f-desc">Description</label>
        <textarea id="clan-f-desc" name="description" maxlength="500" rows="3">${esc(d.description || '')}</textarea>
        <div class="clan-form-actions">
          <button type="button" class="clan-btn ghost" data-act="back">Cancel</button>
          <button type="submit" class="clan-btn">Found clan</button>
        </div>
      </form>`;
  }

  function renderEditForm() {
    const c = state.data.clan;
    byId('clan-title').textContent = 'Edit clan';
    byId('clan-sub').textContent = c.name;
    byId('clan-tabs').innerHTML = '';
    byId('clan-body').innerHTML = `
      <form class="clan-form" data-form="edit">
        ${pickerHtml(c.level)}
        <label class="clan-label" for="clan-e-desc">Description</label>
        <textarea id="clan-e-desc" name="description" maxlength="500" rows="3">${esc(state.draft.description || '')}</textarea>
        <div class="clan-form-actions">
          <button type="button" class="clan-btn ghost" data-act="back">Cancel</button>
          <button type="submit" class="clan-btn">Save</button>
        </div>
      </form>`;
  }

  // Keeps typed text when the picker re-renders.
  function captureFormText() {
    const f = byId('clan-body').querySelector('form');
    if (!f) return;
    if (f.elements.name) state.draft.name = f.elements.name.value;
    if (f.elements.description) state.draft.description = f.elements.description.value;
  }

  // ── Action sheet + confirm (touch-friendly, no hover) ───────────────────

  function openSheet(html) {
    const w = byId('clan-sheet-wrap');
    w.innerHTML = `<div class="clan-sheet-scrim" data-act="sheet-close"></div><div class="clan-sheet">${html}</div>`;
    w.classList.add('open');
  }
  function closeSheet() {
    const w = byId('clan-sheet-wrap');
    if (w) { w.classList.remove('open'); w.innerHTML = ''; }
  }

  let _pendingConfirm = null;
  function confirmSheet(title, message, label, fn) {
    _pendingConfirm = fn;
    openSheet(`
      <div class="clan-sheet-title">${esc(title)}</div>
      <p class="clan-sheet-msg">${esc(message)}</p>
      <button type="button" class="clan-btn danger block" data-act="confirm-yes">${esc(label)}</button>
      <button type="button" class="clan-btn ghost block" data-act="sheet-close">Cancel</button>`);
  }

  function memberSheet(userId) {
    const d = state.data;
    const m = d.roster.find(x => x.user_id === userId);
    if (!m) return;
    const myRank = d.me.rank;
    const lower = RANK_ORDER[myRank] > RANK_ORDER[m.rank];
    const up = RANKS[RANKS.indexOf(m.rank) - 1];
    const acts = [
      `<button type="button" class="clan-btn block" data-act="profile" data-id="${m.user_id}">👤 View profile</button>`,
    ];
    if (m.user_id !== d.me.user_id) {
      if (can('manage_ranks') && lower && up && up !== 'founder' && RANK_ORDER[up] < RANK_ORDER[myRank]) {
        acts.push(`<button type="button" class="clan-btn ghost block" data-act="promote" data-id="${m.user_id}">Promote to ${cap(up)}</button>`);
      }
      if (can('manage_ranks') && lower && m.rank !== 'recruit') {
        acts.push(`<button type="button" class="clan-btn ghost block" data-act="demote" data-id="${m.user_id}">Demote to ${cap(RANKS[RANKS.indexOf(m.rank) + 1])}</button>`);
      }
      if (can('transfer_leadership')) {
        acts.push(`<button type="button" class="clan-btn ghost block" data-act="transfer" data-id="${m.user_id}">Make founder</button>`);
      }
      if (can('kick') && lower) {
        acts.push(`<button type="button" class="clan-btn danger block" data-act="kick" data-id="${m.user_id}">Remove from clan</button>`);
      }
    }
    acts.push(`<button type="button" class="clan-btn ghost block" data-act="sheet-close">Close</button>`);
    openSheet(`
      <div class="clan-sheet-title">${RANK_ICON[m.rank] || ''} ${esc(m.username)}</div>
      <p class="clan-sheet-msg">${esc(m.rank_label)} · joined ${new Date(m.joined_at).toLocaleDateString()} · ${Number(m.prestige_contributed).toLocaleString()} prestige contributed</p>
      ${acts.join('')}`);
  }

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ── Territory (spec §6) ─────────────────────────────────────────────────

  function territoryHtml() {
    const d = state.data, t = d.territory, c = d.clan;
    if (!t) return '<div class="clan-empty">Territory is not available yet.</div>';
    const full = t.count >= t.cap;
    const next = P().nextLevel(c.level);
    return `
      <section class="clan-sec">
        <div class="clan-overview-top">
          <div class="clan-terr-count">${t.count}<span>/${t.cap}</span></div>
          <div>
            <div class="clan-level">Tiles held</div>
            <div class="clan-muted">${full
              ? (next ? `At the level ${c.level} limit — level ${c.level + 1} allows ${next.territoryCap}.` : 'At the maximum.')
              : `Next claim costs <b>${t.next_cost}</b> prestige · clan has ${Number(c.prestige).toLocaleString()}.`}</div>
          </div>
        </div>
        <p class="clan-muted">${can('claim_territory')
          ? 'To claim, tap an explored tile that borders your land, open it with 🔍, and choose <b>Claim</b>.'
          : 'Officers and above can claim tiles that border your land.'}
          Claims can't be undone, so your land always stays connected.</p>
      </section>
      <section class="clan-sec">
        <h3>Holdings</h3>
        <ul class="clan-list">${t.tiles.map(x => `<li><span>(${x.q}, ${x.r})${
          t.hq && x.q === t.hq.q && x.r === t.hq.r ? ' <span class="clan-muted">· HQ</span>' : ''}</span>
          <button type="button" class="clan-btn small ghost" data-act="goto-tile" data-q="${x.q}" data-r="${x.r}">Show</button></li>`).join('')}</ul>
      </section>`;
  }

  const wrapN = (v, n) => ((v % n) + n) % n;
  function mapDims() {
    return [typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40, typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40];
  }
  function worldTile(q, r) {
    const w = typeof worldMapData !== 'undefined' ? worldMapData : null;
    return w && w.tiles ? w.tiles.find(t => t.q === q && t.r === r) : null;
  }

  // Whether the viewer can claim `tile` for their clan, mirroring the server
  // rules for the UI only (the server re-checks everything).
  // → null (don't show) | { ok, cost, reason, clanName }
  function claimInfo(tile) {
    const d = state.data;
    if (!tile || !d || !d.clan || !d.territory || !can('claim_territory')) return null;
    if (tile.terrain === 'fog' || tile.clan_territory) return null;
    const s = tile.settlement;
    if (s && (s.settlement_type && s.settlement_type !== 'player')) return null;
    if (s && !s.isOwn && !d.roster.some(m => m.username === s.username)) return null;
    const t = d.territory, [W, H] = mapDims();
    const CT = global.ClanTerritory;
    const dirs = CT ? CT.AXIAL_DIRS : [];
    const touches = (x, y) => dirs.some(([dq, dr]) => wrapN(x + dq, W) === tile.q && wrapN(y + dr, H) === tile.r);
    const adjacent = t.count
      ? t.tiles.some(x => touches(x.q, x.r))
      : !!(t.hq && (touches(t.hq.q, t.hq.r) || (t.hq.q === tile.q && t.hq.r === tile.r)));
    if (!adjacent) return null;
    const base = { cost: t.next_cost, clanName: d.clan.name };
    if (t.count >= t.cap) return { ...base, ok: false, reason: `Your clan is at its ${t.cap}-tile limit — level up to claim more.` };
    if (d.clan.prestige < t.next_cost) {
      return { ...base, ok: false, reason: `Needs ${t.next_cost} prestige; your clan has ${Number(d.clan.prestige).toLocaleString()}.` };
    }
    return { ...base, ok: true };
  }

  // "Territory of <clan>" line for tile info surfaces ('' when unclaimed).
  function territoryLineHtml(tile) {
    const ct = tile && tile.clan_territory;
    if (!ct) return '';
    const chip = `<span class="clan-chip" style="--c1:${esc(ct.primary)};--c2:${esc(ct.secondary)}">${esc(ct.glyph || '')}</span>`;
    const name = ct.mine
      ? `<a href="#" class="clan-link" onclick="event.preventDefault();openClanPanel()">${esc(ct.name)}</a> <span class="clan-muted">(your clan)</span>`
      : esc(ct.name);
    return `${chip} ${name}`;
  }

  // Claim button (or the reason it's unavailable) — '' when not relevant.
  function claimButtonHtml(tile) {
    const info = claimInfo(tile);
    if (!info) return '';
    return info.ok
      ? `<button type="button" class="clan-btn clan-claim-btn" onclick="ClanUI.claimFromTile(${tile.q},${tile.r}, this)">🏳️ Claim for ${esc(info.clanName)} — ${info.cost} prestige</button>`
      : `<div class="clan-claim-na">🏳️ ${esc(info.reason)}</div>`;
  }

  async function claimFromTile(q, r, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
    const ok = await claimTile(q, r);
    const tile = worldTile(q, r);
    // Re-render whichever tile surface is open with the new owner.
    const td = document.getElementById('tile-detail-modal');
    if (tile && td && td.style.display !== 'none' && typeof global.openTileDetail === 'function') global.openTileDetail(tile);
    if (tile && typeof global.selectWorldTile === 'function' && ok) global.selectWorldTile(tile);
    if (!ok && btn) { btn.disabled = false; btn.textContent = 'Try again'; }
  }

  async function claimTile(q, r) {
    try {
      const out = await call('POST', '/api/clans/territory/claim', { q, r });
      toast(`🏳️ Claimed (${q}, ${r}) for ${state.data.clan.name} — ${out.cost} prestige.`, 'success');
      await refresh();
      await refreshTerritoryOnMap();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  // Pulls fresh territory into the loaded map in place (loadWorldMap would
  // recentre the camera). The iso renderer rebuilds when its content
  // signature changes; the controller redraw covers top-down.
  let _terrTimer = null;
  function refreshTerritoryOnMap() {
    clearTimeout(_terrTimer);
    return new Promise(resolve => {
      _terrTimer = setTimeout(async () => {
        try {
          const w = typeof worldMapData !== 'undefined' ? worldMapData : null;
          if (!w || !w.tiles) return resolve();
          const res = await global.apiFetch('/api/map/world');
          if (!res.ok) return resolve();
          const fresh = await res.json();
          const byKey = new Map((fresh.tiles || []).map(t => [t.q + ',' + t.r, t]));
          for (const t of w.tiles) {
            const f = byKey.get(t.q + ',' + t.r);
            if (f) t.clan_territory = f.clan_territory || null;
          }
          const KW = global.KWMap;
          if (KW && KW.controller && KW.controller.invalidate) KW.controller.invalidate('tiles');
        } catch (_) { /* map refresh is best-effort */ }
        resolve();
      }, 150);
    });
  }

  // Opens the member's full player profile on top of the Clan panel (the
  // profile modals sit above it), so closing the profile returns here.
  // Roster data seeds the card until the profile endpoint answers.
  function openMemberProfile(userId) {
    const d = state.data;
    const m = d && d.roster.find(x => x.user_id === userId);
    if (!m) return;
    closeSheet();
    if (m.user_id === d.me.user_id) {
      if (typeof global.openProfile === 'function') global.openProfile();
    } else if (typeof global.viewPlayerProfile === 'function') {
      global.viewPlayerProfile(m.username, m.species || '', m.settlement_name || '',
        m.tier || 'camp', m.tile_q ?? '?', m.tile_r ?? '?');
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────

  async function run(fn, okMsg) {
    if (state.busy) return;
    state.busy = true;
    try {
      await fn();
      if (okMsg) toast(okMsg, 'success');
      closeSheet();
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      state.busy = false;
    }
  }

  function memberName(id) {
    const m = state.data && state.data.roster.find(x => x.user_id === id);
    return m ? m.username : 'this member';
  }

  function onAction(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, id = parseInt(t.dataset.id, 10);
    const c = state.data && state.data.clan;
    switch (act) {
      case 'tab': state.tab = t.dataset.tab; render(); break;
      case 'activity-more': loadActivity(true); break;
      case 'goto-tile': {
        const q = parseInt(t.dataset.q, 10), r = parseInt(t.dataset.r, 10);
        closeClanPanel();
        if (typeof global.navGoMap === 'function') global.navGoMap();
        const tile = worldTile(q, r);
        if (tile && typeof global.selectWorldTile === 'function') {
          if (typeof camera !== 'undefined') { camera.q = q; camera.r = r; }
          global.selectWorldTile(tile);
        }
        break;
      }
      case 'sheet-close': closeSheet(); break;
      case 'confirm-yes': { const fn = _pendingConfirm; _pendingConfirm = null; if (fn) fn(); break; }
      case 'member': memberSheet(id); break;
      case 'profile': openMemberProfile(id); break;
      case 'found':
        state.draft = { emblem: 'acorn', primary: 'moss', secondary: 'wheat', name: '', description: '' };
        state.view = 'found'; render(); break;
      case 'edit': {
        const b = c.banner;
        state.draft = { emblem: b.emblem, primary: b.primary, secondary: b.secondary, description: c.description };
        state.view = 'edit'; render(); break;
      }
      case 'back': state.view = 'main'; render(); break;
      case 'pick': {
        const level = state.view === 'edit' ? c.level : 1;
        const p = P();
        const entry = t.dataset.key === 'emblem' ? p.emblem(t.dataset.id) : p.swatch(t.dataset.id);
        if (!p.isUnlocked(entry, level)) {
          toast(`${entry.name} unlocks at clan level ${entry.unlock.level || '?'}.`, 'error');
          break;
        }
        captureFormText();
        state.draft[t.dataset.key] = t.dataset.id;
        render();
        break;
      }
      case 'accept': run(() => call('POST', `/api/clans/invites/${id}/accept`), 'Welcome to the clan!'); break;
      case 'decline': run(() => call('POST', `/api/clans/invites/${id}/decline`)); break;
      case 'revoke': run(() => call('DELETE', `/api/clans/invites/${id}`), 'Invite revoked.'); break;
      case 'promote': run(() => call('POST', `/api/clans/members/${id}/promote`), 'Promoted.'); break;
      case 'demote': run(() => call('POST', `/api/clans/members/${id}/demote`), 'Demoted.'); break;
      case 'kick':
        confirmSheet('Remove member',
          `Remove ${memberName(id)} from ${c.name}? They'll need a new invitation to return.`,
          `Remove ${memberName(id)}`,
          () => run(() => call('POST', `/api/clans/members/${id}/kick`), 'Member removed.'));
        break;
      case 'transfer':
        confirmSheet('Transfer leadership',
          `Make ${memberName(id)} the founder of ${c.name}? You will become a Leader and can't undo this yourself.`,
          `Make ${memberName(id)} founder`,
          () => run(() => call('POST', '/api/clans/transfer', { userId: id }), 'Leadership transferred.'));
        break;
      case 'leave': {
        const alone = c.member_count === 1;
        confirmSheet(alone ? 'Leave and disband' : 'Leave clan',
          alone ? `You are the last member. Leaving disbands ${c.name} permanently.` : `Leave ${c.name}? You'll need a new invitation to return.`,
          alone ? 'Leave and disband' : 'Leave clan',
          () => run(() => call('POST', '/api/clans/leave'), alone ? 'Clan disbanded.' : 'You left the clan.'));
        break;
      }
      case 'disband':
        confirmSheet('Disband clan',
          `Disband ${c.name}? All ${c.member_count} members are removed and its prestige and history are lost for good.`,
          `Disband ${c.name}`,
          () => run(() => call('POST', '/api/clans/disband'), 'Clan disbanded.'));
        break;
    }
  }

  function onSubmit(e) {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form;
    if (kind === 'invite') {
      const username = f.elements.username.value.trim();
      if (username) run(() => call('POST', '/api/clans/invites', { username }), `Invitation sent to ${username}.`);
    } else if (kind === 'found') {
      captureFormText();
      const d = state.draft;
      run(async () => {
        await call('POST', '/api/clans', {
          name: d.name, description: d.description,
          banner: { emblem: d.emblem, primary: d.primary, secondary: d.secondary },
        });
        state.view = 'main';
        if (typeof global.refreshResources === 'function') global.refreshResources();
      }, 'Your clan is founded!');
    } else if (kind === 'edit') {
      captureFormText();
      const d = state.draft;
      run(async () => {
        await call('PATCH', '/api/clans/profile', {
          description: d.description,
          banner: { emblem: d.emblem, primary: d.primary, secondary: d.secondary },
        });
        state.view = 'main';
        refreshTerritoryOnMap();   // new emblem / colours on the map
      }, 'Clan updated.');
    }
  }

  // ── Badge (pending invites) ─────────────────────────────────────────────

  function updateBadge() {
    const d = state.data;
    const on = !!(d && !d.clan && d.invites && d.invites.length);
    const btn = document.getElementById('nav-clan');
    if (btn) btn.classList.toggle('has-dot', on);
    if (global.KWShell && typeof global.KWShell.syncBadges === 'function') global.KWShell.syncBadges();
  }

  async function refreshClanBadge() {
    try {
      state.data = await call('GET', '/api/clans/me');
      updateBadge();
      if (isOpen() && state.view === 'main') render();
    } catch (_) { /* badge is decorative */ }
  }

  // ── Realtime hooks (called from realtime.js) ────────────────────────────

  function onMembershipChanged() {
    refreshTerritoryOnMap();   // 'mine' flags on the map change with membership
    if (isOpen()) { state.view = 'main'; refresh(); } else refreshClanBadge();
  }
  // Clan-channel events (notify-then-fetch). Skips the re-render while the
  // viewer is typing in the panel, so an incoming event can't wipe input.
  function onClanEvent(ev) {
    if (ev && ev.type === 'clan_level_up') toast(`🎉 Your clan reached level ${ev.level}!`, 'success');
    if (ev && (ev.type === 'clan_territory_claimed' || ev.type === 'clan_profile_updated')) refreshTerritoryOnMap();
    // Keep cached clan data current for the map's Claim action even while
    // the panel is closed.
    if (!isOpen()) { refreshClanBadge(); return; }
    if (!isOpen() || state.view !== 'main') return;
    const typing = document.activeElement && byId('clan-panel').contains(document.activeElement)
      && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (typing) return;
    refresh();
  }
  function onInviteReceived() {
    toast('🛡️ You have a new clan invitation.', 'success');
    refreshClanBadge();
  }
  function onDisbanded(ev) {
    const msg = ev && ev.reason === 'world_regenerated'
      ? 'The world was remade — all clans have been dissolved.'
      : `${(ev && ev.name) || 'Your clan'} has been disbanded.`;
    toast(msg, 'error');
    onMembershipChanged();
  }

  // Phones suspend EventSource in the background; catch up on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isOpen() && state.view === 'main') refresh();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) {
      if (byId('clan-sheet-wrap').classList.contains('open')) closeSheet(); else closeClanPanel();
    }
  });

  // Dev Tools: add (+) or remove (−) prestige for your own clan.
  async function cheatClanPrestige(amount) {
    const fb = document.getElementById('cheat-clan-prestige-feedback');
    if (!Number.isFinite(amount) || !amount) { if (fb) fb.textContent = '⚠ Enter a non-zero amount.'; return; }
    try {
      const d = await call('POST', '/api/clans/cheat/prestige', { amount });
      const msg = `✓ ${amount > 0 ? '+' : ''}${amount} → ${d.prestige.toLocaleString()} spendable · ${d.prestige_lifetime.toLocaleString()} lifetime · level ${d.level}`;
      if (fb) fb.textContent = msg;
      // One toast slot: announce the level-up here rather than letting this
      // toast overwrite the clan_level_up one.
      toast(d.leveledTo ? `🎉 Your clan reached level ${d.leveledTo}!`
        : `🛡️ Clan prestige ${amount > 0 ? '+' : ''}${amount}`, 'success');
      await refreshClanBadge();   // keeps cached clan data (Claim costs etc.) current
    } catch (e) {
      if (fb) fb.textContent = '⚠ ' + e.message;
    }
  }

  global.cheatClanPrestige = cheatClanPrestige;
  global.openClanPanel = openClanPanel;
  global.closeClanPanel = closeClanPanel;
  global.refreshClanBadge = refreshClanBadge;
  global.ClanUI = { onMembershipChanged, onInviteReceived, onDisbanded, onClanEvent, refresh,
                    claimInfo, claimTile, claimFromTile, refreshTerritoryOnMap,
                    territoryLineHtml, claimButtonHtml };
})(typeof window !== 'undefined' ? window : globalThis);
