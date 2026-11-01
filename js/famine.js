// ══════════════════════════════════════════════════════════════════════════
//  FAMINE UI (frontend) — settlement warning banner
//
//  Driven entirely by the server's famine block on /api/game/settlement:
//    settlement.famine = { state, hours_to_empty, unfed_count,
//                          starving_count, upkeep_per_hour }
//    state ∈ 'ok' | 'low' | 'critical' | 'famine'
//
//  Wired in: index.html (#famine-banner over the map, famine.css, this
//  script), main.js loadGame() and game.js's 5-minute sync call
//  renderFamineBanner(settlement.famine).
//
//  Dev Tools (🍽 Famine banner, Resources tab): KWFamineDev.preview(state)
//  draws a sample banner in this browser only; KWFamineDev.live() goes back
//  to the server's numbers. A preview is marked "Preview" in the banner.
//
//  Purely a render layer — no thresholds are computed here, so the numbers
//  can be retuned server-side without touching this file.
// ══════════════════════════════════════════════════════════════════════════

function _famineHoursLabel(h) {
  if (h == null) return '';
  if (h < 1) return 'less than an hour';
  if (h < 48) return '~' + Math.round(h) + 'h';
  return '~' + Math.round(h / 24) + ' days';
}

let _famineLive = null;      // the server's last famine block
let _faminePreview = null;   // Dev Tools sample state, or null

function renderFamineBanner(famine) {
  _famineLive = famine || null;
  if (_faminePreview) return;   // a Dev Tools preview stays until "Back to live"
  _drawFamineBanner(famine, false);
}

function _drawFamineBanner(famine, preview) {
  const el = document.getElementById('famine-banner');
  if (!el) return;

  if (!famine || famine.state === 'ok') {
    el.className = 'famine-banner';
    el.innerHTML = '';
    return;
  }

  let icon, title, detail;
  if (famine.state === 'famine') {
    icon = '☠️';
    title = 'Famine';
    const parts = [];
    if (famine.unfed_count)    parts.push(famine.unfed_count + ' going hungry');
    if (famine.starving_count) parts.push(famine.starving_count + ' starving');
    detail = 'The stores are empty' + (parts.length ? ' — ' + parts.join(', ') : '') + '. Assign farmers or fishers, or trade for food.';
  } else if (famine.state === 'critical') {
    icon = '🍽';
    title = 'Food critical';
    detail = 'Stores empty in ' + _famineHoursLabel(famine.hours_to_empty) + ' at current rates.';
  } else { // low
    icon = '🌾';
    title = 'Stores dwindling';
    detail = _famineHoursLabel(famine.hours_to_empty) + ' of food remaining. Consider more farmers.';
  }

  el.className = 'famine-banner famine-' + famine.state + ' open';
  el.innerHTML =
    '<div class="famine-banner-inner" onclick="if(typeof openResourceModal===\'function\')openResourceModal(\'food\')" title="Open food breakdown">' +
      '<span class="famine-banner-icon">' + icon + '</span>' +
      '<span class="famine-banner-title">' + title + '</span>' +
      '<span class="famine-banner-detail">' + detail + '</span>' +
      (preview ? '<span class="famine-banner-preview" title="Dev Tools preview — only you see this">Preview</span>' : '') +
    '</div>';
  _placeFamineBanner();
}

// On phones the topbar floats over the map and its height varies (pills
// wrap), so tuck the banner just under it. Desktop keeps the CSS position.
function _placeFamineBanner() {
  const el = document.getElementById('famine-banner');
  if (!el || !el.style) return;
  const shell = document.body && document.body.classList && document.body.classList.contains('kw-shell');
  const bar = shell && document.querySelector && document.querySelector('#screen-game .topbar');
  const area = el.parentElement;
  if (!bar || !area || !area.getBoundingClientRect) { el.style.top = ''; return; }
  const below = bar.getBoundingClientRect().bottom + 4;
  el.style.top = Math.max(8, Math.round(below - area.getBoundingClientRect().top)) + 'px';
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', _placeFamineBanner);

// ── Dev Tools: show each banner without starving the town ──────────────
const FAMINE_SAMPLES = {
  low:      { state: 'low', hours_to_empty: 30 },
  critical: { state: 'critical', hours_to_empty: 5 },
  famine:   { state: 'famine', hours_to_empty: 0, unfed_count: 3, starving_count: 1 },
  ok:       { state: 'ok' },
};
const KWFamineDev = {
  preview(state) {
    const sample = FAMINE_SAMPLES[state];
    if (!sample) return;
    _faminePreview = state;
    _drawFamineBanner(sample, state !== 'ok');
    KWFamineDev.status();
  },
  live() {
    _faminePreview = null;
    _drawFamineBanner(_famineLive, false);
    KWFamineDev.status();
  },
  current() { return _faminePreview; },
  // The status line under the Dev Tools buttons.
  status() {
    const el = document.getElementById('cheat-famine-status');
    if (!el) return;
    const live = _famineLive && _famineLive.state ? _famineLive.state : 'ok';
    el.textContent = _faminePreview
      ? `Previewing "${_faminePreview}" (only in this browser). The town's real state: ${live}.`
      : `Showing the live state: ${live}.`;
  },
};

window.renderFamineBanner = renderFamineBanner;
window.KWFamineDev = KWFamineDev;
