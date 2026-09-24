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
  // visible band is ~5px of primary over a faint dark underlay (reads on
  // dark forest and pale grass alike) with a 2px secondary hairline.
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
        stroke(p, q, 'rgba(20,14,8,0.38)', 14);
        stroke(p, q, rgba(ct.primary, 0.95), 10);
        // Hairline: the same edge moved ~7px toward the centre.
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const len = Math.hypot(cx - mx, cy - my) || 1;
        const ox = (cx - mx) / len * 7, oy = (cy - my) / len * 7;
        stroke([p[0] + ox, p[1] + oy], [q[0] + ox, q[1] + oy], rgba(ct.secondary, 0.95), 2);
      }
    }
    ctx.restore();
  }

  // ── Territory emblem ──────────────────────────────────────────────────
  // One emblem per connected patch of a clan's (visible) land, centred on
  // the patch and sized to it, clipped to its tiles.

  // Groups visible clan tiles into connected patches. Positions are
  // unwrapped axial offsets from the patch's anchor — the tile nearest the
  // patch centroid — so a patch straddling the wrap seam stays contiguous.
  // Cached per tiles array, keyed by a signature of which clan owns which
  // tile — claims update tiles in place, so identity alone would go stale.
  const _groupCache = new WeakMap();
  // Hash of a clan's look (emblem + colours), so a banner edit also counts
  // as a change for caches and the iso ground buffer.
  function bannerHash(ct) {
    const s = (ct.glyph || '') + (ct.primary || '') + (ct.secondary || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h;
  }
  function territorySig(tiles) {
    let h = 2166136261 >>> 0;
    for (const t of tiles) {
      const ct = t && t.terrain !== 'fog' && t.clan_territory;
      if (!ct) continue;
      h = Math.imul(h ^ ((t.q * 73856093) ^ (t.r * 19349663) ^ (ct.clan_id * 83492791) ^ bannerHash(ct)), 16777619) >>> 0;
    }
    return h;
  }
  function territoryGroups(tiles) {
    if (!tiles) return [];
    const sig = territorySig(tiles);
    const hit = _groupCache.get(tiles);
    if (hit && hit.sig === sig) return hit.groups;
    const W = mapW(), H = mapH();
    const byKey = new Map();
    for (const t of tiles) if (t && t.clan_territory && t.terrain !== 'fog') byKey.set(t.q + ',' + t.r, t);
    const seen = new Set(), groups = [];
    for (const [key, start] of byKey) {
      if (seen.has(key)) continue;
      const clanId = start.clan_territory.clan_id;
      const members = [{ t: start, dq: 0, dr: 0 }];
      seen.add(key);
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        for (const [a, b] of AXIAL_DIRS) {
          const k = wrap(m.t.q + a, W) + ',' + wrap(m.t.r + b, H);
          const nb = byKey.get(k);
          if (!nb || seen.has(k) || nb.clan_territory.clan_id !== clanId) continue;
          seen.add(k);
          members.push({ t: nb, dq: m.dq + a, dr: m.dr + b });
        }
      }
      // Centroid in screen-proportional space (x ∝ q + r/2, y ∝ r·0.866).
      let sx = 0, sy = 0;
      for (const m of members) { sx += m.dq + m.dr / 2; sy += m.dr; }
      sx /= members.length; sy /= members.length;
      let anchor = members[0], best = Infinity;
      for (const m of members) {
        const d = Math.hypot(m.dq + m.dr / 2 - sx, (m.dr - sy) * 0.866);
        if (d < best) { best = d; anchor = m; }
      }
      // Emblem centre: the centroid if it lies on the land, else the anchor.
      const onLand = best <= 0.6;
      groups.push({
        clan: start.clan_territory,
        anchor: anchor.t,
        tiles: members.map(m => ({ t: m.t, dq: m.dq - anchor.dq, dr: m.dr - anchor.dr })),
        centre: onLand
          ? { x: sx - (anchor.dq + anchor.dr / 2), y: sy - anchor.dr }   // in (q + r/2, r) units
          : { x: 0, y: 0 },
      });
    }
    _groupCache.set(tiles, { sig, groups });
    return groups;
  }

  // Draws a patch's emblem, sized to fit the patch's extent so it reads as
  // one mark across the land rather than a glyph cropped by tile edges.
  // `place(dq, dr)` → { x, y } face top-left of the tile at that offset from
  // the anchor; w/h = face size; hexVert = row step in the renderer's y
  // units; squash (iso) lays the glyph flat on the ground.
  function drawEmblem(ctx, group, place, w, h, hexVert, squash) {
    const glyph = group.clan.glyph;
    if (!glyph) return;
    const k = squash || 1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const m of group.tiles) {
      const x = m.dq + m.dr / 2, y = m.dr;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const spanW = (maxX - minX) * w + w;            // patch extent in px
    const spanH = (maxY - minY) * hexVert + h;
    const n = group.tiles.length;
    // Fit inside the patch (the glyph's drawn height is size·k), grow gently
    // with tile count, and cap so huge territories stay tasteful.
    const size = Math.min(spanW * 0.8, (spanH / k) * 0.8, w * (0.8 + 0.45 * Math.sqrt(n)), w * 3.6);
    const a = place(0, 0);
    const cx = a.x + w / 2 + group.centre.x * w;
    const cy = a.y + h / 2 + group.centre.y * hexVert;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, k);
    ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.42;
    ctx.shadowColor = rgba(group.clan.primary, 0.9);
    ctx.shadowBlur = size * 0.12;
    ctx.fillText(glyph, 0, 0);
    ctx.restore();
  }

  global.ClanTerritory = { AXIAL_DIRS, HEX_VERTS, DIR_EDGE, territoryEdges, hexEdge, drawTerritory,
                           territoryGroups, drawEmblem, bannerHash };
})(typeof window !== 'undefined' ? window : globalThis);
