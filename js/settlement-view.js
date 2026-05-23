'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  settlement-view.js  —  Visual settlement scene for building construction
//
//  Public API (all on window):
//    openSettlementView()    — transition into the scene
//    closeSettlementView()   — transition back to map
//    refreshSettlementView() — reload building state (call after construction)
// ─────────────────────────────────────────────────────────────────────────────

// ── Slot definitions ──────────────────────────────────────────────────────────────────────────────
// x/y: % of scene container. size: 'sm'|'md'|'lg' affects empty marker + building footprint.
const SV_SLOTS = [
  // Town area (left ~10–55%)
  { id:'town-tavern',  area:'town',      x:22,  y:62, accepts:['tavern'],        label:'Tavern Site',      size:'lg' },
  { id:'town-market',  area:'town',      x:36,  y:72, accepts:['market'],        label:'Market Square',    size:'md' },
  { id:'town-granary', area:'town',      x:10,  y:66, accepts:['granary'],       label:'Granary Site',     size:'md' },
  { id:'town-house-1', area:'town',      x:44,  y:62, accepts:['starter_house'], label:'Housing Plot',     size:'sm' },
  { id:'town-house-2', area:'town',      x:50,  y:56, accepts:['starter_house'], label:'Housing Plot',     size:'sm' },
  { id:'town-house-3', area:'town',      x:30,  y:76, accepts:['starter_house'], label:'Housing Plot',     size:'sm' },
  // Outskirts (right ~58–90%)
  { id:'out-farm',     area:'outskirts', x:65,  y:72, accepts:['farm'],          label:'Farmland',         size:'lg' },
  { id:'out-lumber',   area:'outskirts', x:74,  y:60, accepts:['lumber_camp'],   label:'Lumber Site',      size:'md' },
  { id:'out-fishing',  area:'outskirts', x:83,  y:76, accepts:['fishing_post'],  label:'Fishing Dock',     size:'md' },
  { id:'out-forager',  area:'outskirts', x:68,  y:65, accepts:['forager_hut'],   label:'Forager Ground',   size:'sm' },
  { id:'out-scout',    area:'outskirts', x:86,  y:56, accepts:['scout_post'],    label:'Lookout Point',    size:'sm' },
];

// ── Building visual config ────────────────────────────────────────────────────────────────────────
const SV_VISUALS = {
  tavern:        { emoji:'🍺',  bodyColor:'#7a4225', roofColor:'#5c3018', flavor:'Warmth and ale for all who wander.' },
  market:        { emoji:'⚖️',  bodyColor:'#b8860b', roofColor:'#8b6010', flavor:'Where fortunes are made and spent.' },
  granary:       { emoji:'🌾',  bodyColor:'#8b7536', roofColor:'#6b5a2a', flavor:'Surplus grain against lean seasons.' },
  starter_house: { emoji:'🏡',  bodyColor:'#8b6048', roofColor:'#c87941', flavor:'Humble shelter, warm within.' },
  farm:          { emoji:'🌱',  bodyColor:'#5a8040', roofColor:'#3d6030', flavor:'Neat rows of cultivated earth.' },
  lumber_camp:   { emoji:'🪓',  bodyColor:'#6b4020', roofColor:'#4a2c10', flavor:'Axes ring through the morning pines.' },
  fishing_post:  { emoji:'🎣',  bodyColor:'#3a6080', roofColor:'#284860', flavor:'A patient dock above the quiet water.' },
  forager_hut:   { emoji:'🍄',  bodyColor:'#607850', roofColor:'#485a38', flavor:'Into the woodland, lantern in hand.' },
  scout_post:    { emoji:'🗺',  bodyColor:'#5a5040', roofColor:'#3a3428', flavor:'The settlement\'s watchful eye.' },
};

// ── State ─────────────────────────────────────────────────────────────────────────────────
let _svOpen        = false;
let _svBuildings   = [];
let _svSelectedSlot = null;
let _svTargetX = 0, _svTargetY = 0;
let _svCurX    = 0, _svCurY    = 0;
let _svRafId   = null;
let _svStylesInjected = false;
let _svDOMBuilt       = false;

// ── CSS (injected once) ───────────────────────────────────────────────────────────────────────────
function _injectSvStyles() {
  if (_svStylesInjected) return;
  _svStylesInjected = true;
  const s = document.createElement('style');
  s.id = 'settlement-view-styles';
  s.textContent = `
/* ── Root overlay ── */
#settlement-view {
  position: fixed; inset: 0; z-index: 800;
  display: none; flex-direction: column;
  background: #1a1510;
  opacity: 0;
  transition: opacity 0.45s ease;
}
#settlement-view.sv-visible { opacity: 1; }

/* ── Header ── */
.sv-header {
  position: absolute; top: 0; left: 0; right: 0; z-index: 10;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(to bottom, rgba(10,8,6,0.88) 0%, transparent 100%);
  pointer-events: none;
}
.sv-header > * { pointer-events: auto; }
.sv-back-btn {
  background: rgba(30,20,12,0.78); border: 1px solid rgba(180,140,80,0.5);
  color: #d4b878; padding: 7px 14px; border-radius: 6px;
  font-size: 13px; cursor: pointer; transition: background 0.2s, border-color 0.2s;
  font-family: inherit;
}
.sv-back-btn:hover { background: rgba(60,40,20,0.88); border-color: rgba(220,180,100,0.7); }
.sv-header-title {
  font-size: 18px; font-weight: 700; color: #e8d090;
  text-shadow: 0 2px 8px rgba(0,0,0,0.7); letter-spacing: 0.05em;
}

/* ── Scene ── */
.sv-scene {
  position: absolute; inset: 0;
  overflow: hidden; user-select: none; cursor: default;
}

/* ── Parallax layers ── */
.sv-layer {
  position: absolute;
  inset: -4%;
  width: 108%; height: 108%;
  will-change: transform;
}

/* ── Background: sky + mountains ── */
.sv-bg {
  background: linear-gradient(
    to bottom,
    #2c4468 0%, #4a6890 20%,
    #7898b4 42%, #b8caa8 65%,
    #a8bc80 80%, #98b06a 100%
  );
}
.sv-bg-svg {
  position: absolute; bottom: 0; left: 0;
  width: 100%; height: 55%;
}

/* ── Midground: hills + road + divider ── */
.sv-mid-svg {
  position: absolute; bottom: 0; left: 0;
  width: 100%; height: 60%;
}
.sv-area-divider {
  position: absolute; left: 56.5%; top: 22%; bottom: 0;
  width: 1px;
  background: linear-gradient(to bottom, transparent 0%, rgba(180,160,100,0.2) 40%, rgba(160,140,80,0.12) 100%);
}
.sv-area-label {
  position: absolute; top: 9%;
  font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgba(210,190,150,0.38); font-weight: 700;
  pointer-events: none; user-select: none;
}
.sv-area-label.town     { left: 28%; transform: translateX(-50%); }
.sv-area-label.outskirts{ left: 74%; transform: translateX(-50%); }

/* ── Building slots ── */
.sv-slot {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer; z-index: 2;
}

/* Empty slot */
.sv-slot-empty {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
}
.sv-slot-ring {
  border-radius: 50%;
  border: 2px dashed rgba(220,190,120,0.32);
  background: rgba(220,190,120,0.04);
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.28s, background 0.28s, box-shadow 0.28s;
  animation: sv-pulse 3.2s ease-in-out infinite;
}
.sv-slot-plus {
  color: rgba(220,190,120,0.38);
  font-size: 18px; line-height: 1; font-weight: 300;
  transition: color 0.28s, transform 0.28s;
}
.sv-slot-hint {
  font-size: 9.5px; color: rgba(220,190,120,0);
  white-space: nowrap; letter-spacing: 0.06em;
  text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  transition: color 0.25s; font-weight: 600; text-align: center;
}
.sv-slot-empty:hover .sv-slot-ring {
  border-color: rgba(255,210,100,0.82);
  background: rgba(255,210,100,0.11);
  box-shadow: 0 0 20px rgba(255,200,70,0.3), inset 0 0 10px rgba(255,200,70,0.08);
  animation: none;
}
.sv-slot-empty:hover .sv-slot-plus  { color: rgba(255,215,110,0.95); transform: scale(1.18); }
.sv-slot-empty:hover .sv-slot-hint  { color: rgba(220,195,130,0.85); }
.sv-slot-empty.locked { opacity: 0.3; cursor: default; }
.sv-slot-empty.locked:hover .sv-slot-ring { border-color: rgba(220,190,120,0.32); background: rgba(220,190,120,0.04); box-shadow: none; animation: sv-pulse 3.2s ease-in-out infinite; }
.sv-slot-empty.locked:hover .sv-slot-plus  { color: rgba(220,190,120,0.38); transform: none; }
.sv-slot-empty.locked:hover .sv-slot-hint  { color: rgba(220,190,120,0); }

.sv-slot-empty.size-lg .sv-slot-ring { width: 70px; height: 70px; }
.sv-slot-empty.size-md .sv-slot-ring { width: 54px; height: 54px; }
.sv-slot-empty.size-sm .sv-slot-ring { width: 42px; height: 42px; }

@keyframes sv-pulse {
  0%,100% { border-color: rgba(220,190,120,0.22); box-shadow: none; }
  50%      { border-color: rgba(220,190,120,0.48); box-shadow: 0 0 10px rgba(220,190,120,0.13); }
}

/* ── Occupied building visual ── */
.sv-building {
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer;
  transition: transform 0.22s ease, filter 0.22s ease;
}
.sv-building:hover { transform: translateY(-5px) scale(1.06); filter: brightness(1.1); }
.sv-building-struct {
  position: relative; border-radius: 4px 4px 0 0;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1);
}
.sv-building-roof {
  position: absolute; bottom: 100%; left: 50%;
  transform: translateX(-50%);
  border-style: solid;
  border-left-color: transparent !important;
  border-right-color: transparent !important;
  border-top-color: transparent !important;
}
.sv-building-emoji { font-size: 22px; line-height: 1; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45)); }
.sv-building-shadow {
  width: 75%; height: 7px; border-radius: 50%;
  background: rgba(0,0,0,0.18); margin-top: 2px; filter: blur(3px);
}
.sv-building-name {
  font-size: 9.5px; font-weight: 700; color: #e8d090;
  text-shadow: 0 1px 5px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8);
  white-space: nowrap; margin-top: 5px; letter-spacing: 0.05em; text-align: center;
}
.sv-building-lv {
  font-size: 8.5px; color: rgba(220,190,120,0.72);
  background: rgba(0,0,0,0.52); border-radius: 8px;
  padding: 1px 5px; margin-top: 2px; letter-spacing: 0.06em;
}

/* ── Build panel ── */
.sv-build-panel {
  position: absolute; bottom: 0; left: 50%;
  transform: translateX(-50%) translateY(110%);
  width: min(500px, 96vw);
  background: linear-gradient(160deg, #2a1e14 0%, #1e1510 100%);
  border: 1px solid rgba(180,140,80,0.45); border-bottom: none;
  border-radius: 14px 14px 0 0;
  padding: 20px 20px 32px;
  z-index: 20;
  transition: transform 0.38s cubic-bezier(0.34,1.48,0.64,1);
  box-shadow: 0 -10px 40px rgba(0,0,0,0.55);
}
.sv-build-panel.open { transform: translateX(-50%) translateY(0); }

.sv-bp-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
}
.sv-bp-loc { font-size: 15px; font-weight: 700; color: #e8d090; }
.sv-bp-tag {
  font-size: 10px; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700;
}
.sv-bp-tag.town     { background: rgba(180,130,60,0.18); color: #d4a860; border: 1px solid rgba(180,130,60,0.28); }
.sv-bp-tag.outskirts{ background: rgba(100,160,60,0.18); color: #90c060; border: 1px solid rgba(100,160,60,0.28); }
.sv-bp-close {
  margin-left: auto; background: none; border: none;
  color: rgba(200,180,140,0.45); font-size: 22px; cursor: pointer;
  padding: 0 4px; line-height: 1; transition: color 0.2s; font-family: inherit;
}
.sv-bp-close:hover { color: rgba(230,200,140,0.9); }

/* Building option rows */
.sv-bp-options { display: flex; flex-direction: column; gap: 10px; }
.sv-bp-opt {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 14px; border-radius: 8px;
  background: rgba(255,220,150,0.04);
  border: 1px solid rgba(180,140,80,0.18);
  transition: background 0.2s, border-color 0.2s, transform 0.18s;
}
.sv-bp-opt.available { cursor: pointer; }
.sv-bp-opt.available:hover {
  background: rgba(255,220,150,0.09);
  border-color: rgba(220,180,100,0.38);
  transform: translateY(-1px);
}
.sv-bp-opt.locked { opacity: 0.4; cursor: default; }
.sv-bp-opt.built  { background: rgba(80,180,80,0.05); border-color: rgba(80,180,80,0.18); cursor: default; }

.sv-bp-emoji { font-size: 28px; line-height: 1; flex-shrink: 0; }
.sv-bp-info  { flex: 1; min-width: 0; }
.sv-bp-name  { font-size: 14px; font-weight: 700; color: #e8d090; }
.sv-bp-desc  { font-size: 11px; color: rgba(200,180,140,0.68); margin-top: 2px; line-height: 1.4; }
.sv-bp-cost  { font-size: 11px; color: rgba(210,200,150,0.78); margin-top: 4px; }

.sv-bp-action { flex-shrink: 0; }
.sv-bp-build-btn {
  padding: 7px 15px; border-radius: 6px;
  background: rgba(180,130,50,0.28); border: 1px solid rgba(220,170,80,0.48);
  color: #f0d070; font-size: 12px; font-weight: 700; cursor: pointer;
  white-space: nowrap; transition: background 0.2s, border-color 0.2s; font-family: inherit;
}
.sv-bp-build-btn:hover { background: rgba(200,150,60,0.38); border-color: rgba(240,190,90,0.68); }
.sv-bp-build-btn:disabled { opacity: 0.35; cursor: default; }
.sv-bp-upgrade-btn {
  padding: 7px 15px; border-radius: 6px;
  background: rgba(60,140,100,0.22); border: 1px solid rgba(80,180,120,0.38);
  color: #80d0a0; font-size: 12px; font-weight: 700; cursor: pointer;
  white-space: nowrap; transition: background 0.2s; font-family: inherit;
}
.sv-bp-upgrade-btn:hover { background: rgba(80,160,120,0.32); }
.sv-bp-upgrade-btn:disabled { opacity: 0.35; cursor: default; }
.sv-bp-lv-badge {
  background: rgba(80,180,80,0.18); border: 1px solid rgba(80,180,80,0.35);
  color: #80c880; border-radius: 12px; padding: 4px 10px;
  font-size: 11px; font-weight: 700; white-space: nowrap;
}

/* Occupied building detail */
.sv-occ-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.sv-occ-emoji { font-size: 34px; flex-shrink: 0; }
.sv-occ-name  { font-size: 16px; font-weight: 700; color: #e8d090; }
.sv-occ-lv    { font-size: 12px; color: rgba(200,180,120,0.65); margin-top: 3px; }
.sv-occ-desc  { font-size: 12px; color: rgba(200,180,140,0.72); line-height: 1.5; margin-bottom: 14px; }
.sv-occ-flavor{ font-size: 11px; color: rgba(180,160,120,0.55); font-style: italic; text-align: center; margin-top: 12px; line-height: 1.4; }
  `;
  document.head.appendChild(s);
}

// ── DOM bootstrap ─────────────────────────────────────────────────────────────────────────────
function _ensureSvDOM() {
  _injectSvStyles();
  if (_svDOMBuilt) return;
  _svDOMBuilt = true;

  let root = document.getElementById('settlement-view');
  if (!root) {
    root = document.createElement('div');
    root.id = 'settlement-view';
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <div class="sv-scene" id="sv-scene">
      <div class="sv-layer sv-bg" id="sv-layer-bg">
        ${_bgSvg()}
      </div>
      <div class="sv-layer" id="sv-layer-mid">
        ${_midSvg()}
        <div class="sv-area-divider"></div>
        <div class="sv-area-label town">Town</div>
        <div class="sv-area-label outskirts">Outskirts</div>
      </div>
      <div class="sv-layer" id="sv-layer-fg">
        ${SV_SLOTS.map(slot => `
          <div class="sv-slot" id="sv-slot-${slot.id}"
               style="left:${slot.x}%;top:${slot.y}%"
               data-slot="${slot.id}"></div>
        `).join('')}
      </div>
    </div>

    <div class="sv-header">
      <button class="sv-back-btn" onclick="closeSettlementView()">&#x2190; Map</button>
      <span class="sv-header-title" id="sv-title">Settlement</span>
    </div>

    <div class="sv-build-panel" id="sv-build-panel"></div>
  `;

  document.getElementById('sv-scene').addEventListener('click', e => {
    if (!e.target.closest('.sv-slot') && !e.target.closest('.sv-build-panel')) {
      _closeBuildPanel();
    }
  });
}

// ── SVG scene art ─────────────────────────────────────────────────────────────────────────────
function _bgSvg() {
  const trees = Array.from({ length: 37 }, (_, i) => {
    const x = i * 28;
    const h = 38 + Math.sin(i * 0.7) * 14;
    const w = 17 + Math.sin(i * 0.9) * 3;
    const y = 340;
    return `<polygon points="${x},${y} ${x - w/2},${y - h*0.55} ${x - w/3},${y - h*0.55} ${x - w/4},${y - h} ${x + w/4},${y - h} ${x + w/3},${y - h*0.55} ${x + w/2},${y - h*0.55}" fill="#2a5824" opacity="0.88"/>`;
  }).join('');

  return `<svg class="sv-bg-svg" viewBox="0 0 1000 380" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="0,380 110,190 215,285 335,155 440,255 558,172 658,272 778,138 878,235 1000,175 1000,380" fill="#263650" opacity="0.72"/>
    <polygon points="0,380 55,265 175,335 295,215 415,302 532,232 638,308 758,200 875,292 1000,245 1000,380" fill="#1c2838" opacity="0.88"/>
    ${trees}
    <path d="M0,368 Q250,350 500,358 Q750,366 1000,352 L1000,380 L0,380Z" fill="#5a8040" opacity="0.92"/>
    <path d="M0,378 Q300,370 600,375 Q800,378 1000,372 L1000,380 L0,380Z" fill="#6a9050" opacity="0.85"/>
  </svg>`;
}

function _midSvg() {
  return `<svg class="sv-mid-svg" viewBox="0 0 1000 480" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M-60,480 Q90,310 290,335 Q445,356 555,388 L555,480Z" fill="#6a9852" opacity="0.72"/>
    <path d="M495,480 Q615,350 755,370 Q875,386 1060,370 L1060,480Z" fill="#78a860" opacity="0.68"/>
    <path d="M180,480 Q265,428 328,408 Q415,388 500,396 Q585,404 644,416 Q708,430 770,480"
          stroke="rgba(195,170,110,0.38)" stroke-width="20" fill="none" stroke-linecap="round"/>
    <path d="M830,480 Q848,440 862,410 Q878,378 908,362 Q938,348 968,338 Q990,328 1060,318"
          stroke="rgba(90,155,215,0.32)" stroke-width="16" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// ── Open / close ──────────────────────────────────────────────────────────────────────────────
async function openSettlementView() {
  _ensureSvDOM();
  _svOpen = true;
  _svSelectedSlot = null;

  const root = document.getElementById('settlement-view');
  root.style.display = 'flex';
  root.offsetHeight;
  root.classList.add('sv-visible');

  const titleEl = document.getElementById('sv-title');
  if (titleEl && window.gameData?.settlement?.name) {
    titleEl.textContent = gameData.settlement.name;
  }

  _bindParallax();
  const _svNav = document.getElementById('main-nav');
  if (_svNav) _svNav.style.zIndex = '900';
  await _svLoad();
}
window.openSettlementView = openSettlementView;

function closeSettlementView() {
  _svOpen = false;
  _closeBuildPanel();
  _unbindParallax();
  const _svNav = document.getElementById('main-nav');
  if (_svNav) _svNav.style.zIndex = '';
  const root = document.getElementById('settlement-view');
  root.classList.remove('sv-visible');
  root.addEventListener('transitionend', () => {
    if (!_svOpen) root.style.display = 'none';
  }, { once: true });
}
window.closeSettlementView = closeSettlementView;

// ── Data loading ──────────────────────────────────────────────────────────────────────────────
async function _svLoad() {
  try {
    const res = await apiFetch('/api/buildings');
    if (!res.ok) return;
    const data = await res.json();
    _svBuildings = data.buildings || [];
  } catch(e) {
    _svBuildings = [];
  }
  _renderScene();
}

async function refreshSettlementView() {
  if (!_svOpen) return;
  await _svLoad();
}
window.refreshSettlementView = refreshSettlementView;

// ── Scene rendering ─────────────────────────────────────────────────────────────────────────────
function _renderScene() {
  for (const slot of SV_SLOTS) {
    const el = document.getElementById('sv-slot-' + slot.id);
    if (!el) continue;
    el.innerHTML = '';
    el.onclick = null;

    const occupant = _occupantFor(slot);
    if (occupant) {
      el.appendChild(_buildOccupiedEl(slot, occupant));
      el.onclick = () => _openBuildPanel(slot, occupant);
    } else {
      const anyAvail = slot.accepts.some(id => {
        const b = _svBuildings.find(b => b.id === id);
        return b && b.currentLevel === 0 && b.requiresMet;
      });
      const allLocked = slot.accepts.every(id => {
        const b = _svBuildings.find(b => b.id === id);
        return !b || !b.requiresMet;
      });
      el.appendChild(_buildEmptyEl(slot, anyAvail, allLocked));
      if (anyAvail) el.onclick = () => _openBuildPanel(slot, null);
    }
  }
}

function _occupantFor(slot) {
  for (const id of slot.accepts) {
    const b = _svBuildings.find(b => b.id === id && b.currentLevel > 0);
    if (b) return b;
  }
  return null;
}

function _buildEmptyEl(slot, available, locked) {
  const div = document.createElement('div');
  div.className = `sv-slot-empty size-${slot.size}${locked ? ' locked' : ''}`;
  if (!available && !locked) div.style.cursor = 'default';
  div.innerHTML = `
    <div class="sv-slot-ring">
      <span class="sv-slot-plus">${locked ? '🔒' : '+'}</span>
    </div>
    <div class="sv-slot-hint">${slot.label}</div>
  `;
  return div;
}

function _buildOccupiedEl(slot, building) {
  const vis = SV_VISUALS[building.id] || { emoji:'🏙', bodyColor:'#555', roofColor:'#333' };
  const sz  = { lg:{w:64,h:52,rw:72}, md:{w:52,h:44,rw:58}, sm:{w:40,h:36,rw:46} }[slot.size] || { w:52,h:44,rw:58 };
  const roofH = Math.round(sz.h * 0.44);

  const div = document.createElement('div');
  div.className = 'sv-building';
  div.innerHTML = `
    <div class="sv-building-struct" style="width:${sz.w}px;height:${sz.h}px;background:${vis.bodyColor}">
      <div class="sv-building-roof" style="border-width:0 ${sz.rw/2}px ${roofH}px ${sz.rw/2}px;border-bottom-color:${vis.roofColor}"></div>
      <span class="sv-building-emoji">${vis.emoji}</span>
    </div>
    <div class="sv-building-shadow"></div>
    <div class="sv-building-name">${building.label}</div>
    ${building.currentLevel > 1 ? `<div class="sv-building-lv">Lv ${building.currentLevel}</div>` : ''}
  `;
  return div;
}

// ── Build panel ────────────────────────────────────────────────────────────────────────────────
function _openBuildPanel(slot, occupant) {
  _svSelectedSlot = slot;
  const panel = document.getElementById('sv-build-panel');
  const areaTag = slot.area === 'town' ? 'Town' : 'Outskirts';

  let html = `
    <div class="sv-bp-header">
      <span class="sv-bp-loc">${slot.label}</span>
      <span class="sv-bp-tag ${slot.area}">${areaTag}</span>
      <button class="sv-bp-close" onclick="_closeBuildPanel()">×</button>
    </div>`;

  if (occupant) {
    const vis    = SV_VISUALS[occupant.id] || { emoji:'🏙', flavor:'' };
    const isMax  = occupant.currentLevel >= occupant.maxLevel;
    const costStr = occupant.cost
      ? Object.entries(occupant.cost).map(([r, v]) => `${_resIcon(r)} ${v}`).join('  ')
      : '';
    html += `
      <div class="sv-occ-head">
        <span class="sv-occ-emoji">${vis.emoji}</span>
        <div>
          <div class="sv-occ-name">${occupant.label}</div>
          <div class="sv-occ-lv">Level ${occupant.currentLevel} / ${occupant.maxLevel}</div>
        </div>
        ${isMax
          ? `<span class="sv-bp-lv-badge" style="margin-left:auto">★ MAX</span>`
          : `<button class="sv-bp-upgrade-btn" style="margin-left:auto" onclick="_svBuild('${occupant.id}')">&#x2191; Upgrade${costStr ? ' — ' + costStr : ''}</button>`
        }
      </div>
      <div class="sv-occ-desc">${occupant.desc || ''}</div>
      <div class="sv-occ-flavor">${vis.flavor || ''}</div>`;
  } else {
    const opts = slot.accepts.map(id => {
      const b   = _svBuildings.find(b => b.id === id);
      if (!b) return '';
      const vis = SV_VISUALS[id] || { emoji:'🏙' };
      const costStr = b.cost
        ? Object.entries(b.cost).map(([r, v]) => `${_resIcon(r)} ${v}`).join('  ')
        : 'Free';
      if (b.requiresMet && b.currentLevel === 0) {
        return `<div class="sv-bp-opt available">
          <span class="sv-bp-emoji">${vis.emoji}</span>
          <div class="sv-bp-info">
            <div class="sv-bp-name">${b.label}</div>
            <div class="sv-bp-desc">${b.desc || ''}</div>
            <div class="sv-bp-cost">${costStr}</div>
          </div>
          <div class="sv-bp-action">
            <button class="sv-bp-build-btn" onclick="_svBuild('${id}')">Build</button>
          </div>
        </div>`;
      }
      if (!b.requiresMet) {
        return `<div class="sv-bp-opt locked">
          <span class="sv-bp-emoji">${vis.emoji}</span>
          <div class="sv-bp-info">
            <div class="sv-bp-name">${b.label}</div>
            <div class="sv-bp-desc">Requires other buildings first.</div>
          </div>
          <span style="font-size:18px">🔒</span>
        </div>`;
      }
      return '';
    }).join('');

    html += `<div class="sv-bp-options">${opts || '<div style="color:rgba(200,180,140,0.45);font-size:13px;text-align:center;padding:14px 0">Nothing to construct here yet.</div>'}</div>`;
  }

  panel.innerHTML = html;
  panel.classList.add('open');
}

function _closeBuildPanel() {
  document.getElementById('sv-build-panel')?.classList.remove('open');
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

// ── Resource icon helper ─────────────────────────────────────────────────────────────────────────────
function _resIcon(res) {
  return { food:'🌿', timber:'🌲', stone:'🪨', metal:'⚙️', wealth:'🪙' }[res] || res;
}

// ── Parallax ──────────────────────────────────────────────────────────────────────────────────
function _onParallaxMove(e) {
  const scene = document.getElementById('sv-scene');
  if (!scene) return;
  const r = scene.getBoundingClientRect();
  _svTargetX = ((e.clientX - r.left) / r.width  - 0.5) * 2;
  _svTargetY = ((e.clientY - r.top)  / r.height - 0.5) * 2;
  if (!_svRafId) _svRafId = requestAnimationFrame(_tickParallax);
}

function _tickParallax() {
  _svRafId = null;
  if (!_svOpen) return;
  const lerp = 0.07;
  _svCurX += (_svTargetX - _svCurX) * lerp;
  _svCurY += (_svTargetY - _svCurY) * lerp;

  const bg  = document.getElementById('sv-layer-bg');
  const mid = document.getElementById('sv-layer-mid');
  const fg  = document.getElementById('sv-layer-fg');
  if (bg)  bg.style.transform  = `translate(${_svCurX * 5}px, ${_svCurY * 3}px)`;
  if (mid) mid.style.transform = `translate(${_svCurX * 10}px, ${_svCurY * 6}px)`;
  if (fg)  fg.style.transform  = `translate(${_svCurX * 16}px, ${_svCurY * 9}px)`;

  if (Math.abs(_svTargetX - _svCurX) > 0.001 || Math.abs(_svTargetY - _svCurY) > 0.001) {
    _svRafId = requestAnimationFrame(_tickParallax);
  }
}

function _bindParallax() {
  document.getElementById('sv-scene')?.addEventListener('mousemove', _onParallaxMove);
}

function _unbindParallax() {
  document.getElementById('sv-scene')?.removeEventListener('mousemove', _onParallaxMove);
  if (_svRafId) { cancelAnimationFrame(_svRafId); _svRafId = null; }
  _svCurX = _svCurY = _svTargetX = _svTargetY = 0;
}
