// ══════════════════════════════════════════════
//  PROCEDURAL TILE GENERATOR — Style D (Textured Cartography)
//  Saturated, slightly painted biome tiles with crisp readable icons.
//  Each tile fades to a unified earth-tone border so adjacent hexes
//  blend at their seams; the renderer's #3a2e22 clear color matches
//  this border so any sub-pixel gap is invisible too.
//  Pure canvas — no image files required.
// ══════════════════════════════════════════════

// Internal canvas resolution — bigger than display size so smooth-scaling
// down on the actual map gives soft edges rather than crisp pixels.
const PIXEL_TILE_SIZE = 96;

// Unified earth tone every tile fades to at its border. Must match the
// canvas clear color in main.js's _doRenderCanvas.
const BORDER_COLOR = '#3a2e22';

// Seeded PRNG — deterministic per terrain type / variant
function _prng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function _strSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ── Painting toolkit ────────────────────────────────────────────────────────

function _makeBase(baseColor) {
  const c = document.createElement('canvas');
  c.width = c.height = PIXEL_TILE_SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, PIXEL_TILE_SIZE, PIXEL_TILE_SIZE);
  return { c, ctx };
}

// Soft circular pigment dab — radial gradient from color to transparent.
// Used for ambient washes, shadows, soft tonal variation.
function _dab(ctx, x, y, radius, color, alpha) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  grad.addColorStop(0,    `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(0.6,  `rgba(${r},${g},${b},${alpha * 0.5})`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Sharp circular dab — opaque center, fast falloff. Used for icons (trees,
// rocks, peaks, flowers) so they read crisply at small zoom.
function _sharpDab(ctx, x, y, radius, color, alpha) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  grad.addColorStop(0,    `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(0.7,  `rgba(${r},${g},${b},${alpha * 0.85})`);
  grad.addColorStop(0.9,  `rgba(${r},${g},${b},${alpha * 0.4})`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Subtle paper-grain noise — sparse low-alpha pixels to keep flat washes
// from looking digitally flat.
function _paperGrain(ctx, rng, intensity) {
  const N = Math.floor(intensity * PIXEL_TILE_SIZE * PIXEL_TILE_SIZE * 0.04);
  for (let i = 0; i < N; i++) {
    const x = Math.floor(rng() * PIXEL_TILE_SIZE);
    const y = Math.floor(rng() * PIXEL_TILE_SIZE);
    ctx.fillStyle = rng() > 0.5
      ? `rgba(20,15,10,${0.04 + rng() * 0.06})`
      : `rgba(255,240,220,${0.03 + rng() * 0.05})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

// Vignette toward unified earth color at hex edges — kills seams.
function _borderFade(ctx) {
  const cx = PIXEL_TILE_SIZE / 2, cy = PIXEL_TILE_SIZE / 2;
  const inner = PIXEL_TILE_SIZE * 0.30;
  const outer = PIXEL_TILE_SIZE * 0.62;
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  const r = parseInt(BORDER_COLOR.slice(1,3), 16);
  const g = parseInt(BORDER_COLOR.slice(3,5), 16);
  const b = parseInt(BORDER_COLOR.slice(5,7), 16);
  grad.addColorStop(0,    `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.7,  `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0.85)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PIXEL_TILE_SIZE, PIXEL_TILE_SIZE);
}

// Tonal wash — fill a tile with overlapping medium-alpha dabs of varying
// color. Gives saturated solid biome color but never flat.
function _tonalWash(ctx, rng, baseColor, variants, count) {
  for (let i = 0; i < count; i++) {
    const x = rng() * PIXEL_TILE_SIZE;
    const y = rng() * PIXEL_TILE_SIZE;
    const r = 4 + rng() * 8;
    const color = variants[Math.floor(rng() * variants.length)] || baseColor;
    _dab(ctx, x, y, r, color, 0.40 + rng() * 0.20);
  }
}

// ── Terrain painters ────────────────────────────────────────────────────────

const TERRAIN_PAINTERS = {

  plains(seed) {
    const { c, ctx } = _makeBase('#5a6a28');
    const rng = _prng(seed);
    _tonalWash(ctx, rng, '#5a6a28',
      ['#4a5820','#6a7a30','#3e4a18','#647228'], 32);
    // Flower dabs — sharp colored dots
    const flowers = ['#e8c850','#d8a050','#b85040','#e8d870'];
    for (let i = 0; i < 10; i++) {
      const x = 14 + rng() * 68;
      const y = 14 + rng() * 68;
      _sharpDab(ctx, x, y, 2.5,
        flowers[Math.floor(rng() * flowers.length)], 0.85);
    }
    _paperGrain(ctx, rng, 0.4);
    _borderFade(ctx);
    return c;
  },

  forest(seed) {
    const { c, ctx } = _makeBase('#345020');
    const rng = _prng(seed);
    _tonalWash(ctx, rng, '#345020',
      ['#283c18','#3e5a28','#446832','#2a4218'], 30);
    // Crisp tree icons — solid 3-layer dabs with drop shadow.
    // Higher count for proper forest density rather than scattered icons.
    const numTrees = 10 + Math.floor(rng() * 4);
    for (let t = 0; t < numTrees; t++) {
      const tx = 10 + rng() * 76;
      const ty = 10 + rng() * 76;
      // Drop shadow — flat ellipse beneath
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath();
      ctx.ellipse(tx + 1, ty + 5, 5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tree body — three stacked sharp dabs (dark to light)
      _sharpDab(ctx, tx,     ty,     6,   '#2a4015', 0.95);
      _sharpDab(ctx, tx - 1, ty - 2, 4.5, '#406028', 0.90);
      _sharpDab(ctx, tx - 1, ty - 3, 2.5, '#608030', 0.85);
    }
    _paperGrain(ctx, rng, 0.3);
    _borderFade(ctx);
    return c;
  },

  hills(seed) {
    const { c, ctx } = _makeBase('#7a6038');
    const rng = _prng(seed);
    _tonalWash(ctx, rng, '#7a6038',
      ['#8a6e40','#6a5028','#7a5e34','#5a4828'], 30);
    // Rolling hills — composed of 3-5 overlapping wide-and-shallow rises
    // with consistent overhead lighting (sun upper-left). Each rise is
    // drawn as TWO horizontal-elliptical dabs side-by-side rather than one
    // round dab, so the silhouette is rolling rather than nippley.
    const numRises = 3 + Math.floor(rng() * 3);
    // Sort rises by Y so back rises render before front rises (depth)
    const rises = [];
    for (let m = 0; m < numRises; m++) {
      rises.push({
        x: 18 + rng() * 60,
        y: 30 + rng() * 40,
        w: 18 + rng() * 14,   // wider than typical
        h: 9 + rng() * 5,     // shallower than wide
      });
    }
    rises.sort((a, b) => a.y - b.y);
    for (const rise of rises) {
      // Shadow underneath (sun upper-left → shadow lower-right)
      // Drawn as a soft horizontal ellipse, offset down-right.
      ctx.save();
      ctx.translate(rise.x + 3, rise.y + rise.h * 0.4);
      ctx.scale(1, 0.55);  // squash vertically → wide ellipse
      _dab(ctx, 0, 0, rise.w, '#3e3018', 0.50);
      ctx.restore();
      // Body of the rise — also a horizontal ellipse, slightly above shadow
      ctx.save();
      ctx.translate(rise.x, rise.y);
      ctx.scale(1, 0.55);
      _dab(ctx, 0, 0, rise.w, '#6a5230', 0.50);
      ctx.restore();
      // Highlight along the upper-left of the rise
      ctx.save();
      ctx.translate(rise.x - rise.w * 0.35, rise.y - rise.h * 0.3);
      ctx.scale(1, 0.45);
      _dab(ctx, 0, 0, rise.w * 0.65, '#a08458', 0.50);
      ctx.restore();
      // Tiny grass tufts along the highlight ridge
      ctx.fillStyle = 'rgba(80,100,40,0.55)';
      for (let g = 0; g < 4; g++) {
        const gx = rise.x - rise.w * 0.5 + rng() * rise.w * 0.7;
        const gy = rise.y - rise.h * 0.4 + rng() * 3;
        ctx.fillRect(gx, gy, 1, 2);
      }
    }
    // Scattered rocks/stones across the tile (not concentrated on rises)
    for (let i = 0; i < 5; i++) {
      const x = 16 + rng() * 64;
      const y = 16 + rng() * 64;
      _sharpDab(ctx, x,     y,     2.5, '#3a2e1a', 0.75);
      _sharpDab(ctx, x - 1, y - 1, 1.3, '#7a6048', 0.50);
    }
    _paperGrain(ctx, rng, 0.35);
    _borderFade(ctx);
    return c;
  },

  mountain(seed) {
    const { c, ctx } = _makeBase('#403830');
    const rng = _prng(seed);
    _tonalWash(ctx, rng, '#403830',
      ['#4a4238','#302a26','#3a322c','#454038'], 26);
    // 1-2 peaks built as stacked dabs (light side + shadow side) for a
    // pyramid silhouette without hard polygon edges. The base of each
    // peak is now broader and softer, fading naturally into the tile
    // ground rather than ending in an abrupt scree dot pattern.
    const numPeaks = 1 + Math.floor(rng() * 2);
    for (let p = 0; p < numPeaks; p++) {
      const peakX = 26 + rng() * 44;
      const peakY = 18 + rng() * 14;
      const baseY = 70 + rng() * 6;
      const widthAtBase = 32 + rng() * 8; // wider at base for natural foothill
      const steps = 14;
      // Shadow side (right of peak axis). More steps = smoother slope.
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const y = baseY - t * (baseY - peakY);
        // Quadratic taper — base is broad, narrows quickly toward peak.
        // Gives a more natural mountain silhouette than linear taper.
        const w = widthAtBase * Math.pow(1 - t, 1.4) + 4;
        _dab(ctx, peakX + 2, y, w * 0.5, '#1a1814', 0.50);
      }
      // Light side (left of peak axis)
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const y = baseY - t * (baseY - peakY);
        const w = widthAtBase * Math.pow(1 - t, 1.4) + 4;
        _dab(ctx, peakX - 2, y, w * 0.5, '#5a544a', 0.50);
      }
      // Foothill rocks — small dark dabs INSIDE the mountain footprint
      // rather than scattered across the entire tile bottom.
      for (let r = 0; r < 4; r++) {
        const fx = peakX - widthAtBase * 0.5 + rng() * widthAtBase;
        const fy = baseY - 4 + rng() * 6;
        _sharpDab(ctx, fx, fy, 2 + rng() * 1.5, '#252220', 0.55);
      }
      // Snow cap
      _sharpDab(ctx, peakX,     peakY + 3, 7, '#f0f0f0', 0.85);
      _sharpDab(ctx, peakX - 1, peakY + 5, 4, '#ffffff', 0.65);
      // Snow streaks down the upper slopes
      ctx.fillStyle = 'rgba(220,225,230,0.4)';
      for (let i = 0; i < 4; i++) {
        const sx = peakX - 4 + rng() * 8;
        const sy = peakY + 8 + rng() * 8;
        ctx.fillRect(sx, sy, 1, 4 + rng() * 4);
      }
    }
    _paperGrain(ctx, rng, 0.4);
    _borderFade(ctx);
    return c;
  },

  river(seed) {
    // The river painter draws only the earth/bank base. Water is drawn in a
    // separate pass by the renderer (drawRiverConnections in main.js) which
    // knows about neighboring river tiles and can draw connecting segments.
    // This separation lets water flow naturally between adjacent river hexes
    // instead of every tile drawing its own isolated horizontal band.
    const { c, ctx } = _makeBase('#5a5028');
    const rng = _prng(seed);
    // Earth banks — slightly lighter than typical earth so the contrast
    // against the water reads.
    _tonalWash(ctx, rng, '#5a5028',
      ['#6a5e30','#4a4220','#5a5028','#665834'], 24);
    // Reedy grass scattered across the bank (no specific top/bottom band
    // since water orientation is now per-tile-context)
    ctx.fillStyle = 'rgba(80,110,40,0.55)';
    for (let i = 0; i < 14; i++) {
      const x = rng() * PIXEL_TILE_SIZE;
      const y = rng() * PIXEL_TILE_SIZE;
      ctx.fillRect(x, y, 1, 3);
    }
    _paperGrain(ctx, rng, 0.3);
    _borderFade(ctx);
    return c;
  },

  marsh(seed) {
    const { c, ctx } = _makeBase('#4a5028');
    const rng = _prng(seed);
    _tonalWash(ctx, rng, '#4a5028',
      ['#5a6028','#3a4018','#4e5a30','#384218'], 28);
    // Dark water pools with a faint reflective highlight
    for (let i = 0; i < 5; i++) {
      const x = 18 + rng() * 60;
      const y = 18 + rng() * 60;
      _dab(ctx, x, y, 7 + rng() * 4, '#1a2818', 0.70);
      _sharpDab(ctx, x - 1, y - 1, 3, '#3a5868', 0.55);
    }
    // Reed clusters — vertical strokes
    ctx.fillStyle = 'rgba(140,150,60,0.75)';
    for (let i = 0; i < 16; i++) {
      const x = 12 + rng() * 72;
      const y = 12 + rng() * 64;
      ctx.fillRect(x, y, 1, 4 + rng() * 4);
    }
    _paperGrain(ctx, rng, 0.35);
    _borderFade(ctx);
    return c;
  },

  ruins(seed) {
    const { c, ctx } = _makeBase('#5a4830');
    const rng = _prng(seed);
    _tonalWash(ctx, rng, '#5a4830',
      ['#6a5638','#4a3a28','#5a4830','#7a6240'], 26);
    // Stone block remnants — readable as old masonry
    const numStones = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < numStones; s++) {
      const x = 22 + rng() * 52;
      const y = 22 + rng() * 52;
      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 4, 7, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Stone body — three layers (mid, dark, highlight) for dimensionality
      _sharpDab(ctx, x,     y,     7, '#7a7268', 0.95);
      _sharpDab(ctx, x + 1, y + 1, 5, '#5a5248', 0.80);
      _sharpDab(ctx, x - 1, y - 2, 4, '#9a9288', 0.65);
    }
    // Moss specks
    ctx.fillStyle = 'rgba(90,120,50,0.65)';
    for (let i = 0; i < 18; i++) {
      ctx.fillRect(16 + rng() * 64, 16 + rng() * 64, 1, 1);
    }
    _paperGrain(ctx, rng, 0.35);
    _borderFade(ctx);
    return c;
  },
};

// ── Generate all tiles and store as image objects ──
// Store multiple variants per terrain: TILE_VARIANTS[terrain] = [img, img, img, ...]
const TILE_VARIANTS = {};
const TILE_VARIANT_COUNT = 8; // generate 8 variants per terrain type

function generatePixelArtTiles() {
  let pending = 0;
  Object.entries(TERRAIN_PAINTERS).forEach(([terrain, painter]) => {
    if (TILE_IMAGES[terrain] && !TILE_IMAGES[terrain]._isVariantSet) return; // real image file already loaded — skip
    TILE_VARIANTS[terrain] = [];
    for (let v = 0; v < TILE_VARIANT_COUNT; v++) {
      // Each variant gets a different seed: base terrain seed + variant offset
      const seed = _strSeed(terrain) + v * 99991;
      const canvas = painter(seed);
      const img = new Image();
      pending++;
      img.src = canvas.toDataURL();
      img.onload = () => {
        TILE_VARIANTS[terrain][v] = img;
        pending--;
        // Re-render as variants stream in so the map progressively fills with
        // proper tiles instead of sitting on the emoji fallback.
        _tileImagesLoaded = true;
        if (typeof worldMapData !== 'undefined' && worldMapData
            && typeof _doRenderCanvas === 'function') {
          _doRenderCanvas();
        }
      };
    }
    // Marker so legacy code knows variants are the source of truth here.
    TILE_IMAGES[terrain] = { _isVariantSet: true };
  });
  if (pending === 0) _tileImagesLoaded = true;
}

// Pick a tile variant — deterministic, no flicker. Coordinates are quantised
// onto a coarser grid (PATCH_SIZE) so neighbouring tiles tend to share the
// same variant, producing visible patches rather than per-tile noise. A
// tiny per-tile jitter softens the patch boundaries so they don't form
// obvious rectangles.
// Robust against partial loads: if the chosen index hasn't loaded yet,
// scan for any loaded variant rather than returning undefined.
const VARIANT_PATCH_SIZE = 3;
function getTileVariant(terrain, wq, wr) {
  const variants = TILE_VARIANTS[terrain];
  if (!variants || !variants.length) {
    const fallback = TILE_IMAGES[terrain];
    return (fallback && !fallback._isVariantSet) ? fallback : null;
  }
  // Roughly 1-in-6 tiles get nudged into a neighbouring patch — soft edges.
  const jitter = ((wq * 374761393 + wr * 668265263) >>> 0) % 6 === 0 ? 1 : 0;
  const pq = Math.floor((wq + jitter) / VARIANT_PATCH_SIZE);
  const pr = Math.floor((wr + jitter) / VARIANT_PATCH_SIZE);
  const idx = Math.abs((pq * 31 + pr * 17 + pq * pr * 7)) % variants.length;
  if (variants[idx]) return variants[idx];
  // Chosen variant not loaded yet — return any loaded variant so we render
  // *something* sensible instead of the emoji fallback.
  for (let i = 0; i < variants.length; i++) {
    if (variants[i]) return variants[i];
  }
  // Nothing loaded at all yet.
  return null;
}
