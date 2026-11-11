// ══════════════════════════════════════════════════════════════════════════
//  KWRoadLayer — your roads from town to your outposts, on the world map
//  (uifx canvas, under the travel paths).
//
//  Data: worldMapData tiles — your town (settlement.isOwn) and your outposts
//  (outpost.mine, outpost.road: 1 track, 2 paved; server lib/outpost_roads).
//  A track is a dashed earth-brown line; a paved road a pale stone band with
//  a darker edge. Works in both views through renderer.projectAxial().
//
//  Proof rules (MAP_RENDERER.md): no network calls and no randomness in
//  kwmap-* files; with no roads draw() returns without touching the context.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  // The wrapped copy of the line nearest the screen centre.
  function segment(from, to, renderer, cam, W, H) {
    const MW = typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40, MH = typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40;
    let dq = to.q - from.q, dr = to.r - from.r;
    if (dq > MW / 2) dq -= MW; else if (dq < -MW / 2) dq += MW;
    if (dr > MH / 2) dr -= MH; else if (dr < -MH / 2) dr += MH;
    let best = null, bestD = Infinity;
    for (let kq = -1; kq <= 1; kq++) for (let kr = -1; kr <= 1; kr++) {
      const oq = from.q + kq * MW, or = from.r + kr * MH;
      const m = renderer.projectAxial(oq + dq / 2, or + dr / 2, cam, W, H);
      const d = (m.x - W / 2) ** 2 + (m.y - H / 2) ** 2;
      if (d < bestD) { bestD = d; best = { oq, or }; }
    }
    const a = renderer.projectAxial(best.oq, best.or, cam, W, H);
    const b = renderer.projectAxial(best.oq + dq, best.or + dr, cam, W, H);
    return { a, b, hexW: b.hexW || a.hexW || 48 };
  }

  // [{ from, to, level }] for the player's own roads (pure, for proofs).
  function roadsOf(data) {
    const tiles = data && data.tiles;
    if (!tiles) return [];
    const home = tiles.find(t => t.settlement && t.settlement.isOwn);
    if (!home) return [];
    return tiles.filter(t => t.outpost && t.outpost.mine && Number(t.outpost.road) > 0)
      .map(t => ({ from: { q: home.q, r: home.r }, to: { q: t.q, r: t.r }, level: Number(t.outpost.road) }));
  }

  function draw(ctx, W, H, renderer, cam) {
    const data = typeof worldMapData !== 'undefined' ? worldMapData : global.worldMapData;   // eslint-disable-line no-undef
    const roads = roadsOf(data);
    if (!roads.length || !renderer || !renderer.projectAxial) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const rd of roads) {
      const s = segment(rd.from, rd.to, renderer, cam, W, H);
      const sc = Math.max(0.6, Math.min(1.5, s.hexW / 48));
      if (rd.level >= 2) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(70,56,40,0.75)'; ctx.lineWidth = 7 * sc;
        ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(214,200,170,0.9)'; ctx.lineWidth = 4 * sc;
        ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
      } else {
        ctx.setLineDash([8 * sc, 6 * sc]);
        ctx.strokeStyle = 'rgba(120,84,46,0.85)'; ctx.lineWidth = 3.5 * sc;
        ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  global.KWRoadLayer = { draw, roadsOf };
})(typeof window !== 'undefined' ? window : globalThis);
