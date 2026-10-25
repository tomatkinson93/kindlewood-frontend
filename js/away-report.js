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
//  The report is split into tabs (Summary · Resources · Quests · Citizens ·
//  Trade · Hardship · World) so a big settlement's absence stays readable; an empty
//  tab says nothing happened, and long lists are capped with "Show all".
//  The splash can be turned off with its "Don't show me this again" box or
//  Settings → General (kw_away_splash = 'off', per browser).
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const LS_KEY = 'kw_away_splash';
  const HEARTBEAT_MS = 60 * 1000;
  const BASE_RES = [['food', 'Food'], ['timber', 'Timber'], ['stone', 'Stone'], ['metal', 'Iron'], ['wealth', 'Wealth']];
  // Plus ores and the like (js/resource-defs.js) — tiles only when produced.
  const RES = BASE_RES.concat(root.KWResources ? root.KWResources.EXTRA.map(k => [k, root.KWResources.label(k)]) : []);
  const isBase = k => BASE_RES.some(x => x[0] === k);
  // Tabs: one per group, so a big settlement's report stays readable.
  // Event categories from the server map onto quests / citizens / hardship;
  // anything else ('other') joins the World tab.
  const TABS = [
    ['summary', '🌙', 'Summary'],
    ['resources', '🪵', 'Resources'],
    ['quests', '📜', 'Quests'],
    ['citizens', '🏡', 'Citizens'],
    ['trade', '⚒️', 'Progress'],
    ['hardship', '🩹', 'Hardship'],
    ['world', '🌍', 'World'],
  ];
  const EMPTY = {
    resources: 'Nothing was produced or eaten since you were last here.',
    quests: 'No quests finished since you were last here.',
    citizens: 'Nothing happened among your citizens since you were last here.',
    trade: 'Your workshops, the Library and the Market were quiet while you were away.',
    hardship: 'No injuries, deaths or hunger since you were last here.',
    world: 'Nothing happened in the wider world since you were last here.',
  };
  const LIST_CAP = 30;   // longer lists get a "Show all" button

  let _started = false, _hb = null, _report = null, _openRes = null, _tab = 'summary', _showAll = {};

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
      + (isBase(key) ? '<svg class="kw-icon"><use href="#kw-i-' + key + '"/></svg>' : '<span class="kw-icon ar-res-emoji" aria-hidden="true">' + _esc(root.KWResources.icon(key)) + '</span>')
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

  // Events split by tab ('other' → world), newest first.
  function _groups(r) {
    const g = { quests: [], citizens: [], trade: [], hardship: [], world: [] };
    for (const e of r.events || []) (g[e.category] || g.world).push(e);
    for (const k in g) g[k].reverse();
    return g;
  }
  function _resActive(r) { return RES.filter(([k]) => r.resources && r.resources[k] && (r.resources[k].produced || r.resources[k].consumed)); }

  // How many things each tab holds (drives the badges and the summary).
  function _counts(r) {
    const g = _groups(r);
    return {
      resources: _resActive(r).length,
      quests: g.quests.length,
      citizens: g.citizens.length,
      trade: g.trade.length,
      hardship: g.hardship.length,
      world: g.world.length + (r.happenings || []).length + ((r.seasons || []).length ? 1 : 0),
    };
  }

  function _evRow(e, r) {
    return '<div class="ar-ev"><span class="ar-ev-icon">' + _esc(e.icon) + '</span>'
      + '<span class="ar-ev-text">' + _linkNames(e.text, e.citizenIds, r.citizens) + '</span>'
      + '<span class="ar-ev-when" title="' + _esc(_local(e.at)) + '">' + _ago(e.at, r.now) + '</span></div>';
  }
  function _listHtml(key, list, r) {
    const all = _showAll[key] || list.length <= LIST_CAP;
    return (all ? list : list.slice(0, LIST_CAP)).map(e => _evRow(e, r)).join('')
      + (all ? '' : '<button type="button" class="ar-more" data-more="' + key + '">Show all ' + list.length + '</button>');
  }
  function _empty(key) { return '<div class="ar-empty">' + EMPTY[key] + '</div>'; }

  function _waitingHtml(r) {
    return (r.waiting || []).map(w =>
      '<div class="ar-ev ar-wait"><span class="ar-ev-icon">' + _esc(w.icon) + '</span><span class="ar-ev-text">' + _esc(w.text) + '</span>'
      + '<button type="button" class="ar-go" data-action="' + _esc(w.action) + '">Open</button></div>').join('');
  }
  function _tilesHtml(r) {
    return '<div class="ar-res-grid">' + RES.filter(([k]) => isBase(k) || (r.resources[k] && r.resources[k].produced))
      .map(([k, l]) => _resTile(k, l, r.resources[k] || { net: 0, produced: 0, consumed: 0 })).join('') + '</div>';
  }

  function _summaryHtml(r) {
    const c = _counts(r);
    const line = (key, icon, label, n, what) => '<button type="button" class="ar-sum-row' + (n ? '' : ' ar-sum-none') + '" data-tab="' + key + '">'
      + '<span class="ar-ev-icon">' + icon + '</span><span class="ar-sum-label">' + label + '</span>'
      + '<span class="ar-sum-n">' + (n ? n + ' ' + what + (n === 1 ? '' : 's') : 'Nothing happened') + '</span><span class="ar-sum-go">›</span></button>';
    return (r.waiting && r.waiting.length ? '<div class="qm-section">📌 Waiting for you</div>' + _waitingHtml(r) : '')
      + '<div class="qm-section">🪵 Resources</div>' + _tilesHtml(r)
      + '<div class="qm-section">📰 What happened</div>'
      + line('quests', '📜', 'Quests', c.quests, 'update')
      + line('citizens', '🏡', 'Citizens', c.citizens, 'event')
      + line('trade', '⚒️', 'Trade, crafting & research', c.trade, 'event')
      + line('hardship', '🩹', 'Hardship', c.hardship, 'event')
      + line('world', '🌍', 'World', c.world, 'event');
  }

  function _resourcesHtml(r) {
    if (!_resActive(r).length) return _empty('resources');
    return _tilesHtml(r) + (_openRes ? _detailHtml(r) : '<div class="ar-note" style="text-align:center">Choose a resource to see more details</div>');
  }

  function _worldHtml(r) {
    const hap = r.happenings || [], seasons = r.seasons || [], other = _groups(r).world;
    if (!hap.length && !seasons.length && !other.length) return _empty('world');
    let html = '';
    if (seasons.length) {
      // Year markers where the year turns: Year 694 · Summer → Autumn → Winter → Year 695 · Spring
      let lastYear = null;
      html += '<div class="qm-section">🍂 Seasons</div><div class="ar-seasons">' + seasons.map((s, i) => {
        const year = typeof root.calcSeasonAt === 'function' ? root.calcSeasonAt(s.fromMs + 1).year : s.year;
        const mark = year != null && year !== lastYear ? '<span class="ar-year">Year ' + _esc(year) + '</span>' : '';
        lastYear = year;
        return (i ? '<span class="ar-arrow">→</span>' : '') + mark
          + '<span class="ar-season" title="' + _esc(_local(s.fromMs) + ' → ' + _local(s.toMs)) + '">' + _esc(s.emoji) + ' ' + _esc(s.name) + '</span>';
      }).join('') + '</div>';
    }
    if (hap.length) {
      html += '<div class="qm-section">🏮 Happenings</div>' + hap.map(h => '<div class="ar-ev"><span class="ar-ev-icon">' + _esc(h.icon) + '</span><span class="ar-ev-text"><b>' + _esc(h.title) + '</b>'
        + (h.effects.length ? '<span class="ar-fx">' + h.effects.map(f => '<span class="ar-fx-' + f.tone + '">' + _esc(f.text) + '</span>').join('') + '</span>' : '')
        + '</span><span class="ar-ev-when" title="' + _esc(_local(h.startMs) + ' → ' + _local(h.endMs)) + '">' + _local(h.startMs) + '</span></div>').join('');
    }
    if (other.length) html += '<div class="qm-section">📰 Other news</div>' + _listHtml('world', other, r);
    return html;
  }

  // Workshops and the Market: totals first, then each piece / recipe / deal.
  const Q_LABEL = { basic: 'Basic', sturdy: 'Sturdy', fine: 'Fine', superior: 'Superior', legendary: 'Legendary' };
  function _tradeHtml(r) {
    const list = _groups(r).trade, t = r.trade;
    if (!list.length) return _empty('trade');
    // Same look as the resource tiles (not clickable).
    const tile = (label, val, tone) => '<div class="ar-res ar-res-static"><span class="ar-res-net' + (tone ? ' ' + tone : '') + '">' + val + '</span>'
      + '<span class="ar-res-label">' + _esc(label) + '</span></div>';
    let html = '';
    if (t) {
      html += '<div class="ar-res-grid">'
        + tile('Pieces made', _esc(t.made))
        + (t.best_quality && t.best_quality !== 'basic' ? tile('Best piece', _esc(Q_LABEL[t.best_quality] || t.best_quality)) : '')
        + tile('Gold earned', _fmt(t.earned)) + tile('Gold spent', _fmt(t.spent))
        + tile('Net gold', (t.net < 0 ? '−' : '+') + _fmt(Math.abs(t.net)), t.net > 0 ? 'ar-up' : t.net < 0 ? 'ar-down' : '')
        + '</div>'
        + (t.on_road ? '<div class="ar-note">⏳ ' + _fmt(t.on_road) + ' gold is still on its way home.</div>' : '')
        + (t.learned ? '<div class="ar-note">📜 ' + _esc(t.learned) + ' new recipe' + (t.learned === 1 ? '' : 's') + ' learned.</div>' : '');
    }
    return html + '<div class="qm-section">📰 What happened</div>' + _listHtml('trade', list, r);
  }

  function _tabBody(r) {
    if (_tab === 'resources') return _resourcesHtml(r);
    if (_tab === 'trade') return _tradeHtml(r);
    if (_tab === 'world') return _worldHtml(r);
    if (_tab === 'quests' || _tab === 'citizens' || _tab === 'hardship') {
      const list = _groups(r)[_tab];
      return (_tab === 'quests' && r.waiting && r.waiting.length ? _waitingHtml(r) : '') + (list.length ? _listHtml(_tab, list, r) : _empty(_tab));
    }
    return _summaryHtml(r);
  }

  function _render() {
    const r = _report, el = root.document.getElementById('away-report-modal');
    if (!r || !el) return;
    el.querySelector('.ar-away').textContent = 'You were away ' + _dur(r.awayMs) + ' (since ' + _local(r.since) + ').';
    const c = _counts(r);
    el.querySelector('.ar-tabs').innerHTML = TABS.map(([key, icon, label]) => {
      const n = c[key];
      return '<button type="button" role="tab" class="ar-tab' + (_tab === key ? ' active' : '') + (key !== 'summary' && !n ? ' ar-tab-none' : '') + '" data-tab="' + key + '"'
        + ' aria-selected="' + (_tab === key) + '" title="' + label + '">' + icon + '<span class="ar-tab-label"> ' + label + '</span>' + (n ? ' <span class="ar-tab-n">' + n + '</span>' : '') + '</button>';
    }).join('');
    el.querySelector('.ar-body').innerHTML = _tabBody(r);
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
      + '<div class="ar-tabs" role="tablist"></div>'
      + '<div class="qm-body ar-body"></div>'
      + '<div class="ar-footer"><label class="ar-dont"><input type="checkbox" class="ar-dont-box"> Don\'t show me this again</label>'
      + '<button type="button" class="qm-tavern-btn ar-ok" data-close>Back to the woods</button></div></div>';
    el.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t === el || t.closest('[data-close]')) { close(); return; }
      const tab = t.closest('[data-tab]');
      if (tab) { _tab = tab.dataset.tab; el.querySelector('.ar-body').scrollTop = 0; _render(); return; }
      const res = t.closest('[data-res]');
      if (res) {
        // From the summary a tile jumps to its breakdown on the Resources tab.
        _openRes = (_tab === 'resources' && _openRes === res.dataset.res) ? null : res.dataset.res;
        _tab = 'resources';
        _render();
        return;
      }
      const more = t.closest('[data-more]');
      if (more) { _showAll[more.dataset.more] = true; _render(); return; }
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

  // A chime when the splash opens: assets/audio/away-report.wav if it is
  // uploaded, else success.mp3; at the SFX volume. Browsers block sound
  // before the first click/tap on the page, so a blocked chime plays on the
  // player's first interaction while the splash is still open.
  const CHIME_FILES = ['away-report.wav', 'success.mp3'];
  function _chime() {
    const vol = typeof root.getSfxVolume === 'function' ? root.getSfxVolume() : 0.6;
    if (!(vol > 0) || typeof root.Audio !== 'function') return;
    const tryFile = (i) => {
      if (i >= CHIME_FILES.length) return;
      const a = new root.Audio('/assets/audio/' + CHIME_FILES[i]);
      a.volume = vol;
      a.addEventListener('error', () => tryFile(i + 1), { once: true });
      const p = a.play();
      if (p && p.catch) p.catch((e) => {
        if (!e || e.name !== 'NotAllowedError') return;
        const retry = () => {
          const el = root.document.getElementById('away-report-modal');
          if (el && el.style.display !== 'none') a.play().catch(() => {});
        };
        root.document.addEventListener('pointerdown', retry, { once: true, capture: true });
      });
    };
    tryFile(0);
  }

  function show(report) {
    _report = report;
    _openRes = null;
    _tab = 'summary';
    _showAll = {};
    const el = _ensureModal();
    el.querySelector('.ar-dont-box').checked = false;
    _render();
    el.style.display = 'flex';
    _chime();
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

  root.KWAwayReport = { start, show, close, enabled, setEnabled, seen, hasContent, _render, _setTab(t) { _tab = t; _render(); } };
})(typeof window !== 'undefined' ? window : this);
