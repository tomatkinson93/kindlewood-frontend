// ══════════════════════════════════════════════════════════════════════════
//  KWLost — a lost thing each day (docs/HOME_SCENE.md Part F, F.8; step 22).
//
//  Once a game day a villager has lost one small thing somewhere in Home: in
//  Town, the Neighbourhood or the Outskirts. The player spots it and clicks
//  it; the server gives it back (lib/lost.js there): the owner is a little
//  happier and the town gets a small thank-you. One per town per day,
//  counted on the server, so a second device gains nothing.
//
//  This file reads the day's thing (GET /api/lost), draws it where its seed
//  says (the same place on every device), sends the find, and tells the
//  owner's thought line where to look. Nothing is decided here. The thing is
//  an emoji until its picture is in the props manifest (docs/ART_GUIDE.md §8,
//  batch M: lost_basket, lost_ribbon, lost_purse, lost_toy).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const AREAS = ['town', 'neighbourhood', 'outskirts'];
  const AREA_NAME = { town: 'in Town', neighbourhood: 'in the Neighbourhood', outskirts: 'in the Outskirts' };
  const TRIES = 14, PAINT_MS = 1500;
  const S = { thing: null, loading: null, busy: false, timer: null };
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const first = n => String(n || '').split(' ')[0];

  // ── Rules (pure) ────────────────────────────────────────────────────────
  function seeded(n) {
    let a = (n >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // Where a thing lies. `ground(area, rand)` → { x, y } in percent; `hidden(area, p)`
  // → true when something stands over that point (then the next seeded point
  // is tried). → { area, x, y }. The same seed and town give the same place. Pure.
  function placeOf(seed, ground, hidden) {
    const r = seeded(Number(seed) || 1), area = AREAS[Math.floor(r() * AREAS.length)];
    let p = ground(area, r);
    for (let i = 0; i < TRIES && hidden && hidden(area, p); i++) p = ground(area, r);
    return { area, x: p.x, y: p.y };
  }
  // The area alone (the hint does not need the scene to be drawn).
  const areaOf = seed => AREAS[Math.floor(seeded(Number(seed) || 1)() * AREAS.length)];
  // What the owner is thinking while it is lost, or null.
  function hintFor(thing, citizenId) {
    if (!thing || thing.found || Number(thing.owner_id) !== Number(citizenId)) return null;
    return `Has lost ${thing.label} somewhere ${AREA_NAME[areaOf(thing.seed)]}.`;
  }
  // The line for the news (js/crier.js).
  function line(thing) {
    if (!thing) return '';
    return thing.found ? `${first(thing.owner_name)} has ${thing.label} back.` : `${first(thing.owner_name)} has lost ${thing.label} somewhere ${AREA_NAME[areaOf(thing.seed)]}.`;
  }
  // What finding it gave, in words. `r`: { food?, wealth?, happiness }.
  function rewardLine(thing) {
    const r = (thing && thing.reward) || {}, bits = [];
    if (r.happiness) bits.push(`${first(thing.owner_name)} +${r.happiness} happiness`);
    if (r.food) bits.push(`+${r.food} food`);
    if (r.wealth) bits.push(`+${r.wealth} wealth`);
    return bits.join(' · ');
  }

  // ── Data ────────────────────────────────────────────────────────────────
  const signedIn = () => { try { return !!global.localStorage.getItem('kw_token'); } catch (_) { return false; } };
  function take(t) { S.thing = t || null; paint(); try { global.dispatchEvent(new global.CustomEvent('kw:lost', { detail: { thing: S.thing } })); } catch (_) { /* old browser */ } }
  async function load() {
    if (!signedIn() || typeof global.apiFetch !== 'function') return null;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      try { const r = await global.apiFetch('/api/lost'); if (r.ok) { const d = await r.json(); if (d && d.ok) take(d.thing); } } catch (_) { /* later */ }
      S.loading = null;
      return S.thing;
    })();
    return S.loading;
  }
  async function giveBack() {
    if (S.busy || !S.thing || S.thing.found) return;
    S.busy = true;
    const el = doc.querySelector('#settlement-view .kwl-thing'), at = el ? { x: el.offsetLeft, y: el.offsetTop } : null;
    try {
      const r = await global.apiFetch('/api/lost/return', { method: 'POST' }), d = await r.json().catch(() => ({}));
      if (r.ok && d.ok && d.thing) {
        const C = global.KWCast, t = d.thing;
        take(t);
        if (C && C.floatAt && at) C.floatAt(at.x, at.y - 30, `${t.icon} Found!`, 'good');
        if (C && C.playPraise && t.reward && t.reward.happiness) setTimeout(() => C.playPraise(t.owner_id, t.reward.happiness), 700);
        toast(`You found ${t.label} and gave it back to ${first(t.owner_name)}. ${rewardLine(t)}`, 'success');
        if (typeof global.refreshResources === 'function') { try { global.refreshResources(); } catch (_) { /* later */ } }
      } else {
        toast(d.error || 'That did not work. Try again.', 'error');
        load();   // found on another device, or the day has turned
      }
    } catch (_) { toast('That did not work. Try again.', 'error'); }
    S.busy = false;
  }

  // ── The scene ───────────────────────────────────────────────────────────
  const homeOpen = () => typeof global._svIsOpen === 'function' && global._svIsOpen();
  const activeArea = () => (global._svActiveAreaName ? global._svActiveAreaName() : 'town');
  // Is a point (percent of the layer) under a building's picture?
  function covered(L, p) {
    const lr = L.getBoundingClientRect();
    if (!lr.width || !lr.height) return false;
    const x = lr.left + p.x / 100 * lr.width, y = lr.top + p.y / 100 * lr.height;
    for (const a of L.querySelectorAll(':scope > .sv-slot:not([hidden]) .kwh-art, :scope > .sv-slot:not([hidden]) .kwh-plate, :scope > .kwg-prop, :scope > .kwd-item, :scope > .kwm-cart')) {
      const r = a.getBoundingClientRect();
      if (x > r.left - 14 && x < r.right + 14 && y > r.top - 8 && y < r.bottom + 14) return true;
    }
    return false;
  }
  function paint() {
    if (!doc) return;
    const view = doc.getElementById('settlement-view');
    if (!view) return;
    const old = view.querySelector('.kwl-thing'), t = S.thing, C = global.KWCast;
    const L = homeOpen() ? view.querySelector('.sv-fg-layer:not(.sv-area-hidden)') : null;
    if (!t || t.found || !L || !L.clientHeight || !(C && C._groundPoint)) { if (old) old.remove(); return; }
    const area = activeArea();
    if (areaOf(t.seed) !== area) { if (old) old.remove(); return; }
    const hasPic = !!(global.KWGround && global.KWGround.picture && global.KWGround.picture('lost_' + t.kind));
    if (old && old.parentNode === L && old.getAttribute('data-id') === String(t.id) && !!old.querySelector('.kwl-pic') === hasPic) return;   // (its picture may arrive after it was drawn)
    if (old) old.remove();
    const p = placeOf(t.seed, (a, r) => C._groundPoint(a, r), (a, pt) => covered(L, pt));
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'kwl-thing'; b.setAttribute('data-id', String(t.id));
    b.setAttribute('aria-label', `Something on the ground: ${t.label}. Give it back to ${first(t.owner_name)}.`);
    b.title = `${t.label[0].toUpperCase() + t.label.slice(1)}: someone has lost this`;
    b.style.left = p.x.toFixed(2) + '%'; b.style.top = p.y.toFixed(2) + '%';
    b.style.zIndex = String(Math.max(1, Math.round(p.y * 10)));
    // Its picture, when the art is in (props manifest: lost_basket, lost_ribbon, lost_purse, lost_toy); else the emoji.
    const pic = global.KWGround && global.KWGround.picture ? global.KWGround.picture('lost_' + t.kind) : null;
    b.innerHTML = (pic ? `<span class="kwl-pic" aria-hidden="true">${pic.html}</span>` : `<span class="kwl-icon" aria-hidden="true">${t.icon}</span>`) + '<i class="kwl-glint" aria-hidden="true"></i>';
    b.addEventListener('click', e => { e.stopPropagation(); giveBack(); });
    L.appendChild(b);
  }

  if (doc) {
    S.timer = setInterval(() => { if (homeOpen() && !doc.hidden) paint(); }, PAINT_MS);
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) { load(); setTimeout(paint, 80); } });
    // A new day: ask again when the old thing's day has run out.
    setInterval(() => { const t = S.thing; if (t && t.resets_at && Date.now() > t.resets_at && homeOpen() && !doc.hidden) load(); }, 60000);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(load, 1500)); else setTimeout(load, 1500);
  }

  global.KWLost = {
    AREAS, load,
    get thing() { return S.thing; },
    hintFor: id => hintFor(S.thing, id),
    line: () => line(S.thing),
    // Live: found on another device (js/realtime.js).
    onEvent: ev => { if (ev && ev.thing) take(ev.thing); else load(); },
    _placeOf: placeOf, _areaOf: areaOf, _hintFor: hintFor, _line: line, _rewardLine: rewardLine, _paint: paint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
