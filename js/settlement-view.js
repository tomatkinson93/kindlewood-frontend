'use strict';
// settlement-view.js — Layered environmental scene for settlement construction.
// Biome themes compose modular SVG layers; buildings render between midground/foreground.

// ── The backdrop (docs/ART_GUIDE.md §2, §4.2) ─────────────────────────────────
// A sky drawn by code (its colours follow the time of day: css/home-scene.css),
// two far strips that tile sideways (mountains, then a tree line) and one flat
// meadow that tiles both ways. The horizon sits at a quarter of the height; the
// tree line's foot overlaps the meadow by 12 px so there is no seam. Sizes are
// on screen; the files are twice that.
const SV_ART = '/assets/images/scene_v2/';
const SV_HORIZON = 0.25;
const SV_BACKDROP = {
  mountains: { file: SV_ART + 'backdrop/mountains.webp', w: 2000, h: 82,  pan: 0.45 },
  trees:     { file: SV_ART + 'backdrop/trees.webp',     w: 2000, h: 120, pan: 0.75 },
  ground:    { file: SV_ART + 'backdrop/ground.webp',    w: 1000, h: 363 },
};
// Town and the Outskirts are wider than a screen and pan sideways (§4.4).
const SV_WORLD_W = 2600;

// ── Buildable ids ─────────────────────────────────────────────────────────────
// Any building can go in any building slot. The list comes from the server's
// building data, so new buildings appear without a change here; housing is
// managed through the Neighbourhood slot instead.
function _svSlotBuildingIds() {
  return _svBuildings
    .filter(function(b) { return b.id !== 'housing' && b.id !== 'starter_house'; })
    .map(function(b) { return b.id; });
}

// ── Slot definitions ──────────────────────────────────────────────────────────
// `accepts` is the slot's default building: a building built outside this view
// (e.g. from the sidebar) is shown here if it isn't placed anywhere else. It
// does not restrict what can be built in the slot.
const SV_SLOTS = [
  // Town, back row (feet at 56 %), then the front row (feet at 92 %), staggered.
  { id:'town-granary',       area:'town',      x:11,  y:56, accepts:['granary'],      label:'West Quarter',  size:'md' },
  { id:'town-tavern',        area:'town',      x:29,  y:56, accepts:['tavern'],        label:'Town Centre',   size:'md' },
  { id:'town-guildhall',     area:'town',      x:49,  y:56, accepts:['guild_hall'],    label:'Guild Row',     size:'md' },
  { id:'town-neighbourhood', area:'town',      x:68,  y:56, type:'neighbourhood',      label:'Neighbourhood', size:'md' },
  { id:'town-library',       area:'town',      x:86,  y:56, accepts:['library'],       label:"Scholars' Walk", size:'md' },
  { id:'town-workshop',      area:'town',      x:20,  y:92, accepts:['workshop'],      label:'Sawdust Yard',  size:'md' },
  { id:'town-smithy',        area:'town',      x:39,  y:92, accepts:['smithy'],        label:'Forge Lane',    size:'md' },
  { id:'town-market',        area:'town',      x:58,  y:92, accepts:['market'],        label:'Market Row',    size:'md' },
  { id:'town-jeweller',      area:'town',      x:77,  y:92, accepts:['jeweller'],      label:'Gem Corner',    size:'md' },
  // The Outskirts.
  { id:'out-watchtower',     area:'outskirts', x:10,  y:56, accepts:['watchtower'],    label:'The Palisade',  size:'md' },
  { id:'out-lumber',         area:'outskirts', x:28,  y:56, accepts:['lumber_camp'],   label:'The Woodlands', size:'md' },
  { id:'out-scout',          area:'outskirts', x:47,  y:56, accepts:['scout_post'],    label:'High Ground',   size:'md' },
  { id:'out-mine',           area:'outskirts', x:66,  y:56, accepts:['mine'],          label:'Hillside',      size:'md' },
  { id:'out-walls',          area:'outskirts', x:86,  y:56, accepts:['walls'],         label:'Town Gate',     size:'md' },
  { id:'out-forager',        area:'outskirts', x:19,  y:92, accepts:['forager_hut'],   label:'Forest Edge',   size:'md' },
  { id:'out-farm',           area:'outskirts', x:38,  y:92, accepts:['farm'],          label:'Open Fields',   size:'md' },
  { id:'out-fishing',        area:'outskirts', x:57,  y:92, accepts:['fishing_post'],  label:'Riverside',     size:'md' },
  { id:'out-smelter',        area:'outskirts', x:76,  y:92, accepts:['smelter'],       label:'Furnace Row',   size:'md' },
];

// ── Building visual config ────────────────────────────────────────────────────
// Colours and glyph for the placeholder hut; the image (when there is one)
// comes from assets/images/buildings/manifest.json (js/home-scene.js).
const SV_VISUALS = {
  tavern:        { emoji:'\u{1F37A}', bodyColor:'#7a4225', roofColor:'#5c3018', flavor:'Warmth and ale for all who wander.' },
  market:        { emoji:'⚖️',        bodyColor:'#b8860b', roofColor:'#8b6010', flavor:'Where fortunes are made and spent.' },
  granary:       { emoji:'\u{1F33E}', bodyColor:'#8b7536', roofColor:'#6b5a2a', flavor:'Surplus grain against lean seasons.' },
  starter_house: { emoji:'\u{1F3E1}', bodyColor:'#8b6048', roofColor:'#c87941', flavor:'Humble shelter, warm within.' },
  neighbourhood: { emoji:'🏘️',        bodyColor:'#7a5c40', roofColor:'#5a3820', flavor:'Manage homes, residents, and family life.' },
  farm:          { emoji:'\u{1F331}', bodyColor:'#5a8040', roofColor:'#3d6030', flavor:'Neat rows of cultivated earth.' },
  lumber_camp:   { emoji:'\u{1FA93}', bodyColor:'#6b4020', roofColor:'#4a2c10', flavor:'Axes ring through the morning pines.' },
  fishing_post:  { emoji:'\u{1F3A3}', bodyColor:'#3a6080', roofColor:'#284860', flavor:'A patient dock above the quiet water.' },
  forager_hut:   { emoji:'\u{1F344}', bodyColor:'#607850', roofColor:'#485a38', flavor:'Into the woodland, lantern in hand.' },
  guild_hall:    { emoji:'🏛️',        bodyColor:'#6a4c7d', roofColor:'#3b3f6b', flavor:'Banners hang over the long tables.' },
  smithy:        { emoji:'⚒️',        bodyColor:'#5a4a40', roofColor:'#3a2c24', flavor:'Sparks, soot and the ring of the hammer.' },
  jeweller:      { emoji:'💍',        bodyColor:'#5c5070', roofColor:'#3c3450', flavor:'Every stone weighed twice.' },
  workshop:      { emoji:'🪚',        bodyColor:'#7a5a36', roofColor:'#54391f', flavor:'Shavings curl from the plane like ribbons.' },
  mine:          { emoji:'⛏️',        bodyColor:'#5b5248', roofColor:'#3a342e', flavor:'Lamps flicker deep in the hill.' },
  smelter:       { emoji:'🔥',        bodyColor:'#6a3a24', roofColor:'#3e2214', flavor:'The furnace roars; the air shimmers.' },
  library:       { emoji:'📚',        bodyColor:'#4f4a6a', roofColor:'#2f2b48', flavor:'Candles, ink and the scratch of quills.' },
  walls:         { emoji:'🧱',        bodyColor:'#6b6256', roofColor:'#4a433a', flavor:'Stakes, then stone, then more stone.' },
  watchtower:    { emoji:'🗼',        bodyColor:'#5e5040', roofColor:'#3c3226', flavor:'A lantern burns at the top all night.' },
  scout_post:    { emoji:'\u{1F5FA}️', bodyColor:'#5a5040', roofColor:'#3a3428', flavor:"The settlement's watchful eye." },
};

// The Watchtower's watch: who is posted, the cheer and the defence they give
// (server: settlement.town.watch, lib/watchtower).
function _svWatchHtml() {
  var w = gameData && gameData.settlement && gameData.settlement.town && gameData.settlement.town.watch;
  if (!w) return '';
  var line = !w.level ? '' : w.posted
    ? '🛡️ ' + w.posted + ' of ' + w.slots + ' posts manned · +' + Math.min(5, w.posted) + ' happiness · defence ' + w.defence
    : '🛡️ No one on watch — Guards and Archers at home take the posts (' + w.slots + ').';
  var d = gameData.settlement.defence;
  if (d) line += (line ? '<br>' : '') + '🧱 Town defence ' + d.own + ' — walls ' + d.walls + ', watch ' + d.watch + '.' + (d.own ? '' : ' <b style="color:#ff6a4a">Undefended</b>');
  var raid = gameData.settlement.raid;
  if (raid && !raid.resolved_at) line += '<br>🔥 Raiders from ' + raid.from + ' are on their way to ' + raid.target + ' (strength about ' + raid.strength_min + '–' + raid.strength_max + ').';
  return '<div class="sv-bp-watch">' + line + ' <button type="button" class="kw-help-q" aria-label="How this works" title="How this works" onclick="KWHelp.open(\'raids\')">?</button></div>';
}

// A building can be started when its building requirements and its minimum
// settlement tier are both met. tierMet is absent on older servers → met.
function _svCanBuild(b) { return !!b && b.requiresMet && b.tierMet !== false && b.researchMet !== false; }
// Why a building can't be started yet (research, tier, other buildings).
function _svLockReason(b) {
  if (b.researchMet === false) return 'Study ' + (b.researchLabel || 'it') + ' at a Library first.';
  if (b.tierMet === false && b.minTier) return 'Requires a ' + _svTierLabel(b.minTier) + ' settlement.';
  return 'Requires other buildings first.';
}
function _svTierLabel(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }

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
const _SV_SIZE_KEY     = 'sv_slot_sizes_v2';
const _SV_SIZE_DEFAULT = 110;   // an empty plot's ring
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
const _SV_POS_KEY = 'sv_slot_positions_v2';   // the painted scene's ('sv_slot_positions') no longer fit
function _svGetPositions() {
  try { return JSON.parse(localStorage.getItem(_SV_POS_KEY) || '{}'); } catch(e) { return {}; }
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
  if (!_svDragSlot) { _svTabOrder(); if (window.KWCast && KWCast.resurvey) KWCast.resurvey(); }   // paths follow the buildings
}

// Tab order follows the buildings left to right (§2.5): the slots are put
// in that order inside each area's layer (a villager's place among them
// doesn't matter: depth comes from z-index).
function _svTabOrder() {
  ['sv-layer-fg-town', 'sv-layer-fg-outskirts'].forEach(function(id) {
    var layer = document.getElementById(id);
    if (!layer) return;
    var slots = Array.prototype.slice.call(layer.querySelectorAll(':scope > .sv-slot'));
    var x = function(el) { return parseFloat(el.style.left) || 0; };
    var sorted = slots.slice().sort(function(a, b) { return x(a) - x(b); });
    if (sorted.every(function(el, i) { return el === slots[i]; })) return;
    sorted.forEach(function(el) { layer.appendChild(el); });
    // Villagers (and their menu) come after the buildings in the Tab order.
    layer.querySelectorAll(':scope > .kwv-villager, :scope > .kwv-radial').forEach(function(el) { layer.appendChild(el); });
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let _svOpen         = false;
let _svBuildings    = [];
let _svSelectedSlot = null;
let _svActiveArea   = 'town';
let _svRafId   = null;
let _svCommBarHandler = null;
let _svStylesInjected = false;
let _svDOMBuilt       = false;
let _svBuildMode       = false;
let _svDragSlot       = null;
let _svDragValid      = true;
let _svDragOrigPos    = null;
let _svDragOffset     = { x: 0, y: 0 };
let _svDragMoveHandler      = null;
let _svDragEndHandler       = null;
let _svDragTouchMoveHandler = null;
let _svDragTouchEndHandler  = null;

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
/* (The painted scene's .sv-env-layer and .sv-layer-img went with it: the
   backdrop is css/home-scene.css's .sv-bd strips now.) */

.sv-fg-layer { transition: opacity 0.45s ease; }
.sv-area-hidden { opacity: 0 !important; pointer-events: none !important; }
/* Slots opt back in with pointer-events:auto, so the hidden area's slots must be
   switched off explicitly or they steal clicks from visible slots beneath them. */
.sv-area-hidden * { pointer-events: none !important; }

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
.sv-slot-hint { font-size: 11px; color: #ffe99a; background: rgba(0,0,0,0.5); padding: 2px 7px; border-radius: 4px; white-space: nowrap; letter-spacing: 0.04em; transition: color 0.25s, background 0.25s; font-weight: 700; text-align: center; margin-top: 5px; }
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
.sv-building-name { font-size: 12px; font-weight: 700; color: #ffe99a; background: rgba(0,0,0,0.55); padding: 2px 8px; border-radius: 5px; white-space: nowrap; margin-top: 5px; letter-spacing: 0.04em; text-align: center; }
.sv-building-name-img { margin-top: -4px; }
.sv-building-lv { font-size: 10px; color: rgba(220,190,120,0.85); background: rgba(0,0,0,0.52); border-radius: 8px; padding: 1px 6px; margin-top: 3px; letter-spacing: 0.06em; }

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

.sv-edit-reset-btn {
  font-size: 11px; background: rgba(80,30,20,0.38); border: 1px solid rgba(200,80,60,0.35);
  color: rgba(220,110,90,0.82); padding: 4px 11px; border-radius: 16px;
  cursor: pointer; font-family: inherit; transition: all 0.2s;
}
.sv-edit-reset-btn:hover { background: rgba(120,40,30,0.48); color: #e87060; }
/* Build mode: buildings show a grab cursor (css/home-scene.css). */
.sv-slot.sv-dragging { cursor: grabbing !important; z-index: 1020 !important; transition: none !important; }
.sv-slot.sv-dragging .sv-building,
.sv-slot.sv-dragging .sv-slot-empty { filter: drop-shadow(0 8px 28px rgba(100,180,255,0.55)) brightness(1.18); }
.sv-slot.sv-drag-bad .sv-building,
.sv-slot.sv-drag-bad .sv-slot-empty { filter: drop-shadow(0 8px 24px rgba(255,80,60,0.7)) brightness(0.95); }

/* Neighbourhood slot — always rendered as a building, never empty-ring */
.sv-neighbourhood-building .sv-building-struct { border: 2px solid rgba(255,200,100,0.25); }
.sv-neighbourhood-building:hover { transform: translateY(-5px) scale(1.06); filter: brightness(1.1); }

/* Housing modal — slides up from bottom like the build panel */
.sv-housing-modal {
  position: absolute; bottom: 0; left: 50%;
  transform: translateX(-50%) translateY(110%);
  width: min(560px, 98vw);
  max-height: 72vh;
  background: linear-gradient(160deg, #2a1e14 0%, #1e1510 100%);
  border: 1px solid rgba(180,140,80,0.45); border-bottom: none;
  border-radius: 14px 14px 0 0; z-index: 20;
  transition: transform 0.38s cubic-bezier(0.34,1.48,0.64,1);
  box-shadow: 0 -10px 40px rgba(0,0,0,0.55);
  display: flex; flex-direction: column; overflow: hidden;
}
.sv-housing-modal.open { transform: translateX(-50%) translateY(0); }
.sv-hm-header {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 20px 12px; border-bottom: 1px solid rgba(180,140,80,0.15);
  flex-shrink: 0;
}
.sv-hm-title { font-size: 16px; font-weight: 700; color: #e8d090; }
.sv-hm-tooltip { font-size: 11px; color: rgba(200,180,130,0.5); font-style: italic; margin-top: 2px; }
.sv-hm-summary {
  font-size: 11px; color: rgba(200,175,130,0.6);
  padding: 8px 20px 2px; flex-shrink: 0;
}
.sv-hm-body { overflow-y: auto; flex: 1; padding: 6px 20px 10px; }
.sv-hm-footer { padding: 10px 20px 18px; flex-shrink: 0; border-top: 1px solid rgba(180,140,80,0.1); }
.sv-hm-section-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
  color: rgba(200,180,120,0.4); margin: 8px 0 5px; font-weight: 700;
}
.sv-hm-empty {
  color: rgba(200,180,120,0.4); font-size: 13px; text-align: center;
  padding: 24px 0; line-height: 1.7;
}
.sv-hm-house {
  background: rgba(255,220,150,0.04); border: 1px solid rgba(180,140,80,0.16);
  border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
}
.sv-hm-house-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.sv-hm-house-name { font-size: 13px; font-weight: 700; color: #e0c878; flex: 1; }
.sv-hm-house-cap { font-size: 11px; color: rgba(200,175,120,0.5); white-space: nowrap; }
.sv-hm-demolish-btn {
  background: rgba(160,40,30,0.12); border: 1px solid rgba(200,60,50,0.28);
  border-radius: 5px; color: rgba(210,90,70,0.7); font-size: 10px;
  cursor: pointer; padding: 2px 8px; font-family: inherit; transition: all 0.2s;
}
.sv-hm-demolish-btn:hover { background: rgba(180,50,40,0.25); color: #e86050; border-color: rgba(220,80,60,0.5); }
.sv-hm-resident {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 4px; font-size: 12px; color: rgba(220,200,160,0.85);
  border-bottom: 1px solid rgba(180,140,80,0.07);
}
.sv-hm-resident:last-of-type { border-bottom: none; }
.sv-hm-resident-name { flex: 1; }
.sv-hm-resident-role { font-size: 10px; color: rgba(180,155,110,0.5); text-transform: capitalize; }
.sv-hm-unassign-btn {
  background: none; border: 1px solid rgba(180,140,80,0.2); border-radius: 4px;
  color: rgba(200,170,110,0.4); font-size: 10px; cursor: pointer;
  padding: 1px 6px; font-family: inherit; transition: all 0.2s;
}
.sv-hm-unassign-btn:hover { border-color: rgba(200,80,60,0.45); color: rgba(220,100,80,0.8); }
.sv-hm-assign-row { display: flex; gap: 6px; margin-top: 8px; }
.sv-hm-assign-sel {
  flex: 1; background: rgba(0,0,0,0.35); border: 1px solid rgba(180,140,80,0.22);
  border-radius: 5px; color: rgba(200,180,140,0.8); padding: 4px 8px;
  font-size: 11px; font-family: inherit;
}
.sv-hm-assign-btn {
  background: rgba(80,130,55,0.18); border: 1px solid rgba(100,160,70,0.32);
  border-radius: 5px; color: rgba(130,195,90,0.85); font-size: 11px;
  cursor: pointer; padding: 4px 12px; font-family: inherit; white-space: nowrap; transition: all 0.2s;
}
.sv-hm-assign-btn:hover { background: rgba(100,150,65,0.28); color: #90d068; }
.sv-hm-slot-empty {
  font-size: 11px; color: rgba(200,175,120,0.32); padding: 4px 4px;
  font-style: italic;
}
.sv-hm-unhoused-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.sv-hm-unhoused-chip {
  background: rgba(255,210,90,0.05); border: 1px solid rgba(200,175,100,0.15);
  border-radius: 10px; padding: 2px 10px; font-size: 11px; color: rgba(210,185,125,0.6);
}
.sv-hm-build-btn {
  width: 100%; padding: 10px; background: rgba(120,80,28,0.2);
  border: 1px solid rgba(200,148,58,0.4); border-radius: 8px;
  color: #f0d070; font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit; transition: all 0.2s; letter-spacing: 0.04em;
}
.sv-hm-build-btn:hover { background: rgba(150,100,38,0.3); border-color: rgba(240,188,88,0.6); }
  `;
  document.head.appendChild(s);
}

// ── DOM bootstrap ─────────────────────────────────────────────────────────────
// (SVG fallbacks removed — env layers are image-only; the .sv-scene CSS gradient
//  is the permanent sky fallback when sky.png is absent.)

// ── DOM bootstrap ─────────────────────────────────────────────────────────────
// The far strips and the meadow, inside the panning world. The sky is the
// scene's own background (css/home-scene.css, by time of day).
function _buildBackdrop() {
  var world = document.getElementById('sv-world');
  if (!world) return;
  world.querySelectorAll('.sv-bd').forEach(function(el) { el.remove(); });
  var html = '';
  html += '<div class="sv-bd sv-bd-sky"></div>';   // the sky, under the night overlay (css/home-scene.css)
  ['mountains', 'trees', 'ground'].forEach(function(k) {
    var d = SV_BACKDROP[k];
    html += '<div class="sv-bd sv-bd-' + k + '" data-pan="' + (d.pan || 1) + '" style="--bd-img:url(\'' + d.file + '\');--bd-w:' + d.w + 'px;--bd-h:' + d.h + 'px"></div>';
  });
  world.insertAdjacentHTML('afterbegin', html);
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
  // Props: the village green, the wonder site and the signposts (§2.2).
  var PROPS = window.KWHome ? KWHome.PROPS : [];
  function propHTML(p) {
    return '<div class="sv-slot sv-prop-slot" id="sv-prop-' + p.id + '" style="left:' + p.x + '%;top:' + p.y + '%" data-prop="' + p.id + '"></div>';
  }
  townSlots = townSlots.concat(PROPS.filter(function(p) { return p.area === 'town'; }).map(function(p) { return { prop: p }; }));
  outSlots  = outSlots.concat(PROPS.filter(function(p) { return p.area === 'outskirts'; }).map(function(p) { return { prop: p }; }));
  var anyHTML = function(sl) { return sl.prop ? propHTML(sl.prop) : slotHTML(sl); };

  // The scene is the window; the world inside it is SV_WORLD_W wide and pans
  // sideways (§4.4). Both areas' layers live in the world, one shown at a time.
  root.innerHTML =
    '<div class="sv-scene" id="sv-scene">'
    + '<div class="sv-world" id="sv-world" style="width:' + SV_WORLD_W + 'px">'
    + '<div class="sv-layer sv-fg-layer" id="sv-layer-fg-town">'
    + townSlots.map(anyHTML).join('') + '</div>'
    + '<div class="sv-layer sv-fg-layer sv-area-hidden" id="sv-layer-fg-outskirts">'
    + outSlots.map(anyHTML).join('') + '</div>'
    // Evening and night: one multiply over the world, the lit windows' glow above it (css/home-scene.css).
    + '<div class="sv-night" aria-hidden="true"></div><div class="sv-glow" id="sv-glow" aria-hidden="true"></div>'
    + '</div></div>'
    + '<div class="sv-header">'
    // Back button: on desktop this view is dismissed by clicking the community
    // bar, which the mobile shell hides — leaving no way out. Hidden on desktop
    // by CSS so that layout is unchanged there.
    + '<button class="sv-back-btn" id="sv-back-btn" onclick="closeSettlementView()">&#8592; The Land</button>'
    + '<span class="sv-header-title" id="sv-title">Settlement</span>'
    // Town ↔ Outskirts: signposts in the scene (js/home-scene.js PROPS).
    // Build mode (the Build chip, top left) replaces Edit (§2.3). An old
    // hand-made layout can still be put back from here while building.
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<button class="sv-edit-reset-btn" id="sv-edit-reset-btn" style="display:none" onclick="_svResetLayout()">&#8635; Reset layout</button>'
    + '</div></div>'
    + '<div class="sv-build-panel" id="sv-build-panel"></div>'
    + '<div class="sv-housing-modal" id="sv-housing-modal"></div>';

  _buildBackdrop();
  _applySlotPositions();
  _svBindPan();

  document.getElementById('sv-scene').addEventListener('click', function(e) {
    if (_svPanned) return;   // the end of a pan is no click
    if (!e.target.closest('.sv-slot') && !e.target.closest('.sv-build-panel') && !e.target.closest('.sv-housing-modal') && !e.target.closest('.kwv-test-panel')) {
      _closeBuildPanel();
      _closeHousingModal();
    }
  });
}

// ── Open / close ──────────────────────────────────────────────────────────────
function _svRecalcTop() {
  var root    = document.getElementById('settlement-view');
  var topbar  = document.querySelector('.topbar');
  // The row under the top bar: the five places (js/places.js; on phones it
  // has no height, its parts are fixed to the bottom), or the old bar.
  var row     = document.querySelector('.kwp-row') || document.querySelector('.community-bar');
  if (root) root.style.top = ((topbar ? topbar.offsetHeight : 0) + (row ? row.offsetHeight : 0)) + 'px';
}

async function openSettlementView() {
  _ensureSvDOM();
  _svOpen = true;
  window.dispatchEvent(new CustomEvent('kw:home', { detail: { open: true } }));   // the map's loops pause under Home
  _svSelectedSlot = null;

  var root = document.getElementById('settlement-view');
  _svRecalcTop();
  root.style.display = 'flex';
  root.offsetHeight;
  root.classList.add('sv-visible');

  var titleEl = document.getElementById('sv-title');
  if (titleEl && window.gameData && window.gameData.settlement && window.gameData.settlement.name) {
    titleEl.textContent = gameData.settlement.name;
  }

  _svFit();
  _svSwitchArea(_svActiveArea, true);
  if (window.KWHome) KWHome.homeShown();   // nameplates: Show names, the 4-second peek on touch
  if (window.KWPlaces) KWPlaces.seen('home');   // the scene is Home (js/places.js)

  var commBar = document.querySelector('.community-bar');
  if (commBar && !_svCommBarHandler) {
    _svCommBarHandler = function(e) {
      if (e.target.closest('.comm-btn')) closeSettlementView();
    };
    commBar.addEventListener('click', _svCommBarHandler);
  }

  await _svLoad();
  // A town with nothing built yet starts with the plots showing (§2.3).
  if (!_svBuildMode && _svNothingBuilt()) _svToggleBuildMode(true);
}
window.openSettlementView = openSettlementView;

function _svNothingBuilt() {
  return !_svBuildings.some(function(b) { return b.currentLevel > 0 && b.id !== 'starter_house' && b.id !== 'housing'; });
}

// Opens the settlement view in Build mode on the plot for `buildingId` with
// its build panel showing — the Market's "Build a Market" link and First
// steps' "Show me" use this. The plot is the one
// the building already sits in, else its default slot if free, else any free
// slot in that area.
async function openSettlementBuild(buildingId) {
  await openSettlementView();
  _svToggleBuildMode(true);   // the plots show (§2.3); before the panel opens: the toggle closes panels
  var assign = _svGetAssignments();
  var home = SV_SLOTS.find(function(s) { return (s.accepts || []).includes(buildingId); });
  var slot = SV_SLOTS.find(function(s) { return assign[s.id] === buildingId; })
    || (home && !assign[home.id] ? home : null)
    || SV_SLOTS.find(function(s) { return s.area === (home ? home.area : 'town') && !s.type && !assign[s.id]; });
  if (!slot) return;
  if (slot.area !== _svActiveArea) _svSwitchArea(slot.area);
  var b = _svBuildings.find(function(x) { return x.id === buildingId; });
  _openBuildPanel(slot, b && b.currentLevel > 0 ? b : null);
}
window.openSettlementBuild = openSettlementBuild;

function closeSettlementView() {
  if (_svBuildMode) _svToggleBuildMode(false);
  _svOpen = false;
  window.dispatchEvent(new CustomEvent('kw:home', { detail: { open: false } }));
  if (window.KWVillagers) KWVillagers.sceneHidden();
  if (window.KWPlaces) KWPlaces.seen('land');   // back to the map: The Land
  _closeBuildPanel();
  _closeHousingModal();

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
function _svSwitchArea(area, force, where) {
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
  // The hidden area's buttons are out of the Tab order too.
  if (tl) tl.inert = area !== 'town';
  if (ol) ol.inert = area === 'town';
  _svPanArea(area, where);
  document.querySelectorAll('.sv-area-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.area === area);
  });
  // Villagers walk in whichever area is showing (js/villagers.js).
  if (_svOpen && window.KWVillagers) KWVillagers.sceneShown(area === 'town' ? tl : ol);
}
window._svSwitchArea = _svSwitchArea;

// ── Data loading ──────────────────────────────────────────────────────────────
async function _svLoad() {
  _svRecalcTop(); // re-anchor in case topbar/commbar height changed
  try {
    var mf  = window.KWHome ? KWHome.loadManifest() : null;   // art sizes and doors (§2.6)
    var res = await apiFetch('/api/buildings');
    if (!res.ok) return;
    var data = await res.json();
    _svBuildings = data.buildings || [];
    if (mf) await mf;
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

    if (slot.type === 'neighbourhood') {
      var housingB   = _svBuildings.find(function(b) { return b.id === 'starter_house'; });
      var houseCount = housingB ? housingB.currentLevel : 0;
      el.appendChild(_buildNeighbourhoodEl(slot, houseCount));
      el.hidden = false;
      // In Build mode the Neighbourhood is where huts are built: its window.
      el.onclick = function() { if (_svBuildMode) _openHousingModal(); else _svOpenBuilding('neighbourhood'); };
    } else {
      var occupant = _occupantFor(slot);
      if (occupant) {
        el.appendChild(_buildOccupiedEl(slot, occupant));
        // A click opens the building's screen (js/home-scene.js ROUTES), or
        // its panel when it has none.
        el.hidden = false;
        // Normally a click opens the building's screen (js/home-scene.js
        // ROUTES), or its panel when it has none; in Build mode, always the
        // manage panel (upgrade, demolish). A drag that just ended is no click.
        (function(s, o) { el.onclick = function() {
          if (_svJustDragged) return;
          if (_svBuildMode) _openBuildPanel(s, o);
          else _svOpenBuilding(o.id, function() { _openBuildPanel(s, o); });
        }; })(slot, occupant);
      } else {
        var areaBuildings = _svSlotBuildingIds();
        var taken = Object.values(_svGetAssignments());
        var unbuildable = areaBuildings.filter(function(id) { return !taken.includes(id); });
        var anyAvail = unbuildable.some(function(id) {
          var b = _svBuildings.find(function(b) { return b.id === id; });
          return b && b.currentLevel === 0 && _svCanBuild(b);
        });
        var allLocked = unbuildable.length === 0 || unbuildable.every(function(id) {
          var b = _svBuildings.find(function(b) { return b.id === id; });
          return !b || !_svCanBuild(b);
        });
        el.appendChild(_buildEmptyEl(slot, anyAvail, allLocked));
        // Empty plots are hidden outside Build mode (§2.3).
        el.hidden = !_svBuildMode;
        if (_svBuildMode && anyAvail) (function(s) { el.onclick = function() { _openBuildPanel(s, null); }; })(slot);
      }
    }

  }
  _renderProps();
  _applySlotPositions();
}

// Opens what a building opens (js/home-scene.js), closing the panels first.
function _svOpenBuilding(id, panel) {
  _closeBuildPanel();
  _closeHousingModal();
  if (window.KWHome) return KWHome.open(id, panel);
  if (panel) panel();
}

// The props (§2.2): shown or hidden by what the town has.
function _renderProps() {
  if (!window.KWHome) return;
  var shown = KWHome.props().map(function(p) { return p.id; });
  KWHome.PROPS.forEach(function(p) {
    var el = document.getElementById('sv-prop-' + p.id);
    if (!el) return;
    el.innerHTML = '';
    el.onclick = null;
    el.hidden = shown.indexOf(p.id) < 0 || (_svBuildMode && p.kind !== 'signpost');
    if (el.hidden) return;
    var size = p.kind === 'signpost' ? 110 : 170;   // beside the new buildings (docs/ART_GUIDE.md)
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sv-building kwh-btn kwh-prop kwh-prop-' + p.kind;
    btn.setAttribute('data-kwh', p.id);
    btn.setAttribute('aria-label', KWHome.label(p.label, p.opens));
    btn.innerHTML = '<span class="kwh-bubble-host">' + KWHome.bubbleHtml(p.id) + '</span>'
      + KWHome.propSvg(p.kind, size, p.flip)
      + (p.kind === 'signpost' ? '<span class="kwh-sign-text" aria-hidden="true">' + _svEsc(p.label) + '</span>' : '')
      + KWHome.plateHtml(p.label, p.opens);
    el.appendChild(btn);
    el.onclick = function() { KWHome.openProp(p.id); };
  });
}

function _occupantFor(slot) {
  var assignments = _svGetAssignments();
  var bid = assignments[slot.id];
  if (bid) {
    var b = _svBuildings.find(function(b) { return b.id === bid && b.currentLevel > 0; });
    if (b) return b;
    _svClearAssignment(bid); // stale — building was demolished elsewhere
  } else if (slot.accepts && slot.accepts.length === 1) {
    var own = slot.accepts[0];
    var placed = Object.values(assignments).indexOf(own) !== -1;
    var built = _svBuildings.find(function(b) { return b.id === own && b.currentLevel > 0; });
    if (built && !placed) { _svSetAssignment(slot.id, own); return built; }
  }
  return null;
}

function _buildEmptyEl(slot, available, locked) {
  var size = _svGetSlotSize(slot.id);
  var div = document.createElement('button');
  div.type = 'button';
  div.className = 'sv-slot-empty kwh-btn' + (locked ? ' locked' : '');
  div.setAttribute('aria-label', locked ? slot.label + ': locked' : slot.label + ': build here');
  if (!available) { div.style.cursor = 'default'; div.setAttribute('aria-disabled', 'true'); }
  var plusSz = Math.round(size * 0.33);
  div.innerHTML = '<span class="sv-slot-ring" style="width:' + size + 'px;height:' + size + 'px">'
    + '<span class="sv-slot-plus" style="font-size:' + plusSz + 'px">' + (locked ? '🔒' : '+') + '</span>'
    + '</span>'
    + '<span class="sv-slot-hint">' + (locked ? '🔒 Locked' : 'Build here') + '</span>';
  return div;
}

// A built building is a button (§2.5): its art (js/home-scene.js: the
// manifest's image or the placeholder hut), a bubble when something is
// waiting there, and a nameplate shown on hover, focus or "Show names".
function _svBuildingButton(key, name, vis, size, extra) {
  var H = window.KWHome;
  var r = H ? H.route(key) : { opens: 'Open' };
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sv-building kwh-btn';
  btn.setAttribute('data-kwh', key);
  btn.setAttribute('aria-label', H ? H.label(name, r.opens) + (extra ? ' (' + extra + ')' : '') : name);
  var a = H ? H.artHtml(key, vis, size) : { html: '<span class="sv-building-emoji">' + vis.emoji + '</span>' };
  if (a.native) btn.classList.add('kwh-native-art');
  btn.innerHTML = '<span class="kwh-bubble-host">' + (H ? H.bubbleHtml(key) : '') + '</span>'
    + a.html
    + (H ? H.plateHtml(name, r.opens, extra) : '<span class="sv-building-name">' + _svEsc(name) + '</span>');
  return btn;
}

function _buildOccupiedEl(slot, building) {
  var vis = SV_VISUALS[building.id] || { emoji:'🏛', bodyColor:'#555', roofColor:'#333' };
  return _svBuildingButton(building.id, building.label, vis, _svGetSlotSize(slot.id),
    building.currentLevel > 1 ? 'Lv ' + building.currentLevel : '');
}

function _buildNeighbourhoodEl(slot, houseCount) {
  var vis = SV_VISUALS.neighbourhood || { emoji:'🏘️', bodyColor:'#7a5c40', roofColor:'#5a3820' };
  var sub = houseCount > 0 ? houseCount + ' home' + (houseCount !== 1 ? 's' : '') : 'No homes yet';
  var btn = _svBuildingButton('neighbourhood', 'Neighbourhood', vis, _svGetSlotSize(slot.id), sub);
  btn.classList.add('sv-neighbourhood-building');
  // A home with nobody in it stays dark at night (HOME_SCENE.md C.5): with no
  // huts yet, the cluster's windows stay unlit.
  if (!houseCount) btn.classList.add('kwh-dark');
  return btn;
}

// ── Housing modal ─────────────────────────────────────────────────────────────
function _svEsc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function _openHousingModal() {
  _closeBuildPanel();
  var modal = document.getElementById('sv-housing-modal');
  if (!modal) return;
  modal.innerHTML = '<div class="sv-hm-header"><span class="sv-hm-title">🏘️ Neighbourhood</span>'
    + '<button class="sv-bp-close" onclick="_closeHousingModal()">\xD7</button></div>'
    + '<div class="sv-hm-body"><div class="sv-hm-empty">Loading…</div></div>';
  modal.classList.add('open');

  try {
    var res = await apiFetch('/api/housing');
    if (!res.ok) { _renderHousingModal(null); return; }
    var data = await res.json();
    _renderHousingModal(data);
  } catch(e) {
    _renderHousingModal(null);
  }
}
window._openHousingModal = _openHousingModal;

function _closeHousingModal() {
  var modal = document.getElementById('sv-housing-modal');
  if (modal) modal.classList.remove('open');
}
window._closeHousingModal = _closeHousingModal;

function _renderHousingModal(data) {
  var modal = document.getElementById('sv-housing-modal');
  if (!modal) return;

  if (!data) {
    modal.innerHTML = '<div class="sv-hm-header"><span class="sv-hm-title">🏘️ Neighbourhood</span>'
      + '<button class="sv-bp-close" onclick="_closeHousingModal()">\xD7</button></div>'
      + '<div class="sv-hm-body"><div class="sv-hm-empty">Failed to load housing data.</div></div>';
    return;
  }

  var houses   = data.houses   || [];
  var unhoused = data.unhoused || [];
  var housingB = _svBuildings.find(function(b) { return b.id === 'starter_house'; });
  var totalResidents = houses.reduce(function(sum, h) { return sum + h.residents.length; }, 0);
  var totalCapacity  = houses.reduce(function(sum, h) { return sum + h.capacity;         }, 0);

  var costStr = '';
  if (housingB && housingB.cost) {
    costStr = Object.entries(housingB.cost)
      .filter(function(e) { return e[1] > 0; })
      .map(function(e) { return _svResIcon(e[0]) + ' ' + e[1]; })
      .join('  ');
  }

  var html = '<div class="sv-hm-header">'
    + '<span class="sv-hm-title">🏘️ Neighbourhood</span>'
    + '<button class="sv-bp-close" onclick="_closeHousingModal()">\xD7</button>'
    + '</div>';

  if (houses.length > 0) {
    html += '<div class="sv-hm-summary">'
      + houses.length + ' home' + (houses.length !== 1 ? 's' : '')
      + ' &nbsp;·&nbsp; ' + totalResidents + ' of ' + totalCapacity + ' spaces filled'
      + '</div>';
  } else {
    html += '<div class="sv-hm-summary" style="font-style:italic">Manage homes, residents, and family life.</div>';
  }

  html += '<div class="sv-hm-body">';

  if (houses.length === 0) {
    html += '<div class="sv-hm-empty">No homes built yet.<br>'
      + '<span style="font-size:11px;opacity:0.6">Build housing to shelter and house your citizens.</span></div>';
  } else {
    html += '<div class="sv-hm-section-label">Homes</div>';
    for (var i = 0; i < houses.length; i++) {
      var house = houses[i];
      html += '<div class="sv-hm-house" data-house="' + house.id + '">'
        + '<div class="sv-hm-house-header">'
        + '<span class="sv-hm-house-name">🏡 ' + _svEsc(house.name) + '</span>'
        + '<span class="sv-hm-house-cap">' + house.residents.length + ' / ' + house.capacity + '</span>'
        + '<button class="sv-hm-demolish-btn" onclick="_svDemolishHouse()">🔨 Demolish</button>'
        + '</div>';

      for (var j = 0; j < house.residents.length; j++) {
        var r = house.residents[j];
        html += '<div class="sv-hm-resident">'
          + '<span class="sv-hm-resident-name">' + _svEsc(r.name) + '</span>'
          + '<span class="sv-hm-resident-role">' + r.role + '</span>'
          + '<button class="sv-hm-unassign-btn" onclick="_svUnassignFromHouse(' + r.id + ')">Move out</button>'
          + '</div>';
      }

      var emptySlots = house.capacity - house.residents.length;
      if (emptySlots > 0) {
        if (unhoused.length > 0) {
          html += '<div class="sv-hm-assign-row">'
            + '<select class="sv-hm-assign-sel" id="sv-hm-assign-' + house.id + '">'
            + '<option value="">— Assign a citizen —</option>'
            + unhoused.map(function(c) {
                return '<option value="' + c.id + '">' + _svEsc(c.name) + ' (' + c.role + ')</option>';
              }).join('')
            + '</select>'
            + '<button class="sv-hm-assign-btn" onclick="_svAssignToHouse(' + house.id + ')">Move in</button>'
            + '</div>';
        } else {
          html += '<div class="sv-hm-slot-empty">'
            + emptySlots + ' space' + (emptySlots !== 1 ? 's' : '') + ' available — no unhoused citizens.'
            + '</div>';
        }
      }

      html += '</div>'; // .sv-hm-house
    }
  }

  // Show unhoused list when there are no houses to show assign dropdowns in
  if (unhoused.length > 0 && houses.length === 0) {
    html += '<div class="sv-hm-section-label">Unhoused citizens (' + unhoused.length + ')</div>'
      + '<div class="sv-hm-unhoused-list">'
      + unhoused.map(function(c) {
          return '<span class="sv-hm-unhoused-chip">' + _svEsc(c.name) + '</span>';
        }).join('')
      + '</div>';
  }

  html += '</div>'; // .sv-hm-body

  html += '<div class="sv-hm-footer">'
    + '<button class="sv-hm-build-btn" onclick="_svBuildHousing()">🏗 Build Housing'
    + (costStr ? ' &nbsp;—&nbsp; ' + costStr : '')
    + '</button></div>';

  modal.innerHTML = html;
}
window._renderHousingModal = _renderHousingModal;

async function _svBuildHousing() {
  if (typeof buildBuilding !== 'function') return;
  var housingB = _svBuildings.find(function(b) { return b.id === 'starter_house'; });
  var cost = housingB ? housingB.cost : null;
  await buildBuilding('starter_house');
  _svPlaySound('/assets/audio/construct.wav');
  if (typeof refreshResources === 'function') await refreshResources();
  if (cost && typeof _spawnFloater === 'function') {
    Object.entries(cost).forEach(function(e) { if (e[1]) _spawnFloater(e[0], -e[1]); });
  }
  await _svLoad();
  _openHousingModal();
}
window._svBuildHousing = _svBuildHousing;

async function _svDemolishHouse() {
  if (!await KWDialog.confirm({ title: 'Demolish a Willow Hut?', message: 'The most recently built home will be removed and its residents will be unhoused. You will receive 50% of build resources back.', ok: 'Demolish', danger: true })) return;
  try {
    var res = await apiFetch('/api/buildings/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: 'starter_house' }),
    });
    if (!res.ok) {
      var d = await res.json();
      KWDialog.alert(d.error || 'Demolition failed.');
      return;
    }
    var d = await res.json();
    if (typeof refreshResources === 'function') await refreshResources();
    if (d.refund && typeof _spawnFloater === 'function') {
      Object.entries(d.refund).forEach(function(e) { if (e[1]) _spawnFloater(e[0], e[1]); });
    }
    await _svLoad();
    _openHousingModal();
  } catch(e) {
    KWDialog.alert('Demolition failed.');
  }
}
window._svDemolishHouse = _svDemolishHouse;

async function _svAssignToHouse(houseId) {
  var sel = document.getElementById('sv-hm-assign-' + houseId);
  if (!sel || !sel.value) return;
  var citizenId = parseInt(sel.value);
  try {
    var res = await apiFetch('/api/housing/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: citizenId, house_id: houseId }),
    });
    if (!res.ok) {
      var d = await res.json();
      KWDialog.alert(d.error || 'Could not assign citizen.');
      return;
    }
    _openHousingModal();
  } catch(e) {
    KWDialog.alert('Assignment failed.');
  }
}
window._svAssignToHouse = _svAssignToHouse;

async function _svUnassignFromHouse(citizenId) {
  try {
    var res = await apiFetch('/api/housing/unassign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: citizenId }),
    });
    if (!res.ok) {
      var d = await res.json();
      KWDialog.alert(d.error || 'Could not move citizen out.');
      return;
    }
    _openHousingModal();
  } catch(e) {
    KWDialog.alert('Failed to move citizen out.');
  }
}
window._svUnassignFromHouse = _svUnassignFromHouse;

// ── Build panel ───────────────────────────────────────────────────────────────
function _openBuildPanel(slot, occupant) {
  _closeHousingModal();
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
      ? Object.entries(occupant.cost).map(function(e) { return _svResIcon(e[0]) + ' ' + e[1]; }).join('  ') + (typeof discountText === 'function' ? discountText(occupant) : '')
      : '';
    var refundStr = occupant.cost
      // Demolishing refunds half the base cost — never a level's ores or alloys.
      ? Object.entries(occupant.cost).filter(function(e){ return e[1] > 0 && ['food','timber','stone','metal','wealth'].indexOf(e[0]) >= 0; })
          .map(function(e) {
            var baseCost = Math.round(e[1] / (occupant.currentLevel + 1));
            return _svResIcon(e[0]) + ' ' + Math.floor(baseCost * 0.5);
          }).join('  ')
      : '';
    html += '<div class="sv-occ-head"><span class="sv-occ-emoji">' + vis.emoji + '</span>'
      + '<div><div class="sv-occ-name">' + occupant.label + '</div>'
      + '<div class="sv-occ-lv">Level ' + occupant.currentLevel + ' / ' + occupant.maxLevel + '</div></div>'
      + (isMax
        ? '<span class="sv-bp-lv-badge" style="margin-left:auto">★ MAX</span>'
        : occupant.nextLevelTierMet === false
        ? '<span class="sv-bp-lv-badge" style="margin-left:auto">🔒 Lv ' + (occupant.currentLevel + 1) + ' needs a ' + _svTierLabel(occupant.nextLevelTier) + '</span>'
        : '<button class="sv-bp-upgrade-btn" style="margin-left:auto" onclick="_svBuild(\'' + occupant.id + '\')">↑ Upgrade' + (costStr ? ' — ' + costStr : '') + '</button>')
      + '</div><div class="sv-occ-desc">' + (occupant.desc || '') + '</div>'
      + '<div class="sv-occ-flavor">' + (vis.flavor || '') + '</div>'
      + (occupant.id === 'guild_hall' && typeof openClanPanel === 'function'
        ? '<button class="sv-bp-upgrade-btn" onclick="_closeBuildPanel();openClanPanel()">🛡️ Open Clan</button>'
        : '')
      + (occupant.id === 'market' && typeof openMarket === 'function'
        ? '<button class="sv-bp-upgrade-btn" onclick="_closeBuildPanel();closeSettlementView();openMarket()">⚖️ Open Market</button>'
        : '')
      + (['smithy', 'jeweller', 'workshop', 'smelter'].includes(occupant.id) && typeof openCrafting === 'function'
        ? '<button class="sv-bp-upgrade-btn" onclick="_closeBuildPanel();openCrafting(\'' + occupant.id + '\')">🔨 Open the workshop</button>'
        : '')
      + (occupant.id === 'watchtower' || occupant.id === 'walls' ? _svWatchHtml() : '')
      + (occupant.id === 'library' && typeof openLibrary === 'function'
        ? '<button class="sv-bp-upgrade-btn" onclick="_closeBuildPanel();openLibrary()">📚 Open the Library</button>'
        : '')
      + (['smithy', 'jeweller', 'fishing_post'].includes(occupant.id) && typeof openMarket === 'function'
        ? '<button class="sv-bp-upgrade-btn" onclick="_closeBuildPanel();closeSettlementView();openMarket({tab:\'shops\'})">🏪 Run the shop</button>'
        : '')
      + _svMoveHtml(slot)
      + '<button class="sv-bp-demolish-btn" onclick="_svDemolish(\'' + occupant.id + '\')">🔨 Demolish' + (refundStr ? ' — refunds ' + refundStr : '') + '</button>';
  } else {
    var areaIds = _svSlotBuildingIds();
    var taken = Object.values(_svGetAssignments()); // already placed in other slots
    var opts = areaIds.filter(function(id) { return !taken.includes(id); }).map(function(id) {
      var b   = _svBuildings.find(function(b) { return b.id === id; });
      if (!b) return '';
      var vis = SV_VISUALS[id] || { emoji:'🏛' };
      var costStr = b.cost
        ? Object.entries(b.cost).map(function(e) { return _svResIcon(e[0]) + ' ' + e[1]; }).join('  ') + (typeof discountText === 'function' ? discountText(b) : '')
        : 'Free';
      if (_svCanBuild(b) && b.currentLevel === 0) {
        return '<div class="sv-bp-opt available"><span class="sv-bp-emoji">' + vis.emoji + '</span>'
          + '<div class="sv-bp-info"><div class="sv-bp-name">' + b.label + '</div>'
          + '<div class="sv-bp-desc">' + (b.desc || '') + '</div>'
          + '<div class="sv-bp-cost">' + costStr + '</div></div>'
          + '<div class="sv-bp-action"><button class="sv-bp-build-btn" onclick="_svBuild(\'' + id + '\')">Build</button></div></div>';
      }
      if (!_svCanBuild(b) && b.currentLevel === 0) {
        var why = _svLockReason(b);
        return '<div class="sv-bp-opt locked"><span class="sv-bp-emoji">' + vis.emoji + '</span>'
          + '<div class="sv-bp-info"><div class="sv-bp-name">' + b.label + '</div>'
          + '<div class="sv-bp-desc">' + why + '</div></div>'
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

// Build mode: "Move to…" buttons for each other plot in the area, so a
// building can be moved without dragging (keyboard, switch access, or a
// fiddly touch screen). Onto a building, the two swap.
function _svMoveHtml(slot) {
  if (!_svBuildMode || !slot || slot.type) return '';
  var btns = SV_SLOTS.filter(function(s) { return s.area === slot.area && s.id !== slot.id && !s.type; }).map(function(s) {
    var o = _occupantFor(s);
    return '<button type="button" class="sv-bp-move-btn" onclick="_svMoveTo(\'' + slot.id + '\',\'' + s.id + '\')">' + _svEsc(s.label)
      + '<span>' + (o ? '↔ swap with the ' + _svEsc(o.label) : 'empty') + '</span></button>';
  }).join('');
  return btns ? '<div class="sv-bp-move" role="group" aria-label="Move to another plot"><div class="sv-bp-move-h">Move to…</div>' + btns + '</div>' : '';
}
function _svMoveTo(fromId, toId) {
  var occ = function(id) { var sl = SV_SLOTS.find(function(s) { return s.id === id; }); var b = sl && _occupantFor(sl); return b ? b.id : null; };
  var moving = occ(fromId);
  var next = _svMoveAssignment(_svGetAssignments(), fromId, toId, occ);
  localStorage.setItem(_SV_ASSIGN_KEY, JSON.stringify(next));
  _closeBuildPanel();
  _renderScene();
  // Keep the keyboard where the building went.
  var b = moving && document.querySelector('#sv-slot-' + toId + ' [data-kwh="' + moving + '"]');
  if (b) { try { b.focus({ preventScroll: false }); } catch (_) {} }
}
window._svMoveTo = _svMoveTo;

function _closeBuildPanel() {
  var p = document.getElementById('sv-build-panel');
  if (p) p.classList.remove('open');
  _svSelectedSlot = null;
}
window._closeBuildPanel = _closeBuildPanel;

// _closeHousingModal is defined earlier (before build panel) — referenced here for clarity

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
  // Explicitly refresh topbar — buildBuilding's internal refreshResources call
  // can be pre-empted by loadBuildings re-rendering the panel, so we re-run it
  // here to guarantee the numbers reflect the deducted cost.
  if (typeof refreshResources === 'function') await refreshResources();
  if (cost && typeof _spawnFloater === 'function') {
    Object.entries(cost).forEach(function(e) { if (e[1]) _spawnFloater(e[0], -e[1]); });
  }
  await _svLoad();
}
window._svBuild = _svBuild;

async function _svDemolish(buildingId) {
  if (!await KWDialog.confirm({ title: 'Demolish this building?', message: 'You will receive 50% of resources back.', ok: 'Demolish', danger: true })) return;
  _closeBuildPanel();
  try {
    var res = await apiFetch('/api/buildings/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: buildingId }),
    });
    if (!res.ok) {
      var d = await res.json();
      KWDialog.alert(d.error || 'Demolition failed.');
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
    KWDialog.alert('Demolition failed.');
  }
}
window._svDemolish = _svDemolish;

// The basic five as emoji; ores and alloys through js/resources.js _resIcon
// (their registry icon, or ?? until discovered). Named apart so it doesn't
// replace that global.
function _svResIcon(res) {
  return { food:'🌿', timber:'🌲', stone:'🪨', metal:'⚙️', wealth:'🪙' }[res] || (typeof _resIcon === 'function' ? _resIcon(res) : res);
}

// ── Panning (docs/ART_GUIDE.md §4.4) ──────────────────────────────────────────
// Town and the Outskirts are SV_WORLD_W wide. Drag the meadow (or a building:
// a press that moves more than a few pixels pans instead of clicking), use a
// sideways wheel or Shift+wheel, the arrow keys, or rest the mouse at the
// scene's left or right edge. The far strips move a little slower than the
// meadow (their data-pan), which is the only depth effect: nothing follows
// the mouse. Each area remembers where it was; it first opens centred.
var _svPanX = { town: null, outskirts: null };
var _svPanned = false;          // true just after a pan, so its click is ignored
var _SV_PAN_PX = 6;
var _svPanBound = false;
var _svEdge = { dir: 0, since: 0, raf: 0, last: 0 };

function _svViewW() { var sc = document.getElementById('sv-scene'); return sc ? sc.clientWidth : 0; }
// The part of the view the town card covers on desktop (js/context.js): the
// pan treats it as off screen, so the rightmost building can clear the card.
function _svRightInset() { return window.KWContext && KWContext.rightInset ? KWContext.rightInset() : 0; }
function _svSeenW() { return Math.max(0, _svViewW() - _svRightInset()); }
function _svPanMax() { return Math.max(0, SV_WORLD_W * _svScale - _svSeenW()); }
window._svPanRefit = function() { _svPanTo(_svPanX[_svActiveArea] || 0); };
// Short screens (a phone on its side) draw the town smaller, in whole steps
// (¾ or ½) so pixel art stays even (HOME_SCENE.md step 8). Pure.
function _svScaleFor(sceneH) { return sceneH >= 600 ? 1 : sceneH >= 420 ? 0.75 : 0.5; }
var _svScale = 1;
// Fits the world to the scene's height: the scale, and a world height that
// fills the scene once scaled.
function _svFit() {
  var sc = document.getElementById('sv-scene'), world = document.getElementById('sv-world');
  if (!sc || !world) return;
  var h = sc.clientHeight || 0;
  _svScale = _svScaleFor(h);
  world.style.height = _svScale === 1 ? '' : Math.round(h / _svScale) + 'px';
  world.style.bottom = _svScale === 1 ? '' : 'auto';
  world.classList.toggle('sv-scaled', _svScale !== 1);
}
// Clamps a pan to the world. Pure.
function _svClampPan(x, viewW, worldW) { return Math.max(0, Math.min(Math.max(0, worldW - viewW), x)); }

function _svPanTo(x) {
  var world = document.getElementById('sv-world');
  if (!world) return;
  var max = _svPanMax();
  var px = Math.round(_svClampPan(x, _svSeenW(), SV_WORLD_W * _svScale));
  _svPanX[_svActiveArea] = px;
  world.style.transform = 'translate3d(' + (-px) + 'px,0,0)' + (_svScale !== 1 ? ' scale(' + _svScale + ')' : '');
  // Far strips lag behind: shift them back by part of the pan (in world pixels).
  world.querySelectorAll('.sv-bd[data-pan]').forEach(function(el) {
    var k = 1 - (+el.dataset.pan || 1);
    el.style.transform = k ? 'translate3d(' + Math.round(px / _svScale * k) + 'px,0,0)' : '';
  });
  var sc = document.getElementById('sv-scene');
  if (sc) { sc.classList.toggle('sv-at-start', px <= 0); sc.classList.toggle('sv-at-end', px >= max); }
}
window._svPanTo = _svPanTo;
function _svPanBy(dx) { _svPanTo((_svPanX[_svActiveArea] || 0) + dx); }
// Where an area opens: where it was left, else `where` ('start', 'end' or the middle).
function _svPanArea(area, where) {
  var x = _svPanX[area];
  if (where === 'start') x = 0;
  else if (where === 'end') x = SV_WORLD_W * _svScale;
  else if (x == null) x = (SV_WORLD_W * _svScale - _svSeenW()) / 2;
  _svPanTo(x);
}

function _svBindPan() {
  if (_svPanBound) return;
  _svPanBound = true;
  var sc = document.getElementById('sv-scene');
  if (!sc) return;
  var press = null;
  sc.addEventListener('pointerdown', function(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.sv-build-panel, .sv-housing-modal, .kwv-test-panel, .sv-header')) return;
    // In Build mode a press on a building moves the building, not the view.
    var slot = e.target.closest('.sv-slot');
    if (_svBuildMode && slot && slot.dataset.slot && _svDraggable(slot.dataset.slot)) return;
    press = { id: e.pointerId, x: e.clientX, start: _svPanX[_svActiveArea] || 0, moved: false };
  });
  window.addEventListener('pointermove', function(e) {
    if (press && e.pointerId === press.id) {
      var dx = e.clientX - press.x;
      if (!press.moved && Math.abs(dx) < _SV_PAN_PX) return;
      if (!press.moved) { press.moved = true; sc.classList.add('sv-panning'); }
      _svPanTo(press.start - dx);
      return;
    }
    _svEdgeWatch(e);
  });
  var end = function(e) {
    if (!press || (e && e.pointerId !== press.id)) return;
    if (press.moved) { _svPanned = true; setTimeout(function() { _svPanned = false; }, 0); sc.classList.remove('sv-panning'); }
    press = null;
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  // A drag that panned must not also click the building it started on.
  sc.addEventListener('click', function(e) { if (_svPanned) { e.stopPropagation(); e.preventDefault(); } }, true);
  sc.addEventListener('wheel', function(e) {
    var dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (!dx) return;
    e.preventDefault();
    _svPanBy(dx);
  }, { passive: false });
  document.addEventListener('keydown', function(e) {
    if (!_svOpen || e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((window.KWWindow && KWWindow.isOpen()) || (window.KWDialog && KWDialog.isOpen())) return;
    if (window.KWA11y && KWA11y.topmost()) return;
    e.preventDefault();
    _svPanBy(e.key === 'ArrowLeft' ? -240 : 240);
  });
  sc.addEventListener('mouseleave', function() { _svEdge.dir = 0; });
  window.addEventListener('resize', function() { if (_svOpen) { _svFit(); _svPanTo(_svPanX[_svActiveArea] || 0); if (window.KWHome) KWHome.syncGlow(); if (window.KWCast && KWCast.resurvey) KWCast.resurvey(); } });
}

// Resting the mouse at the scene's left or right edge pans that way, after a
// short pause so passing through the edge does nothing.
var _SV_EDGE = 36, _SV_EDGE_WAIT = 300, _SV_EDGE_SPEED = 700;
function _svEdgeWatch(e) {
  if (!_svOpen || e.pointerType !== 'mouse') return;
  var sc = document.getElementById('sv-scene');
  if (!sc || !sc.contains(e.target) || e.target.closest('.sv-build-panel, .sv-housing-modal')) { _svEdge.dir = 0; return; }
  var r = sc.getBoundingClientRect();
  var dir = e.clientX < r.left + _SV_EDGE ? -1 : e.clientX > r.right - _SV_EDGE ? 1 : 0;
  if (dir !== _svEdge.dir) { _svEdge.dir = dir; _svEdge.since = performance.now(); }
  if (dir && !_svEdge.raf) { _svEdge.last = 0; _svEdge.raf = requestAnimationFrame(_svEdgeTick); }
}
function _svEdgeTick(t) {
  _svEdge.raf = 0;
  if (!_svEdge.dir || !_svOpen) return;
  if (t - _svEdge.since > _SV_EDGE_WAIT) {
    var dt = _svEdge.last ? Math.min(50, t - _svEdge.last) : 16;
    _svPanBy(_svEdge.dir * _SV_EDGE_SPEED * dt / 1000);
  }
  _svEdge.last = t;
  _svEdge.raf = requestAnimationFrame(_svEdgeTick);
}

// ── Build mode (§2.3) ─────────────────────────────────────────────────────────
// One mode for building and arranging: empty plots show ("Build here"), a
// building opens its manage panel (upgrade, demolish) and can be dragged to
// another plot (onto an empty one it moves, onto a building they swap), and
// villagers are hidden. The Build chip turns it on and reads "Done" while on;
// Done or Esc leave. `on` forces a state.
var _svJustDragged = false;
function _svToggleBuildMode(on) {
  var want = typeof on === 'boolean' ? on : !_svBuildMode;
  if (want === _svBuildMode) return _svBuildMode;
  _svBuildMode = want;
  var scene    = document.getElementById('sv-scene');
  var resetBtn = document.getElementById('sv-edit-reset-btn');
  _closeBuildPanel();
  _closeHousingModal();
  if (_svBuildMode) {
    if (scene) scene.classList.add('sv-editing', 'sv-build-mode');
    if (resetBtn) resetBtn.style.display = _svHasCustomLayout() ? '' : 'none';
    _svAttachDragHandlers();
    document.addEventListener('keydown', _svBuildKey);
  } else {
    if (scene) scene.classList.remove('sv-editing', 'sv-build-mode');
    if (resetBtn) resetBtn.style.display = 'none';
    _svDetachDragHandlers();
    document.removeEventListener('keydown', _svBuildKey);
  }
  if (window.KWVillagers) KWVillagers.setPaused(_svBuildMode);   // villagers hide while building
  if (window.KWPlaces && KWPlaces.refreshTools) KWPlaces.refreshTools();   // the chip reads Build / Done
  _renderScene();
  return _svBuildMode;
}
window._svToggleBuildMode = _svToggleBuildMode;
window._svIsBuildMode = function() { return _svBuildMode; };
window._svIsOpen = function() { return _svOpen; };

// Esc: first closes an open panel, then leaves Build mode. Windows and
// dialogs handle their own Escape (js/a11y.js claims it first).
function _svBuildKey(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || !_svBuildMode) return;
  if ((window.KWDialog && KWDialog.isOpen()) || (window.KWWindow && KWWindow.isOpen())) return;
  var panel = document.getElementById('sv-build-panel'), hm = document.getElementById('sv-housing-modal');
  e.preventDefault();
  if (panel && panel.classList.contains('open')) { _closeBuildPanel(); return; }
  if (hm && hm.classList.contains('open')) { _closeHousingModal(); return; }
  _svToggleBuildMode(false);
}

function _svHasCustomLayout() {
  return Object.keys(_svGetPositions()).length > 0 || Object.keys(_svGetSizes()).length > 0;
}

function _svResetLayout() {
  if (!window.confirm('Put every plot back where it started, at its usual size?')) return;
  localStorage.removeItem(_SV_POS_KEY);
  localStorage.removeItem(_SV_SIZE_KEY);
  var resetBtn = document.getElementById('sv-edit-reset-btn');
  if (resetBtn) resetBtn.style.display = 'none';
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

// A press on a building may become a drag once it moves a few pixels; until
// then it is a click (the manage panel). Empty plots and the Neighbourhood
// don't move.
var _SV_DRAG_PX = 6;
var _svPress = null;
function _svDraggable(slotId) {
  var sl = SV_SLOTS.find(function(s) { return s.id === slotId; });
  return !!(sl && !sl.type && _occupantFor(sl));
}

function _svOnSlotMouseDown(e) {
  if (!_svBuildMode || e.button !== 0 || !_svDraggable(this.dataset.slot)) return;
  _svPress = { slot: this.dataset.slot, x: e.clientX, y: e.clientY };
  _svDragMoveHandler = function(ev) { _svOnPressMove(ev.clientX, ev.clientY, ev); };
  _svDragEndHandler  = function(ev) { _svOnPressEnd(ev.clientX, ev.clientY); };
  document.addEventListener('mousemove', _svDragMoveHandler);
  document.addEventListener('mouseup',   _svDragEndHandler);
}

function _svOnSlotTouchStart(e) {
  if (!_svBuildMode || !_svDraggable(this.dataset.slot)) return;
  var t = e.touches[0];
  _svPress = { slot: this.dataset.slot, x: t.clientX, y: t.clientY };
  _svDragTouchMoveHandler = function(ev) { var m = ev.touches[0]; _svOnPressMove(m.clientX, m.clientY, ev); };
  _svDragTouchEndHandler  = function(ev) { var m = ev.changedTouches[0]; _svOnPressEnd(m.clientX, m.clientY); };
  document.addEventListener('touchmove', _svDragTouchMoveHandler, { passive: false });
  document.addEventListener('touchend',  _svDragTouchEndHandler);
}

function _svOnPressMove(clientX, clientY, ev) {
  if (!_svPress) return;
  if (!_svDragSlot) {
    if (Math.abs(clientX - _svPress.x) < _SV_DRAG_PX && Math.abs(clientY - _svPress.y) < _SV_DRAG_PX) return;
    _svBeginDrag(_svPress.slot, _svPress.x, _svPress.y);
  }
  if (ev && ev.cancelable) ev.preventDefault();   // no page scroll or text selection while dragging
  _svOnDragMove(clientX, clientY);
}

function _svOnPressEnd(clientX, clientY) {
  var dragged = !!_svDragSlot;
  if (dragged) {
    _svOnDragEnd(clientX, clientY);
    // The click that follows a drag's mouseup must not open the panel.
    _svJustDragged = true;
    setTimeout(function() { _svJustDragged = false; }, 0);
  } else _svEndDrag();
}

var _svDropSlot = null;
function _svBeginDrag(slotId, clientX, clientY) {
  _svDragSlot  = slotId;
  _svDropSlot  = null;
  _closeBuildPanel();
  var el = document.getElementById('sv-slot-' + slotId);
  _svDragOrigPos = { x: parseFloat(el && el.style.left) || 0, y: parseFloat(el && el.style.top) || 0 };
  var pt = _svMouseToSlotPct(clientX, clientY);
  _svDragOffset = { x: pt.x - _svDragOrigPos.x, y: pt.y - _svDragOrigPos.y };
  if (el) el.classList.add('sv-dragging');
}

// The building follows the pointer; the plot it would land on is marked.
function _svOnDragMove(clientX, clientY) {
  if (!_svDragSlot) return;
  var pt = _svMouseToSlotPct(clientX, clientY);
  var x  = Math.max(2, Math.min(98, pt.x - _svDragOffset.x));
  var y  = Math.max(30, Math.min(97, pt.y - _svDragOffset.y));
  var el = document.getElementById('sv-slot-' + _svDragSlot);
  if (el) { el.style.left = x + '%'; el.style.top = y + '%'; }
  var target = _svDropTarget(_svDragSlot, x, y, _svPlotPositions());
  if (target !== _svDropSlot) {
    if (_svDropSlot) { var o = document.getElementById('sv-slot-' + _svDropSlot); if (o) o.classList.remove('sv-drop-target'); }
    _svDropSlot = target;
    if (target) { var n = document.getElementById('sv-slot-' + target); if (n) n.classList.add('sv-drop-target'); }
  }
  if (el) el.classList.toggle('sv-drag-bad', !target);
}

// Where each plot stands now: { slotId: { x, y, area, fixed } }.
function _svPlotPositions() {
  var p = _svGetPositions(), out = {};
  SV_SLOTS.forEach(function(sl) {
    out[sl.id] = { x: p[sl.id] ? p[sl.id].x : sl.x, y: p[sl.id] ? p[sl.id].y : sl.y, area: sl.area, fixed: !!sl.type };
  });
  return out;
}

// The plot a building dragged to (x, y) would land on: the nearest other
// plot in its area within 9 % (not the Neighbourhood), else null. Pure, for
// the proofs (verify/scene_proofs.js).
function _svDropTarget(fromId, x, y, plots) {
  var from = plots[fromId];
  if (!from) return null;
  var best = null, bestD = 9;
  Object.keys(plots).forEach(function(id) {
    var q = plots[id];
    if (id === fromId || q.fixed || q.area !== from.area) return;
    var d = Math.sqrt(Math.pow(x - q.x, 2) + Math.pow(y - q.y, 2));
    if (d < bestD) { bestD = d; best = id; }
  });
  return best;
}

// Moving a building: onto an empty plot it moves; onto a building they swap.
// `assign` is the slot → building map; `occupant(slotId)` the building now
// shown there. Returns the new map. Pure.
function _svMoveAssignment(assign, fromId, toId, occupant) {
  var a = Object.assign({}, assign);
  var moving = occupant(fromId), there = occupant(toId);
  if (!moving || fromId === toId) return a;
  a[toId] = moving;
  if (there) a[fromId] = there; else delete a[fromId];
  return a;
}

function _svOnDragEnd(clientX, clientY) {
  if (!_svDragSlot) return;
  var fromId = _svDragSlot, toId = _svDropSlot;
  var el = document.getElementById('sv-slot-' + fromId);
  if (el && _svDragOrigPos) { el.style.left = _svDragOrigPos.x + '%'; el.style.top = _svDragOrigPos.y + '%'; }
  _svEndDrag();
  if (!toId) return;
  var occ = function(id) { var sl = SV_SLOTS.find(function(s) { return s.id === id; }); var b = sl && _occupantFor(sl); return b ? b.id : null; };
  var next = _svMoveAssignment(_svGetAssignments(), fromId, toId, occ);
  localStorage.setItem(_SV_ASSIGN_KEY, JSON.stringify(next));
  _renderScene();
}

function _svEndDrag() {
  if (_svDragSlot) {
    var el = document.getElementById('sv-slot-' + _svDragSlot);
    if (el) { el.classList.remove('sv-dragging'); el.classList.remove('sv-drag-bad'); }
  }
  if (_svDropSlot) { var d = document.getElementById('sv-slot-' + _svDropSlot); if (d) d.classList.remove('sv-drop-target'); }
  _svDragSlot = null; _svDropSlot = null; _svPress = null; _svDragValid = true; _svDragOrigPos = null; _svDragOffset = { x: 0, y: 0 };
  if (_svDragMoveHandler)      { document.removeEventListener('mousemove', _svDragMoveHandler);      _svDragMoveHandler = null; }
  if (_svDragEndHandler)       { document.removeEventListener('mouseup',   _svDragEndHandler);        _svDragEndHandler = null; }
  if (_svDragTouchMoveHandler) { document.removeEventListener('touchmove', _svDragTouchMoveHandler); _svDragTouchMoveHandler = null; }
  if (_svDragTouchEndHandler)  { document.removeEventListener('touchend',  _svDragTouchEndHandler);  _svDragTouchEndHandler = null; }
}

function _svMouseToSlotPct(clientX, clientY) {
  var world = document.getElementById('sv-world');
  if (!world) return { x: 50, y: 50 };
  var r = world.getBoundingClientRect();
  return { x: (clientX - r.left) / r.width * 100, y: (clientY - r.top) / r.height * 100 };
}

// ── Slot sizes ───────────────────────────────────────────────────────────────
// Plots are no longer resized by hand (Build mode moves buildings between
// plots); sizes saved earlier still apply until "Reset layout".
