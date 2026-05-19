// ── Settlement Tier Upgrade System ──

const TIER_EMOJI = { camp: '🏕', village: '🏘', town: '🏙', city: '🏯' };
const TIER_COLORS = { camp: '#8b7355', village: '#5d8a4a', town: '#4a6b8a', city: '#8a4a6b' };
const RES_ICONS = { food: '🌿', timber: '🪵', stone: '⬜', metal: '🟡', wealth: '🟠' };

let tierData = null;

async function loadTierInfo() {
  try {
    const res = await apiFetch('/api/game/tier-info');
    if (!res.ok) return null;
    tierData = await res.json();
    return tierData;
  } catch (e) {
    console.error('loadTierInfo error:', e);
    return null;
  }
}

async function renderTierPanel() {
  const body = document.getElementById('panel-body');
  if (!body) return;

  const data = await loadTierInfo();
  if (!data) {
    body.innerHTML = '<div class="tier-error">Could not load tier info.</div>';
    return;
  }

  const currentEmoji = TIER_EMOJI[data.currentTier] || '🏕';
  const currentColor = TIER_COLORS[data.currentTier] || '#8b7355';

  if (data.isMaxTier) {
    body.innerHTML = `
      <div class="tier-panel">
        <div class="tier-current">
          <div class="tier-badge" style="background:${currentColor}22;border-color:${currentColor}55">
            <span class="tier-badge-emoji">${currentEmoji}</span>
            <div class="tier-badge-info">
              <div class="tier-badge-name" style="color:${currentColor}">${data.currentTier.toUpperCase()}</div>
              <div class="tier-badge-sub">Maximum tier reached</div>
            </div>
          </div>
        </div>
        <div class="tier-maxed-msg">🏆 Your settlement has reached its greatest form — a mighty City in the woodland realm.</div>
      </div>
    `;
    return;
  }

  const reqs = data.requirements;
  const met = data.requirementsMet;
  const curr = met.current;
  const nextEmoji = TIER_EMOJI[data.nextTier] || '🏘';
  const nextColor = TIER_COLORS[data.nextTier] || '#5d8a4a';

  // Resource rows
  const resRows = Object.entries(reqs.resources).map(([r, need]) => {
    const have = curr[r] || 0;
    const ok = have >= need;
    const pct = Math.min(100, Math.round((have / need) * 100));
    return `
      <div class="tier-req-row ${ok ? 'req-met' : 'req-short'}">
        <span class="tier-req-icon">${RES_ICONS[r] || r}</span>
        <div class="tier-req-info">
          <div class="tier-req-progress-bar">
            <div class="tier-req-fill" style="width:${pct}%;background:${ok ? '#7bc67e' : '#e07b39'}"></div>
          </div>
        </div>
        <div class="tier-req-nums">
          <span class="${ok ? 'req-num-ok' : 'req-num-short'}">${Math.floor(have).toLocaleString()}</span>
          <span class="req-num-sep">/</span>
          <span class="req-num-need">${need.toLocaleString()}</span>
        </div>
        ${ok ? '<span class="req-check">✓</span>' : '<span class="req-x">✗</span>'}
      </div>
    `;
  }).join('');

  const popOk = met.population;
  const popPct = Math.min(100, Math.round((curr.population / reqs.population) * 100));
  const bldOk = met.buildings;
  const bldPct = Math.min(100, Math.round((curr.buildings / reqs.buildings) * 100));

  const unlockHtml = reqs.unlocks.length
    ? `<div class="tier-unlocks"><div class="tier-unlocks-label">Unlocks</div>${reqs.unlocks.map(u => `<span class="tier-unlock-chip">${u.replace(/_/g,' ')}</span>`).join('')}</div>`
    : '';

  body.innerHTML = `
    <div class="tier-panel">
      <div class="tier-current-row">
        <div class="tier-badge-sm" style="background:${currentColor}22;border-color:${currentColor}55">
          <span>${currentEmoji}</span>
          <span style="color:${currentColor};font-weight:600;text-transform:capitalize">${data.currentTier}</span>
        </div>
        <div class="tier-arrow">→</div>
        <div class="tier-badge-sm" style="background:${nextColor}22;border-color:${nextColor}55">
          <span>${nextEmoji}</span>
          <span style="color:${nextColor};font-weight:600;text-transform:capitalize">${data.nextTier}</span>
        </div>
      </div>

      <div class="tier-desc">${reqs.desc}</div>

      <div class="tier-reqs-section">
        <div class="tier-reqs-label">Resources required</div>
        ${resRows}
      </div>

      <div class="tier-reqs-section" style="margin-top:6px">
        <div class="tier-reqs-label">Other requirements</div>
        <div class="tier-req-row ${popOk ? 'req-met' : 'req-short'}">
          <span class="tier-req-icon">👥</span>
          <div class="tier-req-info">
            <div class="tier-req-progress-bar">
              <div class="tier-req-fill" style="width:${popPct}%;background:${popOk ? '#7bc67e' : '#e07b39'}"></div>
            </div>
          </div>
          <div class="tier-req-nums">
            <span class="${popOk ? 'req-num-ok' : 'req-num-short'}">${curr.population}</span>
            <span class="req-num-sep">/</span>
            <span class="req-num-need">${reqs.population} citizens</span>
          </div>
          ${popOk ? '<span class="req-check">✓</span>' : '<span class="req-x">✗</span>'}
        </div>
        <div class="tier-req-row ${bldOk ? 'req-met' : 'req-short'}">
          <span class="tier-req-icon">🏗</span>
          <div class="tier-req-info">
            <div class="tier-req-progress-bar">
              <div class="tier-req-fill" style="width:${bldPct}%;background:${bldOk ? '#7bc67e' : '#e07b39'}"></div>
            </div>
          </div>
          <div class="tier-req-nums">
            <span class="${bldOk ? 'req-num-ok' : 'req-num-short'}">${curr.buildings}</span>
            <span class="req-num-sep">/</span>
            <span class="req-num-need">${reqs.buildings} buildings</span>
          </div>
          ${bldOk ? '<span class="req-check">✓</span>' : '<span class="req-x">✗</span>'}
        </div>
      </div>

      ${unlockHtml}

      <button class="tier-upgrade-btn ${data.canUpgrade ? 'can-upgrade' : 'cannot-upgrade'}"
              onclick="doTierUpgrade()"
              ${data.canUpgrade ? '' : 'disabled'}>
        ${data.canUpgrade ? `${nextEmoji} Upgrade to ${data.nextTierLabel}` : `Requirements not yet met`}
      </button>
      ${!data.canUpgrade ? '<div class="tier-hint">Grow your settlement to unlock this upgrade.</div>' : ''}
    </div>
  `;
}

async function doTierUpgrade() {
  const btn = document.querySelector('.tier-upgrade-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Upgrading...'; }

  try {
    const res = await apiFetch('/api/game/upgrade-tier', { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      showBuildToast(data.error || 'Upgrade failed.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
      return;
    }

    // Update local gameData
    if (gameData?.settlement) {
      gameData.settlement.tier = data.newTier;
    }

    // Celebration toast
    showBuildToast(`🎉 ${data.newTierLabel} achieved! Your settlement grows!`, 'success');

    // Play sound
    if (typeof pageTurnAudio !== 'undefined') {
      pageTurnAudio.currentTime = 0;
      pageTurnAudio.play().catch(() => {});
    }

    // Show big celebration modal
    showTierCelebration(data);

    // Refresh everything
    await refreshResources();
    await loadBuildings();
    await renderTierPanel();

  } catch (e) {
    console.error('doTierUpgrade error:', e);
    showBuildToast('Upgrade failed. Try again.', 'error');
    if (btn) { btn.disabled = false; }
  }
}

function showTierCelebration(data) {
  let modal = document.getElementById('tier-celebration-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tier-celebration-modal';
    modal.className = 'tier-celebration-backdrop';
    modal.innerHTML = `
      <div class="tier-celebration-box">
        <div class="tier-cel-emoji" id="tier-cel-emoji"></div>
        <div class="tier-cel-title" id="tier-cel-title"></div>
        <div class="tier-cel-sub" id="tier-cel-sub"></div>
        <div class="tier-cel-unlocks" id="tier-cel-unlocks"></div>
        <button class="tier-cel-close" onclick="closeTierCelebration()">Continue your reign →</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const emoji = TIER_EMOJI[data.newTier] || '🏘';
  document.getElementById('tier-cel-emoji').textContent = emoji;
  document.getElementById('tier-cel-title').textContent = `${data.newTierLabel} Achieved!`;
  document.getElementById('tier-cel-sub').textContent =
    `Your settlement has grown into a ${data.newTierLabel}. New possibilities await.`;

  const unlockHtml = data.unlocks?.length
    ? `<div class="tier-cel-unlocks-label">Newly unlocked:</div>` +
      data.unlocks.map(u => `<span class="tier-cel-chip">${u.replace(/_/g,' ')}</span>`).join('')
    : '';
  document.getElementById('tier-cel-unlocks').innerHTML = unlockHtml;

  modal.classList.add('open');

  // Auto-launch particles
  if (typeof launchParticles === 'function') launchParticles();
}

function closeTierCelebration() {
  document.getElementById('tier-celebration-modal')?.classList.remove('open');
}

// ── Tier Upgrade Modal ─────────────────────────────────────────────────────
async function openTierUpgradeModal() {
  const modal = document.getElementById('tier-upgrade-modal');
  const body  = document.getElementById('tier-upgrade-modal-body');
  if (!modal || !body) return;

  modal.style.display = 'flex';
  body.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(192,221,151,.4)">Loading…</div>';

  // Temporarily redirect panel-body writes to the modal body
  const origPanelBody = document.getElementById('panel-body');
  const fakeBody = body;

  const data = await loadTierInfo();
  if (!data) { body.innerHTML = '<div style="padding:24px;color:#e07a6a">Could not load tier info.</div>'; return; }

  // Render into modal using existing tier render logic
  // Build the same HTML as renderTierPanel but target modal body
  const currentEmoji = TIER_EMOJI[data.currentTier] || '🏕';
  const currentColor = TIER_COLORS[data.currentTier] || '#8b7355';
  const nextEmoji    = TIER_EMOJI[data.nextTier] || '🏘';
  const nextColor    = TIER_COLORS[data.nextTier] || '#5d8a4a';

  // requirements = {resources:{food:800,timber:600,...}, population:20, buildings:3}
  const RES_ICON_MAP  = { food:'🌿', timber:'🪵', stone:'⛏', metal:'⚙️', wealth:'🪙', population:'👥', buildings:'🏗' };
  const RES_LABEL_MAP = { food:'Food', timber:'Timber', stone:'Stone', metal:'Metal', wealth:'Wealth', population:'Population', buildings:'Buildings' };
  const current = data.requirementsMet?.current || {};
  const reqs    = data.requirements || {};

  const makeReqRow = (key, required, cur) => {
    const pct = Math.min(100, Math.round((cur / required) * 100));
    const met = cur >= required;
    return `<div class="tier-req-row">
      <span class="tier-req-label">${RES_ICON_MAP[key]||'·'} ${RES_LABEL_MAP[key]||key}</span>
      <div class="tier-req-bar-wrap"><div class="tier-req-bar ${met?'met':''}" style="width:${pct}%"></div></div>
      <span class="tier-req-nums ${met?'met':''}">${Math.floor(cur).toLocaleString()} / ${Number(required).toLocaleString()}</span>
    </div>`;
  };

  let reqHtml = '';
  // Resources sub-object
  if (reqs.resources) {
    Object.entries(reqs.resources).forEach(([k, v]) => { reqHtml += makeReqRow(k, v, current[k] ?? 0); });
  }
  if (reqs.population) reqHtml += makeReqRow('population', reqs.population, current.population ?? 0);
  if (reqs.buildings)  reqHtml += makeReqRow('buildings',  reqs.buildings,  current.buildings  ?? 0);

  const unlockHtml = (data.unlocks || []).length
    ? '<div class="tier-unlocks-title">Unlocks</div>'
      + data.unlocks.map(u => `<div class="tier-unlock-item">✦ ${u}</div>`).join('')
    : '';

  body.innerHTML = `
    <div class="tier-panel" style="padding:0">
      <div class="tier-current-section">
        <div class="tier-badge" style="background:${currentColor}22;border-color:${currentColor}44">
          <div class="tier-badge-emoji">${currentEmoji}</div>
          <div class="tier-badge-name" style="color:${currentColor}">${data.currentTier.toUpperCase()}</div>
        </div>
        <div style="flex:1">
          <div style="font-size:11px;color:rgba(192,221,151,.4);margin-bottom:2px">Current Tier</div>
          <div style="font-size:15px;font-weight:700;color:#f0e8c8">${data.currentTierLabel || data.currentTier}</div>
        </div>
      </div>
      ${data.nextTier ? `
      <div class="tier-arrow">↓ Upgrade Path</div>
      <div class="tier-next-section">
        <div class="tier-badge" style="background:${nextColor}22;border-color:${nextColor}44">
          <div class="tier-badge-emoji">${nextEmoji}</div>
          <div class="tier-badge-name" style="color:${nextColor}">${data.nextTier.toUpperCase()}</div>
        </div>
        <div style="flex:1">
          <div style="font-size:11px;color:rgba(192,221,151,.4);margin-bottom:2px">Next Tier</div>
          <div style="font-size:15px;font-weight:700;color:#f0e8c8">${data.nextTierLabel || data.nextTier}</div>
        </div>
      </div>
      <div class="tier-requirements">${reqHtml}</div>
      ${unlockHtml}
      <button class="tier-upgrade-btn ${data.canUpgrade ? 'can-upgrade' : 'cannot-upgrade'}"
              onclick="doTierUpgradeFromModal()"
              ${data.canUpgrade ? '' : 'disabled'}>
        ${data.canUpgrade ? `${nextEmoji} Upgrade to ${data.nextTierLabel}` : 'Requirements not met'}
      </button>
      ` : '<div style="text-align:center;padding:16px;color:rgba(192,221,151,.4)">Maximum tier reached.</div>'}
    </div>`;
}

function closeTierUpgradeModal() {
  const modal = document.getElementById('tier-upgrade-modal');
  if (modal) modal.style.display = 'none';
}

async function doTierUpgradeFromModal() {
  const btn = document.querySelector('#tier-upgrade-modal .tier-upgrade-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Upgrading…'; }
  try {
    const res = await apiFetch('/api/game/upgrade-tier', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showBuildToast(data.error || 'Upgrade failed.', 'error'); if(btn){btn.disabled=false;btn.textContent='Try again';} return; }
    if (gameData?.settlement) gameData.settlement.tier = data.newTier;
    showBuildToast('🎉 ' + data.newTierLabel + ' achieved!', 'success');
    showTierCelebration(data);
    closeTierUpgradeModal();
    await refreshResources();
    await loadBuildings();
    if (window._lastSelectedTile) selectWorldTile(window._lastSelectedTile);
  } catch(e) { showBuildToast('Upgrade failed.', 'error'); if(btn){btn.disabled=false;} }
}
