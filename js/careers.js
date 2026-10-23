// ══════════════════════════════════════════════════════════════════════════
//  CAREERS — the Career tab, skill trees, the fork, discoveries.
//
//  Server: /api/careers (kindlewood-server lib/careers). Shared numbers come
//  from js/career-math.js (byte-identical to the server's); trees are drawn
//  by js/career-tree.js. js/citizens.js asks this module for the job list,
//  the profile badge, hidden traits and the Career tab.
//
//  Realtime (js/realtime.js → KWCareers.onEvent): career_level_up,
//  career_fork, trait_hint, trait_revealed, career_milestone, career_find.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const M = () => global.KWCareerMath;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };
  const byId = id => document.getElementById(id);
  const STAT = { strength: 'Strength', agility: 'Agility', endurance: 'Endurance', intelligence: 'Intelligence', charisma: 'Charisma' };
  const SKILL = { farming: 'Farming', woodcutting: 'Woodcutting', fishing: 'Fishing', mining: 'Mining', crafting: 'Crafting', scouting: 'Scouting', combat: 'Combat' };
  const NAMES = { ...STAT, ...SKILL, winter: 'winter', spring: 'spring', summer: 'summer', autumn: 'autumn', fish: 'fish', fish_rare: 'rare fish', fish_legendary: 'legendary fish' };

  let _defs = null, _defsP = null;
  async function call(method, path, body) {
    const res = await global.apiFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  function loadDefs() {
    if (_defs) return Promise.resolve(_defs);
    if (!_defsP) _defsP = call('GET', '/api/careers/defs').then(d => (_defs = d)).catch(e => { _defsP = null; throw e; });
    return _defsP;
  }
  const defs = () => _defs;
  const classOf = k => (_defs && _defs.classes[k]) || null;
  const seasonId = () => {
    try { const s = typeof global.calcCurrentSeason === 'function' ? global.calcCurrentSeason() : null; return (s && s.id) || 'summer'; }
    catch (_) { return 'summer'; }
  };
  const isAdmin = () => typeof global._kwIsAdmin === 'function' && global._kwIsAdmin();
  // gameData / citizensData are top-level `let`s in main.js / citizens.js (not on window).
  const gd = () => (typeof gameData !== 'undefined' && gameData) || global.gameData || null;
  const buildingTypes = () => ((gd() && gd().buildings) || [])
    .filter(b => (b.level || b.currentLevel || 0) > 0).map(b => b.type);

  // ── Bits citizens.js uses ────────────────────────────────────────────────

  function roleLabel(role) {
    const c = classOf(role);
    return c ? c.label : role === 'idle' ? 'Idle' : role.charAt(0).toUpperCase() + role.slice(1);
  }
  function roleIcon(role) { const c = classOf(role); return c ? c.icon : role === 'idle' ? '💤' : '•'; }

  // <option>s for the job picker: level in each job, and jobs whose
  // building is missing say so (and can't be picked).
  function roleOptionsHtml(c) {
    if (!_defs) return null;
    const have = buildingTypes();
    const lv = c.class_levels || {};
    const keys = Object.keys(_defs.classes).filter(k => _defs.classes[k].assignable);
    const opts = keys.map(k => {
      const cls = _defs.classes[k];
      const ok = !cls.needs || cls.needs.some(t => have.includes(t));
      const level = lv[k] ? ` · Lv ${lv[k]}` : '';
      return `<option value="${k}" ${c.role === k ? 'selected' : ''} ${ok || c.role === k ? '' : 'disabled'}>${cls.icon} ${esc(cls.label)}${level}${ok ? '' : ' · needs a ' + esc(cls.needs_labels.join(' or '))}</option>`;
    });
    opts.push(`<option value="idle" ${c.role === 'idle' ? 'selected' : ''}>💤 Idle</option>`);
    if (!keys.includes(c.role) && c.role !== 'idle') opts.unshift(`<option value="${esc(c.role)}" selected disabled>${roleIcon(c.role)} ${esc(roleLabel(c.role))}</option>`);
    return opts.join('');
  }

  // "⚒ Agronomist · Lv 14" with a ring for progress, a dot when points wait.
  function badgeHtml(c) {
    const k = c.career;
    if (!k) return '';
    const cls = classOf(k.class_key);
    const deg = Math.round((k.pct || 0) * 360);
    const alert = k.fork_ready ? '<span class="cr-dot" title="Ready to choose a path">!</span>'
      : k.points_free > 0 ? `<span class="cr-dot" title="${k.points_free} perk point${k.points_free === 1 ? '' : 's'} to spend">${k.points_free}</span>` : '';
    return `<div class="cr-badge" title="${esc(k.title)} — level ${k.level}">
      <span class="cr-ring" style="--deg:${deg}deg"><span>${cls ? cls.icon : '•'}</span></span>
      <span class="cr-badge-txt">${esc(k.title)} · Lv ${k.level}${k.years ? ` · ${k.years} yr${k.years === 1 ? '' : 's'}` : ''}</span>${alert}
    </div>`;
  }
  function listBadge(c) {
    const k = c.career;
    if (!k) return '';
    return `<span class="cr-lv" title="${esc(k.title)}">${k.level}${k.fork_ready || k.points_free ? '<i></i>' : ''}</span>`;
  }

  function traitInfo(id) {
    const t = _defs && _defs.traits;
    if (!t) return null;
    return t.aptitudes[id] || t.aversions[id] || t.legacy[id] || t.deeds[id] || null;
  }
  // Traits tab: what's been discovered, what's hinted, what was earned.
  function traitsHtml(c) {
    const rev = (c.revealed_hidden_traits || []).map(id => {
      const t = traitInfo(id) || { label: id, icon: '✦' };
      const bad = _defs && _defs.traits.aversions[id];
      return `<div class="cp-trait cr-trait ${bad ? 'cr-bad' : 'cr-good'}"><span class="cp-trait-icon">${t.icon || '✦'}</span>
        <div><div class="cp-trait-name">${esc(t.label)}</div><div class="cr-trait-desc">${esc(t.desc || '')}</div></div></div>`;
    }).join('');
    const hints = (c.trait_hints || []).map(() => `<div class="cr-hint">🔎 Something about ${esc(c.name.split(' ')[0])} seems… different. Keep them at it.</div>`).join('');
    const earned = (c.earned_traits || []).map(e => {
      const cls = classOf(e.class);
      let label = e.id, icon = '🏅';
      if (e.id === 'veteran') { label = 'Veteran ' + (cls ? cls.label : ''); icon = '🎖️'; }
      else if (e.id === 'old_hand') { label = 'Elder ' + (cls ? cls.label : ''); icon = '🧓'; }
      else if (_defs) {
        const d = _defs.traits.deeds[e.id];
        const q = e.class && _defs.traits.quirks[e.class] ? [..._defs.traits.quirks[e.class].good, ..._defs.traits.quirks[e.class].bad].find(x => x.id === e.id) : null;
        if (d) { label = d.label; icon = d.icon; } else if (q) { label = q.label; icon = q.icon; }
      }
      return `<div class="cp-trait cr-trait"><span class="cp-trait-icon">${icon}</span><div><div class="cp-trait-name">${esc(label)}</div></div></div>`;
    }).join('');
    return `
      <div class="cp-section-label" style="margin-top:14px">Discovered</div>
      ${rev ? `<div class="cp-traits-grid">${rev}</div>` : '<div class="cp-hidden-note">Some traits only reveal themselves through lived experience…</div>'}
      ${hints}
      ${earned ? `<div class="cp-section-label" style="margin-top:14px">Earned</div><div class="cp-traits-grid">${earned}</div>` : ''}`;
  }

  // ── Career tab ───────────────────────────────────────────────────────────

  const _career = {};   // citizenId → last /citizen payload
  async function fetchCareer(cid) {
    const d = await call('GET', `/api/careers/citizen/${cid}`);
    _career[cid] = d.career;
    return d.career;
  }

  function effectLine(type, param, value) {
    return M().describeEffect({ type, param, value }, NAMES);
  }

  async function renderTab(cid, el) {
    el = el || byId('cp-career-content');
    if (!el) return;
    el.innerHTML = '<div class="cp-rel-loading">Reading their record…</div>';
    try { await loadDefs(); } catch (e) { el.innerHTML = `<div class="cr-err">${esc(e.message)}</div>`; return; }
    let k;
    try { k = await fetchCareer(cid); } catch (e) { el.innerHTML = `<div class="cr-err">${esc(e.message)}</div>`; return; }
    const curK = k.active ? k.active.class_key : null;
    const cur = k.classes.find(x => x.class_key === curK) || (curK ? { class_key: curK, level: 1, xp: 0, into: 0, need: M().xpForLevel(2), pct: 0, free_points: 0, years: 0, hours_worked: 0, title: M().titleFor(1, classOf(curK).label) } : null);
    const cls = curK ? classOf(curK) : null;
    const a = k.active;
    let html = '';
    if (cur && cls) {
      const spec = cls.fork && cur.spec ? cls.fork.find(f => f.key === cur.spec) : null;
      const rate = a && a.xp_rate ? a.xp_rate : null;
      const nextService = [['veteran', 'Veteran'], ['quirk', 'a mark of the trade'], ['old_hand', 'Elder']]
        .map(([key, label]) => ({ label, h: _defs.service[key] })).find(x => cur.hours_worked < x.h);
      html += `
        <div class="cr-card">
          <div class="cr-card-head">
            <div class="cr-big-icon">${spec ? spec.icon : cls.icon}</div>
            <div class="cr-card-title">
              <div class="cr-title">${esc(cur.title)}</div>
              <div class="cr-sub">${esc(cls.label)}${spec ? ' · ' + esc(spec.label) : ''} · Level ${cur.level}${cur.years ? ` · ${cur.years} year${cur.years === 1 ? '' : 's'} on the job` : ''}</div>
            </div>
          </div>
          <div class="cr-xp"><div class="cr-xp-fill" style="width:${Math.round((cur.pct || 0) * 100)}%"></div></div>
          <div class="cr-xp-txt">${cur.level >= 20 ? 'Mastered' : `${Math.floor(cur.into)} / ${cur.need} XP to level ${cur.level + 1}`}
            ${rate ? ` · <span title="${esc(rate.parts.map(p => `${p.label} ×${p.mult}`).join(', ') || 'Base rate')}">${rate.perHour} XP/hr</span>` : ''}
            ${a && a.away ? ' · <em>away — the trip pays its own XP</em>' : ''}</div>
          <div class="cr-actions">
            ${cur.fork_ready ? `<button type="button" class="cr-btn cr-btn-gold" data-cr="fork" data-class="${esc(curK)}">🌿 Choose a path</button>` : ''}
            <button type="button" class="cr-btn cr-btn-primary" data-cr="tree" data-class="${esc(curK)}">🌳 Skill tree${cur.free_points ? ` <b class="cr-pts">${cur.free_points}</b>` : ''}</button>
            ${cls.station && typeof global.openCrafting === 'function' ? `<button type="button" class="cr-btn" data-cr="craft" data-station="${esc(cls.station)}">🔨 Workshop</button>` : ''}
          </div>
          ${a && a.mentor ? `<div class="cr-note">🧑‍🏫 Learning from <b>${esc(a.mentor)}</b> (+${Math.round((a.mentor_bonus || 0.2) * 100)}% XP)</div>` : ''}
          ${a && a.apprentices ? `<div class="cr-note">🧑‍🏫 Teaching ${a.apprentices} apprentice${a.apprentices === 1 ? '' : 's'}</div>` : ''}
          ${a && a.family_trade ? '<div class="cr-note">👪 The family trade (+10% XP)</div>' : ''}
          ${a && a.retraining ? '<div class="cr-note">📚 Retraining — no work for a little while.</div>' : ''}
          ${nextService ? `<div class="cr-note cr-muted">Next: ${esc(nextService.label)} after ${Math.round(nextService.h / _defs.service.hours_per_year)} years (${Math.ceil((nextService.h - cur.hours_worked) / 24)} days of work)</div>` : ''}
        </div>`;
      if (a) {
        const rows = Object.entries(a.effects).filter(([, v]) => v).map(([key, v]) => {
          const [type, param] = key.split(':');
          return `<li>${esc(effectLine(type, param, v))}</li>`;
        }).join('');
        const src = [...new Set(a.sources.map(s => s.source))].slice(0, 12).map(s => `<span class="cr-src">${esc(s)}</span>`).join('');
        html += `<div class="cp-section-label">Bonuses at work</div>
          <div class="cr-bonuses">${rows ? `<ul>${rows}</ul>` : '<div class="cr-muted">Nothing yet — level up and learn some perks.</div>'}
            <div class="cr-out">Output ×${a.output_mult} <span class="cr-muted">(stats ×${a.stat_mult})</span></div>
            ${src ? `<div class="cr-srcs">${src}</div>` : ''}</div>`;
      }
    } else {
      html += `<div class="cr-card"><div class="cr-muted">${k.life_stage === 'child' ? 'Too young for a trade.' : 'Idle — give them a job to start learning one.'}</div></div>`;
    }
    const others = k.classes.filter(x => x.class_key !== curK);
    if (others.length) {
      html += `<div class="cp-section-label">Other trades</div><div class="cr-others">${others.map(o => {
        const oc = classOf(o.class_key) || { icon: '•', label: o.class_key };
        return `<button type="button" class="cr-other" data-cr="tree" data-class="${esc(o.class_key)}">${oc.icon} ${esc(o.title)} <b>Lv ${o.level}</b></button>`;
      }).join('')}</div><div class="cr-muted cr-small">XP is kept when changing jobs; perks work only in the current one.</div>`;
    }
    if (k.history && k.history.length) {
      html += `<div class="cp-section-label">Story so far</div><ul class="cr-history">${k.history.map(h =>
        `<li>${esc(h.narrative)} <span class="cr-muted">${new Date(h.occurred_at).toLocaleDateString()}</span></li>`).join('')}</ul>`;
    }
    if (isAdmin()) html += adminHtml(k, curK);
    el.innerHTML = html;
    el.onclick = e => onTabClick(e, cid);
  }

  function adminHtml(k, curK) {
    const keys = Object.keys(_defs.classes);
    const traits = [...Object.keys(_defs.traits.aptitudes), ...Object.keys(_defs.traits.aversions), ...Object.keys(_defs.traits.legacy)];
    return `<details class="cr-admin"><summary>⚗ Dev Tools</summary>
      <label>Class <select id="cr-ad-class">${keys.map(x => `<option value="${x}" ${x === curK ? 'selected' : ''}>${esc(_defs.classes[x].label)}</option>`).join('')}</select></label>
      <div class="cr-ad-row">
        <label>Level <input id="cr-ad-level" type="number" min="1" max="20" value="10"></label><button type="button" class="cr-btn" data-cr="ad-level">Set level</button>
        <button type="button" class="cr-btn" data-cr="ad-xp" data-v="250">+250 XP</button>
      </div>
      <div class="cr-ad-row">
        <button type="button" class="cr-btn" data-cr="ad-hours" data-v="24">+24h worked</button>
        <button type="button" class="cr-btn" data-cr="ad-hours" data-v="100">+100h</button>
        <button type="button" class="cr-btn" data-cr="ad-hours" data-v="720">+720h</button>
      </div>
      <div class="cr-ad-row">
        <select id="cr-ad-trait">${traits.map(t => `<option value="${t}">${esc((traitInfo(t) || {}).label || t)}</option>`).join('')}</select>
        <button type="button" class="cr-btn" data-cr="ad-reveal">Reveal</button>
        <button type="button" class="cr-btn cr-btn-danger" data-cr="ad-reset">Reset class</button>
      </div>
      <div class="cr-muted cr-small">Hidden: ${esc(k.hints.length ? 'hints shown' : '—')}</div>
    </details>`;
  }

  async function onTabClick(e, cid) {
    const t = e.target.closest && e.target.closest('[data-cr]');
    if (!t) return;
    const act = t.dataset.cr, classKey = t.dataset.class || (byId('cr-ad-class') || {}).value;
    try {
      if (act === 'tree') return openTree(cid, classKey);
      if (act === 'fork') return openFork(cid, classKey);
      if (act === 'craft') return global.openCrafting(t.dataset.station, cid);
      if (act === 'ad-level') await call('POST', `/api/careers/admin/citizen/${cid}/grant`, { class_key: classKey, level: Number(byId('cr-ad-level').value) });
      else if (act === 'ad-xp') await call('POST', `/api/careers/admin/citizen/${cid}/grant`, { class_key: classKey, xp: Number(t.dataset.v) });
      else if (act === 'ad-hours') await call('POST', `/api/careers/admin/citizen/${cid}/grant`, { class_key: classKey, hours: Number(t.dataset.v) });
      else if (act === 'ad-reveal') await call('POST', `/api/careers/admin/citizen/${cid}/reveal`, { trait: byId('cr-ad-trait').value });
      else if (act === 'ad-reset') { if (!global.confirm('Wipe this class for this citizen?')) return; await call('POST', `/api/careers/admin/citizen/${cid}/reset`, { class_key: classKey }); }
      else return;
      await refreshCitizen(cid);
    } catch (err) { toast(err.message, 'error'); }
  }

  // Re-fetch the citizen list and re-open their profile on the Career tab.
  async function refreshCitizen(cid) {
    if (typeof global.loadCitizens === 'function') await global.loadCitizens();
    const list = global.citizensData || (typeof citizensData !== 'undefined' ? citizensData : []);
    const c = list.find(x => x.id === cid);
    const open = byId('citizen-profile-modal');
    if (c && open && open.style.display !== 'none' && typeof global.renderCitizenProfile === 'function') {
      global.renderCitizenProfile(c);
      const tab = document.querySelector('.cp-tab[data-cp="career"]');
      if (tab && typeof global.cpSwitchTab === 'function') global.cpSwitchTab(tab, 'cp-tab-career');
      renderTab(cid);
    }
  }

  // ── Skill tree overlay ───────────────────────────────────────────────────

  let _tree = null;   // { cid, classKey, grow }
  function overlay() {
    let o = byId('cr-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'cr-overlay';
    o.className = 'cr-overlay';
    o.innerHTML = `<div class="cr-tree-panel" role="dialog" aria-modal="true" aria-labelledby="cr-tree-title">
        <header class="cr-tree-head"><div><h2 id="cr-tree-title"></h2><div class="cr-tree-sub" id="cr-tree-sub"></div></div>
          <button type="button" class="cr-x" data-cr="close" aria-label="Close">✕</button></header>
        <div class="cr-tree-body">
          <div class="cr-tree-view" id="cr-tree-view"><div class="cr-tree-canvas" id="cr-tree-canvas"></div>
            <div class="cr-tree-tools"><button type="button" data-cr="reset-view" title="Reset view">⟲</button></div></div>
          <aside class="cr-node-info" id="cr-node-info"></aside>
        </div>
        <footer class="cr-tree-foot" id="cr-tree-foot"></footer>
      </div>`;
    document.body.appendChild(o);
    o.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && o.classList.contains('open')) closeTree(); });
    _tree = _tree || {};
    _tree.resetView = global.KWCareerTree.panZoom(byId('cr-tree-view'), byId('cr-tree-canvas'));
    return o;
  }
  function closeTree() { const o = byId('cr-overlay'); if (o) o.classList.remove('open'); }

  function rowFor(cid, classKey) {
    const k = _career[cid];
    const r = k && k.classes.find(x => x.class_key === classKey);
    return r || { class_key: classKey, level: 1, xp: 0, spec: null, nodes: {}, free_points: 0, title: M().titleFor(1, classOf(classKey).label) };
  }

  async function openTree(cid, classKey) {
    await loadDefs();
    if (!_career[cid]) await fetchCareer(cid);
    const o = overlay();
    _tree = { ..._tree, cid, classKey, sel: null };
    o.classList.add('open');
    drawTree();
    if (_tree.resetView) _tree.resetView();
  }

  function drawTree(grow) {
    const { cid, classKey } = _tree;
    const cls = classOf(classKey), row = rowFor(cid, classKey), k = _career[cid];
    const active = k.active && k.active.class_key === classKey;
    byId('cr-tree-title').textContent = `${cls.icon} ${k.name} — ${row.title}`;
    byId('cr-tree-sub').innerHTML = `${esc(cls.label)} · Level ${row.level} · <b>${row.free_points}</b> perk point${row.free_points === 1 ? '' : 's'}`
      + (active ? '' : ' · <em>not their job now — perks sleep until they return to it</em>');
    global.KWCareerTree.render(byId('cr-tree-canvas'), {
      cls, row, revealed: (k.revealed_traits || []).map(t => t.id), season: seasonId(), grow,
      onNode: n => { _tree.sel = n.id; info(); },
    });
    info();
    const foot = byId('cr-tree-foot');
    foot.innerHTML = `
      <span class="cr-legend"><i class="lg-av"></i>can learn <i class="lg-own"></i>learned <i class="lg-lock"></i>later <i class="lg-secret"></i>a hidden talent unlocks it</span>
      ${row.fork_ready ? `<button type="button" class="cr-btn cr-btn-gold" data-cr="fork">🌿 Choose a path</button>` : ''}
      ${row.retrain_cost ? `<button type="button" class="cr-btn" data-cr="retrain">📚 Retrain (${row.retrain_cost} gold)</button>` : ''}`;
  }

  // Side panel: the selected perk, this rank and the next.
  function info() {
    const el = byId('cr-node-info');
    const { cid, classKey, sel } = _tree;
    const cls = classOf(classKey), row = rowFor(cid, classKey), k = _career[cid];
    const n = sel && cls.tree.find(x => x.id === sel);
    if (!n) {
      const spec = cls.fork && row.spec ? cls.fork.find(f => f.key === row.spec) : null;
      el.innerHTML = `<div class="cr-ni-empty"><div class="cr-big-icon">${spec ? spec.icon : cls.icon}</div>
        <p>${esc(spec ? spec.desc : cls.desc)}</p>
        <p class="cr-muted">Tap a leaf to see what it does. Each level brings a perk point${cls.fork ? `; at level ${_defs.fork_level} the tree forks and the path is for life` : ''}.</p></div>`;
      return;
    }
    const revealed = (k.revealed_traits || []).map(t => t.id);
    const secret = n.secret && !revealed.includes(n.secret);
    const rank = Number((row.nodes || {})[n.id]) || 0, max = n.maxRank || 1;
    const fx = r => n.effects.map(e => `<li>${esc(effectLine(e.type, e.param, e.per * r))}</li>`).join('');
    const why = n.capstone ? null : M().buyBlocker(cls.tree, row, n.id, { revealed, now: Date.now() });
    const st = global.KWCareerTree.stateOf(n, row, { tree: cls.tree, revealed, now: Date.now() });
    el.innerHTML = secret
      ? `<div class="cr-ni"><div class="cr-ni-icon">✨</div><h3>???</h3><p class="cr-muted">A secret perk. Some citizens have a hidden talent for this trade — work reveals it.</p></div>`
      : `<div class="cr-ni"><div class="cr-ni-icon">${esc(n.icon)}</div><h3>${esc(n.name)}</h3>
        <div class="cr-muted">${n.capstone ? 'Capstone · free at level 20' : `Level ${n.tier} · rank ${rank}/${max}`}${n.branch !== 'trunk' ? ' · ' + esc((cls.fork.find(f => f.key === n.branch) || {}).label || '') : ''}</div>
        ${n.desc ? `<p>${esc(n.desc)}</p>` : ''}
        ${rank ? `<div class="cr-ni-lbl">Now</div><ul>${fx(rank)}</ul>` : ''}
        ${rank < max && !n.capstone ? `<div class="cr-ni-lbl">${rank ? 'Next rank' : 'Learning it gives'}</div><ul>${fx(rank + 1)}</ul>` : ''}
        ${n.capstone ? `<ul>${fx(1)}</ul>` : ''}
        ${n.requires && n.requires.length ? `<div class="cr-muted cr-small">Needs: ${n.requires.map(r => esc((cls.tree.find(x => x.id === r) || {}).name || r)).join(', ')}</div>` : ''}
        ${n.capstone ? '' : why
          ? `<div class="cr-ni-why">${esc(st === 'closed' ? 'The other path — not this one.' : why)}</div>`
          : `<button type="button" class="cr-btn cr-btn-primary cr-learn" data-cr="learn" data-node="${esc(n.id)}">🌱 Learn${rank ? ' next rank' : ''}</button>`}
      </div>`;
  }

  async function onOverlayClick(e) {
    const t = e.target.closest && e.target.closest('[data-cr]');
    if (e.target.id === 'cr-overlay') return;   // clicking outside never closes
    if (!t) return;
    const { cid, classKey } = _tree;
    const act = t.dataset.cr;
    if (act === 'close') return closeTree();
    if (act === 'reset-view') return _tree.resetView && _tree.resetView();
    if (act === 'fork') return openFork(cid, classKey);
    if (act === 'learn') {
      t.disabled = true;
      try {
        await call('POST', `/api/careers/citizen/${cid}/nodes`, { class_key: classKey, node_id: t.dataset.node });
        await fetchCareer(cid);
        drawTree(t.dataset.node);
        global.KWCareerTree.burst(byId('cr-tree-canvas'), t.dataset.node, seasonId());
        refreshQuiet(cid);
      } catch (err) { toast(err.message, 'error'); t.disabled = false; }
    }
    if (act === 'retrain') {
      const row = rowFor(cid, classKey);
      if (!global.confirm(`Unlearn every perk for ${row.retrain_cost} gold? They won't work for ${_defs.retrain.hours} hours while they retrain. Their path stays.`)) return;
      try {
        const r = await call('POST', `/api/careers/citizen/${cid}/retrain`, { class_key: classKey });
        toast(`📚 Retraining — ${r.refunded} point${r.refunded === 1 ? '' : 's'} back for ${r.gold} gold.`);
        if (typeof global.refreshResources === 'function') global.refreshResources();
        await fetchCareer(cid); drawTree(); refreshQuiet(cid);
      } catch (err) { toast(err.message, 'error'); }
    }
  }

  // Keep the list badges and the open Career tab in step, quietly.
  async function refreshQuiet(cid) {
    if (typeof global.loadCitizens === 'function') { try { await global.loadCitizens(); } catch (_) {} }
    const el = byId('cp-career-content');
    if (el && el.offsetParent !== null) renderTab(cid, el);
  }

  // ── The fork ─────────────────────────────────────────────────────────────

  async function openFork(cid, classKey) {
    await loadDefs();
    if (!_career[cid]) await fetchCareer(cid);
    const cls = classOf(classKey), k = _career[cid];
    let m = byId('cr-fork');
    if (!m) { m = document.createElement('div'); m.id = 'cr-fork'; m.className = 'cr-modal'; document.body.appendChild(m); }
    const card = f => {
      const nodes = cls.tree.filter(n => n.branch === f.key);
      const capN = nodes.find(n => n.capstone);
      const sample = nodes.filter(n => !n.capstone).slice(0, 3);
      return `<button type="button" class="cr-path" data-spec="${esc(f.key)}">
        <div class="cr-path-icon">${f.icon}</div><h3>${esc(f.label)}</h3><p>${esc(f.desc)}</p>
        <ul>${sample.map(n => `<li>${esc(n.icon)} ${esc(n.name)}</li>`).join('')}</ul>
        ${capN ? `<div class="cr-path-cap">At level 20: <b>${esc(capN.icon)} ${esc(capN.name)}</b>${capN.desc ? ' — ' + esc(capN.desc) : ''}</div>` : ''}
      </button>`;
    };
    m.innerHTML = `<div class="cr-fork-box" role="dialog" aria-modal="true" aria-labelledby="cr-fork-title">
      <button type="button" class="cr-x" data-x aria-label="Close">✕</button>
      <h2 id="cr-fork-title">🌿 ${esc(k.name)} has mastered the basics</h2>
      <p class="cr-muted">Choose the path their ${esc(cls.label.toLowerCase())} career takes. <b>This choice is for life</b> — the other path closes for good.</p>
      <div class="cr-paths">${cls.fork.map(card).join('')}</div>
      <div class="cr-fork-confirm" id="cr-fork-confirm"></div>
    </div>`;
    m.classList.add('open');
    m.onclick = async e => {
      if (e.target.closest('[data-x]')) { m.classList.remove('open'); return; }
      const p = e.target.closest('.cr-path');
      const go = e.target.closest('[data-go]');
      if (p) {
        m.querySelectorAll('.cr-path').forEach(x => x.classList.toggle('on', x === p));
        const f = cls.fork.find(x => x.key === p.dataset.spec);
        byId('cr-fork-confirm').innerHTML = `<button type="button" class="cr-btn cr-btn-gold" data-go="${esc(f.key)}">Become ${/^[aeiou]/i.test(f.label) ? 'an' : 'a'} ${esc(f.label)}</button>`;
      } else if (go) {
        go.disabled = true;
        try {
          await call('POST', `/api/careers/citizen/${cid}/fork`, { class_key: classKey, spec: go.dataset.go });
          m.classList.remove('open');
          await fetchCareer(cid);
          if (byId('cr-overlay') && byId('cr-overlay').classList.contains('open')) drawTree();
          refreshQuiet(cid);
        } catch (err) { toast(err.message, 'error'); go.disabled = false; }
      }
    };
  }

  // ── Discoveries & realtime ───────────────────────────────────────────────

  function revealCard(ev) {
    let m = byId('cr-reveal');
    if (!m) { m = document.createElement('div'); m.id = 'cr-reveal'; m.className = 'cr-modal'; document.body.appendChild(m); }
    const bad = ev.kind === 'aversion';
    m.innerHTML = `<div class="cr-scroll ${bad ? 'cr-scroll-bad' : ''}" role="dialog" aria-modal="true">
      <div class="cr-scroll-top">${bad ? 'A hard truth' : 'A hidden talent'}</div>
      <div class="cr-scroll-icon">${esc(ev.icon || '✦')}</div>
      <h2>${esc(ev.name)} is ${bad ? '' : ''}<b>${esc(ev.label)}</b></h2>
      <p>${esc(ev.desc || '')}</p>
      <button type="button" class="cr-btn cr-btn-primary" data-x>${bad ? 'Noted' : 'Wonderful!'}</button>
    </div>`;
    m.classList.add('open');
    m.onclick = e => { if (e.target.closest('[data-x]')) m.classList.remove('open'); };
  }

  function onEvent(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'career_level_up') {
      toast(ev.fork_ready ? `🌿 ${ev.name} reached level ${ev.level} — time to choose a path!` : `🎓 ${ev.name} is now ${ev.title} (Lv ${ev.level}).`);
    } else if (ev.type === 'career_fork') toast(`🌿 ${ev.name} chose the path of the ${ev.label}.`);
    else if (ev.type === 'trait_hint') toast(`🔎 ${ev.hint}`, 'info');
    else if (ev.type === 'trait_revealed') { loadDefs().then(() => revealCard(ev)).catch(() => {}); }
    else if (ev.type === 'career_milestone') toast(`${ev.icon || '🏅'} ${ev.name}: ${ev.label}${ev.good === false ? ' — the years took their toll.' : '!'}`);
    else if (ev.type === 'career_find') toast(`${ev.item && ev.item.icon || '✨'} ${ev.name} found ${ev.item ? ev.item.name : 'something'} while working.`);
    else return;
    if (typeof global.loadCitizens === 'function') global.loadCitizens();
  }

  global.KWCareers = {
    loadDefs, defs, roleLabel, roleIcon, roleOptionsHtml, badgeHtml, listBadge, traitsHtml,
    renderTab, openTree, openFork, onEvent, closeTree, _career,
  };
  // Defs early so the job picker has levels and labels on first open.
  if (typeof document !== 'undefined' && !global.__KW_NO_AUTOSTART) setTimeout(() => { if (global.apiFetch) loadDefs().catch(() => {}); }, 1500);
})(typeof window !== 'undefined' ? window : this);
