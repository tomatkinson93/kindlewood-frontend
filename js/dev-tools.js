// ══════════════════════════════════════════════════════════════════════════
//  KWDevTools — Dev Tools load for admins only (docs/LAYOUT_SPEC.md §6).
//
//  The ⚗ panel's markup lives in dev.html, with its admin-only scripts and
//  styles. None of it is in the page every player downloads: once the
//  server says this player is an admin (KWClock.me().isAdmin), the fragment
//  is added to the page and the scripts loaded in their old order. Opening
//  Dev Tools before that finishes waits for it.
//
//  Dev Tools stays its own overlay (layer 5000), below windows, on purpose:
//  what it triggers (a moment's dialogue box, a window, a toast, its card
//  editor's help at 10000) has to show above it while you test.
//
//    KWDevTools.load()      → Promise (once; later calls return the same one)
//    KWDevTools.loaded()    → true once everything is in
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const V = '1';
  const STYLES = ['/css/card-admin.css?v=1778502600'];
  const SCRIPTS = ['/js/life-admin.js?v=1', '/js/funnel-admin.js?v=p0', '/js/item_admin.js?v=r5d',
    '/js/happenings-admin.js?v=r5d', '/js/enemy_admin.js?v=r5d', '/js/card-admin.js?v=r5d'];
  let _p = null, _done = false;

  const isAdmin = () => typeof global._kwIsAdmin === 'function' && global._kwIsAdmin();
  function script(src) {
    return new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      doc.body.appendChild(s);
    });
  }
  function load() {
    if (_p) return _p;
    if (!isAdmin()) return Promise.resolve(false);
    _p = (async () => {
      if (!doc.getElementById('cheat-modal')) {
        const r = await global.fetch('/dev.html?v=' + V, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('Dev Tools did not load (' + r.status + ').');
        const holder = doc.createElement('div');
        holder.id = 'kw-dev-tools';
        holder.innerHTML = await r.text();
        doc.body.appendChild(holder);
      }
      STYLES.forEach(href => {
        if (doc.querySelector(`link[href="${href}"]`)) return;
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        doc.head.appendChild(l);
      });
      for (const src of SCRIPTS) await script(src);   // in order, as they were in the page
      _done = true;
      return true;
    })().catch(e => { _p = null; console.error('[dev-tools]', e); throw e; });
    return _p;
  }

  // Load as soon as the server says this is an admin (players never fetch it).
  function watch() {
    const go = () => { if (isAdmin()) load().catch(() => {}); };
    go();
    if (global.KWClock && global.KWClock.onChange) global.KWClock.onChange(e => { if (e && e.reason === 'sync') go(); });
  }
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', watch); else watch(); }

  global.KWDevTools = { load, loaded: () => _done, SCRIPTS, STYLES };
})(typeof window !== 'undefined' ? window : globalThis);
