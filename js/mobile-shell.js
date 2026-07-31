/* ══════════════════════════════════════════════════════════════════════════
 * mobile-shell.js — Kindlewood mobile game shell
 * ══════════════════════════════════════════════════════════════════════════
 * Builds the phone layout for the game screen: a five-slot bottom tab bar, a
 * grouped "More" sheet replacing the 12-tab community bar, floating map
 * buttons, and an optional analog stick for panning. Styling lives in
 * css/mobile-shell.css.
 *
 * Design notes
 *  - Vanilla IIFE on window.KWShell, no modules (constraint 1).
 *  - Purely additive: it injects new DOM and reuses the game's existing entry
 *    points. It never removes or rewrites an existing handler.
 *  - The More sheet is built FROM the live .comm-btn elements and dispatches
 *    their own click(), so no navigation destination can be lost to a typo or
 *    drift in this file. Grouping is cosmetic; anything unrecognised still
 *    shows up, under "Other".
 *  - Panning goes through KWMap.controller.pan() — the same integer-axial
 *    path the mouse drag, arrows and keyboard already use (constraint 4).
 *  - The DOM is always built; css/mobile-shell.css hides it above 768px, so
 *    rotation and resizing need no teardown. Behaviour that would affect
 *    desktop is additionally gated on the media query at call time.
 * ══════════════════════════════════════════════════════════════════════════ */
(function (window, document) {
  'use strict';

  /* When the shell is on. A phone in landscape is ~915px WIDE but only ~412px
     tall, so a width-only test would hand it the desktop layout — hence the
     second clause. `pointer: coarse` keeps a merely-short desktop window on
     the desktop layout. This single query is the source of truth: it drives
     body.kw-shell, which is what every rule in mobile-shell.css keys off. */
  var SHELL_MQ = '(max-width: 768px), (max-height: 560px) and (pointer: coarse)';
  var MQ = window.matchMedia(SHELL_MQ);
  var STICK_KEY = 'kw-map-stick';
  var built = false;

  function isMobile() { return MQ.matches; }

  function syncShellClass() {
    document.body.classList.toggle('kw-shell', MQ.matches);
    if (!MQ.matches) closeSheets();   // don't leave a sheet open on desktop
  }

  /* Auto-opening the sheet must only ever follow a real user action.
     `_ready` blocks it during boot (main.js calls switchTab while setting the
     game up, which would otherwise raise a sheet over the map on arrival);
     `_mute` blocks the internal cascade when the Map tab runs navGoMap(),
     which itself calls switchTab('map') -> selectWorldTile(). */
  var _ready = false;
  var _mute = 0;

  function autoOpenAllowed() { return isMobile() && _ready && !_mute; }

  function muted(fn) {
    _mute++;
    try { fn(); } finally { _mute--; }
  }
  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ── Reading the existing nav ────────────────────────────────────────── */

  function labelFor(btn) {
    var s = btn.querySelector('span:not(.online-count)');
    var t = s ? s.textContent : btn.textContent;
    return (t || '').trim();
  }

  function iconFor(btn) {
    var svg = btn.querySelector('svg');
    if (svg) return svg.cloneNode(true);
    for (var n = btn.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.textContent.trim()) {
        return document.createTextNode(n.textContent.trim());
      }
    }
    return document.createTextNode('•');
  }

  // Which group each community-bar destination belongs to. Labels are matched
  // case-insensitively; anything not listed lands in "Other" rather than being
  // dropped. Map/Battles are omitted because they are their own tabs.
  var GROUP_OF = {
    quests: 'Adventure', decks: 'Adventure',
    inventory: 'Trade', market: 'Trade',
    rankings: 'Community', events: 'Community', messages: 'Community',
    chat: 'Community', online: 'Community',
    feedback: 'You'
  };
  var GROUP_ORDER = ['Places', 'Adventure', 'Trade', 'Community', 'You', 'Other'];
  var TAB_LABELS = { map: 1, battles: 1 };   // already on the tab bar

  // Extra destinations that aren't community-bar buttons. Each is skipped
  // silently if the function isn't present, so a missing feature can't break
  // the sheet.
  // Settlement and Scout are deliberately absent: Settlement is its own tab and
  // Scout is a floating map button, so listing them here would be duplication.
  var EXTRAS = [
    // Places are otherwise only reachable by finding their tile on the map or
    // going through the settlement panel.
    { group: 'Places', label: 'Tavern',  glyph: '🍺', fn: function () { window.visitTavern(); },      needs: 'visitTavern' },
    { group: 'Places', label: 'Fishing', glyph: '🎣', fn: function () { window.visitFishingPost(); }, needs: 'visitFishingPost' },
    { group: 'You',   label: 'Profile',    glyph: '👤', fn: function () { window.openProfile(); },           needs: 'openProfile' },
    { group: 'You',   label: 'Settings',   glyph: '⚙',       fn: function () { window.openSettingsPopover(); },   needs: 'openSettingsPopover' },
    { group: 'You',   label: 'Help',       glyph: '❓',       fn: function () { window.showCommunityTab('help'); },needs: 'showCommunityTab' }
  ];

  /* ── Sheets ─────────────────────────────────────────────────────────── */

  function sidebar() { return byId('sidebar'); }
  function moreSheet() { return byId('kw-more'); }

  function closeSheets() {
    var sb = sidebar(), ms = moreSheet();
    if (sb) sb.classList.remove('kw-open');
    if (ms) ms.classList.remove('kw-open');
  }

  function openSidebarSheet() {
    var sb = sidebar();
    if (!sb) return;
    var ms = moreSheet();
    if (ms) ms.classList.remove('kw-open');
    sb.classList.add('kw-open');
  }

  function openMoreSheet() {
    var ms = moreSheet(), sb = sidebar();
    if (!ms) return;
    if (sb) sb.classList.remove('kw-open');
    ms.classList.add('kw-open');
  }

  function setActiveTab(name) {
    var bar = byId('kw-tabbar');
    if (!bar) return;
    var tabs = bar.querySelectorAll('.kw-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === name);
    }
  }

  /* ── Build: More sheet ──────────────────────────────────────────────── */

  function buildMoreBody(body) {
    body.innerHTML = '';
    var buckets = {};
    GROUP_ORDER.forEach(function (g) { buckets[g] = []; });

    // From the live community bar — dispatch the real button's click.
    var commBtns = document.querySelectorAll('.community-bar .comm-btn');
    Array.prototype.forEach.call(commBtns, function (btn) {
      var label = labelFor(btn);
      var key = label.toLowerCase();
      if (!label || TAB_LABELS[key]) return;
      var group = GROUP_OF[key] || 'Other';
      buckets[group].push({
        label: label,
        icon: iconFor(btn),
        run: function () { btn.click(); }
      });
    });

    // Extras that live outside the community bar.
    EXTRAS.forEach(function (x) {
      if (x.needs && typeof window[x.needs] !== 'function') return;
      buckets[x.group].push({
        label: x.label,
        icon: document.createTextNode(x.glyph),
        run: x.fn,
        sheet: x.sheet
      });
    });

    GROUP_ORDER.forEach(function (gname) {
      var items = buckets[gname];
      if (!items.length) return;
      var grp = el('div', 'kw-grp');
      grp.appendChild(el('div', 'kw-grp-label', gname));
      var grid = el('div', 'kw-grid');
      items.forEach(function (it) {
        var b = el('button', 'kw-item');
        b.type = 'button';
        var g = el('span', 'kw-item-g');
        g.appendChild(it.icon);
        b.appendChild(g);
        b.appendChild(el('span', 'kw-item-t', it.label));
        b.addEventListener('click', function () {
          closeSheets();
          setActiveTab(it.sheet ? 'more' : 'map');
          try { it.run(); } catch (e) { /* never let one entry break the sheet */ }
          if (it.sheet) openSidebarSheet();
        });
        grid.appendChild(b);
      });
      grp.appendChild(grid);
      body.appendChild(grp);
    });

    // Map-stick toggle.
    var row = el('div', 'kw-grp');
    row.appendChild(el('div', 'kw-grp-label', 'Map'));
    var tg = el('div', 'kw-toggle-row');
    tg.appendChild(el('span', 'kw-tg-label', 'Pan stick'));
    var sw = el('div', 'kw-switch');
    sw.setAttribute('role', 'switch');
    sw.setAttribute('tabindex', '0');
    sw.setAttribute('aria-checked', String(stickEnabled()));
    var flip = function () {
      var next = !(sw.getAttribute('aria-checked') === 'true');
      sw.setAttribute('aria-checked', String(next));
      setStickEnabled(next);
    };
    sw.addEventListener('click', flip);
    sw.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    });
    tg.appendChild(sw);
    row.appendChild(tg);
    body.appendChild(row);
  }

  /* ── Build: shell DOM ───────────────────────────────────────────────── */

  var TABS = [
    { id: 'map',        glyph: '🗺', label: 'Map' },
    { id: 'settlement', glyph: '🏛', label: 'Settlement' },
    { id: 'citizens',   glyph: '🧍', label: 'Citizens' },
    { id: 'battles',    glyph: '⚔',       label: 'Battles' },
    { id: 'more',       glyph: '☰',       label: 'More' }
  ];

  function onTab(id) {
    switch (id) {
      case 'map':
        setActiveTab('map');
        // navGoMap -> switchTab('map') -> selectWorldTile(home); mute so that
        // internal chain can't re-raise the sheet we're about to close.
        muted(function () {
          if (typeof window.navGoMap === 'function') window.navGoMap();
        });
        closeSheets();
        break;
      case 'settlement':
        setActiveTab('settlement');
        if (typeof window.switchTab === 'function') window.switchTab('settlement');
        openSidebarSheet();
        break;
      case 'citizens':
        setActiveTab('citizens');
        if (typeof window.switchTab === 'function') window.switchTab('citizens');
        openSidebarSheet();
        break;
      case 'battles':
        // Opens a full-screen modal that covers the shell; leave the bar on Map
        // so it reads correctly once the modal closes.
        closeSheets();
        setActiveTab('map');
        if (typeof window.openBattlesModal === 'function') window.openBattlesModal();
        break;
      case 'more':
        setActiveTab('more');
        buildMoreBody(byId('kw-more-body'));
        openMoreSheet();
        break;
    }
  }

  function build() {
    if (built) return;
    var screen = byId('screen-game');
    if (!screen) return;
    built = true;

    /* Grab bar on the sidebar so it reads as a dismissable sheet. */
    var sb = sidebar();
    if (sb && !sb.querySelector('.kw-grab')) {
      var grab = el('div', 'kw-grab');
      grab.setAttribute('role', 'button');
      grab.setAttribute('tabindex', '0');
      grab.setAttribute('aria-label', 'Close panel');
      grab.addEventListener('click', function () { closeSheets(); setActiveTab('map'); });
      grab.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeSheets(); setActiveTab('map'); }
      });
      sb.insertBefore(grab, sb.firstChild);
    }

    /* More sheet. */
    var sheet = el('div', 'kw-sheet');
    sheet.id = 'kw-more';
    var sGrab = el('div', 'kw-grab');
    sGrab.addEventListener('click', function () { closeSheets(); setActiveTab('map'); });
    sheet.appendChild(sGrab);
    var head = el('div', 'kw-sheet-head');
    var htxt = el('div');
    htxt.appendChild(el('div', 'kw-sheet-title', 'Everything'));
    htxt.appendChild(el('div', 'kw-sheet-sub', 'grouped, one tap away'));
    head.appendChild(htxt);
    var close = el('button', 'kw-sheet-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', function () { closeSheets(); setActiveTab('map'); });
    head.appendChild(close);
    sheet.appendChild(head);
    var body = el('div', 'kw-sheet-body');
    body.id = 'kw-more-body';
    sheet.appendChild(body);
    screen.appendChild(sheet);

    /* Floating map buttons — Scout and Centre, from the old action bar. */
    var fabs = el('div', 'kw-fabs');
    fabs.id = 'kw-fabs';
    [
      { g: '🧭', t: 'Scout',  fn: 'actionScout' },
      { g: '🏘', t: 'Centre', fn: 'centreCamera' }
    ].forEach(function (f) {
      var b = el('button', 'kw-fab', f.g);
      b.type = 'button';
      b.title = f.t;
      b.setAttribute('aria-label', f.t);
      b.addEventListener('click', function () {
        if (typeof window[f.fn] === 'function') window[f.fn]();
      });
      fabs.appendChild(b);
    });
    screen.appendChild(fabs);

    /* Analog stick. */
    screen.appendChild(buildStick());

    /* Bottom tab bar. */
    var bar = el('nav', 'kw-tabbar');
    bar.id = 'kw-tabbar';
    bar.setAttribute('aria-label', 'Main');
    TABS.forEach(function (t) {
      var b = el('button', 'kw-tab' + (t.id === 'map' ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('data-tab', t.id);
      b.appendChild(el('span', 'kw-tab-g', t.glyph));
      b.appendChild(el('span', 'kw-tab-t', t.label));
      b.appendChild(el('span', 'kw-tab-dot'));
      b.addEventListener('click', function () { onTab(t.id); });
      bar.appendChild(b);
    });
    screen.appendChild(bar);

    wireIntegrations();
    wireGameToggles();
    watchOverlays();
    applyStickVisibility();
  }

  /* ── Analog stick ───────────────────────────────────────────────────── */

  var vec = { x: 0, y: 0 };
  var acc = { q: 0, r: 0 };
  var raf = null;
  var stickEl = null, knobEl = null, stickId = null;
  var MAXR = 30, DEAD = 6, SPEED = 0.18;

  function stickEnabled() {
    try {
      var v = localStorage.getItem(STICK_KEY);
      return v === null ? true : v === '1';
    } catch (_) { return true; }
  }
  function setStickEnabled(on) {
    try { localStorage.setItem(STICK_KEY, on ? '1' : '0'); } catch (_) {}
    applyStickVisibility();
  }
  function applyStickVisibility() {
    if (!stickEl) return;
    if (stickEnabled()) stickEl.removeAttribute('hidden');
    else { stickEl.setAttribute('hidden', ''); vec.x = vec.y = 0; }
  }

  function setKnob(dx, dy) {
    if (knobEl) knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  }

  function tick() {
    if (!vec.x && !vec.y) { raf = null; return; }
    acc.q += vec.x;
    acc.r += vec.y;
    var dq = acc.q > 0 ? Math.floor(acc.q) : Math.ceil(acc.q);
    var dr = acc.r > 0 ? Math.floor(acc.r) : Math.ceil(acc.r);
    if (dq || dr) {
      acc.q -= dq; acc.r -= dr;
      if (window.KWMap && window.KWMap.controller && window.KWMap.controller.pan) {
        window.KWMap.controller.pan(dq, dr);
      }
    }
    raf = window.requestAnimationFrame(tick);
  }
  function kick() { if (raf === null) raf = window.requestAnimationFrame(tick); }

  function buildStick() {
    stickEl = el('div', 'kw-stick');
    stickEl.id = 'kw-stick';
    stickEl.appendChild(el('div', 'kw-stick-base'));
    knobEl = el('div', 'kw-stick-knob');
    stickEl.appendChild(knobEl);

    stickEl.addEventListener('pointerdown', function (e) {
      if (!isMobile()) return;
      stickId = e.pointerId;
      stickEl.classList.add('kw-active');
      try { stickEl.setPointerCapture(e.pointerId); } catch (_) {}
      aim(e);
      e.preventDefault();
    });
    stickEl.addEventListener('pointermove', function (e) {
      if (e.pointerId !== stickId) return;
      aim(e);
      e.preventDefault();
    });
    var release = function (e) {
      if (e.pointerId !== stickId) return;
      stickId = null;
      stickEl.classList.remove('kw-active');
      setKnob(0, 0);
      vec.x = vec.y = 0;
      acc.q = acc.r = 0;
      try { stickEl.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    stickEl.addEventListener('pointerup', release);
    stickEl.addEventListener('pointercancel', release);
    return stickEl;
  }

  function aim(e) {
    var b = stickEl.getBoundingClientRect();
    var dx = e.clientX - (b.left + b.width / 2);
    var dy = e.clientY - (b.top + b.height / 2);
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > MAXR) { dx = dx / d * MAXR; dy = dy / d * MAXR; d = MAXR; }
    setKnob(dx, dy);
    var mag = d < DEAD ? 0 : (d - DEAD) / (MAXR - DEAD);
    if (mag === 0) { vec.x = vec.y = 0; return; }
    var ang = Math.atan2(dy, dx);
    vec.x = Math.cos(ang) * mag * SPEED;
    vec.y = Math.sin(ang) * mag * SPEED;
    kick();
  }

  /* ── Integrations with existing game code ───────────────────────────── */

  function wireIntegrations() {
    // switchTab drives the sidebar's content; on mobile it should also raise
    // the sheet so the panel it just populated is actually visible. 'map' is
    // excluded — it means "show me the map", not "show me a panel".
    if (typeof window.switchTab === 'function' && !window.switchTab._kwShell) {
      var origSwitch = window.switchTab;
      window.switchTab = function (tab) {
        var r = origSwitch.apply(this, arguments);
        if (autoOpenAllowed() && tab !== 'map') {
          openSidebarSheet();
          if (tab === 'settlement') setActiveTab('settlement');
          else if (tab === 'citizens') setActiveTab('citizens');
        }
        return r;
      };
      window.switchTab._kwShell = true;
    }

    // Selecting a tile is an explicit request to see that tile — raise the
    // sheet. Drags never reach here (kwmap-core only fires the click path on a
    // real tap), so this can't fight panning.
    ['selectWorldTile', 'selectFogTile'].forEach(function (name) {
      var fn = window[name];
      if (typeof fn !== 'function' || fn._kwShell) return;
      var wrapped = function () {
        var r = fn.apply(this, arguments);
        if (autoOpenAllowed()) openSidebarSheet();
        return r;
      };
      wrapped._kwShell = true;
      window[name] = wrapped;
    });
  }

  /* Tavern-game affordances that the phone layout depends on. Both are
     delegated, because these games re-render their whole subtree on every
     state change. */
  function wireGameToggles() {
    document.addEventListener('click', function (e) {
      if (!isMobile() || !e.target.closest) return;

      // Squirrel: opponent chips collapse to save room, so a tap expands one to
      // show that player's stash (which is public information anyway). Skipped
      // when the row carries a targeting handler for the current phase — Fox's
      // Dare and Magpie put an onclick on it, and that must win — and when the
      // tap landed on a card, which has its own zoom handler.
      var opp = e.target.closest('.sq-others .sq-player');
      if (opp && !opp.hasAttribute('onclick') && !e.target.closest('.sq-card')) {
        opp.classList.toggle('kw-open');
        return;
      }

      // Briarwood Court: the Scribe's Ledger shows its latest line and expands
      // on tap. The class goes on <body> so a re-render can't collapse it
      // mid-read.
      if (e.target.closest('.bc-log-scribe')) {
        document.body.classList.toggle('kw-led-open');
      }
    }, false);
  }

  // Full-screen overlays (tavern, fishing, combat) must not have the tab bar
  // floating over them.
  function watchOverlays() {
    // Anything that takes over the whole screen. The shell's tab bar, floating
    // buttons and stick must not hover above these, and an open sheet must not
    // be left behind them. Several are created on demand rather than living in
    // index.html, so the body is watched for them appearing too.
    var ids = [
      'tavern-overlay', 'fishing-overlay', 'combat-modal',
      'settlement-view', 'sq-backdrop', 'bcmp-backdrop'
    ];
    var wasOpen = false;

    var sync = function () {
      var open = ids.some(function (id) {
        var n = byId(id);
        if (!n) return false;
        var cs = window.getComputedStyle(n);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      });
      document.body.classList.toggle('kw-overlay', open);
      // Opening one should dismiss whatever sheet launched it, so the game
      // isn't sharing the screen with the More list.
      if (open && !wasOpen) closeSheets();
      wasOpen = open;
    };

    var attrMo = new MutationObserver(sync);
    var attach = function () {
      ids.forEach(function (id) {
        var n = byId(id);
        if (n && !n._kwWatched) {
          n._kwWatched = true;
          attrMo.observe(n, { attributes: true, attributeFilter: ['style', 'class'] });
        }
      });
    };
    attach();

    new MutationObserver(function () { attach(); sync(); })
      .observe(document.body, { childList: true });

    sync();
  }

  /* ── Boot ───────────────────────────────────────────────────────────── */

  function boot() {
    build();
    syncShellClass();
    // Arm auto-open only once the player actually touches something, so the
    // game opens on a clean full-screen map rather than behind a sheet.
    var arm = function () { _ready = true; };
    document.addEventListener('pointerdown', arm, { once: true, capture: true });
    document.addEventListener('keydown', arm, { once: true, capture: true });
    // Rotation / resize flips the shell on and off without a teardown, since
    // every rule hangs off body.kw-shell.
    if (MQ.addEventListener) MQ.addEventListener('change', syncShellClass);
    else if (MQ.addListener) MQ.addListener(syncShellClass);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.KWShell = {
    openMore: function () { buildMoreBody(byId('kw-more-body')); openMoreSheet(); },
    openPanel: openSidebarSheet,
    close: closeSheets,
    setStick: setStickEnabled
  };
})(window, document);
