// ══════════════════════════════════════════════════════════════════════════
//  Settings modal — tabs + the Graphics tab (map & atmosphere settings).
//
//  The modal lives in index.html (#settings-backdrop); audio.js opens it and
//  fills the Audio tab, then calls KWSettingsPanel.refresh() so the Graphics
//  controls show current state. Listeners are attached once; every control
//  writes through its owner, which persists it:
//    Map view          KWMap.controller.setRenderer   (kw_map_view)
//    Night lighting    KWDaylight.setSetting          (kw_night_lighting)
//    Reduce detail     KWMap.perf.setLowDetail        (kw_map_low_detail)
//    Drifting clouds   KWMap.atmosphere.setClouds     (kw_map_clouds)
//    Colour grading /  SeasonAtmosphere.setAtmosphere / setParticles
//    particles
//    Away summary      KWAwayReport.setEnabled         (kw_away_splash)
//  A row whose owner isn't loaded is hidden.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const LS_TAB = 'kw_settings_tab';
  let _wired = false;

  function _card() { return root.document.getElementById('settings-backdrop'); }
  function _q(sel) { const c = _card(); return c ? c.querySelector(sel) : null; }
  function _qa(sel) { const c = _card(); return c ? Array.prototype.slice.call(c.querySelectorAll(sel)) : []; }
  function _show(el, on) { const row = el && (el.closest('.settings-line') || el); if (row) row.style.display = on ? '' : 'none'; }

  function switchTab(id) {
    _qa('[data-settings-tab]').forEach(b => b.classList.toggle('active', b.dataset.settingsTab === id));
    _qa('[data-settings-panel]').forEach(p => { p.style.display = p.dataset.settingsPanel === id ? '' : 'none'; });
    try { root.localStorage.setItem(LS_TAB, id); } catch (e) {}
    if (id === 'graphics' || id === 'general') refresh();
  }

  function _wire() {
    if (_wired) return;
    _wired = true;
    const sel = _q('[data-kwmap-view]');
    if (sel) sel.addEventListener('change', () => {
      // setRenderer keeps the shared camera {q,r} → focus preserved (§12.9),
      // persists kw_map_view, invalidates + renders one frame.
      if (root.KWMap && root.KWMap.controller) root.KWMap.controller.setRenderer(sel.value);
    });
    const low = _q('[data-kwmap-setting="lowdetail"]');
    if (low) low.addEventListener('change', () => { if (root.KWMap && root.KWMap.perf) root.KWMap.perf.setLowDetail(low.checked); });
    const clouds = _q('[data-kwmap-setting="clouds"]');
    if (clouds) clouds.addEventListener('change', () => { if (root.KWMap && root.KWMap.atmosphere) root.KWMap.atmosphere.setClouds(clouds.checked); });
    const night = _q('[data-daylight-setting]');
    if (night) night.addEventListener('change', () => { if (root.KWDaylight) root.KWDaylight.setSetting(night.value); });
    const away = _q('[data-away-setting]');
    if (away) away.addEventListener('change', () => { if (root.KWAwayReport) root.KWAwayReport.setEnabled(away.checked); });
    _qa('[data-atmo-setting]').forEach(input => input.addEventListener('change', () => {
      const A = root.SeasonAtmosphere;
      if (!A) return;
      if (input.dataset.atmoSetting === 'atmosphere') A.setAtmosphere(input.checked);
      else A.setParticles(input.checked);
    }));
  }

  // Show current values; hide rows whose owner isn't loaded.
  function refresh() {
    _wire();
    const KW = root.KWMap, ctl = KW && KW.controller;
    const sel = _q('[data-kwmap-view]');
    if (sel) { _show(sel, !!ctl); if (ctl) sel.value = ctl.activeId || 'topdown'; }
    const low = _q('[data-kwmap-setting="lowdetail"]');
    if (low) { _show(low, !!(KW && KW.perf)); if (KW && KW.perf) low.checked = !!KW.perf.lowDetail; }
    const clouds = _q('[data-kwmap-setting="clouds"]');
    if (clouds) { _show(clouds, !!(KW && KW.atmosphere)); if (KW && KW.atmosphere) clouds.checked = !!KW.atmosphere.clouds; }
    const night = _q('[data-daylight-setting]');
    if (night) { _show(night, !!root.KWDaylight); if (root.KWDaylight) night.value = root.KWDaylight.setting(); }
    const away = _q('[data-away-setting]');
    if (away) { _show(away, !!root.KWAwayReport); if (root.KWAwayReport) away.checked = root.KWAwayReport.enabled(); }
    const A = root.SeasonAtmosphere;
    _qa('[data-atmo-setting]').forEach(input => {
      _show(input, !!A);
      if (A) input.checked = !!A.settings[input.dataset.atmoSetting];
    });
  }

  // Called by audio.js's openSettingsPopover: restore the last tab.
  function onOpen() {
    let tab = 'audio';
    try { tab = root.localStorage.getItem(LS_TAB) || 'audio'; } catch (e) {}
    switchTab(tab === 'graphics' || tab === 'general' ? tab : 'audio');
    refresh();
  }

  root.KWSettingsPanel = { switchTab, refresh, onOpen };
  root.settingsSwitchTab = switchTab;
})(typeof window !== 'undefined' ? window : this);
