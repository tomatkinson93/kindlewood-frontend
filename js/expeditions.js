// ── Expedition system ──

let activeExpeditions = [];
let expeditionPollTimer = null;
let pendingScoutTarget = null; // { x, y } waiting for scout selection

function selectFogTile(wx, wy) {
  // Store globally so selection survives map re-renders
  if (typeof _selectedFogTile !== 'undefined') _selectedFogTile = { wx, wy };
  // Clear previous and highlight clicked
  document.querySelectorAll('.tile-fog.selected-fog').forEach(el => el.classList.remove('selected-fog'));
  const clicked = document.querySelector(`.tile-fog[data-wx="${wx}"][data-wy="${wy}"]`);
  if (clicked) clicked.classList.add('selected-fog');

  const title = document.getElementById('panel-title');
  const sub   = document.getElementById('panel-sub');
  const body  = document.getElementById('panel-body');
  if (!title || !sub || !body) return;

  // Update panel directly without switching tab (avoids camera snap)
  showMapPanel();
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  const settlementTab = document.getElementById('tab-settlement');
  if (settlementTab) settlementTab.classList.add('active');

  title.textContent = 'Unexplored Territory';
  sub.textContent = `(${wx}, ${wy}) · Fog of war`;

  const settlement = gameData?.settlement;
  const size = worldMapData?.mapSize || 40;
  let dx = wx - (settlement?.tile_x || 0);
  let dy = wy - (settlement?.tile_y || 0);
  if (Math.abs(dx) > size/2) dx = dx > 0 ? dx - size : dx + size;
  if (Math.abs(dy) > size/2) dy = dy > 0 ? dy - size : dy + size;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));

  // Get available scouts (role=scout, not on expedition)
  const scouts = (citizensData || []).filter(c =>
    c.role === 'scout' && !c.expedition
  );

  const scoutOptions = scouts.length
    ? scouts.map(c => {
        const skill = c.skills?.scouting || 1;
        const bonus = Math.round((skill - 1) * 4);
        const estSec = Math.max(10, Math.round((dist * 14) / (1 + (skill-1)*0.04)));
        return `<option value="${c.id}">${c.name} (Scout skill ${skill}${bonus > 0 ? ` · ${bonus}% faster` : ''}) · ~${formatDuration(estSec)}</option>`;
      }).join('')
    : '<option value="" disabled>No scouts available</option>';

  const hasScouts = scouts.length > 0;

  body.innerHTML = `
    <div class="fog-panel">
      <div class="fog-panel-icon">🌫</div>
      <div class="fog-panel-title">Unknown lands</div>
      <div class="fog-panel-desc">Your scouts have not ventured here. Send an expedition to reveal what lies beyond the mist.</div>
      <div class="fog-stats">
        <div class="fog-stat"><span class="fog-stat-key">Distance</span><span class="fog-stat-val">~${dist} tiles</span></div>
      </div>

      <div class="scout-select-section">
        <div class="scout-select-label">Choose a scout</div>
        <select class="scout-select" id="scout-picker" ${!hasScouts ? 'disabled' : ''}>
          ${scoutOptions}
        </select>
        ${!hasScouts ? `<div class="scout-hint">Assign citizens as <strong>Scouts</strong> in the Citizens tab to send expeditions.</div>` : ''}
      </div>

      <button class="btn-send-scout" onclick="sendScout(${wx}, ${wy})" ${!hasScouts ? 'disabled' : ''}>
        🗺 Dispatch Scout
      </button>
      ${!hasScouts ? '' : '<div class="fog-note">Scout skill reduces travel time · Scout Post Lv+ helps too</div>'}
    </div>
  `;
}

async function sendScout(tx, ty) {
  const btn = document.querySelector('.btn-send-scout');
  const picker = document.getElementById('scout-picker');
  const citizenId = picker?.value ? parseInt(picker.value) : null;

  if (!citizenId) { showBuildToast('Select a scout first.', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Dispatching...'; }

  try {
    const res = await apiFetch('/api/expeditions/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_x: tx, target_y: ty, citizen_id: citizenId }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (btn) { btn.disabled = false; btn.textContent = '🗺 Dispatch Scout'; }
      showBuildToast(data.error || 'Could not send scout.', 'error');
      return;
    }

    const dur = formatDuration(data.seconds);
    showBuildToast(`${data.citizenName} dispatched! Returns in ${dur}`, 'success');

    // Update panel
    const body = document.getElementById('panel-body');
    if (body) {
      body.innerHTML = `
        <div class="fog-panel">
          <div class="fog-panel-icon">🗺</div>
          <div class="fog-panel-title">${data.citizenName} is scouting</div>
          <div class="fog-panel-desc">Heading to (${tx}, ${ty}) through ${data.tiles} tiles of wilderness.</div>
          <div class="fog-stats">
            <div class="fog-stat"><span class="fog-stat-key">Returns in</span>
            <span class="fog-stat-val" id="exp-countdown-${data.expedition.id}">${dur}</span></div>
          </div>
        </div>
      `;
    }

    activeExpeditions.push(data.expedition);
    // Mark citizen locally as on expedition so list updates
    const c = (citizensData || []).find(c => c.id === citizenId);
    if (c) c.expedition = { target_x: tx, target_y: ty, completes_at: data.expedition.completes_at };
    renderCitizensList();
    startExpeditionPoll();
  } catch (e) {
    console.error(e);
    if (btn) { btn.disabled = false; btn.textContent = '🗺 Dispatch Scout'; }
  }
}

async function loadExpeditions() {
  try {
    const res = await apiFetch('/api/expeditions');
    if (!res.ok) return;
    const data = await res.json();
    const prev = activeExpeditions.length;
    activeExpeditions = data.expeditions || [];

    // Sync expedition status back onto citizensData
    const expByCitizen = {};
    activeExpeditions.forEach(e => { if (e.citizen_id) expByCitizen[e.citizen_id] = e; });
    (citizensData || []).forEach(c => {
      c.expedition = expByCitizen[c.id] || null;
    });

    if (prev > activeExpeditions.length && prev > 0) {
      await loadWorldMap();
      const returned = prev - activeExpeditions.length;
      showBuildToast(`Scout${returned > 1 ? 's' : ''} returned! New lands revealed. 🗺`, 'success');
      renderCitizensList();
    }

    updateExpeditionCountdowns();
    renderExpeditionBadge();
  } catch(e) {}
}

function startExpeditionPoll() {
  if (expeditionPollTimer) return;
  expeditionPollTimer = setInterval(async () => {
    await loadExpeditions();
    if (activeExpeditions.length === 0) {
      clearInterval(expeditionPollTimer);
      expeditionPollTimer = null;
    }
  }, 5000);
}

function updateExpeditionCountdowns() {
  for (const exp of activeExpeditions) {
    const el = document.getElementById(`exp-countdown-${exp.id}`);
    if (!el) continue;
    const remaining = new Date(exp.completes_at) - Date.now();
    el.textContent = remaining > 0 ? formatDuration(Math.ceil(remaining / 1000)) : 'Returning...';
  }
}

function renderExpeditionBadge() {
  const badge = document.getElementById('expedition-badge');
  if (!badge) return;
  if (activeExpeditions.length > 0) {
    badge.textContent = `🗺 ${activeExpeditions.length} scout${activeExpeditions.length > 1 ? 's' : ''} out`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

async function cheatRevealAll() {
  const res = await apiFetch('/api/expeditions/reveal-all', { method: 'POST' });
  const data = await res.json();
  if (data.ok) { showBuildToast(`All ${data.revealed} tiles revealed!`, 'success'); await loadWorldMap(); }
}

async function cheatResetFog() {
  const res = await apiFetch('/api/expeditions/reset-fog', { method: 'POST' });
  if ((await res.json()).ok) { showBuildToast('Fog of war reset.', 'success'); await loadWorldMap(); }
}
