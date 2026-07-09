// js/online.js — "who's online" list + presence heartbeat.
//
// Sends a heartbeat every 30s so the server knows we're here, keeps the
// Online button's count fresh, and renders a tappable list that opens each
// player's profile. (Later: gate unrevealed players behind a teaser.)

(function () {
  const PING_MS = 30000;
  let _pingTimer = null;

  function _token() { return localStorage.getItem('kw_token') || ''; }
  function _api(path, opts) {
    return apiFetch(path, opts).then(r => r.json().catch(() => ({})));
  }

  function startPresence() {
    if (_pingTimer) return;
    const ping = () => _api('/api/presence/ping', { method: 'POST' }).catch(() => {});
    ping();
    _pingTimer = setInterval(ping, PING_MS);
    // Refresh the count occasionally so the badge stays live
    refreshCount();
    setInterval(refreshCount, 45000);
    // Best-effort "leaving" on tab close
    window.addEventListener('beforeunload', () => {
      try {
        navigator.sendBeacon?.('/api/presence/leave');
      } catch (e) {}
    });
  }

  async function refreshCount() {
    try {
      const data = await _api('/api/presence/list');
      const el = document.getElementById('online-count');
      if (el && data && typeof data.count === 'number') {
        el.textContent = data.count ? '(' + data.count + ')' : '';
      }
    } catch (e) {}
  }

  async function showOnlineList() {
    const modal = document.getElementById('online-modal');
    const body = document.getElementById('online-list-body');
    if (!modal || !body) return;
    modal.classList.add('open');
    body.innerHTML = '<div class="online-empty">Looking around the realm…</div>';
    try {
      const data = await _api('/api/presence/list');
      const me = (window._authUser && window._authUser.username) || null;
      const list = (data && data.online) || [];
      if (!list.length) { body.innerHTML = '<div class="online-empty">No one else is about right now.</div>'; return; }
      body.innerHTML = list.map(p => {
        const isMe = me && p.name === me;
        return `<button class="online-row" ${isMe ? 'disabled' : ''} onclick="openProfileForUser('${_esc(p.name)}','','','village','','')">
          <span class="online-dot"></span>
          <span class="online-name">${_esc(p.name)}${isMe ? ' <em>(you)</em>' : ''}</span>
          ${isMe ? '' : '<span class="online-go">View ›</span>'}
        </button>`;
      }).join('');
    } catch (e) {
      body.innerHTML = '<div class="online-empty">Could not load the list right now.</div>';
    }
  }

  function closeOnlineList() {
    document.getElementById('online-modal')?.classList.remove('open');
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Expose
  window.showOnlineList = showOnlineList;
  window.closeOnlineList = closeOnlineList;
  window.startPresence = startPresence;

  // Kick off the heartbeat once the page is interactive and we have a token.
  function boot() {
    if (_token()) startPresence();
    else setTimeout(boot, 4000); // wait for login
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
