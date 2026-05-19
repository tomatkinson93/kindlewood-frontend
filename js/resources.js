// ══════════════════════════════════════════════════════════════════════════
//  RESOURCE UI — floater, hover tooltip, breakdown modal
//
//  Three independent features sharing one data source (the
//  /api/game/resource-breakdown endpoint):
//
//    1. Floaters: when a resource's INTEGER value increments (which
//       happens every (3600/rate) seconds — e.g. once per ~75s at 48/hr),
//       a small "+N" floats up out of the topbar and fades. The trigger
//       is integer change, not the per-second sub-pixel add — players
//       only care when the displayed number actually moves. Negative
//       deltas show in red; positive in green. (Currently the rate is
//       always non-negative because there's no consumption logic, but
//       the red path exists so it just works when consumption arrives.)
//
//    2. Hover tooltip: hovering a resource cell shows a small popover
//       summarising "Buildings: +X · Citizens: +Y · Season: ±Z". Light-
//       weight, fetched once per visit and cached for 30s.
//
//    3. Click modal: full breakdown with per-source rows and citizen
//       drill-down. Clicking a citizen name closes this modal and opens
//       the citizen modal so the player can reassign there. We do NOT
//       put reassignment UI in this modal — two control surfaces for
//       one action invites state-sync bugs.
//
//  No reactive updates: the breakdown reflects the moment-in-time state
//  when the modal opens. If the player assigns a citizen mid-view, they
//  close and re-open to see the new numbers. That's an acceptable
//  trade-off for v1 — live updates would need either polling or a new
//  SSE event type, and the current modal is a "browse" view, not a
//  "monitor" view.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const RM_RESOURCE_IDS = ['food', 'timber', 'stone', 'metal', 'wealth'];
// Image URLs match the icons already in the topbar (index.html uses these
// paths). Keeping a string-keyed mapping rather than reaching into the DOM
// because we render icons inside dynamically-built HTML where pulling from
// existing img tags would be awkward.
const RM_RESOURCE_ICON_SRC = {
  food:   '/assets/foodicon.png',
  timber: '/assets/woodicon.png',
  stone:  '/assets/stoneicon.png',
  metal:  '/assets/metalicon.png',
  wealth: '/assets/goldicon.png',
};
// Small helper so the same <img> shape is used everywhere. Inline width/
// height because the modal CSS doesn't have a rule for it yet — easy to
// promote into a real class later.
function _resIcon(resId, size = 16) {
  const src = RM_RESOURCE_ICON_SRC[resId] || '';
  return `<img src="${src}" alt="${resId}" style="width:${size}px;height:${size}px;vertical-align:middle;image-rendering:pixelated">`;
}
const RM_RESOURCE_LABELS = {
  food: 'Food', timber: 'Timber', stone: 'Stone', metal: 'Metal', wealth: 'Wealth',
};

// ── Floater ────────────────────────────────────────────────────────────────
// Track the last-displayed integer per resource so we can detect a flip.
// Initialised lazily on first tick; null means "no baseline yet, just record
// current and don't spawn anything." That prevents a spurious floater on
// page load when tickResources jumps from undefined → whatever.
const _lastInt = { food: null, timber: null, stone: null, metal: null, wealth: null };

function _spawnFloater(resId, delta) {
  if (!delta) return;
  const anchor = document.getElementById('res-' + resId);
  if (!anchor) return;

  // Append the floater INSIDE the resource cell, not on <body>. The
  // earlier approach (fixed-positioning on body, coords from the cell's
  // getBoundingClientRect) rendered as if the floater was painted under
  // the topbar — the topbar uses backdrop-filter, which creates a
  // stacking context that captured the rendering region. Floaters
  // positioned in body-space at topbar-area coordinates didn't appear
  // even with z-index 9999 because they were stacking against the
  // topbar's context from outside it.
  //
  // Putting the floater inside the cell solves that and a follow-on
  // problem: position: absolute inside the cell naturally follows the
  // cell if the topbar reflows or scrolls, where position: fixed at
  // spawn-time coords would have stuck to a stale position.
  //
  // The cell needs position: relative so the absolute child is positioned
  // against IT. We set it here defensively; if the page CSS already has
  // it, this is a no-op.
  if (getComputedStyle(anchor).position === 'static') {
    anchor.style.position = 'relative';
  }
  // The cell needs overflow: visible too, otherwise the floater clips at
  // the cell boundary. Same defensive-set.
  if (getComputedStyle(anchor).overflow === 'hidden') {
    anchor.style.overflow = 'visible';
  }

  const el = document.createElement('div');
  el.className = 'resource-floater';
  el.textContent = (delta > 0 ? '+' : '') + delta;
  el.style.color = delta > 0 ? '#6fbf5e' : '#e07a6a';
  el.style.position = 'absolute';
  // Horizontally: 70% (not 50%) so the floater appears to the right of
  // the number rather than directly on top of it. The cell layout is
  // [icon][number][+rate], so center-of-cell ≈ center-of-number which
  // is exactly where we DON'T want the floater. 70% lands past the
  // number, near or just past the rate text. The keyframes still
  // translate(-50%) to centre the floater's own bounding box at that
  // anchor point.
  el.style.left = '70%';
  el.style.top = '50%';
  el.style.pointerEvents = 'none';
  el.style.fontWeight = '700';
  el.style.fontSize = '14px';
  el.style.textShadow = '0 1px 2px rgba(0,0,0,0.6)';
  el.style.zIndex = '20';   // above the cell content (which has no z-index)
  el.style.whiteSpace = 'nowrap'; // protect against wrapping for two-digit deltas
  el.style.animation = 'resource-floater-rise 1.6s ease-out forwards';
  anchor.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// Inject the @keyframes for the floater once. CSS lives in the page's
// stylesheet ideally, but inlining keeps this file self-contained — feel
// free to move .resource-floater + the keyframes into your CSS file.
function _ensureFloaterStyles() {
  if (document.getElementById('resource-floater-styles')) return;
  const style = document.createElement('style');
  style.id = 'resource-floater-styles';
  style.textContent = `
    @keyframes resource-floater-rise {
      /* Starts at the cell's vertical centre (top=startY in JS), small
         offset down to give the "burst out" feel. Rises ~28px which
         covers about half a topbar height, comfortably visible while
         not overlapping the next row of UI underneath. */
      0%   { opacity: 0; transform: translate(-50%, 6px) scale(0.9); }
      15%  { opacity: 1; transform: translate(-50%, 0)   scale(1.0); }
      70%  { opacity: 1; transform: translate(-50%, -22px); }
      100% { opacity: 0; transform: translate(-50%, -32px); }
    }
    .resource-cell { cursor: pointer; }
    .resource-cell:hover { filter: brightness(1.08); }
    .resource-tooltip {
      position: fixed; z-index: 9998; pointer-events: none;
      background: rgba(28, 22, 18, 0.96);
      border: 1px solid rgba(180, 140, 90, 0.4);
      border-radius: 6px; padding: 8px 10px;
      font-size: 12px; line-height: 1.4; color: #efe7d8;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      min-width: 180px; max-width: 260px;
    }
    .resource-tooltip-head {
      font-weight: 700; margin-bottom: 4px;
      border-bottom: 1px solid rgba(180,140,90,0.3); padding-bottom: 4px;
    }
    .resource-tooltip-row {
      display: flex; justify-content: space-between; gap: 12px;
    }
    .resource-tooltip-row-val { font-variant-numeric: tabular-nums; }
    .resource-tooltip-hint { opacity: 0.55; margin-top: 6px; font-style: italic; }
    /* Modal */
    #resource-modal {
      position: fixed; inset: 0; z-index: 9000;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55);
    }
    #resource-modal.open { display: flex; }
    .rm-panel {
      background: #2a201a; color: #efe7d8;
      border: 2px solid rgba(180,140,90,0.5);
      border-radius: 10px; padding: 20px;
      width: min(560px, 92vw); max-height: 84vh;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6);
    }
    .rm-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 12px;
    }
    .rm-head-icon { font-size: 28px; }
    .rm-head-title { font-size: 20px; font-weight: 700; }
    .rm-head-total { margin-left: auto; font-size: 18px; font-variant-numeric: tabular-nums; }
    .rm-tabs {
      display: flex; gap: 4px; margin-bottom: 14px; flex-wrap: wrap;
    }
    .rm-tab {
      background: rgba(180,140,90,0.15);
      border: 1px solid transparent;
      color: #efe7d8;
      padding: 6px 10px; border-radius: 6px;
      font-size: 13px; cursor: pointer;
    }
    .rm-tab:hover { background: rgba(180,140,90,0.28); }
    .rm-tab.active {
      background: rgba(180,140,90,0.4);
      border-color: rgba(220,180,120,0.6);
    }
    .rm-source {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 4px;
      border-bottom: 1px solid rgba(180,140,90,0.18);
    }
    .rm-source:last-child { border-bottom: none; }
    .rm-source-icon { font-size: 18px; width: 22px; text-align: center; }
    .rm-source-label { flex: 1; }
    .rm-source-val { font-variant-numeric: tabular-nums; font-weight: 700; }
    .rm-source-val.positive { color: #8ecf7e; }
    .rm-source-val.negative { color: #e07a6a; }
    .rm-citizens {
      margin-top: 4px; margin-left: 32px;
      display: flex; flex-wrap: wrap; gap: 4px 8px;
      font-size: 12px;
    }
    .rm-citizen-link {
      color: #d4b878; cursor: pointer; text-decoration: underline dotted;
    }
    .rm-citizen-link:hover { color: #f0d090; }
    .rm-close {
      margin-top: 14px; width: 100%;
      background: rgba(180,140,90,0.3);
      border: 1px solid rgba(180,140,90,0.5);
      color: #efe7d8; padding: 8px; border-radius: 6px;
      cursor: pointer; font-size: 14px;
    }
    .rm-close:hover { background: rgba(180,140,90,0.45); }
    .rm-empty { padding: 12px; opacity: 0.6; text-align: center; }
  `;
  document.head.appendChild(style);
}

// Called once per second by the existing resource tick loop. Compares the
// new integer value against the last and spawns a floater on change.
// (Exported on window so game.js's updateTopbarDisplay can call it without
// taking a require dependency on this file.)
function checkResourceFloaters(tickResources) {
  if (!tickResources) return;
  for (const id of RM_RESOURCE_IDS) {
    const cur = Math.floor(tickResources[id] ?? 0);
    const prev = _lastInt[id];
    if (prev === null) {
      _lastInt[id] = cur;
      continue;
    }
    if (cur !== prev) {
      _spawnFloater(id, cur - prev);
      _lastInt[id] = cur;
    }
  }
}
window.checkResourceFloaters = checkResourceFloaters;

// Called when the player's resources are reset by a server sync (the 5-min
// sync, or a deliberate refresh). Without this, the next tick after a sync
// would diff against the stale local baseline and spawn a spurious floater
// for the offline accumulation. We don't want a "+8,432 food" floater
// every time the player logs back in.
function resetResourceFloaterBaseline(tickResources) {
  if (!tickResources) {
    for (const id of RM_RESOURCE_IDS) _lastInt[id] = null;
    return;
  }
  for (const id of RM_RESOURCE_IDS) {
    _lastInt[id] = Math.floor(tickResources[id] ?? 0);
  }
}
window.resetResourceFloaterBaseline = resetResourceFloaterBaseline;


// ── Breakdown data cache ───────────────────────────────────────────────────
// Small TTL cache so hovering five resources in quick succession doesn't
// fire five fetches. 30 seconds is short enough that the numbers feel
// current; the modal re-fetches on open for a fresh-than-cache view.
let _breakdownCache = null;
let _breakdownCacheAt = 0;
const BREAKDOWN_TTL_MS = 30 * 1000;

async function _getBreakdown({ force = false } = {}) {
  if (!force && _breakdownCache && (Date.now() - _breakdownCacheAt) < BREAKDOWN_TTL_MS) {
    return _breakdownCache;
  }
  try {
    const r = await apiFetch('/api/game/resource-breakdown');
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.ok) return null;
    _breakdownCache = data;
    _breakdownCacheAt = Date.now();
    return data;
  } catch (e) { return null; }
}

// Force a cache refresh — call after actions that change rates (building
// constructed/upgraded, citizen reassigned, season changed). Cheap.
function invalidateResourceBreakdown() {
  _breakdownCache = null;
  _breakdownCacheAt = 0;
}
window.invalidateResourceBreakdown = invalidateResourceBreakdown;


// ── Hover tooltip ──────────────────────────────────────────────────────────
let _tooltipEl = null;
let _tooltipShownFor = null;

function _showTooltip(resId, anchorRect, data) {
  _hideTooltip();
  const bd = data.breakdown[resId];
  if (!bd) return;

  // Roll up by kind for the summary line. The modal shows every source;
  // the tooltip is just "where is it coming from at a glance".
  const sum = { species_base: 0, building: 0, citizen_role: 0, season_multiplier: 0 };
  for (const s of bd.sources) {
    if (s.kind === 'season_multiplier') sum.season_multiplier += s.delta || 0;
    else sum[s.kind] = (sum[s.kind] || 0) + (s.value || 0);
  }

  const rows = [];
  if (sum.species_base) rows.push(['Base', sum.species_base]);
  if (sum.building) rows.push(['Buildings', sum.building]);
  if (sum.citizen_role) rows.push(['Citizens', sum.citizen_role]);
  if (sum.season_multiplier) rows.push([data.season.name + ' ' + (data.season.emoji || ''), sum.season_multiplier]);

  const html = `
    <div class="resource-tooltip-head">${_resIcon(resId, 18)} ${RM_RESOURCE_LABELS[resId]} · ${bd.total}/hr</div>
    ${rows.map(([label, val]) => `
      <div class="resource-tooltip-row">
        <span>${label}</span>
        <span class="resource-tooltip-row-val" style="color:${val >= 0 ? '#8ecf7e' : '#e07a6a'}">
          ${val >= 0 ? '+' : ''}${val}
        </span>
      </div>
    `).join('')}
    <div class="resource-tooltip-hint">Click for citizen breakdown</div>
  `;

  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'resource-tooltip';
  _tooltipEl.innerHTML = html;
  document.body.appendChild(_tooltipEl);

  // Position below the resource cell. If that would go off the bottom of
  // the viewport, position above instead.
  const tipRect = _tooltipEl.getBoundingClientRect();
  let top = anchorRect.bottom + 6;
  if (top + tipRect.height > window.innerHeight - 8) {
    top = anchorRect.top - tipRect.height - 6;
  }
  let left = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
  _tooltipEl.style.top = top + 'px';
  _tooltipEl.style.left = left + 'px';
  _tooltipShownFor = resId;
}

function _hideTooltip() {
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
  _tooltipShownFor = null;
}


// ── Breakdown modal ────────────────────────────────────────────────────────
let _currentResourceTab = 'food';

function _ensureModalRoot() {
  let m = document.getElementById('resource-modal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'resource-modal';
  m.innerHTML = `
    <div class="rm-panel" role="dialog" aria-modal="true" aria-label="Resource breakdown">
      <div class="rm-head">
        <span class="rm-head-icon" id="rm-icon">🍖</span>
        <span class="rm-head-title" id="rm-title">Food</span>
        <span class="rm-head-total" id="rm-total">0/hr</span>
      </div>
      <div class="rm-tabs" id="rm-tabs"></div>
      <div id="rm-body"><div class="rm-empty">Loading…</div></div>
      <button class="rm-close" id="rm-close">Close</button>
    </div>
  `;
  document.body.appendChild(m);

  // Close on backdrop click, escape key, or button.
  m.addEventListener('click', (e) => { if (e.target === m) closeResourceModal(); });
  m.querySelector('#rm-close').addEventListener('click', closeResourceModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && m.classList.contains('open')) closeResourceModal();
  });
  return m;
}

function _renderTabs() {
  const tabs = document.getElementById('rm-tabs');
  tabs.innerHTML = RM_RESOURCE_IDS.map(id => `
    <button class="rm-tab ${id === _currentResourceTab ? 'active' : ''}" data-res="${id}">
      ${_resIcon(id, 16)} ${RM_RESOURCE_LABELS[id]}
    </button>
  `).join('');
  tabs.querySelectorAll('.rm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentResourceTab = btn.dataset.res;
      _renderModalBody();
      _renderTabs();
    });
  });
}

function _sourceIcon(kind, role) {
  if (kind === 'species_base') return '🏷';
  if (kind === 'building') return '🏛';
  if (kind === 'citizen_role') return '👥';
  if (kind === 'season_multiplier') return '🌿';
  return '•';
}

function _renderModalBody() {
  const data = _breakdownCache;
  if (!data) return;
  const res = _currentResourceTab;
  const bd = data.breakdown[res];
  if (!bd) {
    document.getElementById('rm-body').innerHTML = '<div class="rm-empty">No data.</div>';
    return;
  }

  // Header — innerHTML (not textContent) because the icon is an <img>
  document.getElementById('rm-icon').innerHTML = _resIcon(res, 28);
  document.getElementById('rm-title').textContent = RM_RESOURCE_LABELS[res];
  document.getElementById('rm-total').textContent = (bd.total >= 0 ? '+' : '') + bd.total + '/hr';

  // Sources
  const rows = bd.sources.map((s, i) => {
    const val = s.kind === 'season_multiplier' ? (s.delta || 0) : (s.value || 0);
    const cls = val >= 0 ? 'positive' : 'negative';
    let citizenHtml = '';
    if (s.kind === 'citizen_role' && Array.isArray(s.citizens) && s.citizens.length) {
      // Each citizen's name is clickable. We dispatch to the existing
      // citizen modal via window.openCitizenModal — falls back to a
      // console warn if not defined yet (project hasn't wired up that
      // entry point; harmless either way).
      citizenHtml = '<div class="rm-citizens">' + s.citizens.map(c =>
        `<span class="rm-citizen-link" data-citizen-id="${c.id}">${c.name}</span>`
      ).join('') + '</div>';
    }
    return `
      <div class="rm-source">
        <span class="rm-source-icon">${_sourceIcon(s.kind, s.role)}</span>
        <span class="rm-source-label">${s.label}</span>
        <span class="rm-source-val ${cls}">${val >= 0 ? '+' : ''}${val}</span>
      </div>
      ${citizenHtml}
    `;
  }).join('');

  document.getElementById('rm-body').innerHTML = rows;

  // Wire up citizen click → open citizen modal. We try a few likely
  // function names since I don't know what the project actually exposes;
  // first one that exists wins. If none exist we just log a hint so the
  // user can wire it up.
  document.getElementById('rm-body').querySelectorAll('.rm-citizen-link').forEach(span => {
    span.addEventListener('click', () => {
      const id = Number(span.dataset.citizenId);
      const handlers = [
        'openCitizenProfile',  // this project's actual handler (citizens.js:214)
        'openCitizenModal', 'showCitizenModal', 'viewCitizen',
        'openCitizen', '_openCitizenModal',
      ];
      for (const name of handlers) {
        if (typeof window[name] === 'function') {
          closeResourceModal();
          try { window[name](id); } catch(e) { console.error('[resources] citizen handler threw', e); }
          return;
        }
      }
      console.warn('[resources] no citizen modal handler found. Add e.g. window.openCitizenModal = ... and this link will work.');
    });
  });
}

async function openResourceModal(initialResId = 'food') {
  _ensureFloaterStyles();
  _ensureModalRoot();
  _currentResourceTab = RM_RESOURCE_IDS.includes(initialResId) ? initialResId : 'food';
  document.getElementById('rm-modal') || document.getElementById('resource-modal').classList.add('open');
  document.getElementById('resource-modal').classList.add('open');
  document.getElementById('rm-body').innerHTML = '<div class="rm-empty">Loading…</div>';
  _renderTabs();

  // Force a fresh fetch when the modal opens (cache is for hover tooltips,
  // not the modal). One extra fetch on click is fine.
  const data = await _getBreakdown({ force: true });
  if (!data) {
    document.getElementById('rm-body').innerHTML = '<div class="rm-empty">Could not load breakdown.</div>';
    return;
  }
  _renderModalBody();
}
window.openResourceModal = openResourceModal;

function closeResourceModal() {
  const m = document.getElementById('resource-modal');
  if (m) m.classList.remove('open');
}
window.closeResourceModal = closeResourceModal;


// ── Wire up the topbar cells ───────────────────────────────────────────────
// Idempotent: safe to call after every render. Tracks an "_rmBound" flag
// on the element to avoid double-binding listeners.
function bindResourceCells() {
  _ensureFloaterStyles();
  for (const id of RM_RESOURCE_IDS) {
    const el = document.getElementById('res-' + id);
    if (!el || el._rmBound) continue;
    el._rmBound = true;
    el.classList.add('resource-cell');

    // Click → modal
    el.addEventListener('click', () => openResourceModal(id));

    // Hover → tooltip. Small delay so passing the cursor across the topbar
    // doesn't spawn five tooltips. Cancellation on mouseleave.
    let hoverTimer = null;
    el.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(async () => {
        const data = await _getBreakdown();
        if (!data) return;
        // Re-check we're still hovered — async fetch may have taken a moment.
        if (el.matches(':hover')) {
          _showTooltip(id, el.getBoundingClientRect(), data);
        }
      }, 220);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      _hideTooltip();
    });
  }
}
window.bindResourceCells = bindResourceCells;

// Bind on DOMContentLoaded (covers initial page load), and offer a manual
// bind for callers that build the topbar later (e.g. after login). The
// helper is idempotent so calling it twice is fine.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindResourceCells);
} else {
  bindResourceCells();
}
