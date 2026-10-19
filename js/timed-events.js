// ══════════════════════════════════════════════════════════════════════════
//  KWEventsPanel — the community bar's 📅 Events button: the detailed view of
//  timed events (Happenings). The clock HUD keeps the glance (what's on now
//  and the next one) and links here with "See all events".
//
//  Tabs, all computed in the browser from the shared modules (no new API):
//    Now        running Happenings — effects in words, flavour, a countdown
//               and how far through the window we are.
//    Upcoming   the next 7 days: a day × hour strip in the player's own time
//               plus a list with times (local + UTC), effects and 🔔 Remind me.
//    Seasons & Moon   the current season's real effects (SEASON_MODS, kept
//               in step with the server) and the next four seasons; the next
//               eight nights' moons.
//    Recent     Happenings from the last 3 days.
//  Reminders: kw_event_reminders (per browser) — a toast when the window
//  starts, plus a browser notification when the player has allowed them.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const H = 3600 * 1000, DAY = 24 * H;
  const UPCOMING_DAYS = 7, RECENT_DAYS = 3, REMIND_TICK_MS = 20 * 1000;
  const LS_REMIND = 'kw_event_reminders';
  const TABS = [['now', '✨', 'Now'], ['upcoming', '📅', 'Upcoming'], ['seasons', '🌗', 'Seasons & Moon'], ['recent', '🕰', 'Recent']];
  const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];

  let _tab = 'now', _timer = null, _remindTimer = null, _lastRemindCheck = null;

  const D = () => root.KWDayCycle;
  const HAP = () => root.KWHappenings;
  function _now() { return root.KWClock ? root.KWClock.now() : Date.now(); }
  function _wall() { return root.KWClock ? root.KWClock.wallNow() : Date.now(); }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function _dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m >= 1440) return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
    if (m >= 60) return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
    return m + 'm';
  }
  function _fmt(ms, opts) {
    try { return new Date(ms).toLocaleString([], opts); } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
  }
  const _time = (ms) => _fmt(ms, { hour: 'numeric', minute: '2-digit' });
  const _dayName = (ms) => _fmt(ms, { weekday: 'long', day: 'numeric', month: 'short' });
  const _dayShort = (ms) => _fmt(ms, { weekday: 'short' });
  const _when = (ms) => _fmt(ms, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  function _utc(ms) { const d = new Date(ms); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UTC'; }
  function _localMidnight(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

  // Windows overlapping [from, to) across the live definitions, by start.
  function windows(from, to) {
    const out = [];
    for (const h of (HAP() ? HAP().defs() : [])) {
      for (const w of D().windowsBetween(h.rule, from, to)) out.push({ h, startMs: w.startMs, endMs: w.endMs, key: h.id + '@' + w.startMs });
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  // ── Reminders ──────────────────────────────────────────────────────────
  function _reminders() {
    try { const v = JSON.parse(root.localStorage.getItem(LS_REMIND) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function _saveReminders(list) {
    // Keep only future-ish keys so the list never grows without bound.
    const cutoff = _wall() - DAY;
    const keep = list.filter(k => Number(String(k).split('@')[1]) > cutoff);
    try { root.localStorage.setItem(LS_REMIND, JSON.stringify(keep)); } catch (e) {}
  }
  function hasReminder(key) { return _reminders().indexOf(key) >= 0; }
  function toggleReminder(key) {
    const list = _reminders(), i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1); else {
      list.push(key);
      try { if (root.Notification && root.Notification.permission === 'default') root.Notification.requestPermission(); } catch (e) {}
    }
    _saveReminders(list);
    return i < 0;
  }
  // Toast (and notify) each reminded window whose start has just passed.
  function checkReminders() {
    const now = _wall(), from = _lastRemindCheck == null ? now - REMIND_TICK_MS : _lastRemindCheck;
    _lastRemindCheck = now;
    const list = _reminders();
    if (!list.length) return;
    let changed = false;
    for (const w of windows(from - DAY, now + 1)) {
      if (w.startMs <= from || w.startMs > now || list.indexOf(w.key) < 0) continue;
      const msg = '🔔 ' + (w.h.icon || '🏮') + ' ' + w.h.title + ' is starting now!';
      if (typeof root.showToastNotification === 'function') root.showToastNotification(msg, 'event');
      try { if (root.Notification && root.Notification.permission === 'granted') new root.Notification('Kindlewood', { body: msg.slice(3) }); } catch (e) {}
      list.splice(list.indexOf(w.key), 1);
      changed = true;
    }
    if (changed) _saveReminders(list);
  }

  // ── Pieces ─────────────────────────────────────────────────────────────
  function _fxHtml(w) {
    const lines = HAP() ? HAP().effectLines(w.h, w.startMs) : [];
    if (!lines.length) return '';
    return '<div class="ev-fx">' + lines.map(l => '<span class="ev-fx-' + l.tone + '">' + _esc(l.text) + '</span>').join('') + '</div>';
  }
  function _remindBtn(w) {
    const on = hasReminder(w.key);
    return '<button type="button" class="ev-remind' + (on ? ' on' : '') + '" data-remind="' + _esc(w.key) + '" title="' + (on ? 'Cancel the reminder' : 'Remind me when it starts') + '">'
      + (on ? '🔔 Reminder set' : '🔕 Remind me') + '</button>';
  }
  function _empty(text) { return '<div class="ar-empty">' + text + '</div>'; }

  function _nowHtml(ms) {
    const active = windows(ms, ms + 1).filter(w => w.startMs <= ms && ms < w.endMs);
    if (!active.length) {
      const next = windows(ms, ms + UPCOMING_DAYS * DAY).find(w => w.startMs > ms);
      return _empty('No events are running right now.')
        + (next ? '<div class="ev-next">Next: <b>' + _esc(next.h.icon || '🏮') + ' ' + _esc(next.h.title) + '</b> in ' + _dur(next.startMs - ms)
          + ' (' + _esc(_when(next.startMs)) + ') <button type="button" class="ar-more" data-tab="upcoming">See the week</button></div>' : '');
    }
    return active.map(w => {
      const pct = Math.max(0, Math.min(100, Math.round((ms - w.startMs) / (w.endMs - w.startMs) * 100)));
      return '<div class="ev-card ev-live"><div class="ev-card-head"><span class="ev-icon">' + _esc(w.h.icon || '🏮') + '</span>'
        + '<div class="ev-card-main"><div class="ev-title">' + _esc(w.h.title) + '</div>'
        + (w.h.flavour ? '<div class="ev-flavour">' + _esc(w.h.flavour) + '</div>' : '') + '</div>'
        + '<div class="ev-left">ends in<br><b>' + _dur(w.endMs - ms) + '</b></div></div>'
        + _fxHtml(w)
        + '<div class="ev-bar"><span style="width:' + pct + '%"></span></div>'
        + '<div class="ev-times">' + _esc(_when(w.startMs)) + ' → ' + _esc(_when(w.endMs)) + ' · ' + _utc(w.startMs) + '–' + _utc(w.endMs) + '</div></div>';
    }).join('');
  }

  // Day × local-hour strip for the next 7 days.
  function _stripHtml(ms, list) {
    const day0 = _localMidnight(ms);
    let html = '<div class="ev-strip"><div></div>';
    for (let h = 0; h < 24; h++) html += '<div class="ev-strip-h">' + (h % 6 === 0 ? h : '') + '</div>';
    for (let d = 0; d < UPCOMING_DAYS; d++) {
      const dayStart = day0 + d * DAY;
      html += '<div class="ev-strip-d">' + _esc(d === 0 ? 'Today' : _dayShort(dayStart + 12 * H)) + '</div>';
      for (let h = 0; h < 24; h++) {
        const a = dayStart + h * H, b = a + H;
        const on = list.filter(w => w.startMs < b && w.endMs > a);
        const past = b <= ms, nowCell = a <= ms && ms < b;
        html += '<div class="ev-strip-c' + (on.length ? ' on' : '') + (past ? ' past' : '') + (nowCell ? ' now' : '') + '"'
          + (on.length ? ' title="' + _esc(_time(a) + ': ' + on.map(w => w.h.title).join(', ')) + '"' : '') + '></div>';
      }
    }
    return html + '</div><div class="ev-hint">Your local time. Highlighted hours have an event on; hover for names.</div>';
  }

  function _upcomingHtml(ms) {
    const list = windows(ms, ms + UPCOMING_DAYS * DAY).filter(w => w.endMs > ms);
    if (!list.length) return _empty('No events are scheduled for the next 7 days.');
    let html = _stripHtml(ms, list), lastDay = null;
    for (const w of list) {
      const day = _localMidnight(Math.max(w.startMs, ms));
      if (day !== lastDay) { html += '<div class="qm-section">' + _esc(day === _localMidnight(ms) ? 'Today' : _dayName(day + 12 * H)) + '</div>'; lastDay = day; }
      const live = w.startMs <= ms;
      html += '<div class="ev-row' + (live ? ' ev-live' : '') + '"><span class="ev-icon">' + _esc(w.h.icon || '🏮') + '</span>'
        + '<div class="ev-card-main"><div class="ev-title">' + _esc(w.h.title) + (live ? ' <span class="ev-badge">On now</span>' : '') + '</div>'
        + '<div class="ev-times">' + _esc(_time(w.startMs)) + ' – ' + _esc(_time(w.endMs)) + ' (' + _dur(w.endMs - w.startMs) + ') · ' + _utc(w.startMs) + '</div>'
        + _fxHtml(w) + '</div>'
        + '<div class="ev-side"><span class="ev-in">' + (live ? 'ends in ' + _dur(w.endMs - ms) : 'in ' + _dur(w.startMs - ms)) + '</span>'
        + (live ? '' : _remindBtn(w)) + '</div></div>';
    }
    return html;
  }

  function _seasonEffects(id) {
    const lines = typeof root.seasonEffectLines === 'function' ? root.seasonEffectLines(id) : [];
    return lines.length ? '<div class="ev-fx">' + lines.map(l => '<span class="ev-fx-' + (l.good ? 'good' : 'bad') + '">' + _esc(l.text) + '</span>').join('') + '</div>'
      : '<div class="ev-fx"><span class="ev-fx-neutral">No changes</span></div>';
  }

  function _seasonsHtml() {
    const wall = _wall();
    let html = '';
    if (typeof root.calcSeasonAt === 'function') {
      const cur = root.calcSeasonAt(wall);
      const pct = Math.round(cur.progress * 100);
      html += '<div class="qm-section">🍃 This season</div>'
        + '<div class="ev-card"><div class="ev-card-head"><span class="ev-icon">' + _esc(cur.emoji) + '</span>'
        + '<div class="ev-card-main"><div class="ev-title">' + _esc(cur.name) + ' · Year ' + cur.year + '</div><div class="ev-flavour">' + _esc(cur.flavor) + '</div></div>'
        + '<div class="ev-left">ends in<br><b>' + _dur(cur.msRemaining) + '</b></div></div>'
        + _seasonEffects(cur.id) + '<div class="ev-bar"><span style="width:' + pct + '%"></span></div></div>'
        + '<div class="qm-section">⏭ Coming seasons</div>';
      let t = wall + cur.msRemaining;
      for (let i = 0; i < 4; i++) {
        const s = root.calcSeasonAt(t + 1);
        html += '<div class="ev-row"><span class="ev-icon">' + _esc(s.emoji) + '</span><div class="ev-card-main"><div class="ev-title">' + _esc(s.name) + '</div>'
          + '<div class="ev-times">' + _esc(_when(t)) + ' · lasts ' + _dur(s.msRemaining + 1) + '</div>' + _seasonEffects(s.id) + '</div>'
          + '<div class="ev-side"><span class="ev-in">in ' + _dur(t - wall) + '</span></div></div>';
        t += s.msRemaining + 1;
      }
    }
    // The moon changes once a day; show the next eight nights' moons (at local midnight-ish).
    const d = D(), now = _now();
    if (d) {
      const todayMoon = d.moonAt(now);
      html += '<div class="qm-section">🌙 Moon</div><div class="ev-moons">';
      for (let i = 0; i < 8; i++) {
        const at = now + i * DAY, m = d.moonAt(at);
        html += '<div class="ev-moon' + (i === 0 ? ' today' : '') + '" title="' + _esc(m.name) + '"><span class="ev-moon-g">' + m.glyph + '</span>'
          + '<span class="ev-moon-d">' + _esc(i === 0 ? 'Today' : _dayShort(at)) + '</span></div>';
      }
      html += '</div><div class="ev-hint">Tonight: ' + todayMoon.glyph + ' ' + _esc(todayMoon.name) + '. Some events and creatures only appear under certain moons or at night.</div>';
    }
    return html || _empty('Season information is not available.');
  }

  function _recentHtml(ms) {
    const list = windows(ms - RECENT_DAYS * DAY, ms).filter(w => w.endMs <= ms).reverse();
    if (!list.length) return _empty('No events in the last 3 days.');
    return list.map(w => '<div class="ev-row ev-past"><span class="ev-icon">' + _esc(w.h.icon || '🏮') + '</span>'
      + '<div class="ev-card-main"><div class="ev-title">' + _esc(w.h.title) + '</div>'
      + '<div class="ev-times">' + _esc(_when(w.startMs)) + ' – ' + _esc(_time(w.endMs)) + ' (' + _dur(w.endMs - w.startMs) + ')</div>' + _fxHtml(w) + '</div>'
      + '<div class="ev-side"><span class="ev-in">' + _dur(ms - w.endMs) + ' ago</span></div></div>').join('');
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  function _counts(ms) {
    return {
      now: windows(ms, ms + 1).filter(w => w.startMs <= ms && ms < w.endMs).length,
      upcoming: windows(ms, ms + UPCOMING_DAYS * DAY).filter(w => w.startMs > ms).length,
      recent: windows(ms - RECENT_DAYS * DAY, ms).filter(w => w.endMs <= ms).length,
    };
  }

  function render() {
    const el = root.document.getElementById('events-modal');
    if (!el || el.style.display === 'none') return;
    const ms = _now(), c = _counts(ms);
    el.querySelector('.ar-tabs').innerHTML = TABS.map(([key, icon, label]) => {
      const n = c[key];
      return '<button type="button" role="tab" class="ar-tab' + (_tab === key ? ' active' : '') + '" data-tab="' + key + '" aria-selected="' + (_tab === key) + '" title="' + label + '">'
        + icon + '<span class="ar-tab-label"> ' + label + '</span>' + (n ? ' <span class="ar-tab-n">' + n + '</span>' : '') + '</button>';
    }).join('');
    const body = el.querySelector('.ev-body'), top = body.scrollTop;
    body.innerHTML = _tab === 'upcoming' ? _upcomingHtml(ms) : _tab === 'seasons' ? _seasonsHtml() : _tab === 'recent' ? _recentHtml(ms) : _nowHtml(ms);
    body.scrollTop = top;
  }

  function _ensureModal() {
    let el = root.document.getElementById('events-modal');
    if (el) return el;
    el = root.document.createElement('div');
    el.id = 'events-modal';
    el.className = 'qm-backdrop ev-backdrop';
    el.style.display = 'none';
    el.innerHTML = '<div class="qm-card ar-card ev-card-shell" role="dialog" aria-modal="true" aria-labelledby="ev-title">'
      + '<div class="qm-header"><div class="ar-head"><div class="qm-title" id="ev-title">📅 Events</div>'
      + '<div class="ar-away">Timed events change the realm while they run. Times are shown in your local time.</div></div>'
      + '<button type="button" class="qm-close" data-close title="Close">✕</button></div>'
      + '<div class="ar-tabs" role="tablist"></div><div class="qm-body ev-body"></div></div>';
    el.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t === el || t.closest('[data-close]')) { close(); return; }
      const tab = t.closest('[data-tab]');
      if (tab) { _tab = tab.dataset.tab; el.querySelector('.ev-body').scrollTop = 0; render(); return; }
      const rem = t.closest('[data-remind]');
      if (rem) {
        const on = toggleReminder(rem.dataset.remind);
        if (on && typeof root.showToastNotification === 'function') root.showToastNotification('🔔 We\'ll remind you when it starts (while the game is open).', 'default');
        render();
      }
    });
    root.document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && el.style.display !== 'none') close(); });
    root.document.body.appendChild(el);
    return el;
  }

  function open(tab) {
    const el = _ensureModal();
    _tab = TABS.some(x => x[0] === tab) ? tab : (_counts(_now()).now ? 'now' : 'upcoming');
    el.style.display = 'flex';
    el.querySelector('.ev-body').scrollTop = 0;
    render();
    clearInterval(_timer);
    _timer = setInterval(render, 30 * 1000);   // countdowns
    if (root.KWHudClock && root.KWHudClock.close) root.KWHudClock.close();
  }
  function close() {
    const el = root.document.getElementById('events-modal');
    if (el) el.style.display = 'none';
    clearInterval(_timer); _timer = null;
  }

  function start() {
    if (_remindTimer) return;
    _lastRemindCheck = _wall();
    _remindTimer = setInterval(checkReminders, REMIND_TICK_MS);
  }

  root.KWEventsPanel = { open, close, render, windows, toggleReminder, hasReminder, checkReminders, start,
    _setTab(t) { _tab = t; render(); } };
  root.openTimedEvents = open;

  if (root.document && !root.__KW_NO_AUTOSTART) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : this);
