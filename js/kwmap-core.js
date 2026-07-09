// ══════════════════════════════════════════════════════════════════════════
//  KWMap CORE — namespace, layer stack, provider registry, MapViewController
//  Phase 1 of the map renderer upgrade (spec: 09_SPEC_..._REFINED.md §1, §3.0)
//
//  Load order: AFTER pixelart.js, BEFORE kwmap-topdown.js and main.js.
//  No bundler — classic script attaching to window.KWMap. This file defines
//  behavior MOVED MECHANICALLY from main.js (camera, input, render loop,
//  HiDPI frame prep, hover/selection strokes). Logic is verbatim from the
//  deployed main.js unless a comment says otherwise; the Phase-1 identity
//  proofs (verify/) depend on that.
//
//  Sanctioned behavior changes in this phase (spec §11 P1, §13):
//    1. The render loop pauses when the map is off-screen or the tab is
//       hidden (was: permanent rAF burning CPU on hidden maps).
//    2. Hover/selection/fog-selection strokes draw on a new #map-uifx-canvas
//       above the atmosphere canvas (layers 140–160) — identical geometry,
//       styles, and conditions; different canvas.
//  Everything else must render pixel-identically.
// ══════════════════════════════════════════════════════════════════════════

// Globals kept with their original main.js names so every existing reference
// (in main.js delegates or any other frontend file) keeps working unchanged.
var camera = { q: 20, r: 15 };          // moved from main.js
var _fogOffset = 0;                     // moved from main.js (read by topdown render)
var _canvas = null, _ctx = null;        // moved from main.js

function _getCanvas() {                 // moved from main.js — verbatim
  if (_canvas) return _canvas;
  _canvas = document.getElementById('map-canvas');
  if (_canvas) _ctx = _canvas.getContext('2d', { alpha: false });
  return _canvas;
}

// ── Shared hex geometry (pointy-top) ───────────────────────────────────────
// The exact formulas from main.js's render/hit-test paths, in one place.
// TILE_PX() is defined in main.js (loads after this file) — all calls happen
// at runtime, never at load time, so the order is safe.

function _hexPath(ctx, cx, cy, hw, hh) {      // moved from main.js — verbatim
  ctx.beginPath();
  ctx.moveTo(cx,            cy - hh / 2);
  ctx.lineTo(cx + hw / 2,   cy - hh / 4);
  ctx.lineTo(cx + hw / 2,   cy + hh / 4);
  ctx.lineTo(cx,            cy + hh / 2);
  ctx.lineTo(cx - hw / 2,   cy + hh / 4);
  ctx.lineTo(cx - hw / 2,   cy - hh / 4);
  ctx.closePath();
}

function _hexPathLT(ctx, x, y, w, h) {        // moved from main.js — verbatim
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w,     y + h * 0.25);
  ctx.lineTo(x + w,     y + h * 0.75);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x,         y + h * 0.75);
  ctx.lineTo(x,         y + h * 0.25);
  ctx.closePath();
}

window.KWMap = (() => {
  'use strict';

  // ── Layer stack (spec §3.0) — the extension contract ────────────────────
  const L = {
    TERRAIN:         10,
    TERRAIN_FEATURE: 15,
    ROAD:            20,
    RIVER_OVERLAY:   30,
    DECOR:           40,
    BUILDING:        50,
    OUTPOST:         60,
    CLAIM_BORDER:    70,
    QUEST_MARKER:    80,
    NPC:             90,
    PLAYER:         100,
    FOG:            110,
    WEATHER:        120,
    PARTICLES:      130,
    SELECTION:      140,
    COMBAT:         150,
    RESOURCE_ICONS: 160,
  };

  // Provider registry. Phase 1 stores and validates registrations; the iso
  // renderer (Phase 2) consumes them natively; top-down joins in Phase 4a.
  // Registering today is safe and forward-compatible — that's the point.
  const providers = [];
  function register(provider) {
    if (!provider || typeof provider.layer !== 'number' || !provider.id) {
      console.warn('[KWMap] register(): provider needs { id, layer }', provider);
      return false;
    }
    if (providers.some(p => p.id === provider.id)) {
      console.warn(`[KWMap] register(): duplicate provider id "${provider.id}"`);
      return false;
    }
    if (provider.space !== 'screen') provider.space = 'world';
    providers.push(provider);
    providers.sort((a, b) => a.layer - b.layer);
    return true;
  }

  // ── Geometry: first-visible-copy tile position ──────────────────────────
  // EXACTLY the collection math from the top-down render pass (same window,
  // same scan order, same rounding), so uifx strokes land on the same pixels
  // the world pass would have used. Any change here breaks the identity proof.
  function geomParams(W, H) {
    const tpx     = TILE_PX();
    const hexW    = tpx;
    const hexH    = Math.round(tpx * 1.1547);
    const hexVert = Math.round(hexH * 0.75);
    const rowsVisible = Math.ceil(H / hexVert) + 8;
    const colsVisible = Math.ceil(W / hexW) + rowsVisible + 4;
    const cx = W / 2, cy = H / 2;
    const camPxX = hexW * (camera.q + camera.r / 2);
    const camPxY = hexVert * camera.r;
    const qStart = camera.q - Math.ceil(colsVisible / 2);
    const rStart = camera.r - Math.ceil(rowsVisible / 2);
    return { tpx, hexW, hexH, hexVert, rowsVisible, colsVisible, cx, cy, camPxX, camPxY, qStart, rStart };
  }

  function firstVisibleCopyXY(wq, wr, W, H) {
    const g = geomParams(W, H);
    for (let dr = 0; dr < g.rowsVisible; dr++) {
      for (let dq = 0; dq < g.colsVisible; dq++) {
        const aq = g.qStart + dq, ar = g.rStart + dr;
        const cq = ((aq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
        const cr = ((ar % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
        if (cq !== wq || cr !== wr) continue;
        const x = g.cx + g.hexW * (aq + ar / 2) - g.camPxX - g.hexW / 2;
        const y = g.cy + g.hexVert * ar - g.camPxY - g.hexH / 2;
        if (x < -g.hexW * 2 || x > W + g.hexW || y < -g.hexH * 2 || y > H + g.hexH) continue;
        return { x: Math.round(x), y: Math.round(y), hexW: g.hexW, hexH: g.hexH,
                 scan: dr * g.colsVisible + dq };   // window scan position — uifx
                                                    // replays strokes in the same
                                                    // order the old per-tile pass did
      }
    }
    return null;
  }

  // ── MapViewController ────────────────────────────────────────────────────
  const controller = {
    camera,        // the shared global — same object, one source of truth
    activeId: 'topdown',
    _renderers: {},
    _uifx: null, _uifxCtx: null,
    _rafId: null,
    _visible: true,          // IntersectionObserver verdict (true until observed)
    _wantFrame: false,       // single-shot render requested while loop is off
    _lastTs: 0,
    _inputInit: false,

    registerRenderer(id, renderer) { this._renderers[id] = renderer; },

    setRenderer(id) {
      if (!this._renderers[id]) {
        console.warn(`[KWMap] unknown renderer "${id}" — keeping "${this.activeId}"`);
        return;
      }
      this.activeId = id;
      try { localStorage.setItem('kw_map_view', id); } catch (e) {}
      const r = this._renderers[id];
      if (r.invalidate) r.invalidate('all');
      this.requestRender();
    },

    get active() { return this._renderers[this.activeId]; },

    register,                 // provider registry (layer stack)
    invalidateLayer(idOrLayer) {
      // Phase 1: providers aren't consumed yet — an invalidation is a redraw.
      this.requestRender();
    },
    invalidate(scope) {
      const r = this.active;
      if (r && r.invalidate) r.invalidate(scope);
      this.requestRender();
    },

    // ── Camera (bodies moved verbatim from main.js) ──────────────────────
    pan(dx, dy) {
      camera.q += dx;
      camera.r += dy;
      if (worldMapData) renderWorldMap(worldMapData);
    },
    centreOnPlayer() {
      if (worldMapData?.playerSettlement) {
        camera.q = worldMapData.playerSettlement.q;
        camera.r = worldMapData.playerSettlement.r;
        renderWorldMap(worldMapData);
      }
    },

    // ── Hit-testing (forwarded — input code never branches on view) ─────
    screenToHex(px, py) {
      const canvas = _getCanvas();
      if (!canvas) return null;
      const W = canvas.clientWidth || canvas.width;
      const H = canvas.clientHeight || canvas.height;
      const r = this.active;
      return r ? r.screenToHex(px, py, camera, W, H) : null;
    },
    hexToScreen(wq, wr) {
      const canvas = _getCanvas();
      if (!canvas) return null;
      const W = canvas.clientWidth || canvas.width;
      const H = canvas.clientHeight || canvas.height;
      const p = firstVisibleCopyXY(wq, wr, W, H);
      return p ? { x: p.x + p.hexW / 2, y: p.y + p.hexH / 2 } : null;
    },

    // ── Frame prep + draw ────────────────────────────────────────────────
    // Preamble moved verbatim from _doRenderCanvas (HiDPI resize + transform).
    _prepFrame() {
      const canvas = _getCanvas();
      if (!canvas) return null;

      const frame = document.getElementById('map-frame');
      const W = frame ? (frame.offsetWidth  || frame.clientWidth  || MAP_FRAME_W) : (canvas.clientWidth  || MAP_FRAME_W);
      const H = frame ? (frame.offsetHeight || frame.clientHeight || MAP_FRAME_H) : (canvas.clientHeight || MAP_FRAME_H);
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width  = W + 'px';
        canvas.style.height = H + 'px';
      }
      _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this._ensureUifx(canvas, W, H, dpr);
      return { ctx: _ctx, W, H, dpr };
    },

    renderFrame(now) {
      if (!worldMapData) return;
      const prep = this._prepFrame();
      if (!prep) return;
      const r = this.active;
      if (!r) return;
      r.render({
        ctx: prep.ctx, W: prep.W, H: prep.H, dpr: prep.dpr,
        camera, data: worldMapData,
        ui: { hovered: _hoveredTile, selected: _selectedTile, selectedFog: _selectedFogTile },
        now,
      });
      this._renderUiFx(prep.W, prep.H, prep.dpr);
    },

    requestRender() {
      if (this._rafId !== null) return;      // loop active — next tick draws
      if (this._loopShouldRun()) { this.startLoop(); return; }
      // Hidden/gated: draw one frame synchronously so state changes (e.g. a
      // build response arriving mid-scroll-away) aren't lost.
      this.renderFrame(performance.now());
    },

    // ── The render loop (absorbs main.js's _startFogAnimation) ──────────
    // Same tick body: dt, fog drift advance, draw. New: visibility gating.
    _loopShouldRun() {
      return this._visible && !document.hidden;
    },

    startLoop() {
      if (this._rafId !== null) return;
      if (!this._loopShouldRun()) return;
      this._lastTs = 0;
      const tick = (ts) => {
        this._rafId = null;
        if (!this._loopShouldRun()) return;              // gate: stop cleanly
        const dt = this._lastTs ? (ts - this._lastTs) : 16;
        this._lastTs = ts;
        _fogOffset += dt * 0.018;  // no modulo — smooth infinite drift, no reset
        if (worldMapData) this.renderFrame(ts);
        this._rafId = requestAnimationFrame(tick);
      };
      this._rafId = requestAnimationFrame(tick);
    },

    stopLoop() {
      if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    },

    _initGating() {
      const canvas = _getCanvas();
      if (!canvas || canvas._kwGated) return;
      canvas._kwGated = true;
      if (typeof IntersectionObserver !== 'undefined') {
        new IntersectionObserver((entries) => {
          this._visible = entries[0].isIntersecting;
          if (this._visible) this.startLoop(); else this.stopLoop();
        }).observe(canvas);
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stopLoop(); else this.startLoop();
      });
    },

    // ── uifx canvas (layers 140–160) ─────────────────────────────────────
    _ensureUifx(mapCanvas, W, H, dpr) {
      if (!this._uifx) {
        const c = document.createElement('canvas');
        c.id = 'map-uifx-canvas';
        c.setAttribute('aria-hidden', 'true');
        c.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
        // Above the atmosphere canvas if present, else above the map canvas —
        // later DOM siblings paint above; pan buttons come later still.
        const atmo = document.getElementById('season-atmosphere-canvas');
        (atmo || mapCanvas).insertAdjacentElement('afterend', c);
        this._uifx = c;
        this._uifxCtx = c.getContext('2d');
      }
      const c = this._uifx;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width  = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      this._uifxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    // The hover/selection/fog-selection stroke blocks, moved from the render
    // pass ("Pass 2") with IDENTICAL conditions, styles, and geometry — the
    // tile position comes from firstVisibleCopyXY, which replicates the
    // world pass's collection math exactly. The isHome guard is preserved:
    // home tiles keep their (world-pass) stroke and suppress hover/fog-sel
    // strokes here, exactly as the original else-chain did.
    _renderUiFx(W, H) {
      const ctx = this._uifxCtx;
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      if (!worldMapData || !worldMapData.tiles) return;

      const ui = { hovered: _hoveredTile, selected: _selectedTile, selectedFog: _selectedFogTile };
      if (!ui.hovered && !ui.selected && !ui.selectedFog) return;

      const tileOf = (wq, wr) => {
        // small lookup — at most 3 tiles per frame
        for (const t of worldMapData.tiles) if (t.q === wq && t.r === wr) return t;
        return null;
      };

      // The OLD pass drew these strokes per tile, in window-scan order, with
      // the selected block before the isHome/isSelFog/isHovered chain. To keep
      // the relocation provably order-identical, tasks are sorted by
      // (scan position, in-tile priority) before drawing.
      const tasks = [];
      const push = (wq, wr, prio, fn) => {
        const p = firstVisibleCopyXY(wq, wr, W, H);
        if (!p) return;
        tasks.push({ scan: p.scan, prio, p, t: tileOf(wq, wr), fn });
      };

      // prio 0 — isSelected && !isHome  (verbatim block)
      if (ui.selected) {
        push(ui.selected.wq, ui.selected.wr, 0, (x, y, hexW, hexH, t) => {
          if (t?.settlement?.isOwn) return;
          _hexPathLT(ctx, x, y, hexW, hexH);
          ctx.strokeStyle = 'rgba(255,220,80,0.95)';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          // Inner glow fill
          ctx.fillStyle = 'rgba(255,220,80,0.08)';
          ctx.fill();
        });
      }

      // prio 1 — the else-chain after the (world-pass) isHome stroke
      if (ui.selectedFog) {
        push(ui.selectedFog.wx, ui.selectedFog.wy, 1, (x, y, hexW, hexH, t) => {
          if (t?.settlement?.isOwn) return;
          _hexPathLT(ctx, x, y, hexW, hexH);
          ctx.strokeStyle = 'rgba(220,175,60,0.85)';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      }

      if (ui.hovered) {
        const sf = ui.selectedFog;
        const hoveringSelFog = sf && sf.wx === ui.hovered.wq && sf.wy === ui.hovered.wr;
        if (!hoveringSelFog) {   // original chain: isSelFog wins over hover on the same tile
          push(ui.hovered.wq, ui.hovered.wr, 1, (x, y, hexW, hexH, t) => {
            if (t?.settlement?.isOwn) return;
            const isFog = !t || t.terrain === 'fog';
            if (!isFog) {
              // Terrain hover — clip so stroke doesn't bleed onto adjacent tiles
              ctx.save();
              _hexPathLT(ctx, x, y, hexW, hexH);
              ctx.clip();
              _hexPathLT(ctx, x, y, hexW, hexH);
              ctx.strokeStyle = 'rgba(255,210,80,0.9)';
              ctx.lineWidth = 3;
              ctx.stroke();
              ctx.restore();
            } else {
              // Fog hover — clip, then fill + outline
              ctx.save();
              _hexPathLT(ctx, x, y, hexW, hexH);
              ctx.clip();
              ctx.fillStyle = 'rgba(210,160,50,0.18)';
              ctx.fill();
              _hexPathLT(ctx, x, y, hexW, hexH);
              ctx.strokeStyle = 'rgba(220,175,60,0.85)';
              ctx.lineWidth = 3;
              ctx.stroke();
              ctx.restore();
            }
          });
        }
      }

      tasks.sort((a, b) => (a.scan - b.scan) || (a.prio - b.prio));
      for (const task of tasks) task.fn(task.p.x, task.p.y, task.p.hexW, task.p.hexH, task.t);
    },

    // ── Input (bodies moved verbatim from main.js's _initMapDrag +
    //    keyboard-pan block; hit-testing goes through screenToHex) ─────────
    initInput() {
      if (this._inputInit) return;
      const canvas = _getCanvas();
      if (!canvas || canvas._dragInit) return;
      this._inputInit = true;
      canvas._dragInit = true;
      const self = this;

      // Zoom removed — scroll wheel disabled

      // Click — hit test hex
      canvas.addEventListener('click', e => {
        if (_wasDrag) return; // don't fire click after drag
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hex = self.screenToHex(mx, my);
        if (!hex) return;
        const tileMap = {};
        worldMapData?.tiles?.forEach(t => { tileMap[`${t.q},${t.r}`] = t; });
        const t = tileMap[`${hex.wq},${hex.wr}`];
        if (!t || t.terrain === 'fog') {
          _selectedTile = { wq: hex.wq, wr: hex.wr };
          selectFogTile(hex.wq, hex.wr);
        } else {
          _selectedTile = { wq: hex.wq, wr: hex.wr };
          selectWorldTile(t);
        }
      });

      // Hover tracking
      canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hex = self.screenToHex(mx, my);
        if (hex) {
          const prev = _hoveredTile;
          if (!prev || prev.wq !== hex.wq || prev.wr !== hex.wr) {
            _hoveredTile = hex;
            // Only re-render for hover if the loop isn't already doing it
            if (self._rafId === null) renderWorldMap(worldMapData);
          }
        }
      });
      canvas.addEventListener('mouseleave', () => {
        _hoveredTile = null;
      });

      // Drag pan
      let _wasDrag = false;
      let _drag = null;
      canvas.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        _wasDrag = false;
        _drag = {
          startX: e.clientX,
          startY: e.clientY,
          camX: camera.q,
          camY: camera.r
        };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      });

      window.addEventListener('mousemove', e => {
        if (!_drag) return;
        const tpx = TILE_PX();
        const hexVert = Math.round(tpx * 1.1547 * 0.75);
        const dx = Math.round((_drag.startX - e.clientX) / tpx);
        const dy = Math.round((_drag.startY - e.clientY) / hexVert);
        if (dx !== 0 || dy !== 0) _wasDrag = true;
        camera.q = _drag.camX + dx;
        camera.r = _drag.camY + dy;
        if (worldMapData) renderWorldMap(worldMapData);
      });

      window.addEventListener('mouseup', () => {
        if (!_drag) return;
        _drag = null;
        canvas.style.cursor = 'grab';
      });

      canvas.style.cursor = 'grab';

      // NOTE (spec §13 demand 1): touch/pointer events deliberately NOT added
      // in Phase 1 — mouse-only, verbatim from main.js. When touch pan is
      // wanted, pointerdown/move/up land here and nowhere else.

      // Keyboard panning (moved verbatim from main.js top level)
      const _keysHeld = {};
      let _panInterval = null;

      document.addEventListener('keydown', e => {
        const mapKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','A','d','D','w','W','s','S'];
        if (!document.getElementById('screen-game')?.classList.contains('active')) return;
        if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
        if (!mapKeys.includes(e.key)) return;
        e.preventDefault();
        _keysHeld[e.key] = true;
        if (!_panInterval) {
          _panInterval = setInterval(() => {
            let dx = 0, dy = 0;
            if (_keysHeld['ArrowLeft']  || _keysHeld['a'] || _keysHeld['A']) dx -= 1;
            if (_keysHeld['ArrowRight'] || _keysHeld['d'] || _keysHeld['D']) dx += 1;
            if (_keysHeld['ArrowUp']    || _keysHeld['w'] || _keysHeld['W']) dy -= 1;
            if (_keysHeld['ArrowDown']  || _keysHeld['s'] || _keysHeld['S']) dy += 1;
            if (dx || dy) self.pan(dx, dy);
          }, 100);
        }
      });

      document.addEventListener('keyup', e => {
        delete _keysHeld[e.key];
        if (Object.keys(_keysHeld).length === 0 && _panInterval) {
          clearInterval(_panInterval);
          _panInterval = null;
        }
      });

      this._initGating();

      // Restore persisted view choice (no-op until IsometricRenderer exists)
      try {
        const saved = localStorage.getItem('kw_map_view');
        if (saved && saved !== this.activeId && this._renderers[saved]) this.setRenderer(saved);
      } catch (e) {}
    },
  };

  return { L, controller, geom: { geomParams, firstVisibleCopyXY } };
})();
