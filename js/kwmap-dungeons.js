// ══════════════════════════════════════════════════════════════════════════
//  KWDungeonLayer — dungeons on the world map (uifx canvas).
//
//  A tile with a dungeon the player has found (t.dungeon in the map data:
//  the server's lib/dungeon_map.js) gets a skull in a ring of its skull's
//  colour. One this town has already been to is drawn faint; the one its
//  party is inside, or on its way to, has a gold ring.
//
//  Called once per frame from KWMap.controller.renderFrame after the raid
//  layer. Works in both views through renderer.projectAxial().
//
//  Proof rules (MAP_RENDERER.md): no network calls and no unseeded randomness
//  in kwmap-* files; with no dungeon in view draw() returns without touching
//  the context.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  // The five skulls, as the game colours them everywhere.
  const RING = { green: '#6fbf5a', yellow: '#e2c14a', orange: '#e08a3c', red: '#d8452e', purple: '#a26ad8' };

  function draw(ctx, W, H, renderer, cam) {
    // worldMapData is a top-level `let` in js/main.js — shared scope, not window.
    const data = typeof worldMapData !== 'undefined' ? worldMapData : global.worldMapData;
    const tiles = data && data.tiles;
    if (!tiles || !renderer || !renderer.projectAxial) return;
    const list = tiles.filter(t => t.dungeon);
    if (!list.length) return;
    const MW = typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40, MH = typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40;
    let started = false;
    for (const t of list) {
      const d = t.dungeon, inside = d.mine === 'active' || d.mine === 'travelling', done = !!d.mine && !inside && d.mine !== 'recalled';
      for (let kq = -1; kq <= 1; kq++) for (let kr = -1; kr <= 1; kr++) {
        const p = renderer.projectAxial(t.q + kq * MW, t.r + kr * MH, cam, W, H);
        if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;
        if (!started) { ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; started = true; }
        const sc = Math.max(0.7, Math.min(1.5, (p.hexW || 48) / 48));
        ctx.globalAlpha = done ? 0.45 : 1;
        ctx.fillStyle = 'rgba(18,12,20,0.86)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 15 * sc, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = inside ? '#f4c95d' : (RING[d.tier] || RING.green); ctx.lineWidth = (inside ? 3.5 : 2.5) * sc; ctx.stroke();
        ctx.font = `${Math.round(17 * sc)}px serif`; ctx.fillText('💀', p.x, p.y + 1);
        // How many floors, as small pips under it.
        if (d.floors > 1) { ctx.fillStyle = RING[d.tier] || RING.green; for (let i = 0; i < d.floors; i++) { ctx.beginPath(); ctx.arc(p.x + (i - (d.floors - 1) / 2) * 6 * sc, p.y + 20 * sc, 2 * sc, 0, Math.PI * 2); ctx.fill(); } }
      }
    }
    if (started) { ctx.globalAlpha = 1; ctx.restore(); }
  }

  global.KWDungeonLayer = { draw, RING };
})(typeof window !== 'undefined' ? window : globalThis);
