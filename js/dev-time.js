// ══════════════════════════════════════════════════════════════════════════
//  Dev Tools → 🕯 Time tab (spec 021 §3.4). window.KWDevTime.
//
//  Live readout of KWClock + KWDaylight, and the override controls: Live ·
//  Dawn · Day · Dusk · Night · Fast cycle, an hour slider and a moon picker.
//  All controls go through KWClock.setOverride, which keeps the visual
//  override browser-local and, for admins, mirrors it to the server's
//  gameplay offset (2h TTL). The readout refreshes once a second while the
//  tab is visible and stops itself when it isn't.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  let _timer = null;

  const $ = (id) => root.document.getElementById(id);
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const PHASE_NAMES = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

  function utc(ms) {
    const d = new Date(ms);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }
  function local(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function row(label, value) {
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0">' +
      '<span style="color:rgba(192,221,151,.5)">' + esc(label) + '</span><span>' + value + '</span></div>';
  }

  function render() {
    const el = $('kw-time-readout');
    const C = root.KWClock;
    if (!el) return;
    if (!C) { el.textContent = 'KWClock not loaded.'; return; }
    const now = C.now(), wall = C.wallNow();
    const ph = C.phase(), sun = C.sun(), moon = C.moon();
    const ov = C.override(), me = C.me();
    const L = root.KWDaylight ? root.KWDaylight.state() : C.lighting();
    let season = '—';
    if (typeof calcSeasonAt === 'function') {
      const s = calcSeasonAt(wall);
      season = esc(s.emoji + ' ' + s.name) + ' · Year ' + s.year;
    }
    let srv = 'not signed in';
    if (me) {
      srv = me.isAdmin
        ? (me.debugOffsetMs
            ? (me.debugOffsetMs >= 0 ? '+' : '') + (me.debugOffsetMs / 3600000).toFixed(2) + 'h' +
              (me.debugExpiresAt ? ' · expires in ' + dur(me.debugExpiresAt - wall) : '')
            : 'none')
        : 'not admin (visual only)';
    }
    el.innerHTML =
      row('Hearth time (UTC)', utc(now) + (now !== wall ? ' <span style="opacity:.5">(real ' + utc(wall) + ')</span>' : '')) +
      row('Your local time', esc(local(now))) +
      row('Phase', esc(PHASE_NAMES[ph.phase] || ph.phase) + ' · ' + Math.round(ph.progress * 100) + '% · ' +
          esc(PHASE_NAMES[ph.nextPhase] || ph.nextPhase) + ' in ' + dur(ph.msToNext)) +
      row('Sun', sun.up ? 'up · elevation ' + sun.elevation.toFixed(2) : 'down') +
      row('Moon', moon.glyph + ' ' + esc(moon.name) + ' · ' + Math.round(moon.illumination * 100) + '% lit' + (moon.up ? ' · up' : '')) +
      row('Lighting', 'darkness ' + L.darkness.toFixed(2) + ' · lights ' + L.lightLevel.toFixed(2) +
          (root.KWDaylight ? ' · setting ' + esc(root.KWDaylight.setting()) : '')) +
      row('Season (real clock)', season) +
      row('Visual override', esc(ov.label) + (ov.expiresAt ? ' · expires in ' + dur(ov.expiresAt - wall) : '')) +
      row('Server gameplay offset', srv);

    const slider = $('kw-time-hour');
    if (slider && root.document.activeElement !== slider) slider.value = String(Math.floor(((now % 86400000) + 86400000) % 86400000 / 900000) / 4);
    const hv = $('kw-time-hour-val');
    if (hv && slider) hv.textContent = fmtHour(parseFloat(slider.value));
    const moons = $('kw-time-moons');
    if (moons) Array.prototype.forEach.call(moons.children, (b, i) => {
      b.style.borderColor = i === moon.index ? 'rgba(239,159,39,.7)' : '';
    });
  }

  function fmtHour(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return pad2(hh % 24) + ':' + pad2(mm) + ' UTC';
  }

  function _visible() {
    const p = $('ct-time'), m = $('cheat-modal');
    return !!(p && p.style.display !== 'none' && m && m.classList.contains('open'));
  }

  function _ensureMoons() {
    const box = $('kw-time-moons');
    if (!box || box.children.length || !root.KWDayCycle) return;
    const D = root.KWDayCycle;
    box.innerHTML = D.MOON_GLYPHS.map((g, i) =>
      '<button class="cheat-res-btn" style="text-align:center;font-size:16px;padding:4px 0" title="' + esc(D.MOON_NAMES[i]) +
      '" onclick="KWDevTime.set(\'moon:' + i + '\')">' + g + '</button>').join('');
  }

  function open() {
    _ensureMoons();
    render();
    if (_timer) return;
    _timer = setInterval(() => {
      if (!_visible()) { clearInterval(_timer); _timer = null; return; }
      render();
    }, 1000);
  }

  function set(spec) {
    if (root.KWClock) root.KWClock.setOverride(spec);
    render();
  }

  function hour(v) {
    const h = Math.min(23.99, Math.max(0, parseFloat(v) || 0));
    set('hour:' + h);
  }

  root.KWDevTime = { open, set, hour, render };
})(typeof window !== 'undefined' ? window : this);
