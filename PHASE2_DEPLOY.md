# Kindlewood Map Upgrade — Phase 2 deploy (Iso ground plane + projection + hit-testing)

Spec: `09_SPEC_map_isometric_renderer_REFINED.md` §2, §3.1 GROUND, §4, §6.7, §8.2.
Handoff: `10_IMPL_phase27_handoff.md` — Phase 2.

Phase 2 adds an **isometric renderer** alongside the frozen top-down one:
squashed-hex terrain faces + skirts, a cached GROUND buffer, exact
projection + inverse, elevation-aware hit-testing, and a runtime placeholder
atlas so the map is fully playable **with zero art**. Top-down remains the
default and is byte-for-byte unchanged.

---

## Files to upload

### New — deploy in the zip
| path | notes |
|---|---|
| `js/kwmap-assets.js`   | manifest loader + runtime placeholder atlas (`KWMap.assets` / `window.KWAssets`) |
| `js/kwmap-iso.js`      | `IsometricRenderer` (registered `'iso'`): projection, GROUND buffer, hit-scan, providers, dev HUD |

### Changed — deploy in the zip
| path | change | `?v=` bump |
|---|---|---|
| `js/kwmap-core.js` | **two additive hooks only** (see below) — top-down output unchanged | `?v=1` → **`?v=2`** |
| `index.html` | added the two Phase-2 script tags; bumped `kwmap-core.js` to `?v=2` | — |

The two `kwmap-core.js` hooks (both additive, both guarded so the deployed
top-down path is untouched):
1. `controller.listProviders()` — read access to the provider registry so the
   active renderer can consume it (§3.0). Top-down ignores it until Phase 4a.
2. `_renderUiFx` delegates to the active renderer's `renderUiFx` **when it
   defines one**. Top-down defines none → its verbatim Phase-1 uifx block runs
   unchanged. Iso needs this for iso-projected hover/selection strokes.

### New — upload MANUALLY under `/assets/iso/` (never zipped, same as audio)
| path | notes |
|---|---|
| `assets/iso/manifest.json` | placeholder-only (no atlases/sprites yet). A 404 here is harmless — the renderer falls back to procedural placeholders. Add atlas + sprite entries as real art arrives; the loader re-resolves per key with **no code change**. |

### Index — new `<script>` tags (already in `index.html`)
```html
<script src="/js/kwmap-core.js?v=2"></script>      <!-- bumped -->
<script src="/js/kwmap-topdown.js?v=1"></script>
<script src="/js/kwmap-assets.js?v=1"></script>    <!-- new -->
<script src="/js/kwmap-iso.js?v=1"></script>       <!-- new -->
```
Load order: after `pixelart.js` + `kwmap-core.js`, before `main.js`.

### Dev-only — NOT deployed (verification harness)
`verify/_harness.js`, `verify/_gen_golden.js`, `verify/phase1_topdown_golden.json`,
`verify/phase1_proofs.js`, `verify/phase2_proofs.js`, `verify/iso_demo.html`.

---

## Verify before deploy

```
node verify/phase2_proofs.js        # → 20 passed, 0 failed
```

What it proves:
- **Top-down untouched** — with `kwmap-assets.js` + `kwmap-iso.js` loaded and the
  iso providers registered, top-down's render log (ui null + ui set), uifx
  strokes, and 34-point hit table are byte-identical to the committed golden
  (`verify/phase1_topdown_golden.json`, the documented 29,711-op identity).
- **Iso round-trip** — `hexToScreen→screenToHex` returns the same tile for every
  on-screen tile, at 5 cameras incl. both wrap seams + a corner (flat world).
- **Elevation rules** — points built from the forward transform: mountain face →
  mountain; recessed river face → river; flat plains → itself; tile directly
  behind a peak (occluded) → the peak; visible sliver two rows behind → that tile.
- **Buffer** — pan < margin ⇒ pure blit (no rebuild); pan past margin ⇒ exactly
  one rebuild; the rebuilt buffer fully covers the viewport (no gap).
- **Determinism** — two independent GROUND rebuilds give identical ctx logs.
- **Registry** + **grep gates** (no `apiFetch` / `Math.random` / gameplay writes).

> Note: `verify/phase1_proofs.js` needs the **pre-Phase-1 monolithic `main.js`**
> for its A/B render-identity tests (`node verify/phase1_proofs.js OLD_MAIN .`).
> That file isn't in the repo, so Phase 2 protects the top-down identity instead
> via the committed golden + `phase2_proofs.js` test A (same 29,711-op guarantee).

Optional visual harness (no backend needed):
```
python3 -m http.server 8199        # from repo root
# open  http://localhost:8199/verify/iso_demo.html            (iso)
#       http://localhost:8199/verify/iso_demo.html?view=topdown
```

---

## 2-minute in-browser checklist (on the live game)

1. Load the game normally → **top-down is the default**, unchanged.
2. Append **`?kwmapview=iso`** to the URL → the map shows the iso placeholder
   diorama: squashed terrain faces with side-wall skirts, raised mountains/hills
   overlapping tiles behind them, the drifting fog cloud at unexplored edges,
   gold claim borders, and settlement/outpost markers.
3. **Click** a tile in iso → the correct tile's side panel opens (same panel as
   top-down). Click a **mountain's raised face** → selects the mountain tile.
4. **Hover** tiles → the selection/hover outline lands on the correct tile.
5. Append **`?kwmapdebug=1`** → a small HUD (top-left) shows frame ms, rebuild
   ms, rebuild count, active renderer. Pan with arrow keys / drag: panning
   within the buffer margin is a pure blit (rebuild count holds); crossing the
   margin bumps it by one.
6. Switch back with **`?kwmapview=topdown`** (or clear it) → top-down returns,
   same camera focus.

> The iso view **persists** the choice (`localStorage['kw_map_view']`) — that's
> intentional for the dev flag. The real Phase 7 settings toggle supersedes it.

---

## Known Phase-2 limitations (by design; addressed in later phases)

- **Rivers/lakes** render as recessed terrain, not flowing water — the water
  overlay is the future `RIVER_OVERLAY` (layer 30) provider. Top-down keeps its
  full water treatment.
- **Settlements/outposts** are temporary flat disc+emoji markers. Phase 3 makes
  them real depth-sorted TALL sprites with contact shadows.
- **No TALL pass / decorations yet** (Phase 3 / Phase 4).
- The GROUND buffer rebuilds on pan-past-margin / resize / season / explicit
  `invalidate()`. Because `main.js` is frozen, an outpost build or dev terrain
  edit doesn't yet fire `invalidate('tiles')`, so the buffered **claim border**
  can lag one rebuild (the live marker + panel are immediate). Phase 4a wires
  proper tile invalidation when top-down joins the registry.
