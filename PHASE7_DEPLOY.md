# Kindlewood Map Upgrade — Phase 7 deploy (Settings + docs)

Spec: `09_SPEC_..._REFINED.md` §9, §12.9. Handoff Phase 7.

Phase 7 makes the iso view a first-class **player setting** and documents the
renderer system. The season panel's atmosphere block is retitled
**"✦ Map & Atmosphere"** and gains a **Map View** select (Top-Down / Isometric)
and a **Reduce map detail** toggle. Switching views preserves camera focus (the
shared `{q,r}`), verified. The default stays Top-Down — flip it when you're
ready (one line).

---

## Files to upload

| path | change | `?v=` |
|---|---|---|
| `js/seasons.js` | Map View select + Reduce-map-detail toggle in the panel, wired to `KWMap.controller.setRenderer` / `KWMap.perf.setLowDetail` | `?v=2` → **`?v=3`** |
| `css/hud-storybook.css` | `.sp-select` styling for the Map View row | `?v=43` → **`?v=44`** |
| `index.html` | the two `?v=` bumps | — |
| `docs/MAP_RENDERER.md` | NEW — renderer-system README (dev doc, not shipped to the browser) |

No `kwmap-*.js` changes — the mechanisms (`setRenderer` persistence + restore,
`KWMap.perf.setLowDetail`) already shipped in Phases 1 and 6. This is a
UI + docs phase.

---

## Verify before deploy

```
node verify/phase7_proofs.js        # → 17 passed, 0 failed (E spawns phase6 → … → P1 golden)
```

Covers: the panel markup + wiring + `.sp-select` CSS; `setRenderer` switch +
`kw_map_view` persistence + restore-on-init; **camera focus preserved across a
switch** (§12.9 — the same `{q,r}` centre lands at screen centre in both views);
Reduce-map-detail persistence + ladder pin; and all prior suites green.

---

## In-browser check (live)

1. Open the season panel (click the season badge). Under **✦ Map & Atmosphere**
   you'll see **Map view** (Top-Down / Isometric) and **Reduce map detail**.
2. Switch **Map view → Isometric** → the map flips to iso, centred on the same
   tile you were looking at. Reload → it stays iso (persisted). Switch back →
   top-down, same centre.
3. **Reduce map detail** → decorations drop and the perf ladder pins low (great
   as a perf/accessibility escape hatch); reload → it sticks.
4. The `?kwmapview=` URL flag still works for quick testing but is no longer
   needed — the panel is the real control now.

---

## Flipping the default to Isometric (when you're ready)

Once you've lived with iso and want new sessions to start there, change the
controller's initial renderer in `js/kwmap-core.js`:

```js
const controller = { camera, activeId: 'topdown', ...   // → 'iso'
```

Players who have already chosen a view keep their `kw_map_view` choice either
way. That's the whole flip — bump `kwmap-core.js`'s `?v=` when you do it.

## Remaining

- **Phase 4a** (top-down joins the provider registry — the delicate pixel-
  identity step) is the only piece left from the plan. It's internal
  architecture unification (no new player-facing feature) and unfreezes
  `kwmap-topdown.js`, so it's best done deliberately; the Phase-1 golden is the
  immovable gate.
