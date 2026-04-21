// ══════════════════════════════════════════════
//  SETTLEMENT EVENTS FEED — Kindlewood
// ══════════════════════════════════════════════

const EVENT_ICONS = {
  child_born:   '🍼',
  partnership:  '💕',
  bond_formed:  '🤝',
  close_bond:   '💛',
};

let _eventsData = [];
let _eventsInterval = null;

// ── Load and render ───────────────────────────

async function loadEvents() {
  try {
    const res = await apiFetch('/api/events?limit=15');
    if (!res.ok) return;
    const data = await res.json();
    _eventsData = data.events || [];
    renderEventsFeed();
  } catch(e) { /* silent */ }
}

function renderEventsFeed() {
  const feed = document.getElementById('events-feed');
  if (!feed) return;

  if (!_eventsData.length) {
    feed.innerHTML = '<div class="ef-empty">No events yet. Your settlement is just getting started.</div>';
    return;
  }

  feed.innerHTML = _eventsData.map(ev => {
    const icon = EVENT_ICONS[ev.type] || '📜';
    const time = _timeAgo(ev.created_at);
    return `
      <div class="ef-item ef-${ev.type}">
        <span class="ef-icon">${icon}</span>
        <div class="ef-content">
          <div class="ef-message">${ev.message}</div>
          <div class="ef-time">${time}</div>
        </div>
        <button class="ef-dismiss" onclick="dismissEvent(${ev.id})" title="Dismiss">✕</button>
      </div>
    `;
  }).join('');

  // Update badge
  const badge = document.getElementById('events-badge');
  if (badge) {
    badge.textContent = _eventsData.length;
    badge.style.display = _eventsData.length ? 'inline-flex' : 'none';
  }
}

async function dismissEvent(id) {
  try {
    await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
    _eventsData = _eventsData.filter(e => e.id !== id);
    renderEventsFeed();
  } catch(e) { /* silent */ }
}

// ── Events panel open/close ───────────────────

function openEventsPanel() {
  const panel = document.getElementById('events-panel');
  if (!panel) return;
  panel.classList.add('open');
  loadEvents();
}

function closeEventsPanel() {
  const panel = document.getElementById('events-panel');
  if (panel) panel.classList.remove('open');
}

// ── Poll for new events every 2 mins ─────────

function startEventsPoll() {
  loadEvents();
  if (_eventsInterval) clearInterval(_eventsInterval);
  _eventsInterval = setInterval(loadEvents, 2 * 60 * 1000);
}

// ── Helpers ───────────────────────────────────

function _timeAgo(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'Just now';
}

// ── Relationship tab in citizen profile ───────

async function loadCitizenRelationships(citizenId) {
  const el = document.getElementById('cp-rel-list');
  if (!el) return;
  el.innerHTML = '<div class="cp-rel-loading">Loading…</div>';

  const REL_COLORS = {
    partners: '#e060f0', bonded: '#f0a020', close: '#70c860',
    friends: '#70a0e0', acquaintances: '#a08060', strangers: '#606060'
  };

  try {
    const res = await apiFetch(`/api/relationships/citizen/${citizenId}`);
    const data = await res.json();
    const rels = data.relationships || [];
    if (!rels.length) {
      el.innerHTML = '<div class="cp-rel-empty">No notable relationships yet — spend time together to build bonds.</div>';
      return;
    }

    const species = (typeof gameData !== 'undefined' ? gameData?.species : 'Mice') || 'Mice';
    const speciesLower = species.toLowerCase();

    el.innerHTML = rels.map(r => {
      const color = REL_COLORS[r.state] || '#808080';
      const label = r.state.charAt(0).toUpperCase() + r.state.slice(1);
      const pct = Math.min(100, Math.round(r.score));
      const genderSym = r.other_gender === 'female' ? '♀' : '♂';
      const genderColor = r.other_gender === 'female' ? '#e090c0' : '#70a8e0';
      const isPartner = r.state === 'partners';
      return `
        <div class="cp-rel-card ${isPartner ? 'cp-rel-partner' : ''}" onclick="openCitizenProfile(${r.other_id})">
          <div class="cp-rel-avatar">
            <img src="/assets/images/species/${speciesLower}.png" class="cp-rel-species-icon" alt="${species}" onerror="this.style.display='none'">
            <span class="cp-rel-gender" style="color:${genderColor}">${genderSym}</span>
          </div>
          <div class="cp-rel-info">
            <div class="cp-rel-citizen-name">${r.other_name}${isPartner ? ' 💕' : ''}</div>
            <div class="cp-rel-bar-wrap">
              <div class="cp-rel-bar" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>
          <div class="cp-rel-right">
            <span class="cp-rel-state-pill" style="color:${color};border-color:${color}40">${label}</span>
            <span class="cp-rel-pct">${pct}%</span>
          </div>
        </div>
      `;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="cp-rel-empty">Could not load.</div>';
  }
}
