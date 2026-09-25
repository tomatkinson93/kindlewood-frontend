// ══════════════════════════════════════════════════════════════════════════
//  CLAN QUESTS — the Clan panel's Quests tab
//
//  Board from GET /api/clan-quests: parties gathering (open roles to take),
//  quests underway (live countdowns), the board of solo + party quests, and
//  recent results. Solo = send one of your citizens; party = post it and
//  take a role, or take an open role in someone's party (one citizen per
//  member per party). Everyone who takes part gets the rewards; failing
//  costs nothing.
//
//  clans.js renders html() for the tab and forwards clicks on [data-cq];
//  the citizen picker uses the panel's action sheet (ClanUI.sheet).
//  Realtime: clan_quest_updated (clan channel) → load();
//  clan_quest_resolved (your settlement) → onResolved().
//
//  Depends on: apiFetch, escHtml, ClanUI (clans.js), QUEST_SKILL_LABELS
//  (quests.js, optional), showBuildToast (optional).
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const esc = s => (typeof global.escHtml === 'function' ? global.escHtml(s) : String(s ?? ''));
  const RES_ICON = { food: '🌾', timber: '🪵', stone: '🪨', metal: '⛓️', wealth: '🪙' };
  const st = { data: null, loading: false, loadedAt: 0, pick: null, timer: null };

  function toast(m, t) { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); }
  async function call(method, path, body) {
    const res = await global.apiFetch(path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let d = {}; try { d = await res.json(); } catch (_) {}
    if (!res.ok) { const e = new Error(d.error || 'Something went wrong.'); e.data = d; throw e; }
    return d;
  }
  const skillLabel = k => (typeof QUEST_SKILL_LABELS !== 'undefined' && QUEST_SKILL_LABELS[k]) || (k ? k[0].toUpperCase() + k.slice(1) : 'Any');
  const chance = (base, skill) => Math.min(0.95, base + ((Number(skill) || 1) - 1) * 0.04);
  const pct = x => `${Math.round(x * 100)}%`;
  function dur(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}h${m ? ` ${m}m` : ''}`;
  }
  const rewardsText = r => Object.entries(r || {}).map(([k, v]) => `${RES_ICON[k] || ''} +${v} ${k === 'wealth' ? 'gold' : k}`).join(' · ');
  const me = () => (st.data ? st.data.me.user_id : null);
  // Server clock offset so countdowns don't drift with a wrong device clock.
  let _skew = 0;
  const now = () => Date.now() + _skew;

  // ── Data ────────────────────────────────────────────────────────────────
  async function load() {
    if (st.loading) return;
    st.loading = true;
    try {
      const d = await call('GET', '/api/clan-quests');
      _skew = new Date(d.server_now).getTime() - Date.now();
      st.data = d;
      st.loadedAt = Date.now();
    } catch (e) {
      st.data = st.data || { error: e.message };
    } finally {
      st.loading = false;
    }
    if (global.ClanUI && global.ClanUI.renderTab) global.ClanUI.renderTab('quests');
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function html() {
    const d = st.data;
    if (!d) { if (!st.loading) load(); return '<div class="clan-empty">Reading the quest board…</div>'; }
    if (d.error) return `<div class="clan-empty">${esc(d.error)}</div>`;
    const forming = d.runs.filter(r => r.status === 'forming');
    const active = d.runs.filter(r => r.status === 'active');
    const solo = d.board.filter(q => q.kind === 'solo'), party = d.board.filter(q => q.kind === 'party');
    let out = `<p class="clan-muted cq-intro">Send citizens out for the clan. Everyone who takes part gets the rewards and earns the clan prestige — failing costs nothing.</p>
      <div class="cq-rotation">📜 Today's board · new quests in <b data-cq-until="${esc(d.rotates_at)}" data-cq-done="a moment">${dur((new Date(d.rotates_at) - now()) / 1000)}</b></div>`;
    if (forming.length) out += `<section class="clan-sec"><h3>📯 Parties gathering</h3>${forming.map(formingCard).join('')}</section>`;
    if (active.length) out += `<section class="clan-sec"><h3>🚶 Underway</h3>${active.map(activeCard).join('')}</section>`;
    out += `<section class="clan-sec"><h3>Solo quests <span class="clan-muted cq-h-note">once a day each</span></h3>
      ${solo.length ? `<div class="cq-grid">${solo.map(boardCard).join('')}</div>` : '<div class="clan-muted">No solo quests on the board today.</div>'}</section>`;
    out += `<section class="clan-sec"><h3>Party quests <span class="clan-muted cq-h-note">one citizen per member</span></h3>
      ${party.length ? `<div class="cq-grid">${party.map(boardCard).join('')}</div>`
        : `<div class="clan-muted">${d.level < d.party_unlock_level ? `Party quests open at clan level ${d.party_unlock_level}.` : 'No party quests on the board today.'}</div>`}</section>`;
    if (d.locked && d.locked.length) {
      out += `<div class="cq-locked"><span class="clan-muted">Unlocking later:</span> ${d.locked.map(l =>
        `<span class="cq-locked-item">${esc(l.icon)} ${esc(l.title)} <span class="clan-muted">· L${l.unlock_level}</span></span>`).join('')}</div>`;
    }
    if (d.recent.length) out += `<section class="clan-sec"><h3>Recent</h3><ul class="cq-recent">${d.recent.map(recentLine).join('')}</ul></section>`;
    return out;
  }

  function boardCard(q) {
    const locked = q.state === 'locked';
    const skill = q.kind === 'solo'
      ? `<span class="cq-chip">${esc(skillLabel(q.skill_key))}</span>`
      : q.roles.map(r => `<span class="cq-chip">${esc(r.label)} · ${esc(skillLabel(r.skill_key))}</span>`).join('');
    let foot;
    switch (q.state) {
      case 'locked': foot = `<span class="cq-state lock">🔒 Clan level ${q.unlock_level}</span>`; break;
      case 'done_today': foot = '<span class="cq-state done">✓ Done today — back tomorrow</span>'; break;
      case 'active': foot = '<span class="cq-state run">🚶 Underway</span>'; break;
      case 'forming': foot = '<span class="cq-state run">📯 Party gathering — see above</span>'; break;
      default:
        foot = q.kind === 'solo'
          ? `<button type="button" class="clan-btn small" data-cq="solo" data-key="${esc(q.key)}">Send a citizen</button>`
          : (st.data.me.rank === 'recruit'
              ? '<span class="clan-muted">Members and up can gather a party.</span>'
              : `<button type="button" class="clan-btn small" data-cq="post" data-key="${esc(q.key)}">Gather a party</button>`);
    }
    return `<article class="cq-card${locked ? ' locked' : ''}">
      <div class="cq-card-head"><span class="cq-ic">${esc(q.icon)}</span>
        <div><div class="cq-title">${esc(q.title)}</div>
          <div class="clan-muted small">${dur(q.duration_s)} · ${pct(q.base_success)} base · ✦ ${q.prestige} prestige${q.kind === 'party' ? ' each' : ''}</div></div></div>
      <p class="cq-desc">${esc(q.description)}</p>
      <div class="cq-chips">${skill}${q.combat_chance > 0 ? `<span class="cq-chip danger" title="The party may be ambushed on the way. Clan battles resolve themselves and never injure — a defeat just ends the quest.">⚔️ ${q.combat_chance}% chance of a fight</span>` : ''}</div>
      <div class="cq-rewards">${esc(rewardsText(q.rewards))}${q.kind === 'party' ? ' <span class="clan-muted">each</span>' : ''}</div>
      <div class="cq-foot">${foot}</div>
    </article>`;
  }

  function roleRow(run, i, role) {
    const s = run.slots.find(x => x.role_index === i);
    if (s) {
      const mine = s.user_id === me();
      return `<li class="cq-role filled${mine ? ' mine' : ''}">
        <span class="cq-role-name">${esc(role.label)}</span>
        <span class="cq-role-who">${esc(s.citizen_name)} <span class="clan-muted">of ${esc(s.username)}${mine ? ' (you)' : ''} · ${esc(skillLabel(role.skill_key))} ${s.skill}</span></span>
      </li>`;
    }
    const inIt = run.slots.some(x => x.user_id === me());
    return `<li class="cq-role open">
      <span class="cq-role-name">${esc(role.label)}</span>
      <span class="cq-role-who clan-muted">${esc(role.desc || '')} · ${esc(skillLabel(role.skill_key))}</span>
      ${inIt || run.status !== 'forming' ? '' : `<button type="button" class="clan-btn small" data-cq="join" data-run="${run.id}" data-role="${i}">Take role</button>`}
    </li>`;
  }

  function formingCard(run) {
    const q = run.quest, roles = q.roles || [];
    const inIt = run.slots.some(x => x.user_id === me());
    const canCancel = run.created_by === me() || st.data.me.moderate;
    return `<article class="cq-run forming">
      <div class="cq-card-head"><span class="cq-ic">${esc(q.icon)}</span>
        <div><div class="cq-title">${esc(q.title)}</div>
          <div class="clan-muted small">${run.slots.length}/${roles.length} roles · posted by ${esc(run.created_by_name || 'someone')} · lapses in <span data-cq-until="${esc(run.expires_at)}">${dur((new Date(run.expires_at) - now()) / 1000)}</span></div></div></div>
      <ul class="cq-roles">${roles.map((r, i) => roleRow(run, i, r)).join('')}</ul>
      <div class="cq-foot">
        <span class="cq-rewards">${esc(rewardsText(q.rewards))} <span class="clan-muted">each · ✦ ${q.prestige}</span></span>
        ${inIt ? `<button type="button" class="clan-btn small ghost" data-cq="leave" data-run="${run.id}">Leave</button>` : ''}
        ${canCancel ? `<button type="button" class="clan-btn small danger" data-cq="cancel" data-run="${run.id}">Call off</button>` : ''}
      </div>
    </article>`;
  }

  function activeCard(run) {
    const q = run.quest;
    const start = new Date(run.started_at).getTime(), end = new Date(run.completes_at).getTime();
    const p = Math.max(2, Math.min(100, Math.round(100 * (now() - start) / Math.max(1, end - start))));
    const who = run.slots.map(s => `${esc(s.citizen_name)} <span class="clan-muted">(${esc(s.username)})</span>`).join(', ');
    return `<article class="cq-run active">
      <div class="cq-card-head"><span class="cq-ic">${esc(q.icon)}</span>
        <div><div class="cq-title">${esc(q.title)}</div>
          <div class="small">${who}</div></div>
        <span class="cq-eta" data-cq-until="${esc(run.completes_at)}" data-cq-done="Returning…">${dur((end - now()) / 1000)}</span></div>
      <div class="clan-bar"><span data-cq-bar data-start="${start}" data-end="${end}" style="width:${p}%"></span></div>
      ${battleHtml(run)}
    </article>`;
  }

  function recentLine(run) {
    const q = run.quest, ok = run.status === 'completed';
    const who = run.slots.map(s => esc(s.username)).join(', ');
    const lost = run.combat && run.combat.outcome === 'defeat';
    const tail = run.status === 'expired' ? 'lapsed before the party filled'
      : ok ? `${esc(rewardsText(q.rewards))}${run.kind === 'party' ? ' each' : ''}`
      : lost ? `driven back by ${esc(run.combat.foes)}` : 'came home empty-handed';
    const fought = run.combat && run.combat.outcome === 'victory' ? ` <span class="cq-won">⚔️ beat ${esc(run.combat.foes)}</span>` : '';
    return `<li class="cq-recent-${run.status}"><span class="cq-ic sm">${ok ? '✓' : run.status === 'expired' ? '⌛' : lost ? '⚔️' : '✗'}</span>
      <span><b>${esc(q.title)}</b> <span class="clan-muted">— ${who || 'no one'} · ${tail}</span>${fought}${run.combat ? battleLog(run) : ''}</span></li>`;
  }

  // "Fought off …" line + collapsible log for a run whose encounter happened.
  function battleHtml(run) {
    if (!run.combat) return '';
    const won = run.combat.outcome === 'victory';
    return `<div class="cq-battle ${won ? 'won' : 'lost'}">⚔️ ${won ? `Fought off ${esc(run.combat.foes)} — pressing on` : `Driven back by ${esc(run.combat.foes)}`}${battleLog(run)}</div>`;
  }
  function battleLog(run) {
    const log = (run.combat && run.combat.log) || [];
    if (!log.length) return '';
    return `<details class="cq-log"><summary>Battle log</summary><ol>${log.map(l => `<li>${esc(typeof l === 'string' ? l : (l.text || l.msg || JSON.stringify(l)))}</li>`).join('')}</ol></details>`;
  }

  // ── Countdowns ──────────────────────────────────────────────────────────
  function startTimer() {
    if (st.timer) return;
    st.timer = setInterval(() => {
      const nodes = document.querySelectorAll('#clan-panel [data-cq-until]');
      if (!nodes.length) { clearInterval(st.timer); st.timer = null; return; }
      let due = false;
      nodes.forEach(n => {
        const left = (new Date(n.dataset.cqUntil).getTime() - now()) / 1000;
        n.textContent = left > 0 ? dur(left) : (n.dataset.cqDone || 'any moment');
        if (left <= 0) due = true;
      });
      document.querySelectorAll('#clan-panel [data-cq-bar]').forEach(b => {
        const s = +b.dataset.start, e = +b.dataset.end;
        b.style.width = Math.max(2, Math.min(100, Math.round(100 * (now() - s) / Math.max(1, e - s)))) + '%';
      });
      // Something finished: the board's GET resolves it.
      if (due && Date.now() - st.loadedAt > 4000) load();
    }, 1000);
  }
  function afterRender() { if (document.querySelector('#clan-panel [data-cq-until]')) startTimer(); }

  // ── Citizen picker (action sheet) ───────────────────────────────────────
  async function pickCitizen(opts) {
    // opts: { title, skillOf(roleIndex) , base, roles?, roleIndex, onPick(citizenId, roleIndex) }
    st.pick = { ...opts, citizens: null };
    renderPicker();
    try {
      const d = await call('GET', '/api/citizens');
      st.pick.citizens = (d.citizens || []).filter(c => c.life_stage !== 'child');
    } catch (e) { st.pick.citizens = []; }
    renderPicker();
  }

  function renderPicker() {
    const p = st.pick;
    if (!p || !global.ClanUI) return;
    const roleKey = p.roles ? p.roles[p.roleIndex].skill_key : p.skillKey;
    let body;
    if (!p.citizens) body = '<div class="clan-empty">Calling the townsfolk…</div>';
    else {
      const list = p.citizens.slice().sort((a, b) => (b.skills?.[roleKey] ?? 0) - (a.skills?.[roleKey] ?? 0));
      body = list.length ? `<ul class="cq-pick">${list.map(c => {
        const busy = c.expedition ? 'Scouting' : c.active_quest ? (c.active_quest.clan ? 'On a clan quest' : 'On a quest') : '';
        const sk = c.skills?.[roleKey] ?? 1;
        return `<li><button type="button" class="cq-pick-btn" data-cq="pick" data-cid="${c.id}"${busy ? ' disabled' : ''}>
          <span class="cq-pick-name">${esc(c.name)}</span>
          <span class="clan-muted small">${busy ? esc(busy) : `${esc(skillLabel(roleKey))} ${sk}`}</span>
          ${busy ? '' : `<span class="cq-pick-chance">${pct(chance(p.base, sk))}</span>`}
        </button></li>`;
      }).join('')}</ul>` : '<div class="clan-empty">No grown citizens to send.</div>';
    }
    const roles = p.roles && p.chooseRole ? `<div class="cq-role-pick">${p.roles.map((r, i) =>
      `<button type="button" class="clan-seg-btn${i === p.roleIndex ? ' on' : ''}" data-cq="role" data-role="${i}">${esc(r.label)}</button>`).join('')}</div>` : '';
    // Update in place when the sheet is already up (role switch, list
    // loaded) so it doesn't replay its slide-in.
    const open = document.querySelector('#clan-sheet-wrap.open .clan-sheet');
    const put = h => (open ? (open.innerHTML = h) : global.ClanUI.sheet(h));
    put(`
      <div class="clan-sheet-title">${esc(p.title)}</div>
      <p class="clan-sheet-msg">${p.roles ? `As <b>${esc(p.roles[p.roleIndex].label)}</b> — ${esc(skillLabel(roleKey))} counts. ` : `${esc(skillLabel(roleKey))} counts. `}Chance shown is ${p.roles ? 'this role\'s part of the party\'s' : 'the'} odds.</p>
      ${roles}${body}
      <button type="button" class="clan-btn ghost block" data-act="sheet-close">Cancel</button>`);
  }

  // ── Actions (clans.js forwards clicks on [data-cq]) ────────────────────
  let _busy = false;
  async function act(fn, ok) {
    if (_busy) return;
    _busy = true;
    try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); }
    catch (e) { toast(e.message, 'error'); }
    finally { _busy = false; }
    if (global.ClanUI) global.ClanUI.closeSheet();
    await load();
  }

  function onClick(t) {
    const d = st.data;
    const qdef = key => d.board.find(q => q.key === key);
    switch (t.dataset.cq) {
      case 'solo': {
        const q = qdef(t.dataset.key);
        pickCitizen({ title: `${q.icon} ${q.title}`, skillKey: q.skill_key, base: q.base_success,
          onPick: cid => act(() => call('POST', '/api/clan-quests/solo', { quest_key: q.key, citizen_id: cid }),
            r => `${r.citizen_name} set out for the clan.`) });
        break;
      }
      case 'post': {
        const q = qdef(t.dataset.key);
        pickCitizen({ title: `${q.icon} Gather a party: ${q.title}`, roles: q.roles, roleIndex: 0, chooseRole: true, base: q.base_success,
          onPick: (cid, ri) => act(() => call('POST', '/api/clan-quests/party', { quest_key: q.key, role_index: ri, citizen_id: cid }),
            r => (r.started ? 'The party set out!' : 'Party posted — clanmates can take the open roles.')) });
        break;
      }
      case 'join': {
        const run = d.runs.find(r => r.id === +t.dataset.run);
        const ri = +t.dataset.role;
        pickCitizen({ title: `${run.quest.icon} ${run.quest.title}`, roles: run.quest.roles, roleIndex: ri, base: run.quest.base_success,
          onPick: cid => act(() => call('POST', `/api/clan-quests/runs/${run.id}/join`, { role_index: ri, citizen_id: cid }),
            r => (r.started ? 'Every role is filled — the party set out!' : 'You joined the party.')) });
        break;
      }
      case 'role': st.pick.roleIndex = +t.dataset.role; renderPicker(); break;
      case 'pick': if (st.pick) st.pick.onPick(+t.dataset.cid, st.pick.roleIndex); break;
      case 'leave': act(() => call('POST', `/api/clan-quests/runs/${t.dataset.run}/leave`), 'You left the party.'); break;
      case 'cancel': {
        const run = d.runs.find(r => r.id === +t.dataset.run);
        global.ClanUI.confirm('Call off the party', `Call off "${run.quest.title}"? Everyone's citizens come home; nothing is lost.`, 'Call it off',
          () => act(() => call('POST', `/api/clan-quests/runs/${run.id}/cancel`), 'Party called off.'));
        break;
      }
    }
  }

  // ── Realtime ────────────────────────────────────────────────────────────
  function onUpdated() { if (st.data) load(); }
  function onBattle(ev) {
    toast(`⚔️ Your clan party on "${ev.title}" fought off ${ev.foes} and presses on!`);
    if (st.data) load();
  }
  function onResolved(ev) {
    if (ev.battle === 'defeat') {
      toast(`⚔️ "${ev.title}": driven back by ${ev.foes}. Everyone made it home.`, 'error');
      if (typeof global.loadCitizens === 'function') global.loadCitizens();
      if (st.data) load();
      return;
    }
    const ok = ev.outcome === 'completed';
    toast(ok ? `🎉 Clan quest "${ev.title}" complete! ${rewardsText(ev.rewards)}` : `Clan quest "${ev.title}" failed — everyone is home safe.`, ok ? 'success' : 'error');
    if (typeof global.refreshResources === 'function') global.refreshResources();
    if (typeof global.loadCitizens === 'function') global.loadCitizens();
    if (st.data) load();
  }

  // Dev Tools
  async function cheatFinish() {
    const fb = document.getElementById('cheat-clan-quests-feedback');
    try {
      const d = await call('POST', '/api/clan-quests/cheat/finish');
      if (fb) fb.textContent = d.finished ? `✓ Finished ${d.finished} clan quest${d.finished === 1 ? '' : 's'}.` : 'Nothing of yours is underway.';
      if (st.data) load();
    } catch (e) { if (fb) fb.textContent = '⚠ ' + e.message; }
  }

  global.ClanQuests = { html, load, onClick, afterRender, onUpdated, onResolved, onBattle, reset: () => { st.data = null; } };
  global.cheatFinishClanQuests = cheatFinish;
})(typeof window !== 'undefined' ? window : globalThis);
