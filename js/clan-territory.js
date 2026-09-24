// ══════════════════════════════════════════════════════════════════════════
//  CLAN TERRITORY — frontier edges + stroke, shared by both map renderers
//  (spec 016 §6.5). No DOM; the renderers pass in their canvas and face box.
//
//  AXIAL_DIRS order is the contract: index i = neighbour direction i, and
//  DIR_EDGE[i] is the hex edge facing that neighbour. Both renderers draw a
//  pointy-top hex from the same six vertices (_hexPathLT in kwmap-core,
//  isoHexPath in kwmap-iso — top, upper-right, lower-right, bottom,
//  lower-left, upper-left) over a screen projection of x ∝ q + r/2,
//  y ∝ r, so one table serves both.
//
//  Tiles carry clan_territory only when revealed to the viewer; a fogged
//  neighbour reads as "not this clan", so a frontier into fog still closes.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const AXIAL_DIRS = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [-1, +1], [0, +1]];
  // Vertex fractions of the face box (w, h), in hex-path order.
  const HEX_VERTS = [[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25]];
  // Direction → [vertex a, vertex b]: E, NE, NW, W, SW, SE.
  const DIR_EDGE = [[1, 2], [0, 1], [5, 0], [4, 5], [3, 4], [2, 3]];

  function mapW() { return typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40; }
  function mapH() { return typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40; }
  const wrap = (v, n) => ((v % n) + n) % n;

  // Directions (0–5) where this tile's clan frontier runs. `lookup(q, r)`
  // returns the tile object (or undefined).
  function territoryEdges(q, r, lookup) {
    const tile = lookup(q, r);
    const ct = tile && tile.clan_territory;
    if (!ct) return [];
    const out = [];
    for (let i = 0; i < 6; i++) {
      const nb = lookup(wrap(q + AXIAL_DIRS[i][0], mapW()), wrap(r + AXIAL_DIRS[i][1], mapH()));
      const nct = nb && nb.clan_territory;
      if (!nct || nct.clan_id !== ct.clan_id) out.push(i);
    }
    return out;
  }

  // Edge endpoints for direction `dir` on a face whose top-left is (x, y).
  function hexEdge(x, y, w, h, dir) {
    const [a, b] = DIR_EDGE[dir];
    return [[x + HEX_VERTS[a][0] * w, y + HEX_VERTS[a][1] * h],
            [x + HEX_VERTS[b][0] * w, y + HEX_VERTS[b][1] * h]];
  }

  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0x5b646c;
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  // Draws one tile's territory: a faint face tint, then on each frontier
  // edge a banner-primary band with a secondary hairline just inside it.
  // `pathFn(ctx, x, y, w, h)` traces the renderer's hex face; everything is
  // clipped to it so strokes never bleed onto the neighbour — which also
  // hides the outer half of each stroke, so widths below are doubled: the
  // visible band is ~3px of primary over a faint dark underlay (reads on
  // dark forest and pale grass alike) with a 1.5px secondary hairline.
  function drawTerritory(ctx, x, y, w, h, ct, edges, pathFn) {
    ctx.save();
    pathFn(ctx, x, y, w, h);
    ctx.clip();
    pathFn(ctx, x, y, w, h);
    ctx.fillStyle = rgba(ct.primary, 0.08);
    ctx.fill();
    if (edges.length) {
      const cx = x + w / 2, cy = y + h / 2;
      ctx.lineCap = 'round';
      const stroke = (p, q, style, width) => {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
        ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
      };
      for (const dir of edges) {
        const [p, q] = hexEdge(x, y, w, h, dir);
        stroke(p, q, 'rgba(20,14,8,0.35)', 9);
        stroke(p, q, rgba(ct.primary, 0.95), 6);
        // Hairline: the same edge moved ~4.5px toward the centre.
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const len = Math.hypot(cx - mx, cy - my) || 1;
        const ox = (cx - mx) / len * 4.5, oy = (cy - my) / len * 4.5;
        stroke([p[0] + ox, p[1] + oy], [q[0] + ox, q[1] + oy], rgba(ct.secondary, 0.9), 1.5);
      }
    }
    ctx.restore();
  }

  global.ClanTerritory = { AXIAL_DIRS, HEX_VERTS, DIR_EDGE, territoryEdges, hexEdge, drawTerritory };
})(typeof window !== 'undefined' ? window : globalThis);
