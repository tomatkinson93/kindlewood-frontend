
async function clearAllEvents() {
  try {
    await apiFetch('/api/events/clear-all', { method: 'POST' });
    _eventsData = [];
    renderEventsFeed();
  } catch(e) { console.error(e); }
}

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

let _lastSeenEventId = null;

function renderEventsFeed() {
  const feed = document.getElementById('events-feed');
  if (!feed) return;
  // Toast new events
  if (_eventsData.length > 0) {
    const newest = _eventsData[0];
    if (_lastSeenEventId !== null && newest.id !== _lastSeenEventId) {
      // New events arrived — toast each one newer than last seen.
      //
      // Skip quest_success/quest_fail: the quests poller (quests.js) already
      // toasts "$party has returned from $quest!" when it sees status flip
      // server-side. Without this filter the player gets two toasts back-to-
      // back for the same quest resolution (one from the quests poller, one
      // from this bell-feed render path).
      const lastIdx = _eventsData.findIndex(e => e.id === _lastSeenEventId);
      const newOnes = lastIdx === -1 ? [newest] : _eventsData.slice(0, lastIdx);
      const toastable = newOnes.filter(e => e.type !== 'quest_success' && e.type !== 'quest_fail');
      toastable.slice(0, 3).forEach((e, i) => {
        setTimeout(() => showToastNotification(e.message, e.type), i * 300);
      });
    }
    _lastSeenEventId = newest.id;
  }

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

  // Update badge — only show when panel is closed
  const badge = document.getElementById('events-badge');
  const panel = document.getElementById('events-panel');
  if (badge) {
    const panelOpen = panel && panel.classList.contains('open');
    badge.textContent = _eventsData.length;
    badge.style.display = (_eventsData.length && !panelOpen) ? 'inline-flex' : 'none';
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
  // Toggle — clicking bell again closes it
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    return;
  }
  panel.classList.add('open');
  // Clear badge immediately on open
  const badge = document.getElementById('events-badge');
  if (badge) badge.style.display = 'none';
  loadEvents();
  // Click-outside to close — wait for current event to finish bubbling
  setTimeout(() => {
    document.addEventListener('mousedown', _eventsPanelClickOutside);
  }, 200);
}

function _eventsPanelClickOutside(e) {
  const panel = document.getElementById('events-panel');
  const bell  = document.querySelector('.btn-events-bell');
  if (panel && !panel.contains(e.target) && (!bell || !bell.contains(e.target))) {
    panel.classList.remove('open');
    document.removeEventListener('mousedown', _eventsPanelClickOutside);
  }
}

function closeEventsPanel() {
  const panel = document.getElementById('events-panel');
  if (panel) panel.classList.remove('open');
  document.removeEventListener('mousedown', _eventsPanelClickOutside);
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
