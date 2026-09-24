// ══════════════════════════════════════════════════════════════════════════
//  KWMap NAMEPLATES — Civ-style settlement name banners over the map
//
//  Drawn on the uifx canvas every frame (above terrain, trees and weather),
//  so they stay crisp and are never hidden by map content:
//    • a name plate: tier badge (★ on your own settlement) + name, edged in
//      the relationship colour (yours / clanmate / other player / NPC /
//      hostile / kingdom)
//    • above it, when the owner is in a clan, a clan tag in the clan's
//      banner colours with its emblem
//
//  Positions come from the active renderer's labelAnchor(wq, wr, cam, W, H)
//  → { x, y, hexW } (settlement footing on screen) and are cached until the
//  camera, viewport, renderer or map data change.
//
//  Interactive: hovering a plate lifts and enlarges it (eased over ~120ms);
//  clicking or tapping it selects the settlement's tile exactly like
//  clicking the tile. Each frame records the plates' screen rects; the map
//  canvas's click is intercepted (capture phase) only when a plate is hit.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const TIER_ICON = { camp: '⛺', village: '🏡', town: '🏘️', city: '🏰' };
  const EDGE = {
    own: '#e8c76a', clan: null /* clan primary */, player: '#b9a88a',
    npc: '#6fbf8f', hostile: '#c0463a', kingdom: '#e8c24a',
  };
  const FONT = '"Playfair Display", Georgia, serif';

  function kindOf(s) {
    const type = s.settlement_type || (s.is_kingdom ? 'kingdom' : s.disposition === 'hostile' ? 'hostile' : (s.npc_id ? 'npc' : 'player'));
    if (type === 'player') return s.isOwn ? 'own' : (s.clan && s.clan.mine ? 'clan' : 'player');
    return type;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function withSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

  function drawPlate(ctx, x, y, s, k) {
    k = k || 0;
    const kind = kindOf(s);
    const edge = kind === 'clan' ? (s.clan.primary || EDGE.player) : EDGE[kind] || EDGE.player;
    const name = String(s.name || 'Settlement').toUpperCase();

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `700 11px ${FONT}`;
    withSpacing(ctx, 1);
    const tw = ctx.measureText(name).width;
    const H = 20, badgeR = 13, padL = badgeR + 8, padR = 10;
    const W = padL + tw + padR;
    const left = x - W / 2 + badgeR / 2, top = y - H;

    // Hover: lift and grow around the plate's centre.
    if (k > 0) {
      const sc = 1 + 0.08 * k, px = left + W / 2, py = top + H / 2;
      ctx.translate(px, py - 3 * k); ctx.scale(sc, sc); ctx.translate(-px, -py);
    }

    // Plate
    ctx.shadowColor = k > 0 ? `rgba(244,201,93,${0.55 * k})` : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6 + 8 * k; ctx.shadowOffsetY = 2;
    roundRect(ctx, left, top, W, H, H / 2);
    const g = ctx.createLinearGradient(0, top, 0, top + H);
    g.addColorStop(0, 'rgba(46,33,20,0.94)'); g.addColorStop(1, 'rgba(24,17,10,0.94)');
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5 + k; ctx.strokeStyle = edge; ctx.stroke();

    // Name
    ctx.fillStyle = '#f4e6c4';
    ctx.textAlign = 'left';
    ctx.fillText(name, left + padL, top + H / 2 + 0.5);

    // Tier badge (left disc), star for your own settlement
    const bx = left + 2, by = top + H / 2;
    ctx.beginPath(); ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(bx - 3, by - 4, 1, bx, by, badgeR);
    bg.addColorStop(0, '#4a3722'); bg.addColorStop(1, '#231810');
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.stroke();
    ctx.textAlign = 'center';
    withSpacing(ctx, 0);
    if (kind === 'own') {
      ctx.font = `700 15px ${FONT}`; ctx.fillStyle = '#f4c95d';
      ctx.fillText('★', bx, by + 1);
    } else {
      const icon = kind === 'hostile' ? '💀' : kind === 'kingdom' ? '👑' : (TIER_ICON[s.tier] || '🏘️');
      ctx.font = `13px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillText(icon, bx, by + 1);
    }

    // Clan tag above the plate
    if (s.clan && s.clan.name) {
      const label = `${s.clan.glyph || ''} ${s.clan.name}`.trim();
      ctx.font = `600 10px ${FONT}`;
      withSpacing(ctx, 0.5);
      const cw = ctx.measureText(label).width + 16, ch = 15;
      const cx0 = left + W / 2 - cw / 2 + badgeR / 4, cy0 = top - ch + 1;
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
      roundRect(ctx, cx0, cy0, cw, ch, 4);
      ctx.fillStyle = s.clan.primary || '#5b646c'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1.5; ctx.strokeStyle = s.clan.secondary || '#c9a14a'; ctx.stroke();
      ctx.fillStyle = '#fffaf0';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 2;
      ctx.fillText(label, cx0 + cw / 2, cy0 + ch / 2 + 0.5);
    }
    ctx.restore();
    // Hit rect (un-scaled footprint incl. badge and clan tag, a little slack).
    const tagH = s.clan && s.clan.name ? 15 : 0;
    return { x0: left - badgeR - 2, y0: top - tagH - 3 * k - 2, x1: left + W + 2, y1: top + H + 2 };
  }

  // ── Position cache ─────────────────────────────────────────────────────
  let _key = '', _anchors = [];
  function anchors(renderer, cam, W, H, data) {
    const key = [renderer.id, cam.q, cam.r, W, H, data.tiles.length, data._npVersion || 0].join('|');
    if (key === _key && _anchors._data === data) return _anchors;
    const out = [];
    for (const t of data.tiles) {
      const s = t && t.settlement;
      if (!s || s.is_kingdom_annex || t.terrain === 'fog') continue;
      const a = renderer.labelAnchor(t.q, t.r, cam, W, H);
      if (!a) continue;
      const lift = global.KWSettlements ? global.KWSettlements.heightAbove(t, a.hexW) : a.hexW * 0.5;
      out.push({ t, x: a.x, y: a.y - lift - 2 });
    }
    // Draw back-to-front so nearer plates overlap farther ones.
    out.sort((p, q) => p.y - q.y);
    out._data = data;
    _key = key; _anchors = out;
    return out;
  }

  // ── Interaction ────────────────────────────────────────────────────────
  let _hits = [];            // this frame's plates, back-to-front: { x0,y0,x1,y1, t }
  let _hoverKey = null;      // "q,r" of the hovered plate
  const _k = new Map();      // "q,r" → eased hover progress 0..1
  let _lastTs = 0;

  function hitAt(px, py) {
    for (let i = _hits.length - 1; i >= 0; i--) {     // topmost first
      const h = _hits[i];
      if (px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) return h;
    }
    return null;
  }

  function draw(ctx, W, H, renderer, cam) {
    const data = typeof worldMapData !== 'undefined' ? worldMapData : null;
    _hits = [];
    if (!ctx || !renderer || typeof renderer.labelAnchor !== 'function' || !data || !data.tiles) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = _lastTs ? Math.min(100, now - _lastTs) : 16;
    _lastTs = now;
    let hovered = null;
    for (const a of anchors(renderer, cam, W, H, data)) {
      if (a.x < -120 || a.x > W + 120 || a.y < -40 || a.y > H + 40) continue;
      const key = a.t.q + ',' + a.t.r;
      // Ease toward 1 while hovered, back to 0 otherwise (~120ms).
      const target = key === _hoverKey ? 1 : 0;
      let k = _k.get(key) || 0;
      k += Math.sign(target - k) * Math.min(Math.abs(target - k), dt / 120);
      if (k > 0) _k.set(key, k); else _k.delete(key);
      if (key === _hoverKey) { hovered = { a, k }; continue; }   // drawn last, on top
      const r = drawPlate(ctx, a.x, a.y, a.t.settlement, k);
      _hits.push({ ...r, t: a.t, key });
    }
    if (hovered) {
      const r = drawPlate(ctx, hovered.a.x, hovered.a.y, hovered.a.t.settlement, hovered.k);
      _hits.push({ ...r, t: hovered.a.t, key: hovered.a.t.q + ',' + hovered.a.t.r });
    }
  }

  function canvasXY(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function wire() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas || canvas._kwNameplates) return !!canvas;
    canvas._kwNameplates = true;
    let down = null;
    canvas.addEventListener('mousedown', e => { down = { x: e.clientX, y: e.clientY }; }, true);
    canvas.addEventListener('mousemove', e => {
      if (e.buttons) return;                         // mid-drag: leave the pan alone
      const h = hitAt(...canvasXY(canvas, e));
      const key = h ? h.key : null;
      if (key !== _hoverKey) {
        _hoverKey = key;
        canvas.style.cursor = key ? 'pointer' : 'grab';
        const KW = global.KWMap;
        if (KW && KW.controller) KW.controller.requestRender();
      }
    });
    canvas.addEventListener('mouseleave', () => { _hoverKey = null; });
    // Capture phase: runs before the map's own tile click, which we replace
    // with the settlement's tile when a plate is hit.
    canvas.addEventListener('click', e => {
      if (down && (Math.abs(e.clientX - down.x) > 5 || Math.abs(e.clientY - down.y) > 5)) { down = null; return; }
      down = null;
      const h = hitAt(...canvasXY(canvas, e));
      if (!h) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      try { _selectedTile = { wq: h.t.q, wr: h.t.r }; } catch (_) {}
      if (typeof selectWorldTile === 'function') selectWorldTile(h.t);
      const KW = global.KWMap;
      if (KW && KW.controller) KW.controller.requestRender();
    }, true);
    return true;
  }
  if (typeof document !== 'undefined') {
    const tryWire = () => { if (!wire()) setTimeout(tryWire, 500); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryWire); else tryWire();
  }

  // Call after tile data changes in place (e.g. clan tags) to re-place.
  function invalidate() { _key = ''; }

  global.KWNameplates = { draw, invalidate, kindOf, hitAt };
})(typeof window !== 'undefined' ? window : globalThis);
