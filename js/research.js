// ══════════════════════════════════════════════════════════════════════════
//  RESEARCH — the Library: a full-screen, Civ-style tech tree.
//
//  Server: /api/research (kindlewood-server lib/research). Scholars at the
//  Library earn research points for one project at a time; with nothing
//  chosen, points bank (up to a cap) for the next one. The tree comes only
//  from the API: branches are rows (paths), eras are columns, each project
//  sits at (tier, branch, slot) and its arrows come from `requires`. Distant
//  projects arrive as ?? with no name — the browser never has the full tree.
//
//  Screen: a header (what's being studied, Scholars, points/hr), era labels
//  along the top and path labels down the left (both follow the scroll), the
//  tree in between (drag or wheel to pan; touch scrolls), and a detail panel
//  for the chosen project (side panel; a bottom sheet on phones).
//
//  Open: window.openLibrary()   Realtime: research_done (js/realtime.js).
//  Dev Tools (admins): "Finish now" on a project, "Reset research".
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };
  const byId = id => document.getElementById(id);
  const isAdmin = () => typeof global._kwIsAdmin === 'function' && global._kwIsAdmin();
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  let _st = null, _sel = null, _busy = false, _dragged = false;

  async function call(method, path, body) {
    const res = await global.apiFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // "3h 20m", "2d 4h"
  function fmtHours(h) {
    if (h == null || !isFinite(h)) return '—';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
    if (h < 48) { const H = Math.floor(h), m = Math.round((h - H) * 60); return H + 'h' + (m ? ' ' + m + 'm' : ''); }
    const d = Math.floor(h / 24); return d + 'd ' + Math.round(h - d * 24) + 'h';
  }

  // ── What a project does, in words ────────────────────────────────────────
  const pctTxt = v => Math.round(Math.abs(v) * 100) + '%';
  const EFFECT_TXT = {
    ore: v => `+${pctTxt(v)} ore from mines and outposts`,
    build_cost: v => `−${pctTxt(v)} building and upgrade costs`,
    market_fee: v => `−${pctTxt(v)} Market fees`,
    research: v => `+${pctTxt(v)} research speed`,
    craft_speed: v => `+${pctTxt(v)} crafting speed at every workshop`,
    bank: v => `up to ${v} more research points bank`,
    craft_xp: v => `+${pctTxt(v)} crafting XP`,
    quality: v => `+${v} craft quality`,
    carry: v => `+${pctTxt(v)} porter and merchant carry weight`,
  };
  // p.unlocks comes from the server (only for projects the town can see).
  function unlockList(proj) {
    const D = global.KWResources;
    const p = proj && proj.unlocks;
    if (!p) return [];
    const out = [];
    (p.resources || []).forEach(k => out.push(D ? D.icon(k) + ' ' + D.label(k) : k));
    (p.buildings || []).forEach(b => out.push('🏗 ' + b.charAt(0).toUpperCase() + b.slice(1)));
    (p.recipes || []).forEach(r => out.push('📜 ' + r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())));
    Object.entries(p.effects || {}).forEach(([k, v]) => out.push('✨ ' + effectText(k, v)));
    return out;
  }
  const unlocksText = proj => unlockList(proj).join(' · ');
  // 'ore:copper' → "+25% Copper"; 'craft_speed:smithy' → "+15% Smithy speed".
  function effectText(k, v) {
    if (EFFECT_TXT[k]) return EFFECT_TXT[k](v);
    const [type, param] = k.split(':');
    const name = param ? param.charAt(0).toUpperCase() + param.slice(1) : '';
    if (type === 'ore') return `+${pctTxt(v)} ${global.KWResources ? global.KWResources.label(param) : name}`;
    if (type === 'craft_speed') return `+${pctTxt(v)} ${name} speed`;
    return k;
  }
  const DISTANT = 'A distant technology. Your scholars can\'t make sense of it yet — research more of what leads here to understand it.';

  // ── Layout: where each project sits ──────────────────────────────────────
  // Phones get a tighter grid. Returns geometry plus { key: { x, y } }.
  // meta: { branches, eras } from the server (GET /api/research).
  function layout(projects, narrow, meta) {
    const M = meta || _st || {};
    const g = narrow
      ? { colW: 176, nodeW: 148, nodeH: 66, rowH: 84, laneGap: 14, padX: 14, padY: 12, labelW: 46, eraH: 30 }
      : { colW: 236, nodeW: 192, nodeH: 74, rowH: 92, laneGap: 18, padX: 22, padY: 16, labelW: 150, eraH: 36 };
    const branches = Object.entries(M.branches || {}).sort((a, b) => a[1].order - b[1].order);
    const eras = M.eras || [];
    const lanes = [];
    let y = g.padY;
    for (const [key, b] of branches) {
      const rows = 1 + Math.max(0, ...projects.filter(p => p.branch === key).map(p => p.slot || 0));
      const h = rows * g.rowH - (g.rowH - g.nodeH);
      lanes.push({ key, label: b.label, icon: b.icon, y: y - g.laneGap / 2, h: h + g.laneGap });
      y += h + g.laneGap;
    }
    const pos = {};
    for (const p of projects) {
      const lane = lanes.find(l => l.key === p.branch);
      if (!lane) continue;
      pos[p.key] = { x: g.padX + (p.tier - 1) * g.colW, y: lane.y + g.laneGap / 2 + (p.slot || 0) * g.rowH };
    }
    const width = g.padX * 2 + (eras.length - 1) * g.colW + g.nodeW;
    return { g, lanes, eras, pos, width, height: y - g.laneGap + g.padY };
  }

  // A curved arrow from a prerequisite's right edge to a project's left edge.
  function linkPath(a, b, g) {
    const x1 = a.x + g.nodeW, y1 = a.y + g.nodeH / 2, x2 = b.x - 4, y2 = b.y + g.nodeH / 2;
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  }

  function nodeHtml(p, at, g, st) {
    if (p.hidden) {
      return `<button type="button" class="rs-node rs-hidden${_sel === p.key ? ' rs-sel' : ''}" data-rs="pick" data-key="${esc(p.key)}"
          style="left:${at.x}px;top:${at.y}px;width:${g.nodeW}px;height:${g.nodeH}px" aria-label="Unknown technology" title="${esc(DISTANT)}">
        <span class="rs-n-icon" aria-hidden="true">❔</span>
        <span class="rs-n-main"><span class="rs-n-name">??</span><span class="rs-n-meta">Too distant to understand</span></span>
      </button>`;
    }
    const pct = Math.min(100, Math.round(p.progress / p.cost * 100));
    const meta = p.status === 'done' ? '<span class="rs-n-meta">✓ Studied</span>'
      : p.status === 'active' ? `<span class="rs-n-bar"><i style="width:${pct}%"></i></span><span class="rs-n-meta">${pct}%${st.eta_hours != null ? ' · ' + fmtHours(st.eta_hours) : ''}</span>`
      : `<span class="rs-n-meta">${p.status === 'locked' ? '🔒 ' : ''}${p.cost} pts${p.progress > 0 ? ' · ' + pct + '%' : ''}</span>`;
    const label = `${p.label}: ${p.status === 'done' ? 'studied' : p.status === 'active' ? 'being studied' : p.status === 'locked' ? 'locked' : 'can be studied'}, ${p.cost} points`;
    return `<button type="button" class="rs-node rs-${p.status}${_sel === p.key ? ' rs-sel' : ''}" data-rs="pick" data-key="${esc(p.key)}"
        style="left:${at.x}px;top:${at.y}px;width:${g.nodeW}px;height:${g.nodeH}px" aria-label="${esc(label)}">
      <span class="rs-n-icon" aria-hidden="true">${esc(p.icon)}</span>
      <span class="rs-n-main"><span class="rs-n-name">${esc(p.label)}</span>${meta}</span>
      ${p.queued ? `<span class="rs-n-q" title="Queued #${p.queued}">#${p.queued}</span>` : ''}
    </button>`;
  }

  function treeHtml(st, L) {
    const by = Object.fromEntries(st.projects.map(p => [p.key, p]));
    const links = [];
    for (const p of st.projects) for (const r of p.requires || []) {
      if (!L.pos[r] || !L.pos[p.key]) continue;
      const cls = p.hidden || (by[r] && by[r].hidden) ? 'rs-l-hidden'
        : by[r] && by[r].status === 'done' ? (p.status === 'locked' ? 'rs-l-half' : 'rs-l-done') : 'rs-l-locked';
      links.push(`<path class="rs-link ${cls}" d="${linkPath(L.pos[r], L.pos[p.key], L.g)}" data-from="${esc(r)}" data-to="${esc(p.key)}"/>`);
    }
    const bands = L.lanes.map((l, i) => `<div class="rs-band${i % 2 ? ' rs-band-alt' : ''}" style="top:${l.y}px;height:${l.h}px"></div>`).join('');
    const cols = L.eras.map((_, i) => `<div class="rs-col" style="left:${L.g.padX + i * L.g.colW - (L.g.colW - L.g.nodeW) / 2}px;width:${L.g.colW}px"></div>`).join('');
    return `<div class="rs-canvas" style="width:${L.width}px;height:${L.height}px">
        ${cols}${bands}
        <svg class="rs-links" width="${L.width}" height="${L.height}" aria-hidden="true">
          ${links.join('')}</svg>
        ${st.projects.filter(p => L.pos[p.key]).map(p => nodeHtml(p, L.pos[p.key], L.g, st)).join('')}
      </div>`;
  }

  // Can the i-th queued project swap with its neighbour (dir −1 earlier, +1
  // later)? Not past something it needs, or something that needs it — the
  // server refuses those too (POST /api/research/queue/move).
  function canMove(st, i, dir) {
    const q = st.queue || [], j = i + dir;
    if (i < 0 || j < 0 || j >= q.length) return false;
    const by = Object.fromEntries(st.projects.map(p => [p.key, p]));
    const [first, second] = dir < 0 ? [q[j], q[i]] : [q[i], q[j]];
    return !((by[second] && by[second].requires) || []).includes(first);
  }

  function headerHtml(st) {
    const active = st.projects.find(p => p.status === 'active');
    const now = active
      ? `<div class="rs-now"><span class="rs-now-l">Studying</span> <b>${esc(active.icon)} ${esc(active.label)}</b>
          <span class="rs-now-bar"><i style="width:${Math.round(active.progress / active.cost * 100)}%"></i></span>
          <span class="rs-now-s">${Math.floor(active.progress)} / ${active.cost} · ${st.per_hour > 0 ? fmtHours(st.eta_hours) + ' to go' : 'no Scholars studying'}</span></div>`
      : `<div class="rs-now"><span class="rs-now-l">Nothing chosen</span> <span class="rs-now-s">${st.bank > 0 ? `${Math.floor(st.bank)} points banked (up to ${st.bank_cap}) — they go into the next project.` : st.library_level ? 'Pick a project in the tree.' : ''}</span></div>`;
    const sch = st.scholars.length ? st.scholars.map(s => `<span class="rs-sch">📖 ${esc(s.name)} <b>${s.perHour}/hr</b></span>`).join('') : '';
    const by = Object.fromEntries(st.projects.map(p => [p.key, p]));
    const queue = (st.queue || []).length
      ? `<span class="rs-now-l">Next</span>` + st.queue.map((k, i) => {
          const name = by[k] ? by[k].label : k;
          const mv = (dir, glyph, word) => canMove(st, i, dir)
            ? `<button type="button" class="rs-qchip-mv" data-rs="move" data-key="${esc(k)}" data-to="${i + dir}" aria-label="Move ${esc(name)} ${word}" title="Move ${word}">${glyph}</button>` : '';
          return `<span class="rs-qchip">${mv(-1, '◀', 'earlier')}<button type="button" class="rs-qchip-go" data-rs="pick" data-key="${esc(k)}">${i + 1}. ${esc(by[k] ? by[k].icon + ' ' + by[k].label : k)}</button>${mv(1, '▶', 'later')}<button type="button" class="rs-qchip-x" data-rs="dequeue" data-key="${esc(k)}" aria-label="Remove ${esc(name)} from the queue">✕</button></span>`;
        }).join('')
      : '';
    return { now, sch, queue };
  }

  function detailHtml(st) {
    const p = _sel && st.projects.find(x => x.key === _sel);
    if (!p) return '';
    if (p.hidden) {
      return `<div class="rs-d-head"><span class="rs-d-icon">❔</span><div><h3>??</h3><div class="rs-d-sub">Unknown technology</div></div>
          <button type="button" class="cr-x" data-rs="unpick" aria-label="Close details">✕</button></div>
        <p class="rs-d-desc">${esc(DISTANT)}</p>`;
    }
    const by = Object.fromEntries(st.projects.map(x => [x.key, x]));
    const b = (st.branches || {})[p.branch];
    const pct = Math.min(100, Math.round(p.progress / p.cost * 100));
    const reqs = (p.requires || []).map(r => `<li class="${by[r] && by[r].status === 'done' ? 'rs-ok' : 'rs-miss'}">${by[r] && by[r].status === 'done' ? '✓' : '✗'} ${esc(by[r] ? by[r].icon + ' ' + by[r].label : r)}</li>`).join('');
    const unl = unlockList(p).map(x => `<li>${esc(x)}</li>`).join('');
    const noLib = st.library_level ? '' : 'disabled title="Build a Library first"';
    const full = (st.queue || []).length + (p.queue_adds || 0) + 1 > (st.queue_max || 10);
    const btns = [];
    if (p.status === 'active') btns.push(`<button type="button" class="cr-btn" data-rs="dequeue" data-key="${esc(p.key)}">Stop</button>`);
    else if (p.queued) {
      const i = p.queued - 1;
      if (canMove(st, i, -1)) btns.push(`<button type="button" class="cr-btn" data-rs="move" data-key="${esc(p.key)}" data-to="${i - 1}">▲ Move up</button>`);
      if (canMove(st, i, 1)) btns.push(`<button type="button" class="cr-btn" data-rs="move" data-key="${esc(p.key)}" data-to="${i + 1}">▼ Move down</button>`);
      btns.push(`<button type="button" class="cr-btn" data-rs="dequeue" data-key="${esc(p.key)}">Remove from queue</button>`);
    }
    else if (p.status !== 'done') btns.push(`<button type="button" class="cr-btn" data-rs="queue" data-key="${esc(p.key)}" ${noLib || (full ? `disabled title="The queue holds ${st.queue_max || 10}"` : '')}>Add to queue${p.queue_adds ? ` (adds ${p.queue_adds} first)` : ''}</button>`);
    if (p.status === 'open') btns.push(`<button type="button" class="cr-btn cr-btn-primary" data-rs="start" data-key="${esc(p.key)}" ${noLib}>${p.progress > 0 ? 'Resume now' : 'Study now'}</button>`);
    const btn = btns.join('');
    const state = p.status === 'done' ? '<div class="rs-d-state rs-ok">✓ Your town has studied this.</div>'
      : p.status === 'active' ? `<div class="rs-d-state">Studying now — ${st.eta_hours != null ? fmtHours(st.eta_hours) + ' to go' : 'no Scholars studying'}.</div>`
      : p.status === 'locked' ? `<div class="rs-d-state rs-miss">🔒 ${esc(p.blocked)}</div>` : '';
    const qline = p.queued ? `<div class="rs-d-state">Queued #${p.queued}.</div>` : '';
    const admin = isAdmin() && p.status !== 'done' ? `<button type="button" class="cr-btn rs-admin" data-rs="finish" data-key="${esc(p.key)}" title="Dev Tools">⚡ Finish now</button>` : '';
    return `<div class="rs-d-head"><span class="rs-d-icon">${esc(p.icon)}</span>
        <div><h3>${esc(p.label)}</h3><div class="rs-d-sub">${b ? esc(b.icon + ' ' + b.label) : ''} · Era ${ROMAN[p.tier - 1] || p.tier}${(st.eras || [])[p.tier - 1] ? ' — ' + esc(st.eras[p.tier - 1]) : ''} · ${p.field === 'nature' ? '🔭 Nature' : '📜 Lore'}</div></div>
        <button type="button" class="cr-x" data-rs="unpick" aria-label="Close details">✕</button></div>
      <p class="rs-d-desc">${esc(p.desc)}</p>
      ${unl ? `<div class="rs-d-h">Unlocks</div><ul class="rs-d-list">${unl}</ul>` : ''}
      ${reqs ? `<div class="rs-d-h">Needs first</div><ul class="rs-d-list">${reqs}</ul>` : ''}
      <div class="rs-d-h">Cost</div>
      <div class="rs-d-cost">${p.cost} research points${p.progress > 0 && p.status !== 'done' ? ` · ${Math.floor(p.progress)} done` : ''}</div>
      ${p.status !== 'done' && p.progress > 0 ? `<div class="rs-now-bar rs-d-bar"><i style="width:${pct}%"></i></div>` : ''}
      ${state}${qline}
      <div class="rs-d-act">${admin}${btn}</div>`;
  }

  // ── The screen ───────────────────────────────────────────────────────────
  const narrow = () => (global.innerWidth || 1200) < 700;

  function render(opts) {
    const st = _st, root = byId('rs-overlay');
    if (!st || !root) return;
    const L = layout(st.projects, narrow(), st);
    const h = headerHtml(st);
    byId('rs-sub').textContent = st.library_level
      ? `Level ${st.library_level} · ${st.scholars.length} / ${st.seats} Scholar${st.seats === 1 ? '' : 's'} · ${st.per_hour} points/hr`
      : 'No Library yet';
    byId('rs-now').innerHTML = h.now;
    byId('rs-sch').innerHTML = h.sch;
    byId('rs-queue').innerHTML = h.queue;
    byId('rs-queue').hidden = !h.queue;
    byId('rs-banner').innerHTML = st.library_level ? '' : `<div class="rs-banner-in">📚 Build a <b>Library</b> (Settlement → Scholars' Walk) and give a citizen the <b>Scholar</b> job to start studying. You can plan your path below.</div>`;
    byId('rs-adminbar').innerHTML = isAdmin() ? '<button type="button" class="cr-btn rs-admin" data-rs="reset" title="Dev Tools">🧹 Reset</button>' : '';
    // Era labels (top) and path labels (left) follow the tree's scroll.
    byId('rs-eras-in').style.width = L.width + 'px';
    byId('rs-eras-in').innerHTML = L.eras.map((e, i) => `<div class="rs-era" style="left:${L.g.padX + i * L.g.colW}px;width:${L.g.nodeW}px"><b>${ROMAN[i]}</b> ${esc(e)}</div>`).join('');
    byId('rs-lanes-in').style.height = L.height + 'px';
    byId('rs-lanes-in').innerHTML = L.lanes.map(l => `<div class="rs-lane" style="top:${l.y}px;height:${l.h}px" title="${esc(l.label)}"><span class="rs-lane-icon">${esc(l.icon)}</span><span class="rs-lane-name">${esc(l.label)}</span></div>`).join('');
    root.style.setProperty('--rs-label-w', L.g.labelW + 'px');
    root.style.setProperty('--rs-era-h', L.g.eraH + 'px');
    const vp = byId('rs-viewport');
    const keep = { left: vp.scrollLeft, top: vp.scrollTop };
    vp.innerHTML = treeHtml(st, L);
    const det = byId('rs-detail');
    det.innerHTML = detailHtml(st);
    det.hidden = !det.innerHTML;
    root.classList.toggle('rs-has-detail', !det.hidden);
    if (opts && opts.focus) scrollTo(focusKey(st), L);
    else { vp.scrollLeft = keep.left; vp.scrollTop = keep.top; }
    syncStrips();
  }

  // What to show first: the project being studied, else the first one open.
  function focusKey(st) {
    const a = st.projects.find(p => p.status === 'active') || st.projects.filter(p => p.status === 'open').sort((x, y) => x.tier - y.tier)[0];
    return a ? a.key : null;
  }
  function scrollTo(key, L) {
    const vp = byId('rs-viewport'), at = key && L.pos[key];
    if (!vp || !at) return;
    vp.scrollLeft = Math.max(0, at.x - vp.clientWidth / 3);
    vp.scrollTop = Math.max(0, at.y - vp.clientHeight / 3);
  }
  function syncStrips() {
    const vp = byId('rs-viewport');
    if (!vp) return;
    byId('rs-eras-in').style.transform = `translateX(${-vp.scrollLeft}px)`;
    byId('rs-lanes-in').style.transform = `translateY(${-vp.scrollTop}px)`;
  }

  function modal() {
    let o = byId('rs-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'rs-overlay';
    o.className = 'rs-screen';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'rs-title');
    o.innerHTML = `
      <header class="rs-hd">
        <div class="rs-hd-title"><h2 id="rs-title">📚 Library</h2><div class="rs-sub" id="rs-sub"></div></div>
        <div class="rs-hd-now" id="rs-now"></div>
        <div class="rs-hd-sch" id="rs-sch"></div>
        <div class="rs-hd-queue" id="rs-queue" hidden></div>
        <div class="rs-hd-act"><span id="rs-adminbar"></span><button type="button" class="cr-x rs-close" data-rs="close" aria-label="Close the Library">✕</button></div>
      </header>
      <div id="rs-banner"></div>
      <div class="rs-body">
        <div class="rs-corner" aria-hidden="true"></div>
        <div class="rs-eras" aria-hidden="true"><div id="rs-eras-in" class="rs-strip-in"></div></div>
        <div class="rs-lanes" aria-hidden="true"><div id="rs-lanes-in" class="rs-strip-in"></div></div>
        <div class="rs-viewport" id="rs-viewport" tabindex="-1" aria-label="Research tree"></div>
        <aside class="rs-detail" id="rs-detail" hidden aria-label="Project details"></aside>
      </div>`;
    document.body.appendChild(o);
    o.addEventListener('click', onClick);
    const vp = byId('rs-viewport');
    vp.addEventListener('scroll', syncStrips, { passive: true });
    // Mouse: drag to pan. A drag is not a click.
    let drag = null;
    vp.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop, moved: false };
    });
    global.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      drag.moved = true;
      vp.classList.add('rs-dragging');
      vp.scrollLeft = drag.l - dx; vp.scrollTop = drag.t - dy;
    });
    global.addEventListener('pointerup', () => {
      if (!drag) return;
      _dragged = drag.moved; drag = null;
      vp.classList.remove('rs-dragging');
      setTimeout(() => { _dragged = false; }, 0);
    });
    // A plain wheel scrolls sideways when the tree fits top to bottom.
    vp.addEventListener('wheel', e => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (vp.scrollHeight > vp.clientHeight + 4) return;
      vp.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !o.classList.contains('open')) return;
      if (_sel) { _sel = null; render(); } else close();
    });
    global.addEventListener('resize', () => { if (o.classList.contains('open')) render(); });
    return o;
  }
  function close() { const o = byId('rs-overlay'); if (o) o.classList.remove('open'); document.body.classList.remove('rs-open'); }

  async function load(opts) {
    try { _st = await call('GET', '/api/research'); render(opts); }
    catch (e) { const v = byId('rs-viewport'); if (v) v.innerHTML = `<div class="cr-muted rs-pad">${esc(e.message)}</div>`; }
  }
  async function open() {
    const o = modal();
    _sel = null;
    o.classList.add('open');
    document.body.classList.add('rs-open');
    byId('rs-sub').textContent = 'Loading…';
    byId('rs-viewport').innerHTML = '<div class="cr-muted rs-pad">Lighting the candles…</div>';
    await load({ focus: true });
  }

  async function onClick(e) {
    const b = e.target.closest('[data-rs]');
    if (!b) return;
    const act = b.dataset.rs, key = b.dataset.key;
    if (act === 'close') return close();
    if (act === 'pick') { if (_dragged) return; _sel = _sel === key ? null : key; return render(); }
    if (act === 'unpick') { _sel = null; return render(); }
    if (_busy) return;
    _busy = true;
    try {
      if (act === 'start') {
        _st = await call('POST', '/api/research/start', { project: key });
        const p = _st.projects.find(x => x.key === key);
        toast(p && p.status === 'done' ? `📚 Your banked points finished ${p.label}!` : `📚 Your Scholars are studying ${p ? p.label : key}.`);
      }
      if (act === 'queue') {
        _st = await call('POST', '/api/research/queue', { project: key });
        const p = _st.projects.find(x => x.key === key);
        toast(`📚 Queued ${p ? p.label : key}${p && p.queued ? ` (#${p.queued})` : ''}.`);
      }
      if (act === 'dequeue') {
        const p = _st && _st.projects.find(x => x.key === key);
        _st = await call('DELETE', '/api/research/queue/' + encodeURIComponent(key));
        toast(`${p && p.status === 'active' ? 'Stopped' : 'Removed'} ${p ? p.label : key}.`, 'info');
      }
      if (act === 'move') _st = await call('POST', '/api/research/queue/move', { project: key, to: Number(b.dataset.to) });
      if (act === 'finish') _st = await call('POST', '/api/research/admin/complete', { project: key });
      if (act === 'reset' && global.confirm('Forget all of your town\'s research?')) _st = await call('POST', '/api/research/admin/reset', {});
      render();
    } catch (err) { toast(err.message, 'error'); }
    finally { _busy = false; }
  }

  // Realtime: a project finished (the scholars' clock or Dev Tools).
  function onEvent(ev) {
    if (!ev || ev.type !== 'research_done') return;
    const list = ev.many || [ev];
    for (const x of list) toast(`${x.icon || '📚'} Research finished: ${x.label}! ${x.desc || ''}`);
    const o = byId('rs-overlay');
    if (o && o.classList.contains('open')) load();
  }

  global.KWLibrary = {
    open, close, load, onEvent, fmtHours, unlocksText, unlockList, layout, linkPath, focusKey, canMove,
    _state: () => _st, _render: render, _setState(s) { _st = s; }, _select(k) { _sel = k; },
  };
  global.openLibrary = open;
})(typeof window !== 'undefined' ? window : this);
