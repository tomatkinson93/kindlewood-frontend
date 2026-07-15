# Kindlewood Map Upgrade — Phase 6 deploy (Performance & mobile)

Spec: `09_SPEC_..._REFINED.md` §6. Handoff Phase 6.

Phase 6 makes the iso renderer self-tune. It reacts to **rebuild** time (the
buffered renderer's cost lives in rebuilds, not per-frame blits): sustained slow
rebuilds step detail DOWN, sustained fast ones recover slowly. Buffer margin +
rebuild budget are device-tier aware, and a "Reduce map detail" setting pins the
ladder. All quality knobs already existed as hooks — this wires the control.

---

## Files to upload

| path | change | `?v=` |
|---|---|---|
| `js/kwmap-iso.js` | device tier + tunable margin, degradation ladder (`KWMap.perf`), HUD detail line | `?v=7` → **`?v=8`** |
| `js/kwmap-decor.js` | decor provider honours the ladder's `decorScale` | `?v=3` → **`?v=4`** |
| `index.html` | the two `?v=` bumps | — |

`kwmap-core.js`, `kwmap-assets.js`, `kwmap-topdown.js`, `seasons.js`, `main.js`,
`assets/iso/manifest.json` unchanged from Phase 5.

---

## The degradation ladder (spec §6.6, drop order)

Triggered on sustained slow rebuilds (`> budget×1.35`, twice); recovers on
sustained fast ones (`< budget×0.6`, six times — slow recovery). Levels:

| level | effect |
|---|---|
| 0 | full detail |
| 1 | decorations ×0.5 |
| 2 | decorations off |
| 3 | haze/vignette off |
| 4 | contact shadows off |
| 5 | suggest Top-Down (a flag — never auto-switches; the settings hint lands in Phase 7) |

- **Device tier:** `low` (≤4 cores or a screen dimension < 760) uses margin **96 px**
  + a **50 ms** rebuild budget; `high` uses margin **150 px** + **16 ms**.
- **"Reduce map detail"** pins the effective level ≥ 2 (decorations off), persisted
  as `localStorage['kw_map_low_detail']`. The mechanism + persistence ship here;
  the settings checkbox is Phase 7 — call `KWMap.perf.setLowDetail(true/false)`.

Debug: `?kwmapdebug=1` HUD now shows `tier/margin · detail N`.

---

## Verify before deploy

```
node verify/phase6_proofs.js        # → 21 passed, 0 failed (F spawns phase5 → … → P1 golden)
```

Covers: ladder step-down/recovery/clamp; the level→detail mapping (drop order);
the low-detail pin + persistence; decor honouring `decorScale`; the ladder
measurably reducing GROUND (decor-off) and TALL (shadows-off) work; sane
tier/margin/budget; determinism at a fixed level; and all prior suites green.

---

## In-browser check (live) + the mobile pass (yours)

Reload `?kwmapview=iso&kwmapdebug=1` on your 80×80 world:
- Pan around and watch the HUD `rebuild` ms. If rebuilds sit over ~22 ms, after
  a couple of them `detail` ticks up (you'll see decorations thin then drop) and
  the rebuild time falls under budget. When you stop stressing it, detail slowly
  recovers. `frame` stays ~0.2 ms throughout.
- Try `KWMap.perf.setLowDetail(true)` in the console → decorations off, `detail`
  shows `(low)`; `false` restores it.
- **DevTools 6× CPU throttle** (Performance tab) is the handoff's desktop stand-in
  for a slow device — the ladder should visibly engage.
- **Real-device mobile pass is yours to run** (the handoff assigns it): open the
  game on a phone with `?kwmapview=iso&kwmapdebug=1`, confirm it stays smooth
  (mobile auto-uses the smaller margin + 50 ms budget + earlier degradation).

## Notes

- Margin is kept moderate on purpose: a bigger buffer means rarer but *slower*
  individual rebuilds, and the per-rebuild spike is what you feel as a hitch.
- Next: **Phase 7** (Map View select in the season panel, persistence, the
  "Reduce map detail" checkbox UI, renderer README, optional default flip) and
  **Phase 4a** (top-down joins the registry).
