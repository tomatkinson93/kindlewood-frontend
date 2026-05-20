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
  let _aiTimer = null;
  let _onUnsubscribe = null;
  // Set when a battle was launched from a quest run; resolution posts back
  // to /api/combat/resolve with this id so the server can update the quest.
  let _battleQuestRunId = null;

  // ── Scene presets — painterly CSS gradients only (no images yet) ────────
  const SCENES = {
    forest: {
      label: 'The Old Wood',
      bg: 'radial-gradient(ellipse at 50% 80%, rgba(60,40,30,.6), rgba(20,12,6,.95)),'
          + 'linear-gradient(180deg, #2c1f14 0%, #1a1410 55%, #0f0c08 100%)',
      accent: '#6c8a55',
    },
    marsh: {
      label: 'The Drowned Marsh',
      bg: 'radial-gradient(ellipse at 50% 75%, rgba(40,80,70,.55), rgba(8,16,18,.95)),'
          + 'linear-gradient(180deg, #1c2a2c 0%, #0f1c1f 55%, #060c0e 100%)',
      accent: '#5ec4b0',
    },
    ruins: {
      label: 'The Cracked Ruins',
      bg: 'radial-gradient(ellipse at 50% 80%, rgba(70,50,30,.55), rgba(20,14,8,.95)),'
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

  // ── Public: start a battle from a pending quest run ─────────────────────
  // Server-authoritative flow. Each player action POSTs to /api/combat/action
  // and the server returns the new canonical state. The local engine is used
  // only as a state holder for rendering; it does not run actions.
  async function startBattleFromQuest(questRunId) {
    const Eng = E();
    if (!Eng) { showToastNotification('Combat engine not loaded.', 'default'); return; }
    try { await Eng.loadEnemies(true); } catch(e) {}

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
  async function _postQuestAction(actionKey, targetId) {
    if (!_battleQuestRunId) return;
    const prevLogLen = (_battle && _battle.log) ? _battle.log.length : 0;
    try {
      const res = await apiFetch('/api/combat/action/' + _battleQuestRunId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_key: actionKey, target_id: targetId }),
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
  async function startBattle({ players, enemies, scene }) {
    const Eng = E();
    if (!Eng) return;

    _battle = Eng.createBattle({ players, enemies, scene });
    _selectedAction = null;

    _ensureModal();
    _showModal(scene);
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

  function closeCombat() {
    if (_aiTimer) { clearTimeout(_aiTimer); _aiTimer = null; }
    if (_onUnsubscribe) { _onUnsubscribe(); _onUnsubscribe = null; }
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
  function _ensureModal() {
    if (document.getElementById('combat-modal')) return;
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
            <div class="cm-side cm-side-player" id="cm-player-side"></div>
            <div class="cm-vs">⚔</div>
            <div class="cm-side cm-side-enemy" id="cm-enemy-side"></div>
          </div>
        </div>

        <div class="cm-initiative" id="cm-initiative">
          <div class="cm-initiative-label">Turn Order <span class="cm-initiative-hint">— ordered by Dexterity</span></div>
          <div class="cm-initiative-strip" id="cm-initiative-strip"></div>
        </div>

        <div class="cm-bottom">
          <div class="cm-actions" id="cm-actions"></div>
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
    scene.style.background = s.bg;
    scene.style.setProperty('--cm-accent', s.accent);
    title.textContent = s.label;
    result.style.display = 'none';
    modal.style.display = 'flex';
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function _renderAll() {
    if (!_battle) return;
    _renderSide('player');
    _renderSide('enemy');
    _renderInitiative();
    _renderActions();
    _renderLog();
    _renderRound();
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
    const units = _battle.units.filter(u => u.side === side);

    root.innerHTML = units.map(u => _unitCardHtml(u, cur)).join('');
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

    // Portrait — for citizens, a soft initial medallion; for enemies, the emoji icon.
    const portraitHtml = unit.archetype === 'citizen'
      ? `<div class="cm-portrait cm-portrait-citizen" data-role="${unit.role}">${_initial(unit.name)}</div>`
      : `<div class="cm-portrait cm-portrait-enemy">${unit.icon}</div>`;

    const skillLabel = unit.skill_label || 'Skill';
    const sub = unit.archetype === 'citizen'
      ? '<span class="cm-role">' + _capitalise(unit.role) + '</span>'
      : '<span class="cm-role cm-role-enemy">Enemy</span>';

    return `
      <div class="cm-unit${currentClass}${targetClass}${downedClass}${defendClass}" data-unit-id="${unit.id}" ${onClick}>
        <div class="cm-unit-header">
          ${portraitHtml}
          <div class="cm-unit-name-block">
            <div class="cm-unit-name">${unit.name}</div>
            ${sub}
          </div>
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
      </div>`;
  }

  function _initial(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }
  function _capitalise(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function _isTargetable(unit) {
    if (!_selectedAction) return false;
    if (unit.flags.downed) return false;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return false;
    const action = Eng.getAction(_selectedAction);
    if (!action) return false;
    if (action.target_type === 'enemy') return unit.side === 'enemy';
    if (action.target_type === 'self')  return unit.id === cur.id;
    return false;
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
      default:
        break;
    }
    // Always re-render for simplicity. The DOM is small.
    _renderAll();
    _scheduleAITurnIfNeeded();
  }

  function _flashDamage(unitId, amount, mitigated) {
    const el = document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]');
    if (!el) return;
    el.classList.remove('is-hit'); void el.offsetWidth; // reflow to retrigger
    el.classList.add('is-hit');
    setTimeout(() => el.classList.remove('is-hit'), 500);

    const popup = document.createElement('div');
    popup.className = 'cm-damage-pop';
    popup.textContent = '-' + amount + (mitigated ? ' (–' + mitigated + ')' : '');
    el.appendChild(popup);
    setTimeout(() => popup.remove(), 1200);
  }

  function _lungeAttacker(unitId) {
    const el = document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]');
    if (!el) return;
    el.classList.remove('is-lunge'); void el.offsetWidth;
    el.classList.add('is-lunge');
    setTimeout(() => el.classList.remove('is-lunge'), 350);
  }

  function _markDefendingAnim(unitId) {
    const el = document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]');
    if (!el) return;
    el.classList.remove('is-brace'); void el.offsetWidth;
    el.classList.add('is-brace');
    setTimeout(() => el.classList.remove('is-brace'), 450);
  }

  function _markFallen(unitId) {
    const el = document.querySelector('.cm-unit[data-unit-id="' + unitId + '"]');
    if (!el) return;
    el.classList.add('is-falling');
    setTimeout(() => el.classList.remove('is-falling'), 600);
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
      const choice = Eng.chooseAITargetAndAction(_battle, cur);
      if (!choice) return;
      Eng.performAction(_battle, choice.actionKey, choice.targetId);
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

  function combatSelectTarget(targetId) {
    if (!_battle || _battle.status !== 'active' || !_selectedAction) return;
    const Eng = E();
    const cur = Eng.currentUnit(_battle);
    if (!cur || cur.side !== 'player') return;

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
})(typeof window !== 'undefined' ? window : globalThis);
