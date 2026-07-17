// ══════════════════════════════════════════════
//  TAVERN SYSTEM — Kindlewood
// ══════════════════════════════════════════════

const INNKEEPER_GREETINGS = [
  "Welcome, traveller! Pull up a stool.",
  "Ah, good to see you! The fire's warm tonight.",
  "Come in, come in! What'll it be?",
  "A fine evening for a visit, friend.",
  "You look like you could use a rest. Sit down!",
  "The hearth is lit and the cards are ready.",
  "Good timing — I just swept the place out.",
  "Welcome back. Your usual spot is open.",
];

const INNKEEPER_SPECIES_EMOJI = {
  mouse: '🐭', badger: '🦡', otter: '🦦',
  mole: '🐾', fox: '🦊', hare: '🐇',
};

// ── Open / Close ──────────────────────────────

async function visitTavern() {
  // Close any other full-screen overlays first
  if (typeof leaveFishingPost === 'function') leaveFishingPost();
  const overlay = document.getElementById('tavern-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  // Reset to main menu
  document.getElementById('tavern-card-menu').style.display = 'none';
  document.getElementById('tavern-game-area').style.display = 'none';
  document.getElementById('tavern-menu').style.display = 'flex';

  // Ensure citizensData is fresh so tavernkeep renders correctly
  if (typeof loadCitizens === 'function') await loadCitizens();
  _renderTavernkeep();
}

function leaveTavern() {
  const overlay = document.getElementById('tavern-overlay');
  if (overlay) overlay.style.display = 'none';
  _currentGame = null;
  if (typeof stopQuestTimers === 'function') stopQuestTimers();
  // Reset quest mode
  if (typeof _questMode !== 'undefined') window._questMode = null;
  const menu = document.getElementById('tavern-menu');
  if (menu) menu.style.display = 'flex';
}

// ── Tavernkeep rendering ───────────────────────

function _renderTavernkeep() {
  const msgEl = document.getElementById('tavern-innkeeper-msg');
  const portraitEl = document.getElementById('tavern-innkeeper-portrait');
  if (!msgEl || !portraitEl) return;

  // Find tavernkeep citizen from gameData
  const citizens = (typeof citizensData !== 'undefined' ? citizensData : []);
  const tavernkeep = citizens.find(c => c.role === 'tavernkeep');

  if (!tavernkeep) {
    portraitEl.textContent = '🪑';
    msgEl.innerHTML = '<em>Nobody is tending the bar.</em> '
      + '<button class="tavern-assign-btn" onclick="openAllCitizens()">Assign a Tavernkeep</button>';
    if (typeof setTavernKeeperSprite === 'function') setTavernKeeperSprite(null);
    return;
  }

  // Prefer the keeper's own species; settlement species is the fallback
  // Species resolution: the citizen's own, then the settlement's,
  // then the legacy top-level field (can be stale after account remakes)
  let species = ((tavernkeep.species || gameData?.settlement?.species || gameData?.species || 'mouse') + '').toLowerCase();
  if (typeof normalizeSpecies === 'function') species = normalizeSpecies(species);
  const emoji = INNKEEPER_SPECIES_EMOJI[species] || '🦔';
  const greeting = INNKEEPER_GREETINGS[Math.floor(Math.random() * INNKEEPER_GREETINGS.length)];

  portraitEl.textContent = emoji;
  msgEl.innerHTML = `<strong>${tavernkeep.name}</strong> says: <em>"${greeting}"</em>`;
  if (typeof setTavernKeeperSprite === 'function') setTavernKeeperSprite(species);
}

// ── Card game menu ────────────────────────────

function openCardGameMenu() {
  document.getElementById('tavern-menu').style.display = 'none';
  document.getElementById('tavern-card-menu').style.display = 'flex';
  document.getElementById('tavern-game-area').style.display = 'none';
}

function closeCardGameMenu() {
  document.getElementById('tavern-card-menu').style.display = 'none';
  document.getElementById('tavern-menu').style.display = 'flex';
}

// ══════════════════════════════════════════════
//  CARD GAMES
// ══════════════════════════════════════════════

let _currentGame = null;

const SUITS = ['🍃','🌰','🍄','🌿'];
const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function _buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const v of VALUES) deck.push({ suit: s, value: v });
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function _cardValue(card) {
  if (['J','Q','K'].includes(card.value)) return 10;
  if (card.value === 'A') return 11;
  return parseInt(card.value);
}

function _cardTotal(hand) {
  let total = hand.reduce((s, c) => s + _cardValue(c), 0);
  // Ace adjustment
  let aces = hand.filter(c => c.value === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function _cardHtml(card, hidden = false) {
  if (hidden) return `<div class="playing-card card-back">🂠</div>`;
  const color = (card.suit === '🍄' || card.suit === '🌰') ? 'card-red' : 'card-green';
  return `<div class="playing-card ${color}">${card.suit}<br>${card.value}</div>`;
}

// ── Award gold ────────────────────────────────

async function _awardGold(amount) {
  if (amount <= 0) return;
  try {
    await apiFetch('/api/game/award-gold', { method: 'POST', body: JSON.stringify({ amount }) });
    if (gameData?.settlement?.resources) gameData.settlement.resources.wealth += amount;
    updateTopbarDisplay?.();
  } catch(e) { console.warn('Gold award failed', e); }
}

// ══════════════════════════════════════════════
//  GAME 1: HIGHLEAF DRAW (Blackjack-lite)
// ══════════════════════════════════════════════

function _startHighleaf() {
  const deck = _buildDeck();
  const hand = [deck.pop(), deck.pop()];
  _currentGame = { type: 'highleaf', deck, hand, over: false };
  _renderHighleaf();
}

function _renderHighleaf(message = '') {
  const g = _currentGame;
  const total = _cardTotal(g.hand);
  const bust = total > 21;
  const area = document.getElementById('tavern-game-area');

  area.innerHTML = `
    <div class="card-game highleaf">
      <div class="card-game-title">🍃 Highleaf Draw</div>
      <div class="card-game-sub">Draw cards. Get as close to 21 as you can without going over.</div>
      <div class="card-game-hand">
        ${g.hand.map(c => _cardHtml(c)).join('')}
      </div>
      <div class="card-game-total ${bust ? 'bust' : total === 21 ? 'blackjack' : ''}">
        Total: <strong>${total}</strong>${bust ? ' — Bust!' : total === 21 ? ' — Highleaf!' : ''}
      </div>
      ${message ? `<div class="card-game-message">${message}</div>` : ''}
      <div class="card-game-actions">
        ${!g.over ? `
          <button class="cg-btn" onclick="highleafHit()">Draw Card</button>
          <button class="cg-btn secondary" onclick="highleafStand()">Stand</button>
        ` : `
          <button class="cg-btn" onclick="startCardGame('highleaf')">Play Again</button>
          <button class="cg-btn secondary" onclick="openCardGameMenu()">← Games</button>
        `}
      </div>
    </div>`;
}

function highleafHit() {
  const g = _currentGame;
  g.hand.push(g.deck.pop());
  const total = _cardTotal(g.hand);
  if (total > 21) {
    g.over = true;
    _renderHighleaf('💨 Bust! Better luck next time.');
  } else if (total === 21) {
    g.over = true;
    const reward = 3;
    _awardGold(reward);
    _renderHighleaf(`🍃 Highleaf! Perfect 21! You win <strong>${reward} gold</strong>!`);
  } else {
    _renderHighleaf();
  }
}

function highleafStand() {
  const g = _currentGame;
  const total = _cardTotal(g.hand);
  g.over = true;

  // House draws to 16
  const houseHand = [g.deck.pop(), g.deck.pop()];
  while (_cardTotal(houseHand) < 16) houseHand.push(g.deck.pop());
  const houseTotal = _cardTotal(houseHand);

  let reward = 0, msg = '';
  const houseBust = houseTotal > 21;

  if (houseBust || total > houseTotal) {
    reward = total >= 18 ? 3 : total >= 15 ? 2 : 1;
    msg = `${houseBust ? '🏠 House busts!' : '🎉 You win!'} You earn <strong>${reward} gold</strong>.`;
  } else if (total === houseTotal) {
    reward = 1;
    msg = `🤝 A draw! You keep your stake — <strong>1 gold</strong>.`;
  } else {
    msg = `🏠 House wins with ${houseTotal}. Better luck next time.`;
  }

  if (reward > 0) _awardGold(reward);

  const area = document.getElementById('tavern-game-area');
  const houseCardsHtml = houseHand.map(c => _cardHtml(c)).join('');
  area.innerHTML = `
    <div class="card-game highleaf">
      <div class="card-game-title">🍃 Highleaf Draw — Result</div>
      <div class="card-game-hands-row">
        <div class="card-game-hand-col">
          <div class="cg-label">Your hand (${total})</div>
          <div class="card-game-hand">${g.hand.map(c => _cardHtml(c)).join('')}</div>
        </div>
        <div class="card-game-hand-col">
          <div class="cg-label">House (${houseTotal})</div>
          <div class="card-game-hand">${houseCardsHtml}</div>
        </div>
      </div>
      <div class="card-game-message">${msg}</div>
      <div class="card-game-actions">
        <button class="cg-btn" onclick="startCardGame('highleaf')">Play Again</button>
        <button class="cg-btn secondary" onclick="openCardGameMenu()">← Games</button>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════
//  GAME 2: MOUSE & GRAIN (3-card high card)
// ══════════════════════════════════════════════

function _startMouseGrain() {
  const deck = _buildDeck();
  const playerHand = [deck.pop(), deck.pop(), deck.pop()];
  const houseHand  = [deck.pop(), deck.pop(), deck.pop()];
  _currentGame = { type: 'mouse_grain', playerHand, houseHand, over: false, revealed: false };
  _renderMouseGrain();
}

function _renderMouseGrain(message = '') {
  const g = _currentGame;
  const area = document.getElementById('tavern-game-area');
  const playerTotal = g.playerHand.reduce((s, c) => s + _cardValue(c), 0);

  area.innerHTML = `
    <div class="card-game mouse-grain">
      <div class="card-game-title">🌾 Mouse &amp; Grain</div>
      <div class="card-game-sub">3 cards each. Highest total wins. You may bluff once.</div>
      <div class="card-game-hands-row">
        <div class="card-game-hand-col">
          <div class="cg-label">Your hand</div>
          <div class="card-game-hand">${g.playerHand.map(c => _cardHtml(c)).join('')}</div>
          <div class="card-game-total">Total: <strong>${playerTotal}</strong></div>
        </div>
        <div class="card-game-hand-col">
          <div class="cg-label">Opponent</div>
          <div class="card-game-hand">
            ${g.revealed
              ? g.houseHand.map(c => _cardHtml(c)).join('')
              : g.houseHand.map(() => _cardHtml(null, true)).join('')
            }
          </div>
          ${g.revealed ? `<div class="card-game-total">Total: <strong>${g.houseHand.reduce((s,c)=>s+_cardValue(c),0)}</strong></div>` : ''}
        </div>
      </div>
      ${message ? `<div class="card-game-message">${message}</div>` : ''}
      <div class="card-game-actions">
        ${!g.over ? `
          <button class="cg-btn" onclick="mouseGrainReveal()">Reveal &amp; Settle</button>
          <button class="cg-btn bluff" onclick="mouseGrainBluff()">🎭 Bluff (+2 to your total)</button>
        ` : `
          <button class="cg-btn" onclick="startCardGame('mouse_grain')">Play Again</button>
          <button class="cg-btn secondary" onclick="openCardGameMenu()">← Games</button>
        `}
      </div>
    </div>`;
}

function mouseGrainReveal(bluffBonus = 0) {
  const g = _currentGame;
  g.revealed = true;
  g.over = true;

  const playerTotal = g.playerHand.reduce((s,c) => s + _cardValue(c), 0) + bluffBonus;
  const houseTotal  = g.houseHand.reduce((s,c) => s + _cardValue(c), 0);

  let reward = 0, msg = '';
  if (playerTotal > houseTotal) {
    reward = playerTotal >= 20 ? 2 : 1;
    msg = `🌾 You win! Your ${playerTotal} beats their ${houseTotal}. <strong>+${reward} gold!</strong>`;
  } else if (playerTotal === houseTotal) {
    reward = 1;
    msg = `🤝 A tie at ${playerTotal}! You each keep a grain. <strong>+1 gold</strong>.`;
  } else {
    msg = `🐭 Their ${houseTotal} beats your ${playerTotal}. The grain goes to the house.`;
  }

  if (reward > 0) _awardGold(reward);
  _renderMouseGrain(msg);
}

function mouseGrainBluff() {
  // Bluff: add 2 to your total but risk being caught (30% chance)
  const caught = Math.random() < 0.3;
  if (caught) {
    _currentGame.over = true;
    _currentGame.revealed = true;
    _renderMouseGrain(`🎭 Caught bluffing! The tavernkeep shakes their head. No gold for you.`);
  } else {
    mouseGrainReveal(2);
  }
}

// ══════════════════════════════════════════════
//  GAME 3: FORAGER'S GAMBLE (push your luck)
// ══════════════════════════════════════════════
//  Draw cards one at a time, banking their value into the basket.
//  Draw a 🍄 and the basket spoils — you lose everything.
//  Bank any time: ≥6 → 1g, ≥16 → 2g, ≥28 → 3g.

function _startForagers() {
  _currentGame = { type: 'foragers', deck: _buildDeck(), drawn: [], pot: 0, over: false };
  _renderForagers();
}

function _foragersReward(pot) {
  return pot >= 28 ? 3 : pot >= 16 ? 2 : pot >= 6 ? 1 : 0;
}

function _renderForagers(message = '') {
  const g = _currentGame;
  const area = document.getElementById('tavern-game-area');
  const reward = _foragersReward(g.pot);
  area.innerHTML = `
    <div class="card-game foragers">
      <div class="card-game-title">🍄 Forager's Gamble</div>
      <div class="card-game-sub">Each draw adds to your basket — but a mushroom spoils the lot.</div>
      <div class="card-game-hand">
        ${g.drawn.length ? g.drawn.map(c => _cardHtml(c)).join('') : '<div class="cg-label">The basket is empty. Draw your first card.</div>'}
      </div>
      <div class="card-game-total ${g.spoiled ? 'bust' : ''}">
        Basket: <strong>${g.pot}</strong>${g.spoiled ? ' — Spoiled!' : reward > 0 ? ` — worth ${reward} gold` : ''}
      </div>
      ${message ? `<div class="card-game-message">${message}</div>` : ''}
      <div class="card-game-actions">
        ${!g.over ? `
          <button class="cg-btn" onclick="foragersDraw()">Draw Card</button>
          <button class="cg-btn secondary" onclick="foragersBank()" ${reward === 0 ? 'disabled' : ''}>Bank ${reward > 0 ? reward + ' gold' : 'winnings'}</button>
        ` : `
          <button class="cg-btn" onclick="startCardGame('foragers')">Play Again</button>
          <button class="cg-btn secondary" onclick="openCardGameMenu()">← Games</button>
        `}
      </div>
    </div>`;
}

function foragersDraw() {
  const g = _currentGame;
  const card = g.deck.pop();
  g.drawn.push(card);
  if (card.suit === '🍄') {
    g.over = true;
    g.spoiled = true;
    g.pot = 0;
    _renderForagers('🍄 A bad mushroom! The whole basket is spoiled.');
  } else {
    g.pot += _cardValue(card);
    _renderForagers();
  }
}

function foragersBank() {
  const g = _currentGame;
  const reward = _foragersReward(g.pot);
  if (reward <= 0 || g.over) return;
  g.over = true;
  _awardGold(reward);
  _renderForagers(`🧺 A fine haul! You bank <strong>${reward} gold</strong>.`);
}

// ══════════════════════════════════════════════
//  GAME 4: THE BRIAR COURT (Coup-style bluffing)
// ══════════════════════════════════════════════
//  You + 4 AI courtiers. Everyone holds 2 hidden roles. Claim roles
//  to act — truthfully or not. Challenges and blocks decide who
//  keeps their seat. Last courtier standing wins 4 gold.
//
//  MULTIPLAYER SEAM: every decision (human or AI) flows through two
//  interfaces — _bcPrompt() for the human, the _bcAi* heuristics for
//  bots. State changes all happen in _bcDoAction / _bcLoseInfluence.
//  A networked version replaces prompts/heuristics with messages and
//  runs the same state transitions server-side.

const BC_ROLES = {
  elder:     { name: 'Elder',      icon: '\u{1F98C}', power: 'Decree (take 3) \u00b7 blocks Gather' },
  adder:     { name: 'Adder',      icon: '\u{1F40D}', power: 'Sting (pay 3, strike a rival)' },
  magpie:    { name: 'Magpie',     icon: '\u{1F426}', power: 'Pilfer (steal 2) \u00b7 blocks Pilfer' },
  owl:       { name: 'Owl',        icon: '\u{1F989}', power: 'Consult (swap cards) \u00b7 blocks Pilfer' },
  hedgewitch:{ name: 'Hedgewitch', icon: '\u{1F33F}', power: 'blocks Sting' },
};
const BC_AI_NAMES = ['Old Bracken', 'Sly Whisper', 'Marigold', 'Thorn'];

let _bc = null;
let _bcResolver = null;
let _bcMultiplayer = null;

// Public entry point — single-player passes nothing, the lobby passes a
// seating descriptor { seats, code, channel }.
function startBriarCourt(seating) { _startBriarCourt(seating); }

function _bcOpenTable() {
  const bd = document.getElementById('bcmp-backdrop');
  if (bd) bd.style.display = 'flex';
  if (typeof startBriarMusic === 'function') startBriarMusic();
  // Populate whisper targets from the human players in the room
  const sel = document.getElementById('bcmp-chat-to');
  if (sel && _bcMultiplayer) {
    const me = _bcMyUserId();
    const humans = (_bcMultiplayer.players || []).filter(p => !p.isAI && String(p.id) !== String(me));
    sel.innerHTML = '<option value="">\u{1F310} All</option>'
      + humans.map(p => `<option value="${p.id}">\u{1F92B} ${p.name}</option>`).join('');
  }
  const log = document.getElementById('bcmp-chat-log');
  if (log) log.innerHTML = '';
  const input = document.getElementById('bcmp-chat-input');
  if (input) {
    input.oninput = () => _bcTyping(true);
    input.onkeydown = e => { if (e.key === 'Enter') bcSendChat(); };
    input.onblur = () => _bcTyping(false);
  }
}

function bcLeaveTable() {
  const bd = document.getElementById('bcmp-backdrop');
  if (bd) bd.style.display = 'none';
  if (typeof stopBriarMusic === 'function') stopBriarMusic();
  clearTimeout(_bcmpAiTimer); _bcmpAiTimer = null;
  clearInterval(_bcmpDeadlineTimer); _bcmpDeadlineTimer = null;
  _bc = null; _bcmp = null; _currentGame = null; _bcMultiplayer = null; _spGame = null;
  const chat = document.getElementById('bcmp-chat'); if (chat) chat.style.display = '';
  if (typeof LobbySystem !== 'undefined') LobbySystem.close();
}

function _bcTyping(on) {
  const m = _bcMultiplayer; if (!m || !m.channel) return;
  if (on) {
    if (!m.typingOn) { m.typingOn = true; m.channel.typing(true); }
    clearTimeout(m.typingTimer);
    m.typingTimer = setTimeout(() => _bcTyping(false), 2500);
  } else {
    clearTimeout(m.typingTimer);
    if (m.typingOn) { m.typingOn = false; m.channel.typing(false); }
  }
}

function bcSendChat() {
  const m = _bcMultiplayer; if (!m || !m.channel) return;
  const input = document.getElementById('bcmp-chat-input');
  const to = document.getElementById('bcmp-chat-to');
  const text = (input.value || '').trim();
  if (!text) return;
  m.channel.chat(text, to.value || null);
  input.value = '';
  _bcTyping(false);
}

// Inbound chat / typing events (routed from lobby.js onEvent)
function bcOnRoomEvent(msg) {
  // Networked game state takes priority (these arrive even before _bc exists)
  if (msg.type === 'game_state') { if (typeof bcmpOnState === 'function') bcmpOnState(msg.state); return; }
  if (msg.type === 'match_over') { if (typeof bcmpOnOver === 'function') bcmpOnOver(msg); return; }
  if (msg.type === 'presence') { if (typeof bcmpOnPresence === 'function') bcmpOnPresence(msg); return; }
  // Host migrated mid-match (§3.3) — recompute our host status so the End /
  // Run-it-back controls appear for the new host.
  if (msg.type === 'host_changed') {
    if (_bcmp) { _bcmp.isHost = String(msg.hostId) === String(_bcmpMyUserId()); _bcmpRender(); }
    return;
  }
  // A disconnected seat was handed to (or reclaimed from) the AI (§3.3). The
  // pushed game_state already carries the new isAI flag; just clear any stale
  // "waiting for them" banner and re-render.
  if (msg.type === 'seat_converted') {
    if (_bcmp) { if (_bcmp.absent) delete _bcmp.absent[msg.seat]; _bcmpRender(); }
    return;
  }
  if (msg.type === 'seat_restored') { if (_bcmp) _bcmpRender(); return; }
  if (!_bc && !_bcmp) return;
  if (msg.type === 'chat') {
    const log = document.getElementById('bcmp-chat-log');
    if (!log) return;
    const mine = String(msg.fromId) === String(_bcMyUserId());
    const whisper = msg.scope === 'whisper';
    const tag = whisper ? '<span class="bcmp-whisper-tag">whisper</span>' : '';
    const who = mine ? 'You' : _esc(msg.fromName);
    const line = document.createElement('div');
    line.className = 'bcmp-chat-line' + (whisper ? ' whisper' : '');
    line.innerHTML = `${tag}<b>${who}:</b> ${_esc(msg.text)}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  } else if (msg.type === 'typing') {
    _bc = _bc || {};
    _bc._typing = _bc._typing || {};
    _bc._typing[msg.userId] = msg.on;
    if (_bcmp) _bcmpRender(); else if (_bc.players) _bcRender();
  }
}

function _bcMyUserId() {
  try {
    const t = localStorage.getItem('kw_token');
    if (!t) return null;
    return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).userId;
  } catch (e) { return null; }
}

function _startBriarCourt(seating) {
  const deck = [];
  for (const r of Object.keys(BC_ROLES)) deck.push(r, r, r);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const mk = (name, isHuman) => ({
    name, isHuman, acorns: 2, alive: true,
    cards: [{ role: deck.pop(), revealed: false }, { role: deck.pop(), revealed: false }],
  });

  let players;
  if (seating && Array.isArray(seating.seats)) {
    // Multiplayer seating. "You" is the seat whose id === our userId.
    // Human ids are numeric; AI ids look like 'ai:Name'. Compare loosely
    // since JWT userId may be number while seat id is string.
    const myId = _bcMyUserId();
    players = seating.seats.map(s => {
      const isYou = !s.isAI && myId != null && String(s.id) === String(myId);
      const p = mk(isYou ? s.name : s.name, !s.isAI && isYou);
      p.seatId = s.id;       // keep for chat targeting
      p.isAI = !!s.isAI;
      p.isYou = isYou;
      return p;
    });
    if (!players.some(p => p.isYou)) {
      // Couldn't match (shouldn't happen) — don't silently mislabel; warn.
      console.warn('Briar Court: could not match your seat; defaulting to seat 0');
      players[0].isHuman = true; players[0].isYou = true;
    }
    _bcMultiplayer = { code: seating.code, channel: seating.channel,
      myName: players.find(p => p.isYou)?.name,
      players: seating.players || [], typingTimer: null, typingOn: false };
    _bcOpenTable();
  } else {
    players = [mk('You', true), ...BC_AI_NAMES.map(n => mk(n, false))];
    players.forEach(p => { p.isYou = p.isHuman; p.isAI = !p.isHuman; });
    _bcMultiplayer = null;
  }

  _bc = {
    deck, players,
    turn: 0, over: false, log: [], help: false, promptHtml: '',
  };
  _currentGame = { type: 'briar' };  // the turn loop's guard checks this
  _bcLog('The Briar Court convenes. Two acorns each \u2014 and two secrets.');
  _bcRender();
  _bcTurnLoop();
}

function _bcLog(msg) {
  _bc.log.push(msg);
  if (_bc.log.length > 30) _bc.log.shift();
}

const _bcSleep = ms => new Promise(r => setTimeout(r, ms));
const _esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

// Sound effects: routes through the game's audio system if it exposes
// playSfx(); otherwise plays directly. Files live in /assets/audio/.
function _bcSfx(file) {
  try {
    if (typeof playSfx === 'function') { playSfx(file); return; }
    const a = new Audio('/assets/audio/' + file);
    a.volume = 0.55;
    a.play().catch(() => {});
  } catch (e) {}
}

// Suspense pause with a thinking bubble over the player's seat
async function _bcThink(p, min, max, texts) {
  const opts = texts || ['{ thinking\u2026 }', '{ counting acorns\u2026 }', '{ eyeing the table\u2026 }', '{ hmm\u2026 }'];
  _bc.thinking = { p, text: opts[Math.floor(Math.random() * opts.length)] };
  _bcRender();
  await _bcSleep(min + Math.random() * (max - min));
  _bc.thinking = null;
  _bcRender();
}
const _bcAlive = () => _bc.players.filter(p => p.alive);
const _bcHidden = p => p.cards.filter(c => !c.revealed);
const _bcHasRole = (p, role) => p.cards.some(c => !c.revealed && c.role === role);

// ── Rendering ─────────────────────────────────

const BC_CARD_IMG = role => `/assets/images/card_${role}.png`;

function _bcCardHtml(card) {
  if (card.revealed) {
    const r = BC_ROLES[card.role];
    return `<div class="bc-card revealed-img" title="${r.name} \u2014 eliminated">
      <img src="${BC_CARD_IMG(card.role)}" alt="${r.name}" onerror="this.replaceWith(this.alt)"></div>`;
  }
  return `<div class="bc-card back">\u2738</div>`;
}

// Your hand: full card art, fanned, enlarges on hover
function _bcHandCardHtml(card) {
  const r = BC_ROLES[card.role];
  return `<div class="bc-hand-card ${card.revealed ? 'dead' : ''}" title="${r.name} \u2014 ${r.power}">
    <img src="${BC_CARD_IMG(card.role)}" alt="${r.icon} ${r.name}" onerror="this.replaceWith(this.alt)">
  </div>`;
}

// Court ledger: 3 copies of each role exist; revealed copies grey out
function _bcTrackerHtml() {
  const dead = {};
  for (const p of _bc.players)
    for (const c of p.cards)
      if (c.revealed) dead[c.role] = (dead[c.role] || 0) + 1;
  return '<div class="bc-tracker" onclick="bcToggleLedger()" title="The Court ledger \u2014 click to inspect. Three of each role exist; greyed copies have been revealed.">'
    + Object.entries(BC_ROLES).map(([k, r]) => {
        const d = dead[k] || 0;
        const pips = [0, 1, 2].map(i => `<span class="bc-pip ${i < d ? 'dead' : ''}"></span>`).join('');
        return `<span class="bc-tracker-role" title="${r.name}: ${3 - d} of 3 remain">${r.icon}${pips}</span>`;
      }).join('')
    + '</div>';
}

function _bcRender(promptHtml) {
  const area = document.getElementById(_bcMultiplayer ? 'bcmp-game' : 'tavern-game-area');
  if (!area || !_bc) return;
  if (promptHtml !== undefined) _bc.promptHtml = promptHtml;
  const me = _bc.players.find(p => p.isYou) || _bc.players[0];
  const current = _bc.players[_bc.turn];

  const helpHtml = !_bc.help ? '' : `
    <div class="bc-help">
      <div class="bc-help-title">How the Court works</div>
      ${Object.entries(BC_ROLES).map(([k, r]) => `<div class="bc-help-row"><img class="bc-mini-card" src="${BC_CARD_IMG(k)}" alt="${r.name}" onclick="bcInspect('${k}')"><b>${r.name}</b><span>${r.power}</span></div>`).join('')}
      <div class="bc-help-row"><b>\u{1F330} Forage</b><span>+1 acorn \u00b7 always safe</span></div>
      <div class="bc-help-row"><b>\u{1F33E} Gather</b><span>+2 \u00b7 anyone may block as Elder</span></div>
      <div class="bc-help-row"><b>\u2696 Banish</b><span>pay 7 \u00b7 unblockable \u00b7 forced at 10 acorns</span></div>
      <div class="bc-help-note">Role actions and blocks are claims \u2014 truthful or not. Anyone may <b>challenge</b> a claim: if the claimant proves it, the challenger loses a card; if they were bluffing, they lose one. Lose both cards and you leave the Court. Last courtier standing wins <b>4 gold</b>.</div>
      <button class="cg-btn secondary" onclick="bcToggleHelp()">Close rules</button>
    </div>`;

  const ledgerHtml = !_bc.ledger ? '' : (() => {
    const dead = {};
    for (const pl of _bc.players)
      for (const c of pl.cards)
        if (c.revealed) dead[c.role] = (dead[c.role] || 0) + 1;
    return `<div class="bc-help bc-ledger-modal">
      <div class="bc-help-title">The Court Ledger</div>
      <div class="bc-ledger-grid">
        ${Object.entries(BC_ROLES).map(([k, r]) => {
          const d = dead[k] || 0;
          return `<div class="bc-ledger-role">
            <div class="bc-ledger-cards">${[0, 1, 2].map(i =>
              `<img class="bc-mini-card ${i < d ? 'dead' : ''}" src="${BC_CARD_IMG(k)}" alt="${r.name}" onclick="bcInspect('${k}')">`).join('')}</div>
            <div class="bc-ledger-name">${r.name} \u00b7 ${3 - d} left</div>
          </div>`;
        }).join('')}
      </div>
      <button class="cg-btn secondary" onclick="bcToggleLedger()">Close ledger</button>
    </div>`;
  })();

  const inspectHtml = !_bc.inspect ? ''
    : `<div class="bc-inspect" onclick="bcInspect('')"><img src="${BC_CARD_IMG(_bc.inspect)}" alt="${BC_ROLES[_bc.inspect].name}"></div>`;

  const seats = _bc.players.filter(p => p !== me).map(p => `
    <div class="bc-seat ${!p.alive ? 'out' : ''} ${p === current ? 'acting' : ''}">
      ${(_bc._typing && p.seatId && _bc._typing[p.seatId]) ? '<div class="bc-bubble whisper">{ whispering\u2026 }</div>' : (_bc.thinking && _bc.thinking.p === p ? `<div class="bc-bubble">${_bc.thinking.text}</div>` : '')}
      <div class="bc-seat-name">${p.name}</div>
      <div class="bc-seat-acorns">\u{1F330} ${p.acorns}</div>
      <div class="bc-seat-cards">${p.cards.map(c => _bcCardHtml(c)).join('')}</div>
    </div>`).join('');

  area.innerHTML = `
    <div class="card-game briar">
      <div class="card-game-title">\u{1F33F} The Briar Court <button class="bc-help-btn" onclick="bcToggleHelp()" title="Rules &amp; roles">?</button>${typeof gameAudioControlHtml === 'function' ? gameAudioControlHtml() : ''}</div>
      ${helpHtml}
      ${ledgerHtml}
      ${inspectHtml}
      <div class="bc-seats">${seats}</div>
      ${_bcTrackerHtml()}
      <div class="bc-log">${_bc.log.slice(-7).map(l => `<div>${l}</div>`).join('')}</div>
      <div class="bc-you ${me === current ? 'acting' : ''} ${!me.alive ? 'out' : ''}">
        <span class="bc-seat-name">${me.isYou ? 'You' : _esc(me.name)}</span>
        <span class="bc-seat-acorns">\u{1F330} ${me.acorns}</span>
      </div>
      <div class="bc-hand">${me.cards.map(c => _bcHandCardHtml(c)).join('')}</div>
      <div class="bc-prompt" id="bc-prompt">${_bc.promptHtml || ''}</div>
    </div>`;
}

// One promise-based prompt; bcChoose() resolves it.
function _bcPrompt(question, options) {
  const html = `<div class="bc-question">${question}</div>
    <div class="bc-options">${options.map(o =>
      `<button class="cg-btn ${o.cls || ''}" onclick="bcChoose('${o.value}')">${o.label}</button>`).join('')}</div>`;
  _bcRender(html);
  return new Promise(res => { _bcResolver = res; });
}
function bcChoose(value) {
  if (_bcResolver) {
    _bc.promptHtml = '';
    const r = _bcResolver; _bcResolver = null; r(value);
  }
}

// Active game state, whichever mode is running (MP redacted view or SP _bc)
function _bcActiveState() {
  if (_bcmp && _bcmp.state) return _bcmp.state;
  if (_bc && _bc.players) return _bc;
  return null;
}

// One body-level overlay element, reused for help / ledger / inspect, so it
// always stacks above the game modal regardless of mode.
function _bcOverlay() {
  let el = document.getElementById('bc-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bc-overlay';
    el.className = 'bc-overlay-backdrop';
    el.onclick = (e) => { if (e.target === el) bcCloseOverlay(); };
    document.body.appendChild(el);
  }
  return el;
}
function bcCloseOverlay() {
  const el = document.getElementById('bc-overlay');
  if (el) { el.classList.remove('open'); el.innerHTML = ''; }
}

function bcToggleHelp() {
  const el = _bcOverlay();
  if (el.classList.contains('open') && el.dataset.kind === 'help') { bcCloseOverlay(); return; }
  el.dataset.kind = 'help';
  el.innerHTML = `<div class="bc-overlay-panel">
    <div class="bc-help-title">How the Court works</div>
    ${Object.entries(BC_ROLES).map(([k, r]) => `<div class="bc-help-row"><img class="bc-mini-card" src="${BC_CARD_IMG(k)}" alt="${r.name}" onclick="bcInspect('${k}')"><b>${r.name}</b><span>${r.power}</span></div>`).join('')}
    <div class="bc-help-row"><span style="min-width:54px">🌰</span><b>Forage</b><span>+1 acorn · always safe</span></div>
    <div class="bc-help-row"><span style="min-width:54px">🌾</span><b>Gather</b><span>+2 · anyone may block as Elder</span></div>
    <div class="bc-help-row"><span style="min-width:54px">⚖</span><b>Banish</b><span>pay 7 · unblockable · forced at 10 acorns</span></div>
    <div class="bc-help-note">Role actions and blocks are claims — true or not. Anyone may <b>challenge</b>: if the claimant proves it, the challenger loses a card; if they bluffed, they do. Lose both cards and you leave the Court. Last courtier standing wins <b>4 gold</b>.</div>
    <button class="cg-btn secondary" onclick="bcCloseOverlay()">Close</button>
  </div>`;
  el.classList.add('open');
}

function bcToggleLedger() {
  const el = _bcOverlay();
  if (el.classList.contains('open') && el.dataset.kind === 'ledger') { bcCloseOverlay(); return; }
  const s = _bcActiveState();
  const dead = {};
  if (s) s.players.forEach(p => p.cards.forEach(c => { if (c.revealed && c.role) dead[c.role] = (dead[c.role] || 0) + 1; }));
  el.dataset.kind = 'ledger';
  el.innerHTML = `<div class="bc-overlay-panel">
    <div class="bc-help-title">The Court Ledger</div>
    <div class="bc-ledger-grid">
      ${Object.entries(BC_ROLES).map(([k, r]) => {
        const d = dead[k] || 0;
        return `<div class="bc-ledger-role">
          <div class="bc-ledger-cards">${[0,1,2].map(i => `<img class="bc-mini-card ${i < d ? 'dead' : ''}" src="${BC_CARD_IMG(k)}" alt="${r.name}" onclick="bcInspect('${k}')">`).join('')}</div>
          <div class="bc-ledger-name">${r.name} · ${3 - d} left</div>
        </div>`;
      }).join('')}
    </div>
    <button class="cg-btn secondary" onclick="bcCloseOverlay()">Close</button>
  </div>`;
  el.classList.add('open');
}

// Full-size single-card inspect, on its own top-most layer
function bcInspect(role) {
  let el = document.getElementById('bc-inspect-layer');
  if (!role) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'bc-inspect-layer';
    el.className = 'bc-inspect';
    el.onclick = () => el.remove();
    document.body.appendChild(el);
  }
  el.innerHTML = `<img src="${BC_CARD_IMG(role)}" alt="${BC_ROLES[role].name}">`;
}

// ── AI heuristics (the other half of the multiplayer seam) ──

function _bcAiChallengeP(ai, role) {
  // Copies the AI can account for: its own hidden + everyone's revealed
  let known = ai.cards.filter(c => !c.revealed && c.role === role).length;
  for (const p of _bc.players) known += p.cards.filter(c => c.revealed && c.role === role).length;
  return [0.15, 0.3, 0.6, 0.9][Math.min(known, 3)];
}

function _bcAiAction(ai) {
  const rivals = _bcAlive().filter(p => p !== ai);
  const target = rivals.reduce((a, b) => (b.acorns > a.acorns ? b : a), rivals[0]);
  if (ai.acorns >= 10) return { action: 'banish', target };
  if (ai.acorns >= 7 && Math.random() < 0.8) return { action: 'banish', target };
  if (ai.acorns >= 3 && (_bcHasRole(ai, 'adder') || Math.random() < 0.1)) return { action: 'sting', target };
  if (_bcHasRole(ai, 'elder') || Math.random() < 0.2) return { action: 'decree' };
  if (_bcHasRole(ai, 'magpie') && target.acorns >= 2 && Math.random() < 0.7) return { action: 'pilfer', target };
  if (_bcHasRole(ai, 'owl') && Math.random() < 0.35) return { action: 'consult' };
  return Math.random() < 0.6 ? { action: 'gather' } : { action: 'forage' };
}

// ── Influence loss / win check ────────────────

async function _bcLoseInfluence(p, why) {
  const hidden = _bcHidden(p);
  if (!hidden.length) return;
  let card;
  if (p.isHuman && hidden.length > 1) {
    const v = await _bcPrompt(`${why} \u2014 choose a card to turn face-up:`,
      hidden.map((c, i) => ({ label: `${BC_ROLES[c.role].icon} ${BC_ROLES[c.role].name}`, value: String(i) })));
    card = hidden[parseInt(v)];
  } else {
    card = hidden[Math.floor(Math.random() * hidden.length)];
  }
  card.revealed = true;
  _bcLog(`${p.name} loses influence \u2014 the ${BC_ROLES[card.role].name} is revealed.`);
  if (!_bcHidden(p).length) {
    p.alive = false;
    _bcLog(`\u{1F342} ${p.name} is cast out of the Court.`);
  }
  _bcRender();
}

function _bcWinner() {
  const alive = _bcAlive();
  return alive.length === 1 ? alive[0] : null;
}

// Return a (possibly proven) card to the deck and redraw
function _bcRecycleRole(p, role) {
  const card = p.cards.find(c => !c.revealed && c.role === role);
  if (!card) return;
  _bc.deck.push(card.role);
  _bc.deck.sort(() => Math.random() - 0.5);
  card.role = _bc.deck.pop();
  _bcSfx('card-flip.wav');
}

// ── Challenge phase ───────────────────────────
// Returns true if the claim DIED (claimant caught bluffing).

async function _bcChallengePhase(claimant, role, claimText) {
  for (const p of _bcAlive()) {
    if (p === claimant) continue;
    let challenges = false;
    if (p.isHuman) {
      const v = await _bcPrompt(`${claimText}. Challenge?`,
        [{ label: '\u2694 Challenge', value: 'yes' }, { label: 'Let it pass', value: 'no', cls: 'secondary' }]);
      challenges = v === 'yes';
    } else {
      challenges = Math.random() < _bcAiChallengeP(p, role);
    }
    if (!challenges) continue;

    _bcLog(`${p.name} challenges ${claimant.name}'s claim to the ${BC_ROLES[role].name}!`);
    await _bcThink(claimant, 900, 2400, ['{ a tense hush falls\u2026 }', '{ all eyes turn\u2026 }', '{ someone swallows hard\u2026 }']);
    if (_bcHasRole(claimant, role)) {
      _bcLog(`${claimant.name} reveals the ${BC_ROLES[role].name} \u2014 the challenge fails.`);
      _bcRecycleRole(claimant, role);
      await _bcLoseInfluence(p, 'A failed challenge');
      return false;
    } else {
      _bcLog(`${claimant.name} was bluffing!`);
      await _bcLoseInfluence(claimant, 'Caught bluffing');
      return true;
    }
  }
  return false;
}

// ── Block phase ───────────────────────────────
// Returns true if the action was blocked.

async function _bcBlockPhase(actor, action, target) {
  // Who may block, and with what
  let blockers = [];
  if (action === 'gather') blockers = _bcAlive().filter(p => p !== actor).map(p => ({ p, roles: ['elder'] }));
  if (action === 'pilfer') blockers = [{ p: target, roles: ['magpie', 'owl'] }];
  if (action === 'sting') blockers = [{ p: target, roles: ['hedgewitch'] }];

  for (const { p, roles } of blockers) {
    if (!p || !p.alive) continue;
    let blockRole = null;
    if (p.isHuman) {
      const opts = roles.map(r => ({ label: `\u{1F6E1} Block as ${BC_ROLES[r].name}`, value: r }));
      opts.push({ label: 'Allow it', value: 'no', cls: 'secondary' });
      const v = await _bcPrompt(`${actor.name} uses ${action.toUpperCase()}${target === p ? ' on you' : ''}. Block?`, opts);
      if (v !== 'no') blockRole = v;
    } else {
      blockRole = roles.find(r => _bcHasRole(p, r)) || (Math.random() < 0.12 ? roles[0] : null);
    }
    if (!blockRole) continue;

    _bcLog(`${p.name} claims the ${BC_ROLES[blockRole].name} to block!`);
    // The actor may challenge the block
    let challenge = false;
    if (actor.isHuman) {
      const v = await _bcPrompt(`${p.name} blocks as the ${BC_ROLES[blockRole].name}. Challenge the block?`,
        [{ label: '\u2694 Challenge', value: 'yes' }, { label: 'Accept the block', value: 'no', cls: 'secondary' }]);
      challenge = v === 'yes';
    } else {
      challenge = Math.random() < _bcAiChallengeP(actor, blockRole);
    }
    if (!challenge) {
      _bcLog('The block stands.');
      if (action === 'pilfer' || action === 'sting') _bcSfx('bowl.wav');
      return true;
    }

    _bcLog(`${actor.name} challenges the block!`);
    await _bcThink(p, 900, 2400, ['{ a tense hush falls\u2026 }', '{ the Court leans in\u2026 }']);
    if (_bcHasRole(p, blockRole)) {
      _bcLog(`${p.name} truly holds the ${BC_ROLES[blockRole].name}.`);
      _bcRecycleRole(p, blockRole);
      await _bcLoseInfluence(actor, 'A failed challenge');
      if (action === 'pilfer' || action === 'sting') _bcSfx('bowl.wav');
      return true;
    } else {
      _bcLog(`${p.name} was bluffing the block!`);
      await _bcLoseInfluence(p, 'Caught bluffing');
      return false;
    }
  }
  return false;
}

// ── Actions ───────────────────────────────────

async function _bcDoAction(actor, action, target) {
  const A = {
    forage:  { cost: 0, claim: null },
    gather:  { cost: 0, claim: null, blockable: true },
    decree:  { cost: 0, claim: 'elder' },
    pilfer:  { cost: 0, claim: 'magpie', blockable: true },
    sting:   { cost: 3, claim: 'adder', blockable: true },
    consult: { cost: 0, claim: 'owl' },
    banish:  { cost: 7, claim: null },
  }[action];

  actor.acorns -= A.cost;  // costs are paid on declaration, Coup-style

  const names = { forage: 'forages (+1 acorn)', gather: 'gathers from the commons (+2)',
    decree: 'issues a Decree (+3)', pilfer: `pilfers from ${target?.name}`,
    sting: `sends the Adder after ${target?.name}`, consult: 'consults the Owl',
    banish: `spends 7 acorns to banish ${target?.name}` };
  _bcLog(`${actor.name} ${names[action]}.`);
  _bcRender();
  await _bcSleep(500);

  if (A.claim) {
    const died = await _bcChallengePhase(actor, A.claim, `${actor.name} claims the ${BC_ROLES[A.claim].name}`);
    if (died || !actor.alive) return;
  }
  if (A.blockable && target !== undefined || action === 'gather') {
    if (A.blockable) {
      const blocked = await _bcBlockPhase(actor, action, target);
      if (blocked || !actor.alive) return;
    }
  }
  if (target && !target.alive && (action === 'pilfer' || action === 'sting' || action === 'banish')) return;

  switch (action) {
    case 'forage': actor.acorns += 1; _bcSfx('coins.mp3'); break;
    case 'gather': actor.acorns += 2; _bcSfx('coins.mp3'); break;
    case 'decree': actor.acorns += 3; _bcSfx('coins.mp3'); break;
    case 'pilfer': {
      const take = Math.min(2, target.acorns);
      target.acorns -= take; actor.acorns += take;
      if (take > 0) _bcSfx('coins.mp3');
      _bcLog(`${actor.name} pilfers ${take} acorn${take === 1 ? '' : 's'} from ${target.name}.`);
      break;
    }
    case 'sting': _bcSfx('stab.wav'); await _bcLoseInfluence(target, 'The Adder strikes'); break;
    case 'banish': await _bcLoseInfluence(target, 'Banished by decree of acorns'); break;
    case 'consult': await _bcConsult(actor); break;
  }
  _bcRender();
}

async function _bcConsult(p) {
  const drawn = [_bc.deck.pop(), _bc.deck.pop()].filter(Boolean);
  const hidden = _bcHidden(p);
  const pool = [...hidden.map(c => c.role), ...drawn];
  let keep = [];
  if (p.isHuman) {
    const need = hidden.length;
    const remaining = [...pool];
    for (let k = 0; k < need; k++) {
      const v = await _bcPrompt(`The Owl shows you the cards. Keep ${need - k} more:`,
        remaining.map((r, i) => ({ label: `${BC_ROLES[r].icon} ${BC_ROLES[r].name}`, value: String(i) })));
      keep.push(remaining.splice(parseInt(v), 1)[0]);
    }
    remaining.forEach(r => _bc.deck.push(r));
  } else {
    const prio = ['elder', 'hedgewitch', 'adder', 'magpie', 'owl'];
    pool.sort((a, b) => prio.indexOf(a) - prio.indexOf(b));
    keep = pool.slice(0, hidden.length);
    pool.slice(hidden.length).forEach(r => _bc.deck.push(r));
  }
  hidden.forEach((c, i) => { c.role = keep[i]; });
  _bc.deck.sort(() => Math.random() - 0.5);
  _bcLog(`${p.name} consults the Owl and rearranges their secrets.`);
}

// ── Turn loop ─────────────────────────────────

async function _bcHumanAction(me) {
  const rivals = _bcAlive().filter(p => p !== me);
  const opts = [];
  if (me.acorns < 10) {
    opts.push({ label: '\u{1F330} Forage (+1)', value: 'forage' });
    opts.push({ label: '\u{1F33E} Gather (+2)', value: 'gather' });
    opts.push({ label: `${BC_ROLES.elder.icon} Decree (+3)`, value: 'decree' });
    opts.push({ label: `${BC_ROLES.magpie.icon} Pilfer 2`, value: 'pilfer' });
    if (me.acorns >= 3) opts.push({ label: `${BC_ROLES.adder.icon} Sting (3)`, value: 'sting' });
    opts.push({ label: `${BC_ROLES.owl.icon} Consult`, value: 'consult' });
  }
  if (me.acorns >= 7) opts.push({ label: '\u2696 Banish (7)', value: 'banish', cls: me.acorns >= 10 ? '' : 'secondary' });

  const action = await _bcPrompt(me.acorns >= 10 ? 'Ten acorns \u2014 you MUST banish someone:' : 'Your move at Court:', opts);

  let target;
  if (['pilfer', 'sting', 'banish'].includes(action)) {
    const v = await _bcPrompt('Choose your target:',
      rivals.map((r, i) => ({ label: `${r.name} (\u{1F330}${r.acorns})`, value: String(i) })));
    target = rivals[parseInt(v)];
  }
  return { action, target };
}

async function _bcTurnLoop() {
  const session = _bc;
  while (!session.over) {
    if (_currentGame?.type !== 'briar' || _bc !== session) return; // left the table
    const p = session.players[session.turn];
    if (p.alive) {
      _bcRender();
      let action, target;
      if (p.isHuman) {
        _bcSfx('next.wav');
        ({ action, target } = await _bcHumanAction(p));
      } else {
        await _bcThink(p, 800, 2200);
        ({ action, target } = _bcAiAction(p));
      }
      await _bcDoAction(p, action, target);

      const w = _bcWinner();
      if (w) {
        session.over = true;
        if (w.isHuman) {
          _awardGold(4);
          _bcSfx('success.mp3');
          _bcLog('\u{1F451} You hold the last seat at the Briar Court! <strong>+4 gold</strong>');
        } else {
          _bcLog(`\u{1F451} ${w.name} holds the last seat. The Court adjourns.`);
        }
        _bcRender(`<div class="bc-options">
          <button class="cg-btn" onclick="startCardGame('briar')">Play Again</button>
          <button class="cg-btn secondary" onclick="openCardGameMenu()">\u2190 Games</button>
        </div>`);
        return;
      }
    }
    session.turn = (session.turn + 1) % session.players.length;
  }
}

// ── Entry point ───────────────────────────────

function startCardGame(type) {
  document.getElementById('tavern-card-menu').style.display = 'none';
  document.getElementById('tavern-menu').style.display = 'none';
  const area = document.getElementById('tavern-game-area');
  area.style.display = 'flex';

  if (type === 'highleaf') _startHighleaf();
  else if (type === 'mouse_grain') _startMouseGrain();
  else if (type === 'foragers') _startForagers();
  else if (type === 'briar') _startBriarCourt();
}

// ── Tavern celebration modal ──────────────────

function showTavernCelebration() {
  const modal = document.getElementById('tavern-cel-modal');
  if (modal) modal.style.display = 'flex';
}

function closeTavernCelebration() {
  const modal = document.getElementById('tavern-cel-modal');
  if (modal) modal.style.display = 'none';
}

// ══════════════════════════════════════════════
//  BRIAR COURT — MULTIPLAYER CLIENT (thin renderer)
// ══════════════════════════════════════════════
//  The server (lib/briar_engine.js) is authoritative. This renders the
//  redacted state it pushes and sends the local player's intents back.
//  AI seats advance on the SERVER clock (lib/game_rooms.js _serverTick); the
//  client never drives AI in multiplayer. A server-enforced per-phase deadline
//  (state.deadlineAt) guarantees no window stalls on an absent player.
//
//  Reuses the single-player visuals: BC_ROLES, BC_CARD_IMG, the .bc-* CSS.

let _bcmp = null;  // { code, channel, seats, mySeat, isHost, state }

function startBriarCourtMultiplayerNet({ code, channel, seats, isHost }) {
  const mySeat = _bcmpMySeat(seats);
  _bcmp = { code, channel, seats, mySeat, isHost, state: null, lastPhaseSig: '', _seenLog: 0 };
  _bcMultiplayer = { code, channel, players: seats };  // chat/typing reuse this
  // Let the lobby close this modal when a rematch drops us back to the room view.
  window.__closeActiveGameModal = _bcmpCloseGameOnly;
  _bcOpenTable();   // big modal + chat dock (from single-player MP path)
  const g = document.getElementById('bcmp-game');
  if (g) g.innerHTML = '<div class="bc-wait">Dealing the Court…</div>';
  // Drain any state that arrived before this setup completed
  if (_bcmpPendingState) { const s = _bcmpPendingState; _bcmpPendingState = null; bcmpOnState(s); }
}
let _bcmpPendingState = null;

function _bcmpMySeat(seats) {
  const me = (window._authUser && window._authUser.userId != null)
    ? window._authUser.userId : _bcMyUserId();
  const s = seats.find(x => !x.isAI && String(x.id) === String(me));
  return s ? s.seat : null;
}

// Inbound game state from the server
function bcmpOnPresence(msg) {
  if (!_bcmp) return;
  _bcmp.absent = _bcmp.absent || {};
  if (msg.present) delete _bcmp.absent[msg.seat];
  else _bcmp.absent[msg.seat] = msg.name;
  _bcmpRender();
}

function bcmpOnState(state) {
  if (!_bcmp) { _bcmpPendingState = state; return; }  // arrived before setup; buffer
  _bcmp.state = state;
  _bcmpRender();

  // Sounds on phase transitions (best-effort, host or not)
  _bcmpSounds(state);

  // Host drives any AI seat the engine is waiting on
  if (_bcmp.isHost) _bcmpMaybeDriveAI(state);
}

// Host-only "Run it back" button (§3.4), plus the always-present Leave.
function _bcmpEndOptions() {
  const rematch = _bcmp && _bcmp.isHost
    ? `<button class="cg-btn" onclick="bcmpRematch()">↻ Run it back</button>` : '';
  return `<div class="bc-options">${rematch}<button class="cg-btn secondary" onclick="bcLeaveTable()">← Leave table</button></div>`;
}

function bcmpOnOver(msg) {
  if (!_bcmp) return;
  if (msg.ended) {
    const g = document.getElementById('bcmp-game');
    if (g) g.innerHTML = '<div class="bc-wait">The host ended the game.</div>'
      + `<div style="justify-content:center;margin-top:12px">${_bcmpEndOptions()}</div>`;
    return;
  }
  const mineWon = msg.winnerSeat === _bcmp.mySeat;
  if (mineWon && typeof _awardGold === 'function') { _awardGold(4); _bcSfx('success.mp3'); }
  const g = document.getElementById('bcmp-game');
  if (g) {
    const banner = mineWon
      ? '👑 You hold the last seat at the Briar Court! <strong>+4 gold</strong>'
      : `👑 ${_esc(msg.winnerName || 'A rival')} holds the last seat.`;
    g.querySelector('.bc-prompt')?.insertAdjacentHTML('beforeend',
      `<div class="card-game-message">${banner}</div>${_bcmpEndOptions()}`);
  }
}

function _bcmpMyUserId() {
  return (window._authUser && window._authUser.userId != null)
    ? window._authUser.userId
    : (typeof _bcMyUserId === 'function' ? _bcMyUserId() : null);
}

// Host runs it back (§3.4): the server resets the room to the lobby and
// broadcasts lobby_update, which reopens the lobby room view. We only close the
// game modal here — the SSE stays open (LobbySystem owns it) so that update
// arrives.
function bcmpRematch() {
  if (!_bcmp || !_bcmp.code) return;
  const code = _bcmp.code;
  apiFetch('/api/rooms/' + code + '/rematch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(r => { if (r && r.ok) _bcmpCloseGameOnly(); }).catch(() => {});
}

// Close the game modal WITHOUT tearing down the lobby SSE (unlike bcLeaveTable,
// which calls LobbySystem.close()). Used on rematch so the lobby can reopen.
function _bcmpCloseGameOnly() {
  const bd = document.getElementById('bcmp-backdrop');
  if (bd) bd.style.display = 'none';
  if (typeof stopBriarMusic === 'function') stopBriarMusic();
  clearTimeout(_bcmpAiTimer); _bcmpAiTimer = null;
  clearInterval(_bcmpDeadlineTimer); _bcmpDeadlineTimer = null;
  _bcmp = null; _spGame = null;
}

// ── Render the server's redacted view ──
function _bcmpRender() {
  const area = document.getElementById('bcmp-game');
  const s = _bcmp && _bcmp.state;
  if (!area || !s) return;

  const meSeat = _bcmp.mySeat;
  const me = s.players.find(p => p.seat === meSeat) || s.players[0];
  const myTurn = s.turnSeat === meSeat && s.phase === 'action';

  const seatHtml = s.players.filter(p => p.seat !== meSeat).map(p => {
    const acting = p.seat === s.turnSeat;
    const typingBubble = (_bc && _bc._typing && p.id && _bc._typing[p.id])
      ? '<div class="bc-bubble whisper">{ whispering… }</div>' : '';
    const rx = _bcReactionClass(p);
    const rxLabel = _bcReactionLabel(p);
    return `<div class="bc-seat ${!p.alive ? 'out' : ''} ${acting ? 'acting' : ''} ${rx}" data-seat="${p.seat}">
      ${typingBubble}
      ${rxLabel ? `<div class="bc-seat-react">${rxLabel}</div>` : ''}
      <div class="bc-seat-name">${_esc(p.name)}${p.isAI ? ' <span class="lobby-ai-tag">AI</span>' : ''}</div>
      <div class="bc-seat-acorns">🌰 ${p.acorns}</div>
      <div class="bc-seat-cards">${p.cards.map(c => _bcmpCardHtml(c)).join('')}</div>
    </div>`;
  }).join('');

  const prompt = _bcmpPrompt(s, me, myTurn);

  const absent = _bcmp.absent && Object.keys(_bcmp.absent).length ? Object.values(_bcmp.absent) : null;
  const absentBanner = absent ? `<div class="bcmp-absent">⚠ ${absent.map(_esc).join(', ')} disconnected — waiting for them to return…${_bcmp.isHost ? ' <button class="cg-btn secondary" onclick="bcmpEndGame()">End game</button>' : ''}</div>` : '';
  area.innerHTML = `
    <div class="card-game briar">
      <div class="card-game-title">🌿 The Briar Court <button class="bc-help-btn" onclick="bcToggleHelp()">?</button>${typeof gameAudioControlHtml === 'function' ? gameAudioControlHtml() : ''}</div>
      ${absentBanner}
      <div class="bc-seats">${seatHtml}</div>
      ${_bcmpTracker(s)}
      <div class="bc-log">${s.log.map(l => `<div>${l}</div>`).join('')}</div>
      <div class="bc-you ${s.turnSeat === meSeat ? 'acting' : ''} ${!me.alive ? 'out' : ''}">
        <span class="bc-seat-name">You</span>
        <span class="bc-seat-acorns">🌰 ${me.acorns}</span>
      </div>
      <div class="bc-hand">${me.cards.map(c => _bcmpHandCard(c)).join('')}</div>
      <div id="bcmp-deadline" class="bcmp-deadline">${_bcmpDeadlineText(s)}</div>
      <div class="bc-prompt">${prompt}</div>
    </div>`;
  const lg = area.querySelector('.bc-log');
  if (lg) lg.scrollTop = lg.scrollHeight;
  _bcApplyPassTints(s);
  _bcFlashFromLog(s);
  _bcmpEnsureDeadlineTimer();
}

// ── Decision-timer countdown (§3.2) ──
// The server stamps deadlineAt onto each pushed multiplayer state (solo has no
// server clock, so deadlineAt is absent and no countdown shows). A single 500ms
// interval refreshes just the countdown text IN PLACE — the element is always
// present and keeps a reserved height (CSS min-height), never toggling display,
// so the modal doesn't expand/contract as it ticks or re-renders.
let _bcmpDeadlineTimer = null;
function _bcmpDeadlineText(s) {
  if (!s || s.phase === 'gameover' || !s.deadlineAt) return '';
  const remain = Math.max(0, Math.ceil((s.deadlineAt - Date.now()) / 1000));
  return `⏳ auto-resolves in ${remain}s`;
}
function _bcmpEnsureDeadlineTimer() {
  if (_bcmpDeadlineTimer) return;
  _bcmpDeadlineTimer = setInterval(_bcmpUpdateDeadline, 500);
}
function _bcmpUpdateDeadline() {
  const el = document.getElementById('bcmp-deadline');
  if (!el) { clearInterval(_bcmpDeadlineTimer); _bcmpDeadlineTimer = null; return; }
  const s = _bcmp && _bcmp.state;
  const text = _bcmpDeadlineText(s);
  if (el.textContent !== text) el.textContent = text;   // update in place, no reflow of the whole modal
  const remain = (s && s.deadlineAt) ? Math.ceil((s.deadlineAt - Date.now()) / 1000) : 999;
  el.className = 'bcmp-deadline' + (text && remain <= 5 ? ' urgent' : '');
}

function _bcReactionClass(p) {
  if (!p.reaction) return '';
  return { passed: 'react-passed', challenging: 'react-challenge', blocking: 'react-block' }[p.reaction] || '';
}
function _bcReactionLabel(p) {
  return { passed: '✓ Passed', challenging: '⚔ Challenging', blocking: '🛡 Blocking' }[p.reaction] || '';
}

// After each render, scan the newest log line for a just-resolved challenge
// and briefly flash the loser's seat red. Tracked so we only flash once.
// Drive ALL reaction tints from the log, since challenges resolve too fast
// for a mid-challenge state to ever be pushed. We scan log lines added since
// the last render and flash the relevant seat the relevant colour.
function _bcFlashFromLog(s) {
  if (!s || !s.log || !s.log.length) return;
  if (!_bcmp._seenLog) _bcmp._seenLog = 0;
  // Only react to genuinely new lines (the log is a sliding window of ~14)
  const newLines = s.log.slice(_bcmp._seenLog);
  _bcmp._seenLog = s.log.length;

  const seatByName = who => s.players.find(p =>
    p.name === who || (p.seat === _bcmp.mySeat && who === 'You'));
  const flash = (seat, cls, ms) => {
    if (!seat) return;
    const el = document.querySelector(`#bcmp-game .bc-seat[data-seat="${seat.seat}"]`);
    if (!el) return;  // it's our own seat (not rendered as a .bc-seat) or gone
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms || 1100);
  };

  for (const line of newLines) {
    let m;
    if ((m = line.match(/^(.+?) challenges /))) {
      flash(seatByName(m[1]), 'react-challenge', 1300);     // purple
    } else if ((m = line.match(/^(.+?) claims the .+ to block/))) {
      flash(seatByName(m[1]), 'react-block', 1300);          // blue
    } else if ((m = line.match(/^(.+?) (was bluffing|loses influence|is cast out)/))) {
      flash(seatByName(m[1]), 'react-fail', 900);            // red
    } else if ((m = line.match(/^The (block stands|challenge fails)/))) {
      // a successful defence — briefly green the actor/blocker if we can tell
    }
  }
}

// When several players PASS (no log line per pass), tint passers green from
// the pushed reaction state — brief but better than nothing.
function _bcApplyPassTints(s) {
  if (!s) return;
  for (const p of s.players) {
    if (p.reaction === 'passed') {
      const el = document.querySelector(`#bcmp-game .bc-seat[data-seat="${p.seat}"]`);
      if (el) el.classList.add('react-passed');
    }
  }
}

function _bcmpCardHtml(c) {
  if (c.revealed && c.role) {
    return `<div class="bc-card revealed-img"><img src="${BC_CARD_IMG(c.role)}" alt="${BC_ROLES[c.role].name}"></div>`;
  }
  return `<div class="bc-card back">✸</div>`;
}
function _bcmpHandCard(c) {
  if (!c.role) return `<div class="bc-hand-card back-lg">✸</div>`;
  const r = BC_ROLES[c.role];
  return `<div class="bc-hand-card ${c.revealed ? 'dead' : ''}" title="${r.name} — ${r.power}">
    <img src="${BC_CARD_IMG(c.role)}" alt="${r.name}"></div>`;
}
function _bcmpTracker(s) {
  const dead = {};
  s.players.forEach(p => p.cards.forEach(c => { if (c.revealed && c.role) dead[c.role] = (dead[c.role] || 0) + 1; }));
  return '<div class="bc-tracker" onclick="bcToggleLedger()" title="The Court ledger">'
    + Object.entries(BC_ROLES).map(([k, r]) => {
        const d = dead[k] || 0;
        const pips = [0, 1, 2].map(i => `<span class="bc-pip ${i < d ? 'dead' : ''}"></span>`).join('');
        return `<span class="bc-tracker-role">${r.icon}${pips}</span>`;
      }).join('') + '</div>';
}

// ── Decide what this player can do in the current phase ──
function _bcmpPrompt(s, me, myTurn) {
  if (!me.alive) return '<div class="bc-question">You have been cast out. Watch the Court conclude…</div>';
  const P = s.pending;

  // My action turn
  if (myTurn) {
    const rivals = s.players.filter(p => p.alive && p.seat !== me.seat);
    const opts = [];
    if (me.acorns < 10) {
      opts.push(_b('🌰 Forage (+1)', `bcmpAct('forage')`));
      opts.push(_b('🌾 Gather (+2)', `bcmpAct('gather')`));
      opts.push(_b(`${BC_ROLES.elder.icon} Decree (+3)`, `bcmpAct('decree')`));
      opts.push(_b(`${BC_ROLES.magpie.icon} Pilfer`, `bcmpTarget('pilfer')`));
      if (me.acorns >= 3) opts.push(_b(`${BC_ROLES.adder.icon} Sting (3)`, `bcmpTarget('sting')`));
      opts.push(_b(`${BC_ROLES.owl.icon} Consult`, `bcmpAct('consult')`));
    }
    if (me.acorns >= 7) opts.push(_b('⚖ Banish (7)', `bcmpTarget('banish')`));
    const q = me.acorns >= 10 ? 'Ten acorns — you MUST banish someone:' : 'Your move at Court:';
    return `<div class="bc-question">${q}</div><div class="bc-options">${opts.join('')}</div>`;
  }

  if (!P) return _waiting(s);

  // Challenge an action claim (anyone but the actor who hasn't yet decided)
  if (s.phase === 'challengeAction' && P.actorSeat !== me.seat && !(P.passes || []).includes(me.seat)) {
    const actor = s.players.find(p => p.seat === P.actorSeat);
    return `<div class="bc-question">${_esc(actor.name)} claims the ${BC_ROLES[P.claim].name}. Challenge?</div>
      <div class="bc-options">${_b('⚔ Challenge', `bcmpReact('challengeAction',true)`)}${_b('Let it pass', `bcmpReact('challengeAction',false)`, 'secondary')}</div>`;
  }

  // Block (only eligible blocker who hasn't passed)
  if (s.phase === 'block' && _bcmpCanBlock(s, me) && !(P.passes || []).includes(me.seat)) {
    const actor = s.players.find(p => p.seat === P.actorSeat);
    const roles = P.action === 'gather' ? ['elder'] : (P.action === 'pilfer' ? ['magpie', 'owl'] : ['hedgewitch']);
    const onYou = P.targetSeat === me.seat;
    const opts = roles.map(r => _b(`🛡 Block as ${BC_ROLES[r].name}`, `bcmpBlock('${r}')`)).join('')
      + _b('Allow it', `bcmpBlock('')`, 'secondary');
    return `<div class="bc-question">${_esc(actor.name)} uses ${P.action.toUpperCase()}${onYou ? ' on you' : ''}. Block?</div><div class="bc-options">${opts}</div>`;
  }

  // Challenge a block (only the actor decides)
  if (s.phase === 'challengeBlock' && P.actorSeat === me.seat) {
    const blocker = s.players.find(p => p.seat === P.blockerSeat);
    return `<div class="bc-question">${_esc(blocker.name)} blocks as the ${BC_ROLES[P.blockRole].name}. Challenge the block?</div>
      <div class="bc-options">${_b('⚔ Challenge', `bcmpReact('challengeBlock',true)`)}${_b('Accept', `bcmpReact('challengeBlock',false)`, 'secondary')}</div>`;
  }

  // Lose influence (only the loser)
  if (s.phase === 'loseInfluence' && P.loserSeat === me.seat) {
    const hidden = me.cards.map((c, i) => ({ c, i })).filter(x => !x.c.revealed && x.c.role);
    return `<div class="bc-question">${_esc(P.why || 'Choose a card to reveal')}:</div>
      <div class="bc-options">${hidden.map(x => _b(`${BC_ROLES[x.c.role].icon} ${BC_ROLES[x.c.role].name}`, `bcmpLose(${x.i})`)).join('')}</div>`;
  }

  // Consult (Owl) — only the actor, with the revealed pool
  if (s.phase === 'consult' && P.actorSeat === me.seat && P.consultPool) {
    return _bcmpConsultPrompt(P);
  }

  return _waiting(s);
}

function _waiting(s) {
  const who = s.players.find(p => p.seat === s.turnSeat);
  const phaseLabel = {
    action: `Waiting for ${who ? who.name : 'a player'}…`,
    challengeAction: 'Awaiting challenges…',
    block: 'Awaiting a possible block…',
    challengeBlock: 'Awaiting the challenge decision…',
    loseInfluence: 'A courtier is choosing what to reveal…',
    consult: 'The Owl is consulted…',
  }[s.phase] || 'Waiting…';
  return `<div class="bc-question bc-waiting">${phaseLabel}</div>`;
}

function _bcmpConsultPrompt(P) {
  // Pick `consultKeep` of the pool. Simple multi-step: tap to keep.
  _bcmp._consultKeep = _bcmp._consultKeep || [];
  const chosen = _bcmp._consultKeep;
  const need = P.consultKeep;
  const cards = P.consultPool.map((r, i) => {
    const sel = chosen.includes(i) ? ' selected' : '';
    return `<div class="bc-hand-card${sel}" onclick="bcmpConsultPick(${i})" title="${BC_ROLES[r].name}">
      <img src="${BC_CARD_IMG(r)}" alt="${BC_ROLES[r].name}"></div>`;
  }).join('');
  const ready = chosen.length === need;
  return `<div class="bc-question">The Owl shows you the cards. Keep ${need} (${chosen.length}/${need} chosen):</div>
    <div class="bc-hand" style="position:static">${cards}</div>
    <div class="bc-options">${_b('Confirm', `bcmpConsultConfirm()`, ready ? '' : 'secondary disabled')}</div>`;
}
function bcmpConsultPick(i) {
  const k = _bcmp._consultKeep = _bcmp._consultKeep || [];
  const at = k.indexOf(i);
  const need = _bcmp.state.pending.consultKeep;
  if (at >= 0) k.splice(at, 1);
  else if (k.length < need) k.push(i);
  _bcmpRender();
}
function bcmpEndGame() {
  if (!_bcmp) return;
  apiFetch('/api/rooms/' + _bcmp.code + '/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
}

function bcmpConsultConfirm() {
  const k = _bcmp._consultKeep || [];
  if (k.length !== _bcmp.state.pending.consultKeep) return;
  _bcmp.channel.send({ kind: 'consult', keepIndices: k });
  _bcmp._consultKeep = [];
}

const _b = (label, onclick, cls) => `<button class="cg-btn ${cls || ''}" onclick="${onclick}">${label}</button>`;

// Optimistic feedback: replace my prompt with a waiting note the instant I
// act, so I'm not left staring at live buttons until everyone else clicks.
function _bcmpAwait(text) {
  // Solo applies intents synchronously and re-renders the correct next state,
  // so an await message would just clobber it. Only show it in multiplayer,
  // where there's a real network round-trip to wait on.
  if (_bcmp && _bcmp.solo) return;
  const el = document.querySelector('#bcmp-game .bc-prompt');
  if (el) el.innerHTML = `<div class="bc-question bc-waiting">${_esc(text)}</div>`;
}

function _bcmpCanBlock(s, me) {
  const P = s.pending;
  if (P.action === 'gather') return me.seat !== P.actorSeat && me.alive;
  return P.targetSeat === me.seat;  // pilfer / sting target
}

// ── Send intents ──
function bcmpAct(action) { _bcmp.channel.send({ kind: 'action', action }); _bcmpAwait('Your move is in…'); }
function bcmpReact(kind, challenge) {
  _bcmp.channel.send({ kind, challenge });
  _bcmpAwait(challenge ? 'Your challenge is in…' : 'You let it pass. Waiting for the others to decide…');
}
function bcmpBlock(role) {
  _bcmp.channel.send({ kind: 'block', blockRole: role || null });
  _bcmpAwait(role ? 'You declare your block…' : 'You allow it. Waiting for the others…');
}
function bcmpLose(i) { _bcmp.channel.send({ kind: 'loseInfluence', cardIndex: i }); }

// Targeted action: ask for a target first
function bcmpTarget(action) {
  const s = _bcmp.state;
  const rivals = s.players.filter(p => p.alive && p.seat !== _bcmp.mySeat);
  const area = document.querySelector('#bcmp-game .bc-prompt');
  if (!area) return;
  area.innerHTML = `<div class="bc-question">Choose a target for ${action}:</div>
    <div class="bc-options">${rivals.map(r => _b(`${_esc(r.name)} (🌰${r.acorns})`, `bcmpActOn('${action}',${r.seat})`)).join('')}
    ${_b('← Back', 'bcmpBack()', 'secondary')}</div>`;
}
function bcmpActOn(action, targetSeat) { _bcmp.channel.send({ kind: 'action', action, targetSeat }); _bcmpAwait('Your move is in…'); }
function bcmpBack() { _bcmpRender(); }

// ── AI driver (SOLO ONLY) ──
// In multiplayer, AI seats advance on the SERVER clock (lib/game_rooms.js
// _serverTick) — the client no longer pings /ai-action. This tick only runs
// for solo, where the whole engine lives in the browser. "Who's next" comes
// straight from the shared engine (pendingSeats), so there is no client-side
// mirror of the server's logic to drift out of sync.
let _bcmpAiTimer = null;
function _bcmpMaybeDriveAI(s) {
  clearTimeout(_bcmpAiTimer);
  if (!_bcmp || !_bcmp.solo || !_spGame) return;   // multiplayer: server drives
  if (!s || s.phase === 'gameover') return;
  const seat = window.BriarEngine.pendingSeats(_spGame).find(seatNo => {
    const o = _bcmp.seats.find(x => x.seat === seatNo);
    return o && o.isAI;
  });
  if (seat == null) return;
  _bcmpAiTimer = setTimeout(() => {
    if (!_bcmp || !_bcmp.solo || !_spGame) return;
    const d = window.BriarEngine.aiResolve(_spGame, seat);
    if (d) _spApplyAiLocal(seat, d);
  }, 1400 + Math.random() * 1800);
}

// ── Sounds on transitions ──
function _bcmpSounds(s) {
  const sig = s.phase + ':' + (s.pending ? s.pending.action : '') + ':' + s.log.length;
  if (sig === _bcmp.lastPhaseSig) return;
  _bcmp.lastPhaseSig = sig;
  const last = s.log[s.log.length - 1] || '';
  if (/pilfers|\+\d|Decree|gathers|forages/.test(last)) _bcSfx('coins.mp3');
  if (/Adder strikes|Sting/.test(last)) _bcSfx('stab.wav');
  if (/block stands|truly holds/.test(last)) _bcSfx('bowl.wav');
  if (s.turnSeat === _bcmp.mySeat && s.phase === 'action') _bcSfx('next.wav');
}

// ══════════════════════════════════════════════
//  SINGLE-PLAYER on the shared engine (local)
// ══════════════════════════════════════════════
//  Runs window.BriarEngine entirely in the browser: you are seat 0, the
//  rest are AI played locally. Reuses the bcmp renderer by feeding it the
//  engine's redacted view() — identical visuals & rules to multiplayer,
//  one source of truth. Difficulty: 'smart' | 'simple'.

let _spGame = null;

// Record a finished game for stats/leaderboards. Solo posts here directly;
// multiplayer is recorded authoritatively on the server in finishMatch.
function _bcRecordResult(won, mode, difficulty) {
  try {
    apiFetch('/api/stats/record', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'briar', won: !!won, mode: mode || 'solo', difficulty }),
    }).catch(() => {});
  } catch (e) {}
}


// SINGLE-PLAYER reuses the EXACT multiplayer machinery. The only difference
// is the channel: instead of POSTing to the server, it applies intents to a
// local BriarEngine instance, then re-pushes state — identical to how the
// server pushes game_state. AI is driven by the same _bcmpMaybeDriveAI tick;
// in solo mode that tick resolves locally. One code path, no divergence.
function startBriarCourtSolo(difficulty) {
  if (!window.BriarEngine) { console.error('BriarEngine not loaded'); return; }
  const names = ['Old Bracken', 'Sly Whisper', 'Marigold', 'Thorn'];
  const seats = [
    { seat: 0, id: 'you', name: 'You', isAI: false },
    ...names.slice(0, 3).map((n, i) => ({ seat: i + 1, id: 'ai' + i, name: n, isAI: true })),
  ];
  _spGame = window.BriarEngine.create(seats, { difficulty: difficulty || 'smart' });

  // Local channel mirrors the network one. send() applies my intent to the
  // local engine and re-pushes state, exactly like the server round-trip.
  const channel = {
    send: (payload) => { _spApplyLocal(0, payload); },
    chat: () => {}, typing: () => {},
  };
  _bcmp = { code: null, channel, seats, mySeat: 0, isHost: true, state: null,
            lastPhaseSig: '', solo: true, _seenLog: 0, difficulty: difficulty || 'smart' };
  _bcMultiplayer = null;
  _bcOpenTable();
  const chat = document.getElementById('bcmp-chat');
  if (chat) chat.style.display = 'none';
  _spPushLocal();          // first state → render + (maybe) start the AI tick
}

// Push the local engine's redacted view through the SAME handler the network
// uses, so rendering / sounds / AI-driving are 100% shared with multiplayer.
function _spPushLocal() {
  if (!_spGame || !_bcmp) return;
  const view = window.BriarEngine.view(_spGame, 'you');
  bcmpOnState(view);       // ← shared MP path: renders, sounds, drives AI
}

// Apply a HUMAN intent to the local engine (seat 0), then re-push.
function _spApplyLocal(seat, payload) {
  const g = _spGame, E = window.BriarEngine;
  _spDispatch(g, E, seat, payload);
  _spPushLocal();
  if (g.phase === 'gameover') _spOver();
}

// Apply an AI intent to the local engine (called by the shared AI tick).
function _spApplyAiLocal(seat, payload) {
  const g = _spGame, E = window.BriarEngine;
  _spDispatch(g, E, seat, payload);
  _spPushLocal();
  if (g.phase === 'gameover') _spOver();
}

function _spDispatch(g, E, seat, payload) {
  switch (payload.kind) {
    case 'action': E.doAction(g, seat, payload.action, payload.targetSeat); break;
    case 'challengeAction': E.challengeAction(g, seat, !!payload.challenge); break;
    case 'block': E.block(g, seat, payload.blockRole || null); break;
    case 'challengeBlock': E.challengeBlock(g, seat, !!payload.challenge); break;
    case 'loseInfluence': E.resolveLoss(g, seat, payload.cardIndex | 0); break;
    case 'consult': E.resolveConsult(g, seat, payload.keepIndices || []); break;
  }
}

function _spOver() {
  const g = _spGame;
  const won = g.winner === 0;
  if (won && typeof _awardGold === 'function') { _awardGold(4); _bcSfx('success.mp3'); }
  // Record the result for stats/leaderboards (best-effort, fire and forget)
  _bcRecordResult(won, 'solo', _bcmp.difficulty);
  const area = document.getElementById('bcmp-game');
  if (area) {
    const banner = won
      ? '👑 You hold the last seat at the Briar Court! <strong>+4 gold</strong>'
      : `👑 ${_esc((g.players.find(p=>p.seat===g.winner)||{}).name || 'A rival')} holds the last seat.`;
    const p = area.querySelector('.bc-prompt');
    if (p) p.innerHTML = `<div class="card-game-message">${banner}</div>
      <div class="bc-options">
        <button class="cg-btn" onclick="startBriarCourtSolo('${g.difficulty}')">Play Again</button>
        <button class="cg-btn secondary" onclick="bcLeaveTable()">← Leave</button>
      </div>`;
  }
}

// ══════════════════════════════════════════════
//  BRIAR COURT — background music
//  Loops briar1.mp3 / briar2.mp3, random first track. Respects the
//  game's music-volume slider; ducks main music while a Court is open.
// ══════════════════════════════════════════════
let _briarMusic = null;
let _briarMusicWasPlaying = false;

function _briarVolume() {
  if (typeof getMusicVolume === 'function') return getMusicVolume();
  const v = document.getElementById('music-volume');
  return v ? parseFloat(v.value) : 0.4;
}

function startBriarMusic() {
  if (_briarMusic) return;
  if (typeof stopMenuMusic === 'function') stopMenuMusic();
  const tracks = ['briar1.mp3', 'briar2.mp3'];
  let idx = Math.floor(Math.random() * tracks.length); // random first track
  // Duck the main game music if it's playing
  try {
    const main = document.getElementById('bg-music') || document.querySelector('audio#music, audio.bg-music');
    if (main && !main.paused) { _briarMusicWasPlaying = true; main.pause(); }
  } catch (e) {}

  const a = new Audio('/assets/audio/' + tracks[idx]);
  a.volume = _briarVolume();
  a.addEventListener('ended', () => {
    idx = (idx + 1) % tracks.length;       // loop through both, alternating
    a.src = '/assets/audio/' + tracks[idx];
    a.volume = _briarVolume();
    a.play().catch(() => {});
  });
  a.play().catch(() => {});  // may be blocked until a click; that's fine
  _briarMusic = a;

  // Live-follow volume from either slider via the global event from audio.js
  _briarMusic._volHandler = () => { if (_briarMusic) _briarMusic.volume = _briarVolume(); };
  window.addEventListener('kw-music-volume', _briarMusic._volHandler);
  const slider = document.getElementById('music-volume');
  if (slider) slider.addEventListener('input', _briarMusic._volHandler);
}

function stopBriarMusic() {
  if (!_briarMusic) return;
  try {
    const slider = document.getElementById('music-volume');
    if (slider && _briarMusic._volHandler) slider.removeEventListener('input', _briarMusic._volHandler);
    if (_briarMusic._volHandler) window.removeEventListener('kw-music-volume', _briarMusic._volHandler);
    _briarMusic.pause();
  } catch (e) {}
  _briarMusic = null;
  // Resume main music if we ducked it
  if (_briarMusicWasPlaying) {
    _briarMusicWasPlaying = false;
    try {
      const main = document.getElementById('bg-music') || document.querySelector('audio#music, audio.bg-music');
      if (main) main.play().catch(() => {});
    } catch (e) {}
  }
}

// ══════════════════════════════════════════════
//  SQUIRREL'S STASH — client renderer (thin)
// ══════════════════════════════════════════════
//  Renders the server's (or local engine's) public view. Single-player and
//  multiplayer share this exact path, mirroring the Briar approach. Stashes
//  are PUBLIC — everyone's cards are face-up.

let _sq = null;            // { code, channel, seats, mySeat, isHost, state, solo }
let _sqGame = null;        // local engine instance (solo only)
let _sqPendingState = null;

function _sqImgKey(c) {
  const map = { number: String(c.num), lucky7: '7', rotten: 'rotten', golden: '20',
    magpie: 'magpie', burrow: 'burrow', pact: 'pact', badger: 'badger',
    squirrel: 'squirrel', storm: 'storm', foxdare: 'fox' };
  return map[c.kind] || 'back';
}
const SQ_IMG = c => {
  // Filenames match the uploaded asset names:
  //   numbers sq_1..sq_10, golden sq_20, lucky seven sq_7, fox's dare sq_fox.
  const map = {
    number: String(c.num), lucky7: '7', rotten: 'rotten', golden: '20',
    magpie: 'magpie', burrow: 'burrow', pact: 'pact', badger: 'badger',
    squirrel: 'squirrel', storm: 'storm', foxdare: 'fox',
  };
  return '/assets/images/sq_' + (map[c.kind] || 'back') + '.png';
};

// ── Entry points ──
function startSquirrelSolo(difficulty) {
  if (!window.SquirrelEngine) {
    console.error('SquirrelEngine not loaded — deploy js/squirrel_engine.js');
    alert('This game is still loading. Please refresh and try again.');
    return;
  }
  const names = ['Old Bracken', 'Sly Whisper', 'Marigold', 'Thorn'];
  const seats = [
    { seat: 0, id: 'you', name: 'You', isAI: false },
    ...names.slice(0, 3).map((n, i) => ({ seat: i + 1, id: 'ai' + i, name: n, isAI: true })),
  ];
  _sqGame = window.SquirrelEngine.create(seats, { difficulty: difficulty || 'smart' });
  const channel = { send: (p) => _sqApplyLocal(0, p), chat: () => {}, typing: () => {} };
  _sq = { code: null, channel, seats, mySeat: 0, isHost: true, state: null, solo: true, difficulty };
  _sqOpenTable();
  _sqPushLocal();
}

function startSquirrelMultiplayerNet({ code, channel, seats, isHost }) {
  const me = (window._authUser && window._authUser.userId != null) ? window._authUser.userId : (typeof _bcMyUserId === 'function' ? _bcMyUserId() : null);
  const mine = seats.find(s => !s.isAI && String(s.id) === String(me));
  _sq = { code, channel, seats, mySeat: mine ? mine.seat : null, isHost, state: null, solo: false };
  _sqOpenTable();
  _sqStartCursorBroadcast();
  const g = document.getElementById('sq-game');
  if (g) g.innerHTML = '<div class="sq-wait">Tipping out the pile…</div>';
  if (_sqPendingState) { const s = _sqPendingState; _sqPendingState = null; sqOnState(s); }
}

function sqOnRoomEvent(msg) {
  if (msg.type === 'game_state') { sqOnState(msg.state); return; }
  if (msg.type === 'match_over') { sqOnOver(msg); return; }
  if (msg.type === 'cursor') { _sqRemoteCursor(msg); return; }
}

// ── Multiplayer cursors ──────────────────────────────────────────────────
// Each player gets a stable color from their id. We render a small pointer +
// name tag that eases toward their latest reported position.
const _SQ_CURSOR_COLORS = ['#e8c87a','#9fc97a','#7da7d9','#d98c4a','#c88ad9','#5fc9b0'];
function _sqCursorColor(id) {
  let h = 0; const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return _SQ_CURSOR_COLORS[Math.abs(h) % _SQ_CURSOR_COLORS.length];
}
function _sqRemoteCursor(msg) {
  if (!_sq || _sq.solo) return;
  const shell = document.querySelector('.sq-shell');
  if (!shell) return;
  let layer = document.getElementById('sq-cursors');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'sq-cursors';
    layer.className = 'sq-cursor-layer';
    shell.appendChild(layer);
  }
  let el = document.getElementById('sq-cursor-' + msg.userId);
  if (!el) {
    el = document.createElement('div');
    el.id = 'sq-cursor-' + msg.userId;
    el.className = 'sq-cursor';
    const color = _sqCursorColor(msg.userId);
    el.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2 L3 20 L8 15 L11 22 L14 21 L11 14 L18 14 Z" fill="${color}" stroke="#1d150d" stroke-width="1"/></svg><span class="sq-cursor-name" style="background:${color}">${_esc(msg.name || 'Player')}</span>`;
    layer.appendChild(el);
  }
  // Position from normalized coords relative to the shell
  const r = shell.getBoundingClientRect();
  el.style.left = (msg.x * r.width) + 'px';
  el.style.top = (msg.y * r.height) + 'px';
  el.classList.add('active');
  // Fade out if no updates for a bit
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.classList.remove('active'); }, 2500);
}

// Start broadcasting my cursor while in a multiplayer game (throttled).
function _sqStartCursorBroadcast() {
  if (!_sq || _sq.solo || _sq._cursorWired) return;
  const shell = document.querySelector('.sq-shell');
  if (!shell) return;
  _sq._cursorWired = true;
  let last = 0;
  shell.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - last < 60) return;   // ~16/sec cap
    last = now;
    const r = shell.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    apiFetch('/api/rooms/' + _sq.code + '/cursor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    }).catch(() => {});
  });
}

// ── Local engine plumbing (solo) ──
function _sqPushLocal() {
  if (!_sqGame || !_sq) return;
  sqOnState(window.SquirrelEngine.view(_sqGame, 'you'));
}
function _sqApplyLocal(seat, payload) {
  _sqDispatch(_sqGame, seat, payload);
  _sqPushLocal();
  if (_sqGame.phase === 'gameover') _sqOver();
}
function _sqApplyAiLocal(seat, payload) { _sqApplyLocal(seat, payload); }
function _sqDispatch(g, seat, p) {
  const E = window.SquirrelEngine;
  switch (p.kind) {
    case 'draw': E.draw(g, seat); break;
    case 'bank': E.bank(g, seat); break;
    case 'squirrel': E.resolveSquirrel(g, seat, p.keepIndex | 0); break;
    case 'storm': E.resolveStorm(g, seat, p.cardIndex | 0); break;
    case 'magpie': E.resolveMagpie(g, seat, p.targetSeat, p.cardIndex | 0); break;
    case 'foxdare': E.resolveFoxDare(g, seat, p.targetSeat); break;
    case 'daredraw': E.dareDraw(g, seat); break;
  }
}

// ── State handler (shared) ──
function sqOnState(state) {
  if (!_sq) { _sqPendingState = state; return; }
  _sq.state = state;
  _sqRender();
  _sqSounds(state);
  _sqMaybeReveal(state);
  _sqMaybeSteal(state);
  if (_sq.isHost) _sqMaybeDriveAI(state);
}

// Animate stolen cards flying from the victim's stash to the stealer's.
function _sqMaybeSteal(s) {
  const st = s.lastSteal;
  if (!st || !st.seq) return;
  if (_sq._lastStealSeq === st.seq) return;
  _sq._lastStealSeq = st.seq;

  const shell = document.querySelector('.sq-shell');
  if (!shell) return;
  const fromEl = _sqStashEl(st.fromSeat);
  const toEl = _sqStashEl(st.toSeat);
  if (!fromEl || !toEl) return;
  const fr = fromEl.getBoundingClientRect();
  const tr = toEl.getBoundingClientRect();
  const sr = shell.getBoundingClientRect();
  if (typeof _bcSfx === 'function') _bcSfx('card-flip.wav');

  const n = Math.min(st.count, 5);
  for (let i = 0; i < n; i++) {
    const ghost = document.createElement('img');
    ghost.src = '/assets/images/sq_back.png';
    ghost.className = 'sq-steal-ghost';
    ghost.style.left = (fr.left - sr.left + 12 + i * 6) + 'px';
    ghost.style.top = (fr.top - sr.top + 12 + i * 6) + 'px';
    shell.appendChild(ghost);
    void ghost.offsetWidth;
    setTimeout(() => {
      ghost.classList.add('flying');
      ghost.style.left = (tr.left - sr.left + 20 + i * 6) + 'px';
      ghost.style.top = (tr.top - sr.top + 20 + i * 6) + 'px';
    }, 30 + i * 110);
    setTimeout(() => { ghost.style.opacity = '0'; }, 30 + i * 110 + 750);
    setTimeout(() => ghost.remove(), 30 + i * 110 + 1100);
  }
  // Flash both stashes so the steal reads clearly.
  fromEl.classList.add('sq-stash-flash-out'); setTimeout(() => fromEl.classList.remove('sq-stash-flash-out'), 900);
  toEl.classList.add('sq-stash-flash-in'); setTimeout(() => toEl.classList.remove('sq-stash-flash-in'), 1200);
}

// Make hoard cards draggable within the board. A small movement threshold
// distinguishes a drag from a click (so clicking still draws). Works with
// pointer events (mouse + touch).
function _sqEnableDrag() {
  const hoard = document.querySelector('#sq-game .sq-hoard');
  if (!hoard) return;
  hoard.querySelectorAll('.sq-hoard-card').forEach(card => {
    if (card._dragWired) return;
    card._dragWired = true;

    let startX, startY, origLeft, origTop, moved = false, down = false;

    card.addEventListener('pointerdown', (e) => {
      down = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      origLeft = card.offsetLeft; origTop = card.offsetTop;
      card.setPointerCapture(e.pointerId);   // route all further events here
      card.style.zIndex = 600;
      card.style.cursor = 'grabbing';
    });

    card.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
      if (!moved) return;
      const hw = hoard.clientWidth, hh = hoard.clientHeight;
      let nx = Math.max(0, Math.min(hw, origLeft + dx));
      let ny = Math.max(0, Math.min(hh, origTop + dy));
      card.style.left = nx + 'px';
      card.style.top = ny + 'px';
      card.style.transform = 'translate(-50%,-50%)';  // drop spin while dragging
    });

    const endDrag = (e) => {
      if (!down) return;
      down = false;
      card.style.cursor = '';
      try { card.releasePointerCapture(e.pointerId); } catch (err) {}
      // If we actually dragged, suppress the click that would otherwise draw.
      if (moved) { card._suppressClick = true; setTimeout(() => { card._suppressClick = false; }, 50); }
    };
    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);

    // Guard the draw click: swallow it if it was the tail of a drag.
    card.addEventListener('click', (e) => {
      if (card._suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  });
}

// Find the on-screen stash element for a seat (mine vs opponents).
function _sqStashEl(seat) {
  if (seat === _sq.mySeat) return document.querySelector('#sq-game .sq-my-stash');
  return document.querySelector(`#sq-game .sq-stash[data-seat="${seat}"]`);
}

// Flip the freshly-drawn card up, large, in the center — tinted by outcome.
// Shows for every player's draw so you can follow the action.
function _sqMaybeReveal(s) {
  const ld = s.lastDraw;
  if (!ld || !ld.seq) return;
  if (_sq._lastRevealSeq === ld.seq) return;
  _sq._lastRevealSeq = ld.seq;

  const who = s.players.find(p => p.seat === ld.seat);
  const mine = ld.seat === _sq.mySeat;
  const tint = ld.outcome === 'bust' ? 'reveal-bust' : ld.outcome === 'steal' ? 'reveal-steal' : '';

  let layer = document.getElementById('sq-reveal');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'sq-reveal';
    layer.className = 'sq-reveal-layer';
    const sh = document.querySelector('.sq-shell');
    (sh || document.body).appendChild(layer);
  }
  const caption = ld.outcome === 'bust' ? '💥 Bust!' : ld.outcome === 'steal' ? '🪶 Steal!' : (mine ? 'You drew' : _esc(who ? who.name : '') + ' drew');
  layer.innerHTML = `<div class="sq-reveal-card ${tint}">
      <img src="${SQ_IMG(ld.card)}" alt="${_esc(ld.card.label)}">
      <div class="sq-reveal-label">${caption} — ${_esc(ld.card.label)}</div>
    </div>`;
  layer.classList.add('show');

  // If it's a bust, also flash the culprit duplicate red in the stash briefly.
  if (ld.outcome === 'bust' && mine) {
    setTimeout(() => {
      document.querySelectorAll('.sq-my-stash .sq-card').forEach(el => el.classList.add('sq-card-bust'));
    }, 50);
  }

  clearTimeout(_sq._revealTimer);
  // My own draws: hold until clicked. Others' draws: auto-dismiss.
  if (mine) {
    layer.onclick = () => { layer.classList.remove('show'); layer.onclick = null; };
    // Safety auto-dismiss after a while
    _sq._revealTimer = setTimeout(() => layer.classList.remove('show'), 4000);
  } else {
    layer.onclick = null;
    _sq._revealTimer = setTimeout(() => layer.classList.remove('show'), 1300);
  }
}

function sqOnOver(msg) {
  if (!_sq) return;
  const mineWon = msg.winnerSeat === _sq.mySeat;
  if (mineWon && typeof _awardGold === 'function') { _awardGold(4); if (typeof _bcSfx === 'function') _bcSfx('success.mp3'); }
  if (typeof _bcRecordResult === 'function' && _sq.solo) _bcRecordResult(mineWon, 'solo', _sq.difficulty);
  _sqShowEndScreen(msg, mineWon);
}

// End screen: a placements table with scores, plus a few fun facts.
function _sqShowEndScreen(msg, mineWon) {
  const s = _sq.state || {};
  const final = s.final || null;
  const standings = final ? final.standings : ([...(s.players || [])].sort((a, b) => b.score - a.score));
  const facts = final ? final.facts : [];

  let back = document.getElementById('sq-endscreen');
  if (!back) {
    back = document.createElement('div');
    back.id = 'sq-endscreen';
    back.className = 'sq-end-backdrop';
    (document.querySelector('.sq-shell') || document.body).appendChild(back);
  }
  const medals = ['🥇','🥈','🥉'];
  const rows = standings.map((p, i) => `
    <div class="sq-end-row ${p.seat === _sq.mySeat ? 'me' : ''} ${i === 0 ? 'winner' : ''}">
      <span class="sq-end-rank">${medals[i] || (i + 1)}</span>
      <span class="sq-end-name">${_esc(p.name)}${p.isAI ? ' <span class="lobby-ai-tag">AI</span>' : ''}</span>
      <span class="sq-end-score">${p.score} 🌰</span>
    </div>`).join('');
  const factHtml = facts.length ? `<div class="sq-end-facts">
      ${facts.map(f => `<div class="sq-end-fact"><span class="sq-fact-emoji">${f.emoji}</span> <span class="sq-fact-label">${_esc(f.label)}</span><span class="sq-fact-who">${_esc(f.name)} (${f.value})</span></div>`).join('')}
    </div>` : '';

  back.innerHTML = `<div class="sq-end-card">
    <div class="sq-end-title">${mineWon ? '🏆 Victory!' : 'The Hoard is Counted'}</div>
    <div class="sq-end-sub">${mineWon ? 'You gathered the greatest hoard — <strong>+4 gold</strong>!' : _esc((standings[0] && standings[0].name) || 'A rival') + ' wins with the greatest hoard.'}</div>
    <div class="sq-end-table">${rows}</div>
    ${factHtml}
    <div class="sq-end-actions">
      ${_sq.solo ? `<button class="cg-btn" onclick="document.getElementById('sq-endscreen').remove(); startSquirrelSolo('${_sq.difficulty}')">Play Again</button>` : ''}
      <button class="cg-btn secondary" onclick="document.getElementById('sq-endscreen').remove(); sqLeaveTable()">← Leave Table</button>
    </div>
  </div>`;
  back.classList.add('open');
}

function sqLeaveTable() {
  const bd = document.getElementById('sq-backdrop');
  if (bd) bd.style.display = 'none';
  _sq = null; _sqGame = null;
  stopSquirrelMusic();
  if (typeof LobbySystem !== 'undefined') LobbySystem.close();
}

function _sqOpenTable() {
  const bd = document.getElementById('sq-backdrop');
  if (!bd) { console.error("Squirrel modal (#sq-backdrop) not found in DOM"); return false; }
  bd.style.display = 'flex';
  startSquirrelMusic();
  return true;
}

// ── Render ──
function _sqRender() {
  const area = document.getElementById('sq-game');
  const s = _sq && _sq.state;
  if (!area || !s) return;
  const meSeat = _sq.mySeat;
  const me = s.players.find(p => p.seat === meSeat) || s.players[0];
  const myDare = s.phase === 'turn' && s.dare && s.dare.victimSeat === meSeat;
  const myTurn = s.turnSeat === meSeat && s.phase === 'turn' && !s.dare;
  const canDrawHoard = myTurn || myDare;
  const foxSelf = s.phase === 'foxdare' && s.pending && s.pending.actorSeat === meSeat;
  const badgerCount = me.stash.filter(c => c.kind === 'badger').length;
  const stormMine = s.phase === 'storm' && me.stash.length && !((s.pending && s.pending.stormResolved) || []).includes(meSeat);

  const others = s.players.filter(p => p.seat !== meSeat).map(p => _sqPlayerBox(p, s)).join('');

  // The hoard: a scattered spread of face-down cards. One per remaining card
  // (capped for layout), each clickable on your turn. Purely visual — the
  // engine decides which card you actually get. Positions are deterministic
  // per index so the spread is stable between renders and shrinks as drawn.
  const pileCount = s.deckLeft;
  // Shuffle seed: bumps whenever cards return to the pile, re-scattering the
  // hoard so it visibly "shuffles" rather than looking static.
  const shuffleSeed = (s._returnedToPile != null) ? s._returnedToPile : (_sq._shuffleSeed || 0);
  const pile = _sqHoardHtml(pileCount, shuffleSeed, canDrawHoard, myDare ? 'sqDareDraw()' : 'sqDraw()');

  const prompt = _sqPrompt(s, me, myTurn);
  const turnName = (s.players.find(p => p.seat === s.turnSeat) || {}).name || '';

  area.innerHTML = `
    <div class="sq-table">
      <div class="sq-roundbar">
        <span>Round ${s.round}</span>
        <button class="sq-hoard-btn" onclick="sqToggleHoard()" title="See what's left in the pile">🌰 ${pileCount} in the pile ▾</button>
        <button class="bc-help-btn" onclick="sqToggleHelp()" title="Rules">?</button>
        ${typeof gameAudioControlHtml === 'function' ? gameAudioControlHtml() : ''}
      </div>

      <div class="sq-others">${others}</div>

      <div class="sq-center">
        <div class="sq-hoard ${canDrawHoard ? 'drawable' : ''}">${pile}</div>
        ${_sqActionBanner(s, me)}
        ${_sqCenterChoices(s, me)}
        <div class="sq-center-caption">${myTurn ? (me.drawsThisTurn < 3 ? '🐿️ Grab a card — safe draw ' + (me.drawsThisTurn + 1) + ' of 3' : 'Grab another, or stop to leave your stash on the table') : 'Waiting for ' + _esc(turnName) + '…'}</div>
      </div>

      <div class="sq-me ${myTurn ? 'active' : ''} ${foxSelf ? 'fox-self-target' : ''} ${badgerCount ? 'badger-shield' : ''}" ${foxSelf ? `onclick="sqFoxDare(${meSeat})" title="Dare yourself"` : ''}>
        ${badgerCount ? `<div class="sq-shield-label">🛡 BADGER'S PROTECTION${badgerCount > 1 ? ' ×' + badgerCount : ''}</div>` : ''}
        <div class="sq-me-header">
          <span class="sq-me-name">Your stash</span>
          ${badgerCount ? `<span class="sq-badge">🦡 Badger ready${badgerCount > 1 ? ' ×' + badgerCount : ''}</span>` : ''}
          <span class="sq-me-score">Hoard ${me.score} 🌰</span>
        </div>
        <div class="sq-stash sq-my-stash ${stormMine ? 'storm-pick' : ''}">${me.stash.length ? _sqStashGrouped(me.stash, {
          cardClass: stormMine ? () => 'storm-target' : null,
          wrap: stormMine ? (c, i) => `onclick="sqStorm(${i})" title="Return ${_esc(c.label)} stack"` : null,
        }) : '<span class="sq-empty">No cards yet — draw to begin.</span>'}</div>
      </div>

      <div class="sq-prompt">${prompt}</div>
    </div>`;

  const lg = area.querySelector('.bc-log');
  if (lg) lg.scrollTop = lg.scrollHeight;
  _sqEnableDrag();
}

// Hoard tracker overlay — what's left in the pile, by card.
function sqToggleHoard() {
  const el = (typeof _bcOverlay === 'function') ? _bcOverlay() : null;
  if (!el || !_sq || !_sq.state) return;
  if (el.classList.contains('open') && el.dataset.kind === 'sqhoard') { bcCloseOverlay(); return; }
  el.dataset.kind = 'sqhoard';
  const comp = _sq.state.deckComposition || {};
  // Order: numbers 1-10, then 7/rotten/golden, then specials
  const order = ['n1','n2','n3','n4','n5','n6','lucky7','n8','n9','n10','rotten','golden','magpie','burrow','pact','badger','squirrel','storm','foxdare'];
  const imgFor = key => {
    const m = { lucky7:'7', golden:'20', foxdare:'fox' };
    if (key[0] === 'n') return '/assets/images/sq_' + key.slice(1) + '.png';
    return '/assets/images/sq_' + (m[key] || key) + '.png';
  };
  const zoomKey = key => { const m = { lucky7:'7', golden:'20', foxdare:'fox' }; return key[0] === 'n' ? key.slice(1) : (m[key] || key); };
  const cells = order.filter(k => comp[k]).map(k => `
    <div class="sq-hoard-cell" onclick="sqZoomCard('${zoomKey(k)}','')">
      <img src="${imgFor(k)}" alt="">
      <span class="sq-hoard-n">×${comp[k].n}</span>
    </div>`).join('');
  el.innerHTML = `<div class="bc-overlay-panel sq-hoard-panel">
    <div class="bc-help-title">What's left in the pile (${_sq.state.deckLeft})</div>
    <div class="sq-hoard-grid">${cells || '<div class="sq-empty">The pile is empty.</div>'}</div>
    <button class="cg-btn secondary" onclick="bcCloseOverlay()">Close</button>
  </div>`;
  el.classList.add('open');
}

// Build the scattered hoard HTML. Cached by (count, seed, clickable) so it
// isn't regenerated on every render — that rebuild was the screen "flash".
function _sqHoardHtml(count, seed, clickable, clickExpr) {
  clickExpr = clickExpr || 'sqDraw()';
  const key = count + ':' + seed + ':' + (clickable ? 1 : 0) + ':' + clickExpr;
  if (_sq._hoardKey === key && _sq._hoardHtml) return _sq._hoardHtml;
  const shown = Math.min(count, 100);
  let pile = '';
  for (let i = 0; i < shown; i++) {
    const s0 = i + seed * 1000;
    const a = Math.sin(s0 * 127.1) * 43758.5453; const rx = a - Math.floor(a);
    const b = Math.sin(s0 * 311.7) * 24634.633;  const ry = b - Math.floor(b);
    const c = Math.sin(s0 * 74.7) * 9823.1;       const rr = c - Math.floor(c);
    const x = (4 + rx * 92).toFixed(1);
    const y = (6 + ry * 88).toFixed(1);
    const rot = (rr * 360).toFixed(1);
    pile += `<img class="sq-hoard-card" src="/assets/images/sq_back.png"
      style="left:${x}%; top:${y}%; transform:translate(-50%,-50%) rotate(${rot}deg); z-index:${i}"
      ${clickable ? `onclick="${clickExpr}"` : ''} alt="card">`;
  }
  _sq._hoardKey = key; _sq._hoardHtml = pile;
  return pile;
}

function _sqPlayerBox(p, s) {
  const acting = p.seat === s.turnSeat;
  const stashVal = p.stash.reduce((a, c) => a + (c.value || 0), 0);
  // During my Magpie steal, this player's cards become clickable targets.
  const magpieActive = s.phase === 'magpie' && s.pending && s.pending.actorSeat === _sq.mySeat && p.seat !== _sq.mySeat;
  // During my Fox's Dare, the whole player box is a clickable target.
  const foxActive = s.phase === 'foxdare' && s.pending && s.pending.actorSeat === _sq.mySeat;
  const stashCards = _sqStashGrouped(p.stash, {
    mini: true,
    cardClass: magpieActive ? (c) => (c.kind !== 'lucky7' ? 'magpie-target' : '') : null,
    wrap: magpieActive ? (c, i) => (c.kind !== 'lucky7' ? `onclick="sqMagpie(${p.seat},${i})" title="Steal ${_esc(c.label)} stack"` : `title="${_esc(c.label)}"`) : null,
  });
  return `<div class="sq-player ${acting ? 'acting' : ''} ${magpieActive ? 'magpie-targetable' : ''} ${foxActive ? 'fox-targetable' : ''}" ${foxActive ? `onclick="sqFoxDare(${p.seat})" title="Dare ${_esc(p.name)}"` : ''}>
    <div class="sq-player-head">
      <span class="sq-player-name">${_esc(p.name)}${p.isAI ? ' <span class="lobby-ai-tag">AI</span>' : ''}</span>
      <span class="sq-player-score">${p.score}🌰 hoard</span>
    </div>
    <div class="sq-stash" data-seat="${p.seat}">${stashCards || '<span class="sq-empty">no active cards</span>'}</div>
    ${p.stash.length ? `<div class="sq-player-stashval">on table: ${stashVal}🌰 · stealable</div>` : ''}
  </div>`;
}

function _sqCardHtml(c, mini) {
  return `<div class="sq-card zoomable ${mini ? 'mini' : ''} ${c.kind}" title="${_esc(c.label)}" onclick="sqZoomCard('${_sqImgKey(c)}',&quot;${_esc(c.label)}&quot;)">
    <img src="${SQ_IMG(c)}" alt="${_esc(c.label)}"></div>`;
}

// Render a stash with same cards stacked vertically (solitaire-style). Each
// group is a vertical pile; different cards sit side by side. `wrap` is an
// optional (card, originalIndex) => html-attrs string for click handlers.
function _sqStashGrouped(stash, opts) {
  opts = opts || {};
  if (!stash.length) return '';
  // Group consecutive-by-key while preserving a representative index for clicks
  const groups = [];
  const keyOf = c => (c.kind === 'number' ? 'n' + c.num : c.kind === 'rotten' ? 'rotten' : c.kind === 'golden' ? 'golden' : c.kind + ':' + Math.random());
  const map = {};
  stash.forEach((c, i) => {
    const k = keyOf(c);
    if (!map[k]) { map[k] = { cards: [], firstIndex: i, card: c }; groups.push(map[k]); }
    map[k].cards.push({ c, i });
  });
  // Show ONE card per group with a count badge — cleaner than a physical stack.
  return groups.map(g => {
    const n = g.cards.length;
    const rep = g.cards[0];   // representative card; clicks use its index
    const zoomable = !opts.wrap;
    const attrs = opts.wrap ? opts.wrap(rep.c, rep.i)
      : `title="${_esc(rep.c.label)}${n > 1 ? ' ×' + n : ''}" onclick="sqZoomCard('${_sqImgKey(rep.c)}',&quot;${_esc(rep.c.label)}&quot;)"`;
    const cls = opts.cardClass ? opts.cardClass(rep.c, rep.i) : '';
    return `<div class="sq-stack" data-n="${n}">
      <div class="sq-card ${zoomable ? 'zoomable' : ''} ${opts.mini ? 'mini' : ''} ${rep.c.kind} ${cls}" ${attrs}>
        <img src="${SQ_IMG(rep.c)}" alt="${_esc(rep.c.label)}"></div>
      ${n > 1 ? `<div class="sq-stack-count">${n}</div>` : ''}
    </div>`;
  }).join('');
}

// A big, color-coded floating banner over the table telling the player what a
// special effect is doing and prompting their choice.
function _sqActionBanner(s, me) {
  const P = s.pending;
  if (!P) return '';
  const mine = (seat) => seat === me.seat;
  let cls = '', big = '', sub = '';
  if (s.phase === 'magpie' && mine(P.actorSeat)) {
    cls = 'magpie'; big = '🐦 MAGPIE'; sub = 'Click a highlighted card to steal that stack.';
  } else if (s.phase === 'squirrel' && mine(P.actorSeat)) {
    cls = 'squirrel'; big = '🐿️ SQUIRREL'; sub = 'Choose which of the two cards to keep.';
  } else if (s.phase === 'foxdare' && mine(P.actorSeat)) {
    cls = 'foxdare'; big = "🦊 FOX'S DARE"; sub = 'Choose a player to draw three — even yourself.';
  } else if (s.phase === 'storm' && me.stash.length && !((P.stormResolved) || []).includes(me.seat)) {
    cls = 'storm'; big = '⛈ STORM'; sub = 'Click a card in your stash to return that stack.';
  } else {
    return '';
  }
  return `<div class="sq-action-banner ${cls}"><div class="sq-action-big">${big}</div><div class="sq-action-sub">${sub}</div></div>`;
}

// The two Squirrel cards, shown large & highlighted in the center (under the
// SQUIRREL banner) instead of cramped in the bottom prompt.
function _sqCenterChoices(s, me) {
  const P = s.pending;
  if (!(s.phase === 'squirrel' && P && P.actorSeat === me.seat && P.choices)) return '';
  return `<div class="sq-center-choices">
    ${P.choices.map((c, i) => `<div class="sq-choice-card" onclick="sqKeep(${i})" title="Keep ${_esc(c.label)}">
      <img src="${SQ_IMG(c)}" alt="${_esc(c.label)}">
      <span class="sq-choice-label">${_esc(c.label)}</span>
    </div>`).join('')}
  </div>`;
}

// ── Prompt for the active phase ──
function _sqPrompt(s, me, myTurn) {
  const P = s.pending;

  // Dare in progress: the victim draws from the pile, one at a time.
  if (s.phase === 'turn' && s.dare && s.dare.victimSeat === me.seat) {
    return `<div class="sq-question">🦊 You've been dared! Click the pile to draw — ${s.dare.remaining} more to go.</div>`;
  }

  if (myTurn) {
    const canStop = me.drawsThisTurn >= 3;
    return `<div class="sq-actions">
        <button class="cg-btn" onclick="sqDraw()">🌰 Draw</button>
        <button class="cg-btn ${canStop ? '' : 'secondary disabled'}" onclick="${canStop ? 'sqBank()' : ''}">✋ Stop${canStop ? '' : ' (after 3 draws)'}</button>
      </div>
      ${canStop ? '<div class="sq-hint">Stopping leaves your cards on the table — they move to your hoard at your next turn, but rivals can steal them until then.</div>' : ''}`;
  }

  if (!P) return _sqWaiting(s);

  // Squirrel — keep 1 of 2
  if (s.phase === 'squirrel' && P.actorSeat === me.seat && P.choices) {
    return `<div class="sq-question">🐿️ The Squirrel offers two — click one above to keep it.</div>`;
  }
  // Storm — everyone returns one
  if (s.phase === 'storm' && me.stash.length && !(P.stormResolved || []).includes(me.seat)) {
    return `<div class="sq-question">⛈ Storm! Click a card in <em>your stash</em> below to return that stack to the pile.</div>`;
  }
  // Magpie — steal one card. Targets are clickable directly on the players'
  // stashes above (highlighted); the prompt is just the instruction.
  if (s.phase === 'magpie' && P.actorSeat === me.seat) {
    const any = s.players.some(p => p.seat !== me.seat && p.stash.some(c => c.kind !== 'lucky7'));
    return `<div class="sq-question">🐦 Magpie — click a highlighted card above to steal it${any ? '' : ' (no stealable cards — drawing continues)'}.</div>`;
  }
  // Fox's Dare — pick a victim by clicking a player (boxes highlight), or self
  if (s.phase === 'foxdare' && P.actorSeat === me.seat) {
    return `<div class="sq-question">🦊 Fox's Dare — click any player (or your own stash) to make them draw three.</div>`;
  }
  // Dare draw in progress — the dared player draws one at a time


  return _sqWaiting(s);
}

function _sqWaiting(s) {
  const who = s.players.find(p => p.seat === s.turnSeat);
  const label = {
    turn: `Waiting for ${who ? who.name : 'a player'} to draw…`,
    squirrel: 'A squirrel rummages…', storm: 'The storm rages — players are choosing…',
    magpie: 'A magpie circles…', foxdare: 'The fox makes a dare…',
  }[s.phase] || 'Waiting…';
  return `<div class="sq-question sq-waiting">${_esc(label)}</div>`;
}

// ── Intents ──
function sqDraw() { _sq.channel.send({ kind: 'draw' }); }
function sqBank() { _sq.channel.send({ kind: 'bank' }); }
function sqKeep(i) { _sq.channel.send({ kind: 'squirrel', keepIndex: i }); }
function sqStorm(i) { _sq.channel.send({ kind: 'storm', cardIndex: i }); }
function sqMagpie(seat, i) { _sq.channel.send({ kind: 'magpie', targetSeat: seat, cardIndex: i }); }
function sqFoxDare(seat) { _sq.channel.send({ kind: 'foxdare', targetSeat: seat }); }
function sqDareDraw() { _sq.channel.send({ kind: 'daredraw' }); }

// ── Host / solo AI driver ──
let _sqAiTimer = null;
function _sqMaybeDriveAI(s) {
  clearTimeout(_sqAiTimer);
  if (!s || s.phase === 'gameover') return;
  const seat = _sqAiPendingSeat(s);
  if (seat == null) return;
  _sqAiTimer = setTimeout(() => {
    if (!_sq) return;                       // table was closed / failed to open
    // Multiplayer AI now advances on the server clock; only solo drives locally.
    if (!_sq.solo) return;
    if (!_sqGame) return;
    const d = window.SquirrelEngine.aiResolve(_sqGame, seat);
    if (d) _sqApplyAiLocal(seat, d);
  }, 1100 + Math.random() * 1400);
}

function _sqAiPendingSeat(s) {
  const isAi = seat => { const o = _sq.seats.find(x => x.seat === seat); return o && o.isAI; };
  const P = s.pending;
  if (s.phase === 'turn') { const a = (s.dare ? s.dare.victimSeat : s.turnSeat); return isAi(a) ? a : null; }
  if (!P) return null;
  if (s.phase === 'squirrel' || s.phase === 'magpie' || s.phase === 'foxdare')
    return isAi(P.actorSeat) ? P.actorSeat : null;
  if (s.phase === 'storm') {
    const need = s.players.filter(p => p.stash.length > 0 && !(P.stormResolved || []).includes(p.seat));
    const ai = need.find(p => isAi(p.seat));
    return ai ? ai.seat : null;
  }
  return null;
}

// ── Sounds ──
function _sqSounds(s) {
  const seq = s.lastDraw ? s.lastDraw.seq : 0;
  const last = s.log[s.log.length - 1] || '';
  const sig = seq + '|' + last;
  if (sig === _sq._lastSig) return;
  const prevSeq = _sq._lastSeq || 0;
  _sq._lastSig = sig;
  _sq._lastSeq = seq;
  if (typeof _bcSfx !== 'function') return;

  // Bust / bank sounds come from the log (they're outcomes, not draws).
  if (/BUSTS|busts/.test(last)) { _bcSfx('stab.wav'); return; }

  // Card-specific sounds fire on a genuinely new draw.
  if (s.lastDraw && seq !== prevSeq) {
    const kind = s.lastDraw.card.kind;
    if (kind === 'storm') { _bcSfx('wind.mp3'); _sqWindEffect(); return; }
    if (kind === 'foxdare') { _bcSfx('giggle.wav'); return; }
    if (kind === 'rotten') { _bcSfx('splat.wav'); return; }
    _bcSfx('card-flip.wav');
    return;
  }
  if (/banks|Lucky/.test(last)) _bcSfx('coins.mp3');
}

// Storm visual: leaves/gusts streak horizontally across the table for ~3.5s.
function _sqWindEffect() {
  const shell = document.querySelector('.sq-shell');
  if (!shell) return;
  const layer = document.createElement('div');
  layer.className = 'sq-wind-layer';
  // A scattering of gust streaks + drifting leaves
  let html = '';
  const leaves = ['🍂','🍁','🌿'];
  for (let i = 0; i < 18; i++) {
    const top = (Math.random() * 90 + 2).toFixed(1);
    const delay = (Math.random() * 1.4).toFixed(2);
    const dur = (1.6 + Math.random() * 1.2).toFixed(2);
    const size = (14 + Math.random() * 20).toFixed(0);
    const leaf = leaves[i % leaves.length];
    html += `<span class="sq-wind-leaf" style="top:${top}%; font-size:${size}px; animation-delay:${delay}s; animation-duration:${dur}s">${leaf}</span>`;
  }
  for (let i = 0; i < 8; i++) {
    const top = (Math.random() * 90 + 2).toFixed(1);
    const delay = (Math.random() * 1.2).toFixed(2);
    const dur = (1.2 + Math.random() * 0.9).toFixed(2);
    html += `<span class="sq-wind-gust" style="top:${top}%; animation-delay:${delay}s; animation-duration:${dur}s"></span>`;
  }
  layer.innerHTML = html;
  shell.appendChild(layer);
  // Darken/tint briefly for storm mood
  layer.classList.add('active');
  setTimeout(() => layer.remove(), 3800);
}

// ── Rules overlay (reuses the body-level overlay) ──
const SQ_CARD_INFO = [
  { img: 'magpie', name: 'Magpie', desc: 'Steal a card (and all its matching copies) from any player.' },
  { img: 'burrow', name: 'Burrow', desc: 'Immediately bank your whole stash. Your turn ends.' },
  { img: 'pact', name: 'Forest Pact', desc: 'If another player also draws a Forest Pact, you both bank everything at once.' },
  { img: 'badger', name: 'Badger', desc: 'Guards against your next bust. Stack several for several saves.' },
  { img: 'squirrel', name: 'Squirrel', desc: 'Draw two, keep one, shuffle the other back into the pile.' },
  { img: 'storm', name: 'Storm', desc: 'Every player returns one card (and its matching stack) to the pile.' },
  { img: 'fox', name: "Fox's Dare", desc: 'Force any player — even yourself — to immediately draw three.' },
  { img: '7', name: 'Lucky Seven', desc: 'Auto-banks at the end of your turn and can never be stolen.' },
  { img: 'rotten', name: 'Rotten Acorn', desc: 'Worth −7 when hoarded. Its own unique number for duplicates.' },
  { img: '20', name: 'Golden Acorn', desc: 'Worth a hefty 20 acorns. Only two exist.' },
];

function sqToggleHelp() {
  let el = document.getElementById('sq-help-modal');
  if (el && el.classList.contains('open')) { el.classList.remove('open'); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'sq-help-modal';
    el.className = 'sq-help-backdrop';
    el.onclick = (e) => { if (e.target === el) el.classList.remove('open'); };
    (document.querySelector('.sq-shell') || document.body).appendChild(el);
  }
  el.innerHTML = `<div class="sq-help-card">
    <button class="sq-help-x" onclick="document.getElementById('sq-help-modal').classList.remove('open')">✕</button>
    <div class="sq-help-h">Squirrel's Stash</div>
    <div class="sq-help-rules">
      <p>Draw acorns from the pile to build your <b>stash</b>. Your first <b>3 draws each turn are safe</b>. After that, drawing a number already in your stash <b>busts</b> you — the whole stash is lost.</p>
      <p>Draw a number another player holds and you <b>steal all their copies</b>. <b>Stop</b> any time after 3 draws to leave your stash on the table; it banks at the start of your next turn — but rivals can steal from it until then.</p>
      <p>When the pile is empty, the highest <b>hoard</b> wins <b>4 gold</b>. Watch out for the <b>Rotten Acorn (−7)</b>!</p>
    </div>
    <div class="sq-help-gallery">
      ${SQ_CARD_INFO.map(c => `<div class="sq-help-item">
        <img src="/assets/images/sq_${c.img}.png" alt="${c.name}" onclick="sqZoomCard('${c.img}',&quot;${_esc(c.name)}&quot;)">
        <div class="sq-help-item-text"><b>${c.name}</b><span>${c.desc}</span></div>
      </div>`).join('')}
    </div>
  </div>`;
  el.classList.add('open');
}

// Full-screen zoom of a single card (used by help + hover/click magnify).
function sqZoomCard(imgKey, label) {
  let z = document.getElementById('sq-zoom');
  if (!z) {
    z = document.createElement('div');
    z.id = 'sq-zoom';
    z.className = 'sq-zoom-backdrop';
    z.onclick = () => z.classList.remove('open');
    (document.querySelector('.sq-shell') || document.body).appendChild(z);
  }
  z.innerHTML = `<img src="/assets/images/sq_${imgKey}.png" alt="${_esc(label || '')}">`;
  z.classList.add('open');
}

function _sqOver() { /* solo: sqOnOver is triggered via state→gameover path */
  const g = _sqGame;
  if (!g) return;
  const winnerSeat = g.winner;
  const wp = g.players.find(p => p.seat === winnerSeat);
  sqOnOver({ winnerSeat, winnerName: wp ? wp.name : null });
}


// ── Squirrel's Stash music (squirrel1.mp3, loops) ──
let _sqMusic = null;
let _sqMusicDucked = false;
function _sqVol() { if (typeof getMusicVolume === 'function') return getMusicVolume(); const v = document.getElementById('music-volume'); return v ? parseFloat(v.value) : 0.4; }
function startSquirrelMusic() {
  if (_sqMusic) return;
  if (typeof stopMenuMusic === 'function') stopMenuMusic();
  try {
    const main = document.getElementById('bg-music') || document.querySelector('audio#music, audio.bg-music');
    if (main && !main.paused) { _sqMusicDucked = true; main.pause(); }
  } catch (e) {}
  const a = new Audio('/assets/audio/squirrel1.mp3');
  a.loop = true;
  a.volume = _sqVol();
  a.play().catch(() => {});
  _sqMusic = a;
  // React to volume changes from EITHER slider (settings or music bar) via the
  // global event dispatched by audio.js's setVolume.
  _sqMusic._vh = () => { if (_sqMusic) _sqMusic.volume = _sqVol(); };
  window.addEventListener('kw-music-volume', _sqMusic._vh);
  const slider = document.getElementById('music-volume');
  if (slider) slider.addEventListener('input', _sqMusic._vh);
}
function stopSquirrelMusic() {
  if (!_sqMusic) return;
  try {
    const slider = document.getElementById('music-volume');
    if (slider && _sqMusic._vh) slider.removeEventListener('input', _sqMusic._vh);
    if (_sqMusic._vh) window.removeEventListener('kw-music-volume', _sqMusic._vh);
    _sqMusic.pause();
  } catch (e) {}
  _sqMusic = null;
  if (_sqMusicDucked) { _sqMusicDucked = false; try { const main = document.getElementById('bg-music') || document.querySelector('audio#music, audio.bg-music'); if (main) main.play().catch(()=>{}); } catch(e){} }
}

