// ── Profile System ──

const TIER_EMOJI_P = { camp:'🏕', village:'🏘', town:'🏙', city:'🏯' };

// ── Profile dropdown ──────────────────────────────────────────────────────

function toggleProfileMenu() {
  const wrap = document.getElementById('profile-dropdown-wrap');
  wrap.classList.toggle('open');
}

function closeProfileMenu() {
  document.getElementById('profile-dropdown-wrap')?.classList.remove('open');
}

// Close on outside click
document.addEventListener('click', e => {
  const wrap = document.getElementById('profile-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) closeProfileMenu();
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeProfileMenu();
});

// Called from loadGame() to set the username in the trigger button
function initProfileDisplay(username, species) {
  const label = document.getElementById('profile-username-label');
  const mini  = document.getElementById('profile-avatar-mini');
  if (label) label.textContent = username || '—';
  if (mini)  mini.textContent  = (username || '?')[0].toUpperCase();
}

// ── Own Profile modal ─────────────────────────────────────────────────────

let profileData = null; // cached

async function openProfile() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  modal.classList.add('open');

  // Populate from gameData immediately
  if (gameData) {
    const username = gameData.username || '—';
    const species  = gameData.species  || '';
    document.getElementById('pm-username').textContent = username;
    document.getElementById('pm-species').textContent  = species;
    document.getElementById('pm-avatar').textContent   = username[0]?.toUpperCase() || '?';
    document.getElementById('pm-joined').textContent   = 'Realm citizen';

    // Load bio from server
    try {
      const res = await apiFetch(`/api/auth/profile/${encodeURIComponent(username)}`);
      if (res.ok) {
        const data = await res.json();
        const bioEl = document.getElementById('pm-bio');
        if (bioEl) { bioEl.value = data.bio || ''; updateBioCounter(); }
        if (data.joined) {
          const d = new Date(data.joined);
          document.getElementById('pm-joined').textContent =
            'Joined ' + d.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
        }
      }
    } catch(e) { console.error('Profile load error:', e); }

    // Settlement card
    renderOwnSettlements();

    // Stats
    loadProfileStats();
  }
}

function closeProfile() {
  document.getElementById('profile-modal')?.classList.remove('open');
}

function closeProfileIfOutside(e) {
  if (e.target === document.getElementById('profile-modal')) closeProfile();
}

function updateBioCounter() {
  const bio = document.getElementById('pm-bio');
  const counter = document.getElementById('pm-bio-count');
  if (bio && counter) counter.textContent = bio.value.length;
}

document.addEventListener('DOMContentLoaded', () => {
  const bio = document.getElementById('pm-bio');
  if (bio) bio.addEventListener('input', updateBioCounter);
});

async function saveProfile() {
  const bio = document.getElementById('pm-bio')?.value?.trim() || '';
  try {
    const res = await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio }),
    });
    if (res.ok) {
      showBuildToast('Profile saved ✓', 'success');
    } else {
      showBuildToast('Save failed.', 'error');
    }
  } catch(e) {
    showBuildToast('Could not reach server.', 'error');
  }
}

function renderOwnSettlements() {
  const container = document.getElementById('pm-settlements');
  if (!container || !gameData?.settlement) return;
  const s = gameData.settlement;
  const emoji = TIER_EMOJI_P[s.tier] || '🏕';
  container.innerHTML = `
    <div class="pm-settlement-card">
      <span class="pm-settlement-emoji">${emoji}</span>
      <div class="pm-settlement-info">
        <div class="pm-settlement-name">${s.name}</div>
        <div class="pm-settlement-meta">${s.tier} · ${gameData.species} · tile (${s.tile_x}, ${s.tile_y})</div>
      </div>
    </div>
  `;
}

async function loadProfileStats() {
  try {
    const [citRes, bldRes] = await Promise.all([
      apiFetch('/api/citizens'),
      apiFetch('/api/buildings'),
    ]);
    const citData = citRes.ok ? await citRes.json() : null;
    const bldData = bldRes.ok ? await bldRes.json() : null;

    const citizens  = citData?.citizens?.length ?? '—';
    const buildings = bldData?.buildings?.filter(b => b.currentLevel > 0).length ?? '—';
    const tier      = gameData?.settlement?.tier ?? '—';
    const exps      = (activeExpeditions?.length ?? 0);

    document.getElementById('pm-stat-citizens').textContent   = citizens;
    document.getElementById('pm-stat-buildings').textContent  = buildings;
    document.getElementById('pm-stat-tier').textContent       = tier;
    document.getElementById('pm-stat-expeditions').textContent = exps;
  } catch(e) { console.error(e); }
}

function triggerAvatarUpload() {
  // Placeholder — no file upload server yet
  showBuildToast('Avatar upload coming soon!', 'success');
}

// ── View other player profile ─────────────────────────────────────────────

async function viewPlayerProfile(username, species, settlementName, tier, tileX, tileY) {
  const modal = document.getElementById('view-profile-modal');
  if (!modal) return;

  document.getElementById('vp-username').textContent = username;
  document.getElementById('vp-species').textContent  = species || '';
  document.getElementById('vp-avatar').textContent   = (username || '?')[0].toUpperCase();

  // Fetch bio and profile from server
  document.getElementById('vp-bio').textContent = 'Loading…';
  try {
    const res = await apiFetch(`/api/auth/profile/${encodeURIComponent(username)}`);
    if (res.ok) {
      const data = await res.json();
      document.getElementById('vp-bio').textContent = data.bio || 'This ruler keeps their own counsel.';
      // Update settlement info with server data if available
      if (data.settlement) {
        const emoji = TIER_EMOJI_P[data.settlement.tier] || '🏕';
        document.getElementById('vp-settlements').innerHTML = `
          <div class="pm-settlement-card">
            <span class="pm-settlement-emoji">${emoji}</span>
            <div class="pm-settlement-info">
              <div class="pm-settlement-name">${data.settlement.name}</div>
              <div class="pm-settlement-meta">${data.settlement.tier} · ${data.species} · ${data.settlement.population} citizens</div>
            </div>
          </div>
        `;
      }
    } else {
      document.getElementById('vp-bio').textContent = 'This ruler keeps their own counsel.';
    }
  } catch(e) {
    document.getElementById('vp-bio').textContent = 'This ruler keeps their own counsel.';
  }

  // Settlement
  const emoji = TIER_EMOJI_P[tier] || '🏕';
  document.getElementById('vp-settlements').innerHTML = `
    <div class="pm-settlement-card">
      <span class="pm-settlement-emoji">${emoji}</span>
      <div class="pm-settlement-info">
        <div class="pm-settlement-name">${settlementName || username + "'s Settlement"}</div>
        <div class="pm-settlement-meta">${tier} · ${species} · tile (${tileX}, ${tileY})</div>
      </div>
    </div>
  `;

  modal.classList.add('open');
}

function closeViewProfile() {
  document.getElementById('view-profile-modal')?.classList.remove('open');
}

function closeViewProfileIfOutside(e) {
  if (e.target === document.getElementById('view-profile-modal')) closeViewProfile();
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeViewProfile();
    closeProfile();
  }
});
