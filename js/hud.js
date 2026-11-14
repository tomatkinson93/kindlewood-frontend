// ══════════════════════════════════════════════════════════════════════════
//  KWHud — the top bar and the map's controls (docs/LAYOUT_SPEC.md §2.6,
//  §2.7, the layout mockup). Phase 4 step 4.
//
//  Top bar: the version string moves into Settings › General; the stores
//  chip reads "+N in Stores" (js/stores.js); on phones the resources scroll
//  sideways with wealth pinned at the end (css/hud.css).
//  The map: one stack at the lower left (lower right on phones): Centre on
//  town, Paths: on/off, and zoom where the view has it. The pan stick on
//  phones is a setting, off by default.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const call = (name, ...a) => { if (typeof global[name] === 'function') return global[name](...a); };

  // ── The map's controls ──────────────────────────────────────────────────
  function pathsLabel() {
    const b = doc.getElementById('map-paths-btn');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'false';
    let t = b.querySelector('.kwh-paths-t');
    if (!t) {
      // "🐾 <span>Paths</span> <n>" → "🐾 Paths: on <n>"
      const old = Array.prototype.find.call(b.querySelectorAll('span'), s => /^Paths$/.test(s.textContent.trim()));
      t = doc.createElement('span');
      t.className = 'kwh-paths-t';
      if (old) old.replaceWith(t); else b.appendChild(t);
    }
    t.textContent = on ? 'Paths: on' : 'Paths: off';
  }
  function buildStack() {
    const frame = doc.getElementById('map-frame');
    if (!frame || doc.getElementById('kw-map-stack')) return;
    const stack = doc.createElement('div');
    stack.id = 'kw-map-stack';
    stack.className = 'kwh-stack';
    stack.setAttribute('role', 'group');
    stack.setAttribute('aria-label', 'Map controls');
    const centre = doc.createElement('button');
    centre.type = 'button';
    centre.className = 'map-ctrl-btn kwh-btn';
    centre.id = 'kwh-centre';
    centre.textContent = 'Centre on town';
    centre.addEventListener('click', () => call('centreCamera'));
    stack.appendChild(centre);
    const paths = doc.getElementById('map-paths-btn');
    if (paths) { paths.classList.add('kwh-btn'); stack.appendChild(paths); }
    const zoom = doc.getElementById('map-zoom-ctrls');
    if (zoom) { zoom.classList.add('kwh-zoom'); stack.appendChild(zoom); }
    frame.appendChild(stack);
    pathsLabel();
    if (paths && global.MutationObserver) new MutationObserver(pathsLabel).observe(paths, { attributes: true, attributeFilter: ['aria-pressed'] });
  }

  // ── Settings › General: the pan stick and the version ───────────────────
  function buildSettings() {
    const general = doc.querySelector('[data-settings-panel="general"]');
    if (!general || general.querySelector('[data-stick-setting]')) return;
    const ver = (doc.querySelector('.topbar-version') || {}).textContent || '';
    general.insertAdjacentHTML('beforeend',
      '<div class="settings-eyebrow">The map</div>'
      + '<label class="settings-line"><span class="settings-line-text"><span class="settings-label">Pan stick on phones</span>'
      + '<span class="settings-hint">A thumb stick for moving the map. Dragging the map works without it.</span></span>'
      + '<input type="checkbox" class="settings-switch" data-stick-setting></label>'
      + (ver.trim() ? `<div class="settings-eyebrow">About</div><div class="settings-line kwh-version"><span class="settings-label">Kindlewood ${ver.trim().replace(/[<>&]/g, '')}</span></div>` : ''));
    const box = general.querySelector('[data-stick-setting]');
    box.checked = stickOn();
    box.addEventListener('change', () => { if (global.KWShell && global.KWShell.setStick) global.KWShell.setStick(box.checked); });
  }
  function stickOn() { try { return global.localStorage.getItem('kw-map-stick') === '1'; } catch (e) { return false; } }

  function boot() {
    buildStack();
    buildSettings();
    doc.body.classList.add('kwh-on');
  }
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot(); }

  global.KWHud = { pathsLabel, stickOn, _buildStack: buildStack };
})(typeof window !== 'undefined' ? window : globalThis);
