// ══════════════════════════════════════════════════════════════════════════
//  KWMap TopDownRenderer — Phase 1 mechanical extraction
//  The existing top-down draw path and hit-testing from main.js, moved
//  VERBATIM behind the renderer interface (spec §1.4). Behavior changes: none
//  beyond the two sanctioned in kwmap-core.js's header. Helper functions it
//  calls at runtime (_drawTerrainDetail, getTileVariantImage, _fogImg,
//  TERRAIN colors, OUTPOST_ICONS, …) still live in main.js / pixelart.js —
//  classic scripts share the global scope, and every call happens after all
//  scripts have loaded, so definition order is irrelevant.
//  Load order: after kwmap-core.js, before main.js.
// ══════════════════════════════════════════════════════════════════════════

KWMap.controller.registerRenderer('topdown', {
  id: 'topdown',

  render(frame) {
  // BODY MOVED VERBATIM from main.js _doRenderCanvas (Phase 1). The HiDPI
  // preamble lives in the controller; state arrives via the frame bag but is
  // the same objects the original read (camera is the shared global).
  const data = frame.data;
  if (!data || !data.tiles) return;
  const { ctx, W, H } = frame;
  const camera = frame.camera;

  // ── Hex geometry ──────────────────────────────
  const tpx     = TILE_PX();
  const hexW    = tpx;
  const hexH    = Math.round(tpx * 1.1547);
  const hexVert = Math.round(hexH * 0.75);
  const showEmoji = tpx >= 36;

  // ── Tile lookup ───────────────────────────────
  const tileMap = {};
  data.tiles.forEach(t => { tileMap[`${t.q},${t.r}`] = t; });

  // ── Clear ─────────────────────────────────────
  // Match the unified tile border color so any sub-pixel gap between hex
  // shapes blends invisibly. Using a near-black clear here would produce
  // visible dark seams as the tile edges fade to transparent.
  ctx.fillStyle = '#3a2e22';
  ctx.fillRect(0, 0, W, H);

  // ── Visible range ─────────────────────────────
  const rowsVisible = Math.ceil(H / hexVert) + 8;
  const colsVisible = Math.ceil(W / hexW) + rowsVisible + 4;
  const cx = W / 2, cy = H / 2;
  const camPxX = hexW * (camera.q + camera.r / 2);
  const camPxY = hexVert * camera.r;
  const qStart = camera.q - Math.ceil(colsVisible / 2);
  const rStart = camera.r - Math.ceil(rowsVisible / 2);

  // ── Fog texture — scaled up, drifts via sin/cos, no tiling so no seams ──
  if (_fogImg.complete && _fogImg.naturalWidth > 0) {
    const driftRange = Math.max(W, H) * 0.08;  // drift by up to 8% of canvas
    // drawSize must be canvas + 2× driftRange so edges never go out of frame
    const drawSize = Math.max(W, H) + driftRange * 2;
    const driftX = Math.sin(_fogOffset * 0.0012) * driftRange;
    const driftY = Math.cos(_fogOffset * 0.0008) * driftRange;
    ctx.globalAlpha = _fogImg._painted ? 0.94 : 0.58;
    ctx.drawImage(_fogImg, (W - drawSize) / 2 + driftX, (H - drawSize) / 2 + driftY, drawSize, drawSize);
    ctx.globalAlpha = 1;
  }

  // ── Collect visible tiles (deduplicated — no tile drawn twice) ──────────
  const visibleTiles = [];
  const _seenTiles = new Set();
  for (let dr = 0; dr < rowsVisible; dr++) {
    for (let dq = 0; dq < colsVisible; dq++) {
      const aq = qStart + dq, ar = rStart + dr;
      const wq = ((aq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
      const wr = ((ar % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
      const key = `${wq},${wr}`;
      if (_seenTiles.has(key)) continue;  // skip duplicate — tile already queued
      const x = cx + hexW * (aq + ar / 2) - camPxX - hexW / 2;
      const y = cy + hexVert * ar - camPxY - hexH / 2;
      if (x < -hexW * 2 || x > W + hexW || y < -hexH * 2 || y > H + hexH) continue;
      _seenTiles.add(key);
      visibleTiles.push({ wq, wr, x: Math.round(x), y: Math.round(y), t: tileMap[`${wq},${wr}`] });
    }
  }

  // ── Pass 1: terrain fills ─────────────────────
  for (const { wq, wr, x, y, t } of visibleTiles) {
    _hexPathLT(ctx, x, y, hexW, hexH);

    if (!t || t.terrain === 'fog') {
      // No fill — fog texture draws through
    } else if (t.settlement) {
      ctx.fillStyle = t.settlement.isOwn ? '#1a3060' : '#1a2e4a';
      ctx.fill();
    } else {
      // Pick the tile image. Real PNGs (TILE_IMAGES[terrain]) win when loaded;
      // otherwise fall back to a procedural variant chosen on coarse coords so
      // that small clusters of adjacent tiles share the same look — gives
      // patchy variation rather than per-tile noise.
      let img = TILE_IMAGES[t.terrain];
      if ((!img || img._isVariantSet) && typeof getTileVariant === 'function') {
        img = getTileVariant(t.terrain, wq, wr);
      }
      const isUsableImage = img && !img._isVariantSet
        && (img.naturalWidth || img.width);
      if (isUsableImage && _tileImagesLoaded) {
        ctx.save();
        _hexPathLT(ctx, x, y, hexW, hexH);
        ctx.clip();
        // Draw tile at full hex size with a 1px overdraw on every side. The
        // hex clip keeps content in the shape; the overdraw eliminates any
        // sub-pixel gap where adjacent tiles meet, so seams disappear.
        // (No more scale/offset jitter — that was producing the choppy look.)
        ctx.drawImage(img, x - 1, y - 1, hexW + 2, hexH + 2);
        ctx.restore();
      } else {
        ctx.fillStyle = TERRAIN_COLORS[t.terrain] || '#2a2010';
        ctx.fill();
        _drawTerrainDetail(ctx, x, y, hexW, hexH, t.terrain, wq, wr);
      }
    }
  }


  // ── Pass 1.5: river water (painterly natural treatment) ────────────────
  // Goal: rivers read as terrain features carved into the landscape, not as
  // overlay strokes. Approach is layered "soft to hard":
  //
  //   L1 wet-earth aura   — wide, very low-alpha dark ring; ground "soaked"
  //   L2 soft outer water — wider faded water layer that bleeds into the aura
  //   L3 water body       — main water colour at full width
  //   L4 inner highlight  — soft sheen
  //   L5 shore details    — terrain-aware: reeds (marsh/plains), rocks
  //                         (hills/mountain), grass tufts (plains), surface
  //                         ripples scattered along the river
  //   L6 endpoint pools   — only for 0/1-conn river tiles
  //
  // Lakes use the same layer structure but drawn as overlapping-circle blobs
  // per tile rather than hex-shaped fills, so shorelines are organic curves
  // instead of straight hex edges.
  //
  // Curves are tangent-continuous cubic Beziers with extra wobble injected
  // mid-tile (pre-tile-center) for irregular bank silhouettes, and width
  // grows downstream via a BFS-from-headwaters rank cached on worldMapData.
  //
  // Position math uses each tile's visibleTiles entry + screen-space hex
  // direction offsets so wrapping at map edges renders correctly.
  const HEX_NEIGHBORS = [
    [+1, 0], [-1, 0], [0, +1], [0, -1], [+1, -1], [-1, +1],
  ];
  const HEX_DIR_PX = HEX_NEIGHBORS.map(([dq, dr]) => ({
    dx: hexW * (dq + dr / 2),
    dy: hexVert * dr,
  }));
  const tileAt = (q, r) => tileMap[`${q},${r}`];
  const isRiverTile = (q, r) => {
    const t = tileAt(q, r);
    return t && t.terrain === 'river';
  };
  const hashF = (...args) => {
    let h = 0;
    for (const a of args) h = ((h * 31) ^ (a | 0)) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
  };
  const wrapQ = (q) => ((q % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
  const wrapR = (r) => ((r % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
  const countRiverNeighbours = (q, r) => {
    let n = 0;
    for (const [dq, dr] of HEX_NEIGHBORS) {
      if (isRiverTile(wrapQ(q + dq), wrapR(r + dr))) n++;
    }
    return n;
  };
  const isLakeTile = (q, r) => {
    const c = countRiverNeighbours(q, r);
    if (c >= 4) return true;
    if (c >= 3) {
      for (const [dq, dr] of HEX_NEIGHBORS) {
        const nq = wrapQ(q + dq), nr = wrapR(r + dr);
        if (isRiverTile(nq, nr) && countRiverNeighbours(nq, nr) >= 4) return true;
      }
    }
    return false;
  };

  // BFS rank from headwaters — cached on worldMapData (invalidated when the
  // dev tile-editor changes a tile, see _applyDevTileTerrain).
  if (!data._riverFlow) {
    const rank = {};
    const queue = [];
    for (const t of data.tiles) {
      if (t.terrain !== 'river') continue;
      if (countRiverNeighbours(t.q, t.r) === 1 && !isLakeTile(t.q, t.r)) {
        rank[`${t.q},${t.r}`] = 0;
        queue.push({ q: t.q, r: t.r, d: 0 });
      }
    }
    while (queue.length) {
      const cur = queue.shift();
      for (const [dq, dr] of HEX_NEIGHBORS) {
        const nq = wrapQ(cur.q + dq), nr = wrapR(cur.r + dr);
        if (!isRiverTile(nq, nr)) continue;
        const k = `${nq},${nr}`;
        if (rank[k] !== undefined) continue;
        rank[k] = cur.d + 1;
        queue.push({ q: nq, r: nr, d: cur.d + 1 });
      }
    }
    let maxRank = 1;
    for (const k in rank) if (rank[k] > maxRank) maxRank = rank[k];
    data._riverFlow = { rank, maxRank };
  }
  const flowRank = data._riverFlow.rank;
  const flowMax = data._riverFlow.maxRank;

  const terrainWidthFactor = (terrain) => {
    if (terrain === 'mountain') return 0.55;
    if (terrain === 'hills') return 0.75;
    if (terrain === 'marsh') return 1.20;
    if (terrain === 'plains') return 1.05;
    return 1.0;
  };

  // ── Painterly palette ────────────────────────────────────────────────
  // Soft, layered. Lower alphas on outer layers so they bleed into the
  // ground rather than sitting on top.
  const COL_WET_EARTH    = 'rgba(35, 26, 18, 0.18)';   // ground soaked aura
  const COL_WET_EARTH_RIM= 'rgba(50, 38, 26, 0.40)';   // closer-to-water rim
  const COL_WATER_OUTER  = 'rgba(70, 88, 102, 0.45)';  // soft fade water layer
  const COL_WATER_BODY   = 'rgba(58, 78, 96, 0.92)';   // main water colour (rivers)
  // Lake body uses a fully opaque variant — overlapping circles in the lake
  // blob would otherwise expose their structure through alpha compounding,
  // creating a visible "bauble" pattern across the lake surface.
  const COL_WATER_BODY_OPAQUE = 'rgb(58, 78, 96)';
  const COL_WATER_DEEP   = 'rgba(40, 56, 70, 0.55)';   // shadow inside body
  const COL_WATER_LIGHT  = 'rgba(140, 162, 178, 0.40)';// soft highlight
  const COL_WATER_GLINT  = 'rgba(210, 222, 228, 0.55)';// rare bright glint
  const COL_REED         = 'rgba(78, 96, 50, 0.85)';
  const COL_REED_DARK    = 'rgba(50, 64, 30, 0.85)';
  const COL_GRASS        = 'rgba(110, 130, 60, 0.75)';
  const COL_ROCK_DARK    = 'rgba(56, 50, 44, 0.85)';
  const COL_ROCK_LIGHT   = 'rgba(120, 110, 100, 0.70)';

  // Width base — slightly larger than before so downstream rivers feel
  // properly broad. Scaled per terrain + downstream.
  const baseW = Math.max(7, hexW * 0.40);

  // ── Build river render data ──────────────────────────────────────────
  const riverRenders = [];
  for (const { wq, wr, x, y, t } of visibleTiles) {
    if (!t || t.terrain !== 'river') continue;
    const meX = x + hexW / 2;
    const meY = y + hexH / 2;
    const rk = flowRank[`${wq},${wr}`] ?? 0;
    const downstreamFactor = 0.55 + (rk / flowMax) * 0.65; // slightly wider range than before
    const width = baseW * downstreamFactor * terrainWidthFactor(t.terrain);
    const lake = isLakeTile(wq, wr);
    const conns = [];
    for (let i = 0; i < HEX_NEIGHBORS.length; i++) {
      const [dq, dr] = HEX_NEIGHBORS[i];
      const nq = wrapQ(wq + dq), nr = wrapR(wr + dr);
      if (!isRiverTile(nq, nr)) continue;
      const nX = meX + HEX_DIR_PX[i].dx;
      const nY = meY + HEX_DIR_PX[i].dy;
      let mx = (meX + nX) / 2;
      let my = (meY + nY) / 2;
      // Symmetric edge-midpoint wobble
      let ka = wq, kb = wr, kc = nq, kd = nr;
      if (ka > kc || (ka === kc && kb > kd)) {
        [ka, kc] = [kc, ka]; [kb, kd] = [kd, kb];
      }
      const wobble = (hashF(ka, kb, kc, kd) - 0.5) * hexW * 0.10;
      const ex = nX - meX, ey = nY - meY;
      const elen = Math.sqrt(ex * ex + ey * ey) || 1;
      mx += (-ey / elen) * wobble;
      my += (ex / elen) * wobble;
      conns.push({
        nq, nr, dirIdx: i,
        edge: { x: mx, y: my },
        tangent: { x: ex / elen, y: ey / elen },
        // Neighbour terrain — used for shore detail decisions.
        nTerrain: tileAt(nq, nr)?.terrain || 'plains',
      });
    }
    riverRenders.push({
      wq, wr,
      x: meX, y: meY,
      hexX: x, hexY: y,
      width, conns, lake,
      terrain: t.terrain,
    });
  }

  // ── Lake blob construction ───────────────────────────────────────────
  // For each lake tile, compute a list of circles whose union is the lake's
  // contribution to the water body. A big core circle at tile centre, plus
  // smaller bridge circles toward each lake neighbour (so adjacent lake
  // tiles' circles overlap and form one continuous organic blob).
  // Also collect lake tiles for shore/aura layers.
  const lakeRenders = riverRenders.filter(r => r.lake);
  const isLakeNeighbour = (rt, dirIdx) => {
    const [dq, dr] = HEX_NEIGHBORS[dirIdx];
    const nq = wrapQ(rt.wq + dq), nr = wrapR(rt.wr + dr);
    return isLakeTile(nq, nr);
  };
  const lakeBlobCircles = (rt) => {
    const circles = [];
    // Core: irregular per-tile size — slightly oversized so adjacent
    // bridge circles always overlap with cores nicely.
    const coreR = hexW * (0.58 + hashF(rt.wq, rt.wr, 21) * 0.08);
    circles.push({ x: rt.x, y: rt.y, r: coreR });
    // Bridges toward lake neighbours — wider radius for smooth interior.
    for (let i = 0; i < HEX_NEIGHBORS.length; i++) {
      if (!isLakeNeighbour(rt, i)) continue;
      const dx = HEX_DIR_PX[i].dx, dy = HEX_DIR_PX[i].dy;
      // Bridge centre is partway from tile centre toward neighbour centre
      const bx = rt.x + dx * 0.5;
      const by = rt.y + dy * 0.5;
      const br = hexW * (0.42 + hashF(rt.wq, rt.wr, 22 + i) * 0.06);
      circles.push({ x: bx, y: by, r: br });
    }
    return circles;
  };

  // ── Helper: stroke the curve through this tile (rivers only) ─────────
  // Cubic Bezier with tangents matched at edge midpoints. For 2-connection
  // tiles the curve passes through the tile centre as control. For
  // endpoints, ends in the tile centre. For junctions, half-curves out from
  // the centre to each edge.
  const cpDist = hexW * 0.35;
  const strokeRiverPath = (rt) => {
    if (rt.lake) return;
    const { x, y, conns } = rt;
    if (conns.length === 2) {
      const a = conns[0], b = conns[1];
      const cax = a.edge.x - a.tangent.x * cpDist;
      const cay = a.edge.y - a.tangent.y * cpDist;
      const cbx = b.edge.x - b.tangent.x * cpDist;
      const cby = b.edge.y - b.tangent.y * cpDist;
      ctx.beginPath();
      ctx.moveTo(a.edge.x, a.edge.y);
      ctx.bezierCurveTo(cax, cay, cbx, cby, b.edge.x, b.edge.y);
      ctx.stroke();
    } else if (conns.length === 1) {
      const c = conns[0];
      const cax = c.edge.x - c.tangent.x * cpDist;
      const cay = c.edge.y - c.tangent.y * cpDist;
      ctx.beginPath();
      ctx.moveTo(c.edge.x, c.edge.y);
      ctx.bezierCurveTo(cax, cay, x, y, x, y);
      ctx.stroke();
    } else if (conns.length >= 3) {
      for (const c of conns) {
        const cax = (x + c.edge.x) / 2;
        const cay = (y + c.edge.y) / 2;
        const cbx = c.edge.x - c.tangent.x * cpDist;
        const cby = c.edge.y - c.tangent.y * cpDist;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(cax, cay, cbx, cby, c.edge.x, c.edge.y);
        ctx.stroke();
      }
    }
  };
  // Helper: fill all circles of a lake blob with current fillStyle. We
  // expand the radius by an offset so layer 1 (aura) draws bigger than
  // layer 3 (body) etc.
  const fillLakeBlob = (rt, expand) => {
    const circles = lakeBlobCircles(rt);
    for (const c of circles) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r + expand, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  //  L1: WET EARTH AURA — outermost soft darkening of ground around water
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  // Outer aura — very low alpha, wide
  ctx.strokeStyle = COL_WET_EARTH;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width + 14;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WET_EARTH;
  for (const rt of lakeRenders) fillLakeBlob(rt, 8);
  // Inner aura rim — slightly stronger, narrower
  ctx.strokeStyle = COL_WET_EARTH_RIM;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width + 6;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WET_EARTH_RIM;
  for (const rt of lakeRenders) fillLakeBlob(rt, 3);
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L2: SOFT OUTER WATER — feathered fade between aura and body
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COL_WATER_OUTER;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width + 3;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WATER_OUTER;
  for (const rt of lakeRenders) fillLakeBlob(rt, 1.5);
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L3: WATER BODY — main water colour
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COL_WATER_BODY;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WATER_BODY_OPAQUE;
  for (const rt of lakeRenders) fillLakeBlob(rt, 0);
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L4: HIGHLIGHT — soft sheen on the upper-left of each segment / lake
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COL_WATER_LIGHT;
  for (const rt of riverRenders) {
    if (rt.lake) continue;
    ctx.lineWidth = rt.width * 0.42;
    strokeRiverPath(rt);
  }
  ctx.restore();
  // Lake surface — calm flat water with very subtle ripple lines.
  //
  // Earlier versions drew a per-tile radial highlight which created a "ball"
  // / "bauble" look at every tile centre because the gradient is brightest
  // near the centre of each circle. For a still lake we want one continuous
  // flat surface, so we omit the centre-bright highlight entirely and instead
  // suggest stillness with a few faint, short ripple curves scattered across
  // the lake body. Hashes are seeded by tile position so ripples are
  // deterministic (no flicker on pan) but they vary per tile so adjacent
  // tiles don't show identical ripple patterns.
  ctx.save();
  ctx.strokeStyle = 'rgba(225, 232, 238, 0.18)';
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  for (const rt of lakeRenders) {
    // 1-2 ripples per tile, placed in the inner area (well away from the
    // shoreline so they don't conflict with bank details). Each ripple is a
    // short shallow arc — subtle horizontal-ish wave, very low contrast.
    const numRipples = (hashF(rt.wq, rt.wr, 41) < 0.55) ? 2 : 1;
    for (let i = 0; i < numRipples; i++) {
      const ox = (hashF(rt.wq, rt.wr, 42 + i) - 0.5) * hexW * 0.55;
      const oy = (hashF(rt.wq, rt.wr, 44 + i) - 0.5) * hexH * 0.45;
      const cx_ = rt.x + ox;
      const cy_ = rt.y + oy;
      const len = hexW * (0.20 + hashF(rt.wq, rt.wr, 46 + i) * 0.12);
      // Angle is mostly horizontal with slight tilt — water reads "still"
      // when ripples are level rather than diagonal.
      const tilt = (hashF(rt.wq, rt.wr, 48 + i) - 0.5) * 0.4;
      const dx = Math.cos(tilt) * len / 2;
      const dy = Math.sin(tilt) * len / 2;
      ctx.beginPath();
      ctx.moveTo(cx_ - dx, cy_ - dy);
      ctx.quadraticCurveTo(cx_, cy_ - 0.6, cx_ + dx, cy_ + dy);
      ctx.stroke();
    }
  }
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L5: SHORE DETAILS — terrain-aware reeds / rocks / grass / ripples
  // ──────────────────────────────────────────────────────────────────────
  // For each river tile, walk its connections and place 1-2 small detail
  // marks per connection on the river side of the shared edge. The mark
  // type depends on the neighbour's terrain: marsh → reeds; plains → grass
  // tufts and reeds; hills/mountain → rocks; otherwise → none. Inside the
  // body of each river tile we also scatter 1-2 surface ripples.
  const drawReedAt = (px, py, seed) => {
    // Reeds: 2-3 vertical strokes, slightly varying height.
    const n = 2 + (seed * 3 | 0) % 2;
    for (let i = 0; i < n; i++) {
      const h = 3 + ((seed * (i + 1.7)) % 1) * 4;
      const ox = (i - (n - 1) / 2) * 1.5;
      ctx.fillStyle = i === 0 ? COL_REED_DARK : COL_REED;
      ctx.fillRect(px + ox, py - h, 1, h);
    }
  };
  const drawGrassAt = (px, py, seed) => {
    // Grass: 4-5 short angled strokes
    ctx.fillStyle = COL_GRASS;
    const n = 3 + (seed * 4 | 0) % 3;
    for (let i = 0; i < n; i++) {
      const ox = (i - n / 2) * 1.3;
      const lean = (((seed * (i + 1)) % 1) - 0.5) * 1.5;
      ctx.fillRect(px + ox, py - 2.5, 0.9, 2.5);
      ctx.fillRect(px + ox + lean, py - 2.0, 0.9, 2.0);
    }
  };
  const drawRockAt = (px, py, seed) => {
    // Rock: small dark dab + smaller light dab
    ctx.beginPath();
    ctx.fillStyle = COL_ROCK_DARK;
    ctx.arc(px, py, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = COL_ROCK_LIGHT;
    ctx.arc(px - 0.5, py - 0.5, 1.0, 0, Math.PI * 2);
    ctx.fill();
  };
  const drawRippleAt = (px, py, len) => {
    ctx.strokeStyle = 'rgba(170, 190, 205, 0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(px - len / 2, py);
    ctx.quadraticCurveTo(px, py - 0.7, px + len / 2, py);
    ctx.stroke();
  };

  for (const rt of riverRenders) {
    // Ripples on body — 1-2 per tile, scattered along curve. Skip lakes
    // (lakes get fewer/different details to read as still water).
    if (!rt.lake) {
      const numRipples = (hashF(rt.wq, rt.wr, 31) < 0.55) ? 2 : 1;
      for (let i = 0; i < numRipples; i++) {
        // Sample a position along the river path. For 2-conn tiles,
        // interpolate along the bezier; otherwise sit near the centre.
        let px, py;
        const t1 = 0.30 + i * 0.40 + (hashF(rt.wq, rt.wr, 32 + i) - 0.5) * 0.15;
        if (rt.conns.length === 2) {
          // Approximate Bezier(t) using simple lerp through centre
          const a = rt.conns[0].edge, b = rt.conns[1].edge;
          if (t1 < 0.5) {
            const u = t1 * 2;
            px = a.x + (rt.x - a.x) * u;
            py = a.y + (rt.y - a.y) * u;
          } else {
            const u = (t1 - 0.5) * 2;
            px = rt.x + (b.x - rt.x) * u;
            py = rt.y + (b.y - rt.y) * u;
          }
        } else {
          px = rt.x + (hashF(rt.wq, rt.wr, 33 + i) - 0.5) * rt.width;
          py = rt.y + (hashF(rt.wq, rt.wr, 34 + i) - 0.5) * rt.width * 0.6;
        }
        drawRippleAt(px, py, rt.width * 0.45);
      }
    }

    // Shore details from each neighbour
    for (const c of rt.conns) {
      // Skip details where the neighbour is also a river/lake — that's
      // water-to-water, not shoreline.
      if (c.nTerrain === 'river') continue;
      // Detail position: slight inward offset from edge midpoint, on the
      // far side of the river (i.e. on the non-river side, just beside
      // the water). Use the perpendicular of the tangent to land on the
      // bank.
      const seed = hashF(rt.wq, rt.wr, c.dirIdx + 7);
      const numMarks = 1 + ((seed * 2) | 0);
      for (let i = 0; i < numMarks; i++) {
        // Position along the edge perpendicular axis, with random offset
        // along the river (so marks don't all stack on the midpoint).
        const along = (hashF(rt.wq, rt.wr, c.dirIdx * 13 + i + 3) - 0.5) * rt.width * 1.4;
        // Tangent runs along flow; perpendicular runs across the river
        const tx = c.tangent.x, ty = c.tangent.y;
        const px_ = -ty, py_ = tx; // perpendicular
        // Place mark just outside the water edge, on the bank facing the
        // neighbour terrain. Distance = water half-width + small margin.
        const offDist = rt.width * 0.50 + 1.5;
        const mx = c.edge.x + px_ * offDist + tx * along;
        const my = c.edge.y + py_ * offDist + ty * along;
        // Pick detail by neighbour terrain
        const mseed = hashF(rt.wq, rt.wr, c.dirIdx * 17 + i + 11);
        if (c.nTerrain === 'marsh') {
          drawReedAt(mx, my, mseed);
        } else if (c.nTerrain === 'plains') {
          if (mseed < 0.5) drawReedAt(mx, my, mseed);
          else drawGrassAt(mx, my, mseed);
        } else if (c.nTerrain === 'hills' || c.nTerrain === 'mountain') {
          drawRockAt(mx, my, mseed);
        } else if (c.nTerrain === 'forest') {
          // Forest banks: occasional grass + occasional rock
          if (mseed < 0.65) drawGrassAt(mx, my, mseed);
          else drawRockAt(mx, my, mseed);
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  L6: ENDPOINT POOLS — rivers ending in springs / 1-tile ponds
  // ──────────────────────────────────────────────────────────────────────
  for (const rt of riverRenders) {
    if (rt.lake) continue;
    const isEndpoint = rt.conns.length <= 1;
    const isJunction = rt.conns.length >= 3;
    if (!isEndpoint && !isJunction) continue;
    const r = isEndpoint
      ? (rt.conns.length === 0 ? rt.width * 0.65 : rt.width * 0.55)
      : rt.width * 0.32;
    // Wet earth around the pool
    ctx.beginPath();
    ctx.fillStyle = COL_WET_EARTH_RIM;
    ctx.arc(rt.x, rt.y, r + 4, 0, Math.PI * 2);
    ctx.fill();
    // Outer water fade
    ctx.beginPath();
    ctx.fillStyle = COL_WATER_OUTER;
    ctx.arc(rt.x, rt.y, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Body
    ctx.beginPath();
    ctx.fillStyle = COL_WATER_BODY;
    ctx.arc(rt.x, rt.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.beginPath();
    ctx.fillStyle = COL_WATER_LIGHT;
    ctx.arc(rt.x - r * 0.25, rt.y - r * 0.25, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (isEndpoint) {
      ctx.beginPath();
      ctx.fillStyle = COL_WATER_GLINT;
      ctx.arc(rt.x - r * 0.35, rt.y - r * 0.35, r * 0.20, 0, Math.PI * 2);
      ctx.fill();
    }
  }


  // ── Pass 2: borders + highlights ─────────────
  for (const { wq, wr, x, y, t } of visibleTiles) {
    const isFog = !t || t.terrain === 'fog';
    const isHome = t?.settlement?.isOwn;
    // Phase 1: hover/selection/fog-selection strokes moved to the uifx
    // canvas (controller._renderUiFx) — layers 140–160. Claim borders and
    // the persistent home stroke remain world content, below.

    // Claimed territory (010) — quiet ink border in the parchment-and-gold
    // language: gold for the player's claims, desaturated slate for foreign
    // ones. Drawn first so hover/selection strokes read on top. Clipped like
    // the hover stroke so it never bleeds onto neighbours. Static by design —
    // no per-frame animation.
    if (!isFog && t && (t.claimed_by_me || t.claim_owner)) {
      ctx.save();
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.clip();
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.strokeStyle = t.claimed_by_me ? 'rgba(212,175,80,0.60)' : 'rgba(145,155,165,0.45)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    if (isHome) {
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.strokeStyle = 'rgba(255,210,120,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ── Pass 3: settlement rendering ──────────────────────────────────────
  for (const { wq, wr, x, y, t } of visibleTiles) {
    if (!t?.settlement) continue;
    const s = t.settlement;
    const cx = x + hexW / 2, cy = y + hexH / 2;
    const r2 = Math.min(hexW, hexH) * 0.46;

    ctx.save();
    _hexPathLT(ctx, x, y, hexW, hexH);
    ctx.clip();

    // Normalise type — handle undefined/null gracefully
    const sType = s.settlement_type || (s.is_kingdom ? 'kingdom' : s.disposition === 'hostile' ? 'hostile' : 'npc');

    if (sType === 'kingdom' || s.is_kingdom) {
      // ── Great Kingdom — rich gold fill ──
      ctx.fillStyle = s.is_kingdom_annex ? 'rgba(120,90,10,0.68)' : 'rgba(140,100,5,0.78)';
      ctx.fill();
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2 * 0.8);
      grd.addColorStop(0, 'rgba(255,220,80,0.45)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      // Border
      ctx.strokeStyle = s.is_kingdom_annex ? 'rgba(220,185,60,0.70)' : 'rgba(255,215,50,0.98)';
      ctx.lineWidth = s.is_kingdom_annex ? 1.8 : 2.8;
      ctx.stroke();
      // Crown icon on main tile only
      if (!s.is_kingdom_annex && showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.42)}px serif`;
        ctx.fillText('👑', cx, cy);
      }

    } else if (sType === 'hostile') {
      // ── Hostile (Withered) — solid dark crimson fill ──
      ctx.fillStyle = 'rgba(100,8,8,0.78)';
      ctx.fill();
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2 * 0.7);
      grd.addColorStop(0, 'rgba(220,40,20,0.35)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,50,30,0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.42)}px serif`;
        ctx.fillText('💀', cx, cy);
      }

    } else if (sType === 'npc') {
      // ── Friendly/Neutral NPC — solid teal fill over terrain ──
      const isNeutral = s.disposition === 'neutral';
      // Solid base fill
      ctx.fillStyle = isNeutral ? 'rgba(40,100,90,0.72)' : 'rgba(20,110,80,0.72)';
      ctx.fill();
      // Lighter centre glow
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2 * 0.7);
      grd.addColorStop(0, isNeutral ? 'rgba(130,210,180,0.35)' : 'rgba(80,220,160,0.40)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      // Border
      ctx.strokeStyle = isNeutral ? 'rgba(120,200,160,0.9)' : 'rgba(60,220,150,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.38)}px serif`;
        ctx.fillText('🏡', cx, cy);
      }

    } else {
      // ── Player settlement — amber/gold ──
      const grd = ctx.createRadialGradient(cx, cy, r2 * 0.1, cx, cy, r2);
      grd.addColorStop(0, s.isOwn ? 'rgba(255,200,80,0.32)' : 'rgba(200,160,60,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = s.isOwn ? 'rgba(255,210,120,0.95)' : 'rgba(200,160,60,0.65)';
      ctx.lineWidth = s.isOwn ? 2.5 : 1.8;
      ctx.stroke();
      if (showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.42)}px serif`;
        ctx.fillText(s.isOwn ? '🏘' : '🏘', cx, cy);
      }
    }

    ctx.restore();
  }

  // ── Pass 3.5: outpost stamps (010) ─────────────────────────────────────
  // Small token in the tile centre: dark parchment disc, terrain-flavoured
  // glyph, gold ring when it's the player's. Static — no animation, no RNG.
  for (const { x, y, t } of visibleTiles) {
    const op = t?.outpost;
    if (!op || t.settlement) continue;
    const ocx = x + hexW / 2, ocy = y + hexH / 2;
    const orr = Math.min(hexW, hexH) * 0.26;

    ctx.save();
    _hexPathLT(ctx, x, y, hexW, hexH);
    ctx.clip();

    ctx.beginPath();
    ctx.arc(ocx, ocy, orr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40,30,18,0.72)';
    ctx.fill();
    ctx.strokeStyle = op.mine ? 'rgba(230,190,90,0.9)' : 'rgba(150,140,120,0.6)';
    ctx.lineWidth = op.mine ? 2 : 1.4;
    ctx.stroke();

    if (showEmoji) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(hexH * 0.30)}px serif`;
      ctx.fillText((OUTPOST_ICONS[op.terrain] || '⛺'), ocx, ocy + 1);
    }
    ctx.restore();
  }
  },

  screenToHex(mouseX, mouseY, camera, W, H) {
  // BODY MOVED VERBATIM from main.js _canvasPixelToHex (Phase 1); the canvas
  // W/H acquisition moved to the controller wrapper.
  const tpx = TILE_PX();
  const hexW = tpx;
  const hexH = Math.round(tpx * 1.1547);
  const hexVert = Math.round(hexH * 0.75);
  const camPxX = hexW * (camera.q + camera.r / 2);
  const camPxY = hexVert * camera.r;
  // Pixel → world pixel → fractional hex
  const worldX = mouseX - W/2 + camPxX;
  const worldY = mouseY - H/2 + camPxY;
  // Pointy-top axial inverse:
  // r = worldY / hexVert
  // q = worldX / hexW - r/2
  const fr = worldY / hexVert;
  const fq = worldX / hexW - fr / 2;
  // Round to nearest hex using cube rounding
  const fs = -fq - fr;
  let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
  const dq = Math.abs(rq-fq), dr = Math.abs(rr-fr), ds = Math.abs(rs-fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  const wq = ((rq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
  const wr = ((rr % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
  return { wq, wr };
  },

  hexToScreen(wq, wr, camera, W, H) {
    const p = KWMap.geom.firstVisibleCopyXY(wq, wr, W, H);
    return p ? { x: p.x + p.hexW / 2, y: p.y + p.hexH / 2 } : null;
  },

  invalidate(scope) { /* Phase 1: immediate-mode renderer — nothing cached */ },
  destroy() {},
});
