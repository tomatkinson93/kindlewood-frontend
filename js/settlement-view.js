'use strict';
// settlement-view.js — Layered environmental scene for settlement construction.
// Biome themes compose modular SVG layers; buildings render between midground/foreground.

// ── Biome config (eventually derived from world-map terrain) ──────────────────
const SV_BIOME = 'mountain';

// ── Layer registry ────────────────────────────────────────────────────────────
// z: stacking order within .sv-scene  (building slots occupy z 40–55)
// px/py: parallax pixel travel at cursor extreme (sky=least, foliage=most)
// image: optional asset path — loads over SVG fallback when available
const SV_LAYER_DEFS = {
  'sky':         { z:  0, px:  2, py:  1, render: _svgSky,        image: '/assets/images/biomes/mountain/sky.jpg'        },
  'mtn-distant': { z: 10, px:  4, py:  2, render: _svgMtnDistant                                                         },
  'mtn-near':    { z: 20, px:  7, py:  4, render: _svgMtnNear,    image: '/assets/images/biomes/mountain/mountains.jpg'  },
  'hills':       { z: 30, px: 10, py:  6, render: _svgHills,      image: '/assets/images/biomes/mountain/midground.jpg'  },
  'forest-mid':  { z: 35, px: 12, py:  7, render: _svgForestMid                                                          },
  'rocks-fg':    { z: 60, px: 16, py:  9, render: _svgRocksFg                                                            },
  'foliage-fg':  { z: 65, px: 20, py: 12, render: _svgFoliageFg,  image: '/assets/images/biomes/mountain/foreground.jpg' },
};

// ── Biome definitions ─────────────────────────────────────────────────────────
const SV_BIOMES = {
  mountain: ['sky', 'mtn-distant', 'mtn-near', 'hills', 'forest-mid', 'rocks-fg', 'foliage-fg'],
};

// ── Slot definitions ──────────────────────────────────────────────────────────
const SV_SLOTS = [
  { id:'town-granary',  area:'town',      x:8,   y:64, accepts:['granary'],       label:'Granary Site',   size:'md' },
  { id:'town-tavern',   area:'town',      x:24,  y:62, accepts:['tavern'],        label:'Tavern Site',    size:'lg' },
  { id:'town-house-3',  area:'town',      x:37,  y:72, accepts:['starter_house'], label:'Housing Plot',   size:'sm' },
  { id:'town-market',   area:'town',      x:47,  y:70, accepts:['market'],        label:'Market Square',  size:'md' },
  { id:'town-house-1',  area:'town',      x:61,  y:62, accepts:['starter_house'], label:'Housing Plot',   size:'sm' },
  { id:'town-house-2',  area:'town',      x:74,  y:55, accepts:['starter_house'], label:'Housing Plot',   size:'sm' },
  { id:'out-forager',   area:'outskirts', x:16,  y:65, accepts:['forager_hut'],   label:'Forager Ground', size:'sm' },
  { id:'out-farm',      area:'outskirts', x:31,  y:68, accepts:['farm'],          label:'Farmland',       size:'lg' },
  { id:'out-lumber',    area:'outskirts', x:53,  y:60, accepts:['lumber_camp'],   label:'Lumber Site',    size:'md' },
  { id:'out-fishing',   area:'outskirts', x:77,  y:72, accepts:['fishing_post'],  label:'Fishing Dock',   size:'md' },
  { id:'out-scout',     area:'outskirts', x:87,  y:54, accepts:['scout_post'],    label:'Lookout Point',  size:'sm' },
];

// ── Building visual config ────────────────────────────────────────────────────
const SV_VISUALS = {
  tavern:        { emoji:'\u{1F37A}', bodyColor:'#7a4225', roofColor:'#5c3018', flavor:'Warmth and ale for all who wander.' },
  market:        { emoji:'⚖️', bodyColor:'#b8860b', roofColor:'#8b6010', flavor:'Where fortunes are made and spent.' },
  granary:       { emoji:'\u{1F33E}', bodyColor:'#8b7536', roofColor:'#6b5a2a', flavor:'Surplus grain against lean seasons.' },
  starter_house: { emoji:'\u{1F3E1}', bodyColor:'#8b6048', roofColor:'#c87941', flavor:'Humble shelter, warm within.' },
  farm:          { emoji:'\u{1F331}', bodyColor:'#5a8040', roofColor:'#3d6030', flavor:'Neat rows of cultivated earth.' },
  lumber_camp:   { emoji:'\u{1FA93}', bodyColor:'#6b4020', roofColor:'#4a2c10', flavor:'Axes ring through the morning pines.' },
  fishing_post:  { emoji:'\u{1F3A3}', bodyColor:'#3a6080', roofColor:'#284860', flavor:'A patient dock above the quiet water.' },
  forager_hut:   { emoji:'\u{1F344}', bodyColor:'#607850', roofColor:'#485a38', flavor:'Into the woodland, lantern in hand.' },
  scout_post:    { emoji:'\u{1F5FA}️', bodyColor:'#5a5040', roofColor:'#3a3428', flavor:"The settlement's watchful eye." },
};

// ── State ─────────────────────────────────────────────────────────────────────
let _svOpen         = false;
let _svBuildings    = [];
let _svSelectedSlot = null;
let _svActiveArea   = 'town';
let _svTargetX = 0, _svTargetY = 0;
let _svCurX    = 0, _svCurY    = 0;
let _svRafId   = null;
let _svStylesInjected = false;
let _svDOMBuilt       = false;

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

.sv-scene { position: absolute; inset: 0; overflow: hidden; user-select: none; cursor: default; }

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
.sv-env-layer svg { position: absolute; inset: 0; width: 100%; height: 100%; }

/* Layer image overlay — fades over SVG fallback on load */
.sv-layer-img {
  position: absolute; inset: 0; z-index: 1;
  width: 100%; height: 100%; object-fit: cover; object-position: center;
  opacity: 0; transition: opacity 0.6s ease;
}
.sv-layer-img.sv-img-loaded { opacity: 1; }
.sv-layer-img.sv-img-loaded ~ svg { opacity: 0; transition: opacity 0.6s ease; }

.sv-fg-layer { transition: opacity 0.45s ease; }
.sv-area-hidden { opacity: 0 !important; pointer-events: none !important; }

/* Slots re-enable pointer events within the passthrough fg layer */
.sv-slot { position: absolute; transform: translate(-50%,-50%); cursor: pointer; z-index: 2; pointer-events: auto; }
.sv-slot-empty { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.sv-slot-ring {
  border-radius: 50%; border: 2px dashed rgba(220,190,120,0.32);
  background: rgba(220,190,120,0.04);
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.28s, background 0.28s, box-shadow 0.28s;
  animation: sv-pulse 3.2s ease-in-out infinite;
}
.sv-slot-plus { color: rgba(220,190,120,0.38); font-size: 18px; line-height: 1; font-weight: 300; transition: color 0.28s, transform 0.28s; }
.sv-slot-hint { font-size: 9.5px; color: rgba(220,190,120,0); white-space: nowrap; letter-spacing: 0.06em; text-shadow: 0 1px 4px rgba(0,0,0,0.9); transition: color 0.25s; font-weight: 600; text-align: center; }
.sv-slot-empty:hover .sv-slot-ring { border-color: rgba(255,210,100,0.82); background: rgba(255,210,100,0.11); box-shadow: 0 0 20px rgba(255,200,70,0.3), inset 0 0 10px rgba(255,200,70,0.08); animation: none; }
.sv-slot-empty:hover .sv-slot-plus { color: rgba(255,215,110,0.95); transform: scale(1.18); }
.sv-slot-empty:hover .sv-slot-hint { color: rgba(220,195,130,0.85); }
.sv-slot-empty.locked { opacity: 0.3; cursor: default; }
.sv-slot-empty.locked:hover .sv-slot-ring { border-color: rgba(220,190,120,0.32); background: rgba(220,190,120,0.04); box-shadow: none; animation: sv-pulse 3.2s ease-in-out infinite; }
.sv-slot-empty.locked:hover .sv-slot-plus { color: rgba(220,190,120,0.38); transform: none; }
.sv-slot-empty.locked:hover .sv-slot-hint { color: rgba(220,190,120,0); }
.sv-slot-empty.size-lg .sv-slot-ring { width: 70px; height: 70px; }
.sv-slot-empty.size-md .sv-slot-ring { width: 54px; height: 54px; }
.sv-slot-empty.size-sm .sv-slot-ring { width: 42px; height: 42px; }
@keyframes sv-pulse {
  0%,100% { border-color: rgba(220,190,120,0.22); box-shadow: none; }
  50%      { border-color: rgba(220,190,120,0.48); box-shadow: 0 0 10px rgba(220,190,120,0.13); }
}

.sv-building { display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: transform 0.22s ease, filter 0.22s ease; }
.sv-building:hover { transform: translateY(-5px) scale(1.06); filter: brightness(1.1); }
.sv-building-struct { position: relative; border-radius: 4px 4px 0 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1); }
.sv-building-roof { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); border-style: solid; border-left-color: transparent !important; border-right-color: transparent !important; border-top-color: transparent !important; }
.sv-building-emoji { font-size: 22px; line-height: 1; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45)); }
.sv-building-shadow { width: 75%; height: 7px; border-radius: 50%; background: rgba(0,0,0,0.18); margin-top: 2px; filter: blur(3px); }
.sv-building-name { font-size: 9.5px; font-weight: 700; color: #e8d090; text-shadow: 0 1px 5px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8); white-space: nowrap; margin-top: 5px; letter-spacing: 0.05em; text-align: center; }
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
.sv-bp-lv-badge { background: rgba(80,180,80,0.18); border: 1px solid rgba(80,180,80,0.35); color: #80c880; border-radius: 12px; padding: 4px 10px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.sv-occ-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.sv-occ-emoji { font-size: 34px; flex-shrink: 0; }
.sv-occ-name  { font-size: 16px; font-weight: 700; color: #e8d090; }
.sv-occ-lv    { font-size: 12px; color: rgba(200,180,120,0.65); margin-top: 3px; }
.sv-occ-desc  { font-size: 12px; color: rgba(200,180,140,0.72); line-height: 1.5; margin-bottom: 14px; }
.sv-occ-flavor{ font-size: 11px; color: rgba(180,160,120,0.55); font-style: italic; text-align: center; margin-top: 12px; line-height: 1.4; }
  `;
  document.head.appendChild(s);
}

// ── SVG layer art — mountain biome ────────────────────────────────────────────
// All use viewBox="0 0 1000 600", preserveAspectRatio="xMidYMid slice".
// Horizon sits at ~y=400. Mountain peaks: y=145–280. Ground: y=400+.

function _svgSky() {
  return '<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">'
    + '<defs>'
    + '<linearGradient id="sv-sky-g" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%"   stop-color="#1a2840"/>'
    + '<stop offset="26%"  stop-color="#2c4878"/>'
    + '<stop offset="50%"  stop-color="#4878ac"/>'
    + '<stop offset="72%"  stop-color="#86acc8"/>'
    + '<stop offset="88%"  stop-color="#b4ccb8"/>'
    + '<stop offset="100%" stop-color="#c8c4a0"/>'
    + '</linearGradient>'
    + '<radialGradient id="sv-sun-g" cx="0.76" cy="1.08" r="0.58">'
    + '<stop offset="0%"   stop-color="#f0d870" stop-opacity="0.20"/>'
    + '<stop offset="100%" stop-color="#f0d870" stop-opacity="0"/>'
    + '</radialGradient>'
    + '</defs>'
    + '<rect width="1000" height="600" fill="url(#sv-sky-g)"/>'
    + '<rect width="1000" height="600" fill="url(#sv-sun-g)"/>'
    // clouds — pairs of overlapping ellipses for soft puff shapes
    + '<ellipse cx="155" cy="128" rx="130" ry="24" fill="rgba(255,255,255,0.07)"/>'
    + '<ellipse cx="205" cy="116" rx="82"  ry="17" fill="rgba(255,255,255,0.09)"/>'
    + '<ellipse cx="575" cy="103" rx="148" ry="27" fill="rgba(255,255,255,0.06)"/>'
    + '<ellipse cx="628" cy="90"  rx="94"  ry="19" fill="rgba(255,255,255,0.08)"/>'
    + '<ellipse cx="862" cy="152" rx="108" ry="21" fill="rgba(255,255,255,0.05)"/>'
    + '<ellipse cx="908" cy="140" rx="68"  ry="15" fill="rgba(255,255,255,0.07)"/>'
    // faint stars
    + '<circle cx="82"  cy="46"  r="1"   fill="rgba(255,255,255,0.35)"/>'
    + '<circle cx="268" cy="28"  r="1"   fill="rgba(255,255,255,0.28)"/>'
    + '<circle cx="424" cy="54"  r="1.2" fill="rgba(255,255,255,0.32)"/>'
    + '<circle cx="682" cy="22"  r="1"   fill="rgba(255,255,255,0.30)"/>'
    + '<circle cx="815" cy="50"  r="1"   fill="rgba(255,255,255,0.25)"/>'
    + '<circle cx="952" cy="35"  r="0.9" fill="rgba(255,255,255,0.30)"/>'
    + '</svg>';
}

function _svgMtnDistant() {
  // Very pale, hazy masses suggesting great distance
  return '<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">'
    + '<polygon points="-30,600 80,292 168,336 268,248 362,314 445,600" fill="rgba(172,200,224,0.42)"/>'
    + '<polygon points="310,600 452,215 542,270 638,192 724,256 815,600" fill="rgba(162,190,216,0.46)"/>'
    + '<polygon points="682,600 792,260 874,304 958,228 1042,288 1060,600" fill="rgba(168,196,220,0.40)"/>'
    // atmospheric haze band where mountains meet ground
    + '<rect x="-50" y="388" width="1100" height="52" fill="rgba(188,210,228,0.10)"/>'
    + '</svg>';
}

function _svgMtnNear() {
  // Defined grey-blue peaks with snow caps on the tallest
  return '<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">'
    // left peak
    + '<polygon points="-20,420 68,308 122,182 188,296 292,405 280,420" fill="#728aaa"/>'
    + '<polygon points="-20,420 68,308 88,345 58,395 -20,420"           fill="#6880a2"/>'
    // center peak — tallest, gets a snow cap
    + '<polygon points="308,420 398,300 452,232 490,148 528,232 580,308 652,420" fill="#7a96b8"/>'
    + '<polygon points="454,224 490,148 526,222" fill="#deeaf5" opacity="0.88"/>'
    // right peak
    + '<polygon points="658,420 748,320 816,198 878,298 960,388 1022,420" fill="#7290b0"/>'
    + '<polygon points="878,298 938,322 1022,382 1022,420 958,415"        fill="#6880a8"/>'
    // shared base merging into ground
    + '<polygon points="-20,420 1022,420 1022,600 -20,600" fill="#56704e" opacity="0.50"/>'
    + '</svg>';
}

function _svgHills() {
  // Three overlapping hill masses, smooth bezier, earthy greens
  return '<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M-100,600 C0,315 185,294 382,328 C562,358 682,344 852,356 C952,362 1060,392 1060,600Z" fill="#4a6830" opacity="0.88"/>'
    + '<path d="M-100,600 C52,352 168,338 342,366 C524,390 682,374 842,382 C942,386 1060,418 1060,600Z" fill="#567838" opacity="0.92"/>'
    + '<path d="M-100,600 Q250,410 500,416 Q752,422 1060,414 L1060,600Z" fill="#60804a" opacity="0.96"/>'
    // subtle lighter ground trim at the surface edge
    + '<path d="M-100,428 Q300,414 600,418 Q850,422 1060,416 Q1060,430 850,432 Q600,434 300,430 Q0,428 -100,442Z" fill="#709050" opacity="0.55"/>'
    + '</svg>';
}

function _svgForestMid() {
  // Stylized pine silhouettes growing along the hill ridge
  var rows = '';
  var count = 32;
  for (var i = 0; i < count; i++) {
    var x  = -10 + i * 34 + Math.sin(i * 0.82) * 9;
    var h  = 58 + Math.sin(i * 0.63 + 1.4) * 22;
    var w  = 22 + Math.sin(i * 1.05) * 5;
    var by = 372 + Math.sin(i * 0.45) * 8;
    var fills = ['#243618', '#2e4420', '#384e28', '#2a401c'];
    var fill  = fills[i % 4];
    var op    = (0.88 + (i % 3) * 0.04).toFixed(2);
    rows += '<polygon points="'
      + x + ',' + by + ' '
      + (x - w/2) + ',' + (by - h*0.52) + ' '
      + (x - w/3) + ',' + (by - h*0.52) + ' '
      + (x - w/4) + ',' + (by - h) + ' '
      + (x + w/4) + ',' + (by - h) + ' '
      + (x + w/3) + ',' + (by - h*0.52) + ' '
      + (x + w/2) + ',' + (by - h*0.52)
      + '" fill="' + fill + '" opacity="' + op + '"/>';
  }
  return '<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' + rows + '</svg>';
}

function _svgRocksFg() {
  // Boulder clusters anchored to the ground, bottom ~20% of scene
  return '<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">'
    // ground cover strip
    + '<path d="M-50,488 Q250,474 500,480 Q752,484 1060,476 L1060,600 L-50,600Z" fill="#527040" opacity="0.72"/>'
    // boulders
    + '<polygon points="85,548 48,526 62,503 96,498 130,512 140,540 115,560" fill="#8a7a68"/>'
    + '<polygon points="85,548 48,526 62,503 80,496 85,548"                  fill="#786a58"/>'
    + '<polygon points="328,554 295,530 310,506 344,501 376,518 380,547 355,562" fill="#988070"/>'
    + '<polygon points="695,540 663,514 678,490 714,486 750,502 754,532 728,550" fill="#8a7868"/>'
    + '<polygon points="750,502 754,532 728,550 720,532 742,510"               fill="#7a6858"/>'
    + '<polygon points="940,550 906,524 922,498 960,493 990,510 992,542 968,560" fill="#928272"/>'
    // small scattered rocks
    + '<ellipse cx="198" cy="558" rx="22" ry="12" fill="#7a6a58" opacity="0.80"/>'
    + '<ellipse cx="462" cy="562" rx="16" ry="9"  fill="#888070" opacity="0.75"/>'
    + '<ellipse cx="582" cy="556" rx="20" ry="11" fill="#7a6858" opacity="0.78"/>'
    + '<ellipse cx="832" cy="562" rx="18" ry="10" fill="#8a7860" opacity="0.72"/>'
    + '</svg>';
}

function _svgFoliageFg() {
  // Dark pine silhouettes framing both bottom corners
  return '<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">'
    // left cluster — two overlapping pine shapes
    + '<polygon points="0,600 -10,490 22,468 46,512 52,480 72,454 90,478 82,512 108,488 120,522 102,548 60,572 0,600" fill="#182e12" opacity="0.92"/>'
    + '<polygon points="0,600 32,548 56,522 44,492 68,470 80,502 68,538 82,562 42,592 0,600" fill="#1e3818" opacity="0.86"/>'
    // left grass tufts
    + '<path d="M112,582 C120,556 128,546 133,556 C136,540 144,530 150,543 C154,526 162,520 167,536" stroke="#283e1c" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.75"/>'
    // right cluster — mirror
    + '<polygon points="1000,600 1010,490 978,468 954,512 948,480 928,454 910,478 918,512 892,488 880,522 898,548 940,572 1000,600" fill="#182e12" opacity="0.92"/>'
    + '<polygon points="1000,600 968,548 944,522 956,492 932,470 920,502 932,538 918,562 958,592 1000,600" fill="#1e3818" opacity="0.86"/>'
    // right grass tufts
    + '<path d="M888,582 C880,556 872,546 867,556 C864,540 856,530 850,543 C846,526 838,520 833,536" stroke="#283e1c" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.75"/>'
    // center bottom ground line
    + '<path d="M152,596 C200,582 300,579 400,582 C500,585 600,583 700,580 C800,578 872,582 898,592" stroke="#2a4018" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.55"/>'
    + '</svg>';
}

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
    var imgHtml = def.image
      ? '<img class="sv-layer-img" src="' + def.image + '" alt=""'
        + ' onload="this.classList.add(\'sv-img-loaded\')"'
        + ' onerror="this.style.display=\'none\'">'
      : '';
    div.innerHTML = imgHtml + def.render();
    if (def.z < 40) {
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
    + '<div class="sv-layer sv-fg-layer" id="sv-layer-fg-town" style="z-index:40">'
    + townSlots.map(slotHTML).join('') + '</div>'
    + '<div class="sv-layer sv-fg-layer sv-area-hidden" id="sv-layer-fg-outskirts" style="z-index:40">'
    + outSlots.map(slotHTML).join('') + '</div>'
    + '</div>'
    + '<div class="sv-header">'
    + '<span class="sv-header-title" id="sv-title">Settlement</span>'
    + '<div class="sv-area-tabs">'
    + '<button class="sv-area-tab active" data-area="town" onclick="_svSwitchArea(\'town\')">&#127960; Town</button>'
    + '<button class="sv-area-tab" data-area="outskirts" onclick="_svSwitchArea(\'outskirts\')">&#127807; Outskirts</button>'
    + '</div></div>'
    + '<div class="sv-build-panel" id="sv-build-panel"></div>';

  _buildEnvLayers(SV_BIOME);

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
  await _svLoad();
}
window.openSettlementView = openSettlementView;

function closeSettlementView() {
  _svOpen = false;
  _closeBuildPanel();
  _unbindParallax();
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
      (function(s, o) { el.onclick = function() { _openBuildPanel(s, o); }; })(slot, occupant);
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
      if (anyAvail) (function(s) { el.onclick = function() { _openBuildPanel(s, null); }; })(slot);
    }
  }
}

function _occupantFor(slot) {
  for (var i = 0; i < slot.accepts.length; i++) {
    var b = _svBuildings.find(function(b) { return b.id === slot.accepts[i] && b.currentLevel > 0; });
    if (b) return b;
  }
  return null;
}

function _buildEmptyEl(slot, available, locked) {
  var div = document.createElement('div');
  div.className = 'sv-slot-empty size-' + slot.size + (locked ? ' locked' : '');
  if (!available && !locked) div.style.cursor = 'default';
  div.innerHTML = '<div class="sv-slot-ring"><span class="sv-slot-plus">' + (locked ? '🔒' : '+') + '</span></div>'
    + '<div class="sv-slot-hint">' + slot.label + '</div>';
  return div;
}

function _buildOccupiedEl(slot, building) {
  var vis  = SV_VISUALS[building.id] || { emoji:'🏛', bodyColor:'#555', roofColor:'#333' };
  var szMap = { lg:{w:64,h:52,rw:72}, md:{w:52,h:44,rw:58}, sm:{w:40,h:36,rw:46} };
  var sz   = szMap[slot.size] || szMap.md;
  var rh   = Math.round(sz.h * 0.44);
  var div  = document.createElement('div');
  div.className = 'sv-building';
  div.innerHTML = '<div class="sv-building-struct" style="width:' + sz.w + 'px;height:' + sz.h + 'px;background:' + vis.bodyColor + '">'
    + '<div class="sv-building-roof" style="border-width:0 ' + (sz.rw/2) + 'px ' + rh + 'px ' + (sz.rw/2) + 'px;border-bottom-color:' + vis.roofColor + '"></div>'
    + '<span class="sv-building-emoji">' + vis.emoji + '</span>'
    + '</div>'
    + '<div class="sv-building-shadow"></div>'
    + '<div class="sv-building-name">' + building.label + '</div>'
    + (building.currentLevel > 1 ? '<div class="sv-building-lv">Lv ' + building.currentLevel + '</div>' : '');
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
    html += '<div class="sv-occ-head"><span class="sv-occ-emoji">' + vis.emoji + '</span>'
      + '<div><div class="sv-occ-name">' + occupant.label + '</div>'
      + '<div class="sv-occ-lv">Level ' + occupant.currentLevel + ' / ' + occupant.maxLevel + '</div></div>'
      + (isMax
        ? '<span class="sv-bp-lv-badge" style="margin-left:auto">★ MAX</span>'
        : '<button class="sv-bp-upgrade-btn" style="margin-left:auto" onclick="_svBuild(\'' + occupant.id + '\')">↑ Upgrade' + (costStr ? ' — ' + costStr : '') + '</button>')
      + '</div><div class="sv-occ-desc">' + (occupant.desc || '') + '</div>'
      + '<div class="sv-occ-flavor">' + (vis.flavor || '') + '</div>';
  } else {
    var opts = slot.accepts.map(function(id) {
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

async function _svBuild(buildingId) {
  if (typeof buildBuilding !== 'function') return;
  _closeBuildPanel();
  await buildBuilding(buildingId);
  await _svLoad();
}
window._svBuild = _svBuild;

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

  // Building fg layers — between forest-mid (12/7) and rocks-fg (16/9)
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
