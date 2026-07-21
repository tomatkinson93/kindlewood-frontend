// ══════════════════════════════════════════════════════════════════════════
//  KWMap ASSETS — manifest loader + runtime placeholder atlas
//  Phase 2 of the map renderer upgrade (spec §8, §6.7, handoff Phase 2).
//
//  Load order: AFTER pixelart.js and kwmap-core.js, BEFORE kwmap-iso.js.
//  Classic script; attaches KWMap.assets (and a window.KWAssets alias).
//
//  Responsibilities:
//    1. Load assets/iso/manifest.json (may 404 → treated as empty; the map is
//       fully playable with ZERO art, spec §8.2).
//    2. Resolution chain at draw time: key_season → key → procedural placeholder.
//    3. Runtime placeholder atlas: terrain faces painted by pixelart.js's
//       existing painters (squashed at draw time by the iso renderer) + a
//       darkened skirt tone per terrain. No art files required.
//
//  House rules honored: no apiFetch, no writes to worldMapData/gameData/
//  tickResources, no Math.random (painter seeds are deterministic via
//  pixelart.js's _strSeed/_prng).
// ══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const MANIFEST_URL = 'assets/iso/manifest.json';

  // ── Manifest ──────────────────────────────────────────────────────────────
  // Shape (spec §8.1): { meta, atlases:{name:src}, sprites:{key:{atlas,frame,
  // anchor,heightPx,seasons}} }. Missing file → empty manifest, all placeholder.
  let _manifest = { meta: {}, atlases: {}, sprites: {} };
  let _manifestState = 'idle';           // idle | loading | ready | empty
  const _atlasImgs = {};                 // atlas name → HTMLImageElement (loaded)

  function loadManifest() {
    if (_manifestState === 'loading' || _manifestState === 'ready') return;
    _manifestState = 'loading';
    // Plain fetch (NOT apiFetch — assets live on the frontend domain, no auth).
    // A 404 or parse failure is expected pre-art and must not throw.
    fetch(MANIFEST_URL, { credentials: 'omit' })
      .then(r => (r && r.ok) ? r.json() : null)
      .then(json => {
        if (json && typeof json === 'object') {
          _manifest = {
            meta: json.meta || {},
            atlases: json.atlases || {},
            sprites: json.sprites || {},
          };
          _manifestState = 'ready';
          _preloadAtlases();
        } else {
          _manifestState = 'empty';
        }
      })
      .catch(() => { _manifestState = 'empty'; });
  }

  function _preloadAtlases() {
    for (const [name, src] of Object.entries(_manifest.atlases || {})) {
      if (_atlasImgs[name]) continue;
      const img = new Image();
      img.onload = () => { _atlasImgs[name] = img; };
      img.onerror = () => { /* keep placeholder */ };
      img.src = src.charAt(0) === '/' ? src : '/assets/iso/' + src;
    }
  }

  // ── Placeholder atlas — terrain faces from pixelart.js painters ────────────
  // A face is the terrain's painter canvas (native 96²); the iso renderer
  // squashes + hex-clips it at draw time, so one canvas serves every zoomless
  // tile. Cached per terrain (season variants land in Phase 5).
  const _faceCache = {};                 // terrain → canvas
  const TERRAINS = ['plains', 'forest', 'hills', 'mountain', 'river', 'marsh', 'ruins'];

  function _painterCanvas(terrain) {
    if (_faceCache[terrain]) return _faceCache[terrain];
    let canvas = null;
    // Prefer a loaded procedural variant (matches top-down's patchy look);
    // fall back to painting one directly; last resort a flat swatch.
    if (typeof TERRAIN_PAINTERS !== 'undefined' && TERRAIN_PAINTERS[terrain]
        && typeof _strSeed === 'function') {
      try { canvas = TERRAIN_PAINTERS[terrain](_strSeed(terrain)); } catch (e) { canvas = null; }
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 96;
      const c = canvas.getContext('2d');
      c.fillStyle = (typeof TERRAIN_COLORS !== 'undefined' && TERRAIN_COLORS[terrain]) || '#3a2e22';
      c.fillRect(0, 0, 96, 96);
    }
    _faceCache[terrain] = canvas;
    return canvas;
  }

  // Darkened side-wall tone for a terrain's skirt (the "token lip", spec §7).
  const _skirtCache = {};
  function _darken(hex, f) {
    if (typeof hex !== 'string' || hex.charAt(0) !== '#' || hex.length < 7) return '#2a2018';
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * f);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * f);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * f);
    return `rgb(${r},${g},${b})`;
  }
  function skirtTone(terrain) {
    if (_skirtCache[terrain]) return _skirtCache[terrain];
    const base = (typeof TERRAIN_COLORS !== 'undefined' && TERRAIN_COLORS[terrain]) || '#3a2e22';
    const tone = _darken(base, 0.55);
    _skirtCache[terrain] = tone;
    return tone;
  }

  // ── Resolution ──────────────────────────────────────────────────────────
  // get(key, seasonId) → { canvas|img, frame:[x,y,w,h], anchor:[ax,ay],
  // heightPx } | null. Chain: key_seasonVariant → key → procedural placeholder.
  // Placeholders currently exist only for terrain.<t>.face; other keys return
  // null so the renderer can draw its own temporary marker (settlements,
  // outposts — becoming real sprites in Phase 3).
  function _spriteFromManifest(key) {
    const def = _manifest.sprites[key];
    if (!def) return null;
    const atlas = _atlasImgs[def.atlas];
    if (!atlas) return null;             // atlas not loaded yet → fall through
    return {
      img: atlas,
      frame: def.frame || [0, 0, atlas.width, atlas.height],
      anchor: def.anchor || [0.5, 0.5],
      heightPx: def.heightPx || 0,
    };
  }

  function get(key, seasonId) {
    if (!key) return null;
    // 1. season-specific manifest entry (e.g. terrain.plains.face → its
    //    seasons.winter alias key), then the base manifest entry.
    const baseDef = _manifest.sprites[key];
    if (baseDef && seasonId && baseDef.seasons && baseDef.seasons[seasonId]) {
      const s = _spriteFromManifest(baseDef.seasons[seasonId]);
      if (s) return s;
    }
    const direct = _spriteFromManifest(key);
    if (direct) return direct;

    // 2. procedural placeholder — terrain faces only, for now.
    const m = /^terrain\.([a-z]+)\.face$/.exec(key);
    if (m && TERRAINS.indexOf(m[1]) !== -1) {
      const canvas = _painterCanvas(m[1]);
      return { canvas, frame: [0, 0, canvas.width, canvas.height], anchor: [0.5, 0.5], heightPx: 0, placeholder: true };
    }
    return null;
  }

  // Convenience for the iso terrain provider: the best available face source
  // for a specific tile — a loaded per-tile variant (patchy variation, matches
  // top-down) when present, else the manifest/placeholder face. Squashing and
  // hex-clipping are the renderer's job.
  function terrainFace(terrain, wq, wr, seasonId) {
    // Real PNG / procedural variant path (reuses pixelart.js exactly as
    // top-down does), so uploaded art and variant art both appear with no
    // code change here.
    if (typeof TILE_IMAGES !== 'undefined') {
      let img = TILE_IMAGES[terrain];
      if ((!img || img._isVariantSet) && typeof getTileVariant === 'function') {
        img = getTileVariant(terrain, wq, wr);
      }
      const usable = img && !img._isVariantSet && (img.naturalWidth || img.width);
      if (usable && typeof _tileImagesLoaded !== 'undefined' && _tileImagesLoaded) {
        return { canvas: img, skirt: skirtTone(terrain) };
      }
    }
    const sprite = get('terrain.' + terrain + '.face', seasonId);
    return { canvas: sprite ? (sprite.img || sprite.canvas) : _painterCanvas(terrain), skirt: skirtTone(terrain) };
  }

  const KWAssets = {
    loadManifest,
    get,
    terrainFace,
    skirtTone,
    get manifestState() { return _manifestState; },
    get manifest() { return _manifest; },
  };

  KWMap.assets = KWAssets;
  window.KWAssets = KWAssets;

  // Kick the manifest load once the DOM is ready (non-blocking; placeholders
  // serve until/if it resolves).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadManifest);
  } else {
    loadManifest();
  }
})();
