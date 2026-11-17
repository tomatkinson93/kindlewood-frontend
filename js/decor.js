// ══════════════════════════════════════════════════════════════════════════
//  KWDecor — decorating and charm, and the lamplighter
//  (docs/HOME_SCENE.md Part F, F.9 and F.6; step 23).
//
//  In Build mode a bar along the bottom offers small things to place in the
//  scene: benches, lantern posts, flower beds, fence pieces, a well, a pond.
//  Pick one, then tap the ground. What is placed can be dragged somewhere
//  else or removed (half the cost back). Together they give the town charm:
//  up to +5 happiness for everyone.
//
//  The server decides everything that counts (lib/decor.js there): the
//  costs, the limits, what is placed, and the charm. This file reads it
//  (GET /api/decor), draws it, and sends each change.
//
//  The drawings are made by code until the art arrives (docs/ART_GUIDE.md
//  §8, batch N): an entry `decor_<kind>` in the props manifest replaces a
//  drawing with a picture.
//
//  The lamplighter: when evening falls, one villager (an elder if there is
//  one out) walks to each lantern post in view and lights it; at dawn they
//  all go out. Looks only.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const S = { data: null, loading: null, busy: false, placing: null, picked: null, drag: null, phase: null, lit: false, lighting: false, timer: null, down: null };
  const PAINT_MS = 600, DRAG_PX = 6;
  // The automatic scenery of these kinds steps aside once the player has placed their own.
  const SCATTER = { bench: 'bench', lantern: 'lantern', fence: 'fence', well: 'well', pond: 'pond' };
  const INK = '#3b2a1a';

  // ── The drawings (stand-ins; w × h on screen, the foot at the bottom middle) ──
  const svg = (w, h, body) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">${body}</svg>`;
  const o = `stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;
  const ART = {
    bench: { w: 58, h: 36, html: svg(58, 36,
      `<ellipse cx="29" cy="33" rx="26" ry="3" fill="rgba(40,30,20,.22)"/>`
      + `<rect x="5" y="4" width="48" height="9" rx="2" fill="#c98a4b" ${o}/><rect x="4" y="16" width="50" height="8" rx="2" fill="#b5743a" ${o}/>`
      + `<path d="M9 13v4M49 13v4M10 24v8M48 24v8" fill="none" ${o}/>`) },
    lantern: { w: 26, h: 64, lamp: [13, 13], html: svg(26, 64,
      `<ellipse cx="13" cy="61" rx="9" ry="2.5" fill="rgba(40,30,20,.22)"/>`
      + `<path d="M13 22v38" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M13 23v36" fill="none" stroke="#7a5a3a" stroke-width="2.5" stroke-linecap="round"/>`
      + `<path d="M7 61h12" fill="none" ${o}/><path d="M5 8l8-6 8 6z" fill="#4a5568" ${o}/>`
      + `<rect class="kwd-glass" x="6.5" y="8" width="13" height="13" rx="2" fill="#9aa7b8" ${o}/>`) },
    flower_bed: { w: 56, h: 28, html: svg(56, 28,
      `<ellipse cx="28" cy="25" rx="26" ry="3" fill="rgba(40,30,20,.2)"/>`
      + `<rect x="3" y="14" width="50" height="10" rx="3" fill="#8a5a2e" ${o}/>`
      + `<path d="M8 15c2-7 6-7 8 0M18 15c2-9 7-9 9 0M30 15c2-7 6-7 8 0M40 15c2-9 7-9 9 0" fill="#5f9a3a" ${o}/>`
      + `<circle cx="12" cy="8" r="3.6" fill="#ff7aa8" ${o}/><circle cx="22.5" cy="6" r="3.6" fill="#ffd35c" ${o}/><circle cx="34" cy="8" r="3.6" fill="#fff" ${o}/><circle cx="44.5" cy="6" r="3.6" fill="#c58bff" ${o}/>`) },
    fence: { w: 62, h: 32, html: svg(62, 32,
      `<ellipse cx="31" cy="29.5" rx="28" ry="2.5" fill="rgba(40,30,20,.2)"/>`
      + `<path d="M3 12h56M3 21h56" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M3 12h56M3 21h56" fill="none" stroke="#c9995c" stroke-width="2.5" stroke-linecap="round"/>`
      + [8, 24, 40, 56].map(x => `<path d="M${x - 3} 29V8l3-4 3 4v21z" fill="#b98144" ${o}/>`).join('')) },
    well: { w: 68, h: 74, big: true, html: svg(68, 74,
      `<ellipse cx="34" cy="69" rx="30" ry="4" fill="rgba(40,30,20,.24)"/>`
      + `<path d="M12 26v30M56 26v30" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M12 26v30M56 26v30" fill="none" stroke="#9a6a3a" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M4 28l30-22 30 22z" fill="#b5483a" ${o}/><path d="M12 30h44" fill="none" ${o}/>`
      + `<path d="M34 30v14" fill="none" stroke="${INK}" stroke-width="2"/><rect x="29.5" y="43" width="9" height="8" rx="1.5" fill="#8a5a2e" ${o}/>`
      + `<path d="M8 50h52v14a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" fill="#aab0b8" ${o}/><path d="M8 57h52M22 50v7M40 50v7M30 57v12M48 57v12" fill="none" stroke="${INK}" stroke-width="1.6"/>`) },
    pond: { w: 116, h: 46, flat: true, big: true, html: svg(116, 46,
      `<path d="M10 24C8 10 34 4 60 5s48 4 47 20-24 18-50 17S12 38 10 24z" fill="#6f9a52" ${o}/>`
      + `<path d="M17 24c-1-9 20-13 42-12s40 3 39 13-20 12-41 11-39-3-40-12z" fill="#8cc9ee" stroke="${INK}" stroke-width="2"/>`
      + `<path d="M32 20c8-3 18-3 26-2M58 30c8 1 18 0 26-3" fill="none" stroke="#e3f4ff" stroke-width="2.5" stroke-linecap="round"/>`
      + `<ellipse cx="78" cy="19" rx="7" ry="3.5" fill="#5f9a3a" ${o}/>`) },
  };
  const artOf = kind => {
    const G = global.KWGround, m = G && G.manifest && G.manifest.props && G.manifest.props['decor_' + kind];
    if (m && m.file && m.w > 0 && m.h > 0) {
      const img = `<img src="${esc(G.BASE + m.file)}" class="kwh-img kwh-day" alt="" draggable="false" style="width:${m.w}px;height:${m.h}px">`
        + (m.lit ? `<img src="${esc(G.BASE + m.lit)}" class="kwh-img kwd-lit-img" alt="" draggable="false" loading="lazy" style="width:${m.w}px;height:${m.h}px">` : '');
      return { w: m.w, h: m.h, html: img, flat: !!(ART[kind] && ART[kind].flat), big: !!(ART[kind] && ART[kind].big), lamp: m.lamp || (ART[kind] && ART[kind].lamp) || null, picture: true };
    }
    return ART[kind] || null;
  };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  const costLine = cost => Object.entries(cost || {}).map(([r, v]) => `${v} ${r === 'metal' ? 'iron' : r}`).join(' + ');
  const canAfford = (cost, stock) => Object.entries(cost || {}).every(([r, v]) => (Number((stock || {})[r]) || 0) >= v);
  // Depth among the things that stand: a flat thing (the pond) sorts by its far edge.
  const depthOf = (yPct, art, layerH) => Math.max(1, Math.min(1000, Math.round((yPct - (art && art.flat ? (art.h / Math.max(1, layerH)) * 100 : 0)) * 10)));
  // The kinds whose automatic scatter steps aside. `list`: the town's decorations.
  const placedScatter = list => [...new Set((list || []).map(d => SCATTER[d.kind]).filter(Boolean))].sort();
  // Should lanterns be lit? Evening and night.
  const litAt = phase => phase === 'dusk' || phase === 'night';
  // The lamplighter's round: nearest first from where they stand, then each next nearest.
  function round(from, posts) {
    const left = posts.slice(), out = [];
    let at = from;
    while (left.length) {
      let best = 0;
      for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - at.x, left[i].y - at.y) < Math.hypot(left[best].x - at.x, left[best].y - at.y)) best = i;
      at = left.splice(best, 1)[0]; out.push(at);
    }
    return out;
  }
  // What the villagers make of the decorations in one part of Home (js/villager-engine.js).
  // `list`: the town's decorations; w × h: the scene in px. → { spots: [{ id, x, y, rest? }],
  // blocks: [{ l, r, t, b }] }. A bench is somewhere to sit; a flower bed, the well
  // and the pond are somewhere to stop; the well and the pond are walked round. Pure.
  function sceneParts(list, area, w, h, artFor) {
    const spots = [], blocks = [];
    for (const d of (list || []).filter(x => x.area === area)) {
      const a = (artFor || (k => ART[k]))(d.kind);
      if (!a) continue;
      const x = d.x / 100 * w, y = d.y / 100 * h;
      if (d.kind === 'bench') spots.push({ id: 'bench-' + d.id, x, y: y + 4, rest: true });
      else if (d.kind === 'flower_bed') spots.push({ id: 'flowers-' + d.id, x, y: y + 14 });
      else if (d.kind === 'well') { spots.push({ id: 'well-' + d.id, x, y: y + 22 }); blocks.push({ l: x - a.w / 2 - 8, r: x + a.w / 2 + 8, t: y - Math.max(10, a.h / 4) - 8, b: y + 6 }); }
      else if (d.kind === 'pond') { spots.push({ id: 'pond-' + d.id, x, y: y + 16 }); blocks.push({ l: x - a.w / 2 - 6, r: x + a.w / 2 + 6, t: y - a.h - 4, b: y + 4 }); }
    }
    return { spots, blocks };
  }
  function charmHtml(d) {
    const c = d && d.charm;
    if (!c || !c.score) return '';
    return `<span class="kwd-charm" title="${esc(c.line)}">🌷 charm ${Math.floor(c.score)}${c.bonus ? ` (+${c.bonus})` : ''}</span>`;
  }

  // ── Data ────────────────────────────────────────────────────────────────
  const signedIn = () => { try { return !!global.localStorage.getItem('kw_token'); } catch (_) { return false; } };
  const stock = () => { const g = global.gameData; return (g && g.settlement && g.settlement.resources) || {}; };
  function take(d) {
    const was = S.data ? placedScatter(S.data.decorations).join() : '';
    S.data = d;
    paint(true); palette();
    doc.querySelectorAll('.kwc-mood').forEach(m => { const old = m.querySelector('.kwd-charm'), html = charmHtml(d); if (old) old.outerHTML = html; else if (html) m.insertAdjacentHTML('beforeend', html); });
    // The villagers' places to stop and things to walk round changed (and the
    // automatic scenery of a kind may step aside or come back): look again.
    const sigNow = d.decorations.map(x => x.id + ':' + x.area + ':' + x.x + ':' + x.y).join();
    if ((was !== placedScatter(d.decorations).join() || S.partsSig !== sigNow) && global.KWCast && global.KWCast.resurvey) global.KWCast.resurvey();
    S.partsSig = sigNow;
    try { global.dispatchEvent(new global.CustomEvent('kw:decor', { detail: { charm: d.charm } })); } catch (_) { /* old browser */ }
  }
  async function load() {
    if (!signedIn() || typeof global.apiFetch !== 'function') return null;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      try { const r = await global.apiFetch('/api/decor'); if (r.ok) { const d = await r.json(); if (d && d.ok && d.decor) take(d.decor); } } catch (_) { /* later */ }
      S.loading = null;
      return S.data;
    })();
    return S.loading;
  }
  async function send(method, path, body) {
    if (S.busy) return null;
    S.busy = true;
    try {
      const r = await global.apiFetch('/api/decor' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { toast('⚠️ ' + (d.error || 'That did not work. Try again.')); load(); return null; }
      if (d.decor) take(d.decor);
      if (typeof global.refreshResources === 'function') { try { global.refreshResources(); } catch (_) { /* later */ } }
      return d;
    } catch (_) { toast('⚠️ That did not work. Try again.'); return null; } finally { S.busy = false; }
  }

  // ── The scene ───────────────────────────────────────────────────────────
  const view = () => doc.getElementById('settlement-view');
  const homeOpen = () => typeof global._svIsOpen === 'function' && global._svIsOpen();
  const building = () => typeof global._svIsBuildMode === 'function' && global._svIsBuildMode();
  const activeArea = () => (global._svActiveAreaName ? global._svActiveAreaName() : 'town');
  const layer = () => { const v = view(); return v ? v.querySelector('.sv-fg-layer:not(.sv-area-hidden)') : null; };
  const sig = (list, area, build) => area + '|' + (build ? 'b' : 'v') + '|' + (S.picked || '') + '|' + list.map(d => d.id + ':' + d.kind + ':' + d.x + ':' + d.y).join(',');
  function itemHtml(d, L, build) {
    const a = artOf(d.kind), k = S.data.kinds.find(x => x.key === d.kind) || { label: d.kind };
    if (!a) return '';
    const st = `left:${d.x}%;top:${d.y}%;width:${a.w}px;height:${a.h}px;z-index:${depthOf(d.y, a, L.clientHeight)}`;
    const cls = `kwd-item kwd-${esc(d.kind)}${a.picture ? ' kwd-picture' : ''}${a.flat ? ' kwd-flat' : ''}${S.lit && d.kind === 'lantern' ? ' kwd-lit' : ''}${S.picked === d.id ? ' kwd-picked' : ''}`;
    // A lantern's light is its own element, over the night's tint; the post keeps its depth.
    const glow = d.kind === 'lantern' && a.lamp && !build ? `<i class="kwd-glow${S.lit ? ' kwd-on' : ''}" data-kwd-glow="${d.id}" style="left:${d.x}%;top:${d.y}%;--kwd-dx:${a.lamp[0] - a.w / 2}px;--kwd-dy:${a.lamp[1] - a.h}px" aria-hidden="true"></i>` : '';
    return build
      ? `<button type="button" class="${cls}" style="${st}" data-kwd-id="${d.id}" aria-label="${esc(k.label)}: drag to move, or press to remove">${a.html}</button>`
      : `<span class="${cls}" style="${st}" data-kwd-id="${d.id}" aria-hidden="true">${a.html}</span>${glow}`;
  }
  function paint(force) {
    if (!doc || !S.data) return;
    const L = homeOpen() ? layer() : null;
    if (!L || !L.clientHeight) return;
    const area = activeArea(), build = building(), list = S.data.decorations.filter(d => d.area === area);
    const key = sig(list, area, build), mark = L.querySelector(':scope > .kwd-mark');
    if (!force && mark && mark.getAttribute('data-sig') === key) return;
    if (S.drag) return;   // not under the player's finger
    L.querySelectorAll(':scope > .kwd-item, :scope > .kwd-mark, :scope > .kwd-pop, :scope > .kwd-glow').forEach(e => e.remove());
    L.insertAdjacentHTML('beforeend', `<i class="kwd-mark" data-sig="${esc(key)}" hidden></i>` + list.map(d => itemHtml(d, L, build)).join('') + popHtml(list));
  }
  // The little bar over a picked decoration (Build mode).
  function popHtml(list) {
    const d = list.find(x => x.id === S.picked);
    if (!d || !building()) return '';
    const k = S.data.kinds.find(x => x.key === d.kind) || { label: d.kind, refund: {} }, a = artOf(d.kind) || { h: 40 };
    const back = costLine(k.refund);
    return `<div class="kwd-pop" style="left:${d.x}%;top:${d.y}%;--kwd-h:${a.h}px" role="group" aria-label="${esc(k.label)}">`
      + `<b>${esc(k.label)}</b><button type="button" data-kwd-remove="${d.id}">Remove${back ? ` (${esc(back)} back)` : ''}</button></div>`;
  }

  // ── Build mode: the bar ─────────────────────────────────────────────────
  function palette() {
    const v = view();
    if (!v) return;
    let bar = v.querySelector(':scope > .kwd-palette');
    if (!building() || !S.data) { if (bar) bar.remove(); v.classList.remove('kwd-placing'); S.placing = null; return; }
    if (!bar) { bar = doc.createElement('div'); bar.className = 'kwd-palette'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Decorate'); v.appendChild(bar); }
    const st = stock(), full = S.data.decorations.length >= S.data.max, c = S.data.charm;
    const html = `<div class="kwd-pal-row"><span class="kwd-pal-title">Decorate</span>`
      + S.data.kinds.map(k => {
        const why = full ? `The town has all ${S.data.max} decorations it can hold` : k.have >= k.max ? `A town can have ${k.max}` : !canAfford(k.cost, st) ? `Costs ${costLine(k.cost)}` : '';
        return `<button type="button" class="kwd-pal-btn${S.placing === k.key ? ' kwd-on' : ''}" data-kwd-kind="${esc(k.key)}" aria-pressed="${S.placing === k.key}"${why ? ` aria-disabled="true" title="${esc(why)}"` : ` title="${esc(k.label)}: +${k.next_charm} charm"`}>`
          + `<span class="kwd-pal-art">${(artOf(k.key) || {}).html || esc(k.icon)}</span><b>${esc(k.label)}</b><small>${esc(costLine(k.cost))}</small></button>`;
      }).join('') + `</div>`
      + `<div class="kwd-pal-foot" role="status">${S.placing ? `Tap the ground to place it. Tap ${esc((S.data.kinds.find(k => k.key === S.placing) || {}).label || 'it')} again, or press Esc, to stop.` : esc(c ? c.line : '')}</div>`;
    if (bar.innerHTML !== html) bar.innerHTML = html;
    // A build panel (a plot's choices, a building's panel) uses the same strip of the screen: the bar steps aside for it.
    const panel = v.querySelector('#sv-build-panel.open');
    bar.hidden = !!panel;
    if (panel && S.placing) { S.placing = null; v.classList.remove('kwd-placing'); }
    // The view is a little bigger than the window on some screens: keep the bar inside what shows.
    const r = v.getBoundingClientRect(), under = Math.max(0, Math.round(r.bottom - global.innerHeight)), side = Math.max(0, Math.round(-r.left));
    bar.style.setProperty('--kwd-under', under + 'px'); bar.style.setProperty('--kwd-side', side + 'px');
    v.classList.toggle('kwd-placing', !!S.placing);
  }
  function choose(kind) {
    const k = S.data && S.data.kinds.find(x => x.key === kind);
    if (!k) return;
    if (S.placing === kind) { S.placing = null; palette(); return; }
    if (S.data.decorations.length >= S.data.max) return toast(`⚠️ The town has all ${S.data.max} decorations it can hold. Remove one first.`);
    if (k.have >= k.max) return toast(`⚠️ A town can have ${k.max} of those.`);
    if (!canAfford(k.cost, stock())) return toast(`⚠️ A ${k.label.toLowerCase()} costs ${costLine(k.cost)}.`);
    S.placing = kind; S.picked = null; paint(true); palette();
  }
  // A point on screen → percent of the active layer, kept on the ground.
  function pointAt(clientX, clientY) {
    const L = layer();
    if (!L) return null;
    const r = L.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    let p = { x: (clientX - r.left) / r.width * 100, y: (clientY - r.top) / r.height * 100 };
    const C = global.KWCast;
    if (C && C._onGround) p = C._onGround(activeArea(), p.x, p.y);
    return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
  }

  if (doc) {
    // Placing: a tap on open ground. (A drag that panned is not a tap.)
    doc.addEventListener('pointerdown', e => { S.down = { x: e.clientX, y: e.clientY }; }, true);
    doc.addEventListener('click', e => {
      const t = e.target;
      const pick = t.closest && t.closest('[data-kwd-kind]');
      if (pick) { e.preventDefault(); if (pick.getAttribute('aria-disabled') === 'true') toast('⚠️ ' + pick.title + '.'); else choose(pick.getAttribute('data-kwd-kind')); return; }
      const rm = t.closest && t.closest('[data-kwd-remove]');
      if (rm) { e.preventDefault(); e.stopPropagation(); const id = Number(rm.getAttribute('data-kwd-remove')); S.picked = null; send('DELETE', '/' + id).then(d => { if (d && d.refund) toast(`Removed. ${costLine(d.refund) ? costLine(d.refund) + ' back.' : ''}`); }); return; }
      if (!building() || !S.data) return;
      const sc = doc.getElementById('sv-scene');
      if (!sc || !sc.contains(t) || t.closest('.sv-slot, .kwd-item, .kwd-pop, .sv-build-panel')) return;
      if (S.down && Math.hypot(e.clientX - S.down.x, e.clientY - S.down.y) > 8) return;
      if (S.placing) {
        const p = pointAt(e.clientX, e.clientY);
        if (!p) return;
        e.stopPropagation();
        send('POST', '', { kind: S.placing, area: activeArea(), x: p.x, y: p.y }).then(d => {
          const k = d && S.data.kinds.find(x => x.key === S.placing);
          if (k && (k.have >= k.max || S.data.decorations.length >= S.data.max || !canAfford(k.cost, stock()))) S.placing = null;   // no more of these: stop
          palette();
        });
      } else if (S.picked != null) { S.picked = null; paint(true); }
    }, true);
    doc.addEventListener('keydown', e => { if (e.key === 'Escape' && (S.placing || S.picked != null) && building()) { S.placing = null; S.picked = null; paint(true); palette(); e.stopPropagation(); } }, true);

    // Moving: drag a decoration (Build mode). A press without a drag picks it.
    doc.addEventListener('pointerdown', e => {
      const it = e.target.closest && e.target.closest('button.kwd-item');
      if (!it || !building() || e.button > 0) return;
      e.stopPropagation();   // the scene does not pan from here
      S.drag = { id: Number(it.getAttribute('data-kwd-id')), el: it, x: e.clientX, y: e.clientY, moved: false, pid: e.pointerId };
      try { it.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    }, true);
    doc.addEventListener('pointermove', e => {
      const g = S.drag;
      if (!g || e.pointerId !== g.pid) return;
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return;
      g.moved = true; g.el.classList.add('kwd-dragging');
      const p = pointAt(e.clientX, e.clientY + g.el.offsetHeight / 2);
      if (p) { g.p = p; g.el.style.left = p.x + '%'; g.el.style.top = p.y + '%'; }
    }, true);
    const drop = e => {
      const g = S.drag;
      if (!g || (e && e.pointerId !== g.pid)) return;
      S.drag = null;
      g.el.classList.remove('kwd-dragging');
      if (g.moved && g.p && (!e || e.type !== 'pointercancel')) send('POST', '/' + g.id + '/move', { area: activeArea(), x: g.p.x, y: g.p.y }).then(d => { if (!d) paint(true); });
      else if (!g.moved) { S.picked = S.picked === g.id ? null : g.id; S.placing = null; paint(true); palette(); }
      else paint(true);
    };
    doc.addEventListener('pointerup', drop, true);
    doc.addEventListener('pointercancel', drop, true);

    S.timer = setInterval(() => { if (homeOpen() && !doc.hidden) { paint(false); palette(); lamps(); } }, PAINT_MS);
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) { load(); setTimeout(() => paint(true), 80); } else { S.placing = null; S.picked = null; } });
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(load, 1700)); else setTimeout(load, 1700);
  }

  // ── The lamplighter ─────────────────────────────────────────────────────
  // Lanterns are lit through the evening and the night. When evening falls
  // while the player is watching, someone walks round and lights each in turn.
  function setLit(el, on) {
    if (!el) return;
    el.classList.toggle('kwd-lit', !!on);
    const g = el.parentNode && el.parentNode.querySelector(':scope > .kwd-glow[data-kwd-glow="' + el.getAttribute('data-kwd-id') + '"]');
    if (g) g.classList.toggle('kwd-on', !!on);
  }
  function lamps() {
    const C = global.KWCast, ph = (C && C.phase) || 'day', L = layer();
    if (!L) return;
    const want = litAt(ph), was = S.phase;
    S.phase = ph;
    const posts = [...L.querySelectorAll(':scope > .kwd-lantern')];
    if (S.lighting) return;
    if (want && was && !litAt(was) && posts.length && !building()) {   // evening has just fallen
      const W = L.clientWidth, H = L.clientHeight;
      const pts = posts.map(el => ({ el, x: parseFloat(el.style.left) / 100 * W, y: parseFloat(el.style.top) / 100 * H }));
      const steps = [], order = round({ x: W / 2, y: H * 0.85 }, pts);
      for (const p of order) { steps.push({ to: { x: p.x + 16, y: p.y + 4 } }); steps.push({ wait: 650, say: '🔥', run: () => setLit(p.el, true) }); steps.push({ wait: 250, say: null }); }
      const who = C && C.playScript ? C.playScript('lamplighter', steps, c => c.stage === 'elder' || !!c.elder) : null;
      S.lit = true;
      if (who == null) { posts.forEach((el, i) => setTimeout(() => setLit(el, true), 400 + i * 350)); return; }   // nobody about: they come on by themselves
      S.lighting = true;
      // However the round goes (the villager is called away, the scene is redrawn), every post ends up lit.
      setTimeout(() => { S.lighting = false; const now = layer(); if (now && litAt(S.phase)) now.querySelectorAll(':scope > .kwd-lantern').forEach(el => setLit(el, true)); }, Math.min(90000, 6000 + order.length * 9000));
      return;
    }
    S.lit = want;
    posts.forEach(el => setLit(el, want));
  }

  global.KWDecor = {
    load, ART,
    get data() { return S.data; },
    get placing() { return S.placing; },
    charmHtml: () => charmHtml(S.data),
    // js/home-ground.js: the kinds of automatic scenery to leave out.
    placedKinds: () => placedScatter(S.data && S.data.decorations),
    // js/villager-engine.js: places to stop and things to walk round, in this part of Home.
    sceneParts: (area, w, h) => sceneParts(S.data && S.data.decorations, area, w, h, artOf),
    // js/settlement-view.js: Build mode was switched on or off.
    buildModeChanged() { S.placing = null; S.picked = null; paint(true); palette(); },
    onEvent: () => load(),   // changed on another device (js/realtime.js)
    _costLine: costLine, _canAfford: canAfford, _depthOf: depthOf, _placedScatter: placedScatter, _litAt: litAt, _round: round, _charmHtml: charmHtml, _sceneParts: sceneParts, _paint: paint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
