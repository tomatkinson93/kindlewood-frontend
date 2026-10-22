// ══════════════════════════════════════════════════════════════════════════
//  KWTravelLayer — citizen travel paths on the world map (uifx canvas)
//
//  Treasure-map style: a dashed ink trail marching toward an inked ✕, faint
//  footprints behind the traveller, and the traveller themself — their
//  species on a little parchment token — walking along at the real pace.
//  Out-and-back journeys turn round at the ✕ and walk home. Caravans coming
//  TO you are drawn in green.
//
//  Data: window.KWTravel (js/travel.js). Called once per frame from
//  KWMap.controller.renderFrame, after the uifx strokes and before the
//  nameplates. Works in both views through the renderer's projectAxial().
//
//  Proof rules (MAP_RENDERER.md): no network calls and no unseeded randomness in kwmap-*
//  files, and with the layer off or nobody travelling, draw() returns
//  without touching the context so the golden draw logs are unchanged.
//
//  Hover a traveller → a details card; click → the card pins, with buttons
//  to open the matching panel. Clicks on a traveller don't select the tile
//  underneath.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const MAX_DRAWN = 30;
  const INK = '#4a2f17', INK_IN = '#2f6b2c', X_INK = '#9a2f1c';
  const KIND_LABEL = { market: 'Merchant', scout: 'Scout', envoy: 'Envoy', quest: 'Quest', clan_quest: 'Clan quest' };

  let _hits = [];        // this frame's travellers: { x, y, r, j }
  let _hoverId = null;
  let _pinned = null;    // journey id whose card is pinned
  const _pathCache = new Map();
  const _img = {};

  function hash32(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // Resource cargo badges use the game's icon images (newer emoji like 🪵
  // don't draw on Windows 10).
  const RES_SRC = { food: '/assets/foodicon.png', timber: '/assets/woodicon.png', stone: '/assets/stoneicon.png',
                    metal: '/assets/metalicon.png', wealth: '/assets/goldicon.png' };
  function resImg(res) {
    if (!RES_SRC[res] || typeof Image === 'undefined') return null;
    const k = 'res:' + res;
    if (!(k in _img)) {
      const im = new Image();
      im.onerror = () => { _img[k] = null; };
      im.src = RES_SRC[res];
      _img[k] = im;
    }
    const im = _img[k];
    return im && im.complete && im.naturalWidth ? im : null;
  }

  function speciesImg(species) {
    if (!species || typeof Image === 'undefined') return null;
    const k = String(species).toLowerCase();
    if (!(k in _img)) {
      const im = new Image();
      im.onerror = () => { _img[k] = null; };
      im.src = '/assets/images/species/' + k + '.png';
      _img[k] = im;
    }
    const im = _img[k];
    return im && im.complete && im.naturalWidth ? im : null;
  }

  // Unwrapped hex steps for a journey (cached per endpoints + map size).
  function steps(j, T) {
    const W = typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40, H = typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40;
    const key = `${j.from.q},${j.from.r}>${j.to.q},${j.to.r}@${W}x${H}`;
    let s = _pathCache.get(key);
    if (!s) { s = T.hexLine(j.from, j.to, W, H); _pathCache.set(key, s); }
    return s;
  }

  // Chaikin corner-cutting: turns the hex zig-zag into a hand-drawn curve.
  function smooth(pts, rounds) {
    let p = pts;
    for (let k = 0; k < rounds && p.length > 2; k++) {
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }

  // Screen points for a journey: the wrapped copy whose midpoint is nearest
  // the screen centre, so an edge-crossing path is drawn once, continuously.
  function screenPath(j, T, renderer, cam, W, H) {
    const st = steps(j, T);
    const MW = typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40, MH = typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40;
    const mid = st[Math.floor(st.length / 2)];
    let best = null, bestD = Infinity;
    for (let kq = -1; kq <= 1; kq++) for (let kr = -1; kr <= 1; kr++) {
      const oq = j.from.q + kq * MW, or = j.from.r + kr * MH;
      const m = renderer.projectAxial(oq + mid.dq, or + mid.dr, cam, W, H);
      const d = (m.x - W / 2) ** 2 + (m.y - H / 2) ** 2;
      if (d < bestD) { bestD = d; best = { oq, or }; }
    }
    let hexW = 48;
    const raw = st.map(s => { const p = renderer.projectAxial(best.oq + s.dq, best.or + s.dr, cam, W, H); hexW = p.hexW || hexW; return { x: p.x, y: p.y }; });
    if (raw.length === 1) raw.push({ x: raw[0].x + 0.01, y: raw[0].y });
    return { pts: smooth(raw, 2), hexW };
  }

  // Splits a polyline at fraction f of its length → [before, after, point].
  function splitAt(pts, f) {
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
    let want = total * f;
    for (let i = 1; i < pts.length; i++) {
      if (want <= seg[i - 1] || i === pts.length - 1) {
        const k = seg[i - 1] ? Math.min(1, want / seg[i - 1]) : 0;
        const p = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k };
        return [pts.slice(0, i).concat([p]), [p].concat(pts.slice(i)), p];
      }
      want -= seg[i - 1];
    }
    return [pts, [pts[pts.length - 1]], pts[pts.length - 1]];
  }

  function polyline(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  function drawX(ctx, p, s, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(244,226,180,0.85)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s); ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawWalker(ctx, p, j, ink, bob, hovered) {
    const r = hovered ? 15 : 13;
    const y = p.y - 6 + bob;
    ctx.save();
    // Shadow on the ground, then the parchment token.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, r * 0.8, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3e2b8';
    ctx.strokeStyle = ink; ctx.lineWidth = hovered ? 2.5 : 2;
    ctx.beginPath(); ctx.arc(p.x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const im = speciesImg(j.citizen && j.citizen.species);
    if (im) ctx.drawImage(im, p.x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
    else {
      ctx.font = `${Math.round(r * 1.05)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(j.icon || '🐾', p.x, y + 1);
    }
    // Cargo badge (caravans) or kind badge.
    const badge = j.cargo ? j.cargo.icon : j.icon;
    if (badge) {
      const bx = p.x + r * 0.8, by = y - r * 0.8;
      ctx.fillStyle = '#2a1d10'; ctx.strokeStyle = '#e8c87a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx, by, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const ri = j.cargo && j.cargo.resource && !j.cargo.item ? resImg(j.cargo.resource) : null;
      if (ri) ctx.drawImage(ri, bx - 5.5, by - 5.5, 11, 11);
      else {
        ctx.font = '9px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(badge, bx, by + 0.5);
      }
    }
    ctx.restore();
    return { x: p.x, y, r: r + 3, ax: Math.round(p.x), ay: Math.round(p.y - 6 - r) };
  }

  function draw(ctx, W, H, renderer, cam, frameNow) {
    _hits = [];
    const T = global.KWTravel;
    if (!ctx || !T || !T.enabled() || !renderer || typeof renderer.projectAxial !== 'function') return;
    const list = T.journeys();
    if (!list.length) return;
    const t = T.now();
    const anim = typeof frameNow === 'number' ? frameNow : t;
    const margin = 60;

    let drawn = 0;
    for (const j of list) {
      if (drawn >= MAX_DRAWN) break;
      if (!j.from || !j.to) continue;
      const ph = T.phase(j, t);
      if (ph.leg === 'done') continue;
      const sp = screenPath(j, T, renderer, cam, W, H);
      let pts = sp.pts;
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      if (Math.max(...xs) < -margin || Math.min(...xs) > W + margin || Math.max(...ys) < -margin || Math.min(...ys) > H + margin) continue;
      drawn++;
      // Back leg: walk the same road in reverse; the ✕ is home.
      if (ph.leg === 'back') pts = pts.slice().reverse();
      const [behind, ahead, at] = splitAt(pts, ph.p);
      const ink = j.incoming ? INK_IN : INK;
      const seed = hash32(j.id);
      const scale = Math.max(0.7, Math.min(1.4, sp.hexW / 48));

      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // Parchment halo under the whole road so it reads on any terrain.
      ctx.strokeStyle = 'rgba(244,226,180,0.5)'; ctx.lineWidth = 7 * scale;
      polyline(ctx, pts); ctx.stroke();
      // Footprints behind the traveller.
      if (behind.length > 1) {
        ctx.setLineDash([0.5, 7 * scale]); ctx.strokeStyle = ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 3 * scale;
        polyline(ctx, behind); ctx.stroke();
      }
      // Marching dashes ahead, toward the ✕.
      if (ahead.length > 1) {
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([8 * scale, 6 * scale]);
        ctx.lineDashOffset = -((anim / 45 + (seed % 14)) % (14 * scale));
        ctx.strokeStyle = ink; ctx.lineWidth = 2.6 * scale;
        polyline(ctx, ahead); ctx.stroke();
      }
      ctx.restore();

      // ✕ marks the spot: pulses in the last minute of the leg.
      const left = T.secondsLeft(j, t);
      const pulse = left < 60 ? 1 + 0.18 * Math.sin(anim / 160) : 1;
      drawX(ctx, pts[pts.length - 1], 7 * scale * pulse, X_INK, 0.95);

      const bob = Math.sin(anim / 170 + (seed % 628) / 100) * 1.6;
      const hit = drawWalker(ctx, at, j, ink, bob, j.id === _hoverId || j.id === _pinned);
      _hits.push({ ...hit, j });
    }
    if (_pinned || _hoverId) updateCard();
  }

  function hitAt(px, py) {
    for (let i = _hits.length - 1; i >= 0; i--) {
      const h = _hits[i];
      if ((px - h.x) ** 2 + (py - h.y) ** 2 <= h.r * h.r) return h;
    }
    return null;
  }

  // ── Details card (DOM) ─────────────────────────────────────────────────
  let _card = null, _cardAt = null, _cardSig = '';
  function cardEl() {
    if (_card) return _card;
    _card = document.createElement('div');
    _card.className = 'kwt-card';
    _card.setAttribute('role', 'dialog');
    _card.addEventListener('click', onCardClick);
    document.body.appendChild(_card);
    return _card;
  }
  function fmtDur(s) {
    if (s < 60) return s + 's';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}h ${m}m` : `${m}m${r ? ' ' + r + 's' : ''}`;
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const OPEN_LABEL = { market: '⚖️ Open Market', quests: '📜 Open Quests', clan: '🛡️ Open Clan' };

  // Live bits (refreshed every frame without rebuilding the card, so its
  // buttons stay put): leg label, progress, time left.
  function liveBits(j) {
    const T = global.KWTravel, t = T.now(), ph = T.phase(j, t);
    const left = T.secondsLeft(j, t);
    return {
      leg: ph.leg,
      legLabel: j.returns_at ? (ph.leg === 'back' ? 'Heading home' : 'Outbound') : '',
      pct: Math.round(ph.p * 100),
      when: ph.leg === 'back' ? `Home in ${fmtDur(left)}` : `Arrives in ${fmtDur(left)}`,
    };
  }

  function cardHtml(j, pinned) {
    const b = liveBits(j);
    const legLabel = b.legLabel, pct = b.pct, when = b.when;
    return `
      <div class="kwt-head"><span class="kwt-icon">${esc(j.icon || '🐾')}</span>
        <div><div class="kwt-name">${esc(j.citizen && j.citizen.name)}</div>
        <div class="kwt-kind">${esc(KIND_LABEL[j.kind] || 'Traveller')}<span class="kwt-leg">${legLabel ? ' · ' + legLabel : ''}</span>${j.incoming ? ' · coming to you' : ''}</div></div>
        ${pinned ? '<button type="button" class="kwt-x" data-kwt="close" aria-label="Close">✕</button>' : ''}</div>
      <div class="kwt-title">${esc(j.title)}</div>
      ${j.detail ? `<div class="kwt-detail">${esc(j.detail)}</div>` : ''}
      <div class="kwt-bar"><div class="kwt-fill" style="width:${pct}%"></div></div>
      <div class="kwt-when">${when}</div>
      ${pinned ? `<div class="kwt-acts">
        <button type="button" data-kwt="goto">📍 Show destination</button>
        ${OPEN_LABEL[j.open] ? `<button type="button" data-kwt="open">${OPEN_LABEL[j.open]}</button>` : ''}
      </div>` : '<div class="kwt-hint">Click for more</div>'}`;
  }

  function currentJourney() {
    const id = _pinned || _hoverId;
    const T = global.KWTravel;
    return id && T ? T.journeys().find(j => j.id === id) || null : null;
  }

  function updateCard() {
    const j = currentJourney();
    if (!j) { hideCard(); return; }
    const el = cardEl();
    // Build the card once per traveller / pinned state; after that only the
    // live text and bar change, so its buttons are never replaced mid-click.
    const sig = j.id + (_pinned ? ':pinned' : '');
    if (sig !== _cardSig) { el.innerHTML = cardHtml(j, !!_pinned); _cardSig = sig; }
    else {
      const b = liveBits(j);
      const set = (sel, v, prop) => { const n = el.querySelector(sel); if (n && n[prop || 'textContent'] !== v) n[prop || 'textContent'] = v; };
      set('.kwt-leg', b.legLabel ? ' · ' + b.legLabel : '');
      set('.kwt-when', b.when);
      const f = el.querySelector('.kwt-fill');
      if (f && f.style.width !== b.pct + '%') f.style.width = b.pct + '%';
    }
    el.classList.add('open');
    const h = _hits.find(x => x.j.id === j.id);
    const canvas = document.getElementById('map-canvas');
    if (h && canvas) {
      const r = canvas.getBoundingClientRect();
      _cardAt = { x: Math.round(r.left + h.ax), y: Math.round(r.top + h.ay) };
    }
    if (_cardAt) {
      const w = el.offsetWidth || 240, hh = el.offsetHeight || 120;
      const vw = global.innerWidth || 1024, vh = global.innerHeight || 768;
      // Stay inside the map area (the top bars overlay the page above it).
      const cr = canvas ? canvas.getBoundingClientRect() : { top: 0 };
      const minTop = Math.max(8, cr.top + 6);
      let left = Math.max(8, Math.min(_cardAt.x - w / 2, vw - w - 8));
      let top = _cardAt.y - hh - 10;
      if (top < minTop) top = Math.min(vh - hh - 8, _cardAt.y + 40);
      left = Math.round(left); top = Math.round(top);
      if (el.style.left !== left + 'px') el.style.left = left + 'px';
      if (el.style.top !== top + 'px') el.style.top = top + 'px';
    }
  }

  function hideCard() {
    _pinned = null; _hoverId = null; _cardSig = '';
    if (_card) _card.classList.remove('open');
  }

  function onCardClick(e) {
    const b = e.target.closest && e.target.closest('[data-kwt]');
    if (!b) return;
    const j = currentJourney();
    const act = b.dataset.kwt;
    if (act === 'close' || !j) return hideCard();
    if (act === 'goto') {
      const ph = global.KWTravel.phase(j, global.KWTravel.now());
      const dest = ph.leg === 'back' ? j.from : j.to;
      const KW = global.KWMap;
      const cam = KW && KW.controller && KW.controller.camera;
      if (cam) { cam.q = dest.q; cam.r = dest.r; KW.controller.requestRender(); }
      return;
    }
    if (act === 'open') {
      hideCard();
      if (j.open === 'market' && typeof global.openMarket === 'function') global.openMarket({ tab: 'caravans' });
      else if (j.open === 'quests' && typeof global.openQuestsModal === 'function') global.openQuestsModal();
      else if (j.open === 'clan' && typeof global.openClanPanel === 'function') global.openClanPanel();
    }
  }

  // ── Interaction (mirrors kwmap-nameplates.js) ─────────────────────────
  function canvasXY(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function wire() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas || canvas._kwTravel) return !!canvas;
    canvas._kwTravel = true;
    let down = null;
    canvas.addEventListener('mousedown', e => { down = { x: e.clientX, y: e.clientY }; }, true);
    canvas.addEventListener('mousemove', e => {
      if (e.buttons) return;
      if (_hoverId && canvas.style.cursor !== 'pointer') canvas.style.cursor = 'pointer';
      const h = hitAt(...canvasXY(canvas, e));
      const id = h ? h.j.id : null;
      if (id !== _hoverId) {
        _hoverId = id;
        if (id) canvas.style.cursor = 'pointer';
        else if (canvas.style.cursor === 'pointer') canvas.style.cursor = 'grab';
        if (!_pinned) { if (id) updateCard(); else if (_card) { _card.classList.remove('open'); _cardSig = ''; } }
        const KW = global.KWMap;
        if (KW && KW.controller) KW.controller.requestRender();
      }
    });
    canvas.addEventListener('mouseleave', () => { _hoverId = null; if (!_pinned && _card) { _card.classList.remove('open'); _cardSig = ''; } });
    // Capture phase on the document: runs before the canvas's own capture
    // listeners (nameplates, tile select), so a click on a traveller pins its
    // card instead of selecting what's beneath. Drags are left alone.
    document.addEventListener('click', e => {
      if (e.target !== canvas) { return; }
      if (down && (Math.abs(e.clientX - down.x) > 5 || Math.abs(e.clientY - down.y) > 5)) { down = null; return; }
      down = null;
      const h = hitAt(...canvasXY(canvas, e));
      if (!h) { if (_pinned) hideCard(); return; }
      e.stopImmediatePropagation();
      e.preventDefault();
      _pinned = h.j.id; _hoverId = h.j.id; _cardSig = '';
      updateCard();
    }, true);
    // Clicks elsewhere (outside the card) unpin it.
    document.addEventListener('click', e => {
      if (_pinned && e.target !== canvas && _card && !_card.contains(e.target)) hideCard();
    });
    // Touch: a tap on a traveller pins its card too.
    canvas.addEventListener('touchend', e => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const h = hitAt(...canvasXY(canvas, t));
      if (!h) return;
      e.preventDefault();
      _pinned = h.j.id; _hoverId = h.j.id; _cardSig = '';
      updateCard();
    }, { passive: false });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && _pinned) hideCard(); });
    return true;
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    const tryWire = () => { if (!wire()) setTimeout(tryWire, 500); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryWire); else tryWire();
  }

  global.KWTravelLayer = { draw, hitAt, hideCard, _hits: () => _hits, _splitAt: splitAt };
})(window);
