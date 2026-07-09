// Destination: js/profile.js
// Changes in this version:
//  • renderHonors() stub for the achievement honors strip + trophy cabinet
//    (shows zeros/empty pedestals until the achievements API ships —
//    flip PROFILE_HONORS_LIVE to true when /api/achievements/summary exists)
//  • BUGFIX: viewPlayerProfile no longer clobbers server settlement data —
//    the fallback (sidebar params) renders first, server data overwrites it
//  • escHtml() applied to all user-supplied strings injected via innerHTML
//    (settlement names and usernames are player input)

// ── Utilities ─────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Achievement honors (strip + trophy cabinet) ──────────────────────────
// Flip to true once the achievement system's summary endpoint exists.
// Expected shape: { points, completion, trophies, title,
//                   cabinet: [{ icon, name }] }  (cabinet max 3)
const PROFILE_HONORS_LIVE = false;

async function renderHonors(prefix, username) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  // Placeholder state — zeros, empty pedestals (already in the HTML)
  set(`${prefix}-honor-points`, '0');
  set(`${prefix}-honor-completion`, '0%');
  set(`${prefix}-honor-trophies`, '0');

  if (!PROFILE_HONORS_LIVE || !username) return;

  try {
    const res = await apiFetch(`/api/achievements/summary/${encodeURIComponent(username)}`);
    if (!res.ok) return;
    const d = await res.json();

    set(`${prefix}-honor-points`, d.points ?? 0);
    set(`${prefix}-honor-completion`, `${d.completion ?? 0}%`);
    set(`${prefix}-honor-trophies`, d.trophies ?? 0);

    // Title under the username
    const titleEl = document.getElementById(`${prefix}-title`);
    if (titleEl && d.title) {
      titleEl.textContent = `✦ ${d.title}`;
      titleEl.hidden = false;
    }

    // Trophy cabinet — fill up to 3 pedestals
    const cab = document.getElementById(`${prefix}-cabinet`);
    if (cab && Array.isArray(d.cabinet) && d.cabinet.length) {
      const slots = [...d.cabinet.slice(0, 3)];
      while (slots.length < 3) slots.push(null);
      cab.innerHTML = slots.map(t => t
        ? `<div class="pm-cabinet-slot filled" title="${escHtml(t.name)}">${escHtml(t.icon || '🏆')}</div>`
        : `<div class="pm-cabinet-slot empty">✦</div>`
      ).join('');
      const hint = cab.parentElement?.querySelector('.pm-cabinet-hint');
      if (hint) hint.remove();
    }
  } catch (e) { /* honors are decorative — fail silently */ }
}

// ── Open own profile ──────────────────────────────────────────────────────

// openProfileForUser — wraps viewPlayerProfile for use from the map sidebar
async function openProfileForUser(username, species, settlementName, tier, tileX, tileY) {
  if (!username) { openProfile(); return; }
  if (gameData && gameData.username === username) { openProfile(); return; }
  viewPlayerProfile(username, species || '', settlementName || '', tier || 'village', tileX || 0, tileY || 0);
}

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

    // Honors strip (placeholder until achievements ship)
    renderHonors('pm', username);

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

function renderSettlementCard(name, meta, tier) {
  const emoji = TIER_EMOJI[tier] || '🏕';
  return `
    <div class="pm-settlement-card">
      <span class="pm-settlement-emoji">${emoji}</span>
      <div class="pm-settlement-info">
        <div class="pm-settlement-name">${escHtml(name)}</div>
        <div class="pm-settlement-meta">${escHtml(meta)}</div>
      </div>
    </div>
  `;
}

function renderOwnSettlements() {
  const container = document.getElementById('pm-settlements');
  if (!container || !gameData?.settlement) return;
  const s = gameData.settlement;
  container.innerHTML = renderSettlementCard(
    s.name,
    `${s.tier} · ${gameData.species} · tile (${s.tile_x}, ${s.tile_y})`,
    s.tier
  );
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
  const vpTitle = document.getElementById('vp-title');
  if (vpTitle) { vpTitle.hidden = true; vpTitle.textContent = ''; }

  // Fallback settlement card from sidebar params — rendered FIRST so
  // server data (fresher, includes live population) can overwrite it
  document.getElementById('vp-settlements').innerHTML = renderSettlementCard(
    settlementName || `${username}'s Settlement`,
    `${tier} · ${species} · tile (${tileX}, ${tileY})`,
    tier
  );

  // Honors strip
  renderHonors('vp', username);

  // Fetch bio and profile from server
  document.getElementById('vp-bio').textContent = 'Loading…';
  try {
    const res = await apiFetch(`/api/auth/profile/${encodeURIComponent(username)}`);
    if (res.ok) {
      const data = await res.json();
      document.getElementById('vp-bio').textContent = data.bio || 'This ruler keeps their own counsel.';
      // Server settlement data overrides the sidebar fallback
      if (data.settlement) {
        document.getElementById('vp-settlements').innerHTML = renderSettlementCard(
          data.settlement.name,
          `${data.settlement.tier} · ${data.species} · ${data.settlement.population} citizens`,
          data.settlement.tier
        );
      }
    } else {
      document.getElementById('vp-bio').textContent = 'This ruler keeps their own counsel.';
    }
  } catch(e) {
    document.getElementById('vp-bio').textContent = 'This ruler keeps their own counsel.';
  }

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
