// ══════════════════════════════════════════════════════════════════════════
//  KWMap DECOR — cosmetic, deterministic decorations (spec §5)
//  Phase 4 of the map renderer upgrade.
//
//  Load order: AFTER kwmap-iso.js (needs KWMap.L, KWMap.ISO, KWMap.assets),
//  BEFORE main.js is fine. Registers a single provider on L.DECOR whose
//  drawables split by their `tall` flag — flat props (flowers, rocks, …) into
//  the GROUND buffer at layer 40 (under claim borders); tall props (lone tree,
//  standing stone) depth-sort into the TALL buffer.
//
//  House rules: decorations are NEVER consulted by hit-testing, claims, or any
//  gameplay route — they live only in the renderer's draw lists. Placement is a
//  pure function of (worldSeed, q, r) via fnv1a32 + mulberry32 — NO
//  Math.random(), NO apiFetch, NO writes to game state.
// ══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const KW = window.KWMap;
  const L = KW.L;

  // ── Data model (spec §5.1) ────────────────────────────────────────────────
  const DECOR_TYPES = {
    flower_red:     { sprite: 'decor.flower_red', tall: false, seasons: { winter: null } },
    bush:           { sprite: 'decor.bush',       tall: false, heightPx: 10 },
    mushroom:       { sprite: 'decor.mushroom',   tall: false },
    rock_small:     { sprite: 'decor.rock_s',     tall: false },
    log:            { sprite: 'decor.log',        tall: false },
    tree_lone:      { sprite: 'decor.tree',       tall: true,  heightPx: 34 },
    standing_stone: { sprite: 'decor.stone_tall', tall: true,  heightPx: 26 },
    fence:          { sprite: 'decor.fence',      tall: false },
    snow_pile:      { sprite: 'decor.snowpile',   tall: false, onlySeason: 'winter' },
    leaf_litter:    { sprite: 'decor.leaves',     tall: false, onlySeason: 'autumn' },
    blossom_patch:  { sprite: 'decor.blossom',    tall: false, onlySeason: 'spring' },
  };

  const DECOR_TABLE = {   // per terrain: max count + weighted type pool
    plains:  { max: 3, pool: [['flower_red', 3], ['bush', 2], ['rock_small', 1], ['fence', 0.5], ['tree_lone', 0.5]] },
    forest:  { max: 2, pool: [['mushroom', 3], ['log', 2], ['bush', 1]] },
    hills:   { max: 2, pool: [['rock_small', 3], ['bush', 1], ['standing_stone', 0.5]] },
    mountain:{ max: 1, pool: [['rock_small', 1]] },
    river:   { max: 1, pool: [['bush', 1]] },
    marsh:   { max: 2, pool: [['mushroom', 2], ['log', 1]] },
    ruins:   { max: 2, pool: [['rock_small', 2], ['standing_stone', 1]] },
  };

  // Season-only props (second, salted stream). One type per season.
  const SEASON_ONLY = { winter: 'snow_pile', autumn: 'leaf_litter', spring: 'blossom_patch' };

  // ── Seeded PRNG — fnv1a32 + mulberry32 (same family as season-atmosphere.js) ─
  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function weightedPick(pool, r) {
    let total = 0; for (const e of pool) total += e[1];
    let roll = r * total;
    for (const e of pool) { roll -= e[1]; if (roll <= 0) return e[0]; }
    return pool[pool.length - 1][0];
  }

  function worldSeedOf(data) {
    if (!data) return 1;
    if (Number.isFinite(data.seed)) return data.seed >>> 0;
    if (data.world_meta && Number.isFinite(data.world_meta.current_seed)) return data.world_meta.current_seed >>> 0;
    return 1;   // spec §13.3: falling back to a constant seed is acceptable for v1
  }

  // Fixed-zoom geometry (TILE_PX is constant; ISO.K from the iso renderer).
  function geo() {
    const hexW = TILE_PX();
    const hexH = Math.round(hexW * 1.1547);
    const K = (KW.ISO && KW.ISO.K) || 0.6;
    return { hexW, faceH: Math.round(hexH * K) };
  }

  // ── Deterministic placement (spec §5.2), memoized per tile ────────────────
  // Positions/count/scale are season-INDEPENDENT so props never reshuffle when
  // the year turns. Memo keys include worldSeed + terrain, so a regenerate (new
  // seed) or a dev terrain edit recomputes without any explicit cache clear —
  // equivalent to the spec's "cleared on invalidate('all')".
  const _baseMemo = new Map();     // seed,q,r,terrain -> [props]
  const _seasonMemo = new Map();   // seed,q,r,terrain,season -> [props]
  const EMPTY = [];

  function baseProps(q, r, terrain, worldSeed) {
    const key = worldSeed + ',' + q + ',' + r + ',' + terrain;
    let props = _baseMemo.get(key);
    if (props) return props;
    props = [];
    const tbl = DECOR_TABLE[terrain];
    if (tbl) {
      const { hexW, faceH } = geo();
      const s = mulberry32(fnv1a32(worldSeed + ':' + q + ':' + r + ':decor'));
      const count = Math.floor(s() * (tbl.max + 1));
      for (let i = 0; i < count; i++) {
        const type = weightedPick(tbl.pool, s());
        const ox = (s() * 0.7 - 0.35) * hexW;         // within 70% of the face
        const oy = (s() * 0.5 - 0.25) * faceH;
        const scale = 0.85 + s() * 0.3;
        const def = DECOR_TYPES[type];
        props.push({ type, ox, oy, scale, tall: !!def.tall, heightPx: def.heightPx || 0, spriteKey: def.sprite, seasons: def.seasons || null });
      }
    }
    _baseMemo.set(key, props);
    return props;
  }

  function seasonProps(q, r, terrain, worldSeed, season) {
    const type = SEASON_ONLY[season];
    if (!type || !DECOR_TABLE[terrain]) return EMPTY;
    const key = worldSeed + ',' + q + ',' + r + ',' + terrain + ',' + season;
    let props = _seasonMemo.get(key);
    if (props) return props;
    props = [];
    const { hexW, faceH } = geo();
    const s = mulberry32(fnv1a32(worldSeed + ':' + q + ':' + r + ':decor:' + season));
    const count = Math.floor(s() * 3);               // 0–2 seasonal props
    const def = DECOR_TYPES[type];
    for (let i = 0; i < count; i++) {
      const ox = (s() * 0.7 - 0.35) * hexW;
      const oy = (s() * 0.5 - 0.25) * faceH;
      const scale = 0.85 + s() * 0.3;
      props.push({ type, ox, oy, scale, tall: !!def.tall, heightPx: def.heightPx || 0, spriteKey: def.sprite, seasons: null });
    }
    _seasonMemo.set(key, props);
    return props;
  }

  // Base props (season-filtered: seasons:{winter:null} vanish that season, slot
  // reserved) plus the season-only props for the current season.
  function decorFor(q, r, terrain, worldSeed, season) {
    const base = baseProps(q, r, terrain, worldSeed);
    const out = [];
    for (const p of base) {
      if (p.seasons && p.seasons[season] === null) continue;   // absent this season
      out.push(p);
    }
    const so = seasonProps(q, r, terrain, worldSeed, season);
    for (const p of so) out.push(p);
    return out;
  }

  // ── Placeholder sprite painters (procedural; deterministic canvas ops so
  //    node and browser match). Drawn centred/based at (cx, cy); tall props
  //    rise upward. Kept small + subtle to avoid cluttering busy terrain. ─────
  function _flower(ctx, cx, cy, sc) {
    ctx.strokeStyle = 'rgba(70,96,40,0.9)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 5 * sc); ctx.stroke();
    ctx.fillStyle = '#d85440'; ctx.beginPath(); ctx.arc(cx, cy - 5 * sc, 2.2 * sc, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8c850'; ctx.beginPath(); ctx.arc(cx, cy - 5 * sc, 0.9 * sc, 0, Math.PI * 2); ctx.fill();
  }
  function _bush(ctx, cx, cy, sc) {
    const r = 4 * sc;
    ctx.fillStyle = '#33521f'; ctx.beginPath(); ctx.arc(cx - r * 0.5, cy - 1, r, 0, Math.PI * 2); ctx.arc(cx + r * 0.5, cy - 1, r, 0, Math.PI * 2); ctx.arc(cx, cy - r * 0.7, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(120,160,80,0.5)'; ctx.beginPath(); ctx.arc(cx - r * 0.4, cy - r * 0.9, r * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  function _mushroom(ctx, cx, cy, sc) {
    ctx.fillStyle = '#e8ddc8'; ctx.fillRect(cx - 1 * sc, cy - 3 * sc, 2 * sc, 3 * sc);
    ctx.fillStyle = '#b8402f'; ctx.beginPath(); ctx.ellipse(cx, cy - 3 * sc, 3 * sc, 2 * sc, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(240,230,210,0.85)'; ctx.beginPath(); ctx.arc(cx - 0.8 * sc, cy - 3.4 * sc, 0.6 * sc, 0, Math.PI * 2); ctx.fill();
  }
  function _rock(ctx, cx, cy, sc) {
    ctx.fillStyle = '#6b665e'; ctx.beginPath(); ctx.ellipse(cx, cy - 1.5 * sc, 3.4 * sc, 2.4 * sc, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,144,134,0.7)'; ctx.beginPath(); ctx.ellipse(cx - 0.8 * sc, cy - 2.2 * sc, 1.4 * sc, 1 * sc, 0, 0, Math.PI * 2); ctx.fill();
  }
  function _log(ctx, cx, cy, sc) {
    ctx.fillStyle = '#5a3f24'; ctx.beginPath(); ctx.ellipse(cx, cy - 1.5 * sc, 5 * sc, 2 * sc, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a5a34'; ctx.beginPath(); ctx.arc(cx + 4.2 * sc, cy - 1.5 * sc, 1.6 * sc, 0, Math.PI * 2); ctx.fill();
  }
  function _tree(ctx, cx, cy, sc) {   // tall
    ctx.fillStyle = 'rgba(58,40,22,0.95)'; ctx.fillRect(cx - 1.4 * sc, cy - 8 * sc, 2.8 * sc, 9 * sc);
    ctx.fillStyle = '#2b491d'; ctx.beginPath(); ctx.arc(cx, cy - 14 * sc, 7 * sc, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3f6628'; ctx.beginPath(); ctx.arc(cx - 2 * sc, cy - 18 * sc, 5 * sc, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(120,160,80,0.5)'; ctx.beginPath(); ctx.arc(cx - 3 * sc, cy - 18 * sc, 2 * sc, 0, Math.PI * 2); ctx.fill();
  }
  function _stone(ctx, cx, cy, sc) {   // tall — standing stone
    ctx.fillStyle = '#5f5850'; ctx.beginPath();
    ctx.moveTo(cx - 3 * sc, cy); ctx.lineTo(cx - 3.4 * sc, cy - 12 * sc); ctx.lineTo(cx + 2.4 * sc, cy - 13 * sc); ctx.lineTo(cx + 3 * sc, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(150,142,132,0.6)'; ctx.beginPath();
    ctx.moveTo(cx - 3 * sc, cy); ctx.lineTo(cx - 3.4 * sc, cy - 12 * sc); ctx.lineTo(cx - 1 * sc, cy - 12.4 * sc); ctx.lineTo(cx - 0.6 * sc, cy); ctx.closePath(); ctx.fill();
  }
  function _fence(ctx, cx, cy, sc) {
    ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 1.2 * sc; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) { const px = cx + i * 4 * sc; ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px, cy - 5 * sc); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - 5 * sc, cy - 3.5 * sc); ctx.lineTo(cx + 5 * sc, cy - 3.5 * sc); ctx.stroke();
  }
  function _snowpile(ctx, cx, cy, sc) {
    ctx.fillStyle = 'rgba(240,246,252,0.92)'; ctx.beginPath(); ctx.ellipse(cx, cy - 1 * sc, 4.5 * sc, 2.2 * sc, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,214,230,0.6)'; ctx.beginPath(); ctx.ellipse(cx + 1 * sc, cy - 0.4 * sc, 2 * sc, 1 * sc, 0, 0, Math.PI * 2); ctx.fill();
  }
  function _leaves(ctx, cx, cy, sc) {
    const cols = ['#b06419', '#d28214', '#a5551a'];
    for (let i = 0; i < 4; i++) { const a = i * 1.7; ctx.fillStyle = cols[i % 3]; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 3 * sc, cy + Math.sin(a) * 2 * sc, 1.4 * sc, 0.9 * sc, a, 0, Math.PI * 2); ctx.fill(); }
  }
  function _blossom(ctx, cx, cy, sc) {
    const cols = ['#e8a8c8', '#f0c0d8', '#e090b0'];
    for (let i = 0; i < 4; i++) { const a = i * 1.7; ctx.fillStyle = cols[i % 3]; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 3 * sc, cy + Math.sin(a) * 2 * sc, 1.2 * sc, 0, Math.PI * 2); ctx.fill(); }
  }
  const PLACEHOLDERS = {
    flower_red: _flower, bush: _bush, mushroom: _mushroom, rock_small: _rock, log: _log,
    tree_lone: _tree, standing_stone: _stone, fence: _fence,
    snow_pile: _snowpile, leaf_litter: _leaves, blossom_patch: _blossom,
  };

  // Resolve real art (manifest) → procedural placeholder. Real decor art, once
  // added under /assets/iso/ + the manifest, replaces placeholders per key with
  // zero code change.
  function drawDecor(ctx, cx, cy, ctx3) {
    const prop = ctx3.d && ctx3.d.prop;
    if (!prop) return;
    const season = ctx3.seasonId;
    const sprite = (KW.assets && KW.assets.get) ? KW.assets.get(prop.spriteKey, season) : null;
    const src = sprite && (sprite.img || sprite.canvas);
    if (src && (src.width || src.naturalWidth)) {
      const fr = sprite.frame || [0, 0, src.width || 16, src.height || 16];
      const a = sprite.anchor || [0.5, 1.0];
      const w = fr[2] * prop.scale, h = fr[3] * prop.scale;
      ctx.drawImage(src, fr[0], fr[1], fr[2], fr[3], cx - w * a[0], cy - h * a[1], w, h);
      return;
    }
    const painter = PLACEHOLDERS[prop.type];
    if (painter) painter(ctx, cx, cy, prop.scale);
    // Winter placeholder variant (spec §5.2 season chain): dust props with snow.
    // Real winter art (decor.<key>_winter in the manifest) supersedes this.
    if (season === 'winter') _winterCap(ctx, cx, cy, prop.scale, prop.type);
  }

  function _winterCap(ctx, cx, cy, sc, type) {
    // Soft snow dusting — capped arcs sitting ON TOP of the prop, low alpha so
    // it reads as a light coating rather than a hard white blob.
    ctx.fillStyle = 'rgba(238,244,250,0.62)';
    if (type === 'bush') {
      ctx.beginPath(); ctx.ellipse(cx - 1.5 * sc, cy - 5.5 * sc, 2.4 * sc, 1.5 * sc, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 1.8 * sc, cy - 5.2 * sc, 2 * sc, 1.3 * sc, 0, Math.PI, 0); ctx.fill();
    } else if (type === 'tree_lone') {
      ctx.beginPath(); ctx.ellipse(cx - 2 * sc, cy - 19.5 * sc, 3 * sc, 1.6 * sc, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 1.5 * sc, cy - 14.5 * sc, 2.6 * sc, 1.5 * sc, 0, Math.PI, 0); ctx.fill();
    } else if (type === 'rock_small') {
      ctx.beginPath(); ctx.ellipse(cx - 0.4 * sc, cy - 2.8 * sc, 2.2 * sc, 0.9 * sc, 0, Math.PI, 0); ctx.fill();
    } else if (type === 'log') {
      ctx.beginPath(); ctx.ellipse(cx, cy - 2.6 * sc, 3.4 * sc, 0.9 * sc, 0, Math.PI, 0); ctx.fill();
    } else if (type === 'standing_stone') {
      ctx.beginPath(); ctx.ellipse(cx - 0.5 * sc, cy - 12.6 * sc, 2.2 * sc, 1 * sc, 0, Math.PI, 0); ctx.fill();
    }
  }

  // ── Provider ──────────────────────────────────────────────────────────────
  // Read-only; iterates the visible window (view.visible) so it only computes
  // decor for on-screen tiles. Emits one drawable per prop; the iso renderer
  // routes flat → GROUND, tall → TALL by the drawable's `tall` flag.
  function tileMapOf(data) {
    if (data._decorTM && data._decorTMlen === data.tiles.length) return data._decorTM;
    const m = new Map();
    for (const t of data.tiles) m.set(t.q + ',' + t.r, t);
    try { Object.defineProperty(data, '_decorTM', { value: m, configurable: true, enumerable: false, writable: true });
          Object.defineProperty(data, '_decorTMlen', { value: data.tiles.length, configurable: true, enumerable: false, writable: true }); }
    catch (e) { data._decorTM = m; data._decorTMlen = data.tiles.length; }
    return m;
  }

  const decorProvider = {
    id: 'decor', layer: L.DECOR, space: 'world',
    collect(view, mapState) {
      const out = [];
      if (!mapState || !mapState.tiles) return out;
      const worldSeed = worldSeedOf(mapState);
      const season = view && view.seasonId ? view.seasonId : null;
      const tm = tileMapOf(mapState);
      const src = (view && view.visible) ? view.visible : null;
      const tiles = src ? src.map(v => tm.get(v.wq + ',' + v.wr)).filter(Boolean) : mapState.tiles;
      for (const t of tiles) {
        if (!t || t.terrain === 'fog' || !DECOR_TABLE[t.terrain]) continue;
        const props = decorFor(t.q, t.r, t.terrain, worldSeed, season);
        for (const p of props) {
          out.push({ wq: t.q, wr: t.r, tall: p.tall, heightPx: p.heightPx, ox: p.ox, oy: p.oy, prop: p, draw: drawDecor });
        }
      }
      return out;
    },
  };

  KW.controller.register(decorProvider);

  // Public surface (debug/verification): deterministic placement inspection.
  KW.decor = {
    DECOR_TYPES, DECOR_TABLE,
    fnv1a32, mulberry32, worldSeedOf,
    placement: (q, r, terrain, worldSeed, season) => decorFor(q, r, terrain, worldSeed, season),
    _provider: decorProvider,
  };
})();
