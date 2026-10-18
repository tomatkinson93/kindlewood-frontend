// ══════════════════════════════════════════════════════════════════════════
//  KWHudClock — the topbar sun/moon dial (spec 021 §4.1).
//
//  A ~56px semicircular sky arc next to #season-badge. The sun travels it
//  during dawn → day → dusk (sunAt().arc), the moon during dusk → night →
//  dawn (moonAt().arc, drawn as its phase glyph); the sky fill follows
//  lighting(). Label = an in-world name for phase + progress (LABELS below).
//  Hover: hearth (UTC) time, the player's local time, moon and time left in
//  the phase. Click: a panel with the next 6 phase changes in local time,
//  this moon cycle, and "Upcoming Happenings" (filled in Phase 6 through
//  KWHudClock.setHappeningsProvider; an empty-state line until then).
//
//  Updates on KWClock.onChange plus a 30s tick — no per-frame loop.
//  dialSvg(ms, lighting) is pure (no DOM) so proofs can check its geometry.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const D = root.KWDayCycle;
  const TICK_MS = 30000;
  const TWEEN_SETTLE_MS = 2600;      // KWClock lighting tween is 2.5s

  // ── In-world names: first row whose phase matches and progress < to. ─────
  const LABELS = [
    { phase: 'dawn',  to: 1,    label: 'Morning' },
    { phase: 'day',   to: 0.35, label: 'Morning' },
    { phase: 'day',   to: 0.75, label: 'Midday' },
    { phase: 'day',   to: 1,    label: 'Evening' },
    { phase: 'dusk',  to: 1,    label: 'Evening' },
    { phase: 'night', to: 0.5,  label: 'Night' },
    { phase: 'night', to: 1,    label: 'Small hours' },
  ];
  const PHASE_NAMES = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

  function labelFor(ph) {
    for (const row of LABELS) if (row.phase === ph.phase && ph.progress < row.to) return row.label;
    return PHASE_NAMES[ph.phase] || ph.phase;
  }

  // ── Dial geometry (SVG user units) ───────────────────────────────────────
  const DIAL = { w: 56, h: 32, cx: 28, cy: 29, r: 22 };

  // Point on the arc for a 0..1 position, left → right over the top.
  function dialPoint(arc) {
    const th = Math.PI * (1 - arc);
    return { x: DIAL.cx + DIAL.r * Math.cos(th), y: DIAL.cy - DIAL.r * Math.sin(th) };
  }

  const DAY_SKY = [150, 196, 226];
  function skyColor(L) {
    const tmax = Math.max(1, L.tint[0], L.tint[1], L.tint[2]);
    const dim = Math.max(0.12, 1 - L.darkness * 1.15);
    return 'rgb(' + [0, 1, 2].map(i => {
      const tinted = DAY_SKY[i] + (L.tint[i] / tmax * 255 - DAY_SKY[i]) * L.tintStrength;
      return Math.round(tinted * dim);
    }).join(',') + ')';
  }

  const r2 = (v) => Math.round(v * 100) / 100;

  // Pure: the dial's SVG markup at ms (lighting defaults to lightingAt(ms)).
  function dialSvg(ms, lighting) {
    const L = lighting || D.lightingAt(ms);
    const sun = D.sunAt(ms), moon = D.moonAt(ms);
    const { w, h, cx, cy, r } = DIAL;
    let out = '<svg class="hc-dial" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
      '<path class="hc-sky" d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy + ' Z" fill="' + skyColor(L) + '"/>';
    if (L.darkness > 0.2) {      // a few stars once it's properly dark
      const a = r2(Math.min(1, (L.darkness - 0.2) / 0.3));
      [[16, 18], [25, 12], [37, 16], [42, 23], [20, 25]].forEach(([x, y]) => {
        out += '<circle class="hc-star" cx="' + x + '" cy="' + y + '" r="0.7" fill="#fff" opacity="' + a + '"/>';
      });
    }
    out += '<line class="hc-horizon" x1="2" y1="' + cy + '" x2="' + (w - 2) + '" y2="' + cy + '"/>';
    if (moon.up) {
      const p = dialPoint(moon.arc);
      out += '<text class="hc-moon" data-body="moon" data-arc="' + moon.arc + '" x="' + r2(p.x) + '" y="' + r2(p.y) +
        '" text-anchor="middle" dominant-baseline="central">' + moon.glyph + '</text>';
    }
    if (sun.up) {
      const p = dialPoint(sun.arc);
      out += '<circle class="hc-sun" data-body="sun" data-arc="' + sun.arc + '" cx="' + r2(p.x) + '" cy="' + r2(p.y) + '" r="4"/>';
    }
    return out + '</svg>';
  }

  // ── text helpers ─────────────────────────────────────────────────────────
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function utcHM(ms) { const d = new Date(ms); return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()); }
  function localHM(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return utcHM(ms); }
  }
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Two-line tooltip, e.g. at 01:42 UTC:
  //   Hearth time · 01:42 UTC · your time 9:42 PM
  //   🌔 Waxing gibbous · Night ends in 7h 18m
  function tooltip(ms) {
    const ph = D.phaseAt(ms), moon = D.moonAt(ms);
    return 'Hearth time · ' + utcHM(ms) + ' UTC · your time ' + localHM(ms) + '\n' +
      moon.glyph + ' ' + moon.name + ' · ' + PHASE_NAMES[ph.phase] + ' ends in ' + dur(ph.msToNext);
  }

  // The next n phase changes after ms: [{ phase, at }]. Each boundary is an
  // exact UTC hour from the phase table (phaseStartBefore), and phases are
  // walked in table order, so float error can't repeat a phase or land a
  // boundary a millisecond early.
  function upcoming(ms, n) {
    const out = [];
    let t = Math.floor(ms);
    let cur = D.phaseAt(t).phase;
    for (let i = 0; i < n; i++) {
      const next = D.PHASE_IDS[(D.PHASE_IDS.indexOf(cur) + 1) % D.PHASE_IDS.length];
      let at = D.phaseStartBefore(next, t);
      if (at <= t) at += 24 * 3600000;
      out.push({ phase: next, at });
      t = at; cur = next;
    }
    return out;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  let _el = null, _panel = null, _happenings = null, _timer = null, _settle = null;

  function _now() { return root.KWClock ? root.KWClock.now() : Date.now(); }
  function _lighting() { return root.KWClock ? root.KWClock.lighting() : null; }

  function render() {
    if (!_el) return;
    const ms = _now();
    const ph = D.phaseAt(ms);
    _el.innerHTML = dialSvg(ms, _lighting()) + '<span class="hc-label">' + esc(labelFor(ph)) + '</span>';
    _el.title = tooltip(ms);
    _el.setAttribute('aria-label', tooltip(ms).replace('\n', ' · '));
    if (_panel && _panel.classList.contains('open')) renderPanel();
  }

  function renderPanel() {
    const ms = _now();
    const ph = D.phaseAt(ms), moon = D.moonAt(ms);
    // Hearth (UTC) time first — it's the same for everyone; the player's own
    // clock alongside.
    const rows = '<div class="hc-row hc-row-head"><span></span><span>Hearth</span><span>Your time</span><span></span></div>' +
      upcoming(ms, 6).map(u =>
        '<div class="hc-row"><span>' + esc(PHASE_NAMES[u.phase]) + '</span><span class="hc-utc">' + utcHM(u.at) +
        '</span><span class="hc-local">' + esc(localHM(u.at)) + '</span><span class="hc-in">in ' + dur(u.at - ms) + '</span></div>').join('');
    const moons = D.MOON_GLYPHS.map((g, i) =>
      '<span class="hc-moon-cell' + (i === moon.index ? ' hc-today' : '') + '" title="' + esc(D.MOON_NAMES[i]) + '">' + g + '</span>').join('');
    let hap = '';
    try { hap = _happenings ? (_happenings(ms) || '') : ''; } catch (e) { hap = ''; }
    const inner = _panel.querySelector('.season-panel-inner');
    inner.innerHTML =
      '<div class="sp-header"><div class="sp-title"><span class="sp-emoji">' + (D.sunAt(ms).up ? '☀️' : moon.glyph) + '</span><div>' +
        '<div class="sp-season-name hc-title">' + esc(labelFor(ph)) + '</div>' +
        '<div class="sp-flavor">Hearth time ' + utcHM(ms) + ' UTC · your time ' + esc(localHM(ms)) + '</div></div></div>' +
        '<button class="sp-close" onclick="KWHudClock.close()">✕</button></div>' +
      '<div class="hc-section"><div class="sp-effects-label">Coming up</div>' + rows + '</div>' +
      '<div class="hc-section"><div class="sp-effects-label">This moon cycle</div><div class="hc-moons">' + moons + '</div>' +
        '<div class="hc-moon-name">' + moon.glyph + ' ' + esc(moon.name) + '</div></div>' +
      '<div class="hc-section"><div class="sp-effects-label">Upcoming Happenings</div><div id="hc-happenings">' +
        (hap || '<div class="hc-empty">No Happenings on the horizon.</div>') + '</div></div>';
  }

  function open() {
    if (!_panel) return;
    _panel.classList.add('open');
    renderPanel();
  }
  function close() { if (_panel) _panel.classList.remove('open'); }
  function toggle() { if (_panel && _panel.classList.contains('open')) close(); else open(); }

  // Phase 6 hook: fn(ms) → HTML for the Upcoming Happenings list ('' = empty).
  function setHappeningsProvider(fn) { _happenings = typeof fn === 'function' ? fn : null; render(); }

  function mount() {
    if (_el || !D) return;
    const doc = root.document;
    const badge = doc.getElementById('season-badge');
    if (!badge) return;
    _el = doc.createElement('button');
    _el.id = 'hud-clock';
    _el.className = 'hud-clock';
    _el.type = 'button';
    _el.addEventListener('click', toggle);
    badge.insertAdjacentElement('afterend', _el);

    _panel = doc.createElement('div');
    _panel.id = 'hud-clock-panel';
    _panel.className = 'season-panel hc-panel';
    _panel.innerHTML = '<div class="season-panel-inner kw-ornate-frame" onclick="event.stopPropagation()"></div>';
    _panel.addEventListener('click', close);
    doc.body.appendChild(_panel);

    if (root.KWClock) root.KWClock.onChange((ev) => {
      render();
      if (ev && ev.reason === 'override') {     // sky colour settles after the tween
        clearTimeout(_settle);
        _settle = setTimeout(render, TWEEN_SETTLE_MS);
      }
    });
    _timer = setInterval(render, TICK_MS);
    render();
  }

  root.KWHudClock = {
    LABELS, DIAL, labelFor, dialPoint, dialSvg, skyColor, tooltip, upcoming,
    mount, render, open, close, toggle, setHappeningsProvider,
  };

  if (root.document && !root.__KW_NO_AUTOSTART) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
})(typeof window !== 'undefined' ? window : this);
