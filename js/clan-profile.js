// ══════════════════════════════════════════════════════════════════════════
//  CLAN PROFILE — the public face of a clan (spec 016 Phase 5)
//
//  openClanProfile(clanId) opens a read-only card any player can see: the
//  banner, level, standing, territory, roster (tap a member → their player
//  profile), milestones and the honors strip (stubbed while
//  ClanPalette.CLAN_HONORS_LIVE is false). Data: GET /api/clans/:id.
//
//  Opened from: Rankings → Clan Prestige rows, "Territory of <clan>" on tile
//  info, clan tags in the Chat hub, the clan line on player profiles, and
//  the Clan panel's Overview. It stacks above those surfaces (the
//  leaderboard included); a player profile opened from here is raised above
//  it so closing that returns here.
//
//  #clan-profile is registered in mobile-shell watchOverlays() and must be
//  display:none when closed.
//
//  Depends on: apiFetch, escHtml, ClanPalette, ClanUI (clans.js).
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const esc = s => (typeof global.escHtml === 'function' ? global.escHtml(s) : String(s ?? ''));
  const P = () => global.ClanPalette;
  const byId = id => document.getElementById(id);
  const RANK_ICON = { founder: '👑', leader: '⚜️', officer: '🎖️', member: '🛡️', recruit: '🌱' };
  const RANK_GROUP = { founder: 'Founder', leader: 'Leaders', officer: 'Officers', member: 'Members', recruit: 'Recruits' };
  const TIER_ICON = { camp: '⛺', hamlet: '🛖', village: '🏡', town: '🏘️', city: '🏙️', kingdom: '🏰' };

  let _data = null, _loadSeq = 0;

  function el() {
    let root = byId('clan-profile');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'clan-profile';
    root.className = 'clan-backdrop cp-backdrop';
    root.innerHTML = `<div class="clan-card cp-card" role="dialog" aria-modal="true" aria-label="Clan profile">
        <button class="clan-close cp-close" type="button" aria-label="Close" data-cp="close">✕</button>
        <div class="cp-scroll" id="cp-scroll"></div>
      </div>`;
    root.addEventListener('click', e => {
      if (e.target === root) return closeClanProfile();
      const t = e.target.closest('[data-cp]');
      if (t) onAction(t);
    });
    document.body.appendChild(root);
    return root;
  }
  const isOpen = () => { const r = byId('clan-profile'); return !!r && r.classList.contains('open'); };

  async function openClanProfile(clanId) {
    const id = parseInt(clanId, 10);
    if (!id) return;
    el().classList.add('open');
    const seq = ++_loadSeq;
    if (!_data || _data.clan.id !== id) byId('cp-scroll').innerHTML = '<div class="clan-empty">Unfurling the banner…</div>';
    try {
      const res = await global.apiFetch(`/api/clans/${id}`);
      const d = await res.json().catch(() => ({}));
      if (seq !== _loadSeq) return;
      if (!res.ok) throw new Error(d.error || 'Could not load that clan.');
      _data = d;
      render();
    } catch (e) {
      if (seq === _loadSeq) byId('cp-scroll').innerHTML = `<div class="clan-empty">${esc(e.message)}</div>`;
    }
  }
  function closeClanProfile() { const r = byId('clan-profile'); if (r) r.classList.remove('open'); }

  // ── Helpers shared with the Clan panel ──────────────────────────────────
  function bannerHtml(b, s) {
    return `<span class="clan-banner" style="--c1:${esc(b.primaryHex)};--c2:${esc(b.secondaryHex)};width:${s}px;height:${Math.round(s * 1.2)}px;font-size:${Math.round(s * 0.5)}px">
      <span class="clan-banner-glyph">${esc(b.glyph)}</span></span>`;
  }
  function ago(ts) {
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
  }
  // "Online now" / "Seen 3h ago" / '' for a roster row.
  function presence(m) {
    if (m.online) return 'Online now';
    return m.last_seen_at ? `Seen ${ago(m.last_seen_at)}` : '';
  }
  function titleChip(t) { return t ? `<span class="clan-title-chip">${esc(t)}</span>` : ''; }
  function tierIcon(t) { return TIER_ICON[t] || '🏠'; }

  // ── Render ──────────────────────────────────────────────────────────────
  function render() {
    if (!_data || !isOpen()) return;
    const { clan: c, roster, milestones, honors, viewer } = _data;
    const founded = new Date(c.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' });
    const online = roster.filter(m => m.online).length;
    let bar = '<div class="clan-muted">Highest level reached.</div>';
    if (c.next_level_at) {
      const prev = (P().levelRow(c.level) || {}).lifetime || 0;
      const pct = Math.max(2, Math.min(100, Math.round(100 * (c.prestige_lifetime - prev) / (c.next_level_at - prev))));
      bar = `<div class="clan-bar"><span style="width:${pct}%"></span></div>
        <div class="clan-muted">${c.prestige_lifetime.toLocaleString()} / ${c.next_level_at.toLocaleString()} to level ${c.level + 1}</div>`;
    }
    const stat = (v, k) => `<div class="cp-stat"><span class="cp-stat-v">${v}</span><span class="cp-stat-k">${k}</span></div>`;
    const hq = c.territory.hq;

    // Roster grouped by rank (server order is rank, then join date).
    let group = '', rows = '';
    for (const m of roster) {
      if (m.rank !== group) {
        group = m.rank;
        const n = roster.filter(x => x.rank === group).length;
        rows += `<li class="cp-group">${RANK_ICON[group] || ''} ${RANK_GROUP[group] || group} <span class="clan-muted">${n}</span></li>`;
      }
      rows += `<li><button type="button" class="clan-member" data-cp="member" data-id="${m.user_id}">
          <span class="clan-presence${m.online ? ' on' : ''}" title="${esc(presence(m) || 'Offline')}"></span>
          <span class="clan-member-main">
            <span class="clan-member-name">${esc(m.username)}${titleChip(m.title)}</span>
            <span class="clan-muted">${tierIcon(m.tier)} ${esc(m.settlement_name || 'No settlement')} · ${esc(m.species || '')}</span>
          </span>
          <span class="clan-member-pts" title="Prestige contributed">✦ ${Number(m.prestige_contributed).toLocaleString()}</span>
        </button></li>`;
    }

    const MS = {
      clan_founded: a => ['🏛️', `Founded by <b>${esc(a.actor || 'someone')}</b>`],
      level_up: a => ['🎉', `Reached <b>level ${esc((a.payload || {}).level)}</b>`],
      leadership_transferred: a => ['👑', `<b>${esc((a.payload || {}).username || 'A member')}</b> became founder`],
    };
    const ms = milestones.map(a => {
      const [ic, text] = (MS[a.type] || (() => ['·', esc(a.type)]))(a);
      return `<li><span class="clan-feed-ic">${ic}</span><span class="clan-feed-text">${text}<span class="clan-feed-when">${esc(new Date(a.created_at).toLocaleDateString())}</span></span></li>`;
    }).join('');

    const honorsHtml = `<div class="cp-honors${honors.live ? '' : ' stub'}">
        ${stat('0', 'Honor points')}${stat('0', 'Deeds')}${stat('0', 'Trophies')}
      </div>
      ${honors.live ? '' : '<div class="clan-muted cp-hint">Clan honors are coming — great deeds done together will be displayed here.</div>'}`;

    byId('cp-scroll').innerHTML = `
      <header class="cp-hero" style="--c1:${esc(c.banner.primaryHex)};--c2:${esc(c.banner.secondaryHex)}">
        ${bannerHtml(c.banner, 76)}
        <div class="cp-hero-text">
          <div class="cp-name">${esc(c.name)}</div>
          <div class="cp-sub">Level ${c.level} · founded ${esc(founded)}</div>
          <div class="cp-tags">
            ${viewer.member ? '<span class="cp-tag mine">Your clan</span>' : ''}
            ${c.recruiting ? '<span class="cp-tag rec">📯 Recruiting</span>' : ''}
            ${online ? `<span class="cp-tag"><span class="clan-presence on"></span> ${online} online</span>` : ''}
          </div>
        </div>
      </header>
      <div class="cp-body">
        <p class="clan-desc">${c.description ? esc(c.description) : '<span class="clan-muted">This clan keeps its purpose to itself.</span>'}</p>
        ${bar}
        <div class="cp-stats">
          ${stat(`#${c.standing}`, `of ${c.clan_count} clans`)}
          ${stat(c.prestige_lifetime.toLocaleString(), 'Lifetime prestige')}
          ${stat(`${c.member_count}<small>/${c.member_cap}</small>`, 'Members')}
          ${stat(c.territory.count, c.territory.count === 1 ? 'Tile held' : 'Tiles held')}
        </div>
        <section class="clan-sec">
          <h3>Honors</h3>
          ${honorsHtml}
        </section>
        <section class="clan-sec">
          <h3>Roster</h3>
          <ul class="clan-roster cp-roster">${rows}</ul>
        </section>
        ${ms ? `<section class="clan-sec"><h3>Milestones</h3><ul class="clan-feed">${ms}</ul></section>` : ''}
        <section class="clan-sec cp-actions">
          ${hq ? `<button type="button" class="clan-btn ghost" data-cp="hq">🏛️ Show clan hall${hq.name ? ` — ${esc(hq.name)}` : ''}</button>` : ''}
          ${viewer.member
            ? '<button type="button" class="clan-btn" data-cp="panel">🛡️ Open clan panel</button>'
            : `<div class="clan-muted">${c.recruiting
                ? `📯 ${esc(c.name)} is recruiting. Membership is by invitation — message a Leader or Officer.`
                : 'Membership is by invitation from a Leader or Officer.'}</div>`}
        </section>
      </div>`;
    byId('cp-scroll').scrollTop = 0;
  }

  function onAction(t) {
    switch (t.dataset.cp) {
      case 'close': closeClanProfile(); break;
      case 'member': {
        const m = _data && _data.roster.find(x => x.user_id === parseInt(t.dataset.id, 10));
        if (!m) break;
        const mine = typeof gameData !== 'undefined' && gameData && gameData.username === m.username;
        if (mine) { if (typeof global.openProfile === 'function') global.openProfile(); break; }
        // Raise the player profile above this card; closing it returns here.
        const vp = byId('view-profile-modal');
        if (vp) vp.style.zIndex = '100003';
        if (typeof global.viewPlayerProfile === 'function') {
          global.viewPlayerProfile(m.username, m.species || '', m.settlement_name || '', m.tier || 'camp', m.tile_q ?? '?', m.tile_r ?? '?');
        }
        break;
      }
      case 'panel':
        closeClanProfile();
        if (global.Leaderboard) global.Leaderboard.close();
        if (typeof global.openClanPanel === 'function') global.openClanPanel();
        break;
      case 'hq': {
        const hq = _data && _data.clan.territory.hq;
        if (!hq) break;
        closeClanProfile();
        if (global.Leaderboard) global.Leaderboard.close();
        if (typeof global.closeChatHub === 'function') global.closeChatHub();
        if (typeof global.closeClanPanel === 'function') global.closeClanPanel();
        if (typeof global.navGoMap === 'function') global.navGoMap();
        const w = typeof worldMapData !== 'undefined' ? worldMapData : null;
        const tile = w && w.tiles ? w.tiles.find(x => x.q === hq.q && x.r === hq.r) : null;
        if (typeof camera !== 'undefined') { camera.q = hq.q; camera.r = hq.r; }
        if (tile && tile.terrain !== 'fog' && typeof global.selectWorldTile === 'function') global.selectWorldTile(tile);
        else if (typeof global.showBuildToast === 'function') global.showBuildToast("You haven't explored that part of the realm yet.", 'error');
        break;
      }
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !isOpen()) return;
    const vp = byId('view-profile-modal');
    if (vp && vp.classList.contains('open')) return;   // the profile closes first
    closeClanProfile();
  }, true);   // capture: runs before profile.js closes the player profile

  global.openClanProfile = openClanProfile;
  global.closeClanProfile = closeClanProfile;
  global.ClanProfile = { presence, titleChip, tierIcon, ago, RANK_ICON, RANK_GROUP };
})(typeof window !== 'undefined' ? window : globalThis);
