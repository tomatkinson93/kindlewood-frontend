// ══════════════════════════════════════════════════════════════════════════
//  BATTLES — pending-combat list + nav badge
//
//  Polls /api/combat/pending periodically to discover quest battles awaiting
//  the player's attention. Click a battle row to engage it, which launches
//  the existing combat modal via startBattleFromQuest().
//
//  The nav-bar button (#nav-battles) shows a red dot when count > 0.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // SSE (realtime.js) pushes combat_pending/combat_resolved as they happen,
  // so the badge updates immediately under normal conditions. This poll is
  // a safety net for when the EventSource is disconnected (mobile sleep,
  // network drop) — 60s is plenty since the SSE path covers the urgent case.
  const POLL_MS = 60000;
  let _pollTimer = null;
  let _lastCount = 0;

  // ── Public: fetch pending battles and refresh the badge ─────────────────
  async function refreshBattleBadge() {
    if (typeof apiFetch !== 'function') return;
    try {
      const r = await apiFetch('/api/combat/pending');
      if (!r.ok) return;
      const d = await r.json();
      const count = (d && d.count) || 0;
      // If a new pending battle appeared since last poll, the quest's
      // combat_status just flipped to 'pending' server-side. The quests
      // module is now showing a stale countdown and progress bar. Refresh
      // its data so the UI reflects the pause immediately.
      if (count > _lastCount && typeof refreshActiveQuests === 'function') {
        try { await refreshActiveQuests(); } catch(e) {}
      }
      _setBadge(count);
      _lastCount = count;
      // If the modal is open, refresh its content too.
      const modal = document.getElementById('battles-modal');
      if (modal && modal.style.display === 'flex') {
        _renderList(d.battles || []);
      }
    } catch (e) { /* network blip — silent */ }
  }

  function _setBadge(count) {
    const btn = document.getElementById('nav-battles');
    if (!btn) return;
    let dot = btn.querySelector('.battle-badge');
    if (count > 0) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'battle-badge';
        btn.appendChild(dot);
      }
      dot.textContent = count > 9 ? '9+' : String(count);
      btn.classList.add('has-pending-battle');
    } else {
      if (dot) dot.remove();
      btn.classList.remove('has-pending-battle');
    }
  }

  // ── Public: open the battles modal ──────────────────────────────────────
  async function openBattlesModal() {
    _ensureModal();
    const modal = document.getElementById('battles-modal');
    modal.style.display = 'flex';
    document.getElementById('battles-list').innerHTML =
      '<div class="bm-loading">Checking the front lines…</div>';
    try {
      const r = await apiFetch('/api/combat/pending');
      const d = await r.json();
      _renderList((d && d.battles) || []);
      _setBadge((d && d.count) || 0);
    } catch (e) {
      document.getElementById('battles-list').innerHTML =
        '<div class="bm-loading" style="color:#e07a6a">⚠️ Could not load battles.</div>';
    }
  }

  function closeBattlesModal() {
    const modal = document.getElementById('battles-modal');
    if (modal) modal.style.display = 'none';
  }

  function _renderList(battles) {
    const list = document.getElementById('battles-list');
    if (!list) return;
    if (!battles.length) {
      list.innerHTML = '<div class="bm-empty">No battles awaiting. Send a party on a combat-prone quest to find some trouble.</div>';
      return;
    }
    list.innerHTML = battles.map(b => {
      const partyNames = (b.party_members && b.party_members.length)
        ? b.party_members.map(m => m.name).join(', ')
        : (b.citizen_name || 'A party');
      const enemies = (() => {
        let enc = b.combat_encounter || [];
        if (typeof enc === 'string') { try { enc = JSON.parse(enc); } catch(e){ enc = []; } }
        if (!enc.length) return 'an unknown foe';
        // Friendly-name the enemy keys: marsh_rat → Marsh Rat. Cheap title-case.
        return enc.map(k => k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(', ');
      })();
      const sinceMin = Math.max(0, Math.floor((Date.now() - new Date(b.combat_clock_paused_at || b.combat_trigger_at || Date.now()).getTime()) / 60000));
      const elapsed = sinceMin > 0 ? sinceMin + 'm ago' : 'just now';
      return `
        <div class="bm-row" data-runid="${b.id}">
          <div class="bm-icon">${b.quest_icon || '⚔'}</div>
          <div class="bm-info">
            <div class="bm-title">${_escape(b.quest_title || b.quest_id)}</div>
            <div class="bm-sub">
              <b>${_escape(partyNames)}</b> has encountered ${_escape(enemies)}
              <span class="bm-elapsed">· ${elapsed}</span>
            </div>
          </div>
          <button class="bm-engage" onclick="engageBattle(${b.id})">⚔ Engage</button>
          <button class="bm-cancel" onclick="forfeitBattle(${b.id})" title="Forfeit — the party loses and the quest fails.">✕</button>
        </div>`;
    }).join('');
  }

  function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function engageBattle(questRunId) {
    closeBattlesModal();
    if (typeof startBattleFromQuest !== 'function') {
      showToastNotification('⚠️ Combat module not loaded.', 'default');
      return;
    }
    startBattleFromQuest(questRunId);
  }

  // ── Battle report viewer ────────────────────────────────────────────────
  // Used by the "📜 View Battle" button on collected quest cards. Fetches
  // the persisted battle data — outcome, who fell, who got injured, what
  // they fought — and renders it in a static modal. This is the answer to
  // "auto-resolved battles complete silently with no UI."
  async function openBattleReport(questRunId) {
    _ensureReportModal();
    const modal = document.getElementById('battle-report-modal');
    modal.style.display = 'flex';
    document.getElementById('br-body').innerHTML =
      '<div class="bm-loading">Recalling the battle…</div>';
    try {
      const r = await apiFetch('/api/combat/report/' + questRunId);
      const data = await r.json();
      if (!r.ok) {
        document.getElementById('br-body').innerHTML =
          '<div class="bm-loading" style="color:#e07a6a">⚠️ ' + _escape(data.error || 'Could not load report.') + '</div>';
        return;
      }
      _renderReport(data);
    } catch (e) {
      document.getElementById('br-body').innerHTML =
        '<div class="bm-loading" style="color:#e07a6a">⚠️ Network error.</div>';
    }
  }
  function closeBattleReport() {
    const modal = document.getElementById('battle-report-modal');
    if (modal) modal.style.display = 'none';
  }

  function _ensureReportModal() {
    if (document.getElementById('battle-report-modal')) return;
    const root = document.createElement('div');
    root.id = 'battle-report-modal';
    root.className = 'bm-backdrop';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="bm-card br-card">
        <div class="bm-header">
          <div class="bm-header-info">
            <div class="bm-header-title" id="br-title">Battle Report</div>
            <div class="bm-header-sub" id="br-sub">—</div>
          </div>
          <button class="bm-close" onclick="closeBattleReport()">✕</button>
        </div>
        <div id="br-body" class="br-body"></div>
      </div>
    `;
    root.addEventListener('click', e => { if (e.target === root) closeBattleReport(); });
    document.body.appendChild(root);
  }

  function _renderReport(data) {
    const titleEl = document.getElementById('br-title');
    const subEl   = document.getElementById('br-sub');
    const body    = document.getElementById('br-body');
    const won = data.outcome === 'victory';

    titleEl.textContent = (data.quest_icon || '⚔') + ' ' + (won ? 'Victory!' : 'Defeat');
    titleEl.style.color = won ? '#e8c76a' : '#e07a6a';
    subEl.textContent = (data.quest_title || '') + ' · ' + _formatDate(data.resolved_at);

    const enemies = (data.encounter || []).map(_titleCase).join(', ') || 'an unknown foe';

    // Party stats from the final battle state (HP at end of fight)
    const battleUnits = (data.battle_state && data.battle_state.units) || [];
    const partyEnd = battleUnits.filter(u => u.side === 'player');
    const fallenNames = partyEnd.filter(u => u.flags && u.flags.downed).map(u => u.name);
    const survivorNames = partyEnd.filter(u => !(u.flags && u.flags.downed)).map(u => u.name);

    let html = '';

    // ── Encounter summary ──
    html += '<div class="br-section">';
    html += '<div class="br-section-label">The Foe</div>';
    html += '<div class="br-foe">⚔ ' + _escape(enemies) + '</div>';
    html += '</div>';

    // ── Party outcome ──
    html += '<div class="br-section">';
    html += '<div class="br-section-label">The Party</div>';
    if (survivorNames.length) {
      html += '<div class="br-party-row">'
        + survivorNames.map(n => '<span class="br-survivor">✓ ' + _escape(n) + '</span>').join('')
        + '</div>';
    }
    if (fallenNames.length) {
      html += '<div class="br-party-row">'
        + fallenNames.map(n => '<span class="br-fallen">• ' + _escape(n) + ' fell</span>').join('')
        + '</div>';
    }
    html += '</div>';

    // ── Reward ──
    if (won && data.reward_wealth > 0) {
      html += '<div class="br-section">';
      html += '<div class="br-section-label">Reward</div>';
      html += '<div class="br-reward">🪙 +' + data.reward_wealth + ' gold</div>';
      html += '</div>';
    }

    // ── Injuries (with deaths separated) ──
    const injuries = data.injury_events || [];
    if (injuries.length) {
      const deaths = injuries.filter(e => e.severity === 'fatal');
      const others = injuries.filter(e => e.severity !== 'fatal');
      if (deaths.length) {
        html += '<div class="br-section">';
        html += '<div class="br-section-label" style="color:#c79ee0">Lost To The Battle</div>';
        deaths.forEach(e => {
          html += '<div class="br-injury br-injury-fatal">🕯 ' + _escape(e.narrative) + '</div>';
        });
        html += '</div>';
      }
      if (others.length) {
        html += '<div class="br-section">';
        html += '<div class="br-section-label">Wounds Taken</div>';
        others.forEach(e => {
          const icon = _severityIcon(e.severity);
          html += '<div class="br-injury">' + icon + ' ' + _escape(e.narrative) + '</div>';
        });
        html += '</div>';
      }
    }

    // ── Combat log (collapsed by default — usually verbose) ──
    if (data.log && data.log.length) {
      html += '<details class="br-section br-log-details">';
      html += '<summary class="br-section-label">Combat Log (' + data.log.length + ' lines)</summary>';
      html += '<div class="br-log">';
      data.log.forEach(line => {
        html += '<div class="br-log-line">' + _escape(line) + '</div>';
      });
      html += '</div></details>';
    }

    body.innerHTML = html;
  }

  function _severityIcon(sev) {
    switch (sev) {
      case 'scratch':   return '🩹';
      case 'wound':     return '🩸';
      case 'scar':      return '⚔';
      case 'crippling': return '💢';
      case 'fatal':     return '🕯';
      default:          return '·';
    }
  }
  function _titleCase(s) {
    return String(s || '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  function _formatDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch(e) { return iso; }
  }

  // Forfeit — used to unstick battles or surrender hopeless ones. The server
  // marks the quest failed and clears the combat lock. No reward, no skill
  // bump. Different from /resolve because there's no battle state to verify.
  async function forfeitBattle(questRunId) {
    if (!confirm('Forfeit this battle? The party will be defeated and the quest will fail.')) return;
    try {
      const r = await apiFetch('/api/combat/forfeit/' + questRunId, { method: 'POST' });
      if (r.ok) {
        refreshBattleBadge();
        // Refresh quest list if it's open
        if (typeof refreshActiveQuests === 'function') {
          try { await refreshActiveQuests(); } catch(e) {}
        }
        showToastNotification('Battle forfeited. The party retreats.', 'default');
      } else {
        const d = await r.json();
        showToastNotification('⚠️ ' + (d.error || 'Could not forfeit'), 'default');
      }
    } catch (e) {
      showToastNotification('⚠️ Network error.', 'default');
    }
  }

  function _ensureModal() {
    if (document.getElementById('battles-modal')) return;
    const root = document.createElement('div');
    root.id = 'battles-modal';
    root.className = 'bm-backdrop';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="bm-card">
        <div class="bm-header">
          <div class="bm-header-info">
            <div class="bm-header-title">⚔ Pending Battles</div>
            <div class="bm-header-sub">Quests on hold awaiting your command.</div>
          </div>
          <button class="bm-close" onclick="closeBattlesModal()">✕</button>
        </div>
        <div id="battles-list" class="bm-list"></div>
      </div>
    `;
    root.addEventListener('click', e => { if (e.target === root) closeBattlesModal(); });
    document.body.appendChild(root);
  }

  // ── Polling lifecycle ────────────────────────────────────────────────────
  function startBattlePolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(refreshBattleBadge, POLL_MS);
    refreshBattleBadge(); // immediate first call
  }
  function stopBattlePolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // Auto-start polling when the page is ready and the user is logged in. We
  // assume an existing global signals login — fall back to a small delay
  // after DOMContentLoaded.
  function _autoStart() {
    setTimeout(() => {
      if (typeof apiFetch === 'function') startBattlePolling();
    }, 1500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoStart);
  } else {
    _autoStart();
  }

  // Expose
  global.refreshBattleBadge = refreshBattleBadge;
  global.openBattlesModal   = openBattlesModal;
  global.closeBattlesModal  = closeBattlesModal;
  global.engageBattle       = engageBattle;
  global.forfeitBattle      = forfeitBattle;
  global.openBattleReport   = openBattleReport;
  global.closeBattleReport  = closeBattleReport;
  global.startBattlePolling = startBattlePolling;
  global.stopBattlePolling  = stopBattlePolling;

})(typeof window !== 'undefined' ? window : globalThis);
