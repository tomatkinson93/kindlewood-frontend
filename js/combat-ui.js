// ══════════════════════════════════════════════════════════════════════════
//  COMBAT UI — Kindlewood
//
//  Renders the combat modal and translates engine events into transitions.
//  The engine (combat-engine.js) is the source of truth; this file holds no
//  authoritative state of its own.
//
//  Public entry points:
//   - startTestBattle()      — used by the Dev Tools button.
//   - startBattle(config)    — quest/expedition hook for later.
//   - closeCombat()          — button + after-battle return.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const E = () => global.CombatEngine;

  // ── Module-local UI state ───────────────────────────────────────────────
  let _battle = null;
  let _selectedAction = null;     // 'attack' | 'defend' | 'skill' (when waiting for target)
  let _pendingCard = null;        // { handIndex, card } when awaiting a card target
  let _animateNextDeal = false;   // animate the hand deal-in on the next render
  let _aiTimer = null;
  let _onUnsubscribe = null;
  // Set when a battle was launched from a quest run; resolution posts back
  // to /api/combat/resolve with this id so the server can update the quest.
  let _battleQuestRunId = null;

  // ── Scene presets — painterly CSS gradients only (no images yet) ────────
  const SCENES = {
    forest: {
      label: 'The Old Wood',
      img: '/assets/battle-maps/forest.png',
      // Very light bottom-only fade; the cm-vignette element handles edges.
      bg: 'linear-gradient(180deg, rgba(15,12,8,0) 60%, rgba(15,12,8,.45) 100%)',
      bgFallback: 'radial-gradient(ellipse at 50% 80%, rgba(60,40,30,.6), rgba(20,12,6,.95)),'
          + 'linear-gradient(180deg, #2c1f14 0%, #1a1410 55%, #0f0c08 100%)',
      accent: '#6c8a55',
    },
    marsh: {
      label: 'The Drowned Marsh',
      img: '/assets/battle-maps/marsh.png',
      bg: 'linear-gradient(180deg, rgba(6,12,14,0) 60%, rgba(6,12,14,.45) 100%)',
      bgFallback: 'radial-gradient(ellipse at 50% 75%, rgba(40,80,70,.55), rgba(8,16,18,.95)),'
          + 'linear-gradient(180deg, #1c2a2c 0%, #0f1c1f 55%, #060c0e 100%)',
      accent: '#5ec4b0',
    },
    ruins: {
      label: 'The Cracked Ruins',
      img: '/assets/battle-maps/ruins.png',
      bg: 'linear-gradient(180deg, rgba(14,10,6,0) 60%, rgba(14,10,6,.45) 100%)',
      bgFallback: 'radial-gradient(ellipse at 50% 80%, rgba(70,50,30,.55), rgba(20,14,8,.95)),'
          + 'linear-gradient(180deg, #2b1f12 0%, #1a130a 55%, #0e0a06 100%)',
      accent: '#c9a25e',
    },
  };

  function pickScene(key) {
    return SCENES[key] || SCENES.forest;
  }

  // ── Public: start a test battle from the Dev Tools button ───────────────
  async function startTestBattle() {
    const Eng = E();
    if (!Eng) { showToastNotification('Combat engine not loaded.', 'default'); return; }

    // Refresh the enemy roster so admin edits in Dev Tools are honoured the
    // very next time a battle starts. Idempotent.
    try { await Eng.loadEnemies(true); } catch(e) {}

    _battleQuestRunId = null;
    const citizens = (typeof citizensData !== 'undefined' ? citizensData : []) || [];
    const players = Eng.rollRandomPlayerParty(citizens, 3);
    if (players.length === 0) {
      showToastNotification('No available citizens to send to battle.', 'default');
      return;
    }

    const enemies = Eng.rollRandomEnemyParty();
    const sceneKey = pickRandomScene();
    return startBattle({ players, enemies, scene: sceneKey });
  }

  // Find the settlement species from whatever global main.js exposes. Different
  // builds may store it differently, so we check the common candidates and fall
  // back to 'human'. Set window.KW_SPECIES anywhere to force it.
  function _resolveSpecies() {
    try {
      var cands = [
        window.KW_SPECIES,
        (window.gameState && window.gameState.species),
        (window.gameData && window.gameData.species),
        (window.settlementData && window.settlementData.species),
        (window.currentUser && window.currentUser.species),
        window.playerSpecies,
        window.SPECIES,
      ];
      for (var i = 0; i < cands.length; i++) {
        if (cands[i] && typeof cands[i] === 'string') return cands[i];
      }
    } catch (e) {}
    return 'human';
  }

  // ── Public: start a battle from a pending quest run ─────────────────────
  // Server-authoritative flow. Each player action POSTs to /api/combat/action
  // and the server returns the new canonical state. The local engine is used
  // only as a state holder for rendering; it does not run actions.
  async function startBattleFromQuest(questRunId) {
    const Eng = E();
    if (!Eng) { showToastNotification('Combat engine not loaded.', 'default'); return; }
    try { await Eng.loadEnemies(true); } catch(e) {}
    await _ensureCardRegistry();

    let data;
    try {
      const res = await apiFetch('/api/combat/engage/' + questRunId, { method: 'POST' });
      data = await res.json();
      if (!res.ok) {
        showToastNotification('⚠️ ' + (data.error || 'Could not engage'), 'default');
        return;
      }
    } catch (e) {
      showToastNotification('⚠️ Could not contact server.', 'default');
      return;
    }

    if (!data.battle) {
      showToastNotification('⚠️ Battle state missing.', 'default');
      return;
    }

    _battleQuestRunId = questRunId;
    const sceneKey = pickRandomScene();

    // Hydrate from server state. We rebuild the listener array since it can't
    // come over JSON, then graft the rest in.
    _battle = Object.assign({}, data.battle, { _listeners: [] });
    _selectedAction = null;
    _ensureModal();
    _showModal(sceneKey);
    _mountHand();
    _renderAll();

    // Music fades in once we know the battle actually opens. Skip it for
    // already-finished battles (resume on a completed fight) — there's no
    // combat happening, just the result screen.
    if (_battle.status === 'active' && typeof playMusic === 'function') {
      try { playMusic('BATTLE'); } catch(e) {}
    }

    // If the server says a battle is over (resume on already-finished one),
    // jump straight to the result screen using the last log entries to
    // figure out which side won.
    if (_battle.status !== 'active') {
      _showResult({ outcome: _battle.status, reward: _battle.reward });
    }
  }

  // ── Server-driven action posting (quest battles) ─────────────────────────
  // Posts the chosen action to the server, gets back the new authoritative
  // state, and animates the diff. AI turns are also handled by the server
  // and arrive as part of the same response (server keeps stepping the
  // battle until the next player turn).
  async function _postQuestAction(actionKey, targetId, extra) {
    if (!_battleQuestRunId) return;
    const prevLogLen = (_battle && _battle.log) ? _battle.log.length : 0;
    try {
      const res = await apiFetch('/api/combat/action/' + _battleQuestRunId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign(
          { action_key: actionKey, target_id: targetId },
          extra || {}
        )),
      });
      const data = await res.json();
      if (!res.ok) {
        showToastNotification('⚠️ ' + (data.error || 'Action rejected'), 'default');
        return;
      }
      // Replace local state with server's. Re-derive animations from log diff.
      const newState = Object.assign({}, data.battle, { _listeners: [] });
      const newLogs = (newState.log || []).slice(prevLogLen);
      _battle = newState;
      _selectedAction = null;
      // If the new log mentions drawing, animate that many trailing cards.
      var drawCount = newLogs.filter(function (l) { return /\bdraws?\b|\bDraws?\b/i.test(l); }).length;
      if (drawCount > 0) _animateNextDeal = drawCount;
      // Walk new log lines, firing animations one at a time on a slight stagger.
      _animateLogDiff(newLogs);
      _renderAll();
      if (data.battle_ended) {
        // Trigger the result screen using the last battle-ended event.
        const finalOutcome = newState.status;
        setTimeout(() => _showResult({ outcome: finalOutcome, reward: newState.reward }), 800);
      }
    } catch(e) {
      showToastNotification('⚠️ Could not contact server.', 'default');
    }
  }

  // Heuristic animation playback for server-driven battles. We don't have
  // engine events; we have log lines. Walk them with a small stagger and
  // pattern-match a few common shapes for hit/miss flash/lunge.
  function _animateLogDiff(newLogLines) {
    if (!newLogLines || !newLogLines.length) return;
    // Each line gets ~250ms; visual cues are best-effort.
    let i = 0;
    const tick = () => {
      const line = newLogLines[i++];
      if (!line) return;
      // crude: any unit name in the line + "for X damage" → flash that target.
      const dmgMatch = line.match(/hits ([^—]+?) for (\d+) damage|strikes ([^—]+?) for (\d+) damage/);
      if (dmgMatch) {
        const targetName = (dmgMatch[1] || dmgMatch[3] || '').trim();
        const target = _battle.units.find(u => u.name === targetName);
        if (target) _flashDamage(target.id, parseInt(dmgMatch[2] || dmgMatch[4] || 0), 0);
      }
      if (i < newLogLines.length) setTimeout(tick, 280);
    };
    tick();
  }

  function pickRandomScene() {
    const keys = Object.keys(SCENES);
    return keys[Math.floor(Math.random() * keys.length)];
  }

  // ── Public: start a battle with a specific config ───────────────────────
  // Used now by the test button; the same call signature will serve quests
  // and encounters later.
  // Load DB card definitions into the client registry so the hand renders the
  // correct names/costs/descriptions and local (test) battles match the server.
  // Cached after first load per session; safe to call repeatedly.
  let _cardRegistryLoaded = false;
  async function _ensureCardRegistry() {
    if (_cardRegistryLoaded) return;
    if (!window.CARD_REGISTRY) return;
    try {
      const r = await apiFetch('/api/card-admin');
      if (r.ok) {
        const d = await r.json();
        if (d.cards) { CARD_REGISTRY.loadRows(d.cards); _cardRegistryLoaded = true; }
      }
    } catch (e) { /* fall back to code cards */ }
  }

  async function startBattle({ players, enemies, scene }) {
    const Eng = E();
    if (!Eng) return;
    await _ensureCardRegistry();

    // Fetch the settlement's active deck so the local (test) battle uses cards.
    // If the fetch fails or returns nothing, createBattle falls back to the
    // classic stamina-only path (deck undefined → uses_cards=false).
    let deck = null;
    try {
      const r = await apiFetch('/api/decks');
      if (r.ok) {
        const d = await r.json();
        const active = (d.templates || []).find(t => t.is_active);
        if (active && active.cards) deck = active.cards;
      }
    } catch (e) { /* classic fallback */ }

    // Resolve the settlement's species (the whole party shares it — e.g. hares)
    // from whatever global the game state populated. Falls back to 'human'. This
    // becomes each player unit's sprite species.
    var species = _resolveSpecies();

    // Local (test) battles are NOT server-replayed, so they should shuffle
    // differently each time. Quest battles pass their own seed via the resolver
    // and stay deterministic. A random deckSeed here makes the draw order vary
    // per battle while keeping a single battle internally consistent.
    var deckSeed = (Math.floor(Math.random() * 0x7fffffff) | 0) || 1;

    _battle = Eng.createBattle({ players, enemies, scene, deck, species, deckSeed });
    _selectedAction = null;

    _ensureModal();
    _showModal(scene);
    _mountHand();
    _renderAll();

    // Subscribe to engine events for log/animation work.
    if (_onUnsubscribe) _onUnsubscribe();
    _onUnsubscribe = Eng.on(_battle, _onEngineEvent);

    // Battle music fades in here. Safe if audio.js isn't loaded.
    if (typeof playMusic === 'function') {
      try { playMusic('BATTLE'); } catch(e) {}
    }

    // Kick the first turn — if it's an enemy, the AI takes it after a beat.
    _scheduleAITurnIfNeeded();
  }

  // ── Card hand mounting & handlers ────────────────────────────────────────
  // The hand UI (card-hand-ui.js) renders state.deck. It's optional — if the
  // module or the deck is absent, the container stays empty and the classic
  // action bar drives the turn. Plays route differently by battle type:
  //   - test battle (local): call the local engine's playCard/endTurn.
  //   - quest battle (server): POST card actions; server replay is canonical.
  function _mountHand() {
    if (typeof CardHandUI === 'undefined') return;
    const container = document.getElementById('cm-cards');
    if (!container) return;
    CardHandUI.mount({
      container,
      getState: () => _battle,
      isPlayerTurn: () => {
        const Eng = E();
        const cur = Eng && Eng.currentUnit(_battle);
        return !!(cur && cur.side === 'player');
      },
      getActor: () => {
        const Eng = E();
        return Eng ? Eng.currentUnit(_battle) : null;
      },
      onPlay: (handIndex, targetId, card) => _onCardPlay(handIndex, targetId, card),
      onEndTurn: () => _onCardEndTurn(),
      // For enemy-targeted cards in the MVP we auto-pick the first enemy
      // server-side, so no target picker is needed yet. Returning null lets
      // the engine choose. (A future target-select mode can hook in here.)
      getRequestedTarget: (targetMode) => {
        if (targetMode !== 'enemy') return null;
        const Eng = E();
        const enemy = Eng && Eng.aliveOnSide(_battle, 'enemy')[0];
        return enemy ? enemy.id : null;
      },
    });
  }

  function _onCardPlay(handIndex, targetId, card) {
    if (!_battle || _battle.status !== 'active') return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return;

    // Card-click sound.
    _playClickSfx();

    const targetsUnits = _cardTargetsUnits(card);

    // First click (or switching cards): select & hold. If it targets units,
    // they glow and a unit-click will play it; if not (self/none), a second
    // click on the same card plays it.
    if (!_pendingCard || _pendingCard.handIndex !== handIndex) {
      _pendingCard = { handIndex: handIndex, card: card, targetsUnits: targetsUnits };
      _renderAll();
      return;
    }

    // Same card clicked again:
    if (targetsUnits) {
      // It wants a unit target — second click on the card cancels the selection.
      _pendingCard = null;
      _renderAll();
      return;
    }
    // Self/none card → play it now.
    _pendingCard = null;
    _executeCardPlay(handIndex, targetId);
  }

  // Actually play the card (local) or post it (quest). targetId may be null;
  // the engine auto-resolves single/none targets.
  function _executeCardPlay(handIndex, targetId) {
    const Eng = E();
    if (_battleQuestRunId) {
      _postQuestAction('card', targetId, { hand_index: handIndex });
      return;
    }
    // NOTE: do NOT call _renderAll() after playCard. The engine emits events
    // (card-played, card-drawn, damage…) synchronously during playCard, and
    // each one already triggers a render via _onEngineEvent. A trailing render
    // here would run AFTER the card-drawn animation flag was consumed, snapping
    // freshly-drawn cards into place and cancelling the deal-in animation.
    Eng.playCard(_battle, handIndex, targetId);
  }

  // Formation move: spend 1 energy to shift the active unit forward (-1) or
  // back (+1). Quest battles post the action; local battles run it directly.
  function _onCardMove(delta) {
    if (!_battle || _battle.status !== 'active') return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return;
    if (!_battle.deck || _battle.deck.energy < 1) {
      if (typeof showToastNotification === 'function') showToastNotification('Not enough energy to reposition.', 'default');
      return;
    }
    _pendingCard = null;
    _playClickSfx();
    if (_battleQuestRunId) {
      _postQuestAction('move', null, { delta: delta });
      return;
    }
    Eng.moveActor(_battle, delta);
    _renderAll();
  }

  function _onCardEndTurn() {
    if (!_battle || _battle.status !== 'active') return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return;

    if (_battleQuestRunId) {
      _animateNextDeal = 'all';
      _postQuestAction('end_turn', null, {});
      return;
    }
    Eng.endTurn(_battle);
    _animateNextDeal = 'all';
    _renderAll();
    _scheduleAITurnIfNeeded();
  }

  function closeCombat() {
    if (_aiTimer) { clearTimeout(_aiTimer); _aiTimer = null; }
    if (_onUnsubscribe) { _onUnsubscribe(); _onUnsubscribe = null; }
    _pendingCard = null;
    if (typeof CardHandUI !== 'undefined') { try { CardHandUI.unmount(); } catch(e) {} }
    const modal = document.getElementById('combat-modal');
    if (modal) modal.style.display = 'none';
    _battle = null;
    _battleQuestRunId = null;
    _selectedAction = null;
    // Fade the music out.
    if (typeof stopMusic === 'function') {
      try { stopMusic(); } catch(e) {}
    }
  }

  // ── DOM construction ────────────────────────────────────────────────────
  function _injectLayoutStyles() {
    if (document.getElementById('cm-layout-overrides')) return;
    const s = document.createElement('style');
    s.id = 'cm-layout-overrides';
    // These override the base combat stylesheet to enlarge the modal and give
    // the battle stage far more room relative to the controls. Uses !important
    // because the base rules are more specific in places.
    s.textContent = `
      #combat-modal .cm-card {
        width: 96vw !important;
        height: 94vh !important;
        max-width: 96vw !important;
        max-height: 94vh !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }
      /* Arena dominates the available height. */
      #combat-modal .cm-scene {
        flex: 1 1 auto !important; min-height: 0 !important;
        background-position: center !important; background-size: cover !important;
        background-repeat: no-repeat !important;
        padding: 0 !important; margin: 0 !important; border-radius: 0 !important;
        position: relative !important;
      }
      /* Header floats over the map rather than taking a solid strip at the top. */
      #combat-modal .cm-scene-header {
        position: absolute !important; top: 0; left: 0; right: 0; z-index: 20;
        background: linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,0)) !important;
      }
      #combat-modal .cm-stage { height: 100% !important; }
      /* The base stylesheet adds cm-fog + cm-vignette overlay elements that
         darken the perimeter. With a real battle-map image we want the art to
         read out to the edges, so soften both considerably. */
      #combat-modal .cm-fog { opacity: .15 !important; }
      #combat-modal .cm-vignette {
        box-shadow: none !important;
        background: radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 100%) !important;
      }

      /* Initiative row becomes a flex row so End Turn can sit at its right end,
         in line with the turn order. */
      #combat-modal .cm-initiative {
        flex: 0 0 auto !important;
        display: flex !important; align-items: center !important; gap: 10px !important;
        flex-wrap: wrap;
      }
      #combat-modal .cm-initiative-strip { flex: 1 1 auto !important; }
      #combat-modal .cm-endturn-rail {
        flex: 0 0 auto !important;
        margin-left: auto !important;
        padding: 8px 22px !important;
      }

      /* Bottom band: left rail (energy + piles), centred cards, right log.
         The middle column uses minmax(0,1fr) so the fanned hand's wide
         min-content can't force the grid wider than the modal (which was
         pushing the hand right and making the layout appear to expand). */
      #combat-modal .cm-bottom {
        flex: 0 0 290px !important;     /* HARD height — scene gets the exact rest */
        height: 290px !important;
        display: grid !important;
        grid-template-columns: 230px minmax(0, 1fr) 300px !important;
        align-items: start !important;
        gap: 10px !important;
        padding: 2px 14px 8px !important;
        width: 100% !important;
        box-sizing: border-box !important;
        overflow: visible !important;
      }
      #combat-modal .cm-actions {
        grid-column: 1 / -1 !important;
        text-align: center;
        min-height: 22px;
      }
      /* Reserve the hand's vertical space even on the enemy turn (empty hand) so
         the layout doesn't expand/contract between turns. */
      #combat-modal .cm-cards {
        grid-column: 2 !important;
        min-width: 0 !important;        /* allow the column to actually shrink */
        align-self: end !important;
        transform: translateY(-12px);
        min-height: 200px !important;
      }
      /* The energy/piles bar sits at the TOP of the left rail, roomy. */
      #combat-modal .cm-leftrail {
        grid-column: 1 !important;
        align-self: start !important;
        display: flex; flex-direction: column; gap: 14px;
        padding-top: 4px;
      }
      #combat-modal .cm-log-wrap {
        grid-column: 3 !important;
        justify-self: end !important;
        align-self: start !important;
        width: 300px !important;
        height: auto !important;
        min-height: 256px !important;
        max-height: 256px !important;
        display: flex !important; flex-direction: column !important;
        background: rgba(20,15,9,.55);
        border: 1px solid #4a3f28;
        border-radius: 8px;
        padding: 6px 8px;
      }
      #combat-modal .cm-log-label { font-size: 10px !important; opacity: .7; margin-bottom: 3px; }
      #combat-modal .cm-log {
        flex: 1 1 auto !important;
        max-height: none !important;
        overflow-y: auto !important;
        font-size: 11px !important;
        line-height: 1.4 !important;
        padding-right: 4px;
      }
      #combat-modal .kw-hand { min-height: 178px !important; }
      #combat-modal .kw-card { width: 122px !important; height: 178px !important; }
    `;
    document.head.appendChild(s);
  }

  function _ensureModal() {
    if (document.getElementById('combat-modal')) return;
    _injectLayoutStyles();
    const root = document.createElement('div');
    root.id = 'combat-modal';
    root.className = 'cm-backdrop';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="cm-card">
        <div class="cm-scene" id="cm-scene">
          <div class="cm-fog"></div>
          <div class="cm-vignette"></div>
          <div class="cm-scene-header">
            <div class="cm-scene-title" id="cm-scene-title">A Battle</div>
            <div class="cm-scene-round" id="cm-scene-round">Round 1</div>
            <button class="cm-flee" onclick="closeCombat()" title="Retreat">✕</button>
          </div>
          <div class="cm-stage">
            <div class="cm-sprites cm-sprites-player" id="cm-sprites-player"></div>
            <div class="cm-sprites cm-sprites-enemy" id="cm-sprites-enemy"></div>
            <div class="cm-side cm-side-player" id="cm-player-side"></div>
            <div class="cm-vs">⚔</div>
            <div class="cm-side cm-side-enemy" id="cm-enemy-side"></div>
          </div>
        </div>

        <div class="cm-initiative" id="cm-initiative">
          <div class="cm-initiative-label">Turn Order <span class="cm-initiative-hint">— ordered by Dexterity</span></div>
          <div class="cm-initiative-strip" id="cm-initiative-strip"></div>
          <button class="kw-endturn cm-endturn-rail" id="cm-endturn-btn" onclick="combatEndTurn()">End Turn</button>
        </div>

        <div class="cm-bottom">
          <div class="cm-actions" id="cm-actions"></div>
          <div class="cm-leftrail" id="cm-leftrail"></div>
          <div class="cm-cards" id="cm-cards"></div>
          <div class="cm-log-wrap">
            <div class="cm-log-label">Battle Log</div>
            <div class="cm-log" id="cm-log"></div>
          </div>
        </div>

        <div class="cm-result" id="cm-result" style="display:none">
          <div class="cm-result-card">
            <div class="cm-result-title" id="cm-result-title"></div>
            <div class="cm-result-body" id="cm-result-body"></div>
            <button class="cm-result-btn" id="cm-result-btn" onclick="closeCombat()">Return</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  }

  function _showModal(sceneKey) {
    const modal = document.getElementById('combat-modal');
    const scene = document.getElementById('cm-scene');
    const title = document.getElementById('cm-scene-title');
    const result = document.getElementById('cm-result');
    if (!modal || !scene) return;

    const s = pickScene(sceneKey);
    // Show the opaque fallback gradient immediately. If a battle-map image is
    // configured and loads, swap to the image with only a translucent vignette
    // overlay so the map is clearly visible. If it 404s, keep the fallback.
    scene.style.background = (s.bgFallback || s.bg);
    scene.style.setProperty('--cm-accent', s.accent);
    if (s.img) {
      const probe = new Image();
      probe.onload = function () {
        scene.style.backgroundImage = s.bg + ', url("' + s.img + '")';
        scene.style.backgroundSize = 'cover, cover';
        scene.style.backgroundPosition = 'center, center';
        scene.style.backgroundRepeat = 'no-repeat, no-repeat';
      };
      probe.onerror = function () {
        console.warn('[combat] battle-map image not found:', s.img, '— using gradient fallback');
      };
      probe.src = s.img;
    }
    title.textContent = s.label;
    result.style.display = 'none';
    modal.style.display = 'flex';
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function _renderAll() {
    if (!_battle) return;
    // Drop any pending card target if it's no longer the player's turn.
    const Eng = E();
    const cur = Eng && Eng.currentUnit(_battle);
    if (_pendingCard && (!cur || cur.side !== 'player')) _pendingCard = null;

    _renderSide('player');
    _renderSide('enemy');
    _renderSprites('player');
    _renderSprites('enemy');
    _renderInitiative();
    _renderActions();
    _renderLog();
    _renderRound();
    if (typeof CardHandUI !== 'undefined' && _battle.uses_cards) {
      CardHandUI.render(_pendingCard ? _pendingCard.handIndex : -1, _animateNextDeal);
      _animateNextDeal = false;
      _updateEndTurnButton();
    }
  }

  // The End Turn button lives in the initiative row (built once in the modal).
  // We just enable/disable it based on whose turn it is.
  function _updateEndTurnButton() {
    var btn = document.getElementById('cm-endturn-btn');
    if (!btn) return;
    var Eng = E();
    var cur = Eng && Eng.currentUnit(_battle);
    var playerTurn = !!(cur && cur.side === 'player' && _battle.uses_cards && _battle.status === 'active');
    btn.style.display = _battle.uses_cards ? '' : 'none';
    btn.disabled = !playerTurn;
    btn.classList.toggle('disabled', !playerTurn);
  }

  function _renderRound() {
    const el = document.getElementById('cm-scene-round');
    if (el) el.textContent = 'Round ' + _battle.round;
  }

  // Up to 8 upcoming turns. Shows the current actor highlighted, with a
  // round-divider when the queue rolls over. Re-renders on every event so it
  // stays in lockstep with the engine.
  function _renderInitiative() {
    const strip = document.getElementById('cm-initiative-strip');
    if (!strip) return;
    const Eng = E();
    const preview = Eng.getTurnOrderPreview(_battle, 8);
    if (!preview.length) { strip.innerHTML = ''; return; }

    const cur = Eng.currentUnit(_battle);
    const curId = cur ? cur.id : null;
    let lastRound = preview[0].round;
    const parts = [];
    preview.forEach((p, i) => {
      if (p.round !== lastRound) {
        parts.push('<div class="cm-init-divider" title="Round ' + p.round + '">↻</div>');
        lastRound = p.round;
      }
      const u = p.unit;
      const isCur = (i === 0) && (u.id === curId);
      const sideClass = u.side === 'player' ? 'is-player' : 'is-enemy';
      const portrait = u.archetype === 'citizen'
        ? '<span class="cm-init-portrait cm-init-portrait-citizen">' + _initial(u.name) + '</span>'
        : '<span class="cm-init-portrait">' + u.icon + '</span>';
      parts.push(
        '<div class="cm-init-pip ' + sideClass + (isCur ? ' is-current' : '') + '" ' +
             'title="' + _escapeHtml(u.name) + ' · DEX ' + u.agility + '">' +
          portrait +
          '<span class="cm-init-name">' + _escapeHtml(u.name.length > 9 ? u.name.slice(0,8) + '…' : u.name) + '</span>' +
        '</div>'
      );
    });
    strip.innerHTML = parts.join('');
  }

  function _renderSide(side) {
    const root = document.getElementById('cm-' + side + '-side');
    if (!root) return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    // Order so the two front lines face each other in the middle. Player front
    // (#1) sits at the RIGHT (nearest the enemy), enemy front (#1) at the LEFT.
    let units = _battle.units.filter(u => u.side === side)
      .slice().sort((a, b) => (a.pos || 99) - (b.pos || 99));
    if (side === 'player') units = units.reverse(); // #1 ends up rightmost

    root.innerHTML = units.map(u => _unitCardHtml(u, cur)).join('');
  }

  // Render standing character sprites on the battlefield. Players stand on the
  // left, facing right; enemies on the right, facing left (mirrored). Ordered by
  // formation so the front-most stands nearest the centre line. Sprites carry
  // data-sprite-id so the hit/lunge/turn effects can target them.
  // Break a telegraphed move into typed predicted chunks for the arcade intent
  // display above the enemy: [{kind:'damage'|'block'|'status'|'heal'|..., value,
  // label}]. Damage shows the per-hit number; status/heal/block show their
  // amount. Uses the formula parser to read verbs + evaluate amounts vs the
  // enemy's stats.
  function _intentChunks(enemy, move) {
    const out = [];
    if (!move || !move.formula) return out;
    const FM = window.CARD_FORMULA;
    if (!FM || !FM.parseFormula) return out;
    let parsed;
    try { parsed = FM.parseFormula(move.formula); } catch (e) { return out; }
    if (!parsed || !parsed.ops) return out;
    parsed.ops.forEach(op => {
      let val = 0;
      try { val = Math.round(op.eval(enemy)); } catch (e) { val = 0; }
      switch (op.verb) {
        case 'damage':
          out.push({ kind: 'damage', value: Math.max(1, val), icon: '⚔' });
          break;
        case 'block':
          out.push({ kind: 'block', value: Math.max(0, val), icon: '🛡' });
          break;
        case 'heal':
          out.push({ kind: 'heal', value: Math.max(0, val), icon: '✚' });
          break;
        case 'poison': out.push({ kind: 'status', value: Math.max(1, val), icon: '☠', label: 'poison' }); break;
        case 'stun':   out.push({ kind: 'status', value: Math.max(1, val), icon: '✦', label: 'stun' }); break;
        case 'slow':   out.push({ kind: 'status', value: Math.max(1, val), icon: '⇩', label: 'slow' }); break;
        case 'debuff': out.push({ kind: 'status', value: Math.max(1, val), icon: '☠', label: op.param || 'debuff' }); break;
        case 'buff':   out.push({ kind: 'buff', value: Math.max(1, val), icon: '⬆', label: op.param || 'buff' }); break;
        case 'push':   out.push({ kind: 'move', value: val, icon: '↦', label: 'push' }); break;
        default: break;
      }
    });
    return out;
  }

  // Resolve the unit a telegraphed move will hit (for the "targeting" label).
  function _intentTargetName(enemy, move) {
    if (!move) return '';
    const mode = move.target || 'enemy';
    const hit = move.hit || 'choose';
    if (mode === 'self') return enemy.name;
    if (mode === 'all_enemies' || hit === 'aoe') return 'all';
    const players = _battle.units.filter(u => u.side === 'player' && !u.flags.downed)
      .slice().sort((a, b) => (a.pos || 99) - (b.pos || 99));
    if (!players.length) return '';
    if (mode === 'ally' || mode === 'all_allies') return 'allies';
    // Pierce hits a line of foes — say "all" if it goes all the way through,
    // otherwise show how many it pierces.
    if (hit === 'pierce') {
      const depth = (move.pierce_count != null) ? move.pierce_count : players.length;
      if (depth >= players.length) return 'all';
      return 'front ' + depth;
    }
    // front / choose → frontmost player
    return players[0] ? players[0].name : '';
  }

  // Build the arcade intent block shown above an enemy sprite.
  function _intentBlockHtml(enemy) {
    if (!enemy._intent || enemy.flags.downed) return '';
    const chunks = _intentChunks(enemy, enemy._intent);
    if (!chunks.length) {
      // Non-numeric move (pure reposition/special) — show a small move name.
      return '<div class="cm-bf-intent"><div class="cm-bf-intent-row">'
        + '<span class="cm-bf-intent-chunk kind-special">✴ ' + _escapeHtml(enemy._intent.name || '') + '</span>'
        + '</div></div>';
    }
    const rows = chunks.map(c => {
      const cls = 'kind-' + c.kind;
      const txt = (c.kind === 'damage' || c.kind === 'block' || c.kind === 'heal')
        ? c.value
        : (c.label ? (c.label + (c.value ? ' ' + c.value : '')) : c.value);
      return '<span class="cm-bf-intent-chunk ' + cls + '">'
        + '<span class="cm-bf-intent-ic">' + c.icon + '</span>'
        + '<span class="cm-bf-intent-val">' + _escapeHtml(String(txt)) + '</span></span>';
    }).join('');
    const tgt = _intentTargetName(enemy, enemy._intent);
    return '<div class="cm-bf-intent">'
      + '<div class="cm-bf-intent-row">' + rows + '</div>'
      + (tgt ? '<div class="cm-bf-intent-target">▸ ' + _escapeHtml(tgt) + '</div>' : '')
      + '</div>';
  }

  function _renderSprites(side) {
    const root = document.getElementById('cm-sprites-' + side);
    if (!root) return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    let units = _battle.units.filter(u => u.side === side && !u.flags.downed)
      .slice().sort((a, b) => (a.pos || 99) - (b.pos || 99));
    if (side === 'player') units = units.reverse();

    // Signature of what actually affects the sprite layer: which units, their
    // order, hp (for fall), and whose turn it is. If unchanged since the last
    // render we DON'T rebuild — rebuilding re-creates the <img> elements, which
    // makes them re-decode and flash on every card click. We only refresh the
    // is-current class in that case (cheap, no image reload).
    // Signature includes the telegraphed intent and current targetability so the
    // overhead display + target highlight update when the planned move changes or
    // a unit-targeting card is selected.
    const pendingSig = (_pendingCard && _pendingCard.targetsUnits) ? 'P' : (_selectedAction || '-');
    const sig = units.map(u => u.id + ':' + u.pos + ':' + (u.hp > 0 ? 1 : 0)
              + ':' + (u._intent ? u._intent.key : '')
              + ':' + (_isTargetable(u) ? 'T' : '')).join('|')
              + '#' + (cur ? cur.id : '') + '#' + pendingSig;
    if (root._spriteSig === sig) {
      // Same roster — just move the turn highlight without rebuilding images.
      root.querySelectorAll('.cm-bf-sprite').forEach(node => {
        const isCur = cur && node.getAttribute('data-sprite-id') === cur.id;
        node.classList.toggle('is-current', !!isCur);
      });
      return;
    }
    // FLIP: capture each existing sprite's screen position BEFORE the rebuild so
    // we can animate it sliding from its old spot to its new one (formation
    // swaps rush past each other instead of teleporting).
    const firstRects = {};
    root.querySelectorAll('.cm-bf-sprite').forEach(node => {
      const id = node.getAttribute('data-sprite-id');
      if (id) firstRects[id] = node.getBoundingClientRect();
    });

    root._spriteSig = sig;

    root.innerHTML = units.map((u) => {
      const isCur = cur && cur.id === u.id;
      const facing = side === 'player' ? 'face-right' : 'face-left';
      let inner;
      if (u.archetype === 'citizen') {
        const species = (u.species || _resolveSpecies() || 'human').toString().toLowerCase().replace(/[^a-z0-9_]/g, '');
        inner = '<img class="cm-bf-sprite-img" src="/assets/sprites/' + species + '.png" alt="" '
          + 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
          + '<span class="cm-bf-sprite-fallback">' + _escapeHtml(u.icon || _initial(u.name)) + '</span>';
      } else {
        inner = '<img class="cm-bf-sprite-img" src="/assets/sprites/enemy_' + _escapeHtml(u.enemy_key || u.archetype || '') + '.png" alt="" '
          + 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
          + '<span class="cm-bf-sprite-fallback cm-bf-emoji">' + (u.icon || '👹') + '</span>';
      }
      const intentHtml = (side === 'enemy') ? _intentBlockHtml(u) : '';
      const targetable = _isTargetable(u);
      const tgtClass = targetable ? ' is-targetable' : '';
      const click = targetable ? ' onclick="combatSpriteClick(\'' + u.id + '\')"' : '';
      return '<div class="cm-bf-sprite ' + facing + (isCur ? ' is-current' : '') + tgtClass + '" '
        + 'data-sprite-id="' + u.id + '" title="' + _escapeHtml(u.name) + '"' + click + '>'
        + intentHtml
        + inner + '</div>';
    }).join('');

    // FLIP second half: for any sprite that existed before, translate it from its
    // old position to the new one, then transition the transform back to 0.
    root.querySelectorAll('.cm-bf-sprite').forEach(node => {
      const id = node.getAttribute('data-sprite-id');
      const prev = firstRects[id];
      if (!prev) return; // newly added sprite — no slide
      const now = node.getBoundingClientRect();
      const dx = prev.left - now.left;
      if (Math.abs(dx) < 2) return;
      node.style.transition = 'none';
      node.style.transform = 'translateX(' + dx + 'px)';
      node.classList.add('is-swapping');
      // next frame: release to the natural position with a transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          node.style.transition = 'transform .38s cubic-bezier(.34,1.2,.5,1)';
          node.style.transform = '';
          setTimeout(() => {
            node.style.transition = '';
            node.classList.remove('is-swapping');
          }, 420);
        });
      });
    });
  }

  function _intentIcon(intent) {
    switch (intent) {
      case 'attack':  return '⚔️';
      case 'block':   return '🛡️';
      case 'buff':    return '⬆️';
      case 'debuff':  return '☠️';
      case 'move':    return '🔁';
      case 'special': return '✴️';
      default:        return '⚔️';
    }
  }

  // Human-readable preview of what a move will do, computed from the actor's
  // current stats via the formula module (same engine cards use for previews).
  function _movePreview(actor, move) {
    if (!move || !move.formula) return '';
    var FM = window.CARD_FORMULA;
    if (FM && FM.previewEffect) {
      try { return FM.previewEffect(move.formula, actor); } catch (e) {}
    }
    return move.name || '';
  }

  // The unit ids a telegraphed move would affect, honouring hit mode.
  function _moveAffectedIds(enemy, move) {
    const Eng = E();
    if (!_battle || !move) return [];
    const CC = window.CARD_COMBAT;
    const mode = move.target || 'enemy';
    // For enemy moves, "enemy" means the players' side.
    let pool = [];
    if (mode === 'self') pool = [enemy];
    else if (mode === 'ally' || mode === 'all_allies') {
      pool = _battle.units.filter(u => u.side === 'enemy' && !u.flags.downed && u.id !== enemy.id);
    } else {
      // targets players
      pool = _battle.units.filter(u => u.side === 'player' && !u.flags.downed);
    }
    if (!pool.length) return [];
    const hit = move.hit || 'choose';
    if (mode === 'self') return [enemy.id];
    if (mode === 'all_enemies' || mode === 'all_allies' || hit === 'aoe') return pool.map(u => u.id);
    // front / pierce / choose against the players: order by pos.
    const ordered = pool.slice().sort((a, b) => (a.pos || 99) - (b.pos || 99));
    if (hit === 'front') return ordered.length ? [ordered[0].id] : [];
    if (hit === 'pierce') {
      const depth = move.pierce_count != null ? move.pierce_count : ordered.length;
      return ordered.slice(0, depth).map(u => u.id);
    }
    // choose → frontmost as a representative preview
    return ordered.length ? [ordered[0].id] : [];
  }

  let _intentHoverIds = [];
  function combatHoverIntent(enemyId) {
    const enemy = _battle && _battle.units.find(u => u.id === enemyId);
    if (!enemy || !enemy._intent) return;
    _intentHoverIds = _moveAffectedIds(enemy, enemy._intent);
    _intentHoverIds.forEach(id => {
      const node = document.querySelector('.cm-unit[data-unit-id="' + id + '"]');
      if (node) node.classList.add('cm-intent-target');
    });
  }
  function combatClearIntentHover() {
    _intentHoverIds.forEach(id => {
      const node = document.querySelector('.cm-unit[data-unit-id="' + id + '"]');
      if (node) node.classList.remove('cm-intent-target');
    });
    _intentHoverIds = [];
  }

  function _unitCardHtml(unit, currentUnit) {
    const isCurrent = currentUnit && currentUnit.id === unit.id;
    const isTargetable = _isTargetable(unit);
    const hpPct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
    const stPct = Math.max(0, Math.round((unit.stamina / unit.maxStamina) * 100));
    const downedClass = unit.flags.downed ? ' is-downed' : '';
    const currentClass = isCurrent ? ' is-current' : '';
    const targetClass = isTargetable ? ' is-targetable' : '';
    const defendClass = unit.flags.defending ? ' is-defending' : '';

    const onClick = isTargetable ? `onclick="combatSelectTarget('${unit.id}')"` : '';

    // Portrait. For citizens we show the species sprite (/assets/sprites/
    // <species>.png) and fall back to the initial medallion if the image is
    // missing or fails to load. Enemies use their emoji icon (or sprite later).
    let portraitHtml;
    if (unit.archetype === 'citizen') {
      const species = (unit.species || _resolveSpecies() || 'human').toString().toLowerCase().replace(/[^a-z0-9_]/g, '');
      const fallback = _initial(unit.name);
      portraitHtml = '<div class="cm-portrait cm-portrait-citizen" data-role="' + unit.role + '">'
        + '<img class="cm-sprite" src="/assets/sprites/' + species + '.png" alt="" '
        + 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
        + '<span class="cm-sprite-fallback">' + fallback + '</span>'
        + '</div>';
    } else {
      portraitHtml = '<div class="cm-portrait cm-portrait-enemy">' + unit.icon + '</div>';
    }

    const skillLabel = unit.skill_label || 'Skill';
    const sub = unit.archetype === 'citizen'
      ? '<span class="cm-role">' + _capitalise(unit.role) + '</span>'
      : '<span class="cm-role cm-role-enemy">Enemy</span>';

    // Just a small position badge on the card; the move controls live in the
    // left rail (rendered by the hand UI) so they don't crowd the card header.
    let formationHtml = '';
    if (unit.pos != null) {
      formationHtml = '<span class="cm-pos-badge cm-pos-badge-static" title="Formation position">#' + unit.pos + '</span>';
    }

    // (Enemy intent is now shown above the battlefield sprite, not on the card.)

    return `
      <div class="cm-unit${currentClass}${targetClass}${downedClass}${defendClass}" data-unit-id="${unit.id}" ${onClick}>
        <div class="cm-unit-header">
          ${portraitHtml}
          <div class="cm-unit-name-block">
            <div class="cm-unit-name">${unit.name}</div>
            ${sub}
          </div>
          ${formationHtml}
        </div>
        <div class="cm-bar cm-bar-hp">
          <div class="cm-bar-fill" style="width:${hpPct}%"></div>
          <div class="cm-bar-text">${unit.hp} / ${unit.maxHp}</div>
        </div>
        ${unit.archetype === 'citizen' ? `
          <div class="cm-bar cm-bar-stamina">
            <div class="cm-bar-fill" style="width:${stPct}%"></div>
            <div class="cm-bar-text">${unit.stamina} / ${unit.maxStamina}</div>
          </div>
        ` : ''}
        ${unit.flags.defending ? '<div class="cm-tag cm-tag-defend">🛡 Defending</div>' : ''}
        ${unit.flags.downed ? '<div class="cm-tag cm-tag-downed">— Fallen —</div>' : ''}
        ${_statusPipsHtml(unit)}
      </div>`;
  }

  // Status effect pips shown under a unit: block shield, buffs (green) and
  // debuffs (red), each with a hover tooltip explaining the effect.
  function _statusPipsHtml(unit) {
    const pips = [];
    // Block shield first (neutral/blue) when the unit has standing block.
    if (unit.block && unit.block > 0) {
      pips.push(_pip('shield', '🛡', unit.block, 'Block: absorbs ' + unit.block + ' damage before health.'));
    }
    const b = unit.buffs || {};
    // Buffs (green)
    if (b.damage_bonus > 0) pips.push(_pip('buff', '⚔', b.damage_bonus, 'Empowered: next attack deals +' + b.damage_bonus + ' damage.'));
    if (b.block_bonus > 0)  pips.push(_pip('buff', '🛡', b.block_bonus, 'Fortified: gains +' + b.block_bonus + ' block from defend cards.'));
    // Debuffs (red)
    if (b.poison > 0)     pips.push(_pip('debuff', '☠', b.poison, 'Poisoned: takes ' + b.poison + ' damage at the start of its turn (decays each turn).'));
    if (b.weak > 0)       pips.push(_pip('debuff', '💢', b.weak, 'Weakened: deals ' + b.weak + ' less damage.'));
    if (b.vulnerable > 0) pips.push(_pip('debuff', '🩸', b.vulnerable, 'Vulnerable: takes ' + b.vulnerable + ' extra damage from all sources.'));
    if (b.slow > 0)       pips.push(_pip('debuff', '🐌', b.slow, 'Slowed: initiative lowered by ' + b.slow + ' (acts later).'));
    if (b.stun > 0)       pips.push(_pip('debuff', '💫', b.stun, 'Stunned: will skip ' + b.stun + ' turn' + (b.stun > 1 ? 's' : '') + '.'));
    if (!pips.length) return '';
    return '<div class="cm-status-pips">' + pips.join('') + '</div>';
  }

  function _pip(kind, icon, value, tip) {
    return '<span class="cm-pip cm-pip-' + kind + '" data-tip="' + _escapeHtml(tip) + '">'
      + '<span class="cm-pip-icon">' + icon + '</span>'
      + (value != null ? '<span class="cm-pip-val">' + value + '</span>' : '')
      + '<span class="cm-pip-tip">' + _escapeHtml(tip) + '</span>'
      + '</span>';
  }

  function _initial(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }
  function _capitalise(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function _isTargetable(unit) {
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return false;
    if (unit.flags.downed) return false;

    // When a card is pending, highlight every valid target it could hit — for
    // single-target, AoE, ally, or any modes alike. Clicking any of them plays
    // the card. (Self/none cards have no unit targets and aren't highlighted.)
    if (_pendingCard && _pendingCard.targetsUnits) {
      var CC = window.CARD_COMBAT;
      if (!CC || !CC.validTargets) return false;
      var valid = CC.validTargets(_battle, cur, _pendingCard.card);
      return valid.some(function (u) { return u.id === unit.id; });
    }

    if (!_selectedAction) return false;
    const action = Eng.getAction(_selectedAction);
    if (!action) return false;
    if (action.target_type === 'enemy') return unit.side === 'enemy';
    if (action.target_type === 'self')  return unit.id === cur.id;
    return false;
  }

  // Does this card target units the player would click? True for enemy/ally/
  // ally_or_self/any and their AoE variants; false for self/none.
  function _cardTargetsUnits(card) {
    const CC = window.CARD_COMBAT;
    if (!CC || !CC.validTargets) return false;
    const mode = (card && card.target) || 'none';
    if (mode === 'self' || mode === 'none') return false;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    return CC.validTargets(_battle, cur, card).length > 0;
  }

  // ── Action bar ───────────────────────────────────────────────────────────
  function _renderActions() {
    const root = document.getElementById('cm-actions');
    if (!root) return;

    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur) {
      root.innerHTML = '<div class="cm-actions-empty">…</div>';
      return;
    }

    if (cur.side !== 'player') {
      root.innerHTML = `<div class="cm-actions-enemy-turn">${cur.icon} <b>${cur.name}</b> is acting…</div>`;
      return;
    }

    // Card battles: the hand UI below the action bar drives the turn. Show a
    // slim prompt here instead of the classic stamina buttons.
    if (_battle.uses_cards) {
      if (_pendingCard) {
        const cardName = _pendingCard.card && _pendingCard.card.name ? _pendingCard.card.name : 'card';
        root.innerHTML = '<div class="cm-actor-prompt cm-targeting">Choose a target for <b>' +
          _escapeHtml(cardName) + '</b> \u2014 or click the card again to cancel.</div>';
      } else {
        root.innerHTML = `<div class="cm-actor-prompt"><b>${_escapeHtml(cur.name)}</b>'s turn — play cards below.</div>`;
      }
      return;
    }

    // Player turn
    const skillLabel = cur.skill_label || 'Skill';
    const skillIcon  = cur.skill_icon  || '✦';
    const canSkill   = cur.stamina >= Eng.getAction('skill').stamina_cost;

    const promptText = _selectedAction
      ? (_selectedAction === 'defend'
          ? '— Defending — confirm or pick another action.'
          : 'Choose a target.')
      : `<b>${cur.name}</b>'s turn.`;

    root.innerHTML = `
      <div class="cm-actor-prompt">${promptText}</div>
      <div class="cm-action-grid">
        ${_actionBtn('attack', '⚔', 'Attack', '0', false, _selectedAction === 'attack')}
        ${_actionBtn('skill', skillIcon, skillLabel, String(Eng.getAction('skill').stamina_cost), !canSkill, _selectedAction === 'skill')}
        ${_actionBtn('defend', '🛡', 'Defend', '+2', false, _selectedAction === 'defend')}
      </div>
      ${_selectedAction === 'defend' ? `
        <button class="cm-confirm-btn" onclick="combatSelectTarget('${cur.id}')">Confirm Defend</button>
      ` : ''}
    `;
  }

  function _actionBtn(key, icon, label, costLabel, disabled, selected) {
    return `
      <button class="cm-action-btn${selected ? ' is-selected' : ''}"
              ${disabled ? 'disabled' : ''}
              onclick="combatChooseAction('${key}')">
        <div class="cm-action-icon">${icon}</div>
        <div class="cm-action-label">${label}</div>
        <div class="cm-action-cost">${costLabel} stamina</div>
      </button>`;
  }

  // ── Log ─────────────────────────────────────────────────────────────────
  function _renderLog() {
    const log = document.getElementById('cm-log');
    if (!log) return;
    // Last ~20 lines, newest at bottom.
    const lines = (_battle.log || []).slice(-20);
    log.innerHTML = lines.map(l => '<div class="cm-log-line">' + _escapeHtml(l) + '</div>').join('');
    log.scrollTop = log.scrollHeight;
  }

  function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ── Engine event handler ────────────────────────────────────────────────
  // Translates engine events into UI transitions: damage popups, hit flashes,
  // log refresh, and turn handoff. Keep the heavy work out of the engine.
  function _onEngineEvent(evt, state) {
    if (!_battle) return;

    switch (evt.type) {
      case 'damage':
        _flashDamage(evt.target_id, evt.amount, evt.mitigated);
        _lungeAttacker(evt.actor_id);
        break;
      case 'defend':
        _markDefendingAnim(evt.actor_id);
        break;
      case 'unit-fell':
        _markFallen(evt.unit_id);
        break;
      case 'turn-started':
        // Render is enough — the highlight comes from is-current class.
        break;
      case 'battle-ended':
        _showResult(evt);
        break;
      case 'card-burned':
        _animateBurnedCard(evt.card);
        _showHandFullBubble();
        break;
      case 'card-drawn':
        // In-turn draw → animate one more trailing card. Accumulates in the
        // hand UI's coalesced render. If 'all' is queued (end turn), it wins.
        if (_animateNextDeal !== 'all') {
          _animateNextDeal = (typeof _animateNextDeal === 'number' ? _animateNextDeal : 0) + 1;
        }
        break;
      case 'card-burned':
        _animateBurnedCard(evt.card);
        _showHandFullBubble();
        break;
      case 'card-played':
        _playCardSfx(evt.card);
        // Slight forward jerk when a character uses a card.
        if (evt.actor_id) _lungeAttacker(evt.actor_id);
        // Withering cards crumble into purple smoke as they leave the hand.
        if (_cardWithers(evt.card)) { _witherPoof(); _playWitherSfx(); }
        break;
      case 'enemy-move':
        // Enemy used a formula move — play its sound (if set) and jerk forward.
        if (evt.sfx) _playEnemySfx(evt.sfx);
        if (evt.actor_id) _lungeAttacker(evt.actor_id);
        break;
      case 'intent-set':
        // The current enemy telegraphed its next move — re-render shows it.
        break;
      default:
        break;
    }
    // Always re-render for simplicity. The DOM is small.
    _renderAll();
    _scheduleAITurnIfNeeded();
  }

  // A transient "Hand is full" bubble above the hand when cards burn.
  function _showHandFullBubble() {
    var cards = document.getElementById('cm-cards');
    if (!cards) return;
    var existing = document.getElementById('kw-handfull-bubble');
    if (existing) { existing._expiry = Date.now() + 1600; return; } // refresh timer
    var bubble = document.createElement('div');
    bubble.id = 'kw-handfull-bubble';
    bubble.className = 'kw-handfull-bubble';
    bubble.textContent = 'Hand is full — card burned';
    bubble._expiry = Date.now() + 1600;
    cards.appendChild(bubble);
    var tick = function () {
      if (!bubble.parentNode) return;
      if (Date.now() >= bubble._expiry) { bubble.classList.add('fade'); setTimeout(function () { if (bubble.parentNode) bubble.parentNode.removeChild(bubble); }, 300); }
      else setTimeout(tick, 200);
    };
    setTimeout(tick, 200);
  }

  // Play the generic card-click sound (when a card is selected/clicked).
  function _playClickSfx() {
    try {
      var a = new Audio('/assets/audio/cards/card_click.wav');
      a.volume = (window.getSfxVolume ? getSfxVolume() : 0.5);
      a.play().catch(function () {});
    } catch (e) {}
  }

  function _playCardSfx(cardKey) {
    var reg = window.CARD_REGISTRY;
    var card = reg && reg.getCard ? reg.getCard(cardKey) : null;
    if (!card || !card.sfx) return;
    try {
      var a = new Audio('/assets/audio/cards/' + card.sfx);
      a.volume = (window.getSfxVolume ? getSfxVolume() : 0.6);
      a.play().catch(function () {});
    } catch (e) {}
  }

  // True if a card key refers to a withering card (spent once per combat).
  function _cardWithers(cardKey) {
    var reg = window.CARD_REGISTRY;
    var card = reg && reg.getCard ? reg.getCard(cardKey) : null;
    return !!(card && card.wither);
  }

  // Purple smoke poof — the card has crumbled/withered. Spawned over the hand
  // area in the stable FX layer so it isn't wiped by re-renders.
  function _witherPoof() {
    var modal = document.getElementById('combat-modal');
    var cards = document.getElementById('cm-cards');
    if (!modal) return;
    // Use a modal-level overlay (not the stage FX layer) so the poof can appear
    // over the hand, which lives in the bottom band below the stage.
    var layer = document.getElementById('cm-modal-fx');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'cm-modal-fx';
      layer.className = 'cm-modal-fx';
      modal.appendChild(layer);
    }
    var cx, cy;
    if (cards) {
      var cb = cards.getBoundingClientRect();
      cx = cb.left + cb.width / 2;
      cy = cb.top + cb.height * 0.35;
    } else {
      var mb = modal.getBoundingClientRect();
      cx = mb.left + mb.width / 2; cy = mb.top + mb.height - 120;
    }
    var burst = document.createElement('div');
    burst.className = 'cm-wither-poof';
    burst.style.left = cx + 'px';
    burst.style.top = cy + 'px';
    var puffs = 8;
    for (var i = 0; i < puffs; i++) {
      var p = document.createElement('span');
      p.className = 'cm-wither-puff';
      var ang = (Math.PI * 2 * i) / puffs + Math.random() * 0.5;
      var dist = 30 + Math.random() * 34;
      p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist - 22).toFixed(1) + 'px');
      p.style.animationDelay = (Math.random() * 70) + 'ms';
      burst.appendChild(p);
    }
    layer.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 1000);
  }

  function _playWitherSfx() {
    try {
      var a = new Audio('/assets/audio/withered.wav');
      a.volume = (window.getSfxVolume ? getSfxVolume() : 0.6);
      a.play().catch(function () {});
    } catch (e) {}
  }

  function _playEnemySfx(file) {
    if (!file) return;
    try {
      var a = new Audio('/assets/audio/enemies/' + file);
      a.volume = (window.getSfxVolume ? getSfxVolume() : 0.6);
      a.play().catch(function () {});
    } catch (e) {}
  }

  // Hand-full burn: fly a ghost card from the Draw pile toward the hand, then
  // veer off to the Discard pile to show it's being burned.
  function _animateBurnedCard(cardKey) {
    var modal = document.getElementById('combat-modal');
    var drawBtn = document.querySelector('#combat-modal .kw-pile-btn');
    var discardBtns = document.querySelectorAll('#combat-modal .kw-pile-btn');
    if (!modal || !drawBtn || discardBtns.length < 2) return;
    var discardBtn = discardBtns[1];
    var dRect = drawBtn.getBoundingClientRect();
    var disRect = discardBtn.getBoundingClientRect();
    var mRect = modal.getBoundingClientRect();

    var ghost = document.createElement('div');
    ghost.className = 'kw-burn-ghost';
    ghost.textContent = '🂠';
    ghost.style.left = (dRect.left - mRect.left) + 'px';
    ghost.style.top = (dRect.top - mRect.top) + 'px';
    modal.appendChild(ghost);

    // mid-point: up toward the hand centre
    var midX = (mRect.width / 2) - 30;
    var midY = (dRect.top - mRect.top) - 90;
    requestAnimationFrame(function () {
      ghost.style.transition = 'transform .3s ease-out, opacity .3s';
      ghost.style.transform = 'translate(' + (midX - (dRect.left - mRect.left)) + 'px,' + (midY - (dRect.top - mRect.top)) + 'px) scale(1.1)';
      setTimeout(function () {
        // veer to discard
        ghost.style.transition = 'transform .32s ease-in, opacity .32s';
        ghost.style.transform = 'translate(' + ((disRect.left - mRect.left) - (dRect.left - mRect.left)) + 'px,' + ((disRect.top - mRect.top) - (dRect.top - mRect.top)) + 'px) scale(.5)';
        ghost.style.opacity = '0';
        setTimeout(function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 340);
      }, 320);
    });
    if (typeof showToastNotification === 'function') {
      try { showToastNotification('Hand is full — card burned to discard.', 'default'); } catch (e) {}
    }
  }

  function _flashDamage(unitId, amount, mitigated) {
    // Flash the info card AND the battlefield sprite; float the number above
    // the sprite (the focal point of the arena).
    const card = document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]');
    const sprite = document.querySelector('.cm-bf-sprite[data-sprite-id="' + unitId + '"]');
    [card, sprite].forEach((el) => {
      if (!el) return;
      el.classList.remove('is-hit'); void el.offsetWidth; // reflow to retrigger
      el.classList.add('is-hit');
      setTimeout(() => el.classList.remove('is-hit'), 500);
    });

    const host = sprite || card;
    const stage = document.querySelector('#combat-modal .cm-stage');
    if (host && stage) {
      let layer = document.getElementById('cm-fx-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'cm-fx-layer';
        layer.className = 'cm-fx-layer';
        stage.appendChild(layer);
      }
      const hb = host.getBoundingClientRect();
      const sb = stage.getBoundingClientRect();
      const popup = document.createElement('div');
      popup.className = 'cm-damage-pop';
      popup.textContent = '-' + amount + (mitigated ? ' (–' + mitigated + ')' : '');
      popup.style.left = (hb.left - sb.left + hb.width / 2) + 'px';
      // Sprites are tall boxes with the character art bottom-aligned, so the box
      // top sits well above the visible head. Anchor the number ~25% down from
      // the box top (just above where the character's head is) rather than at
      // the very top of the box.
      const headOffset = host.classList.contains('cm-bf-sprite') ? hb.height * 0.12 : 4;
      popup.style.top = (hb.top - sb.top + headOffset) + 'px';
      layer.appendChild(popup);
      setTimeout(() => popup.remove(), 1200);
    }
  }

  function _lungeAttacker(unitId) {
    [
      document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]'),
      document.querySelector('.cm-bf-sprite[data-sprite-id="' + unitId + '"]'),
    ].forEach((el) => {
      if (!el) return;
      el.classList.remove('is-lunge'); void el.offsetWidth;
      el.classList.add('is-lunge');
      setTimeout(() => el.classList.remove('is-lunge'), 350);
    });
  }

  function _markDefendingAnim(unitId) {
    const el = document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]');
    if (!el) return;
    el.classList.remove('is-brace'); void el.offsetWidth;
    el.classList.add('is-brace');
    setTimeout(() => el.classList.remove('is-brace'), 450);
  }

  function _markFallen(unitId) {
    [
      document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]'),
      document.querySelector('.cm-bf-sprite[data-sprite-id="' + unitId + '"]'),
    ].forEach((el) => {
      if (!el) return;
      el.classList.add('is-falling');
      setTimeout(() => el.classList.remove('is-falling'), 600);
    });
  }

  // ── AI scheduling ───────────────────────────────────────────────────────
  function _scheduleAITurnIfNeeded() {
    if (_aiTimer) { clearTimeout(_aiTimer); _aiTimer = null; }
    if (!_battle || _battle.status !== 'active') return;
    // Quest battles are server-stepped: when the server resolves a player
    // action it auto-walks AI turns until the next player turn, so the
    // client never needs to schedule one. Test battles (no quest) still
    // run AI locally.
    if (_battleQuestRunId) return;

    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur) return;
    if (cur.side !== 'enemy') return;

    _aiTimer = setTimeout(() => {
      // enemyAct runs the telegraphed move (or classic attack fallback),
      // handles drops, falls, end-check and turn advance in one call.
      Eng.enemyAct(_battle);
    }, 850);   // a beat so the player can read the log
  }

  // ── Player input handlers (called from inline onclick) ──────────────────
  function combatChooseAction(actionKey) {
    if (!_battle || _battle.status !== 'active') return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return;

    const action = Eng.getAction(actionKey);
    if (!action) return;
    if (cur.stamina < action.stamina_cost) return;

    // Toggle off if reselecting the same action.
    if (_selectedAction === actionKey) {
      _selectedAction = null;
      _renderAll();
      return;
    }

    _selectedAction = actionKey;
    _renderAll();
  }

  // Clicking a battlefield sprite behaves like clicking that unit's info card —
  // it selects the unit as a target for the pending card/action.
  function combatSpriteClick(unitId) {
    combatSelectTarget(unitId);
  }

  function combatSelectTarget(targetId) {
    if (!_battle || _battle.status !== 'active') return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return;

    // Card targeting path: a unit-targeting card is pending and a unit clicked.
    if (_pendingCard && _pendingCard.targetsUnits) {
      const handIndex = _pendingCard.handIndex;
      _pendingCard = null;
      _executeCardPlay(handIndex, targetId);
      return;
    }

    if (!_selectedAction) return;

    if (_battleQuestRunId) {
      // Server-authoritative path. POST and let the response drive the UI.
      const action = _selectedAction;
      _postQuestAction(action, targetId);
      _selectedAction = null;
      _renderAll();
      return;
    }

    // Test battle (Dev Tools): local engine, animations come from engine events.
    const ok = Eng.performAction(_battle, _selectedAction, targetId);
    if (ok) _selectedAction = null;
    _renderAll();
  }

  // ── Battle resolution screen ────────────────────────────────────────────
  // Renders the "X took a wound" block appended to the result screen.
  // Each event from the server has narrative + severity + body_part.
  // Death events get a distinct presentation (the citizen is gone — that
  // deserves visual weight).
  function _renderInjuriesBlock(injuries) {
    if (!injuries || !injuries.length) return '';
    const deathRows = injuries.filter(e => e.severity === 'fatal');
    const injuryRows = injuries.filter(e => e.severity !== 'fatal');

    let html = '<div class="cm-result-injuries">';

    if (deathRows.length) {
      html += '<div class="cm-result-injuries-title" style="color:#c79ee0">Lost To The Battle</div>';
      deathRows.forEach(e => {
        html += '<div class="cm-result-injury">'
          + '<span class="cm-result-injury-icon">🕯</span>'
          + '<span>' + _escapeHtml(e.narrative) + '</span>'
          + '</div>';
      });
    }
    if (injuryRows.length) {
      const title = deathRows.length ? 'And the wounded…' : 'Wounds Taken';
      html += '<div class="cm-result-injuries-title">' + title + '</div>';
      injuryRows.forEach(e => {
        const icon = _severityIconFor(e.severity);
        html += '<div class="cm-result-injury">'
          + '<span class="cm-result-injury-icon">' + icon + '</span>'
          + '<span>' + _escapeHtml(e.narrative) + '</span>'
          + '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function _severityIconFor(sev) {
    switch (sev) {
      case 'scratch':   return '🩹';
      case 'wound':     return '🩸';
      case 'scar':      return '⚔';
      case 'crippling': return '💢';
      case 'fatal':     return '🕯';
      default:          return '·';
    }
  }

  async function _showResult(endEvt) {
    const wrap = document.getElementById('cm-result');
    const title = document.getElementById('cm-result-title');
    const body = document.getElementById('cm-result-body');
    if (!wrap || !title || !body) return;

    const won = endEvt.outcome === 'victory';
    title.textContent = won ? '🎉 Victory!' : '— Defeat —';
    title.style.color = won ? '#e8c76a' : '#e07a6a';

    const survivors = _battle.units.filter(u => u.side === 'player' && !u.flags.downed);
    const fallen    = _battle.units.filter(u => u.side === 'player' && u.flags.downed);

    let bodyHtml = '';
    if (won) {
      const reward = endEvt.reward || {};
      bodyHtml += '<div class="cm-result-line">The party returns triumphant.</div>';
      if (reward.wealth) bodyHtml += '<div class="cm-result-reward">🪙 +' + reward.wealth + ' gold</div>';
      if (reward.drops && reward.drops.length) {
        bodyHtml += '<div class="cm-result-drops"><div class="cm-result-drops-title">Spoils</div>'
          + reward.drops.map(d => '<span class="cm-result-drop">📦 ' + _escapeHtml(d.item) + ' ×' + d.qty + '</span>').join('')
          + '</div>';
      }
      if (survivors.length) {
        bodyHtml += '<div class="cm-result-list">'
          + survivors.map(u => '<span class="cm-result-survivor">✓ ' + _escapeHtml(u.name) + '</span>').join('')
          + '</div>';
      }
      if (fallen.length) {
        bodyHtml += '<div class="cm-result-list cm-result-list-fallen">'
          + fallen.map(u => '<span class="cm-result-fallen">• ' + _escapeHtml(u.name) + ' fell, but is recovering.</span>').join('')
          + '</div>';
      }
      if (_battleQuestRunId) {
        bodyHtml += '<div class="cm-result-line cm-result-sub">The quest continues…</div>';
      }
    } else {
      bodyHtml += '<div class="cm-result-line">Your party retreats, weary but alive.</div>';
      bodyHtml += '<div class="cm-result-line cm-result-sub">No permanent injuries — but everyone needs rest.</div>';
      if (_battleQuestRunId) {
        bodyHtml += '<div class="cm-result-line cm-result-sub" style="color:#e07a6a">The quest is lost.</div>';
      }
    }

    body.innerHTML = bodyHtml;
    wrap.style.display = 'flex';

    // Persist outcome to the server. We post on BOTH outcomes when a quest is
    // attached (defeat fails the quest); for plain test battles we only post
    // on victory because defeat has nothing to record.
    const isQuestBattle = !!_battleQuestRunId;
    if (won || isQuestBattle) {
      try {
        const reward = endEvt.reward || {};
        const survivingIds = survivors.map(u => u.citizen_id).filter(Boolean);
        const res = await apiFetch('/api/combat/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome: won ? 'victory' : 'defeat',
            wealth_reward: won ? (reward.wealth || 0) : 0,
            citizen_ids:    survivingIds,
            quest_run_id:   _battleQuestRunId,
            log:            (_battle.log || []).slice(-50),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.wealth_after != null && gameData?.settlement?.resources) {
            gameData.settlement.resources.wealth = data.wealth_after;
            if (typeof tickResources !== 'undefined' && tickResources != null) {
              tickResources.wealth = data.wealth_after;
            }
            if (typeof updateTopbarDisplay === 'function') updateTopbarDisplay();
          }
          // Reload citizens so combat-skill bumps appear in their profile.
          if (typeof loadCitizens === 'function') {
            try { await loadCitizens(); } catch(e) {}
          }
          // Refresh the Battle list / badge so this fight drops off.
          if (typeof refreshBattleBadge === 'function') {
            try { refreshBattleBadge(); } catch(e) {}
          }
          // If the player has the quests modal open, reload its contents.
          if (typeof openNoticeboardModal === 'function' && document.getElementById('noticeboard-modal')?.style.display === 'flex') {
            try { await openNoticeboardModal(_questMode); } catch(e) {}
          }
          // Render any injuries from the aftermath onto the result screen.
          // We append rather than replace because the wealth/survivor blocks
          // are already rendered above.
          if (data.injuries && data.injuries.length) {
            const injHtml = _renderInjuriesBlock(data.injuries);
            if (injHtml) body.insertAdjacentHTML('beforeend', injHtml);
          }
        }
      } catch(e) { console.error('combat resolve failed', e); }
    }
  }

  // ── Public surface (also expose handlers used from inline onclicks) ─────
  global.startTestBattle  = startTestBattle;
  global.startBattle      = startBattle;
  global.startBattleFromQuest = startBattleFromQuest;
  global.closeCombat      = closeCombat;
  global.combatChooseAction = combatChooseAction;
  global.combatSelectTarget = combatSelectTarget;
  global.combatSpriteClick = combatSpriteClick;
  global.combatHoverIntent = combatHoverIntent;
  global.combatClearIntentHover = combatClearIntentHover;
  global.combatEndTurn = function () { _onCardEndTurn(); };
  global.combatMove = function (delta) { _onCardMove(delta); };
})(typeof window !== 'undefined' ? window : globalThis);
