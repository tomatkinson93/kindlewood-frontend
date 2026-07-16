# Kindlewood — Tile Actions & Detail View (Spec v1)

*Companion to the map-renderer system (`docs/MAP_RENDERER.md`,
`09_SPEC_map_isometric_renderer_REFINED.md`). Defines the on-tile action
affordances and the zoomed **Tile Detail** modal, plus the incremental build
plan. Renderer-agnostic: everything here works over both Top-Down and Iso.*

---

## 0. Vision

Selecting a map tile should surface **context actions** and a way to **inspect**
the tile in depth:

- **Fog tile** → a small circular **Scout** button appears on the tile; clicking
  it opens the existing scout/expedition flow for that tile.
- **Discovered tile** → a **magnifying-glass (Inspect)** button appears; clicking
  it opens a **Tile Detail modal** — a zoomed, layered view of the tile.

The Tile Detail modal grows over time into a rich per-tile dashboard: a scene
(terrain background with built structures layered on), and panels for who owns
outposts/settlements here, which citizens are here (e.g. questing), points of
interest, quest targets, the resource breakdown + fertility, and — for water —
the kind of water present. Built **incrementally**; start simple.

---

## 1. Tile action buttons (selection affordances)

A small DOM overlay inside `#map-frame` (buttons are DOM, not canvas, so they're
naturally clickable — the uifx canvas is `pointer-events:none`). It sits above
the map/atmosphere/uifx canvases.

- **Positioning:** at the selected tile's screen position via the *active*
  renderer's `hexToScreen(wq, wr)` (works for both views; iso returns the
  ground-plane centre). Offset slightly above the tile, near the selection
  beacon. Re-positioned as the camera pans; hidden when the tile scrolls
  off-screen or nothing is selected.
- **Which buttons (by tile state):**
  | tile | button | action |
  |---|---|---|
  | fog / unexplored | **🧭 Scout** | `selectFogTile(wq, wr)` — surfaces the existing scout panel + `sendScout` |
  | discovered | **🔍 Inspect** | open the Tile Detail modal for the tile |
  - Future: extra quick-actions per tile (found outpost, send quest here, focus)
    can join the cluster without new plumbing.
- **Renderer-agnostic:** the module reads the shared selection globals
  (`_selectedTile`) + `worldMapData`, and the active renderer's `hexToScreen`.
  No renderer internals touched.
- **Non-interference:** buttons `stopPropagation` so they never trigger map
  click/drag; the container is `pointer-events:none`, buttons `:auto`.

## 2. Tile Detail modal (zoomed view)

A standard game modal (`#tile-detail-modal`, backdrop + card, same open/close
pattern as the other modals). Two regions:

### 2.1 Scene (top) — layered, art grows in over increments
- **Background layer:** the tile's terrain, eventually a painted per-terrain
  background (forest glade, hillside, riverbank, …). *Increment 1:* a terrain-
  tinted panel + large terrain glyph (reuses `TERRAIN_COLORS` / `WORLD_EMOJI`).
- **Structure layer(s):** outposts and settlements built on the tile, drawn on
  top of the background. *Increment 1:* the outpost/settlement glyphs as badges;
  later, real building art positioned in the scene.
- Future layers: roads, decorations, weather/season grade, POI markers.

### 2.2 Info panels (below)
Rendered from the tile object + existing globals; sections appear only when they
have data:
- **Header:** terrain label (`TERRAIN_LABELS`), coordinates, glyph. For water,
  the sub-type (Pond / River / Lake / Great Lake — the same neighbour-count
  logic as `_selectWorldTileImpl`).
- **Terrain bonus** (`TERRAIN_BONUSES_DISPLAY`).
- **Ownership:** your claim / claimed by X / unclaimed.
- **Outpost:** owner, tier/level, yields + upkeep (from `_outpostStatus.config`).
- **Settlement:** name, ruler, tier (if a settlement sits here).
- *(future)* **Citizens here** — your citizens present/questing on this tile
  (needs a per-tile citizen index; see §4).
- *(future)* **Points of interest / quest targets** — active quests targeting
  this tile, POIs.
- *(future)* **Resources & fertility** — per-resource yield breakdown +
  fertility rating (needs server fields; see §4).
- *(future)* **Water detail** — for fishing spots, the water body + fish table.

### 2.3 Actions (future)
Contextual buttons in the modal footer: Found Outpost here, Send Quest here,
Centre camera, etc. — each calling the existing endpoints/flows. Increment 1
keeps the modal read-only (inspect), with a link back to the side panel's
outpost controls.

---

## 3. Incremental build plan

- **Increment 1 (this pass):** the action buttons (Scout / Inspect) + the modal
  shell with the scene placeholder (terrain tint + glyph + structure badges) and
  the info sections that have data today (header + water sub-type, terrain bonus,
  ownership, outpost, settlement).
- **Increment 2:** layered scene art — per-terrain background images + building
  art positioned in the scene (drops in via an asset manifest, like the iso
  renderer's).
- **Increment 3:** citizens-here panel (per-tile citizen/expedition index) +
  quest-target / POI markers.
- **Increment 4:** resource breakdown + fertility + water/fish detail (server
  fields).
- **Increment 5:** in-modal contextual actions (found outpost, send quest, …).

## 4. Data / server notes

Available now on each tile: `terrain`, `settlement`, `outpost`, `claimed_by_me`,
`claim_owner`. Additive server fields future increments want (all read-only,
optional — the UI degrades gracefully without them):
- `fertility` (0–1 or tier) and a per-resource `yields` breakdown per tile.
- `water_type` / fish table for river/lake/marsh tiles.
- a way to list **citizens on a tile** (expeditions/quests already carry a
  target `(wx, wy)` — increment 3 can index those client-side first, server
  later).
- POI / quest-target markers per tile.

## 5. Constraints

- **Renderer-agnostic**, DOM overlay + modal; no renderer internals touched, no
  changes to the frozen top-down path or the Phase-1 identity.
- The overlay is a **read-only consumer** of `worldMapData` + game globals;
  gameplay changes go only through existing endpoints/flows (`selectFogTile` /
  `sendScout`, the outpost handlers, quest send, …).
- New files are classic scripts (`js/kwmap-tileactions.js`), `?v=` cache-busted,
  loaded after the map renderer. Modal markup in `index.html`, styling in
  `css/hud-storybook.css`.
- Placeholder scene art now; real art replaces it per key via a manifest with no
  code change (same convention as the iso renderer).
