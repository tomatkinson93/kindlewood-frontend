// js/leaderboard.js — prestigious tabbed leaderboard modal.
//
// Categories are scaffolded; only "Briarwood Court Wins" pulls live data
// (from /api/stats/leaderboard?game=briar) for now. Others show a graceful
// "coming soon" so the structure is visible. Top 3 get trophy styling.

(function () {
  const CATEGORIES = [
    { group: 'Settlements', items: [
      { id: 'score',      name: 'Overall Score', live: false },
      { id: 'wealth',     name: 'Wealth',        live: false },
      { id: 'population', name: 'Population',     live: false },
    ]},
    { group: 'Citizens', items: [
      { id: 'skilled',    name: 'Most Skilled',     live: false },
      { id: 'adventurous',name: 'Most Adventurous', live: false },
      { id: 'oldest',     name: 'Oldest',           live: false },
    ]},
    { group: 'Fishing', items: [
      { id: 'biggest',    name: 'Biggest Fish', live: false },
      { id: 'mostfish',   name: 'Most Fish',    live: false },
    ]},
    { group: 'Tavern Games', items: [
      { id: 'briar',      name: 'Briarwood Court Wins', live: true,
        endpoint: '/api/stats/leaderboard?game=briar',
        columns: ['Wins', 'Games'], map: r => [r.username, r.wins, r.games] },
    ]},
    { group: 'Achievements', items: [
      { id: 'achpoints',  name: 'Achievement Points', live: false },
    ]},
  ];

  let _active = 'briar';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _findItem(id) {
    for (const g of CATEGORIES) { const it = g.items.find(i => i.id === id); if (it) return it; }
    return null;
  }

  function openLeaderboard() {
    let modal = document.getElementById('leaderboard-modal');
    if (!modal) { modal = _build(); document.body.appendChild(modal); }
    modal.classList.add('open');
    _select(_active);
  }
  function closeLeaderboard() {
    document.getElementById('leaderboard-modal')?.classList.remove('open');
  }

  function _build() {
    const modal = document.createElement('div');
    modal.id = 'leaderboard-modal';
    modal.className = 'lb-backdrop';
    modal.onclick = (e) => { if (e.target === modal) closeLeaderboard(); };

    const tabs = CATEGORIES.map(g => `
      <div class="lb-tab-group">
        <div class="lb-tab-group-title">${_esc(g.group)}</div>
        ${g.items.map(it => `<button class="lb-tab" data-id="${it.id}" onclick="Leaderboard._select('${it.id}')">${_esc(it.name)}</button>`).join('')}
      </div>`).join('');

    modal.innerHTML = `
      <div class="lb-shell">
        <button class="lb-x" onclick="Leaderboard.close()">✕</button>
        <div class="lb-header">
          <div class="lb-crest">🏆</div>
          <div>
            <div class="lb-title">Hall of Renown</div>
            <div class="lb-sub">The most storied names across Kindlewood</div>
          </div>
        </div>
        <div class="lb-body">
          <div class="lb-tabs">${tabs}</div>
          <div class="lb-content" id="lb-content"></div>
        </div>
      </div>`;
    return modal;
  }

  function _select(id) {
    _active = id;
    document.querySelectorAll('.lb-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.id === id));
    const item = _findItem(id);
    const content = document.getElementById('lb-content');
    if (!content || !item) return;

    if (!item.live) {
      content.innerHTML = `<div class="lb-soon">
        <div class="lb-soon-icon">🌿</div>
        <div class="lb-soon-title">${_esc(item.name)}</div>
        <div class="lb-soon-text">This leaderboard is being tallied by the realm's scribes. Check back soon.</div>
      </div>`;
      return;
    }

    content.innerHTML = `<div class="lb-loading">Consulting the ledgers…</div>`;
    _loadLive(item, content);
  }

  async function _loadLive(item, content) {
    let rows = [];
    try {
      const res = await apiFetch(item.endpoint);
      const data = await res.json();
      rows = (data && data.leaderboard) || [];
    } catch (e) {}

    if (!rows.length) {
      content.innerHTML = `<div class="lb-soon">
        <div class="lb-soon-icon">🃏</div>
        <div class="lb-soon-title">No champions yet</div>
        <div class="lb-soon-text">Be the first to win at the Briarwood Court and claim this throne.</div>
      </div>`;
      return;
    }

    const mapped = rows.map(item.map);
    const podium = mapped.slice(0, 3);
    const rest = mapped.slice(3);
    const cols = item.columns;

    const medal = ['gold', 'silver', 'bronze'];
    const trophy = ['🥇', '🥈', '🥉'];

    // Podium: render 2nd, 1st, 3rd for a classic raised-centre look
    const order = podium.length === 3 ? [1, 0, 2] : podium.map((_, i) => i);
    const podiumHtml = `<div class="lb-podium">
      ${order.map(i => {
        const row = podium[i];
        if (!row) return '';
        return `<div class="lb-podium-spot ${medal[i]} place-${i + 1}" onclick="Leaderboard._viewProfile('${_esc(row[0])}')" title="View ${_esc(row[0])}">
          <div class="lb-podium-trophy">${trophy[i]}</div>
          <div class="lb-podium-name">${_esc(row[0])}</div>
          <div class="lb-podium-stat">${_esc(row[1])} ${_esc(cols[0].toLowerCase())}${row[2] != null ? ` <span class="lb-podium-games">(${_esc(row[2])} ${_esc((cols[1]||'games').toLowerCase())})</span>` : ''}</div>
          <div class="lb-podium-base">${i + 1}</div>
        </div>`;
      }).join('')}
    </div>`;

    const restHtml = rest.length ? `<table class="lb-table">
      <thead><tr><th>#</th><th>Name</th>${cols.map(c => `<th>${_esc(c)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rest.map((row, idx) => `<tr class="lb-row-click" onclick="Leaderboard._viewProfile('${_esc(row[0])}')" title="View profile">
          <td class="lb-rank">${idx + 4}</td>
          <td class="lb-name">${_esc(row[0])}</td>
          ${row.slice(1).map(v => `<td>${_esc(v)}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>` : '';

    content.innerHTML = podiumHtml + restHtml;
  }

  function _viewProfile(name) {
    if (!name) return;
    closeLeaderboard();
    // Uses the game's existing profile opener; later this can gate on whether
    // the viewer has scouted this settlement.
    if (typeof openProfileForUser === 'function') openProfileForUser(name, '', '', 'village', '', '');
  }

  window.Leaderboard = { open: openLeaderboard, close: closeLeaderboard, _select, _viewProfile };
  window.openLeaderboard = openLeaderboard;
})();
