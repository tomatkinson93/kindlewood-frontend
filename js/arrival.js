// ── Arrival screen — species + zone selection ──

const ZONES = [
  {
    id: 'forest', name: 'Ancient Forest',
    subtitle: 'Where old trees guard older secrets',
    description: 'Dense ancient woodland stretches in every direction. Timber is plentiful, the canopy provides natural defence, and the old roots hide forgotten things.',
    bonuses: ['Timber +4/hr', 'Stone +2/hr', 'Natural cover'],
    bestFor: ['Badgers', 'Moles'],
    notes: ['You may found new outposts in the surrounding wood', 'Resettlement is possible as your realm expands', 'Placement within this zone is chosen by fate'],
    bg: '/assets/zone_forest.png', emoji: '🌲',
  },
  {
    id: 'riverside', name: 'Riverside Vale',
    subtitle: 'Where water writes the story of trade',
    description: 'A clear river winds through open land. Merchants travel these waters daily. Wealth flows as freely as the current.',
    bonuses: ['Wealth +4/hr', 'Food +2/hr', 'Trade routes'],
    bestFor: ['Otters', 'Foxes', 'Mice'],
    notes: ['River tiles support dock outposts later', 'Resettlement is possible as your realm expands', 'Placement within this zone is chosen by fate'],
    bg: '/assets/zone_riverside.png', emoji: '🌊',
  },
  {
    id: 'highland', name: 'Highland Crags',
    subtitle: 'Where stone and iron meet the sky',
    description: 'Rugged peaks and rocky slopes rich in ore and stone. Hard living, but those who endure build fortresses that never fall.',
    bonuses: ['Stone +4/hr', 'Metal +4/hr', 'High ground defence'],
    bestFor: ['Badgers', 'Moles'],
    notes: ['Mountain tiles can be mined for rare metals', 'Resettlement is possible as your realm expands', 'Placement within this zone is chosen by fate'],
    bg: '/assets/zone_highland.png', emoji: '⛰',
  },
  {
    id: 'heartlands', name: 'Open Heartlands',
    subtitle: 'Where the horizon belongs to those who dare',
    description: 'Rolling open plains with rich soil and fast roads. Perfect for rapid expansion and feeding a growing population.',
    bonuses: ['Food +3/hr', 'Growth +20%', 'Fast movement'],
    bestFor: ['Mice', 'Hares'],
    notes: ['Plains expand quickly — ideal for early growth', 'Resettlement is possible as your realm expands', 'Placement within this zone is chosen by fate'],
    bg: '/assets/zone_heartlands.png', emoji: '🌿',
  },
  {
    id: 'marsh', name: 'Misty Marshlands',
    subtitle: 'Where the land breathes with life',
    description: 'Fog-shrouded wetlands teeming with game and rare herbs. Difficult to navigate for enemies, rich in resources for those who know the paths.',
    bonuses: ['Food +2/hr', 'Timber +2/hr', 'Natural stealth'],
    bestFor: ['Otters', 'Hares', 'Foxes'],
    notes: ['Marsh terrain slows enemy movement', 'Resettlement is possible as your realm expands', 'Placement within this zone is chosen by fate'],
    bg: '/assets/zone_marsh.png', emoji: '🌾',
  },
];

const SPECIES_LIST = ['mouse','badger','fox','otter','hare','mole'];
const SPECIES_NAMES = { mouse:'Mice', badger:'Badgers', fox:'Foxes', otter:'Otters', hare:'Hares', mole:'Moles' };

let arrivalSpeciesIdx = 0;
let arrivalZoneIdx = 0;
let zoneFading = false;
let pendingZoneIdx = null;

function showArrivalScreen(settlementName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-arrival').classList.add('active');

  const bgNext = document.getElementById('arrival-bg-next');
  if (bgNext) { bgNext.style.opacity = '0'; bgNext.style.pointerEvents = 'none'; bgNext.onload = null; }

  zoneFading = false;
  pendingZoneIdx = null;

  const btn = document.getElementById('arrival-confirm-btn');
  if (btn) { btn.dataset.loading = 'false'; btn.style.opacity = ''; btn.disabled = false; }

  const input = document.getElementById('arrival-settlement-name');
  const preview = document.getElementById('arrival-settlement-preview');
  const defaultName = settlementName || 'Your Settlement';
  if (preview) preview.textContent = defaultName;
  if (input) {
    input.value = '';
    input.addEventListener('input', () => {
      if (preview) preview.textContent = input.value.trim() || defaultName;
    });
  }

  renderArrivalSpecies();
  renderArrivalZone(true);
}

function renderArrivalSpecies() {
  const sp = SPECIES_LIST[arrivalSpeciesIdx];
  const data = SPECIES_DATA[sp];

  const img = document.getElementById('arrival-sp-img');
  if (img) img.src = `/assets/${sp}.png`;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('arrival-sp-name', SPECIES_NAMES[sp]);
  set('arrival-sp-role', data.role);
  set('arrival-sp-flavor', data.flavor);
  set('arrival-sp-lore', data.lore);
  set('arrival-sp-counter', `${arrivalSpeciesIdx + 1} / ${SPECIES_LIST.length}`);

  const statsEl = document.getElementById('arrival-sp-stats');
  if (statsEl) statsEl.innerHTML = data.stats.map(([k,v]) =>
    `<div class="arrival-stat-row"><span class="arrival-stat-key">${k}</span><span class="arrival-stat-val">${v}</span></div>`
  ).join('');

  if (typeof pageTurnAudio !== 'undefined') { pageTurnAudio.currentTime = 0; pageTurnAudio.play().catch(()=>{}); }
}

function arrivalSpeciesPrev() { arrivalSpeciesIdx = (arrivalSpeciesIdx - 1 + SPECIES_LIST.length) % SPECIES_LIST.length; renderArrivalSpecies(); }
function arrivalSpeciesNext() { arrivalSpeciesIdx = (arrivalSpeciesIdx + 1) % SPECIES_LIST.length; renderArrivalSpecies(); }

function renderArrivalZone(instant = false) {
  const zone = ZONES[arrivalZoneIdx];
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('arrival-zone-emoji', zone.emoji);
  set('arrival-zone-name', zone.name);
  set('arrival-zone-subtitle', zone.subtitle);
  set('arrival-zone-desc', zone.description);
  set('arrival-zone-bestfor', `Best for: ${zone.bestFor.join(', ')}`);
  set('arrival-zone-counter', `${arrivalZoneIdx + 1} / ${ZONES.length}`);

  const bonusesEl = document.getElementById('arrival-zone-bonuses');
  if (bonusesEl) bonusesEl.innerHTML = zone.bonuses.map(b => `<div class="arrival-bonus">✦ ${b}</div>`).join('');
  const notesEl = document.getElementById('arrival-zone-notes');
  if (notesEl) notesEl.innerHTML = zone.notes.map(n => `<div class="arrival-zone-note">◦ ${n}</div>`).join('');

  const bg = document.getElementById('arrival-bg');
  const bgNext = document.getElementById('arrival-bg-next');
  if (!bg || !bgNext) return;

  if (instant) { bg.src = zone.bg; bgNext.style.opacity = '0'; bgNext.style.transition = 'none'; return; }
  if (zoneFading) { pendingZoneIdx = arrivalZoneIdx; return; }

  zoneFading = true;
  pendingZoneIdx = null;

  const doFade = () => {
    bgNext.style.transition = 'opacity 0.55s ease';
    bgNext.style.opacity = '1';
    setTimeout(() => {
      bg.src = bgNext.src;
      bgNext.style.transition = 'none';
      bgNext.style.opacity = '0';
      zoneFading = false;
      if (pendingZoneIdx !== null) {
        arrivalZoneIdx = pendingZoneIdx;
        pendingZoneIdx = null;
        renderArrivalZone(false);
      }
    }, 600);
  };

  bgNext.onload = null;
  bgNext.src = zone.bg;
  bgNext.style.opacity = '0';
  bgNext.style.transition = 'none';
  bgNext.style.pointerEvents = 'none';
  if (bgNext.complete && bgNext.naturalWidth > 0) doFade();
  else bgNext.onload = doFade;
}

function arrivalZonePrev() {
  arrivalZoneIdx = (arrivalZoneIdx - 1 + ZONES.length) % ZONES.length;
  if (typeof pageTurnAudio !== 'undefined') { pageTurnAudio.currentTime = 0; pageTurnAudio.play().catch(()=>{}); }
  renderArrivalZone(false);
}
function arrivalZoneNext() {
  arrivalZoneIdx = (arrivalZoneIdx + 1) % ZONES.length;
  if (typeof pageTurnAudio !== 'undefined') { pageTurnAudio.currentTime = 0; pageTurnAudio.play().catch(()=>{}); }
  renderArrivalZone(false);
}

async function confirmArrival() {
  const btn = document.getElementById('arrival-confirm-btn');
  if (!btn || btn.dataset.loading === 'true') return;
  btn.dataset.loading = 'true';
  btn.style.opacity = '0.7';

  const species = SPECIES_NAMES[SPECIES_LIST[arrivalSpeciesIdx]];
  const zone = ZONES[arrivalZoneIdx].id;
  const nameInput = document.getElementById('arrival-settlement-name').value.trim();

  const reset = () => { btn.dataset.loading = 'false'; btn.style.opacity = ''; };

  try {
    if (nameInput && nameInput.length >= 2) {
      const r = await apiFetch('/api/game/settlement/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput }),
      });
      if (!r.ok) { alert('Rename failed.'); reset(); return; }
    }

    const res = await apiFetch('/api/map/arrive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ species, zone }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Something went wrong.'); reset(); return; }

    await loadGame(true);
    reset();
  } catch (e) {
    console.error('confirmArrival error:', e);
    reset();
  }
}
