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

  function drawPlate(ctx, x, y, s) {
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

    // Plate
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    roundRect(ctx, left, top, W, H, H / 2);
    const g = ctx.createLinearGradient(0, top, 0, top + H);
    g.addColorStop(0, 'rgba(46,33,20,0.94)'); g.addColorStop(1, 'rgba(24,17,10,0.94)');
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5; ctx.strokeStyle = edge; ctx.stroke();

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

  function draw(ctx, W, H, renderer, cam) {
    const data = typeof worldMapData !== 'undefined' ? worldMapData : null;
    if (!ctx || !renderer || typeof renderer.labelAnchor !== 'function' || !data || !data.tiles) return;
    for (const a of anchors(renderer, cam, W, H, data)) {
      if (a.x < -120 || a.x > W + 120 || a.y < -40 || a.y > H + 40) continue;
      drawPlate(ctx, a.x, a.y, a.t.settlement);
    }
  }

  // Call after tile data changes in place (e.g. clan tags) to re-place.
  function invalidate() { _key = ''; }

  global.KWNameplates = { draw, invalidate, kindOf };
})(typeof window !== 'undefined' ? window : globalThis);
