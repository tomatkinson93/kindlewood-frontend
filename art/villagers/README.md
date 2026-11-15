# Villager GIFs

The owner's source art for the villagers in the Home scene (`docs/HOME_SCENE.md` §3.1).

- One folder per species: `mouse/`, `fox/`, `badger/`, `otter/`, `mole/`, `hare/`.
- One GIF per animation and direction: `<animation>_<direction>.gif`, lowercase.
  - Animations: `walk`, `idle` (later `dance`, `work`).
  - Directions: `s`, `sw`, `w`, `nw`, `n`, `ne`, `e`, `se`.
  - Example: `mouse/walk_se.gif`, `mouse/idle_s.gif`.
- Frames as generated: 96 × 96 px, about 200 ms each. All GIFs of a species must be the same size.
- A missing direction is mirrored from its opposite (W from E, NW from NE, SW from SE), so
  `s`, `n`, `e`, `ne` and `se` per animation are enough.

Then pack them into sheets:

```bash
node scripts/pack_sprites.js
```

That writes `assets/sprites/villagers/<species>_<animation>.png` and `villagers.json`, which
the game reads. Until a species has sheets, the mouse's are used; until the mouse has any, a
placeholder is drawn. See it in the scene with `?villagers=test` in the address.
