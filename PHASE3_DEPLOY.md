# Kindlewood Map Upgrade — Phase 3 deploy (TALL pass + depth)

Spec: `09_SPEC_..._REFINED.md` §3.1, §3.2, §7, §12.3, §12.10. Handoff Phase 3.

Phase 3 replaces the temporary flat settlement/outpost markers with a real
**depth-sorted TALL buffer**: terrain features (forest canopy, mountain massif,
hill relief), settlements, and outposts, each with a contact-shadow ellipse,
sorted back→front by `(ground-Y, layer, x)`. The elevation hit-scan (Phase 2)
already makes feature/building sprites inert to clicks.

---

## Files to upload

| path | change | `?v=` |
|---|---|---|
| `js/kwmap-iso.js` | TALL buffer + 3 providers (`terrain-features`, `settlements`, `outposts`), depth sort, contact shadows, content-signature refresh, raised-terrain uifx lift (from the prior fix) | `?v=2` → **`?v=3`** |
| `index.html` | bumped `kwmap-iso.js` to `?v=3` | — |

**Nothing else changed.** `kwmap-core.js`, `kwmap-assets.js`, `kwmap-topdown.js`,
`main.js`, and `assets/iso/manifest.json` are unchanged from Phase 2. This is a
two-file redeploy (`js/kwmap-iso.js` + `index.html`).

---

## Verify before deploy

```
node verify/phase3_proofs.js        # → 14 passed, 0 failed (spawns phase2_proofs → 20/20)
```

Covers: raised-terrain + feature-inert hit-testing (§12.3); the layer-stack
contract (§12.10 a: depth beats layer — a front-tile NPC draws over a back-tile
building and under a front-tile building; b: within a tile, higher layer draws
later — outpost over canopy); an externally-registered provider appearing in
the TALL pass with zero `kwmap-*` edits (§3.0); TALL-buffer determinism; one
contact shadow per drawable; content-signature refresh; and the full P1/P2
suite still green.

Visual harness (no backend):
```
python3 -m http.server 8199        # open http://localhost:8199/verify/iso_demo.html
```

---

## In-browser check (live)

Reload with `?kwmapview=iso&kwmapdebug=1`:
- Forests show raised canopies that overlap the tiles behind them; mountains
  show snow-capped massifs; hills show low relief — all with soft contact
  shadows. Settlement/outpost tokens now sit on shadows and sort with the scene.
- Panning stays smooth; the HUD's `rebuild` ms rises a little vs Phase 2 (it now
  paints two buffers) but should stay well under 16 ms desktop.
- Build/dismantle an outpost → it appears/updates immediately in iso (the
  content signature triggers a rebuild without any `main.js` change).

---

## Notes / limitations

- **Placeholder features** reuse simple canvas primitives (deterministic, no art
  files). Real canopy/massif/relief art drops in via the manifest with no code
  change. Some visual overlap with the painter faces' baked detail is expected
  until ground-only art arrives.
- **Content signature:** a cheap per-frame read-only pass over tiles keeps the
  iso view live on state changes while `main.js` stays frozen (it never calls
  `invalidate('tiles')`). Phase 4a wires real invalidation and this can drop.
- **Rivers** are still recessed terrain (flow overlay = future `RIVER_OVERLAY`).
- **Decorations** (Phase 4) and **top-down joining the registry** (Phase 4a)
  are next.
