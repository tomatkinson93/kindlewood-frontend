// ══════════════════════════════════════════════════════════════════════════
//  FAMINE UI (frontend) — settlement warning banner
//
//  Driven entirely by the server's famine block on /api/game/settlement:
//    settlement.famine = { state, hours_to_empty, unfed_count,
//                          starving_count, upkeep_per_hour }
//    state ∈ 'ok' | 'low' | 'critical' | 'famine'
//
//  Wire-up (see PATCHES_frontend.md):
//    - index.html: <div id="famine-banner"></div> under the topbar,
//      plus famine.css link and this script.
//    - main.js loadGame(): renderFamineBanner(gameData?.settlement?.famine)
//      after gameData is set.
//    - game.js 5-min sync: same call with the fresh payload.
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

function renderFamineBanner(famine) {
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
    '</div>';
}

window.renderFamineBanner = renderFamineBanner;
