// ══════════════════════════════════════════════════════════════════════════
//  KWNews — one place for news (docs/LAYOUT_SPEC.md §2.5). The bell opens a
//  window (KWWindow, size M; a full-screen sheet on phones):
//
//    • what is waiting for you to decide (moments, js/moments.js), first;
//    • the town's news, newest first (settlement events, js/events.js), with
//      tabs: All · Raids · Family · Trade;
//    • links: while you were away, clear all, the whole chronicle (Families).
//
//  The bell's count is what you haven't seen: moments waiting, plus news that
//  arrived since you last opened it. World events (Happenings) live in the
//  clock's pop-up, with the calendar a click away (js/hud-clock.js); the old
//  Events button and the drop-down events panel are gone.
//
//    KWNews.open() / close() / toggle() / isOpen()
//    KWNews.refresh()          redraw the open window
//    KWNews.badge()            recount the bell
//    KWNews.category(type)     'raids' | 'family' | 'trade' | 'other'
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const ID = 'news';
  const SEEN_KEY = 'kw-news-seen';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = name => { try { return (0, eval)(`typeof ${name} !== 'undefined' ? ${name} : undefined`); } catch (e) { return undefined; } };

  const TABS = [{ key: 'all', label: 'All' }, { key: 'raids', label: 'Raids' }, { key: 'family', label: 'Family' }, { key: 'trade', label: 'Trade' }];
  function category(type) {
    const t = String(type || '');
    if (/^raid|^camp_|call_to_arms|^siege|withered/.test(t)) return 'raids';
    if (/child_born|birth|partnership|bond|memorial|death|came_of_age|inheritance|settler|family/.test(t)) return 'family';
    if (/market|trade|village|trust|merchant|porter|haul|shop|caravan|envoy/.test(t)) return 'trade';
    return 'other';
  }
  const ICONS = { raids: '🛡', family: '👪', trade: '⚖️', other: '📜' };

  // ── What has been seen ──────────────────────────────────────────────────
  function seen() { try { return Number(global.localStorage.getItem(SEEN_KEY)) || 0; } catch (e) { return 0; } }
  function markSeen() {
    const ev = events();
    if (!ev.length) return;
    try { global.localStorage.setItem(SEEN_KEY, String(Math.max(...ev.map(e => Number(e.id) || 0)))); } catch (e) { /* private mode */ }
  }
  const events = () => g('_eventsData') || [];
  const moments = () => (global.KWMoments && global.KWMoments.list ? global.KWMoments.list() : []);

  function badge() {
    const b = doc && doc.getElementById('events-badge');
    if (!b) return 0;
    const s = seen();
    const n = isOpen() ? 0 : moments().length + events().filter(e => Number(e.id) > s).length;
    b.textContent = n > 99 ? '99+' : String(n);
    b.style.display = n ? 'inline-flex' : 'none';
    const bell = doc.querySelector('.btn-events-bell');
    if (bell) bell.setAttribute('aria-label', n ? `News, ${n} new` : 'News');
    return n;
  }

  // ── The window ──────────────────────────────────────────────────────────
  const timeAgo = ts => (typeof global._timeAgo === 'function' ? global._timeAgo(ts) : '');
  function rowsHtml(tab) {
    const list = events().filter(e => tab === 'all' || category(e.type) === tab);
    if (!list.length) {
      return `<div class="kwn-empty">${tab === 'all' ? 'Nothing yet. Your settlement is just getting started.' : `No ${tab === 'raids' ? 'raids' : tab} news.`}</div>`;
    }
    const s = seen();
    return list.map(e => {
      // Most messages start with their own emoji: that is the row's icon then.
      const m = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u.exec(String(e.message || ''));
      const icon = m ? m[1] : ICONS[category(e.type)], text = m ? String(e.message).slice(m[0].length) : e.message;
      return `<div class="kwn-row${Number(e.id) > s ? ' kwn-new' : ''}" data-cat="${category(e.type)}">`
      + `<span class="kwn-ic" aria-hidden="true">${esc(icon)}</span>`
      + `<span class="kwn-text"><span>${esc(text)}</span><span class="kwn-when">${esc(timeAgo(e.created_at))}</span></span>`
      + `<button type="button" class="kwn-x" data-action="dismiss" data-id="${Number(e.id)}" aria-label="Dismiss">✕</button></div>`;
    }).join('');
  }
  function bodyHtml(tab) {
    const m = moments();
    const waiting = m.length && global.KWMoments && global.KWMoments._bellHtml ? global.KWMoments._bellHtml(m) : '';
    return (waiting ? `<section class="kwn-waiting" aria-label="Waiting for you">${waiting}</section>` : '')
      + `<div class="kwn-feed" role="list">${rowsHtml(tab)}</div>`
      + `<div class="kwn-foot">`
      + `<button type="button" class="kw-btn" data-action="away">While you were away</button>`
      + `<button type="button" class="kw-btn" data-action="chronicle">The whole chronicle</button>`
      + (events().length ? `<button type="button" class="kw-btn" data-action="clear">Clear all</button>` : '')
      + `</div>`;
  }
  function isOpen() { return !!(global.KWWindow && global.KWWindow.isOpen(ID)); }
  function open() {
    if (!global.KWWindow) return;
    if (isOpen()) return;
    global.KWWindow.open({
      id: ID, title: 'News', icon: 'bell', size: 'M',
      tabs: TABS, tab: 'all',
      render(body, st) {
        body.innerHTML = bodyHtml(st.tab || 'all');
        // A moment opens the dialogue box, which sits below windows: close first.
        body.querySelectorAll('[data-kwm]').forEach(b => b.addEventListener('click', () => close(), { once: true }));
      },
      actions: {
        dismiss(el) { if (typeof global.dismissEvent === 'function') global.dismissEvent(Number(el.getAttribute('data-id'))); },
        clear() {
          const go = () => { if (typeof global.clearAllEvents === 'function') global.clearAllEvents(); };
          if (global.KWDialog && global.KWDialog.confirm) global.KWDialog.confirm({ title: 'Clear all news?', message: 'The chronicle keeps the story; this only empties the list.', ok: 'Clear all' }).then(ok => { if (ok) go(); });
          else go();
        },
        away() { close(); if (global.KWAwayReport) global.KWAwayReport.reopen(); },
        chronicle() { close(); const w = global.KWFamilies && global.KWFamilies.open(); if (w && w.setTab) w.setTab('chronicle'); },
      },
      onClose() { markSeen(); badge(); },
    });
    markSeen();
    badge();
    if (typeof global.loadEvents === 'function') global.loadEvents();
    if (global.KWMoments && global.KWMoments.load) global.KWMoments.load();
  }
  function close() { if (global.KWWindow && isOpen()) global.KWWindow.close(ID); }
  function toggle() { if (isOpen()) close(); else open(); }
  function refresh() {
    if (!isOpen()) { badge(); return; }
    const w = global.KWWindow.get ? global.KWWindow.get(ID) : null;
    if (w && w.refresh) w.refresh();
    markSeen();
  }

  global.KWNews = { open, close, toggle, isOpen, refresh, badge, category, TABS, _rowsHtml: rowsHtml, _bodyHtml: bodyHtml };
})(typeof window !== 'undefined' ? window : globalThis);
