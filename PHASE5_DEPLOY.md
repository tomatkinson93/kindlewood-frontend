# Kindlewood Map Upgrade — Phase 5 deploy (Atmosphere polish)

Spec: `09_SPEC_..._REFINED.md` §7, §5.2. Handoff Phase 5.

Phase 5 adds the atmospheric haze/vignette, wires `invalidate('season')` so the
map's season-dependent layers refresh on a season flip, ships winter decor
variants (placeholder), and adds a selection **beacon** as occlusion relief
(a pin above the selected tile so it stays locatable behind canopies/massifs).
The shipped particle overlay + season grade are renderer-agnostic and work over
iso unchanged (verified — `season-atmosphere.js` never references the renderer).

---

## Files to upload

| path | change | `?v=` |
|---|---|---|
| `js/kwmap-iso.js` | haze/vignette gradient (`_hazeOn`), selection beacon in `renderUiFx` | `?v=5` → **`?v=6`** |
| `js/kwmap-decor.js` | winter placeholder variant (snow on props) via the season chain | `?v=1` → **`?v=2`** |
| `js/seasons.js` | `updateSeasonProgress` fires `KWMap.controller.invalidate('season')` on flip (guarded) | *(unversioned)* → **`?v=2`** |
| `index.html` | the three `?v=` bumps above | — |

`kwmap-core.js`, `kwmap-assets.js`, `kwmap-topdown.js`, `main.js`,
`assets/iso/manifest.json` unchanged from Phase 4.

---

## Verify before deploy

```
node verify/phase5_proofs.js        # → 11 passed, 0 failed (6 spawns phase4 → … → P1 golden)
```

Covers: haze draws exactly one full-frame radial gradient (and `_hazeOn=false`
disables it — the Phase 6 ladder hook); `seasons.js` fires `invalidate('season')`
and that triggers a buffer rebuild; winter decor variants swap the render while
positions stay hash-stable (no reshuffle); the selection beacon draws on the
uifx canvas; `season-atmosphere.js` is renderer-independent; and the full
P1–P4 suite still green.

Visual harness: `python3 -m http.server 8199` →
`.../verify/iso_demo.html?sel=15,10` (beacon + haze) and `?season=winter`
(snow decor).

---

## In-browser check (live)

Reload `?kwmapview=iso&kwmapdebug=1`:
- A soft warm vignette/haze deepens toward the corners (depth cue).
- Selecting a tile drops a small gold pin above it — visible even when the tile
  sits behind a canopy or mountain (the occlusion relief).
- When the season turns (or on the seasonal CSS crossfade), winter dusts the
  decorations with snow (flowers gone, snow piles appear) with no reshuffle;
  the existing particle overlay + season grade behave exactly as in top-down.

## Notes

- Haze is iso-only for now (top-down stays frozen). It's a single per-frame
  gradient — no rebuild cost — and `_hazeOn` is the Phase 6 degradation-ladder
  off switch.
- Winter decor art, when added under `/assets/iso/` + the manifest
  (`decor.<key>_winter`), supersedes the procedural snow with zero code change.
- Next: **Phase 6** (performance & mobile — margin tuning, degradation ladder,
  the "reduce map detail" toggle) and **Phase 4a** (top-down joins the registry).
