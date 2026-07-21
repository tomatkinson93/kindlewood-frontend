// ══════════════════════════════════════════════════════════════════════════
//  KWMap TILE ACTIONS + DETAIL VIEW — increment 1
//  Spec: docs/11_SPEC_tile_actions_detail_view.md.
//
//  Load order: AFTER the map renderer (kwmap-iso.js) and main.js/expeditions.js
//  (uses their globals at runtime). Classic script.
//
//  Two pieces, both renderer-agnostic and read-only:
//    1. On-tile action buttons — a small DOM overlay in #map-frame that appears
//       at the SELECTED tile: 🧭 Scout on a fog tile (opens the existing scout
//       flow), 🔍 Inspect on a discovered tile (opens the Tile Detail modal).
//    2. Tile Detail modal — a zoomed, layered view of the tile (scene +
//       info panels). Increment 1: terrain-tinted scene placeholder + the info
//       that exists today (header/water sub-type, terrain bonus, ownership,
//       outpost, settlement). Later increments add art, citizens, POIs,
//       resources/fertility, and in-modal actions (see the spec).
//
//  No renderer internals touched; no gameplay writes (actions route through the
//  existing selectFogTile / openTileDetail read-only flows).
// ══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  const KW = window.KWMap;
  if (!KW || !KW.controller) return;

  // Cross-script globals from main.js / expeditions.js are `const`/`let`/`var`
  // — classic scripts share the global LEXICAL environment, so bare references
  // resolve them (window[...] would miss const/let). typeof-guards avoid a
  // ReferenceError when a module hasn't loaded.
  const world = () => (typeof worldMapData !== 'undefined' ? worldMapData : null);
  const sel = () => (typeof _selectedTile !== 'undefined' ? _selectedTile : null);
  const EMOJI = () => (typeof WORLD_EMOJI !== 'undefined' ? WORLD_EMOJI : {});
  const LABELS = () => (typeof TERRAIN_LABELS !== 'undefined' ? TERRAIN_LABELS : {});
  const BONUS = () => (typeof TERRAIN_BONUSES_DISPLAY !== 'undefined' ? TERRAIN_BONUSES_DISPLAY : {});
  const COLORS = () => (typeof TERRAIN_COLORS !== 'undefined' ? TERRAIN_COLORS : {});
  const OUTICONS = () => (typeof OUTPOST_ICONS !== 'undefined' ? OUTPOST_ICONS : {});
  const OUTSTATUS = () => (typeof _outpostStatus !== 'undefined' ? _outpostStatus : null);
  const MAPW = () => (typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40);
  const MAPH = () => (typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40);

  function tileAt(wq, wr) {
    const w = world();
    if (!w || !w.tiles) return null;
    for (const t of w.tiles) if (t.q === wq && t.r === wr) return t;
    return null;
  }
  const isFogTile = (t) => !t || t.terrain === 'fog';
  const buttonFor = (t) => isFogTile(t) ? 'scout' : 'zoom';

  // ── Pure render helpers (testable) ─────────────────────────────────────────
  const HEX_NB = [[+1, 0], [-1, 0], [0, +1], [0, -1], [+1, -1], [-1, +1]];
  function waterSubtype(tile) {
    // River / Pond / Lake / Great Lake by river-neighbour count (mirrors
    // main.js's _selectWorldTileImpl, simplified).
    const w = world(); const W = MAPW(), Hh = MAPH();
    if (!w || !w.tiles) return 'Riverside';
    const tm = {}; for (const t of w.tiles) tm[t.q + ',' + t.r] = t;
    const isRiver = (q, r) => { const t = tm[q + ',' + r]; return t && t.terrain === 'river'; };
    const countN = (q, r) => { let n = 0; for (const [dq, dr] of HEX_NB) if (isRiver(((q + dq) % W + W) % W, ((r + dr) % Hh + Hh) % Hh)) n++; return n; };
    const myN = countN(tile.q, tile.r);
    let isLake = myN >= 4;
    if (!isLake && myN >= 3) for (const [dq, dr] of HEX_NB) { const nq = ((tile.q + dq) % W + W) % W, nr = ((tile.r + dr) % Hh + Hh) % Hh; if (isRiver(nq, nr) && countN(nq, nr) >= 4) { isLake = true; break; } }
    if (isLake) {
      const seen = new Set(); const stack = [[tile.q, tile.r]]; let size = 0;
      while (stack.length && size < 32) { const [q, r] = stack.pop(); const k = q + ',' + r; if (seen.has(k)) continue; if (!isRiver(q, r)) continue; if (countN(q, r) < 3) continue; seen.add(k); size++; for (const [dq, dr] of HEX_NB) stack.push([((q + dq) % W + W) % W, ((r + dr) % Hh + Hh) % Hh]); }
      return size >= 6 ? 'Great Lake' : 'Lake';
    }
    return myN === 0 ? 'Pond' : 'Riverside';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function tileGlyph(tile) { return EMOJI()[tile.terrain] || '🗺'; }
  function tileLabel(tile) { return tile.terrain === 'river' ? waterSubtype(tile) : (LABELS()[tile.terrain] || tile.terrain); }

  function renderScene(tile) {
    const bg = COLORS()[tile.terrain] || '#3a2e22';
    const OUT = OUTICONS();
    let badges = '';
    if (tile.settlement) {
      const s = tile.settlement;
      const glyph = (s.is_kingdom || s.settlement_type === 'kingdom') ? '👑'
        : s.settlement_type === 'hostile' ? '💀'
          : s.settlement_type === 'npc' ? '🏡' : '🏘';
      badges += `<div class="td-scene-badge" title="Settlement">${glyph}</div>`;
    }
    if (tile.outpost) badges += `<div class="td-scene-badge" title="Outpost">${OUT[tile.outpost.terrain] || '⛺'}</div>`;
    return `<div class="td-scene-bg" style="background:radial-gradient(120% 120% at 50% 20%, ${esc(bg)} 0%, rgba(0,0,0,0.55) 100%)">
        <div class="td-scene-glyph">${tileGlyph(tile)}</div>
        <div class="td-scene-badges">${badges}</div>
      </div>`;
  }

  const row = (label, val) => `<div class="td-row"><span class="td-row-k">${esc(label)}</span><span class="td-row-v">${val}</span></div>`;

  function renderBody(tile) {
    const OUT = OUTICONS();
    let html = `<div class="td-header">
        <span class="td-header-glyph">${tileGlyph(tile)}</span>
        <div><div class="td-title">${esc(tileLabel(tile))}</div>
        <div class="td-sub">(${tile.q}, ${tile.r})</div></div>
      </div>`;
    html += row('Terrain bonus', esc(BONUS()[tile.terrain] || 'None'));
    html += row('Ownership', tile.claimed_by_me ? '<span class="td-mine">Your claim</span>'
      : tile.claim_owner ? 'Claimed by ' + esc(tile.claim_owner) : 'Unclaimed');
    if (tile.outpost) {
      const op = tile.outpost;
      const st = OUTSTATUS();
      const cfg = st && st.config && st.config[op.terrain];
      const yields = cfg && cfg.yields ? Object.entries(cfg.yields).map(([k, v]) => `+${v} ${k}/hr`).join(', ') : '';
      html += row('Outpost', `${OUT[op.terrain] || '⛺'} ${op.mine ? 'Yours' : esc(op.owner || 'Rival') + "'s"}${yields ? ' · ' + esc(yields) : ''}`);
    }
    if (tile.settlement) {
      const s = tile.settlement;
      html += row('Settlement', `${esc(s.name || 'Settlement')}${s.username ? ' · @' + esc(s.username) : ''}${s.tier ? ' · ' + esc(s.tier) : ''}`);
    }
    html += `<div class="td-soon">More coming soon: citizens here, points of interest, resource breakdown &amp; fertility, water &amp; fish detail.</div>`;
    return html;
  }

  // ── Tile Detail modal (created lazily) ─────────────────────────────────────
  function ensureModal() {
    if (document.getElementById('tile-detail-modal')) return;
    const m = document.createElement('div');
    m.id = 'tile-detail-modal';
    m.className = 'tile-detail-backdrop';
    m.style.display = 'none';
    m.innerHTML = '<div class="tile-detail-card">'
      + '<button class="tile-detail-close" aria-label="Close">✕</button>'
      + '<div class="tile-detail-scene" id="tile-detail-scene"></div>'
      + '<div class="tile-detail-body" id="tile-detail-body"></div>'
      + '</div>';
    if (m.addEventListener) m.addEventListener('click', (e) => { if (e.target === m) closeTileDetail(); });
    const close = m.querySelector && m.querySelector('.tile-detail-close');
    if (close && close.addEventListener) close.addEventListener('click', closeTileDetail);
    if (document.body && document.body.appendChild) document.body.appendChild(m);
  }
  function openTileDetail(tile) {
    if (!tile) return;
    ensureModal();
    const scene = document.getElementById('tile-detail-scene');
    const body = document.getElementById('tile-detail-body');
    if (scene) scene.innerHTML = renderScene(tile);
    if (body) body.innerHTML = renderBody(tile);
    const m = document.getElementById('tile-detail-modal');
    if (m) { m.style.display = 'flex'; if (m.classList) m.classList.add('open'); }
  }
  function closeTileDetail() {
    const m = document.getElementById('tile-detail-modal');
    if (m) { m.style.display = 'none'; if (m.classList) m.classList.remove('open'); }
  }

  // ── On-tile action buttons overlay ─────────────────────────────────────────
  let _wrap = null, _btnScout = null, _btnZoom = null;
  let _rafId = null, _visible = true;
  let _lcq = NaN, _lcr = NaN, _lsel = '', _lw = 0;

  function mkBtn(glyph, title, fn) {
    const b = document.createElement('button');
    b.className = 'tile-action-btn';
    b.type = 'button';
    if (b.setAttribute) b.setAttribute('title', title);
    b.textContent = glyph;
    b.style.pointerEvents = 'auto';
    if (b.addEventListener) {
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); fn(); });
    }
    return b;
  }
  function ensureDom() {
    if (_wrap) return;
    const frame = document.getElementById('map-frame');
    if (!frame) return;
    _wrap = document.createElement('div');
    _wrap.id = 'map-tile-actions';
    _wrap.style.display = 'none';
    _btnZoom = mkBtn('🔍', 'Inspect tile', onZoom);
    _btnScout = mkBtn('🧭', 'Scout this tile', onScout);
    if (_wrap.appendChild) { _wrap.appendChild(_btnZoom); _wrap.appendChild(_btnScout); }
    if (frame.appendChild) frame.appendChild(_wrap);
  }

  function currentSelection() {
    const s = sel();
    if (!s) return null;
    const t = tileAt(s.wq, s.wr);
    return { wq: s.wq, wr: s.wr, fog: isFogTile(t), tile: t };
  }
  function onScout() { const s = currentSelection(); if (s && typeof selectFogTile === 'function') selectFogTile(s.wq, s.wr); }
  function onZoom() { const s = currentSelection(); if (s && s.tile) openTileDetail(s.tile); }

  function hide() { if (_wrap) _wrap.style.display = 'none'; }
  function position() {
    ensureDom();
    if (!_wrap) return;
    const s = currentSelection();
    if (!s) { hide(); return; }
    const canvas = document.getElementById('map-canvas');
    if (!canvas) { hide(); return; }
    const W = canvas.clientWidth || canvas.width, Hh = canvas.clientHeight || canvas.height;
    const r = KW.controller.active;
    const p = r && r.hexToScreen ? r.hexToScreen(s.wq, s.wr, KW.controller.camera, W, Hh) : null;
    if (!p) { hide(); return; }
    if (_btnScout) _btnScout.style.display = s.fog ? '' : 'none';
    if (_btnZoom) _btnZoom.style.display = s.fog ? 'none' : '';
    _wrap.style.left = Math.round(p.x) + 'px';
    _wrap.style.top = Math.round(p.y - 24) + 'px';   // just above the tile / near the beacon
    _wrap.style.display = 'flex';
  }

  function tick() {
    _rafId = null;
    if (!_visible || (typeof document !== 'undefined' && document.hidden)) return;
    const cam = KW.controller.camera || { q: 0, r: 0 };
    const s = sel();
    const selKey = s ? s.wq + ',' + s.wr : '';
    const canvas = document.getElementById('map-canvas');
    const w = canvas ? (canvas.clientWidth || canvas.width) : 0;
    if (cam.q !== _lcq || cam.r !== _lcr || selKey !== _lsel || w !== _lw) {
      _lcq = cam.q; _lcr = cam.r; _lsel = selKey; _lw = w;
      position();
    }
    _rafId = requestAnimationFrame(tick);
  }
  function start() { if (_rafId === null && _visible && !(typeof document !== 'undefined' && document.hidden)) _rafId = requestAnimationFrame(tick); }
  function stop() { if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; } hide(); }

  function init() {
    ensureDom();
    const canvas = document.getElementById('map-canvas');
    if (canvas && typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver((es) => { _visible = es[0].isIntersecting; if (_visible) start(); else stop(); }).observe(canvas);
    } else { _visible = true; }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTileDetail(); });
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', () => { _lcq = NaN; });
    start();
  }

  window.openTileDetail = openTileDetail;
  window.closeTileDetail = closeTileDetail;
  KW.tileActions = { buttonFor, waterSubtype, renderScene, renderBody, openTileDetail, closeTileDetail, _position: position };

  if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
