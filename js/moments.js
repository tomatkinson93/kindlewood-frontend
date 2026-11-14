// ══════════════════════════════════════════════════════════════════════════
//  KWMoments — moments on the main screen (docs/PHASE_2_MOMENTS.md §2.4).
//
//  A small stack of cards (soonest to expire first); each opens in the
//  dialogue box (KWSay) with its options and hints; the outcome shows for a
//  few seconds and the card folds away. Live: 'moment' adds a card,
//  'moment_resolved' (a default while you watched) removes it with a toast.
//  The bell's list shows them on top (js/events.js), the away report says
//  how many wait. Server: /api/moments.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_CARDS = 4;
  const st = { list: [], loaded: false, timer: null };

  function left(at) {
    const ms = new Date(at) - Date.now();
    if (!(ms > 0)) return 'deciding now';
    const h = ms / 3600000;
    return h >= 1 ? `${Math.round(h)} h left` : `${Math.max(1, Math.round(ms / 60000))} min left`;
  }

  // ── Pure renderers (proofs) ───────────────────────────────────────────────
  function stackHtml(list) {
    if (!list.length) return '';
    return `<div class="kwm-stack" role="region" aria-label="Things to decide">${list.slice(0, MAX_CARDS).map(m => `
      <button type="button" class="kwm-card" data-kwm="${m.id}" title="${esc(m.title)}">
        <span class="kwm-icon" aria-hidden="true">${esc(m.icon)}</span>
        <span class="kwm-body"><span class="kwm-title">${esc(m.title)}</span><span class="kwm-left">${esc(left(m.expires_at))}</span></span>
      </button>`).join('')}${list.length > MAX_CARDS ? `<div class="kwm-more">+${list.length - MAX_CARDS} more</div>` : ''}</div>`;
  }
  // For the top of the bell's list.
  function bellHtml(list) {
    if (!list.length) return '';
    return `<div class="kwm-bell"><div class="kwm-bell-h">🔔 Waiting for you</div>${list.map(m => `
      <button type="button" class="kwm-bell-row" data-kwm="${m.id}"><span aria-hidden="true">${esc(m.icon)}</span> ${esc(m.title)} <span class="kwm-left">${esc(left(m.expires_at))}</span></button>`).join('')}</div>`;
  }
  function sayOptions(m) {
    const dflt = (m.options || []).find(o => o.key === m.fallback);
    return {
      icon: m.icon, speaker: m.speaker || 'Your town', title: m.title, text: m.text,
      options: m.options, fallback: m.fallback,
      note: dflt ? `If you don't decide (${left(m.expires_at)}): ${dflt.label.toLowerCase()}.` : '',
    };
  }

  // ── Data and the stack ────────────────────────────────────────────────────
  function mount() {
    const doc = global.document;
    let el = doc.getElementById('kw-moments');
    if (!el) { el = doc.createElement('div'); el.id = 'kw-moments'; doc.body.appendChild(el); }
    return el;
  }
  function render() {
    if (!global.document || !global.document.body) return;
    mount().innerHTML = stackHtml(st.list);
    const bell = global.document.getElementById('kwm-bell-slot');
    if (bell) bell.innerHTML = bellHtml(st.list);
    if (global.KWNews) global.KWNews.refresh();   // the bell's count and its window
  }
  async function load() {
    if (typeof global.apiFetch !== 'function') return;
    try {
      const res = await global.apiFetch('/api/moments');
      if (!res.ok) return;
      const d = await res.json();
      st.list = d.moments || [];
      st.loaded = true;
      render();
    } catch (_) { /* offline */ }
  }

  async function open(id) {
    const m = st.list.find(x => x.id === Number(id));
    if (!m || !global.KWSay) return;
    await global.KWSay.ask(Object.assign(sayOptions(m), {
      async choose(key) {
        const res = await global.apiFetch(`/api/moments/${m.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice: key }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 404) { st.list = st.list.filter(x => x.id !== m.id); render(); }
          return { error: d.error || 'That could not be done.' };
        }
        st.list = st.list.filter(x => x.id !== m.id);
        render();
        // What it changed may show elsewhere: citizens, stores, the outpost.
        if (typeof global.loadCitizens === 'function') global.loadCitizens().catch(() => {});
        if (global.KWOutposts && global.KWOutposts.refreshModal) { try { global.KWOutposts.refreshModal(); } catch (_) {} }
        return { outcome: d.outcome };
      },
    }));
  }

  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'moment' && ev.moment) {
      if (!st.list.some(x => x.id === ev.moment.id)) st.list.push(ev.moment);
      st.list.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
      render();
    } else if (ev.type === 'moment_resolved') {
      const had = st.list.some(x => x.id === ev.id);
      st.list = st.list.filter(x => x.id !== ev.id);
      render();
      if (had && typeof global.showToastNotification === 'function') global.showToastNotification(`🔔 Decided for you: ${ev.outcome || ''}`, 'default');
    }
  }

  function start() {
    if (st.timer) return;
    global.document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-kwm]');
      if (b) { e.preventDefault(); open(b.getAttribute('data-kwm')); }
    });
    load();
    // The "time left" on each card, and a safety re-load now and then.
    st.timer = setInterval(() => { render(); }, 60000);
    setInterval(load, 10 * 60000);
  }
  function openFirst() { if (st.list[0]) open(st.list[0].id); else load().then(() => { if (st.list[0]) open(st.list[0].id); }); }

  if (global.document && typeof global.kwWhenReady === 'function') global.kwWhenReady(() => { if (global.localStorage && global.localStorage.getItem('kw_token')) start(); });

  global.KWMoments = { load, open, openFirst, onEvent, start, list: () => st.list.slice(), _stackHtml: stackHtml, _bellHtml: bellHtml, _sayOptions: sayOptions };
})(typeof window !== 'undefined' ? window : globalThis);
