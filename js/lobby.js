// js/lobby.js — reusable multiplayer lobby for tavern games.
//
// Games opt in via LobbySystem.register(). The pill, mode chooser,
// browser, create form, room view and match handoff are all generic;
// a game only supplies its type, name, player range, and a callback
// that launches its networked match once seats are dealt.
//
// Phase 1 (now): full lobby flow end to end.
// Phase 2 (next): the onStart callback receives seats + an event channel
// and runs the networked game; relay() / the SSE 'game_event' type are
// already here waiting for it.

const LobbySystem = (() => {
  const games = {};
  let es = null;          // EventSource for the current room
  let current = null;     // current room view
  let myId = null;

  function register(def) { games[def.type] = def; }

  function _api(path, opts = {}) {
    return apiFetch('/api/rooms' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Something went wrong');
      return data;
    });
  }

  // Lobby lives in its own modal overlay, not under the tavern UI.
  function _host() {
    let m = document.getElementById('lobby-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'lobby-modal';
      m.className = 'lobby-backdrop';
      m.innerHTML = '<div class="lobby-card-shell"><button class="lobby-x" onclick="LobbySystem.close()">\u2715</button><div id="lobby-modal-body"></div></div>';
      document.body.appendChild(m);
    }
    return document.getElementById('lobby-modal-body');
  }
  function _open() {
    _host(); // ensure built
    document.getElementById('lobby-modal').classList.add('open');
  }
  function close() {
    const m = document.getElementById('lobby-modal');
    if (m) m.classList.remove('open');
    _closeStream();
    current = null;
  }
  function _show(html) {
    const el = _host();
    if (!el) return;
    _open();
    el.innerHTML = `<div class="lobby">${html}</div>`;
  }
  const _esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // ── Entry: mode chooser ──
  function choose(gameType) {
    const g = games[gameType];
    if (!g) return;
    // No more Single/Multiplayer split: everyone goes to the table browser.
    // Hosting a table with only AI seats IS single-player (and is treated as
    // such for rankings). Add other players to make it multiplayer.
    browse(gameType);
  }

  function _single(gameType) { close(); games[gameType].onSingle(); }

  function soloChoose(gameType) {
    const g = games[gameType];
    _open();
    _show(`
      <div class="lobby-title">${_esc(g.name)} — Single Player</div>
      <div class="lobby-sub">Choose your opponents' cunning.</div>
      <div class="lobby-mode-row">
        <button class="lobby-card" onclick="LobbySystem.soloStart('${gameType}','simple')">
          <div class="lobby-card-icon">\u{1F642}</div>
          <div class="lobby-card-name">Gentlefolk</div>
          <div class="lobby-card-desc">Relaxed courtiers — they rarely call your bluffs</div>
        </button>
        <button class="lobby-card" onclick="LobbySystem.soloStart('${gameType}','smart')">
          <div class="lobby-card-icon">\u{1F9D0}</div>
          <div class="lobby-card-name">Cunning Court</div>
          <div class="lobby-card-desc">They count cards and read the table</div>
        </button>
        <button class="lobby-card" onclick="LobbySystem.soloStart('${gameType}','cunning')">
          <div class="lobby-card-icon">\u{1F40D}</div>
          <div class="lobby-card-name">Ruthless Court</div>
          <div class="lobby-card-desc">Each courtier a sharpened character — relentless, and hard to bluff</div>
        </button>
      </div>
      <div class="lobby-actions"><button class="cg-btn secondary" onclick="LobbySystem.choose('${gameType}')">\u2190 Back</button></div>`);
  }

  function soloStart(gameType, difficulty) {
    close();
    const g = games[gameType];
    if (g && g.onSingle) g.onSingle(difficulty);
  }

  // ── Browser: public rooms + create/join ──
  async function browse(gameType) {
    const g = games[gameType];
    _show(`<div class="lobby-title">${_esc(g.name)} \u2014 Tables</div><div class="lobby-sub">Loading open tables\u2026</div>`);
    let list = [];
    try { list = (await _api('/list?game=' + encodeURIComponent(gameType))).rooms; }
    catch (e) {}
    const rows = list.length ? list.map(r => `
      <div class="lobby-room-row">
        <div>
          <div class="lobby-room-host">${_esc(r.players[0] ? r.players[0].name : 'Host')}'s table</div>
          <div class="lobby-room-meta">${r.players.length}/${r.maxPlayers} players \u00b7 code ${r.code}</div>
        </div>
        <button class="cg-btn" onclick="LobbySystem.join('${r.code}')">Join</button>
      </div>`).join('') : '<div class="lobby-empty">No open tables right now. Host one!</div>';
    _show(`
      <div class="lobby-title">${_esc(g.name)} \u2014 Tables</div>
      <div class="lobby-rooms">${rows}</div>
      <div class="lobby-join-code">
        <input id="lobby-code-input" class="ac-search" placeholder="Enter room code\u2026" maxlength="6"
          oninput="this.value=this.value.toUpperCase()">
        <button class="cg-btn" onclick="LobbySystem.joinByInput()">Join by code</button>
      </div>
      <div class="lobby-actions">
        <button class="cg-btn" onclick="LobbySystem.createForm('${gameType}')">+ Host a table</button>
        <button class="cg-btn secondary" onclick="LobbySystem.browse('${gameType}')">\u21BB Refresh</button>
      </div>`);
  }

  // ── Create form ──
  function createForm(gameType) {
    const g = games[gameType];
    const opts = [];
    for (let n = g.maxPlayers; n >= g.minPlayers; n--) opts.push(`<option value="${n}">${n} players</option>`);
    _show(`
      <div class="lobby-title">Host \u2014 ${_esc(g.name)}</div>
      <div class="lobby-form">
        <label class="lobby-field"><span>Table size</span>
          <select id="lobby-max" class="ac-role-select">${opts.join('')}</select></label>
        <label class="lobby-field"><span>Visibility</span>
          <select id="lobby-vis" class="ac-role-select">
            <option value="public">Public \u2014 anyone can join</option>
            <option value="private">Private \u2014 invite only</option>
          </select></label>
        <label class="lobby-field"><span>AI difficulty</span>
          <select id="lobby-diff" class="ac-role-select">
            <option value="smart">Cunning \u2014 counts cards</option>
            <option value="simple">Gentle \u2014 rarely challenges</option>
            <option value="cunning">Ruthless \u2014 amplified & relentless</option>
          </select></label>
      </div>
      <div class="lobby-actions">
        <button class="cg-btn" onclick="LobbySystem.create('${gameType}')">Create table</button>
        <button class="cg-btn secondary" onclick="LobbySystem.browse('${gameType}')">\u2190 Back</button>
      </div>`);
  }

  async function create(gameType) {
    const maxPlayers = +document.getElementById('lobby-max').value;
    const visibility = document.getElementById('lobby-vis').value;
    const difficulty = document.getElementById('lobby-diff').value;
    try {
      const { room } = await _api('/create', { method: 'POST', body: { gameType, maxPlayers, visibility, difficulty } });
      _enterRoom(room.code);
    } catch (e) { _error(e.message, () => createForm(gameType)); }
  }

  async function join(code) {
    try { await _api('/' + code + '/join', { method: 'POST' }); _enterRoom(code); }
    catch (e) { _error(e.message, () => current ? null : browse(_lastGame)); }
  }
  function joinByInput() {
    const v = (document.getElementById('lobby-code-input').value || '').trim().toUpperCase();
    if (v.length === 6) join(v);
  }

  // ── Live room view (SSE-driven) ──
  let _lastGame = null;
  function _enterRoom(code) {
    _closeStream();
    // EventSource can't set headers, and the API is cross-origin, so the
    // JWT rides in the query string (server supports ?token=, like stream.js).
    const token = localStorage.getItem('kw_token') || '';
    const base = (typeof API !== 'undefined' ? API : '') + '/api/rooms/' + code + '/stream';
    const url = token ? base + '?token=' + encodeURIComponent(token) : base;
    es = new EventSource(url, { withCredentials: true });
    es.onmessage = ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      _handle(code, msg);
    };
    es.onerror = () => {/* browser auto-reconnects */};
  }

  function _handle(code, msg) {
    if (msg.type === 'snapshot') {
      if (msg.room.youId != null) myId = msg.room.youId;     // authoritative
      current = msg.room; _lastGame = msg.room.gameType; _renderRoom(code);
    } else if (msg.type === 'lobby_update') {
      // A rematch drops a finished match back to the lobby room view; close any
      // open game modal so the room shows through (no-op outside a match).
      if (typeof window.__closeActiveGameModal === 'function') window.__closeActiveGameModal();
      current = msg.room; _lastGame = msg.room.gameType; _renderRoom(code);
      if (_pickerCode) _renderCourtierPicker();   // keep the courtier grid in sync
    } else if (msg.type === 'match_started') {
      const g = games[current.gameType];
      const m = document.getElementById('lobby-modal');
      if (m) m.classList.remove('open');
      // Keep the SSE open so chat/whispers/typing keep flowing in-game.
      const amHost = (myId != null && current && String(current.hostId) === String(myId));
      g.onStart({ seats: msg.seats, code, myId, isHost: amHost, players: current.players, channel: _channel(code) });
    } else if (msg.type === 'room_closed') {
      _closeStream(); _error('The host closed the room.', () => browse(_lastGame));
    } else {
      // Any other event (game_state, match_over, chat, typing, cursor,
      // presence, host_changed, seat_converted/restored, …) is game-level —
      // hand it to the active game. current may be null on a late reconnect, so
      // fall back to the last known game. Unknown types are ignored downstream.
      const gt = (current && current.gameType) || _lastGame;
      if (gt && games[gt]?.onEvent) games[gt].onEvent(msg);
    }
  }

  // Phase-2 channel handed to the game: send actions + receive events
  function _channel(code) {
    return {
      send:   payload => _api('/' + code + '/action', { method: 'POST', body: payload }),
      chat:   (text, to) => _api('/' + code + '/chat', { method: 'POST', body: { text, to } }),
      typing: on => _api('/' + code + '/typing', { method: 'POST', body: { on } }),
    };
  }

  function _renderRoom(code) {
    const r = current;
    const isHost = (myId != null && r.hostId === myId);
    const canStart = r.players.length >= (games[r.gameType]?.minPlayers || 2);
    const seats = [];
    for (let i = 0; i < r.maxPlayers; i++) {
      const p = r.players[i];
      if (p) {
        const crown = p.id === r.hostId ? ' \u{1F451}' : '';
        const aiTag = p.isAI ? ' <span class="lobby-ai-tag">AI</span>' : '';
        const kick = (isHost && p.isAI)
          ? ` <button class="lobby-seat-x" onclick="LobbySystem.removeAI('${code}','${p.id}')" title="Remove">\u2715</button>` : '';
        seats.push(`<div class="lobby-seat filled">${_esc(p.name)}${crown}${aiTag}${kick}</div>`);
      } else if (isHost) {
        seats.push(`<button class="lobby-seat add-ai" onclick="LobbySystem.openCourtierPicker('${code}')" title="Add an AI courtier">+ Add AI</button>`);
      } else {
        seats.push(`<div class="lobby-seat empty">Waiting\u2026</div>`);
      }
    }
    _show(`
      <div class="lobby-title">${_esc(r.gameName)}</div>
      <div class="lobby-roomcode">
        Room code <strong>${r.code}</strong>
        <button class="lobby-copy" onclick="LobbySystem.invite()" title="Copy invite">\u{1F4CB} Invite</button>
        <span class="lobby-vis-tag">${r.visibility === 'private' ? '\u{1F512} Private' : '\u{1F310} Public'}</span>
      </div>
      <div class="lobby-seats">${seats.join('')}</div>
      <div class="lobby-actions">
        ${isHost
          ? `<button class="cg-btn" onclick="LobbySystem.start('${r.code}')" ${canStart ? '' : 'disabled'}>
               ${canStart ? 'Start game' : 'Need 2+ players'}</button>`
          : `<div class="lobby-waiting">Waiting for the host to start\u2026</div>`}
        <button class="cg-btn secondary" onclick="LobbySystem.leave('${r.code}')">Leave</button>
      </div>`);
  }

  function invite() {
    if (!current) return;
    const text = `Join my game of ${current.gameName} in Kindlewood! Room code: ${current.code}`;
    navigator.clipboard?.writeText(text).then(
      () => _flash('Invite copied!'),
      () => _flash('Code: ' + current.code));
  }

  async function addAI(code, name) {
    try { await _api('/' + code + '/ai/add', { method: 'POST', body: name ? { name } : {} }); }
    catch (e) { _flash(e.message); }
  }
  async function removeAI(code, id) { try { await _api('/' + code + '/ai/remove', { method: 'POST', body: { id } }); } catch (e) { _flash(e.message); } }

  // ── Courtier picker (AI select) ──────────────────────────────────────
  // Flavour for each AI courtier, keyed by the server's roster name. Drop a
  // /assets/images/courtier_<slug>.png in later and the card uses it; until
  // then it falls back to the emoji.
  const COURTIER_META = {
    'Old Bracken': { color: '#8a9a5b', emoji: '🦡', title: 'The Wary Elder',
      blurb: 'Rarely bluffs and slow to trust. He watches the table and calls out the bold — but cross him and he remembers.' },
    'Sly Whisper': { color: '#b06fc9', emoji: '🦊', title: 'The Silver Tongue',
      blurb: 'Spins a bluff at every turn and spreads her mischief wide. Trust nothing she claims — yet she seldom challenges yours.' },
    'Marigold':    { color: '#e0a93b', emoji: '🐇', title: 'The Hoarder',
      blurb: 'Greedy and patient. She piles up acorns and plays it safe, striking only when the odds are hers.' },
    'Thorn':       { color: '#c0503f', emoji: '🐍', title: 'The Vengeful',
      blurb: 'Quick to the dagger and slow to forgive. Strike her once and she will come back for you.' },
  };
  const COURTIER_DEFAULT = { color: '#7a6a52', emoji: '🌿', title: 'Courtier', blurb: 'A courtier of unknown temperament.' };
  const _courtierMeta = name => COURTIER_META[name] || Object.assign({}, COURTIER_DEFAULT, { title: name });

  let _pickerCode = null;
  function _pickerHost() {
    let m = document.getElementById('courtier-picker');
    if (!m) { m = document.createElement('div'); m.id = 'courtier-picker'; m.className = 'courtier-picker-backdrop';
      m.addEventListener('click', e => { if (e.target === m) closeCourtierPicker(); });   // click backdrop to dismiss
      document.body.appendChild(m); }
    return m;
  }
  function openCourtierPicker(code) { _pickerCode = code; _renderCourtierPicker(); }
  function closeCourtierPicker() { _pickerCode = null; const m = document.getElementById('courtier-picker'); if (m) m.classList.remove('open'); }

  function _renderCourtierPicker() {
    if (!_pickerCode) return;
    const room = current;
    if (!room) { closeCourtierPicker(); return; }
    const m = _pickerHost();
    const roster = room.aiRoster || Object.keys(COURTIER_META);
    const seated = new Map();                       // name -> ai player id
    for (const p of room.players) if (p.isAI) seated.set(p.name, p.id);
    const full = room.players.length >= room.maxPlayers;

    const cards = roster.map(name => {
      const meta = _courtierMeta(name);
      const slug = name.toLowerCase().replace(/\s+/g, '_');
      const isSeated = seated.has(name);
      const cls = 'courtier-card' + (isSeated ? ' seated' : (full ? ' disabled' : ''));
      const onclick = (!isSeated && !full) ? ` onclick="LobbySystem.pickCourtier('${_pickerCode}','${_esc(name)}')"` : '';
      const removeBtn = isSeated
        ? `<button class="courtier-remove" title="Remove from the table" onclick="event.stopPropagation();LobbySystem.unpickCourtier('${_pickerCode}','${_esc(name)}')">✕</button>` : '';
      const footer = isSeated ? `<div class="courtier-status seated">Already at the table</div>`
        : full ? `<div class="courtier-status">Table is full</div>`
               : `<div class="courtier-status add">+ Seat this courtier</div>`;
      return `<div class="${cls}" style="--accent:${meta.color}"${onclick}>
          ${removeBtn}
          <div class="courtier-avatar">
            <img src="/assets/images/courtier_${slug}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
            <span class="courtier-emoji">${meta.emoji}</span>
          </div>
          <div class="courtier-name">${_esc(name)}</div>
          <div class="courtier-title">${_esc(meta.title)}</div>
          <div class="courtier-blurb">${_esc(meta.blurb)}</div>
          ${footer}
        </div>`;
    }).join('');

    m.innerHTML = `<div class="courtier-picker-shell">
        <button class="lobby-x" onclick="LobbySystem.closeCourtierPicker()">✕</button>
        <div class="courtier-picker-title">Select a Courtier</div>
        <div class="courtier-picker-sub">Seat an AI rival — each plays a different game.</div>
        <div class="courtier-grid">${cards}</div>
        <div class="courtier-picker-actions"><button class="cg-btn secondary" onclick="LobbySystem.closeCourtierPicker()">Done</button></div>
      </div>`;
    m.classList.add('open');
  }
  // Add / remove flow the room-state refresh through the SSE lobby_update, which
  // re-renders the picker in place (see _handle) — so the grid updates itself.
  function pickCourtier(code, name) { addAI(code, name); }
  function unpickCourtier(code, name) {
    const p = current && current.players.find(x => x.isAI && x.name === name);
    if (p) removeAI(code, p.id);
  }
  async function start(code) { try { await _api('/' + code + '/start', { method: 'POST' }); } catch (e) { _flash(e.message); } }
  async function leave(code) {
    _closeStream();
    try { await _api('/' + code + '/leave', { method: 'POST' }); } catch (e) {}
    const g = _lastGame; current = null; browse(g);
  }

  function _closeStream() { if (es) { es.close(); es = null; } }
  function _error(msg, back) {
    _show(`<div class="lobby-title">Hold on\u2026</div><div class="lobby-empty">${_esc(msg)}</div>
      <div class="lobby-actions"><button class="cg-btn" onclick="(${back ? '' : 'openCardGameMenu'})()">Back</button></div>`);
    if (back) _host().querySelector('.cg-btn').onclick = back;
  }
  function _flash(text) {
    const el = document.createElement('div');
    el.className = 'lobby-flash'; el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function setMyId(id) { myId = id; }

  // Derive our user id from the JWT (same token apiFetch/SSE use). Avoids
  // depending on a gameData field that may not exist.
  function _deriveMyId() {
    // Prefer the identity rehydrated from /api/auth/me on page load.
    if (window._authUser && window._authUser.userId != null) { myId = window._authUser.userId; return; }
    try {
      const t = localStorage.getItem('kw_token');
      if (!t) return;
      const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload && payload.userId != null) myId = payload.userId;
    } catch (e) {}
  }
  _deriveMyId();

  return { register, choose, browse, createForm, create, join, joinByInput,
           invite, start, leave, setMyId, _single, soloChoose, soloStart, addAI, removeAI, close,
           openCourtierPicker, closeCourtierPicker, pickCourtier, unpickCourtier,
           get current() { return current; } };
})();

// Register Squirrel's Stash with the lobby
LobbySystem.register({
  type: 'squirrel',
  name: "Squirrel's Stash",
  minPlayers: 2,
  maxPlayers: 6,
  onSingle: (difficulty) => { if (typeof startSquirrelSolo === 'function') startSquirrelSolo(difficulty || 'smart'); },
  onStart: ({ seats, code, channel, isHost }) => {
    if (typeof startSquirrelMultiplayerNet === 'function')
      startSquirrelMultiplayerNet({ code, channel, seats, isHost: !!isHost });
  },
  onEvent: (msg) => { if (typeof sqOnRoomEvent === 'function') sqOnRoomEvent(msg); },
});

// Register the Briar Court with the lobby
LobbySystem.register({
  type: 'briar',
  name: 'The Briar Court',
  minPlayers: 2,
  maxPlayers: 6,
  onSingle: (difficulty) => { if (typeof startBriarCourtSolo === 'function') startBriarCourtSolo(difficulty || 'smart'); else startCardGame('briar'); },
  onStart: ({ seats, code, channel, isHost }) => {
    // Networked, server-authoritative game. The host's client drives AI seats.
    if (typeof startBriarCourtMultiplayerNet === 'function') {
      startBriarCourtMultiplayerNet({ code, channel, seats, isHost: !!isHost });
    }
  },
  onEvent: (msg) => {
    if (typeof bcOnRoomEvent === 'function') bcOnRoomEvent(msg);
  },
});

// Identity is derived from the JWT inside the module (see _deriveMyId).
