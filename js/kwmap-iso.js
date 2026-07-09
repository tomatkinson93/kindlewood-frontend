// ══════════════════════════════════════════════════════════════════════════
//  KWMap IsometricRenderer — Phase 2: iso ground plane + projection + hit-test
//  Spec: 09_SPEC_..._REFINED.md §2, §3.1 GROUND, §4, §6.7, §8.2 (partial).
//
//  Load order: AFTER kwmap-core.js + kwmap-assets.js, BEFORE main.js is fine
//  (classic scripts share global scope; every call happens at runtime). This
//  file NEVER references main.js symbols at load time.
//
//  What Phase 2 draws:
//    • fog cloud backdrop (reuses _fogImg exactly as top-down does)
//    • GROUND content via the provider pipeline — terrain faces + skirts +
//      water recesses (terrain provider) and claim borders (claims provider),
//      composited into a cached world-pixel GROUND buffer.
//    • temporary flat markers for settlements/outposts (disc + emoji) so the
//      map stays playable — these become real depth-sorted sprites in Phase 3.
//    • hover/selection uifx strokes, iso-projected (renderUiFx hook).
//
//  Non-negotiables honored: game logic stays axial; screen math lives here;
//  no Math.random (fog drift + placeholders are deterministic); no apiFetch;
//  no writes to worldMapData/gameData/tickResources. Core geometry
//  (geomParams/firstVisibleCopyXY) is NOT touched — the iso forward/inverse
//  transforms are pure functions defined below.
// ══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const KW = window.KWMap;
  const L = KW.L;

  // ── Constants (spec §2.2) — attached to the KWMap namespace, per the brief.
  //    Defined here (not in core) so the frozen core file is untouched.
  KW.ISO = { K: 0.60, ELEV_PX: 14, SKIRT_PX: 6 };
  KW.ELEVATION = {
    mountain: 2.5, hills: 1.25, ruins: 0.5,
    plains: 0, forest: 0, marsh: -0.3, river: -0.6,
  };
  const ISO = KW.ISO, ELEVATION = KW.ELEVATION;
  const ELEV_PLANES = [2.5, 1.25, 0.5];    // descending elevations in use (§4.3)

  const elevationOf = (terrain) => (terrain && ELEVATION[terrain] != null) ? ELEVATION[terrain] : 0;

  // ── Geometry (matches core's hex constants; iso squashes Y by ISO.K) ──────
  function geo(W, H) {
    const tpx = TILE_PX();
    const hexW = tpx;
    const hexH = Math.round(tpx * 1.1547);
    const hexVert = Math.round(hexH * 0.75);
    const faceH = Math.round(hexH * ISO.K);
    const cx = W / 2, cy = H / 2;
    const camPxX = hexW * (camera.q + camera.r / 2);
    const camPxY = hexVert * ISO.K * camera.r;
    return { tpx, hexW, hexH, hexVert, faceH, cx, cy, camPxX, camPxY, W, H };
  }

  // Forward transform (spec §2.3) — world-pixel ground plane (no elevation).
  const isoGroundX = (aq, ar, g) => g.hexW * (aq + ar / 2);
  const isoGroundY = (aq, ar, g) => g.hexVert * ISO.K * ar;

  // Base inverse (spec §2.4): screen px → wrap-normalized axial, ignoring
  // elevation. One added division vs. top-down's _canvasPixelToHex.
  function baseInverse(px, py, g) {
    const worldX = px - g.W / 2 + g.camPxX;
    const worldY = (py - g.H / 2 + g.camPxY) / ISO.K;      // ← the only new line
    const fr = worldY / g.hexVert;
    const fq = worldX / g.hexW - fr / 2;
    const fs = -fq - fr;
    let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
    const dq = Math.abs(rq - fq), dr = Math.abs(rr - fr), ds = Math.abs(rs - fs);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    const wq = ((rq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
    const wr = ((rr % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
    return { wq, wr };
  }

  // ── Tile lookup (for elevation-aware hit-testing + provider draws) ────────
  // Cached key→tile map. Terrain edits patch tile objects in place, so the
  // ref map stays valid; rebuilt on invalidate('all') / data swap.
  let _tileMap = null, _tileMapData = null;
  function tileMapFor(data) {
    if (_tileMap && _tileMapData === data) return _tileMap;
    const m = new Map();
    if (data && data.tiles) for (const t of data.tiles) m.set(t.q + ',' + t.r, t);
    _tileMap = m; _tileMapData = data;
    return m;
  }
  function terrainAt(wq, wr) {
    const m = tileMapFor(worldMapData);
    const t = m.get(wq + ',' + wr);
    return t ? t.terrain : null;
  }

  // ── First-visible-copy under iso projection ───────────────────────────────
  // Mirrors core.firstVisibleCopyXY's scan (window, order, dedup) but with the
  // iso Y squash. Returns the DRAWN copy's face top-left + centre in screen px.
  // elevInclude=true lifts the face by its terrain elevation (markers sit on
  // the lifted face); false gives the ground-plane position (overlays, §2.3).
  function isoScan(W, H, g) {
    const rowsVisible = Math.ceil(H / (g.hexVert * ISO.K)) + 10;
    const colsVisible = Math.ceil(W / g.hexW) + rowsVisible + 4;
    const qStart = camera.q - Math.ceil(colsVisible / 2);
    const rStart = camera.r - Math.ceil(rowsVisible / 2);
    return { rowsVisible, colsVisible, qStart, rStart };
  }

  function isoFirstVisibleCopy(wq, wr, W, H, elevInclude) {
    const g = geo(W, H);
    const s = isoScan(W, H, g);
    for (let dr = 0; dr < s.rowsVisible; dr++) {
      for (let dq = 0; dq < s.colsVisible; dq++) {
        const aq = s.qStart + dq, ar = s.rStart + dr;
        const cq = ((aq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
        const cr = ((ar % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
        if (cq !== wq || cr !== wr) continue;
        const elev = elevInclude ? elevationOf(terrainAt(cq, cr)) : 0;
        const x = g.cx + isoGroundX(aq, ar, g) - g.camPxX - g.hexW / 2;
        const y = g.cy + isoGroundY(aq, ar, g) - g.camPxY - g.faceH / 2 - elev * ISO.ELEV_PX;
        if (x < -g.hexW * 2 || x > W + g.hexW || y < -g.hexH * 2 || y > H + g.hexH) continue;
        return { x: Math.round(x), y: Math.round(y), cx: Math.round(x + g.hexW / 2), cy: Math.round(y + g.faceH / 2), hexW: g.hexW, faceH: g.faceH, g };
      }
    }
    return null;
  }

  // ── Iso hex path (squashed pointy-top face) + skirt polygon ───────────────
  function isoHexPath(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h * 0.25);
    ctx.lineTo(x + w, y + h * 0.75);
    ctx.lineTo(x + w / 2, y + h);
    ctx.lineTo(x, y + h * 0.75);
    ctx.lineTo(x, y + h * 0.25);
    ctx.closePath();
  }
  function skirtPath(ctx, x, y, w, h, skirtH) {
    // Front wall: lower-left → bottom → lower-right, extruded down by skirtH.
    const ll = [x, y + h * 0.75], bot = [x + w / 2, y + h], lr = [x + w, y + h * 0.75];
    ctx.beginPath();
    ctx.moveTo(ll[0], ll[1]);
    ctx.lineTo(bot[0], bot[1]);
    ctx.lineTo(lr[0], lr[1]);
    ctx.lineTo(lr[0], lr[1] + skirtH);
    ctx.lineTo(bot[0], bot[1] + skirtH);
    ctx.lineTo(ll[0], ll[1] + skirtH);
    ctx.closePath();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Built-in GROUND providers (spec §3.0/§3.1) — registered on the layer
  //  stack so the registry is exercised, not decorative. Read-only consumers.
  // ══════════════════════════════════════════════════════════════════════════

  // terrain: face + skirt + (recess for negative-elevation water). heightPx 0.
  const terrainProvider = {
    id: 'terrain', layer: L.TERRAIN, space: 'world',
    collect(view, mapState) {
      const out = [];
      if (!mapState || !mapState.tiles) return out;
      for (const t of mapState.tiles) {
        if (!t || t.terrain === 'fog') continue;   // fog tiles draw no face
        out.push({ wq: t.q, wr: t.r, layer: L.TERRAIN, heightPx: 0, t });
      }
      return out;
    },
    draw(ctx, x, y, ctx3) {
      const { t, g, seasonId } = ctx3;
      const terrain = t.terrain;
      const elev = elevationOf(terrain);
      const face = KWMap.assets.terrainFace(terrain, t.q, t.r, seasonId);
      const skirtH = ISO.SKIRT_PX + Math.max(0, elev) * ISO.ELEV_PX;

      // Skirt (side wall) behind the face.
      if (skirtH > 0.5) {
        ctx.save();
        skirtPath(ctx, x, y, g.hexW, g.faceH, skirtH);
        ctx.fillStyle = face.skirt;
        ctx.fill();
        ctx.restore();
      }
      // Top face — squashed art clipped to the iso hex, 1px overdraw kills seams.
      ctx.save();
      isoHexPath(ctx, x, y, g.hexW, g.faceH);
      ctx.clip();
      const src = face.canvas;
      if (src && (src.width || src.naturalWidth)) {
        ctx.drawImage(src, x - 1, y - 1, g.hexW + 2, g.faceH + 2);
      } else {
        ctx.fillStyle = (typeof TERRAIN_COLORS !== 'undefined' && TERRAIN_COLORS[terrain]) || '#2a2010';
        ctx.fill();
      }
      // Recessed water: darken toward the low edge to read as sunken.
      if (elev < 0) {
        ctx.fillStyle = 'rgba(20,34,44,0.35)';
        ctx.fill();
      }
      ctx.restore();
    },
  };

  // claims: quiet ink border, clipped to the face (same language as top-down).
  const claimsProvider = {
    id: 'claims', layer: L.CLAIM_BORDER, space: 'world',
    collect(view, mapState) {
      const out = [];
      if (!mapState || !mapState.tiles) return out;
      for (const t of mapState.tiles) {
        if (!t || t.terrain === 'fog') continue;
        if (t.claimed_by_me || t.claim_owner) out.push({ wq: t.q, wr: t.r, layer: L.CLAIM_BORDER, heightPx: 0, t });
      }
      return out;
    },
    draw(ctx, x, y, ctx3) {
      const { t, g } = ctx3;
      ctx.save();
      isoHexPath(ctx, x, y, g.hexW, g.faceH);
      ctx.clip();
      isoHexPath(ctx, x, y, g.hexW, g.faceH);
      ctx.strokeStyle = t.claimed_by_me ? 'rgba(212,175,80,0.60)' : 'rgba(145,155,165,0.45)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    },
  };

  // Register with the controller (dedup-safe; layer-sorted). The iso renderer
  // consumes controller.listProviders() filtered to the ground group.
  KW.controller.register(terrainProvider);
  KW.controller.register(claimsProvider);

  const GROUND_LAYERS = [L.TERRAIN, L.ROAD, L.RIVER_OVERLAY, L.CLAIM_BORDER];   // + flat DECOR later
  const isGroundLayer = (layer) => GROUND_LAYERS.indexOf(layer) !== -1;

  // ══════════════════════════════════════════════════════════════════════════
  //  The renderer
  // ══════════════════════════════════════════════════════════════════════════
  const MARGIN = 160;                 // GROUND buffer margin per side (px). One
                                      // screen would be spec-ideal; tuned smaller
                                      // for v1 memory, revisited in Phase 6.

  const IsometricRenderer = {
    id: 'iso',
    _ground: null,                    // { canvas, ctx, bufWX, bufWY, bwCss, bhCss, camWX0, camWY0, dpr, W, H, seasonKey }
    _rebuildCount: 0,
    _lastRebuildMs: 0,
    _lastFrameMs: 0,
    _invalid: true,                   // force a rebuild
    _hud: null,

    camWX() { const g = geo(1, 1); return g.camPxX; },   // camera world-x (size-independent)
    camWY() { const g = geo(1, 1); return g.camPxY; },

    // ── render one frame ────────────────────────────────────────────────────
    render(frame) {
      const { ctx, W, H, dpr } = frame;
      const data = frame.data;
      if (!data || !data.tiles) return;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
      const g = geo(W, H);
      const seasonId = data.seasonId || _currentSeasonId();

      // 1. Clear to the unified border tone (same as top-down's clear).
      ctx.fillStyle = '#3a2e22';
      ctx.fillRect(0, 0, W, H);

      // 2. Fog cloud backdrop — verbatim treatment from top-down.
      _drawFogBackdrop(ctx, W, H);

      // 3. GROUND buffer — rebuild if needed, then blit.
      this._ensureGround(g, W, H, dpr, seasonId, data);
      const gr = this._ground;
      if (gr) {
        const blitX = Math.round(g.cx + gr.bufWX - g.camPxX);
        const blitY = Math.round(g.cy + gr.bufWY - g.camPxY);
        ctx.drawImage(gr.canvas, blitX, blitY, gr.bwCss, gr.bhCss);
      }

      // 4. Temporary flat markers (settlements/outposts) — Phase 3 makes these
      //    real depth-sorted sprites in the TALL buffer.
      _drawMarkers(ctx, W, H, data);

      this._lastFrameMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      if (_debug) this._drawHud(g, seasonId);
    },

    // ── GROUND buffer lifecycle ───────────────────────────────────────────
    _ensureGround(g, W, H, dpr, seasonId, data) {
      const camWX = g.camPxX, camWY = g.camPxY;
      const gr = this._ground;
      const bwCss = W + 2 * MARGIN, bhCss = H + 2 * MARGIN;
      const need = this._invalid || !gr
        || gr.W !== W || gr.H !== H || gr.dpr !== dpr
        || gr.seasonKey !== seasonId
        || Math.abs(camWX - gr.camWX0) > MARGIN
        || Math.abs(camWY - gr.camWY0) > MARGIN;
      if (!need) return;

      let canvas, bctx;
      if (gr && gr.canvas && gr.bwCss === bwCss && gr.bhCss === bhCss && gr.dpr === dpr) {
        canvas = gr.canvas; bctx = gr.ctx;
      } else {
        canvas = document.createElement('canvas');
        canvas.width = Math.round(bwCss * dpr);
        canvas.height = Math.round(bhCss * dpr);
        bctx = canvas.getContext('2d');
      }
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bctx.clearRect(0, 0, bwCss, bhCss);

      const bufWX = camWX - g.cx - MARGIN;
      const bufWY = camWY - g.cy - MARGIN;
      this._rebuildGround(bctx, g, bufWX, bufWY, bwCss, bhCss, seasonId, data);

      this._ground = {
        canvas, ctx: bctx, bufWX, bufWY, bwCss, bhCss,
        camWX0: camWX, camWY0: camWY, dpr, W, H, seasonKey: seasonId,
      };
      this._invalid = false;
      this._rebuildCount++;
    },

    // Paint the ground group into the buffer (buffer-pixel space). Tiles are
    // scanned in window/dedup order (row-ascending = back→front) so raised
    // terrain faces correctly overlap the tiles behind them. Providers are
    // applied in layer order: all terrain (scan order), then all claims.
    _rebuildGround(bctx, g, bufWX, bufWY, bwCss, bhCss, seasonId, data) {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);

      // Visible tiles covering the BUFFER region, deduped in scan order.
      const rowsVisible = Math.ceil(bhCss / (g.hexVert * ISO.K)) + 12;
      const colsVisible = Math.ceil(bwCss / g.hexW) + rowsVisible + 4;
      // Buffer's top-left world point maps to (bufWX, bufWY). Centre the scan
      // on the buffer centre in axial space.
      const centreWX = bufWX + bwCss / 2, centreWY = bufWY + bhCss / 2;
      const centreR = (centreWY / (g.hexVert * ISO.K));
      const centreQ = (centreWX / g.hexW) - centreR / 2;
      const qStart = Math.round(centreQ) - Math.ceil(colsVisible / 2);
      const rStart = Math.round(centreR) - Math.ceil(rowsVisible / 2);

      const seen = new Set();
      const visible = [];              // scan order
      for (let dr = 0; dr < rowsVisible; dr++) {
        for (let dq = 0; dq < colsVisible; dq++) {
          const aq = qStart + dq, ar = rStart + dr;
          const wq = ((aq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
          const wr = ((ar % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
          const key = wq + ',' + wr;
          if (seen.has(key)) continue;
          // buffer-pixel face top-left (ground plane; elevation applied per-tile)
          const gx = isoGroundX(aq, ar, g) - g.hexW / 2 - bufWX;
          const gy = isoGroundY(aq, ar, g) - g.faceH / 2 - bufWY;
          if (gx < -g.hexW * 2 || gx > bwCss + g.hexW || gy < -g.hexH * 2 || gy > bhCss + g.hexH) continue;
          seen.add(key);
          visible.push({ wq, wr, gx, gy });
        }
      }

      const map = tileMapFor(data);
      const providers = KW.controller.listProviders()
        .filter(p => p.space !== 'screen' && isGroundLayer(p.layer))
        .sort((a, b) => a.layer - b.layer);

      const view = { qStart, rStart, rowsVisible, colsVisible, g, seasonId };
      const ctx3base = { g, seasonId, frame: null };
      for (const p of providers) {
        if (typeof p.collect !== 'function' || typeof p.draw !== 'function') continue;
        const drawables = p.collect(view, data) || [];
        const byKey = new Map();
        for (const d of drawables) byKey.set(d.wq + ',' + d.wr, d);
        for (const vt of visible) {      // scan order → correct overlap
          const d = byKey.get(vt.wq + ',' + vt.wr);
          if (!d) continue;
          const t = d.t || map.get(vt.wq + ',' + vt.wr);
          if (!t) continue;
          const elev = elevationOf(t.terrain);
          const x = vt.gx, y = vt.gy - elev * ISO.ELEV_PX;   // lift the face
          ctx3base.t = t; ctx3base.wq = vt.wq; ctx3base.wr = vt.wr;
          p.draw(bctx, x, y, ctx3base);
        }
      }

      this._lastRebuildMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    },

    // ── Interaction ─────────────────────────────────────────────────────────
    // Ground-plane base-footprint picking with an elevation-compensated scan
    // for raised terrain top faces (spec §4.3). Feature/object sprites never
    // capture clicks.
    screenToHex(px, py, cam, W, H) {
      const g = geo(W, H);
      for (const e of ELEV_PLANES) {
        const cand = baseInverse(px, py + e * ISO.ELEV_PX, g);
        if (cand && elevationOf(terrainAt(cand.wq, cand.wr)) >= e) return cand;
      }
      return baseInverse(px, py, g);       // flat/recessed ground plane
    },

    // Ground-plane tile centre (no elevation) — overlay/panel anchoring (§2.3).
    hexToScreen(wq, wr, cam, W, H) {
      const p = isoFirstVisibleCopy(wq, wr, W, H, false);
      return p ? { x: p.cx, y: p.cy } : null;
    },

    // uifx strokes (hover / selection / fog-selection), iso-projected on the
    // ground plane. Mirrors the top-down conditions/styles (isOwn suppression,
    // selFog-beats-hover on the same tile). Runs on the uifx canvas.
    renderUiFx(ctx, W, H, ui, cam) {
      if (!ui) return;
      const tm = tileMapFor(worldMapData);
      const strokeHex = (p) => isoHexPath(ctx, p.x, p.y, p.hexW, p.faceH);

      // selection ring
      if (ui.selected) {
        const t = tm.get(ui.selected.wq + ',' + ui.selected.wr);
        if (!(t && t.settlement && t.settlement.isOwn)) {
          const p = isoFirstVisibleCopy(ui.selected.wq, ui.selected.wr, W, H, false);
          if (p) {
            strokeHex(p);
            ctx.strokeStyle = 'rgba(255,220,80,0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
            ctx.fillStyle = 'rgba(255,220,80,0.08)'; ctx.fill();
          }
        }
      }
      // fog selection
      if (ui.selectedFog) {
        const t = tm.get(ui.selectedFog.wx + ',' + ui.selectedFog.wy);
        if (!(t && t.settlement && t.settlement.isOwn)) {
          const p = isoFirstVisibleCopy(ui.selectedFog.wx, ui.selectedFog.wy, W, H, false);
          if (p) { strokeHex(p); ctx.strokeStyle = 'rgba(220,175,60,0.85)'; ctx.lineWidth = 2; ctx.stroke(); }
        }
      }
      // hover (selFog on the same tile wins → suppress hover there)
      if (ui.hovered) {
        const sf = ui.selectedFog;
        const dup = sf && sf.wx === ui.hovered.wq && sf.wy === ui.hovered.wr;
        const t = tm.get(ui.hovered.wq + ',' + ui.hovered.wr);
        if (!dup && !(t && t.settlement && t.settlement.isOwn)) {
          const p = isoFirstVisibleCopy(ui.hovered.wq, ui.hovered.wr, W, H, false);
          if (p) {
            const isFog = !t || t.terrain === 'fog';
            ctx.save(); strokeHex(p); ctx.clip();
            if (!isFog) {
              strokeHex(p); ctx.strokeStyle = 'rgba(255,210,80,0.9)'; ctx.lineWidth = 3; ctx.stroke();
            } else {
              ctx.fillStyle = 'rgba(210,160,50,0.18)'; ctx.fill();
              strokeHex(p); ctx.strokeStyle = 'rgba(220,175,60,0.85)'; ctx.lineWidth = 3; ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
    },

    invalidate(scope) {
      this._invalid = true;
      if (scope === 'all') { _tileMap = null; _tileMapData = null; }
    },
    destroy() { this._ground = null; },

    // ── Dev HUD (?kwmapdebug=1) ───────────────────────────────────────────
    _drawHud(g, seasonId) {
      const el = _ensureHud();
      if (!el) return;
      el.textContent =
        `iso · frame ${this._lastFrameMs.toFixed(1)}ms · rebuild ${this._lastRebuildMs.toFixed(1)}ms · ` +
        `rebuilds ${this._rebuildCount} · season ${seasonId || '—'}`;
    },
  };

  // ── Fog backdrop (reused verbatim from top-down's treatment) ──────────────
  function _drawFogBackdrop(ctx, W, H) {
    if (typeof _fogImg === 'undefined' || !_fogImg.complete || !_fogImg.naturalWidth) return;
    const driftRange = Math.max(W, H) * 0.08;
    const drawSize = Math.max(W, H) + driftRange * 2;
    const off = (typeof _fogOffset !== 'undefined') ? _fogOffset : 0;
    const driftX = Math.sin(off * 0.0012) * driftRange;
    const driftY = Math.cos(off * 0.0008) * driftRange;
    ctx.globalAlpha = _fogImg._painted ? 0.94 : 0.58;
    ctx.drawImage(_fogImg, (W - drawSize) / 2 + driftX, (H - drawSize) / 2 + driftY, drawSize, drawSize);
    ctx.globalAlpha = 1;
  }

  // ── Temporary settlement / outpost markers (screen-space, per frame) ──────
  function _drawMarkers(ctx, W, H, data) {
    if (!data || !data.tiles) return;
    const showEmoji = TILE_PX() >= 36;
    for (const t of data.tiles) {
      if (!t || (!t.settlement && !t.outpost)) continue;
      const p = isoFirstVisibleCopy(t.q, t.r, W, H, true);
      if (!p) continue;
      const cx = p.cx, cy = p.cy;
      const r2 = Math.min(p.hexW, p.faceH) * 0.7;
      if (t.settlement) {
        const s = t.settlement;
        const sType = s.settlement_type || (s.is_kingdom ? 'kingdom' : s.disposition === 'hostile' ? 'hostile' : (s.isOwn ? 'player' : 'npc'));
        let fill = 'rgba(200,160,60,0.85)', ring = 'rgba(255,210,120,0.95)', glyph = '🏘';
        if (sType === 'kingdom') { fill = 'rgba(140,100,5,0.85)'; ring = 'rgba(255,215,50,0.98)'; glyph = '👑'; }
        else if (sType === 'hostile') { fill = 'rgba(100,8,8,0.85)'; ring = 'rgba(240,50,30,0.95)'; glyph = '💀'; }
        else if (sType === 'npc') { fill = 'rgba(20,110,80,0.85)'; ring = 'rgba(60,220,150,0.95)'; glyph = '🏡'; }
        else if (s.isOwn) { fill = 'rgba(60,90,150,0.85)'; ring = 'rgba(255,210,120,0.95)'; glyph = '🏘'; }
        ctx.beginPath(); ctx.arc(cx, cy, r2, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = ring; ctx.lineWidth = 2.2; ctx.stroke();
        if (showEmoji) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(p.faceH * 0.7)}px serif`; ctx.fillText(glyph, cx, cy); }
      } else if (t.outpost && !t.settlement) {
        const op = t.outpost;
        const orr = Math.min(p.hexW, p.faceH) * 0.42;
        ctx.beginPath(); ctx.arc(cx, cy, orr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(40,30,18,0.78)'; ctx.fill();
        ctx.strokeStyle = op.mine ? 'rgba(230,190,90,0.9)' : 'rgba(150,140,120,0.6)';
        ctx.lineWidth = op.mine ? 2 : 1.4; ctx.stroke();
        if (showEmoji) {
          const glyph = (typeof OUTPOST_ICONS !== 'undefined' && OUTPOST_ICONS[op.terrain]) || '⛺';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(p.faceH * 0.55)}px serif`;
          ctx.fillText(glyph, cx, cy + 1);
        }
      }
    }
  }

  // ── Season id (DOM-class-driven, decoupled like season-atmosphere.js) ─────
  function _currentSeasonId() {
    const sg = document.getElementById('screen-game');
    if (!sg) return null;
    const m = sg.className.match(/season-(spring|summer|autumn|winter)/);
    return m ? m[1] : null;
  }

  // ── Dev flags ─────────────────────────────────────────────────────────────
  const _params = (() => {
    try { return new URLSearchParams((window.location && window.location.search) || ''); }
    catch (e) { return { get: () => null }; }
  })();
  const _debug = _params.get('kwmapdebug') === '1';

  let _hudEl = null;
  function _ensureHud() {
    if (_hudEl) return _hudEl;
    if (typeof document === 'undefined' || !document.body) return null;
    const el = document.createElement('div');
    el.id = 'kwmap-dev-hud';
    el.style.cssText = 'position:absolute;top:6px;left:6px;z-index:9999;font:11px/1.4 monospace;' +
      'background:rgba(0,0,0,0.62);color:#9fe;padding:4px 7px;border-radius:4px;pointer-events:none;white-space:nowrap;';
    (document.getElementById('map-frame') || document.body).appendChild(el);
    _hudEl = el;
    return el;
  }

  // ── Register + activate ────────────────────────────────────────────────────
  KW.controller.registerRenderer('iso', IsometricRenderer);

  // Temporary URL flag to test the iso view before the Phase 7 settings UI.
  // Persists via setRenderer so it survives the map's async load; clear with
  // ?kwmapview=topdown or by switching in the (future) settings panel.
  function _applyViewFlag() {
    const v = _params.get('kwmapview');
    if (v === 'iso' || v === 'topdown') KW.controller.setRenderer(v);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _applyViewFlag);
  } else {
    _applyViewFlag();
  }
})();
