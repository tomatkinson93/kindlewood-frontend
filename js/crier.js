// ══════════════════════════════════════════════════════════════════════════
//  KWCrier — the town crier (docs/HOME_SCENE.md Part F, F.11; step 24).
//
//  At dawn and at dusk a villager stands by the Guild Hall with a bell.
//  Clicking them opens today's news: the weather, anything lost, what is
//  being built, the town's upkeep and charm, who was born or died, and the
//  last day's chronicle. The bell has a mark when there is something the
//  player has not seen. At any hour the same news is on the Guild Hall's
//  menu ("Today's news").
//
//  It reads only: everything shown is something the game already knows.
//  "Seen" is kept on this device; it changes nothing in the game.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const DAY_MS = 86400000, TICK_MS = 4000, STAND_MS = 240000, SEEN_KEY = 'kw_crier_seen';
  const SPELLS = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const S = { timer: null, on: false, mark: null };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // When the crier is out: dawn and dusk.
  const outAt = phase => phase === 'dawn' || phase === 'dusk';
  // The weather in a line. `w`: the town's weather from the server; `label(kind)`.
  function weatherLine(w, label) {
    if (!w || !Array.isArray(w.spells) || !w.spells.length) return '';
    const name = k => (label ? label(k) : k), same = w.spells.every(k => k === w.spells[0]);
    if (same) return `${name(w.spells[0])} all day.`;
    const parts = [];
    w.spells.forEach((k, i) => { const last = parts[parts.length - 1]; if (last && last.kind === k) last.to = i; else parts.push({ kind: k, from: i, to: i }); });
    return parts.map(p => `${SPELLS[p.from] || ''}${p.to > p.from ? ' to ' + String(SPELLS[p.to] || '').toLowerCase() : ''}: ${String(name(p.kind)).toLowerCase()}`).join(' · ') + '.';
  }
  const ago = (at, now) => { const m = Math.max(0, Math.round((now - new Date(at).getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  // The news. `o`: { entries (chronicle, newest first), now, seenAt, weather,
  // lost, building: [lines], upkeep, charm }. → { today: [{ icon, text }],
  // lives: [line], rest: [line], fresh } where a line is { text, when, fresh, kind }.
  function newsOf(o) {
    const now = o.now || 0, seen = o.seenAt || 0;
    const today = [];
    if (o.weather) today.push({ icon: o.weatherIcon || '🌤️', text: o.weather });
    if (o.lost) today.push({ icon: '🔎', text: o.lost });
    for (const b of o.building || []) today.push({ icon: '🏗️', text: b });
    if (o.upkeep) today.push({ icon: '🧰', text: o.upkeep });
    if (o.charm) today.push({ icon: '🌷', text: o.charm });
    const recent = (o.entries || []).filter(e => e && e.text && now - new Date(e.at).getTime() < DAY_MS && now - new Date(e.at).getTime() > -60000)
      .map(e => ({ text: e.text, kind: e.kind, when: ago(e.at, now), fresh: new Date(e.at).getTime() > seen }));
    const isLife = e => e.kind === 'birth' || e.kind === 'death';
    return { today, lives: recent.filter(isLife), rest: recent.filter(e => !isLife(e)).slice(0, 14), fresh: recent.filter(e => e.fresh).length };
  }
  const lineHtml = e => `<p class="kwcr-line${e.fresh ? ' kwcr-fresh' : ''}">${e.fresh ? '<span class="kwcr-dot" title="New since you last looked" aria-label="New"></span>' : ''}${esc(e.text)} <span class="kwcr-when">${esc(e.when)}</span></p>`;
  function html(n) {
    const sec = (title, body) => (body ? `<h3 class="kwcr-h">${esc(title)}</h3>${body}` : '');
    return '<div class="kwcr">'
      + sec('Today', n.today.map(t => `<p class="kwcr-today"><span aria-hidden="true">${t.icon}</span> ${esc(t.text)}</p>`).join(''))
      + sec('Born and died', n.lives.map(lineHtml).join(''))
      + sec('The last day', n.rest.length ? n.rest.map(lineHtml).join('') : (n.lives.length ? '' : '<p class="kwcr-none">A quiet day: nothing for the chronicle yet.</p>'))
      + '</div>';
  }

  // ── What the game knows ─────────────────────────────────────────────────
  const clock = () => (global.KWClock && global.KWClock.now ? global.KWClock.now() : Date.now());
  const seenAt = () => { try { return Number(global.localStorage.getItem(SEEN_KEY)) || 0; } catch (_) { return 0; } };
  const markSeen = t => { try { global.localStorage.setItem(SEEN_KEY, String(t)); } catch (_) { /* private mode */ } };
  function gather() {
    const g = global.gameData, w = g && g.settlement && g.settlement.weather, W = global.KWWeather;
    const B = global.KWBuild, U = global.KWUpkeep, D = global.KWDecor, L = global.KWLost, LS = global.KWLifeScenes;
    let building = [];
    try { building = B && B.sites ? B.sites().slice(0, 4).map(s => `${s.label || 'A building'}: ${Math.round((B.pct ? B.pct(s.id) : 0) * 100)}% built`) : []; } catch (_) { building = []; }
    let upkeep = '';
    try { upkeep = U && U.data && U.data.on ? U.data.line : ''; } catch (_) { upkeep = ''; }
    return newsOf({
      entries: LS && LS.recent ? LS.recent() : [], now: clock(), seenAt: seenAt(),
      weather: weatherLine(w, W ? k => W.label(k) : null), weatherIcon: W && w ? W.icon(w.today) : null,
      lost: L && L.line ? L.line() : '', building, upkeep,
      charm: D && D.data && D.data.charm && D.data.charm.score ? D.data.charm.line : '',
    });
  }

  // ── The window ──────────────────────────────────────────────────────────
  async function open() {
    const W = global.KWWindow;
    if (!W) return;
    try { if (global.KWLifeScenes && global.KWLifeScenes.read) await global.KWLifeScenes.read(); } catch (_) { /* what we have */ }
    const n = gather(), town = (global.gameData && global.gameData.settlement && global.gameData.settlement.name) || 'the town';
    W.close('crier');
    W.open({ id: 'crier', icon: '🔔', size: 'M', title: "Today's news", subtitle: `Hear ye: the news of ${town}`, render(body) { body.innerHTML = html(n); } });
    markSeen(clock());
    S.mark = null;
  }

  // ── In the scene ────────────────────────────────────────────────────────
  const homeOpen = () => typeof global._svIsOpen === 'function' && global._svIsOpen();
  function tick() {
    const C = global.KWCast;
    if (!C || !C.playScript || !homeOpen() || (doc && doc.hidden)) return;
    const inTown = (global._svActiveAreaName ? global._svActiveAreaName() : 'town') === 'town';
    const want = outAt(C.phase) && inTown && !(global._svIsBuildMode && global._svIsBuildMode());
    if (!want) { if (S.on && C.stopScript) C.stopScript('crier'); S.on = false; return; }
    const fresh = gather().fresh > 0, mark = fresh ? '🔔❗' : '🔔';
    if (S.on && C.scriptOn && C.scriptOn('crier')) {
      if (S.mark !== mark && C.scriptSay) { C.scriptSay('crier', mark); S.mark = mark; }
      return;
    }
    const who = C.playScript('crier', [{ door: 'guild_hall', dx: -96, dy: 34 }, { wait: STAND_MS, say: mark }], c => c.stage === 'elder' || !!c.elder, { onClick: open, label: "The town crier: today's news" });
    S.on = who != null; S.mark = S.on ? mark : null;
  }
  if (doc) {
    S.timer = setInterval(tick, TICK_MS);
    global.addEventListener('kw:home', e => { if (!(e.detail && e.detail.open)) S.on = false; });
  }

  global.KWCrier = {
    open, STAND_MS,
    get fresh() { return gather().fresh; },
    _outAt: outAt, _weatherLine: weatherLine, _newsOf: newsOf, _html: html, _tick: tick,
  };
})(typeof window !== 'undefined' ? window : globalThis);
