// ══════════════════════════════════════════════════════════════════════════
//  KWAwayReport — "Since you were gone…" splash on game load.
//
//  loadGame() calls KWAwayReport.start() once the game is on screen:
//    1. GET /api/game/away-report — the server's summary of everything since
//       the player was last seen (resources produced / eaten with who
//       contributed, quests, births, partnerships, deaths, Happenings,
//       seasons, things waiting). show=false for absences under 15 minutes.
//    2. Starts the heartbeat (POST /api/game/seen every minute while the tab
//       is visible, and when it is hidden or closed), which is what "last
//       seen" means. The heartbeat starts only after the report is fetched,
//       so it can never wipe the report it is about to show.
//  The splash can be turned off with its "Don't show me this again" box or
//  Settings → General (kw_away_splash = 'off', per browser).
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const LS_KEY = 'kw_away_splash';
  const HEARTBEAT_MS = 60 * 1000;
  const RES = [['food', 'Food'], ['timber', 'Timber'], ['stone', 'Stone'], ['metal', 'Metal'], ['wealth', 'Wealth']];
  const CATEGORIES = [
    ['waiting', '📌 Waiting for you'],
    ['quests', '📜 Quests'],
    ['citizens', '🏡 Your citizens'],
    ['hardship', '🕯 Hardship'],
    ['other', '📰 Other news'],
  ];

  let _started = false, _hb = null, _report = null, _openRes = null;

  function enabled() { try { return root.localStorage.getItem(LS_KEY) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) { try { root.localStorage.setItem(LS_KEY, on ? 'on' : 'off'); } catch (e) {} }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function _api(path, opts) { return typeof root.apiFetch === 'function' ? root.apiFetch(path, opts) : fetch(path, opts); }
  function _fmt(n) { return Math.abs(Math.round(n)).toLocaleString(); }
  function _signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + _fmt(n); }

  function _dur(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h' + (mm ? ' ' + mm + 'm' : '');
    return mm + 'm';
  }
  function _ago(at, now) { return _dur(now - at) + ' ago'; }
  function _local(ms) {
    try { return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────
  function seen(keepalive) {
    try { return _api('/api/game/seen', { method: 'POST', keepalive: !!keepalive }).catch(() => {}); }
    catch (e) { return Promise.resolve(); }
  }
  function _startHeartbeat() {
    if (_hb) return;
    seen();
    _hb = setInterval(() => { if (!root.document.hidden) seen(); }, HEARTBEAT_MS);
    root.document.addEventListener('visibilitychange', () => seen(root.document.hidden));
    root.addEventListener('pagehide', () => seen(true));
  }

  // ── Entry point ─────────────────────────────────────────────────────────
  async function start() {
    if (_started) return;
    _started = true;
    let report = null;
    try {
      const r = await _api('/api/game/away-report');
      if (r.ok) report = await r.json();
    } catch (e) {}
    _startHeartbeat();
    if (report && report.show && enabled() && hasContent(report)) show(report);
  }

  function hasContent(r) {
    if (!r) return false;
    if ((r.events || []).length || (r.waiting || []).length || (r.happenings || []).length) return true;
    return RES.some(([k]) => r.resources && r.resources[k] && (r.resources[k].produced || r.resources[k].consumed));
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  // Citizen names in a line become buttons that open their profile.
  function _linkNames(text, ids, names) {
    let html = _esc(text);
    for (const id of ids || []) {
      const name = names && names[id];
      if (!name) continue;
      const e = _esc(name), i = html.indexOf(e);
      if (i < 0) continue;
      html = html.slice(0, i) + '<button type="button" class="ar-cit" data-cid="' + Number(id) + '">' + e + '</button>' + html.slice(i + e.length);
    }
    return html;
  }

  function _resTile(key, label, d) {
    const net = d.net || 0;
    const tone = net > 0 ? 'ar-up' : net < 0 ? 'ar-down' : '';
    const tip = label + ': produced ' + _fmt(d.produced) + (d.consumed ? ', eaten ' + _fmt(d.consumed) : '') + '. Click for the breakdown.';
    return '<button type="button" class="ar-res' + (_openRes === key ? ' open' : '') + '" data-res="' + key + '" title="' + _esc(tip) + '">'
      + '<svg class="kw-icon"><use href="#kw-i-' + key + '"/></svg>'
      + '<span class="ar-res-net ' + tone + '">' + _signed(net) + '</span>'
      + '<span class="ar-res-label">' + label + '</span></button>';
  }

  function _rowsHtml(rows, sign, names) {
    return rows.map(r => '<div class="ar-src"><span class="ar-src-label">' + _esc(r.label) + '</span><span class="ar-src-amt ' + (sign > 0 ? 'ar-up' : 'ar-down') + '">'
      + (sign > 0 ? '+' : '−') + _fmt(r.amount) + '</span></div>'
      + (r.citizens && r.citizens.length ? '<div class="ar-src-cits">' + r.citizens.map(c =>
          '<span class="ar-src-cit">' + _linkNames(c.name, [c.id], names) + ' <b>' + (sign > 0 ? '+' : '−') + _fmt(c.amount) + '</b></span>').join('') + '</div>' : '')).join('');
  }

  function _detailHtml(r) {
    if (!_openRes || !r.resources[_openRes]) return '';
    const d = r.resources[_openRes], label = RES.find(x => x[0] === _openRes)[1];
    const mult = d.multiplier && Math.abs(d.multiplier - 1) >= 0.01
      ? '<div class="ar-note">Seasons and Happenings averaged ×' + d.multiplier.toFixed(2) + ' on ' + label.toLowerCase() + ' while you were away (already included).</div>' : '';
    return '<div class="ar-detail">'
      + '<div class="ar-detail-head">' + label + ': <span class="ar-up">+' + _fmt(d.produced) + ' produced</span>'
      + (d.consumed ? ' · <span class="ar-down">−' + _fmt(d.consumed) + ' eaten</span>' : '') + '</div>'
      + (d.sources.length ? '<div class="ar-sub">Who contributed</div>' + _rowsHtml(d.sources, 1, r.citizens) : '<div class="ar-note">Nothing was produced.</div>')
      + (d.consumers && d.consumers.length ? '<div class="ar-sub">Who ate it</div>' + _rowsHtml(d.consumers, -1, r.citizens) : '')
      + mult + '</div>';
  }

  function _eventsHtml(r) {
    const byCat = {};
    for (const e of r.events || []) {
      const cat = CATEGORIES.some(c => c[0] === e.category) ? e.category : 'other';
      (byCat[cat] = byCat[cat] || []).push(e);
    }
    let html = '';
    if ((r.waiting || []).length) {
      html += '<div class="qm-section">' + CATEGORIES[0][1] + '</div>' + r.waiting.map(w =>
        '<div class="ar-ev ar-wait"><span class="ar-ev-icon">' + _esc(w.icon) + '</span><span class="ar-ev-text">' + _esc(w.text) + '</span>'
        + '<button type="button" class="ar-go" data-action="' + _esc(w.action) + '">Open</button></div>').join('');
    }
    for (const [cat, title] of CATEGORIES.slice(1)) {
      const list = byCat[cat];
      if (!list || !list.length) continue;
      html += '<div class="qm-section">' + title + ' <span class="ar-count">' + list.length + '</span></div>'
        + list.slice().reverse().map(e => '<div class="ar-ev"><span class="ar-ev-icon">' + _esc(e.icon) + '</span>'
          + '<span class="ar-ev-text">' + _linkNames(e.text, e.citizenIds, r.citizens) + '</span>'
          + '<span class="ar-ev-when" title="' + _esc(_local(e.at)) + '">' + _ago(e.at, r.now) + '</span></div>').join('');
    }
    return html;
  }

  function _worldHtml(r) {
    const hap = r.happenings || [], seasons = r.seasons || [];
    if (!hap.length && !seasons.length) return '';
    let html = '<div class="qm-section">🌍 In the wider world</div>';
    if (seasons.length) {
      html += '<div class="ar-seasons">' + seasons.map(s => '<span class="ar-season" title="' + _esc(_local(s.fromMs) + ' → ' + _local(s.toMs)) + '">'
        + _esc(s.emoji) + ' ' + _esc(s.name) + '</span>').join('<span class="ar-arrow">→</span>') + '</div>';
    }
    html += hap.map(h => '<div class="ar-ev"><span class="ar-ev-icon">' + _esc(h.icon) + '</span><span class="ar-ev-text"><b>' + _esc(h.title) + '</b>'
      + (h.effects.length ? '<span class="ar-fx">' + h.effects.map(f => '<span class="ar-fx-' + f.tone + '">' + _esc(f.text) + '</span>').join('') + '</span>' : '')
      + '</span><span class="ar-ev-when" title="' + _esc(_local(h.startMs) + ' → ' + _local(h.endMs)) + '">' + _local(h.startMs) + '</span></div>').join('');
    return html;
  }

  function _render() {
    const r = _report, el = root.document.getElementById('away-report-modal');
    if (!r || !el) return;
    el.querySelector('.ar-away').textContent = 'You were away ' + _dur(r.awayMs) + ' (since ' + _local(r.since) + ').';
    el.querySelector('.ar-body').innerHTML =
      '<div class="ar-res-grid">' + RES.map(([k, l]) => _resTile(k, l, r.resources[k] || { net: 0, produced: 0, consumed: 0 })).join('') + '</div>'
      + _detailHtml(r) + _eventsHtml(r) + _worldHtml(r)
      + ((r.events || []).length ? '' : '<div class="ar-note" style="text-align:center;margin-top:10px">All was quiet. Your settlement kept working while you were gone.</div>');
  }

  function _ensureModal() {
    let el = root.document.getElementById('away-report-modal');
    if (el) return el;
    el = root.document.createElement('div');
    el.id = 'away-report-modal';
    el.className = 'qm-backdrop ar-backdrop';
    el.style.display = 'none';
    el.innerHTML = '<div class="qm-card ar-card" role="dialog" aria-modal="true" aria-labelledby="ar-title">'
      + '<div class="qm-header"><div class="ar-head"><div class="qm-title" id="ar-title">🌙 Since you were gone…</div><div class="ar-away"></div></div>'
      + '<button type="button" class="qm-close" data-close title="Close">✕</button></div>'
      + '<div class="qm-body ar-body"></div>'
      + '<div class="ar-footer"><label class="ar-dont"><input type="checkbox" class="ar-dont-box"> Don\'t show me this again</label>'
      + '<button type="button" class="qm-tavern-btn ar-ok" data-close>Back to the woods</button></div></div>';
    el.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t === el || t.closest('[data-close]')) { close(); return; }
      const res = t.closest('[data-res]');
      if (res) { _openRes = _openRes === res.dataset.res ? null : res.dataset.res; _render(); return; }
      const cit = t.closest('[data-cid]');
      if (cit) { if (typeof root.openCitizenProfile === 'function') root.openCitizenProfile(Number(cit.dataset.cid)); return; }
      const go = t.closest('[data-action]');
      if (go) {
        close();
        if (go.dataset.action === 'quests' && typeof root.openQuestsModal === 'function') root.openQuestsModal();
        if (go.dataset.action === 'battles' && typeof root.openBattlesModal === 'function') root.openBattlesModal();
      }
    });
    root.document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && el.style.display !== 'none') close(); });
    root.document.body.appendChild(el);
    return el;
  }

  function show(report) {
    _report = report;
    _openRes = null;
    const el = _ensureModal();
    el.querySelector('.ar-dont-box').checked = false;
    _render();
    el.style.display = 'flex';
  }

  function close() {
    const el = root.document.getElementById('away-report-modal');
    if (!el) return;
    if (el.querySelector('.ar-dont-box').checked) {
      setEnabled(false);
      if (typeof root.showToastNotification === 'function')
        root.showToastNotification('You can turn the "Since you were gone" summary back on in Settings → General.', 'default');
    }
    el.style.display = 'none';
  }

  root.KWAwayReport = { start, show, close, enabled, setEnabled, seen, hasContent, _render };
})(typeof window !== 'undefined' ? window : this);
