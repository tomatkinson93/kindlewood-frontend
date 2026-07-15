# Kindlewood Map Upgrade — Phase 4 deploy (Decorations)

Spec: `09_SPEC_..._REFINED.md` §5, §8.2. Handoff Phase 4.

Phase 4 adds `js/kwmap-decor.js`: cosmetic, deterministic decorations. Placement
is a pure function of `(worldSeed, q, r)` (fnv1a32 + mulberry32), season-
independent, memoized per tile. Flat props (flowers, bushes, rocks, mushrooms,
logs, fences) draw into the GROUND buffer at layer 40 (under claim borders);
tall props (lone tree, standing stone) depth-sort into the TALL buffer. Season-
only props (snow piles / leaf litter / blossom) come from a second salted
stream. Decorations are NEVER consulted by hit-testing or any gameplay route.

---

## Files to upload

| path | change | `?v=` |
|---|---|---|
| `js/kwmap-decor.js` | NEW — decor tables, seeded placement, provider on `L.DECOR`, procedural placeholder sprites | `?v=1` |
| `js/kwmap-iso.js` | consumption generalized + flat-decor face clipping | `?v=3` → **`?v=5`** |
| `index.html` | added the decor script tag; bumped `kwmap-iso.js` to `?v=4` | — |

`kwmap-core.js`, `kwmap-assets.js`, `kwmap-topdown.js`, `main.js`, and
`assets/iso/manifest.json` are unchanged from Phase 3.

Index load order (decor loads after the iso renderer):
```html
<script src="/js/kwmap-assets.js?v=1"></script>
<script src="/js/kwmap-iso.js?v=4"></script>
<script src="/js/kwmap-decor.js?v=1"></script>
```

---

## Verify before deploy

```
node verify/phase4_proofs.js        # → 11 passed, 0 failed (H spawns phase3 → phase2 → P1 golden)
```

Covers: deterministic + season-independent placement; season flip changes sprite
keys only (base positions hash-stable: `summer − flowers === winter − snow`);
worldSeed reshuffles + `worldSeedOf` (seed / world_meta / fallback 1); decor
inert to hit-testing; GROUND + TALL determinism with decor; top-down still
byte-identical to golden with decor loaded; grep gate (no `Math.random` etc.);
and the full P1/P2/P3 suite still green.

Visual harness (no backend): `python3 -m http.server 8199` →
`http://localhost:8199/verify/iso_demo.html`.

---

## worldSeed (optional, one-field server change — spec §13.3)

Decor placement reads the world seed in this order:
`worldMapData.seed` → `worldMapData.world_meta.current_seed` → the constant `1`.

It works fine on the constant fallback (deterministic per position). To make
decor vary per generated world, include the seed in the `/api/map/world`
payload (`world_meta.current_seed` is already selected server-side in the
regenerate path). This is the **only** server touch in the whole feature and is
optional for v1.

---

## In-browser check (live)

Reload `?kwmapview=iso&kwmapdebug=1`:
- Plains gain small flowers / bushes / rocks; hills scatter rocks; forest floors
  get mushrooms & logs; the odd lone tree / standing stone appears (rare) and
  depth-sorts like other tall content. Density is deliberately modest so the
  busy forest/mountain tiles don't clutter.
- Props are stable across pans and season changes (positions never reshuffle);
  in winter flowers vanish and snow piles appear at reserved spots.

## Notes / limitations

- **Placeholder sprites** are procedural (deterministic canvas primitives). Real
  decor art drops in via the manifest per key with no code change.
- Rivers still recessed terrain; **Phase 4a** (top-down joins the registry) and
  **Phase 5** (atmosphere polish, winter decor variants, the reveal-on-select /
  occlusion-relief options) are next.
