'use strict';
// settlement-view.js — Layered environmental scene for settlement construction.
// Biome themes compose modular SVG layers; buildings render between midground/foreground.

// ── Biome config (eventually derived from world-map terrain) ──────────────────
const SV_BIOME = 'mountain';

// ── Layer registry ────────────────────────────────────────────────────────────
// z: stacking order within .sv-scene.
//   z 0–65 : environment layers (background → foreground)
//   z 70   : building fg slots — always above all env layers
// px/py: parallax pixel travel at cursor extreme (sky=least, foliage=most)
// Foreground PNG must be transparent in the settlement centre so buildings show.
const SV_LAYER_DEFS = {
  'sky':        { z:  0, px:  2, py:  1, image: '/assets/images/biomes/mountain/sky.png'        },
  'mtn-near':   { z: 20, px:  7, py:  4, image: '/assets/images/biomes/mountain/mountains.png'  },
  'hills':      { z: 30, px: 10, py:  6, image: '/assets/images/biomes/mountain/midground.png'  },
  'foliage-fg': { z: 65, px: 20, py: 12, image: '/assets/images/biomes/mountain/foreground.png' },
};

// ── Biome definitions ─────────────────────────────────────────────────────────
const SV_BIOMES = {
  mountain: ['sky', 'mtn-near', 'hills', 'foliage-fg'],
};

// ── Area building groups (used so any slot accepts any area building) ─────────
const SV_AREA_BUILDINGS = {
  town:      ['tavern', 'market', 'granary', 'starter_house'],
  outskirts: ['forager_hut', 'farm', 'lumber_camp', 'fishing_post', 'scout_post'],
};

// ── Slot definitions ──────────────────────────────────────────────────────────
const SV_SLOTS = [
  { id:'town-granary',  area:'town',      x:8,   y:74, accepts:['granary'],       label:'Granary Site',   size:'md' },
  { id:'town-tavern',   area:'town',      x:24,  y:72, accepts:['tavern'],        label:'Tavern Site',    size:'md' },
  { id:'town-house-3',  area:'town',      x:37,  y:80, accepts:['starter_house'], label:'Housing Plot',   size:'md' },
  { id:'town-market',   area:'town',      x:47,  y:78, accepts:['market'],        label:'Market Square',  size:'md' },
  { id:'town-house-1',  area:'town',      x:61,  y:72, accepts:['starter_house'], label:'Housing Plot',   size:'md' },
  { id:'town-house-2',  area:'town',      x:74,  y:65, accepts:['starter_house'], label:'Housing Plot',   size:'md' },
  { id:'out-forager',   area:'outskirts', x:16,  y:75, accepts:['forager_hut'],   label:'Forager Ground', size:'md' },
  { id:'out-farm',      area:'outskirts', x:31,  y:78, accepts:['farm'],          label:'Farmland',       size:'md' },
  { id:'out-lumber',    area:'outskirts', x:53,  y:70, accepts:['lumber_camp'],   label:'Lumber Site',    size:'md' },
  { id:'out-fishing',   area:'outskirts', x:77,  y:80, accepts:['fishing_post'],  label:'Fishing Dock',   size:'md' },
  { id:'out-scout',     area:'outskirts', x:87,  y:64, accepts:['scout_post'],    label:'Lookout Point',  size:'md' },
];

// ── Building visual config ────────────────────────────────────────────────────
const SV_VISUALS = {
  tavern:        { emoji:'\u{1F37A}', bodyColor:'#7a4225', roofColor:'#5c3018', flavor:'Warmth and ale for all who wander.',    image:'/assets/images/buildings/town/tavern.png'  },
  market:        { emoji:'⚖️',        bodyColor:'#b8860b', roofColor:'#8b6010', flavor:'Where fortunes are made and spent.',    image:'/assets/images/buildings/town/market.png'  },
  granary:       { emoji:'\u{1F33E}', bodyColor:'#8b7536', roofColor:'#6b5a2a', flavor:'Surplus grain against lean seasons.',   image:'/assets/images/buildings/town/granary.png' },
  starter_house: { emoji:'\u{1F3E1}', bodyColor:'#8b6048', roofColor:'#c87941', flavor:'Humble shelter, warm within.',    image:'/assets/images/buildings/town/housing1.png' },
  farm:          { emoji:'\u{1F331}', bodyColor:'#5a8040', roofColor:'#3d6030', flavor:'Neat rows of cultivated earth.' },
  lumber_camp:   { emoji:'\u{1FA93}', bodyColor:'#6b4020', roofColor:'#4a2c10', flavor:'Axes ring through the morning pines.' },
  fishing_post:  { emoji:'\u{1F3A3}', bodyColor:'#3a6080', roofColor:'#284860', flavor:'A patient dock above the quiet water.' },
  forager_hut:   { emoji:'\u{1F344}', bodyColor:'#607850', roofColor:'#485a38', flavor:'Into the woodland, lantern in hand.' },
  scout_post:    { emoji:'\u{1F5FA}️', bodyColor:'#5a5040', roofColor:'#3a3428', flavor:"The settlement's watchful eye." },
};

// ── Slot assignments (persisted to localStorage) ──────────────────────────────
const _SV_ASSIGN_KEY = 'sv_slot_assignments';
function _svGetAssignments() {
  try { return JSON.parse(localStorage.getItem(_SV_ASSIGN_KEY) || '{}'); } catch(e) { return {}; }
}
function _svSetAssignment(slotId, buildingId) {
  var a = _svGetAssignments();
  a[slotId] = buildingId;
  localStorage.setItem(_SV_ASSIGN_KEY, JSON.stringify(a));
}
function _svClearAssignment(buildingId) {
  var a = _svGetAssignments();
  Object.keys(a).forEach(function(k) { if (a[k] === buildingId) delete a[k]; });
  localStorage.setItem(_SV_ASSIGN_KEY, JSON.stringify(a));
}

// ── Slot sizes (persisted to localStorage) ────────────────────────────────────
const _SV_SIZE_KEY     = 'sv_slot_sizes';
const _SV_SIZE_DEFAULT = 72;
const _SV_SIZE_MIN     = 44;
const _SV_SIZE_MAX     = 130;
function _svGetSizes() {
  try { return JSON.parse(localStorage.getItem(_SV_SIZE_KEY) || '{}'); } catch(e) { return {}; }
}
function _svSaveSize(slotId, size) {
  var s = _svGetSizes();
  s[slotId] = Math.round(Math.max(_SV_SIZE_MIN, Math.min(_SV_SIZE_MAX, size)));
  localStorage.setItem(_SV_SIZE_KEY, JSON.stringify(s));
}
function _svGetSlotSize(slotId) {
  var s = _svGetSizes();
  return s[slotId] || _SV_SIZE_DEFAULT;
}

// ── Slot positions (persisted to localStorage) ────────────────────────────────
const _SV_POS_KEY = 'sv_slot_positions';
function _svGetPositions() {
  try { return JSON.parse(localStorage.getItem(_SV_POS_KEY) || '{}'); } catch(e) { return {}; }
}
function _svSavePos(slotId, x, y) {
  var p = _svGetPositions();
  p[slotId] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  localStorage.setItem(_SV_POS_KEY, JSON.stringify(p));
}
function _applySlotPositions() {
  var p = _svGetPositions();
  SV_SLOTS.forEach(function(sl) {
    if (_svDragSlot === sl.id) return; // don't override in-progress drag
    var el = document.getElementById('sv-slot-' + sl.id);
    if (!el) return;
    el.style.left = (p[sl.id] ? p[sl.id].x : sl.x) + '%';
    el.style.top  = (p[sl.id] ? p[sl.id].y : sl.y) + '%';
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let _svOpen         = false;
let _svBuildings    = [];
let _svSelectedSlot = null;
let _svActiveArea   = 'town';
let _svTargetX = 0, _svTargetY = 0;
let _svCurX    = 0, _svCurY    = 0;
let _svRafId   = null;
let _svCommBarHandler = null;
let _svStylesInjected = false;
let _svDOMBuilt       = false;
let _svEditMode       = false;
let _svDragSlot       = null;
let _svDragValid      = true;
let _svDragOrigPos    = null;
let _svDragOffset     = { x: 0, y: 0 };
let _svDragMoveHandler      = null;
let _svDragEndHandler       = null;
let _svDragTouchMoveHandler = null;
let _svDragTouchEndHandler  = null;
let _svResizeSlot        = null;
let _svResizeStartY      = 0;
let _svResizeOrigSize    = _SV_SIZE_DEFAULT;
let _svCurrentResizeSize = _SV_SIZE_DEFAULT;

// ── CSS ───────────────────────────────────────────────────────────────────────
function _injectSvStyles() {
  if (_svStylesInjected) return;
  _svStylesInjected = true;
  const s = document.createElement('style');
  s.id = 'settlement-view-styles';
  s.textContent = `
#settlement-view {
  position: fixed; left: 0; right: 0; bottom: 0;
  z-index: 800; display: none; flex-direction: column;
  background: #111820; opacity: 0; transition: opacity 0.45s ease;
}
#settlement-view.sv-visible { opacity: 1; }

.sv-header {
  position: absolute; top: 0; left: 0; right: 0; z-index: 10;
  display: flex; flex-direction: column; align-items: center;
  padding: 14px 16px 10px; gap: 8px;
  background: linear-gradient(to bottom, rgba(10,8,6,0.88) 0%, transparent 100%);
  pointer-events: none;
}
.sv-header > * { pointer-events: auto; }
.sv-header-title {
  font-size: 20px; font-weight: 700; color: #e8d090;
  text-shadow: 0 2px 8px rgba(0,0,0,0.7); letter-spacing: 0.08em;
}
.sv-area-tabs { display: flex; gap: 6px; }
.sv-area-tab {
  background: rgba(28,18,10,0.68); border: 1px solid rgba(180,140,80,0.32);
  color: rgba(200,180,140,0.65); padding: 5px 18px; border-radius: 20px;
  font-size: 13px; cursor: pointer; font-family: inherit; transition: all 0.22s;
}
.sv-area-tab:hover { background: rgba(60,38,18,0.78); border-color: rgba(220,180,100,0.52); color: #d4b878; }
.sv-area-tab.active { background: rgba(120,78,28,0.52); border-color: rgba(230,185,90,0.75); color: #f0d070; font-weight: 700; }

.sv-scene {
  position: absolute; inset: 0; overflow: hidden; user-select: none; cursor: default;
  z-index: 0;
  /* Permanent sky gradient — visible behind all layers, including when sky.png is absent */
  background: linear-gradient(to bottom, #1a2840 0%, #2c4878 28%, #4878ac 52%, #86acc8 74%, #b4ccb8 90%, #c8c4a0 100%);
}

.sv-layer {
  position: absolute; inset: -4%;
  width: 108%; height: 108%;
  will-change: transform;
  pointer-events: none;
}
.sv-env-layer {
  position: absolute; inset: -4%;
  width: 108%; height: 108%;
  will-change: transform; pointer-events: none;
}

/* Layer images — pointer-events:none is essential: HTML children of a
   pointer-events:none parent still receive events unless they opt out too */
.sv-layer-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%; object-fit: cover; object-position: center;
  opacity: 0; transition: opacity 0.6s ease;
  pointer-events: none;
}
.sv-layer-img.sv-img-loaded { opacity: 1; }

.sv-fg-layer { transition: opacity 0.45s ease; }
.sv-area-hidden { opacity: 0 !important; pointer-events: none !important; }

/* Slots re-enable pointer events within the passthrough fg layer */
.sv-slot { position: absolute; transform: translate(-50%,-50%); cursor: pointer; z-index: 2; pointer-events: auto; }
.sv-slot-empty { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.sv-slot-ring {
  border-radius: 50%; border: 3px dashed rgba(240,210,120,0.85);
  background: rgba(240,200,100,0.18);
  box-shadow: 0 0 14px rgba(255,200,70,0.35), inset 0 0 8px rgba(255,200,70,0.1);
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.28s, background 0.28s, box-shadow 0.28s;
  animation: sv-pulse 2.6s ease-in-out infinite;
}
.sv-slot-plus { color: rgba(255,220,100,0.92); font-size: 24px; line-height: 1; font-weight: 400; text-shadow: 0 0 8px rgba(255,180,0,0.6); transition: color 0.28s, transform 0.28s; }
.sv-slot-hint { font-size: 10px; color: rgba(240,210,120,0.9); white-space: nowrap; letter-spacing: 0.06em; text-shadow: 0 1px 6px rgba(0,0,0,1), 0 0 10px rgba(0,0,0,0.9); transition: color 0.25s; font-weight: 700; text-align: center; margin-top: 4px; }
.sv-slot-empty:hover .sv-slot-ring { border-color: rgba(255,220,80,1); background: rgba(255,210,80,0.28); box-shadow: 0 0 32px rgba(255,200,60,0.6), inset 0 0 16px rgba(255,200,60,0.18); animation: none; }
.sv-slot-empty:hover .sv-slot-plus { color: #fff7a0; transform: scale(1.2); text-shadow: 0 0 12px rgba(255,220,0,0.9); }
.sv-slot-empty:hover .sv-slot-hint { color: #fff0a0; }
.sv-slot-empty.locked { opacity: 0.4; cursor: default; }
.sv-slot-empty.locked:hover .sv-slot-ring { border-color: rgba(240,210,120,0.85); background: rgba(240,200,100,0.18); box-shadow: 0 0 14px rgba(255,200,70,0.35), inset 0 0 8px rgba(255,200,70,0.1); animation: sv-pulse 2.6s ease-in-out infinite; }
.sv-slot-empty.locked:hover .sv-slot-plus { color: rgba(255,220,100,0.92); transform: none; }
.sv-slot-empty.size-lg .sv-slot-ring { width: 90px; height: 90px; }
.sv-slot-empty.size-md .sv-slot-ring { width: 72px; height: 72px; }
.sv-slot-empty.size-sm .sv-slot-ring { width: 58px; height: 58px; }
@keyframes sv-pulse {
  0%,100% { border-color: rgba(240,210,120,0.7);  box-shadow: 0 0 10px rgba(255,200,70,0.25), inset 0 0 6px rgba(255,200,70,0.08); }
  50%      { border-color: rgba(255,225,100,0.98); box-shadow: 0 0 24px rgba(255,200,70,0.55), inset 0 0 12px rgba(255,200,70,0.18); }
}

.sv-building { display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: transform 0.22s ease, filter 0.22s ease; }
.sv-building:hover { transform: translateY(-5px) scale(1.06); filter: brightness(1.1); }
.sv-building-struct { position: relative; border-radius: 4px 4px 0 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1); }
.sv-building-roof { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); border-style: solid; border-left-color: transparent !important; border-right-color: transparent !important; border-top-color: transparent !important; }
.sv-building-emoji { font-size: 22px; line-height: 1; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45)); }
.sv-building-img { display: block; object-fit: contain; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.65)); pointer-events: none; mix-blend-mode: multiply; }
.sv-building-shadow { width: 75%; height: 7px; border-radius: 50%; background: rgba(0,0,0,0.18); margin-top: 2px; filter: blur(3px); }
.sv-building-name { font-size: 9.5px; font-weight: 700; color: #e8d090; text-shadow: 0 1px 5px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8); white-space: nowrap; margin-top: 5px; letter-spacing: 0.05em; text-align: center; }
.sv-building-name-img { margin-top: -6px; }
.sv-building-lv { font-size: 8.5px; color: rgba(220,190,120,0.72); background: rgba(0,0,0,0.52); border-radius: 8px; padding: 1px 5px; margin-top: 2px; letter-spacing: 0.06em; }

.sv-build-panel {
  position: absolute; bottom: 0; left: 50%;
  transform: translateX(-50%) translateY(110%);
  width: min(500px, 96vw);
  background: linear-gradient(160deg, #2a1e14 0%, #1e1510 100%);
  border: 1px solid rgba(180,140,80,0.45); border-bottom: none;
  border-radius: 14px 14px 0 0; padding: 20px 20px 32px; z-index: 20;
  transition: transform 0.38s cubic-bezier(0.34,1.48,0.64,1);
  box-shadow: 0 -10px 40px rgba(0,0,0,0.55);
}
.sv-build-panel.open { transform: translateX(-50%) translateY(0); }
.sv-bp-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.sv-bp-loc { font-size: 15px; font-weight: 700; color: #e8d090; }
.sv-bp-tag { font-size: 10px; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
.sv-bp-tag.town     { background: rgba(180,130,60,0.18); color: #d4a860; border: 1px solid rgba(180,130,60,0.28); }
.sv-bp-tag.outskirts{ background: rgba(100,160,60,0.18); color: #90c060; border: 1px solid rgba(100,160,60,0.28); }
.sv-bp-close { margin-left: auto; background: none; border: none; color: rgba(200,180,140,0.45); font-size: 22px; cursor: pointer; padding: 0 4px; line-height: 1; transition: color 0.2s; font-family: inherit; }
.sv-bp-close:hover { color: rgba(230,200,140,0.9); }
.sv-bp-options { display: flex; flex-direction: column; gap: 10px; }
.sv-bp-opt { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 8px; background: rgba(255,220,150,0.04); border: 1px solid rgba(180,140,80,0.18); transition: background 0.2s, border-color 0.2s, transform 0.18s; }
.sv-bp-opt.available { cursor: pointer; }
.sv-bp-opt.available:hover { background: rgba(255,220,150,0.09); border-color: rgba(220,180,100,0.38); transform: translateY(-1px); }
.sv-bp-opt.locked { opacity: 0.4; cursor: default; }
.sv-bp-emoji { font-size: 28px; line-height: 1; flex-shrink: 0; }
.sv-bp-info  { flex: 1; min-width: 0; }
.sv-bp-name  { font-size: 14px; font-weight: 700; color: #e8d090; }
.sv-bp-desc  { font-size: 11px; color: rgba(200,180,140,0.68); margin-top: 2px; line-height: 1.4; }
.sv-bp-cost  { font-size: 11px; color: rgba(210,200,150,0.78); margin-top: 4px; }
.sv-bp-action { flex-shrink: 0; }
.sv-bp-build-btn { padding: 7px 15px; border-radius: 6px; background: rgba(180,130,50,0.28); border: 1px solid rgba(220,170,80,0.48); color: #f0d070; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: background 0.2s, border-color 0.2s; font-family: inherit; }
.sv-bp-build-btn:hover { background: rgba(200,150,60,0.38); border-color: rgba(240,190,90,0.68); }
.sv-bp-upgrade-btn { padding: 7px 15px; border-radius: 6px; background: rgba(60,140,100,0.22); border: 1px solid rgba(80,180,120,0.38); color: #80d0a0; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: background 0.2s; font-family: inherit; }
.sv-bp-upgrade-btn:hover { background: rgba(80,160,120,0.32); }
.sv-bp-upgrade-btn:disabled { opacity: 0.35; cursor: default; }
.sv-bp-demolish-btn { margin-top: 14px; width: 100%; padding: 8px; background: rgba(160,40,30,0.15); border: 1px solid rgba(200,60,50,0.35); border-radius: 8px; color: rgba(220,100,80,0.8); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.2s; letter-spacing: 0.04em; }
.sv-bp-demolish-btn:hover { background: rgba(180,50,40,0.28); border-color: rgba(220,80,60,0.6); color: #e86050; }
.sv-bp-lv-badge { background: rgba(80,180,80,0.18); border: 1px solid rgba(80,180,80,0.35); color: #80c880; border-radius: 12px; padding: 4px 10px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.sv-occ-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.sv-occ-emoji { font-size: 34px; flex-shrink: 0; }
.sv-occ-name  { font-size: 16px; font-weight: 700; color: #e8d090; }
.sv-occ-lv    { font-size: 12px; color: rgba(200,180,120,0.65); margin-top: 3px; }
.sv-occ-desc  { font-size: 12px; color: rgba(200,180,140,0.72); line-height: 1.5; margin-bottom: 14px; }
.sv-occ-flavor{ font-size: 11px; color: rgba(180,160,120,0.55); font-style: italic; text-align: center; margin-top: 12px; line-height: 1.4; }

.sv-edit-btn {
  background: rgba(40,60,100,0.52); border: 1px solid rgba(100,150,220,0.35);
  color: rgba(140,180,240,0.75); padding: 5px 14px; border-radius: 20px;
  font-size: 12px; cursor: pointer; font-family: inherit; transition: all 0.22s;
}
.sv-edit-btn:hover { background: rgba(60,90,150,0.62); border-color: rgba(140,190,255,0.55); color: #a8ceff; }
.sv-edit-btn.sv-edit-active { background: rgba(60,110,200,0.38); border-color: rgba(160,200,255,0.7); color: #c0d8ff; font-weight: 700; }
.sv-edit-reset-btn {
  font-size: 11px; background: rgba(80,30,20,0.38); border: 1px solid rgba(200,80,60,0.35);
  color: rgba(220,110,90,0.82); padding: 4px 11px; border-radius: 16px;
  cursor: pointer; font-family: inherit; transition: all 0.2s;
}
.sv-edit-reset-btn:hover { background: rgba(120,40,30,0.48); color: #e87060; }
.sv-scene.sv-editing .sv-slot { cursor: grab; }
.sv-slot.sv-dragging { cursor: grabbing !important; z-index: 999 !important; transition: none !important; }
.sv-slot.sv-dragging .sv-building,
.sv-slot.sv-dragging .sv-slot-empty { filter: drop-shadow(0 8px 28px rgba(100,180,255,0.55)) brightness(1.18); }
.sv-slot.sv-drag-bad .sv-building,
.sv-slot.sv-drag-bad .sv-slot-empty { filter: drop-shadow(0 8px 24px rgba(255,80,60,0.7)) brightness(0.95); }
.sv-slot-resize {
  position: absolute; top: 100%; left: 50%;
  transform: translateX(-50%);
  margin-top: 5px; width: 32px; height: 10px;
  background: rgba(100,160,255,0.28); border: 1px solid rgba(100,160,255,0.5);
  border-radius: 5px; cursor: ns-resize;
  display: flex; align-items: center; justify-content: center;
  pointer-events: auto; transition: background 0.2s;
}
.sv-slot-resize:hover { background: rgba(100,160,255,0.5); }
.sv-slot-resize span { font-size: 7px; color: rgba(160,200,255,0.9); line-height: 1; pointer-events: none; }
.sv-slot.sv-resizing { z-index: 998 !important; }
.sv-slot.sv-resizing .sv-building,
.sv-slot.sv-resizing .sv-slot-empty { filter: drop-shadow(0 4px 16px rgba(100,160,255,0.45)); }
  `;
  document.head.appendChild(s);
}

// ── DOM bootstrap ─────────────────────────────────────────────────────────────
// (SVG fallbacks removed — env layers are image-only; the .sv-scene CSS gradient
//  is the permanent sky fallback when sky.png is absent.)

// ── DOM bootstrap ─────────────────────────────────────────────────────────────
function _buildEnvLayers(biomeId) {
  var layers = SV_BIOMES[biomeId];
  if (!layers) return;
  var scene   = document.getElementById('sv-scene');
  var fgTown  = document.getElementById('sv-layer-fg-town');

  scene.querySelectorAll('.sv-env-layer').forEach(function(el) { el.remove(); });

  for (var i = 0; i < layers.length; i++) {
    var lid = layers[i];
    var def = SV_LAYER_DEFS[lid];
    if (!def) continue;
    var div = document.createElement('div');
    div.className  = 'sv-env-layer';
    div.id         = 'sv-env-' + lid;
    div.dataset.px = def.px;
    div.dataset.py = def.py;
    div.style.zIndex = def.z;
    if (lid === 'mtn-near') {
      div.style.filter = 'brightness(0.82) contrast(1.2)';
    }
    if (!def.image) continue;
    var img = document.createElement('img');
    img.className = 'sv-layer-img';
    img.alt = '';
    img.onload  = function() { this.classList.add('sv-img-loaded'); };
    img.onerror = function() { var p = this.parentElement; if (p) p.remove(); };
    img.src = def.image;
    div.appendChild(img);
    if (def.z < 70) {
      scene.insertBefore(div, fgTown);
    } else {
      scene.appendChild(div);
    }
  }
}

function _ensureSvDOM() {
  _injectSvStyles();
  if (_svDOMBuilt) return;
  _svDOMBuilt = true;

  var root = document.getElementById('settlement-view');
  if (!root) {
    root = document.createElement('div');
    root.id = 'settlement-view';
    document.body.appendChild(root);
  }

  var townSlots = SV_SLOTS.filter(function(s) { return s.area === 'town'; });
  var outSlots  = SV_SLOTS.filter(function(s) { return s.area === 'outskirts'; });

  function slotHTML(sl) {
    return '<div class="sv-slot" id="sv-slot-' + sl.id + '" style="left:' + sl.x + '%;top:' + sl.y + '%" data-slot="' + sl.id + '"></div>';
  }

  root.innerHTML =
    '<div class="sv-scene" id="sv-scene">'
    + '<div class="sv-layer sv-fg-layer" id="sv-layer-fg-town" style="z-index:70">'
    + townSlots.map(slotHTML).join('') + '</div>'
    + '<div class="sv-layer sv-fg-layer sv-area-hidden" id="sv-layer-fg-outskirts" style="z-index:70">'
    + outSlots.map(slotHTML).join('') + '</div>'
    + '</div>'
    + '<div class="sv-header">'
    + '<span class="sv-header-title" id="sv-title">Settlement</span>'
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<button class="sv-area-tab active" data-area="town" onclick="_svSwitchArea(\'town\')">&#127960; Town</button>'
    + '<button class="sv-area-tab" data-area="outskirts" onclick="_svSwitchArea(\'outskirts\')">&#127807; Outskirts</button>'
    + '<span style="width:1px;height:18px;background:rgba(180,140,80,0.22);display:inline-block;margin:0 2px"></span>'
    + '<button class="sv-edit-btn" id="sv-edit-btn" onclick="_svToggleEditMode()">&#9998; Edit</button>'
    + '<button class="sv-edit-reset-btn" id="sv-edit-reset-btn" style="display:none" onclick="_svResetLayout()">&#8635; Reset</button>'
    + '</div></div>'
    + '<div class="sv-build-panel" id="sv-build-panel"></div>';

  _buildEnvLayers(SV_BIOME);
  _applySlotPositions();

  document.getElementById('sv-scene').addEventListener('click', function(e) {
    if (!e.target.closest('.sv-slot') && !e.target.closest('.sv-build-panel')) _closeBuildPanel();
  });
}

// ── Open / close ──────────────────────────────────────────────────────────────
async function openSettlementView() {
  _ensureSvDOM();
  _svOpen = true;
  _svSelectedSlot = null;

  var root    = document.getElementById('settlement-view');
  var topbar  = document.querySelector('.topbar');
  var commBar = document.querySelector('.community-bar');
  root.style.top = ((topbar ? topbar.offsetHeight : 0) + (commBar ? commBar.offsetHeight : 0)) + 'px';
  root.style.display = 'flex';
  root.offsetHeight;
  root.classList.add('sv-visible');

  var titleEl = document.getElementById('sv-title');
  if (titleEl && window.gameData && window.gameData.settlement && window.gameData.settlement.name) {
    titleEl.textContent = gameData.settlement.name;
  }

  _svSwitchArea(_svActiveArea, true);
  _bindParallax();

  var commBar = document.querySelector('.community-bar');
  if (commBar && !_svCommBarHandler) {
    _svCommBarHandler = function(e) {
      if (e.target.closest('.comm-btn')) closeSettlementView();
    };
    commBar.addEventListener('click', _svCommBarHandler);
  }

  await _svLoad();
}
window.openSettlementView = openSettlementView;

function closeSettlementView() {
  _svOpen = false;
  _closeBuildPanel();
  _unbindParallax();

  var commBar = document.querySelector('.community-bar');
  if (commBar && _svCommBarHandler) {
    commBar.removeEventListener('click', _svCommBarHandler);
    _svCommBarHandler = null;
  }

  var root = document.getElementById('settlement-view');
  root.classList.remove('sv-visible');
  root.addEventListener('transitionend', function() {
    if (!_svOpen) { root.style.display = 'none'; root.style.top = ''; }
  }, { once: true });
}
window.closeSettlementView = closeSettlementView;

// ── Area switching ────────────────────────────────────────────────────────────
function _svSwitchArea(area, force) {
  if (area === _svActiveArea && !force) return;
  _svActiveArea = area;
  _closeBuildPanel();
  var tl = document.getElementById('sv-layer-fg-town');
  var ol = document.getElementById('sv-layer-fg-outskirts');
  if (area === 'town') {
    if (tl) tl.classList.remove('sv-area-hidden');
    if (ol) ol.classList.add('sv-area-hidden');
  } else {
    if (ol) ol.classList.remove('sv-area-hidden');
    if (tl) tl.classList.add('sv-area-hidden');
  }
  document.querySelectorAll('.sv-area-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.area === area);
  });
}
window._svSwitchArea = _svSwitchArea;

// ── Data loading ──────────────────────────────────────────────────────────────
async function _svLoad() {
  try {
    var res = await apiFetch('/api/buildings');
    if (!res.ok) return;
    var data = await res.json();
    _svBuildings = data.buildings || [];
  } catch(e) { _svBuildings = []; }
  _renderScene();
}

async function refreshSettlementView() {
  if (!_svOpen) return;
  await _svLoad();
}
window.refreshSettlementView = refreshSettlementView;

// ── Scene rendering ───────────────────────────────────────────────────────────
function _renderScene() {
  for (var i = 0; i < SV_SLOTS.length; i++) {
    var slot = SV_SLOTS[i];
    var el   = document.getElementById('sv-slot-' + slot.id);
    if (!el) continue;
    el.innerHTML = '';
    el.onclick   = null;
    var occupant = _occupantFor(slot);
    if (occupant) {
      el.appendChild(_buildOccupiedEl(slot, occupant));
      if (!_svEditMode) (function(s, o) { el.onclick = function() { _openBuildPanel(s, o); }; })(slot, occupant);
    } else {
      var anyAvail = slot.accepts.some(function(id) {
        var b = _svBuildings.find(function(b) { return b.id === id; });
        return b && b.currentLevel === 0 && b.requiresMet;
      });
      var allLocked = slot.accepts.every(function(id) {
        var b = _svBuildings.find(function(b) { return b.id === id; });
        return !b || !b.requiresMet;
      });
      el.appendChild(_buildEmptyEl(slot, anyAvail, allLocked));
      if (!_svEditMode && anyAvail) (function(s) { el.onclick = function() { _openBuildPanel(s, null); }; })(slot);
    }
    if (_svEditMode) {
      var rh = document.createElement('div');
      rh.className = 'sv-slot-resize';
      rh.innerHTML = '<span>⇕</span>';
      el.appendChild(rh);
    }
  }
  _applySlotPositions();
}

function _occupantFor(slot) {
  var assignments = _svGetAssignments();
  var bid = assignments[slot.id];
  if (bid) {
    var b = _svBuildings.find(function(b) { return b.id === bid && b.currentLevel > 0; });
    if (b) return b;
    _svClearAssignment(bid); // stale — building was demolished elsewhere
  }
  return null;
}

function _buildEmptyEl(slot, available, locked) {
  var size = _svGetSlotSize(slot.id);
  var div = document.createElement('div');
  div.className = 'sv-slot-empty' + (locked ? ' locked' : '');
  if (!available && !locked) div.style.cursor = 'default';
  var plusSz = Math.round(size * 0.33);
  div.innerHTML = '<div class="sv-slot-ring" style="width:' + size + 'px;height:' + size + 'px">'
    + '<span class="sv-slot-plus" style="font-size:' + plusSz + 'px">' + (locked ? '🔒' : '+') + '</span>'
    + '</div>'
    + '<div class="sv-slot-hint">' + (locked ? '🔒 Locked' : 'Build here') + '</div>';
  return div;
}

function _buildOccupiedEl(slot, building) {
  var size = _svGetSlotSize(slot.id);
  var vis  = SV_VISUALS[building.id] || { emoji:'🏛', bodyColor:'#555', roofColor:'#333' };
  var div  = document.createElement('div');
  div.className = 'sv-building';
  var lvTag = building.currentLevel > 1 ? '<div class="sv-building-lv">Lv ' + building.currentLevel + '</div>' : '';
  if (vis.image) {
    var imgW = Math.round(size * 1.53);
    div.innerHTML = '<img src="' + vis.image + '" class="sv-building-img" style="width:' + imgW + 'px" alt="">'
      + '<div class="sv-building-name sv-building-name-img">' + building.label + '</div>'
      + lvTag;
  } else {
    var bw = Math.round(size * 0.72), bh = Math.round(size * 0.61), rw = Math.round(size * 0.80);
    var rh = Math.round(bh * 0.44);
    div.innerHTML = '<div class="sv-building-struct" style="width:' + bw + 'px;height:' + bh + 'px;background:' + vis.bodyColor + '">'
      + '<div class="sv-building-roof" style="border-width:0 ' + (rw/2) + 'px ' + rh + 'px ' + (rw/2) + 'px;border-bottom-color:' + vis.roofColor + '"></div>'
      + '<span class="sv-building-emoji">' + vis.emoji + '</span>'
      + '</div>'
      + '<div class="sv-building-shadow"></div>'
      + '<div class="sv-building-name">' + building.label + '</div>'
      + lvTag;
  }
  return div;
}

// ── Build panel ───────────────────────────────────────────────────────────────
function _openBuildPanel(slot, occupant) {
  _svSelectedSlot = slot;
  var panel   = document.getElementById('sv-build-panel');
  var areaTag = slot.area === 'town' ? 'Town' : 'Outskirts';
  var html    = '<div class="sv-bp-header"><span class="sv-bp-loc">' + slot.label + '</span>'
    + '<span class="sv-bp-tag ' + slot.area + '">' + areaTag + '</span>'
    + '<button class="sv-bp-close" onclick="_closeBuildPanel()">\xD7</button></div>';

  if (occupant) {
    var vis   = SV_VISUALS[occupant.id] || { emoji:'🏛', flavor:'' };
    var isMax = occupant.currentLevel >= occupant.maxLevel;
    var costStr = occupant.cost
      ? Object.entries(occupant.cost).map(function(e) { return _resIcon(e[0]) + ' ' + e[1]; }).join('  ')
      : '';
    var refundStr = occupant.cost
      ? Object.entries(occupant.cost).filter(function(e){ return e[1] > 0; })
          .map(function(e) { return _resIcon(e[0]) + ' ' + Math.floor(e[1] * 0.5); }).join('  ')
      : '';
    html += '<div class="sv-occ-head"><span class="sv-occ-emoji">' + vis.emoji + '</span>'
      + '<div><div class="sv-occ-name">' + occupant.label + '</div>'
      + '<div class="sv-occ-lv">Level ' + occupant.currentLevel + ' / ' + occupant.maxLevel + '</div></div>'
      + (isMax
        ? '<span class="sv-bp-lv-badge" style="margin-left:auto">★ MAX</span>'
        : '<button class="sv-bp-upgrade-btn" style="margin-left:auto" onclick="_svBuild(\'' + occupant.id + '\')">↑ Upgrade' + (costStr ? ' — ' + costStr : '') + '</button>')
      + '</div><div class="sv-occ-desc">' + (occupant.desc || '') + '</div>'
      + '<div class="sv-occ-flavor">' + (vis.flavor || '') + '</div>'
      + '<button class="sv-bp-demolish-btn" onclick="_svDemolish(\'' + occupant.id + '\')">🔨 Demolish' + (refundStr ? ' — refunds ' + refundStr : '') + '</button>';
  } else {
    var areaIds = SV_AREA_BUILDINGS[slot.area] || slot.accepts;
    var taken = Object.values(_svGetAssignments()); // already placed in other slots
    var opts = areaIds.filter(function(id) { return !taken.includes(id); }).map(function(id) {
      var b   = _svBuildings.find(function(b) { return b.id === id; });
      if (!b) return '';
      var vis = SV_VISUALS[id] || { emoji:'🏛' };
      var costStr = b.cost
        ? Object.entries(b.cost).map(function(e) { return _resIcon(e[0]) + ' ' + e[1]; }).join('  ')
        : 'Free';
      if (b.requiresMet && b.currentLevel === 0) {
        return '<div class="sv-bp-opt available"><span class="sv-bp-emoji">' + vis.emoji + '</span>'
          + '<div class="sv-bp-info"><div class="sv-bp-name">' + b.label + '</div>'
          + '<div class="sv-bp-desc">' + (b.desc || '') + '</div>'
          + '<div class="sv-bp-cost">' + costStr + '</div></div>'
          + '<div class="sv-bp-action"><button class="sv-bp-build-btn" onclick="_svBuild(\'' + id + '\')">Build</button></div></div>';
      }
      if (!b.requiresMet) {
        return '<div class="sv-bp-opt locked"><span class="sv-bp-emoji">' + vis.emoji + '</span>'
          + '<div class="sv-bp-info"><div class="sv-bp-name">' + b.label + '</div>'
          + '<div class="sv-bp-desc">Requires other buildings first.</div></div>'
          + '<span style="font-size:18px">🔒</span></div>';
      }
      return '';
    }).join('');
    html += '<div class="sv-bp-options">'
      + (opts || '<div style="color:rgba(200,180,140,0.45);font-size:13px;text-align:center;padding:14px 0">Nothing to construct here yet.</div>')
      + '</div>';
  }

  panel.innerHTML = html;
  panel.classList.add('open');
}

function _closeBuildPanel() {
  var p = document.getElementById('sv-build-panel');
  if (p) p.classList.remove('open');
  _svSelectedSlot = null;
}
window._closeBuildPanel = _closeBuildPanel;

function _svPlaySound(src) {
  var a = new Audio(src);
  a.volume = 0.65;
  a.play().catch(function() {});
}

async function _svBuild(buildingId) {
  if (typeof buildBuilding !== 'function') return;
  var slotId = _svSelectedSlot ? _svSelectedSlot.id : null;
  var bData  = _svBuildings.find(function(b) { return b.id === buildingId; });
  var cost   = bData ? bData.cost : null;
  _closeBuildPanel();
  await buildBuilding(buildingId);
  _svPlaySound('/assets/audio/construct.wav');
  if (slotId) _svSetAssignment(slotId, buildingId);
  if (cost && typeof _spawnFloater === 'function') {
    Object.entries(cost).forEach(function(e) { if (e[1]) _spawnFloater(e[0], -e[1]); });
  }
  await _svLoad();
}
window._svBuild = _svBuild;

async function _svDemolish(buildingId) {
  if (!window.confirm('Demolish this building? You will receive 50% of resources back.')) return;
  _closeBuildPanel();
  try {
    var res = await apiFetch('/api/buildings/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: buildingId }),
    });
    if (!res.ok) {
      var d = await res.json();
      alert(d.error || 'Demolition failed.');
      return;
    }
    var d = await res.json();
    _svClearAssignment(buildingId);
    if (typeof refreshResources === 'function') await refreshResources();
    if (d.refund && typeof _spawnFloater === 'function') {
      Object.entries(d.refund).forEach(function(e) { if (e[1]) _spawnFloater(e[0], e[1]); });
    }
    await _svLoad();
  } catch(e) {
    alert('Demolition failed.');
  }
}
window._svDemolish = _svDemolish;

function _resIcon(res) {
  return { food:'🌿', timber:'🌲', stone:'🪨', metal:'⚙️', wealth:'🪙' }[res] || res;
}

// ── Parallax ──────────────────────────────────────────────────────────────────
function _onParallaxMove(e) {
  var scene = document.getElementById('sv-scene');
  if (!scene) return;
  var r = scene.getBoundingClientRect();
  _svTargetX = ((e.clientX - r.left) / r.width  - 0.5) * 2;
  _svTargetY = ((e.clientY - r.top)  / r.height - 0.5) * 2;
  if (!_svRafId) _svRafId = requestAnimationFrame(_tickParallax);
}

function _tickParallax() {
  _svRafId = null;
  if (!_svOpen) return;
  var lerp = 0.07;
  _svCurX += (_svTargetX - _svCurX) * lerp;
  _svCurY += (_svTargetY - _svCurY) * lerp;

  // Each env layer carries its own px/py multiplier
  document.querySelectorAll('#sv-scene .sv-env-layer').forEach(function(el) {
    var px = +(el.dataset.px) || 0;
    var py = +(el.dataset.py) || 0;
    el.style.transform = 'translate(' + (_svCurX * px) + 'px,' + (_svCurY * py) + 'px)';
  });

  // Building fg layers — above all env layers (z:70); parallax between foliage-fg and rocks-fg
  var tFg = document.getElementById('sv-layer-fg-town');
  var oFg = document.getElementById('sv-layer-fg-outskirts');
  if (tFg) tFg.style.transform = 'translate(' + (_svCurX * 14) + 'px,' + (_svCurY * 8) + 'px)';
  if (oFg) oFg.style.transform = 'translate(' + (_svCurX * 14) + 'px,' + (_svCurY * 8) + 'px)';

  if (Math.abs(_svTargetX - _svCurX) > 0.001 || Math.abs(_svTargetY - _svCurY) > 0.001) {
    _svRafId = requestAnimationFrame(_tickParallax);
  }
}

function _bindParallax() {
  var sc = document.getElementById('sv-scene');
  if (sc) sc.addEventListener('mousemove', _onParallaxMove);
}

function _unbindParallax() {
  var sc = document.getElementById('sv-scene');
  if (sc) sc.removeEventListener('mousemove', _onParallaxMove);
  if (_svRafId) { cancelAnimationFrame(_svRafId); _svRafId = null; }
  _svCurX = _svCurY = _svTargetX = _svTargetY = 0;
}

// ── Edit mode ─────────────────────────────────────────────────────────────────
function _svToggleEditMode() {
  _svEditMode = !_svEditMode;
  var scene    = document.getElementById('sv-scene');
  var btn      = document.getElementById('sv-edit-btn');
  var resetBtn = document.getElementById('sv-edit-reset-btn');

  if (_svEditMode) {
    _closeBuildPanel();
    _unbindParallax();
    // Zero out parallax transforms so slots sit at their real positions
    document.querySelectorAll('#sv-scene .sv-env-layer').forEach(function(el) { el.style.transform = ''; });
    var tFg = document.getElementById('sv-layer-fg-town');
    var oFg = document.getElementById('sv-layer-fg-outskirts');
    if (tFg) tFg.style.transform = '';
    if (oFg) oFg.style.transform = '';
    scene.classList.add('sv-editing');
    if (btn) { btn.textContent = '✓ Done'; btn.classList.add('sv-edit-active'); }
    if (resetBtn) resetBtn.style.display = '';
    _svAttachDragHandlers();
  } else {
    scene.classList.remove('sv-editing');
    if (btn) { btn.textContent = '❖ Edit'; btn.classList.remove('sv-edit-active'); }
    if (resetBtn) resetBtn.style.display = 'none';
    _svDetachDragHandlers();
    _bindParallax();
  }
  _renderScene();
}
window._svToggleEditMode = _svToggleEditMode;

function _svResetLayout() {
  if (!window.confirm('Reset all slot positions and sizes to default?')) return;
  localStorage.removeItem(_SV_POS_KEY);
  localStorage.removeItem(_SV_SIZE_KEY);
  _renderScene(); // re-render with defaults (also calls _applySlotPositions internally)
}
window._svResetLayout = _svResetLayout;

function _svAttachDragHandlers() {
  SV_SLOTS.forEach(function(sl) {
    var el = document.getElementById('sv-slot-' + sl.id);
    if (!el) return;
    el.addEventListener('mousedown',  _svOnSlotMouseDown);
    el.addEventListener('touchstart', _svOnSlotTouchStart, { passive: false });
  });
}

function _svDetachDragHandlers() {
  SV_SLOTS.forEach(function(sl) {
    var el = document.getElementById('sv-slot-' + sl.id);
    if (!el) return;
    el.removeEventListener('mousedown',  _svOnSlotMouseDown);
    el.removeEventListener('touchstart', _svOnSlotTouchStart);
  });
  _svEndDrag();
}

function _svOnSlotMouseDown(e) {
  if (!_svEditMode) return;
  var slotId = this.dataset.slot;
  if (e.target.closest('.sv-slot-resize')) {
    e.preventDefault(); e.stopPropagation();
    _svBeginResize(slotId, e.clientY);
    _svDragMoveHandler = function(ev) { _svOnResizeMove(ev.clientY); };
    _svDragEndHandler  = function(ev) { _svOnResizeEnd(); };
    document.addEventListener('mousemove', _svDragMoveHandler);
    document.addEventListener('mouseup',   _svDragEndHandler);
    return;
  }
  e.preventDefault();
  _svBeginDrag(slotId, e.clientX, e.clientY);
  _svDragMoveHandler = function(ev) { _svOnDragMove(ev.clientX, ev.clientY); };
  _svDragEndHandler  = function(ev) { _svOnDragEnd(ev.clientX, ev.clientY); };
  document.addEventListener('mousemove', _svDragMoveHandler);
  document.addEventListener('mouseup',   _svDragEndHandler);
}

function _svOnSlotTouchStart(e) {
  if (!_svEditMode) return;
  var touch  = e.touches[0];
  var slotId = this.dataset.slot;
  if (e.target.closest('.sv-slot-resize')) {
    e.preventDefault(); e.stopPropagation();
    _svBeginResize(slotId, touch.clientY);
    _svDragTouchMoveHandler = function(ev) { ev.preventDefault(); _svOnResizeMove(ev.touches[0].clientY); };
    _svDragTouchEndHandler  = function() { _svOnResizeEnd(); };
    document.addEventListener('touchmove', _svDragTouchMoveHandler, { passive: false });
    document.addEventListener('touchend',  _svDragTouchEndHandler);
    return;
  }
  e.preventDefault();
  _svBeginDrag(slotId, touch.clientX, touch.clientY);
  _svDragTouchMoveHandler = function(ev) {
    ev.preventDefault();
    var t = ev.touches[0];
    _svOnDragMove(t.clientX, t.clientY);
  };
  _svDragTouchEndHandler = function(ev) {
    var t = ev.changedTouches[0];
    _svOnDragEnd(t.clientX, t.clientY);
  };
  document.addEventListener('touchmove', _svDragTouchMoveHandler, { passive: false });
  document.addEventListener('touchend',  _svDragTouchEndHandler);
}

function _svBeginDrag(slotId, clientX, clientY) {
  _svDragSlot  = slotId;
  _svDragValid = true;
  var p  = _svGetPositions();
  var sl = SV_SLOTS.find(function(s) { return s.id === slotId; });
  _svDragOrigPos = {
    x: p[slotId] ? p[slotId].x : (sl ? sl.x : 50),
    y: p[slotId] ? p[slotId].y : (sl ? sl.y : 50),
  };
  var pt = _svMouseToSlotPct(clientX, clientY);
  _svDragOffset = { x: pt.x - _svDragOrigPos.x, y: pt.y - _svDragOrigPos.y };
  var el = document.getElementById('sv-slot-' + slotId);
  if (el) el.classList.add('sv-dragging');
}

function _svOnDragMove(clientX, clientY) {
  if (!_svDragSlot) return;
  var pt = _svMouseToSlotPct(clientX, clientY);
  var x  = Math.max(3, Math.min(95, pt.x - _svDragOffset.x));
  var y  = Math.max(10, Math.min(93, pt.y - _svDragOffset.y));
  _svDragValid = !_svHasOverlap(_svDragSlot, x, y);
  var el = document.getElementById('sv-slot-' + _svDragSlot);
  if (el) {
    el.style.left = x + '%';
    el.style.top  = y + '%';
    el.classList.toggle('sv-drag-bad', !_svDragValid);
  }
}

function _svOnDragEnd(clientX, clientY) {
  if (!_svDragSlot) return;
  var slotId = _svDragSlot;
  var el = document.getElementById('sv-slot-' + slotId);
  if (_svDragValid && el) {
    var x = parseFloat(el.style.left);
    var y = parseFloat(el.style.top);
    _svSavePos(slotId, x, y);
  } else if (el && _svDragOrigPos) {
    el.style.left = _svDragOrigPos.x + '%';
    el.style.top  = _svDragOrigPos.y + '%';
  }
  _svEndDrag();
}

function _svEndDrag() {
  if (_svDragSlot) {
    var el = document.getElementById('sv-slot-' + _svDragSlot);
    if (el) { el.classList.remove('sv-dragging'); el.classList.remove('sv-drag-bad'); }
  }
  _svDragSlot = null; _svDragValid = true; _svDragOrigPos = null; _svDragOffset = { x: 0, y: 0 };
  if (_svDragMoveHandler)      { document.removeEventListener('mousemove', _svDragMoveHandler);      _svDragMoveHandler = null; }
  if (_svDragEndHandler)       { document.removeEventListener('mouseup',   _svDragEndHandler);        _svDragEndHandler = null; }
  if (_svDragTouchMoveHandler) { document.removeEventListener('touchmove', _svDragTouchMoveHandler); _svDragTouchMoveHandler = null; }
  if (_svDragTouchEndHandler)  { document.removeEventListener('touchend',  _svDragTouchEndHandler);  _svDragTouchEndHandler = null; }
}

function _svMouseToSlotPct(clientX, clientY) {
  var scene = document.getElementById('sv-scene');
  if (!scene) return { x: 50, y: 50 };
  var r = scene.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width  * 100 + 4) / 1.08,
    y: ((clientY - r.top)  / r.height * 100 + 4) / 1.08,
  };
}

function _svHasOverlap(dragSlotId, x, y) {
  var dragSl   = SV_SLOTS.find(function(s) { return s.id === dragSlotId; });
  var dragArea = dragSl ? dragSl.area : null;
  var p = _svGetPositions();
  for (var i = 0; i < SV_SLOTS.length; i++) {
    var sl = SV_SLOTS[i];
    if (sl.id === dragSlotId) continue;
    if (dragArea && sl.area !== dragArea) continue;
    var sx   = p[sl.id] ? p[sl.id].x : sl.x;
    var sy   = p[sl.id] ? p[sl.id].y : sl.y;
    var dist = Math.sqrt(Math.pow(x - sx, 2) + Math.pow(y - sy, 2));
    if (dist < 8) return true;
  }
  return false;
}

// ── Slot resizing ─────────────────────────────────────────────────────────────
function _svBeginResize(slotId, clientY) {
  _svResizeSlot     = slotId;
  _svResizeStartY   = clientY;
  _svResizeOrigSize = _svGetSlotSize(slotId);
  _svCurrentResizeSize = _svResizeOrigSize;
  var el = document.getElementById('sv-slot-' + slotId);
  if (el) el.classList.add('sv-resizing');
}

function _svOnResizeMove(clientY) {
  if (!_svResizeSlot) return;
  // drag up (negative delta) = bigger; drag down = smaller
  var delta   = _svResizeStartY - clientY;
  var newSize = Math.max(_SV_SIZE_MIN, Math.min(_SV_SIZE_MAX, _svResizeOrigSize + delta * 0.6));
  _svCurrentResizeSize = newSize;
  _svApplySizeToSlot(_svResizeSlot, newSize);
}

function _svOnResizeEnd() {
  if (!_svResizeSlot) return;
  var finalSize = Math.round(_svCurrentResizeSize);
  _svSaveSize(_svResizeSlot, finalSize);
  var el = document.getElementById('sv-slot-' + _svResizeSlot);
  if (el) el.classList.remove('sv-resizing');
  _svResizeSlot        = null;
  _svCurrentResizeSize = _SV_SIZE_DEFAULT;
  _renderScene();
}

function _svApplySizeToSlot(slotId, size) {
  var el = document.getElementById('sv-slot-' + slotId);
  if (!el) return;
  var ring = el.querySelector('.sv-slot-ring');
  if (ring) {
    ring.style.width  = size + 'px';
    ring.style.height = size + 'px';
    var plus = ring.querySelector('.sv-slot-plus');
    if (plus) plus.style.fontSize = Math.round(size * 0.33) + 'px';
  }
  var img = el.querySelector('.sv-building-img');
  if (img) img.style.width = Math.round(size * 1.53) + 'px';
  var struct = el.querySelector('.sv-building-struct');
  if (struct) {
    struct.style.width  = Math.round(size * 0.72) + 'px';
    struct.style.height = Math.round(size * 0.61) + 'px';
  }
}
