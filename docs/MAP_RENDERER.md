# Kindlewood Map Renderer System

The world map has two interchangeable renderers behind one controller:
**Top-Down** (the original flat hex view) and **Isometric** (a squashed-hex
diorama). Game logic stays in axial `(q, r)`; all screen math lives inside the
renderers. No bundler, no modules — classic scripts attaching to `window.KWMap`.

## Files & load order

Loaded in `index.html` after `pixelart.js`, before `main.js`:

```
js/kwmap-core.js      controller, layer stack, provider registry, uifx canvas, shared math
js/kwmap-atmosphere.js KWMap.atmosphere — uncharted-map fog backdrop + drifting clouds
js/kwmap-topdown.js   TopDownRenderer (id 'topdown') — the original passes
js/kwmap-assets.js    KWMap.assets — manifest loader + runtime placeholder atlas
js/kwmap-iso.js       IsometricRenderer (id 'iso') — projection, buffers, hit-scan, perf
js/kwmap-decor.js     KWMap.decor — deterministic decorations provider
```

`main.js` keeps thin delegates (`renderWorldMap`, `_doRenderCanvas`,
`_canvasPixelToHex`, `panCamera`, `centreCamera`, …) that call
`KWMap.controller`. Every existing call site keeps working; no file learns a
renderer exists.

## Controller (`KWMap.controller`)

Owns the canvas + `2d` context, HiDPI resize, the shared `camera {q,r}`, the
visibility-gated rAF loop, all input listeners, and the active renderer.

```
setRenderer('topdown'|'iso')   swap + persist kw_map_view + invalidate('all') + render
                               (keeps camera {q,r} → focus preserved)
requestRender()                request a frame (idempotent per tick)
pan(dq,dr) / centreOnPlayer()
invalidate(scope)              'tiles' | 'season' | 'all' → active renderer
screenToHex(px,py)             forwarded to the active renderer
register(provider)             add a layer-stack provider (see below)
listProviders()                layer-sorted copy (renderers consume this)
```

## The renderer interface

```
render(frame)                          frame = { ctx, W, H, dpr, camera, data, ui, now }
screenToHex(px, py, camera, W, H)      → {wq, wr} | null   (wrap-normalized axial)
hexToScreen(wq, wr, camera, W, H)      → {x, y} | null     (ground-plane tile centre)
invalidate(scope)                      'tiles' | 'season' | 'all'
renderUiFx(ctx, W, H, ui, camera)      optional — draw hover/selection on the uifx canvas
destroy()
```

## Layer stack & providers (`KWMap.L`) — the extension contract

Every drawable belongs to one named layer (numbered with gaps so insertions
never renumber): `TERRAIN 10, TERRAIN_FEATURE 15, ROAD 20, RIVER_OVERLAY 30,
DECOR 40, BUILDING 50, OUTPOST 60, CLAIM_BORDER 70, QUEST_MARKER 80, NPC 90,
PLAYER 100, FOG 110, WEATHER 120, PARTICLES 130, SELECTION 140, COMBAT 150,
RESOURCE_ICONS 160`.

A future system integrates by **registering a provider** — it never touches
renderer internals:

```js
KWMap.controller.register({
  id: 'roads',                 // unique
  layer: KWMap.L.ROAD,
  space: 'world',              // 'world' = per-tile projected, 'screen' = raw ctx
  collect(view, mapState) {    // return drawables for the visible window
    return [{ wq, wr, tall:false, heightPx:0, ox:0, oy:0,
              draw(ctx, x, y, ctx3) { /* paint at the tile */ } }];
  },
});
```

- **Routing** is by each drawable's `tall` flag (defaulting to the layer):
  flat → the **GROUND buffer** (painted in layer order); tall → the **TALL
  buffer** (one depth-sorted pass by `(drawn-copy ground-Y, layer, x)` with a
  contact shadow under each). A tile may carry several drawables (e.g. decor).
- Providers are **read-only** consumers of `mapState`. The grep gate forbids
  `apiFetch` / `Math.random` / writes to `worldMapData` / `gameData` /
  `tickResources` in any `kwmap-*.js` and registered provider.
- Built-in providers: `terrain`, `claims` (ground); `terrain-features`,
  `settlements`, `outposts` (tall); `decor` (mixed).

## Isometric specifics

- **Projection** (`KWMap.ISO = {K:0.60, ELEV_PX:14, SKIRT_PX:6}`, `KWMap.ELEVATION`):
  squashed-hex axonometric — ground plane × `K` in Y, raised terrain lifted by
  `elevation·ELEV_PX` with a side skirt. Forward + inverse are pure functions in
  `kwmap-iso.js`; core geometry is untouched.
- **Hit-testing** (§4.3): ground-plane base-footprint pick with an elevation-
  compensated scan for raised terrain top faces. Feature/building/decor sprites
  never capture clicks.
- **Buffers**: world-pixel GROUND + TALL offscreen canvases, viewport + margin,
  blit per frame, rebuilt on margin-cross / resize / season / `invalidate`. A
  cheap per-frame content signature also rebuilds on tile/settlement/outpost/
  claim change (so the view stays live without unfreezing `main.js`).
- **Performance** (`KWMap.perf`): device-tier margin + rebuild budget; a
  degradation ladder reacting to rebuild time — decor ×0.5 → decor off → haze
  off → shadows off → suggest top-down. `setLowDetail(bool)` pins ≥ step 2.
  `?kwmapdebug=1` shows a HUD; `?kwmapview=iso|topdown` forces a view.

## Decorations (`KWMap.decor`)

Cosmetic only. Placement is a pure function of `(worldSeed, q, r)` via
fnv1a32 + mulberry32, season-independent and memoized per tile. `worldSeed` is
`worldMapData.seed` → `world_meta.current_seed` → the constant `1`. Real art
(under `/assets/iso/` + `assets/iso/manifest.json`, `decor.<key>[ _season]`)
supersedes the procedural placeholders per key with no code change.

## Fog of war & clouds (`KWMap.atmosphere`)

Cosmetic, shared by both renderers (each falls back to the legacy drifting
`_fogImg` texture when the file isn't loaded — e.g. the verify harness, so the
top-down golden is unaffected).

- `drawBackdrop(ctx, W, H, camX, camY, {yScale})` — the fog of war is an old
  cartographer's chart: a seeded, seamlessly tiling 1024² parchment texture
  (rhumb-line network, compass rose, sketched ranges/forests/lakes, dotted
  trails, "Terra Incognita" in IM Fell English). It is anchored to the world
  (pans with the map); iso squashes it onto the ground plane (`yScale = K`).
  Rebuilt once when the script font finishes loading.
- `drawClouds(ctx, W, H, camX, camY, now, {yScale})` — painted cumulus +
  high wisps in a periodic 3400² field of cloud "systems", drifting with a
  slow wind. Low clouds parallax ×1.14, wisps ×1.32 against the ground; soft
  ground shadows fall down-right (sun upper-left). Clouds thin over the
  centre of view so the focus stays readable. Sprites are generated per
  season tint, one per frame (no hitch). Drawn last in the world pass (iso:
  above the haze).
- Perf ladder: level ≥ 2 drops the wisps, ≥ 3 drops shadows, 5 disables.
- Settings: **Drifting clouds** toggle (persists `kw_map_clouds`).
- `verify/iso_demo.html` takes `?fogr=N` (fog beyond N hexes of home) and
  `?t=seconds` (cloud clock offset) for screenshots.

## Settings

The season panel's "✦ Map & Atmosphere" block has a **Map View** select
(persists `kw_map_view`; restored on init) and a **Reduce map detail** toggle
(persists `kw_map_low_detail`) and a **Drifting clouds** toggle (persists
`kw_map_clouds`). Default renderer is `topdown`; flip it by
changing `controller.activeId`'s initial value once iso has been lived with.

## Verification

Node harness, no deps. Each phase's suite spawns the previous, down to the
Phase-1 golden (the documented 29,711-op top-down render identity):

```
node verify/phase7_proofs.js   # settings + persistence + camera preservation → spawns 6→5→…
node verify/phase6_proofs.js   # performance ladder
node verify/phase2_proofs.js   # projection, hit-testing, buffers, determinism, grep gates
```

`verify/_harness.js` is the shared vm-sandbox + recording-ctx harness;
`verify/phase1_topdown_golden.json` is the top-down oracle (regenerate with
`verify/_gen_golden.js` only if the top-down path legitimately changes — it
should not without an explicit decision). `verify/iso_demo.html` is a
no-backend visual harness (`?season=`, `?sel=q,r`, `?view=topdown`).
