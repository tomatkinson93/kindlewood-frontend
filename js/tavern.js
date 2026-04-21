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
  const overlay = document.getElementById('tavern-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  // Reset to main menu
  document.getElementById('tavern-card-menu').style.display = 'none';
  document.getElementById('tavern-game-area').style.display = 'none';
  const qb = document.getElementById('tavern-quest-board');
  if (qb) qb.style.display = 'none';
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
    msgEl.innerHTML = '<em>Nobody is here. Perhaps you should assign an Tavernkeep in the Citizens tab.</em>';
    return;
  }

  const species = (gameData?.species || 'mouse').toLowerCase();
  const emoji = INNKEEPER_SPECIES_EMOJI[species] || '🦔';
  const greeting = INNKEEPER_GREETINGS[Math.floor(Math.random() * INNKEEPER_GREETINGS.length)];

  portraitEl.textContent = emoji;
  msgEl.innerHTML = `<strong>${tavernkeep.name}</strong> says: <em>"${greeting}"</em>`;
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

// ── Entry point ───────────────────────────────

function startCardGame(type) {
  document.getElementById('tavern-card-menu').style.display = 'none';
  document.getElementById('tavern-menu').style.display = 'none';
  const area = document.getElementById('tavern-game-area');
  area.style.display = 'flex';

  if (type === 'highleaf') _startHighleaf();
  else if (type === 'mouse_grain') _startMouseGrain();
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
