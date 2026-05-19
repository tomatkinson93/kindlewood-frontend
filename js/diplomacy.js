// ══════════════════════════════════════════════
//  DIPLOMACY SYSTEM
//  Handles NPC settlement relations & trust
// ══════════════════════════════════════════════

const TRUST_LEVELS = [
  { min: 0,  max: 0,   status: 'unknown',       label: 'Unknown',    color: '#888888',  icon: '❓' },
  { min: 1,  max: 20,  status: 'contacted',     label: 'Contacted',  color: '#8ecf7e',  icon: '📨' },
  { min: 21, max: 40,  status: 'familiar',      label: 'Familiar',   color: '#5ec4b0',  icon: '🤝' },
  { min: 41, max: 70,  status: 'friendly',      label: 'Friendly',   color: '#4a90d9',  icon: '💙' },
  { min: 71, max: 100, status: 'allied',        label: 'Allied',     color: '#c678dd',  icon: '⭐' },
];

function getTrustLevel(trust) {
  return [...TRUST_LEVELS].reverse().find(l => trust >= l.min) || TRUST_LEVELS[0];
}

// Server contract — these defaults match the server until /:npcId responds.
const DEFAULT_GIFT_TIERS = [
  { key: 'small',   label: 'Small Gift',   gold: 100, trust_gain: 3,  icon: '🎁' },
  { key: 'medium',  label: 'Medium Gift',  gold: 250, trust_gain: 5,  icon: '🎀' },
  { key: 'large',   label: 'Large Gift',   gold: 500, trust_gain: 8,  icon: '🛍' },
  { key: 'lavish',  label: 'Lavish Gift',  gold: 750, trust_gain: 10, icon: '👑' },
];
const DEFAULT_GOODWILL_CAP = 5;
const DEFAULT_QUEST_UNLOCK_TRUST = 41;

// Global set of citizen IDs currently on diplomatic missions (covers contact +
// goodwill + gift). Used by main.js to grey out citizens in other UIs.
window._diploEnvoyIds = new Set();

async function _refreshDiploEnvoys() {
  try {
    const r = await apiFetch('/api/diplomacy');
    if (!r.ok) return;
    const d = await r.json();
    window._diploEnvoyIds = new Set(
      (d.relations || [])
        .filter(rel => rel.citizen_id && (rel.status === 'contact_sent' || rel.pending_action))
        .map(rel => rel.citizen_id)
    );
  } catch(e) {}
}

// Mirrors server's computeGoodwillGain so the UI preview matches the server reward.
function _previewGoodwillGain(charisma, cap) {
  const ch = Math.max(0, charisma || 0);
  return Math.min(cap || DEFAULT_GOODWILL_CAP, Math.max(1, Math.floor(2 + ch / 4)));
}

function _citizenCharisma(c) {
  if (!c) return 0;
  const fromStats = (c.stats && typeof c.stats === 'object') ? (c.stats.charisma || 0) : 0;
  const fromTraits = [].concat(c.visible_traits || [], c.hidden_traits || [], c.traits || [])
    .reduce((sum, t) => {
      if (t === 'charming') return sum + 3;
      if (t === 'loyal')    return sum + 1;
      return sum;
    }, 0);
  return fromStats + fromTraits;
}

// ── Side panel — summary view with an "Open Diplomacy" button ────────────
//
// The full diplomacy UI now lives in the diplomacy modal (#diplomacy-modal).
// The side panel just shows a brief status line + a button to open it; this
// keeps the world-tile inspector uncluttered for whatever the player is
// looking at next.
async function renderDiplomacyPanel(npc, tile) {
  const body = document.getElementById('panel-body');
  const sub  = document.getElementById('panel-sub');
  if (!body) return;

  const npcId = npc._npcId;

  // If the diplomacy modal is currently open for a *different* NPC, switch it
  // to the newly-clicked one so the map and modal stay in sync.
  const modal = document.getElementById('diplomacy-modal');
  const openFor = modal?.dataset?.npcId ? parseInt(modal.dataset.npcId) : null;
  if (modal?.style.display === 'flex' && openFor && openFor !== npcId && npcId) {
    openDiplomacyModal(npcId);
  }

  // Hostile — same treatment as before; no modal, just a warning card.
  if (npc.disposition === 'hostile') {
    sub.innerHTML = '<span style="color:#e05050;font-size:11px">💀 Hostile — No Diplomacy</span>';
    body.innerHTML = `
      <div class="diplo-hostile-warning">
        <div class="diplo-hostile-title">⚠️ The Withered</div>
        <div class="diplo-hostile-desc">These creatures cannot be reasoned with. Approach only with force.</div>
      </div>`;
    return;
  }

  if (!npcId) {
    sub.innerHTML = '';
    body.innerHTML = '<div class="diplo-loading" style="color:#e07a6a">⚠️ NPC data not loaded yet.<br><small style="opacity:.6">Try clicking 🌍 Seed NPC Settlements in Dev Tools → World.</small></div>';
    return;
  }

  // Fetch the relation so we can render an accurate status pip + envoy banner.
  // The data is also cached so opening the modal doesn't pay a round-trip first.
  body.innerHTML = '<div class="diplo-loading">Checking relations…</div>';
  let data;
  try {
    const res = await apiFetch(`/api/diplomacy/${npcId}`);
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);
  } catch(e) {
    body.innerHTML = '<div class="diplo-loading" style="color:#e07a6a">⚠️ Could not load diplomacy data.<br><small style="opacity:.6">' + (e.message || '') + '</small></div>';
    return;
  }

  window._diploLastData = data;
  window._diploLastNpc  = npc;

  const rel = data.relation;
  const trust = rel?.trust || 0;
  const level = getTrustLevel(trust);
  const status = rel?.status || 'unknown';

  // ── Status pip (sub-header) ─────────────────────────────────────────────
  sub.innerHTML = `<span style="color:${level.color};font-size:11px">${level.icon} ${level.label} · ${npc.tier}</span>`;

  // ── Inline status banner ────────────────────────────────────────────────
  // What the player most wants to know at a glance:
  //   - currently nothing → trust bar + CTA
  //   - envoy in flight   → "X is travelling, arrives in Ym"
  //   - quest in flight   → "Y is on a quest from {NPC}" (only if Friendly+)
  let statusBanner = '';
  if (status === 'unknown') {
    statusBanner = `
      <div class="diplo-side-status diplo-side-status-fresh">
        <span class="diplo-side-status-icon">📨</span>
        <span class="diplo-side-status-text">No contact yet — send an envoy to open relations.</span>
      </div>`;
  } else if (status === 'contact_sent' || rel?.pending_action) {
    const isContact = status === 'contact_sent';
    const eta = isContact ? rel.contact_arrives_at : rel.pending_arrives_at;
    const remaining = eta ? Math.max(0, Math.ceil((new Date(eta) - Date.now()) / 1000)) : 0;
    const courier = rel?.citizen_name || rel?.pending_meta?.citizen_name || 'An envoy';
    const action = isContact ? 'on first contact' :
                   rel.pending_action === 'gift'   ? 'delivering a ' + (rel.pending_meta?.tier_label || 'gift') :
                                                    'on a goodwill mission';
    statusBanner = `
      <div class="diplo-side-status diplo-side-status-flight" id="diplo-side-status-${npcId}" data-eta="${eta}">
        <span class="diplo-side-status-icon">🧑</span>
        <span class="diplo-side-status-text">
          <b>${courier}</b> is ${action}.<br>
          <span class="diplo-side-status-eta" id="diplo-side-eta-${npcId}">Arrives in ${formatDurationShort(remaining)}</span>
        </span>
      </div>`;
    _startSideEnvoyTicker(npcId);
  } else {
    // Idle, post-contact: small trust bar so the player can see progress without opening.
    statusBanner = `
      <div class="diplo-side-status diplo-side-status-idle">
        <div class="diplo-side-trust-row">
          <span class="diplo-trust-icon">${level.icon}</span>
          <div class="diplo-trust-bar-wrap">
            <div class="diplo-trust-bar" style="width:${trust}%;background:${level.color}"></div>
          </div>
          <span class="diplo-side-trust-num" style="color:${level.color}">${trust}</span>
        </div>
      </div>`;
  }

  // CTA button — primary action of the panel now.
  const ctaLabel = status === 'unknown' ? '📨 Open Diplomacy'
                 : (status === 'contact_sent' || rel?.pending_action) ? '🤝 View Mission'
                 : '🤝 Open Diplomacy';

  body.innerHTML = `
    <div class="diplo-side-desc">${npc.description || ''}</div>
    ${statusBanner}
    <button class="diplo-open-btn" onclick="openDiplomacyModal(${npcId})">${ctaLabel}</button>
  `;
}

// ── Ticker for the side-panel envoy banner ────────────────────────────────
let _sideEnvoyTickers = {};
function _startSideEnvoyTicker(npcId) {
  if (_sideEnvoyTickers[npcId]) clearInterval(_sideEnvoyTickers[npcId]);
  const tick = () => {
    const wrap = document.getElementById('diplo-side-status-' + npcId);
    const etaEl = document.getElementById('diplo-side-eta-' + npcId);
    if (!wrap || !etaEl) {
      clearInterval(_sideEnvoyTickers[npcId]);
      delete _sideEnvoyTickers[npcId];
      return;
    }
    const eta = new Date(wrap.dataset.eta);
    const remaining = Math.max(0, Math.ceil((eta - Date.now()) / 1000));
    etaEl.textContent = remaining > 0 ? 'Arrives in ' + formatDurationShort(remaining) : '🎉 Arrived!';
    if (remaining === 0) {
      clearInterval(_sideEnvoyTickers[npcId]);
      delete _sideEnvoyTickers[npcId];
      // Refresh side panel so it picks up resolved state, and refresh modal if open.
      setTimeout(() => _refreshDiplomacyPanel(), 800);
    }
  };
  tick();
  _sideEnvoyTickers[npcId] = setInterval(tick, 1000);
}

// ── Modal — full diplomacy UI ─────────────────────────────────────────────
async function openDiplomacyModal(npcId) {
  const modal = document.getElementById('diplomacy-modal');
  const body  = document.getElementById('dm-body');
  if (!modal || !body) return;

  modal.style.cssText = 'display:flex';
  body.innerHTML = '<div class="diplo-loading">Loading diplomacy…</div>';
  modal.dataset.npcId = String(npcId);

  // Find the npc object — prefer the cached one from the side panel, else
  // fall back to whatever was last selected on the world map.
  let npc = window._diploLastNpc;
  if (!npc || npc._npcId !== npcId) {
    const lastTile = window._lastSelectedTile;
    if (lastTile?.settlement && (lastTile.settlement.npc_id === npcId || lastTile.settlement._npcId === npcId)) {
      npc = lastTile.settlement;
    }
  }
  if (!npc) {
    body.innerHTML = '<div class="diplo-loading" style="color:#e07a6a">⚠️ NPC data unavailable. Click the tile on the map and reopen.</div>';
    return;
  }

  try {
    const res = await apiFetch(`/api/diplomacy/${npcId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);
    window._diploLastData = data;

    const rel = data.relation;
    const trust = rel?.trust || 0;
    const level = getTrustLevel(trust);
    const status = rel?.status || 'unknown';

    _renderDiplomacyModalBody(data, npc, npcId, trust, level, status, rel);

    if (trust >= (data.quest_unlock_trust || DEFAULT_QUEST_UNLOCK_TRUST)) {
      _loadAndRenderNpcQuests(npcId);
    }
  } catch(e) {
    body.innerHTML = '<div class="diplo-loading" style="color:#e07a6a">⚠️ Could not load diplomacy data.<br><small style="opacity:.6">' + (e.message || '') + '</small></div>';
    console.error('Diplomacy modal error:', e);
  }
}

function closeDiplomacyModal() {
  const modal = document.getElementById('diplomacy-modal');
  if (modal) {
    modal.style.cssText = 'display:none';
    delete modal.dataset.npcId;
  }
  // Cancel any modal-scoped timers — the side-panel ticker keeps running on its own.
  Object.keys(_diploTimers).forEach(k => { clearInterval(_diploTimers[k]); delete _diploTimers[k]; });
}

function _isDiplomacyModalOpen() {
  const modal = document.getElementById('diplomacy-modal');
  return modal && modal.style.display === 'flex';
}

function _renderDiplomacyModalBody(data, npc, npcId, trust, level, status, rel) {
  const body  = document.getElementById('dm-body');
  const title = document.getElementById('dm-title');
  const sub   = document.getElementById('dm-sub');
  if (!body) return;

  const travelMins = Math.ceil(data.travel_secs / 60);
  const giftTiers = data.gift_tiers || DEFAULT_GIFT_TIERS;
  const goodwillCap = data.goodwill_cap || DEFAULT_GOODWILL_CAP;
  const questUnlockTrust = data.quest_unlock_trust || DEFAULT_QUEST_UNLOCK_TRUST;

  // Header
  if (title) title.textContent = npc.name;
  if (sub) sub.innerHTML = `<span style="color:${level.color}">${level.icon} ${level.label}</span> · ${npc.tier} · ${npc.species || ''}`;

  // Trust bar
  const trustBarHtml = `
    <div class="diplo-trust-row">
      <span class="diplo-trust-icon">${level.icon}</span>
      <div class="diplo-trust-bar-wrap">
        <div class="diplo-trust-bar" style="width:${trust}%;background:${level.color}"></div>
      </div>
      <span class="diplo-trust-label" style="color:${level.color}">${level.label}</span>
    </div>`;

  // Trust milestones
  const milestonesHtml = TRUST_LEVELS.slice(1).map(l => {
    const reached = trust >= l.min;
    return `<div class="diplo-milestone ${reached ? 'reached' : ''}">
      <span>${l.icon}</span><span>${l.label}</span>
      <span class="diplo-milestone-unlock">${_trustUnlockText(l.status)}</span>
    </div>`;
  }).join('');

  // ── Action area ────────────────────────────────────────────────────────
  let actionsHtml = '';

  if (status === 'unknown') {
    actionsHtml = `
      <div class="diplo-action-label">Send an envoy to make first contact</div>
      <div class="diplo-envoy-row">
        <select class="pa-select" id="diplo-citizen-sel-${npcId}">
          <option value="">— Choose a citizen —</option>
          ${_buildDiploCitizenOptions()}
        </select>
      </div>
      <button class="diplo-contact-btn" data-npcid="${npcId}" onclick="diplomacySendContact(this.dataset.npcid)">
        📨 Send Envoy · ~${travelMins}m journey
      </button>`;

  } else if (status === 'contact_sent') {
    actionsHtml = _buildEnvoyEnRouteHtml({
      npcId, npc,
      title: (rel?.citizen_name || 'Envoy') + ' is travelling',
      subtitle: 'Making first contact with ' + npc.name,
      sentAt: rel?.contact_sent_at,
      arrivesAt: rel?.contact_arrives_at,
      fallbackTotalSecs: data.travel_secs,
      timerKey: 'contact',
    });
    _startDiploTravelTimer(npcId, new Date(rel.contact_arrives_at), null, 'contact');

  } else if (rel?.pending_action) {
    const meta = rel.pending_meta || {};
    const isGift = rel.pending_action === 'gift';
    const gain = rel.pending_trust_gain || 0;
    const courier = rel.citizen_name || meta.citizen_name || 'Envoy';
    const enrTitle = isGift
      ? courier + ' is delivering a ' + (meta.tier_label || 'gift')
      : courier + ' is on a goodwill mission';
    const subtitle = isGift
      ? 'A ' + (meta.tier_label || 'gift') + ' for ' + npc.name + ' · +' + gain + ' on arrival'
      : 'Bringing greetings to ' + npc.name + ' · +' + gain + ' on arrival';

    actionsHtml = _buildEnvoyEnRouteHtml({
      npcId, npc,
      title: enrTitle,
      subtitle,
      sentAt: rel?.pending_sent_at,
      arrivesAt: rel?.pending_arrives_at,
      fallbackTotalSecs: data.travel_secs,
      timerKey: 'pending',
    });
    _startDiploTravelTimer(npcId, new Date(rel.pending_arrives_at), null, 'pending');

  } else {
    actionsHtml = _buildIdleActionsHtml({
      npcId, npc, rel, data, trust, level,
      giftTiers, goodwillCap, questUnlockTrust, travelMins,
    });
  }

  body.innerHTML = `
    <div class="dm-section">
      <div class="diplo-desc">${npc.description || ''}</div>
    </div>
    <div class="dm-section">
      <div class="diplo-trust-section">
        ${trustBarHtml}
      </div>
      <div class="diplo-milestones">${milestonesHtml}</div>
    </div>
    <div class="dm-section diplo-actions">${actionsHtml}</div>
  `;
}

// Builds the en-route walker block (shared between contact + goodwill + gift).
function _buildEnvoyEnRouteHtml({ npcId, npc, title, subtitle, sentAt, arrivesAt, fallbackTotalSecs, timerKey }) {
  const eta = arrivesAt ? new Date(arrivesAt) : null;
  const sent = sentAt ? new Date(sentAt) : null;
  const totalSecs = sent && eta ? Math.max(1, Math.round((eta - sent) / 1000)) : (fallbackTotalSecs || 60);
  const remaining = eta ? Math.max(0, Math.ceil((eta - Date.now()) / 1000)) : 0;
  const elapsed = totalSecs - remaining;
  const pct = Math.min(100, Math.round((elapsed / totalSecs) * 100));

  return `
    <div class="diplo-en-route">
      <div class="diplo-en-route-header">
        <span class="diplo-walker-icon">🧑</span>
        <div class="diplo-en-route-info">
          <div class="diplo-en-route-title">${title}</div>
          <div class="diplo-en-route-subtitle">${subtitle}</div>
        </div>
      </div>
      <div class="diplo-trail-wrap">
        <div class="diplo-trail">
          <span class="diplo-trail-start">🏘</span>
          <div class="diplo-trail-line">
            <div class="diplo-trail-dots"></div>
            <div class="diplo-trail-walker" id="diplo-walker-${npcId}" style="left:${pct}%">🧑</div>
          </div>
          <span class="diplo-trail-end">🏡</span>
        </div>
      </div>
      <div class="diplo-eta-row">
        <span class="diplo-en-route-eta" id="diplo-eta-${npcId}"></span>
        <span class="diplo-pct-label" id="diplo-pct-${npcId}">${pct}%</span>
      </div>
      <div class="diplo-en-route-bar-wrap">
        <div class="diplo-en-route-bar" id="diplo-travel-bar-${npcId}" data-total-secs="${totalSecs}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function _buildIdleActionsHtml({ npcId, npc, rel, data, trust, level, giftTiers, goodwillCap, questUnlockTrust, travelMins }) {
  // Player gold for affordability checks
  const playerGold = (gameData?.settlement?.resources?.wealth) ?? (gameData?.settlement?.wealth) ?? 0;

  // Gift cooldown countdown
  let giftCooldownHtml = '';
  if (data.gift_available_at) {
    const ms = new Date(data.gift_available_at).getTime() - Date.now();
    const hrs = Math.max(0, Math.ceil(ms / 3600000));
    giftCooldownHtml = `<span class="diplo-cooldown-pip" id="diplo-gift-cd-${npcId}" data-eta="${data.gift_available_at}">⏳ Next gift in ${hrs}h</span>`;
    setTimeout(() => _tickGiftCooldown(npcId), 60000);
  }

  // Charisma preview for goodwill — picks the best citizen we'd actually send.
  const citizens = (typeof citizensData !== 'undefined' ? citizensData : [])
    .filter(c => c.life_stage !== 'child' && !c.expedition && !c.active_quest && !(window._diploEnvoyIds && window._diploEnvoyIds.has(c.id)));
  const avgGoodwill = (() => {
    if (!citizens.length) return null;
    const sorted = citizens.slice().sort((a,b) => _citizenCharisma(b) - _citizenCharisma(a));
    return _previewGoodwillGain(_citizenCharisma(sorted[0]), goodwillCap);
  })();

  // ── Goodwill envoy ─────────────────────────────────────────────────────
  const goodwillBlock = `
    <div class="diplo-action-block">
      <div class="diplo-action-block-header">
        <span class="diplo-action-block-title">🤝 Goodwill Envoy</span>
        <span class="diplo-action-block-cap">cap +${goodwillCap}</span>
      </div>
      <div class="diplo-action-block-desc">Send a citizen to spend time with ${npc.name}. Higher charisma → more trust gained, up to +${goodwillCap}.</div>
      ${citizens.length ? `
        <select class="pa-select diplo-action-select" id="diplo-goodwill-sel-${npcId}" onchange="_diploUpdateGoodwillPreview('${npcId}')">
          <option value="">— Choose a citizen —</option>
          ${_buildDiploCitizenOptions(true)}
        </select>
        <div class="diplo-action-row">
          <span class="diplo-action-preview" id="diplo-goodwill-preview-${npcId}">${avgGoodwill ? '+' + avgGoodwill + ' trust with your most charming citizen' : ''}</span>
          <button class="diplo-action-btn diplo-action-btn-good" data-npcid="${npcId}" onclick="diplomacySendGoodwill(this.dataset.npcid)">Send · ~${travelMins}m</button>
        </div>
      ` : `<div class="diplo-action-empty">No available citizens to send.</div>`}
    </div>`;

  // ── Send a gift ────────────────────────────────────────────────────────
  const cooldownActive = !!data.gift_available_at;
  const giftTilesHtml = giftTiers.map(t => {
    const canAfford = playerGold >= t.gold;
    const disabled = cooldownActive || !canAfford;
    const reason = cooldownActive ? 'Cooldown active' : (!canAfford ? 'Need ' + t.gold + ' gold' : '');
    return `
      <button class="diplo-gift-tile ${disabled ? 'is-disabled' : ''}"
              data-tier="${t.key}"
              data-gold="${t.gold}"
              ${disabled ? 'disabled' : ''}
              onclick="_diploSelectGiftTier('${npcId}','${t.key}')"
              title="${reason}">
        <div class="diplo-gift-tile-icon">${t.icon}</div>
        <div class="diplo-gift-tile-label">${t.label}</div>
        <div class="diplo-gift-tile-cost">🪙 ${t.gold}</div>
        <div class="diplo-gift-tile-gain">+${t.trust_gain} trust</div>
      </button>`;
  }).join('');

  const giftBlock = `
    <div class="diplo-action-block">
      <div class="diplo-action-block-header">
        <span class="diplo-action-block-title">🎁 Send a Gift</span>
        ${giftCooldownHtml || '<span class="diplo-action-block-cap">once per day</span>'}
      </div>
      <div class="diplo-action-block-desc">Have a citizen carry gold to ${npc.name}. The bigger the gift, the warmer the welcome.</div>
      <div class="diplo-gift-grid">${giftTilesHtml}</div>
      ${citizens.length ? `
        <select class="pa-select diplo-action-select" id="diplo-gift-sel-${npcId}" style="margin-top:8px" disabled>
          <option value="">— Pick a tier first —</option>
        </select>
        <div class="diplo-action-row">
          <span class="diplo-action-preview" id="diplo-gift-preview-${npcId}"></span>
          <button class="diplo-action-btn diplo-action-btn-gift" id="diplo-gift-send-${npcId}" disabled
                  data-npcid="${npcId}" onclick="diplomacySendGift(this.dataset.npcid)">Send Gift · ~${travelMins}m</button>
        </div>
      ` : `<div class="diplo-action-empty" style="margin-top:8px">No available citizens to send.</div>`}
    </div>`;

  // ── Quests block (Friendly+ only) ──────────────────────────────────────
  let questsBlock;
  if (trust >= questUnlockTrust) {
    questsBlock = `
      <div class="diplo-action-block diplo-quests-block" id="diplo-quests-block-${npcId}">
        <div class="diplo-action-block-header">
          <span class="diplo-action-block-title">📜 Quests from ${npc.name}</span>
          <span class="diplo-action-block-cap">${level.label}</span>
        </div>
        <div class="diplo-quests-list" id="diplo-quests-list-${npcId}">
          <div class="diplo-loading" style="font-size:11px;opacity:.6">Loading quests…</div>
        </div>
      </div>`;
  } else {
    const need = questUnlockTrust - trust;
    questsBlock = `
      <div class="diplo-action-block diplo-quests-locked">
        <div class="diplo-action-block-header">
          <span class="diplo-action-block-title">🔒 Quests</span>
          <span class="diplo-action-block-cap">Friendly required</span>
        </div>
        <div class="diplo-action-block-desc">Reach <b>Friendly</b> with ${npc.name} to unlock quests they offer. <span style="opacity:.7">${need} more trust needed.</span></div>
      </div>`;
  }

  return goodwillBlock + giftBlock + questsBlock;
}

function _trustUnlockText(status) {
  const map = {
    contacted: 'Unlocks: Goodwill, Gifts',
    familiar:  'Better gift returns',
    friendly:  'Unlocks: NPC Quests',
    allied:    'Unlocks: Alliance · Shared Scouts',
  };
  return map[status] || '';
}

// Build the list of citizens eligible to be sent. If `excludeOnDiplo` is true,
// citizens currently on a diplomatic mission are filtered out.
function _buildDiploCitizenOptions(_excludeOnDiplo) {
  const citizens = typeof citizensData !== 'undefined' ? citizensData : [];

  return citizens
    .filter(c => c.life_stage !== 'child' && !c.expedition && !c.active_quest && !(window._diploEnvoyIds && window._diploEnvoyIds.has(c.id)))
    .sort((a, b) => _citizenCharisma(b) - _citizenCharisma(a))
    .map(c => {
      const ch = _citizenCharisma(c);
      const sc = (c.skills && c.skills.scouting) || 0;
      return '<option value="' + c.id + '" data-charisma="' + ch + '">'
        + c.name + ' (Charisma ' + ch + (sc ? ' · Scouting ' + sc : '') + ')</option>';
    }).join('');
}

// Live-update the goodwill +X preview as the user picks a different citizen.
function _diploUpdateGoodwillPreview(npcId) {
  const sel = document.getElementById('diplo-goodwill-sel-' + npcId);
  const preview = document.getElementById('diplo-goodwill-preview-' + npcId);
  if (!sel || !preview) return;
  const cap = (window._diploLastData?.goodwill_cap) || DEFAULT_GOODWILL_CAP;
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.value) {
    preview.textContent = '';
    return;
  }
  const ch = parseInt(opt.dataset.charisma || '0');
  const gain = _previewGoodwillGain(ch, cap);
  preview.innerHTML = '<span style="color:#8ecf7e">+' + gain + ' trust</span> <span style="opacity:.55">(charisma ' + ch + ')</span>';
}

// User picked a gift tier — enable the citizen dropdown + Send button.
function _diploSelectGiftTier(npcId, tierKey) {
  const tiles = document.querySelectorAll('.diplo-gift-tile[data-npcid="' + npcId + '"], .diplo-gift-tile');
  tiles.forEach(t => t.classList.remove('is-selected'));
  // We can't filter tiles by npcId since they don't carry it — the panel only
  // shows one NPC at a time so this is fine.
  const tile = document.querySelector('.diplo-gift-tile[data-tier="' + tierKey + '"]');
  if (tile) tile.classList.add('is-selected');

  const sel = document.getElementById('diplo-gift-sel-' + npcId);
  const sendBtn = document.getElementById('diplo-gift-send-' + npcId);
  if (sel) {
    sel.disabled = false;
    sel.dataset.tier = tierKey;
    if (sel.options.length <= 1) {
      // Lazily populate the courier dropdown the first time.
      sel.innerHTML = '<option value="">— Choose a citizen —</option>' + _buildDiploCitizenOptions(true);
    }
  }
  if (sendBtn) sendBtn.disabled = !sel?.value;

  // Show per-tier reminder text.
  const tiers = (window._diploLastData?.gift_tiers) || DEFAULT_GIFT_TIERS;
  const t = tiers.find(x => x.key === tierKey);
  const preview = document.getElementById('diplo-gift-preview-' + npcId);
  if (preview && t) {
    preview.innerHTML = '<span style="color:#e8c76a">' + t.icon + ' ' + t.label + '</span>'
      + ' · <span>🪙 ' + t.gold + '</span>'
      + ' · <span style="color:#8ecf7e">+' + t.trust_gain + ' trust</span>';
  }

  // Hook the dropdown change to enable the send button only when a citizen is picked.
  if (sel) {
    sel.onchange = () => { if (sendBtn) sendBtn.disabled = !sel.value; };
  }
}

async function diplomacySendContact(npcId) {
  const sel = document.getElementById(`diplo-citizen-sel-${npcId}`);
  const citizenId = parseInt(sel?.value || '0');
  if (!citizenId) { showToastNotification('Choose a citizen to send first.', 'default'); return; }

  const btn = document.querySelector(`.diplo-contact-btn[data-npcid="${npcId}"]`);
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  try {
    const res = await apiFetch(`/api/diplomacy/${npcId}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: citizenId }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToastNotification('⚠️ ' + (data.error || 'Failed'), 'default');
      if (btn) { btn.textContent = '📨 Send Envoy'; btn.disabled = false; }
      return;
    }
    showToastNotification(data.citizen_name + ' sets out for ' + data.npc_name + '!', 'expedition_complete');
    if (typeof loadCitizens === 'function') await loadCitizens();
    await _refreshDiploEnvoys();
    if (typeof renderCitizensList === 'function') renderCitizensList();
    _refreshDiplomacyPanel();
  } catch(e) {
    showToastNotification('⚠️ Something went wrong.', 'default');
  }
}

async function diplomacySendGoodwill(npcId) {
  const sel = document.getElementById(`diplo-goodwill-sel-${npcId}`);
  const citizenId = parseInt(sel?.value || '0');
  if (!citizenId) { showToastNotification('Choose a citizen to send.', 'default'); return; }

  const btn = document.querySelector(`.diplo-action-btn-good[data-npcid="${npcId}"]`);
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  try {
    const res = await apiFetch(`/api/diplomacy/${npcId}/goodwill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: citizenId }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToastNotification('⚠️ ' + (data.error || 'Failed'), 'default');
      if (btn) { btn.textContent = 'Send'; btn.disabled = false; }
      return;
    }
    showToastNotification(data.citizen_name + ' has set out on a goodwill mission to ' + data.npc_name + ' (+' + data.trust_gain + ' on arrival).', 'expedition_complete');
    if (typeof loadCitizens === 'function') await loadCitizens();
    await _refreshDiploEnvoys();
    if (typeof renderCitizensList === 'function') renderCitizensList();
    _refreshDiplomacyPanel();
  } catch(e) {
    showToastNotification('⚠️ Something went wrong.', 'default');
    if (btn) { btn.textContent = 'Send'; btn.disabled = false; }
  }
}

async function diplomacySendGift(npcId) {
  const sel = document.getElementById(`diplo-gift-sel-${npcId}`);
  const citizenId = parseInt(sel?.value || '0');
  const tierKey = sel?.dataset?.tier;
  if (!tierKey) { showToastNotification('Pick a gift tier first.', 'default'); return; }
  if (!citizenId) { showToastNotification('Choose a citizen to deliver the gift.', 'default'); return; }

  const btn = document.getElementById(`diplo-gift-send-${npcId}`);
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  try {
    const res = await apiFetch(`/api/diplomacy/${npcId}/gift`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: citizenId, tier_key: tierKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToastNotification('⚠️ ' + (data.error || 'Failed'), 'default');
      if (btn) { btn.textContent = 'Send Gift'; btn.disabled = false; }
      return;
    }

    // Optimistic gold update so the topbar doesn't lag a tick.
    if (gameData?.settlement?.resources && typeof data.gold_spent === 'number') {
      gameData.settlement.resources.wealth = Math.max(0, (gameData.settlement.resources.wealth || 0) - data.gold_spent);
      if (typeof updateTopbarDisplay === 'function') updateTopbarDisplay();
    }

    showToastNotification(data.citizen_name + ' departs for ' + data.npc_name + ' with a ' + data.tier.label + ' (–🪙' + data.gold_spent + ', +' + data.trust_gain + ' on arrival).', 'expedition_complete');
    if (typeof loadCitizens === 'function') await loadCitizens();
    await _refreshDiploEnvoys();
    if (typeof renderCitizensList === 'function') renderCitizensList();
    _refreshDiplomacyPanel();
  } catch(e) {
    showToastNotification('⚠️ Something went wrong.', 'default');
    if (btn) { btn.textContent = 'Send Gift'; btn.disabled = false; }
  }
}

// Re-render whichever diplomacy surface is currently active. If the modal is
// open, refresh it; the side-panel summary is also kept current so the player
// sees consistent state when they close the modal.
function _refreshDiplomacyPanel() {
  const modal = document.getElementById('diplomacy-modal');
  const modalNpcId = modal?.dataset?.npcId ? parseInt(modal.dataset.npcId) : null;

  // Always refresh the side panel so the at-a-glance status stays accurate.
  const lastTile = window._lastSelectedTile;
  const s = lastTile?.settlement;
  const npcId = s?.npc_id || s?._npcId;
  if (npcId && s) {
    renderDiplomacyPanel(s, lastTile);
  }

  // If the modal is open for an NPC, refresh that too.
  if (_isDiplomacyModalOpen() && modalNpcId) {
    openDiplomacyModal(modalNpcId);
  }
}

let _diploTimers = {};
// Single timer per NPC that ticks the en-route walker for either contact or pending action.
function _startDiploTravelTimer(npcId, eta, _ignored, kind) {
  if (_diploTimers[npcId]) clearInterval(_diploTimers[npcId]);

  const tick = () => {
    const etaEl    = document.getElementById('diplo-eta-'     + npcId);
    const barEl    = document.getElementById('diplo-travel-bar-' + npcId);
    const walkerEl = document.getElementById('diplo-walker-'  + npcId);
    const pctEl    = document.getElementById('diplo-pct-'     + npcId);
    if (!etaEl) {
      // Panel was re-rendered for a different NPC — abort.
      clearInterval(_diploTimers[npcId]);
      delete _diploTimers[npcId];
      return;
    }

    const remaining = Math.max(0, Math.ceil((eta - Date.now()) / 1000));
    // We don't get totalSecs passed in directly anymore; derive from the bar's
    // initial width so we don't have to track it. For new sessions we just use
    // remaining/(remaining+elapsed). Cheaper: use the panel's data attributes.
    const totalAttr = barEl?.dataset.totalSecs ? parseInt(barEl.dataset.totalSecs) : null;
    const totalSecs = totalAttr || Math.max(remaining, 60);
    const pct = Math.min(100, Math.round(((totalSecs - remaining) / totalSecs) * 100));

    const fmt = s => s > 3600 ? Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm'
                   : s > 60   ? Math.floor(s/60) + 'm ' + (s%60) + 's'
                   : s + 's';

    etaEl.textContent    = remaining > 0 ? 'Arrives in ' + fmt(remaining) : '🎉 Arrived!';
    if (pctEl)    pctEl.textContent    = pct + '%';
    if (barEl)    barEl.style.width    = pct + '%';
    if (walkerEl) walkerEl.style.left  = Math.min(pct, 92) + '%';

    if (remaining === 0) {
      clearInterval(_diploTimers[npcId]);
      delete _diploTimers[npcId];
      setTimeout(() => {
        const arrivalMsg = kind === 'pending'
          ? 'Your envoy has reached their destination.'
          : 'Your envoy has arrived! Contact established.';
        showToastNotification(arrivalMsg, 'expedition_complete');
        _refreshDiplomacyPanel();
        // Refresh citizens list since the courier is freed.
        if (typeof loadCitizens === 'function') loadCitizens().then(() => {
          if (typeof renderCitizensList === 'function') renderCitizensList();
        });
        _refreshDiploEnvoys();
      }, 800);
    }
  };

  tick(); // run immediately
  _diploTimers[npcId] = setInterval(tick, 1000);
}

// ── NPC quest list ────────────────────────────────────────────────────────
async function _loadAndRenderNpcQuests(npcId) {
  const list = document.getElementById('diplo-quests-list-' + npcId);
  if (!list) return;
  try {
    const res = await apiFetch('/api/diplomacy/' + npcId + '/quests');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    _renderNpcQuests(npcId, data);
  } catch(e) {
    list.innerHTML = '<div class="diplo-action-empty">Couldn\'t load quests. ' + (e.message || '') + '</div>';
  }
}

function _renderNpcQuests(npcId, data) {
  // Stash for accept-time lookup
  window._diploLastQuestData = window._diploLastQuestData || {};
  window._diploLastQuestData[npcId] = data;

  const list = document.getElementById('diplo-quests-list-' + npcId);
  if (!list) return;

  const available = data.available || [];
  const active    = data.active || [];

  if (!available.length && !active.length) {
    list.innerHTML = '<div class="diplo-action-empty">' +
      '<span style="opacity:.7">' + (data.locked ? 'Locked.' : 'No quests on offer right now.') + '</span>' +
      '</div>';
    return;
  }

  // Active runs first (in progress / ready to collect)
  const activeHtml = active.map(run => {
    const title = run.def_title || run.quest_id;
    const icon = run.def_icon || '📜';
    const partyNames = (run.party_members || []).map(m => m.name).join(', ') || run.citizen_name || '';
    const status = run.status;
    const eta = run.completes_at ? new Date(run.completes_at) : null;
    const remaining = eta ? Math.max(0, Math.ceil((eta - Date.now()) / 1000)) : 0;

    if (status === 'active') {
      return `
        <div class="diplo-quest-item is-active">
          <div class="diplo-quest-icon">${icon}</div>
          <div class="diplo-quest-info">
            <div class="diplo-quest-title">${title}</div>
            <div class="diplo-quest-meta">⏳ ${formatDurationShort(remaining)} · ${partyNames}</div>
          </div>
          <div class="diplo-quest-status diplo-quest-status-active">Underway</div>
        </div>`;
    }
    if (status === 'completed' || status === 'failed') {
      return `
        <div class="diplo-quest-item is-${status}" data-runid="${run.id}">
          <div class="diplo-quest-icon">${icon}</div>
          <div class="diplo-quest-info">
            <div class="diplo-quest-title">${title}</div>
            <div class="diplo-quest-meta">${status === 'completed' ? '🎉 Returned triumphant' : '😔 Returned defeated'}</div>
          </div>
          <button class="diplo-quest-collect-btn" onclick="_diploCollectNpcQuest(${run.id}, '${npcId}')">Collect</button>
        </div>`;
    }
    return '';
  }).join('');

  // Available quests (filter out any whose IDs are already active to avoid double-listing)
  const activeIds = new Set(active.filter(r => r.status === 'active').map(r => r.quest_id));
  const availableHtml = available.filter(q => !activeIds.has(q.id)).map(q => {
    const requires = Array.isArray(q.requires) ? q.requires : (q.requires ? JSON.parse(q.requires) : []);
    const isParty = q.quest_type === 'party';
    const skillLabel = isParty
      ? requires.map(r => (r.role_label || r.skill_key)).join(' · ')
      : (q.skill_key || 'general');
    const rewardLabel = isParty
      ? (q.reward_label || ('+🪙' + (q.rewards?.wealth || 0)))
      : ('+🪙' + (q.reward_gold || 0));
    return `
      <div class="diplo-quest-item">
        <div class="diplo-quest-icon">${q.icon || '📜'}</div>
        <div class="diplo-quest-info">
          <div class="diplo-quest-title">${q.title}</div>
          <div class="diplo-quest-desc">${q.description || ''}</div>
          <div class="diplo-quest-meta">
            <span class="diplo-quest-tag">${isParty ? '👥 Party' : '🗡 Solo'}</span>
            <span class="diplo-quest-tag">🎯 ${skillLabel}</span>
            <span class="diplo-quest-tag">⏱ ${formatDurationShort(q.duration_s)}</span>
            <span class="diplo-quest-tag diplo-quest-tag-gold">${rewardLabel}</span>
          </div>
        </div>
        <button class="diplo-quest-accept-btn" onclick="_diploAcceptNpcQuest('${q.id}', '${npcId}')">${isParty ? 'Assemble' : 'Accept'}</button>
      </div>`;
  }).join('');

  list.innerHTML = (activeHtml || '') + (availableHtml || '');
  if (!activeHtml && !availableHtml) {
    list.innerHTML = '<div class="diplo-action-empty">No quests on offer right now.</div>';
  }
}

// Format seconds compactly (used in the quest meta line).
function formatDurationShort(s) {
  s = Math.max(0, Math.round(s || 0));
  if (s >= 3600) return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
  if (s >= 60)   return Math.floor(s/60) + 'm';
  return s + 's';
}

// Accept an NPC quest. Solo: show the existing solo-assignment panel. Party: open the
// existing party-assembly modal. Both delegate to the quests.js machinery.
async function _diploAcceptNpcQuest(questId, npcId) {
  // Pull the canonical quest object out of the panel data we just rendered.
  const list = window._diploLastQuestData?.[npcId];
  const q = list?.available?.find(x => x.id === questId);
  if (!q) {
    showToastNotification('⚠️ Quest no longer available.', 'default');
    return;
  }

  // Normalise jsonb fields (driver may return strings if the DB column was text-coerced).
  const normalised = {
    ...q,
    requires: typeof q.requires === 'string' ? JSON.parse(q.requires) : (q.requires || []),
    rewards:  typeof q.rewards  === 'string' ? JSON.parse(q.rewards)  : (q.rewards  || {}),
  };

  if (typeof openNpcQuestAssignment === 'function') {
    // quests.js exposes the entry point; it handles solo vs party internally.
    openNpcQuestAssignment(normalised, npcId);
  } else {
    showToastNotification('⚠️ Quest UI not ready — try again in a moment.', 'default');
  }
}

async function _diploCollectNpcQuest(runId, npcId) {
  try {
    const res = await apiFetch('/api/quests/collect/' + runId, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToastNotification('⚠️ ' + (data.error || 'Failed'), 'default'); return; }
    if (data.gold_awarded > 0) {
      showToastNotification('🪙 Collected ' + data.gold_awarded + ' gold!', 'partnership');
      if (gameData?.settlement?.resources) {
        gameData.settlement.resources.wealth += data.gold_awarded;
        if (typeof updateTopbarDisplay === 'function') updateTopbarDisplay();
      }
    } else {
      showToastNotification('Quest dismissed.', 'default');
    }
    _loadAndRenderNpcQuests(npcId);
  } catch(e) {
    showToastNotification('⚠️ Failed to collect.', 'default');
  }
}

// Tick the gift cooldown pip every minute so we don't have to re-render the panel.
function _tickGiftCooldown(npcId) {
  const el = document.getElementById('diplo-gift-cd-' + npcId);
  if (!el) return;
  const eta = new Date(el.dataset.eta);
  const ms = eta.getTime() - Date.now();
  if (ms <= 0) {
    // Cooldown has expired — re-render so the gift tiles re-enable.
    _refreshDiplomacyPanel();
    return;
  }
  const hrs = Math.max(0, Math.ceil(ms / 3600000));
  el.textContent = '⏳ Next gift in ' + hrs + 'h';
  setTimeout(() => _tickGiftCooldown(npcId), 60000);
}
