// ── Season display system ──

let currentSeason = null;
let seasonTickInterval = null;

const SEASON_COLORS = {
  spring: { bg: '#1a2e1a', accent: '#7bc67e', text: '#c0dd97' },
  summer: { bg: '#2e2a0e', accent: '#f5c518', text: '#fac775' },
  autumn: { bg: '#2e1a0e', accent: '#e07b39', text: '#e8a87c' },
  winter: { bg: '#0e1a2e', accent: '#7eb8e0', text: '#b8d4f0' },
};

// What each season changes — mirrors kindlewood-server seasons.js SEASONS
// (modifiers, foodConsumption, timberConsumption, birthChanceBonus); the
// server's scripts/season_cutover_test.js asserts they match.
const SEASON_MODS = {
  spring: { modifiers: { food: 1.20, timber: 1.0, stone: 1.0,  metal: 1.0, wealth: 1.0  }, foodConsumption: 1.0,  timberConsumption: 1.0, birthChanceBonus: 0.10 },
  summer: { modifiers: { food: 1.30, timber: 1.0, stone: 1.0,  metal: 1.0, wealth: 1.10 }, foodConsumption: 1.0,  timberConsumption: 1.0, birthChanceBonus: 0 },
  autumn: { modifiers: { food: 1.10, timber: 1.10, stone: 1.0, metal: 1.0, wealth: 1.0  }, foodConsumption: 1.0,  timberConsumption: 1.0, birthChanceBonus: 0 },
  winter: { modifiers: { food: 0.40, timber: 1.0, stone: 0.90, metal: 1.0, wealth: 0.90 }, foodConsumption: 1.20, timberConsumption: 1.5, birthChanceBonus: -0.05 },
};

// SEASON_MODS in words: [{ text, good }] for the season panels.
function seasonEffectLines(id) {
  const m = SEASON_MODS[id];
  if (!m) return [];
  const pct = (x) => (x > 0 ? '+' : '−') + Math.round(Math.abs(x) * 100) + '%';
  const ICON = { food: '🌾', timber: '🪵', stone: '🪨', metal: '⛏️', wealth: '💰' };
  const NAME = { food: 'Food', timber: 'Timber', stone: 'Stone', metal: 'Metal', wealth: 'Wealth' };
  const out = [];
  for (const r of ['food', 'timber', 'stone', 'metal', 'wealth']) {
    const d = m.modifiers[r] - 1;
    if (Math.abs(d) > 1e-9) out.push({ text: ICON[r] + ' ' + NAME[r] + ' production ' + pct(d), good: d > 0 });
  }
  if (Math.abs(m.foodConsumption - 1) > 1e-9) out.push({ text: '🍖 Food eaten ' + pct(m.foodConsumption - 1), good: m.foodConsumption < 1 });
  if (Math.abs(m.timberConsumption - 1) > 1e-9) out.push({ text: '🔥 Wood burned ' + pct(m.timberConsumption - 1), good: m.timberConsumption < 1 });
  if (m.birthChanceBonus) out.push({ text: '👶 Birth chance ' + pct(m.birthChanceBonus), good: m.birthChanceBonus > 0 });
  return out;
}
const SEASON_EFFECTS = Object.fromEntries(Object.keys(SEASON_MODS).map(id => [id, seasonEffectLines(id).map(l => l.text)]));

// Spec 021 D1: 28 real hours = 1 in-game year, 4 seasons of 7 hours each.
// Before the cutover the legacy 6h/24h formula applies unchanged. Mirrors
// kindlewood-server seasons.js seasonAt exactly — keep in step (the server's
// scripts/season_cutover_test.js loads this file and asserts parity).
const SEASON_HOUR_MS        = 60 * 60 * 1000;
const SEASON_DURATION_MS    = 7 * SEASON_HOUR_MS;
const SEASON_YEAR_MS        = 28 * SEASON_HOUR_MS;
const SEASON_LEGACY_MS      = 6 * SEASON_HOUR_MS;
const SEASON_LEGACY_YEAR_MS = 24 * SEASON_HOUR_MS;
const SEASON_CUTOVER_MS     = Date.parse('2026-11-02T00:00:00Z');
const SEASON_YEAR_EPOCH_MS  = Date.parse('2025-01-01T00:00:00Z');

// The one place the season clock is read: the server-synced wall clock when
// KWClock is loaded (never the dev visual override — seasons are economy).
function _seasonNow() {
  return (window.KWClock && typeof KWClock.wallNow === 'function') ? KWClock.wallNow() : Date.now();
}

function calcCurrentSeason() {
  return calcSeasonAt(_seasonNow());
}

function calcSeasonAt(now) {
  const SEASON_IDS = ['spring','summer','autumn','winter'];
  const SEASON_NAMES = ['Spring','Summer','Autumn','Winter'];
  const SEASON_EMOJIS = ['🌸','☀️','🍂','❄️'];
  const SEASON_FLAVORS = [
    'New growth stirs in the woodland.',
    'Long days and warm sun — peak harvest.',
    'The harvest is in. Prepare for the cold.',
    'Harsh cold grips the realm. Guard your stores.',
  ];
  const legacyYearAt = ms => Math.floor((ms - SEASON_YEAR_EPOCH_MS) / SEASON_LEGACY_YEAR_MS) + 1;
  let msIntoYear, seasonLen, year;
  if (now < SEASON_CUTOVER_MS) {
    msIntoYear = now % SEASON_LEGACY_YEAR_MS;
    seasonLen  = SEASON_LEGACY_MS;
    year       = legacyYearAt(now);
  } else {
    const since = now - SEASON_CUTOVER_MS;
    msIntoYear = since % SEASON_YEAR_MS;
    seasonLen  = SEASON_DURATION_MS;
    year       = legacyYearAt(SEASON_CUTOVER_MS) + Math.floor(since / SEASON_YEAR_MS);
  }
  const index = Math.floor(msIntoYear / seasonLen);
  const msIntoSeason = msIntoYear % seasonLen;
  return {
    id: SEASON_IDS[index],
    name: SEASON_NAMES[index],
    emoji: SEASON_EMOJIS[index],
    flavor: SEASON_FLAVORS[index],
    index,
    progress: msIntoSeason / seasonLen,
    msRemaining: seasonLen - msIntoSeason,
    dayNumber: year,
    year,
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
    <div class="season-panel-inner kw-ornate-frame" onclick="event.stopPropagation()">
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
        <span class="sp-day-note">${_seasonNow() >= SEASON_CUTOVER_MS
          ? '28 real hours = 1 in-game year · each season 7 hours'
          : '1 real day = 1 in-game year'}</span>
      </div>

    </div>
  `;
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
