// ══════════════════════════════════════════════════════════════════════════
//  KWTooltip — floating help tooltips for the admin "?" markers (.qa-tip).
//
//  The old CSS ::after tooltip lived inside the Dev Tools card, whose
//  overflow:hidden clipped it at the card's edges. This draws one shared
//  tooltip as a position:fixed element on <body>, above everything, clamped
//  to the viewport (and flipped above the marker when there's no room
//  below). Event delegation, so markers rendered later work too. The marker's
//  title moves to data-tip so the browser's own tooltip doesn't double up.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const SEL = '.qa-tip';
  const GAP = 6, MARGIN = 8;
  let _tip = null, _cur = null;

  function el() {
    if (_tip) return _tip;
    _tip = document.createElement('div');
    _tip.className = 'kw-float-tip';
    _tip.setAttribute('role', 'tooltip');
    document.body.appendChild(_tip);
    return _tip;
  }

  function textOf(m) {
    if (m.hasAttribute('title')) {           // adopt the title once
      m.setAttribute('data-tip', m.getAttribute('title'));
      m.removeAttribute('title');
    }
    return m.getAttribute('data-tip') || '';
  }

  // Pure placement: below the marker, centred; flipped above if it would
  // leave the viewport; clamped horizontally. → { left, top, above }
  function place(r, w, h, vw, vh) {
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    let top = r.bottom + GAP, above = false;
    if (top + h > vh - MARGIN && r.top - GAP - h >= MARGIN) { top = r.top - GAP - h; above = true; }
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    return { left, top, above };
  }

  function show(m) {
    const text = textOf(m);
    if (!text) return;
    const t = el();
    t.textContent = text;
    t.style.display = 'block';
    t.style.left = '0px'; t.style.top = '0px';
    const p = place(m.getBoundingClientRect(), t.offsetWidth, t.offsetHeight, root.innerWidth, root.innerHeight);
    t.style.left = Math.round(p.left) + 'px';
    t.style.top = Math.round(p.top) + 'px';
    _cur = m;
  }
  function hide() { if (_tip) _tip.style.display = 'none'; _cur = null; }

  function init() {
    document.body.classList.add('kw-tip-js');   // turns off the CSS ::after fallback
    document.addEventListener('mouseover', (e) => {
      const m = e.target.closest && e.target.closest(SEL);
      if (m && m !== _cur) show(m);
      else if (!m && _cur) hide();
    });
    document.addEventListener('focusin', (e) => { const m = e.target.closest && e.target.closest(SEL); if (m) show(m); });
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
    root.addEventListener('resize', hide);
  }

  root.KWTooltip = { place, show, hide };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
