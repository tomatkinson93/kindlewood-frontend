// ── Season display system ──

let currentSeason = null;
let seasonTickInterval = null;

const SEASON_COLORS = {
  spring: { bg: '#1a2e1a', accent: '#7bc67e', text: '#c0dd97' },
  summer: { bg: '#2e2a0e', accent: '#f5c518', text: '#fac775' },
  autumn: { bg: '#2e1a0e', accent: '#e07b39', text: '#e8a87c' },
  winter: { bg: '#0e1a2e', accent: '#7eb8e0', text: '#b8d4f0' },
};

const SEASON_EFFECTS = {
  spring: ['🌾 Farming +20%', '👶 Birth chance +10%'],
  summer: ['🌾 Farming +30%', '🌿 Gathering +20%', '💰 Wealth +10%'],
  autumn: ['🌾 Farming +10%', '🪵 Timber +10%', '📦 Storage bonus'],
  winter: ['🌾 Farming -60%', '🪵 Wood use +50%', '🍖 Food use +20%'],
};

function calcCurrentSeason() {
  const SEASON_DURATION_MS = 6 * 60 * 60 * 1000;
  const YEAR_DURATION_MS = 24 * 60 * 60 * 1000;
  const SEASON_IDS = ['spring','summer','autumn','winter'];
  const SEASON_NAMES = ['Spring','Summer','Autumn','Winter'];
  const SEASON_EMOJIS = ['🌸','☀️','🍂','❄️'];
  const SEASON_FLAVORS = [
    'New growth stirs in the woodland.',
    'Long days and warm sun — peak harvest.',
    'The harvest is in. Prepare for the cold.',
    'Harsh cold grips the realm. Guard your stores.',
  ];
  const now = Date.now();
  const msIntoDay = now % YEAR_DURATION_MS;
  const index = Math.floor(msIntoDay / SEASON_DURATION_MS);
  const msIntoSeason = msIntoDay % SEASON_DURATION_MS;
  const epoch = new Date('2025-01-01T00:00:00Z').getTime();
  const dayNumber = Math.floor((now - epoch) / YEAR_DURATION_MS) + 1;
  return {
    id: SEASON_IDS[index],
    name: SEASON_NAMES[index],
    emoji: SEASON_EMOJIS[index],
    flavor: SEASON_FLAVORS[index],
    index,
    progress: msIntoSeason / SEASON_DURATION_MS,
    msRemaining: SEASON_DURATION_MS - msIntoSeason,
    dayNumber,
  };
}

function initSeasons(settlementData) {
  currentSeason = settlementData?.season || calcCurrentSeason();
  renderSeasonBadge();
  startSeasonTick();
}

function startSeasonTick() {
  if (seasonTickInterval) clearInterval(seasonTickInterval);
  seasonTickInterval = setInterval(() => {
    updateSeasonProgress();
  }, 10000); // update every 10 seconds
}

function updateSeasonProgress() {
  const updated = calcCurrentSeason();
  const changed = updated.index !== currentSeason?.index;
  currentSeason = updated;
  if (changed && typeof refreshResources === 'function') refreshResources();
  // Map renderer hook (Phase 5): on a season flip, invalidate the season-
  // dependent map layers (decor variants, palettes). Guarded — the KWMap
  // controller may not exist on older deploys. renderSeasonBadge below also
  // swaps the season CSS class, which the iso renderer reads for grading.
  if (changed && window.KWMap && KWMap.controller && KWMap.controller.invalidate) {
    try { KWMap.controller.invalidate('season'); } catch (e) {}
  }
  renderSeasonBadge();
  renderSeasonPanel();
}

function applySeasonFilter() {
  const screen = document.getElementById('screen-game');
  if (!screen || !currentSeason) return;
  screen.classList.remove('season-spring','season-summer','season-autumn','season-winter');
  screen.classList.add(`season-${currentSeason.id}`);
}

function renderSeasonBadge() {
  const badge = document.getElementById('season-badge');
  if (!badge || !currentSeason) return;
  applySeasonFilter();

  const colors = SEASON_COLORS[currentSeason.id] || SEASON_COLORS.spring;
  const pct = Math.round(currentSeason.progress * 100);

  badge.innerHTML = `
    <div class="season-badge-inner" style="--season-accent:${colors.accent}" onclick="toggleSeasonPanel()">
      <div class="season-badge-row">
        <span class="season-emoji">${currentSeason.emoji}</span>
        <span class="season-name">${currentSeason.name}</span>
        <span class="season-day">Yr ${currentSeason.dayNumber}</span>
      </div>
      <div class="season-progress-bar">
        <div class="season-progress-fill" style="width:${pct}%;background:${colors.accent}"></div>
      </div>
    </div>
  `;
}

let seasonPanelOpen = false;

function toggleSeasonPanel() {
  seasonPanelOpen = !seasonPanelOpen;
  const panel = document.getElementById('season-panel');
  if (!panel) return;
  if (seasonPanelOpen) {
    renderSeasonPanel();
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
  }
}

function renderSeasonPanel() {
  const panel = document.getElementById('season-panel');
  if (!panel || !currentSeason || !seasonPanelOpen) return;

  const colors = SEASON_COLORS[currentSeason.id] || SEASON_COLORS.spring;
  const remaining = formatSeasonTime(currentSeason.msRemaining);
  const pct = Math.round(currentSeason.progress * 100);
  const effects = SEASON_EFFECTS[currentSeason.id] || [];
  const seasons = ['spring','summer','autumn','winter'];
  const nextId = seasons[(currentSeason.index + 1) % 4];
  const NEXT_EFFECTS = SEASON_EFFECTS[nextId] || [];
  const nextEmoji = { spring:'🌸', summer:'☀️', autumn:'🍂', winter:'❄️' }[nextId];
  const nextName = { spring:'Spring', summer:'Summer', autumn:'Autumn', winter:'Winter' }[nextId];

  panel.innerHTML = `
    <div class="season-panel-inner" onclick="event.stopPropagation()">
      <div class="sp-header">
        <div class="sp-title">
          <span class="sp-emoji">${currentSeason.emoji}</span>
          <div>
            <div class="sp-season-name" style="color:${colors.accent}">${currentSeason.name}</div>
            <div class="sp-flavor">${currentSeason.flavor}</div>
          </div>
        </div>
        <button class="sp-close" onclick="toggleSeasonPanel()">✕</button>
      </div>

      <div class="sp-progress-section">
        <div class="sp-progress-labels">
          <span>Season progress</span>
          <span>${remaining} until ${nextEmoji} ${nextName}</span>
        </div>
        <div class="sp-progress-track">
          <div class="sp-progress-fill" style="width:${pct}%;background:${colors.accent}"></div>
        </div>
      </div>

      <div class="sp-two-col">
        <div class="sp-col">
          <div class="sp-effects-label">${currentSeason.emoji} ${currentSeason.name} effects</div>
          ${effects.map(e => `<div class="sp-effect">${e}</div>`).join('')}
        </div>
        <div class="sp-col">
          <div class="sp-effects-label">${nextEmoji} Coming: ${nextName}</div>
          ${NEXT_EFFECTS.map(e => `<div class="sp-effect sp-effect-next">${e}</div>`).join('')}
        </div>
      </div>

      <div class="sp-day">
        <span>📅 Year ${currentSeason.dayNumber}</span>
        <span class="sp-day-note">1 real day = 1 in-game year</span>
      </div>

      <div class="sp-settings">
        <div class="sp-settings-label">✦ Map &amp; Atmosphere</div>
        <label class="sp-toggle sp-select-row" data-kwmap-row>
          <span>Map view</span>
          <select class="sp-select" data-kwmap-view>
            <option value="topdown">Top-Down</option>
            <option value="iso">Isometric</option>
          </select>
        </label>
        <label class="sp-toggle" data-kwmap-row>
          <input type="checkbox" data-kwmap-setting="lowdetail">
          <span>Reduce map detail</span>
        </label>
        <label class="sp-toggle" data-atmo-row>
          <input type="checkbox" data-atmo-setting="atmosphere">
          <span>Seasonal colour grading</span>
        </label>
        <label class="sp-toggle" data-atmo-row>
          <input type="checkbox" data-atmo-setting="particles">
          <span>Seasonal particles</span>
        </label>
      </div>
    </div>
  `;

  // ── Map view + performance (KWMap) — data-* + re-wire-on-render, guarded ──
  // Same pattern as the atmosphere toggles: the panel HTML is regenerated every
  // render, so read current state and attach fresh listeners each time.
  if (window.KWMap && window.KWMap.controller) {
    const sel = panel.querySelector('[data-kwmap-view]');
    if (sel) {
      sel.value = window.KWMap.controller.activeId || 'topdown';
      sel.addEventListener('change', () => {
        // setRenderer keeps the shared camera {q,r} → focus preserved (§12.9),
        // persists kw_map_view, invalidates + renders one frame.
        window.KWMap.controller.setRenderer(sel.value);
      });
    }
    const low = panel.querySelector('[data-kwmap-setting="lowdetail"]');
    if (low && window.KWMap.perf) {
      low.checked = !!window.KWMap.perf.lowDetail;
      low.addEventListener('change', () => window.KWMap.perf.setLowDetail(low.checked));
    } else if (low) {
      const row = low.closest('.sp-toggle'); if (row) row.style.display = 'none';
    }
  } else {
    panel.querySelectorAll('[data-kwmap-row]').forEach(el => { el.style.display = 'none'; });
  }

  // ── Atmosphere toggles (existing) ─────────────────────────────────────────
  if (window.SeasonAtmosphere) {
    const st = window.SeasonAtmosphere.settings;
    panel.querySelectorAll('[data-atmo-setting]').forEach(input => {
      const key = input.dataset.atmoSetting;
      input.checked = !!st[key];
      input.addEventListener('change', () => {
        if (key === 'atmosphere') window.SeasonAtmosphere.setAtmosphere(input.checked);
        else window.SeasonAtmosphere.setParticles(input.checked);
      });
    });
  } else {
    panel.querySelectorAll('[data-atmo-row]').forEach(el => { el.style.display = 'none'; });
  }
}

function formatSeasonTime(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Close panel when clicking backdrop
document.getElementById('season-panel')?.addEventListener('click', () => {
  seasonPanelOpen = false;
  document.getElementById('season-panel')?.classList.remove('open');
});

// Show season badge immediately on page load
document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('season-badge');
  if (badge) {
    currentSeason = calcCurrentSeason();
    renderSeasonBadge();
    startSeasonTick();
  }
});
