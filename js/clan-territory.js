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
  // the patch's "heart" — the tile furthest from any non-clan tile — and
  // sized to the ring of the clan's own land around it. Tiles belong to one
  // clan only, so emblems of neighbouring clans can never overlap, and none
  // needs cropping.

  // Hex distance on the wrapped map (axial).
  function hexDistanceWrapped(q1, r1, q2, r2) {
    const W = mapW(), H = mapH();
    let best = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const dq = q1 - (q2 + a * W), dr = r1 - (r2 + b * H);
      best = Math.min(best, (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2);
    }
    return best;
  }

  // Cached per tiles array, keyed by a signature of which clan owns which
  // tile and how it looks — claims and banner edits update tiles in place,
  // so identity alone would go stale.
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

  // Groups visible clan tiles into connected patches (wrap-aware BFS).
  // Each tile's depth = steps to the nearest tile outside the patch (edge
  // tiles are 1; fogged neighbours count as outside). The heart is the
  // deepest tile, ties broken toward the patch centroid. Tile offsets are
  // unwrapped axial deltas from the heart.
  function territoryGroups(tiles) {
    if (!tiles) return [];
    const sig = territorySig(tiles);
    const hit = _groupCache.get(tiles);
    if (hit && hit.sig === sig) return hit.groups;
    const W = mapW(), H = mapH();
    const byKey = new Map();
    for (const t of tiles) if (t && t.clan_territory && t.terrain !== 'fog') byKey.set(t.q + ',' + t.r, t);
    const nbKeys = t => AXIAL_DIRS.map(([a, b]) => wrap(t.q + a, W) + ',' + wrap(t.r + b, H));
    const seen = new Set(), groups = [];
    for (const [key, start] of byKey) {
      if (seen.has(key)) continue;
      const clanId = start.clan_territory.clan_id;
      const members = [{ t: start, key, dq: 0, dr: 0, depth: 0 }];
      seen.add(key);
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        AXIAL_DIRS.forEach(([a, b]) => {
          const k = wrap(m.t.q + a, W) + ',' + wrap(m.t.r + b, H);
          const nb = byKey.get(k);
          if (!nb || seen.has(k) || nb.clan_territory.clan_id !== clanId) return;
          seen.add(k);
          members.push({ t: nb, key: k, dq: m.dq + a, dr: m.dr + b, depth: 0 });
        });
      }
      // Depth: multi-source BFS inward from the edge tiles.
      const inPatch = new Map(members.map(m => [m.key, m]));
      const queue = [];
      for (const m of members) {
        if (nbKeys(m.t).some(k => !inPatch.has(k))) { m.depth = 1; queue.push(m); }
      }
      for (let i = 0; i < queue.length; i++) {
        for (const k of nbKeys(queue[i].t)) {
          const n = inPatch.get(k);
          if (n && !n.depth) { n.depth = queue[i].depth + 1; queue.push(n); }
        }
      }
      // Heart: deepest tile, nearest the centroid on ties.
      let sx = 0, sy = 0;
      for (const m of members) { sx += m.dq + m.dr / 2; sy += m.dr; }
      sx /= members.length; sy /= members.length;
      let heart = members[0], bestD = -1, bestC = Infinity;
      for (const m of members) {
        const c = Math.hypot(m.dq + m.dr / 2 - sx, (m.dr - sy) * 0.866);
        if (m.depth > bestD || (m.depth === bestD && c < bestC)) { heart = m; bestD = m.depth; bestC = c; }
      }
      groups.push({
        clan: start.clan_territory,
        anchor: heart.t,
        depth: Math.max(1, heart.depth),
        tiles: members.map(m => ({ t: m.t, dq: m.dq - heart.dq, dr: m.dr - heart.dr })),
      });
    }
    _groupCache.set(tiles, { sig, groups });
    return groups;
  }

  // Draws a patch's emblem on its heart tile. The clan's own land extends
  // depth − 1 rings around the heart, so an emblem spanning 2·depth − 1
  // tiles stays on it. `place(dq, dr)` → { x, y } face top-left of the tile
  // at that offset from the heart; w/h = face size; hexVert is unused but
  // kept for the renderers' call shape; squash (iso) lays it flat.
  function drawEmblem(ctx, group, place, w, h, hexVert, squash) {
    const glyph = group.clan.glyph;
    if (!glyph) return;
    const k = squash || 1;
    const span = 2 * group.depth - 1;                 // tiles across
    const size = Math.min(w * 0.8 * span, w * 4.5);
    const a = place(0, 0);
    ctx.save();
    ctx.translate(a.x + w / 2, a.y + h / 2);
    ctx.scale(1, k);
    ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A crisp dark halo keeps small emblems legible (a banner-colour glow
    // could swamp them into a blob).
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = 'rgba(20,14,8,0.55)';
    ctx.shadowBlur = Math.max(2, size * 0.05);
    ctx.fillText(glyph, 0, 0);
    ctx.restore();
  }

  global.ClanTerritory = { AXIAL_DIRS, HEX_VERTS, DIR_EDGE, territoryEdges, hexEdge, drawTerritory,
                           territoryGroups, drawEmblem, bannerHash, hexDistanceWrapped };
})(typeof window !== 'undefined' ? window : globalThis);
