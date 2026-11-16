'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  KWCast — the town's real villagers walking the Home scene
//  (docs/HOME_SCENE.md §3.2–3.4, build step 5).
//
//  The cast: up to 14 living citizens who are in town (8 on a phone), chosen
//  from the area showing: Town has people who work in town buildings, the
//  unemployed, children and elders; the Outskirts have those who work out
//  there. Anyone with an open moment comes first; then one per family in
//  turn; a child only together with a parent; an elder if the town has one.
//
//  They walk in straight lines over each area's ground (GROUND, percent of
//  the layer) between buildings' doors, a few named spots and open ground,
//  and stand idle for 3–10 s in between. Depth is z-index from the foot, for
//  villagers and buildings alike. Every minute or so one walks into a
//  building and someone else comes out; someone who leaves town (a quest, a
//  death) walks to the nearest door and is gone. Nobody appears from thin
//  air except when Home first opens.
//
//  Purely a picture: nothing here changes the game or tells the server.
//  Errands, chat, children following and night are step 6; clicking a
//  villager is step 7.
//
//  Drawing comes from js/villagers.js (sheets, paint). Hooks arrive through
//  KWVillagers.sceneShown / sceneHidden / setPaused from the scene.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  const doc = global.document;

  // ── Pure rules (verify/scene_proofs.js) ─────────────────────────────────

  // The ground people may walk on, per area, in percent of the layer.
  // Both areas share today's backdrop, so one shape for now: the meadow in
  // front, dipping below the river on the right. Redraw with the new art.
  const MEADOW = [[4, 72], [34, 68], [48, 72], [54, 78], [76, 79], [90, 75], [96, 75], [96, 94], [4, 94]];
  const GROUND = { town: MEADOW, outskirts: MEADOW };
  // Named spots worth walking to (percent). Placeholders until the new art.
  const SPOTS = {
    town:      [{ id: 'well', x: 30, y: 84 }, { id: 'bench', x: 19, y: 80 }, { id: 'riverbank', x: 62, y: 81 }, { id: 'square', x: 46, y: 90 }],
    outskirts: [{ id: 'field-edge', x: 24, y: 86 }, { id: 'riverbank', x: 66, y: 82 }, { id: 'track', x: 44, y: 80 }],
  };
  const CAP = { desktop: 14, phone: 8 };
  // A job's building (the server's ROLE_BUILDING_MAP, plus foragers).
  const ROLE_BUILDING = { farmer: 'farm', woodcutter: 'lumber_camp', scout: 'scout_post', miner: 'mine', fisher: 'fishing_post',
    soldier: 'watchtower', archer: 'watchtower', tavernkeep: 'tavern', blacksmith: 'smithy', jeweller: 'jeweller',
    carpenter: 'workshop', smelter: 'smelter', scholar: 'library', forager: 'forager_hut' };
  const SPEED = { adult: 40, elder: 30, child: 55 };
  const IDLE_MS = [3000, 10000];
  const ROTATE_MS = 60000;
  // A family's look: gentle filters (a bigger hue turn made fur pink or
  // green, since it moves the whole sprite). The first is none.
  const TINTS = ['', 'hue-rotate(10deg)', 'hue-rotate(-9deg) saturate(0.9)', 'saturate(0.8) brightness(1.04)', 'brightness(0.92) saturate(1.1)', 'hue-rotate(16deg) saturate(0.85)'];

  const living = c => c && c.life_stage !== 'deceased' && c.stage !== 'deceased';
  const isChild = c => c.stage === 'child' || c.stage === 'youth' || (!c.stage && c.life_stage === 'child');
  const isElder = c => c.stage === 'elder' || !!c.elder;
  const parentsOf = c => { const p = c.parent_ids; return (Array.isArray(p) ? p : typeof p === 'string' ? (() => { try { return JSON.parse(p); } catch (_) { return []; } })() : []).map(Number); };

  // Which area someone belongs to. `builtArea(buildingId)` → the area the
  // building stands in, or null when it isn't built (or isn't placed).
  function areaOf(c, builtArea) {
    if (isChild(c) || isElder(c)) return 'town';
    const b = ROLE_BUILDING[c.role];
    return (b && builtArea(b)) || 'town';
  }

  // → ids, in the order they were chosen. opts: { cap, area, areaOf(c),
  // away(c), momentIds: [ids], rand }.
  function pickCast(citizens, opts) {
    const rand = opts.rand || Math.random;
    const away = opts.away || (() => null);
    const pool = citizens.filter(c => living(c) && !away(c) && opts.areaOf(c) === opts.area);
    const byId = new Map(pool.map(c => [Number(c.id), c]));
    const out = [], has = id => out.includes(id), room = n => out.length + n <= opts.cap;
    const parentIn = c => parentsOf(c).some(has);
    const add = c => {
      const id = Number(c.id);
      if (has(id)) return true;
      if (!isChild(c)) { if (!room(1)) return false; out.push(id); return true; }
      if (parentIn(c)) { if (!room(1)) return false; out.push(id); return true; }
      const p = parentsOf(c).map(i => byId.get(i)).find(Boolean);
      if (!p || isChild(p) || !room(2)) return false;   // never a child alone
      out.push(Number(p.id), id);
      return true;
    };
    // 1. Anyone with an open moment.
    for (const id of opts.momentIds || []) { const c = byId.get(Number(id)); if (c) add(c); }
    // 2. An elder, if there is one.
    const elders = pool.filter(isElder);
    if (elders.length && !out.some(id => isElder(byId.get(id)))) add(elders[Math.floor(rand() * elders.length)]);
    // 3. One grown-up per family in turn, families in a shuffled order.
    const fams = new Map();
    for (const c of pool) if (!isChild(c)) { const k = c.family_id != null ? 'f' + c.family_id : 'c' + c.id; (fams.get(k) || fams.set(k, []).get(k)).push(c); }
    const groups = [...fams.values()].map(g => shuffle(g, rand));
    shuffle(groups, rand);
    for (let i = 0; out.length < opts.cap && groups.some(g => i < g.length); i++) for (const g of groups) { if (g[i]) add(g[i]); if (out.length >= opts.cap) break; }
    // 4. Children, with a parent who is there (or comes along).
    for (const c of shuffle(pool.filter(isChild), rand)) { if (out.length >= opts.cap) break; add(c); }
    return out;
  }
  function shuffle(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function inPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // A random point on the ground (percent).
  function groundPoint(area, rand) {
    const poly = GROUND[area] || GROUND.town;
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let k = 0; k < 50; k++) {
      const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
      if (inPolygon(x, y, poly)) return { x, y };
    }
    return { x: (x0 + x1) / 2, y: y1 - 3 };
  }
  // The nearest point on the ground to (x, y): the point itself if it is
  // inside, else the closest of a few steps toward the middle of the band.
  function onGround(area, x, y) {
    const poly = GROUND[area] || GROUND.town;
    if (inPolygon(x, y, poly)) return { x, y };
    const cy = 86;
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const px = Math.min(95, Math.max(5, x)), py = y + (cy - y) * t;
      if (inPolygon(px, py, poly)) return { x: px, y: py };
    }
    return { x: 50, y: cy };
  }

  // A building's door in layer pixels, from where its art is drawn (`rect`,
  // relative to the layer) and the art itself: the manifest's door scaled to
  // the drawn size, else the placeholder hut's door, else the bottom centre.
  function doorPoint(rect, art) {
    if (art && art.w && art.h && art.door) return { x: rect.left + art.door.x * rect.width / art.w, y: rect.top + art.door.y * rect.height / art.h };
    if (art && art.hut) return { x: rect.left + rect.width * 55 / 120, y: rect.top + rect.height * 98 / 105 };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height };
  }

  // A seeded random source (mulberry32), so tests can replay a scene.
  function seeded(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // ── The scene ───────────────────────────────────────────────────────────
  const S = { layer: null, area: 'town', shown: false, paused: false, raf: 0, last: 0, vs: new Map(), doors: [], sig: '', syncT: 0, rotateT: 0, rand: Math.random, ms: 0 };
  const V = () => global.KWVillagers;
  const cits = () => { const d = typeof citizensData !== 'undefined' ? citizensData : global.citizensData; return Array.isArray(d) ? d : []; };   // eslint-disable-line no-undef
  const awayOf = c => (typeof global.citizenAway === 'function' ? global.citizenAway(c) : null);
  const isPhone = () => !!(doc.body && doc.body.classList.contains('kw-shell'));
  const townSpecies = () => { const gd = global.gameData; return (gd && (gd.species || (gd.settlement && gd.settlement.species))) || 'Mice'; };
  const momentIds = () => { try { return (global.KWMoments ? global.KWMoments.list() : []).flatMap(m => (m.subject && m.subject.citizen_ids) || []); } catch (_) { return []; } };
  const W = () => S.layer.clientWidth, H = () => S.layer.clientHeight;
  const px = p => ({ x: p.x / 100 * W(), y: p.y / 100 * H() });

  // The area each built building stands in (from the scene's slots).
  function builtArea(buildingId) {
    const el = doc.querySelector('#settlement-view .sv-fg-layer [data-kwh="' + buildingId + '"]');
    if (!el) return null;
    const layer = el.closest('.sv-fg-layer');
    return layer && layer.id === 'sv-layer-fg-outskirts' ? 'outskirts' : 'town';
  }

  // Doors and spots for the area showing, in layer pixels; and each slot's
  // depth from its foot (the bottom of what it draws).
  function survey() {
    if (!S.layer) return;
    const lr = S.layer.getBoundingClientRect();
    const sx = lr.width / (S.layer.clientWidth || 1), sy = lr.height / (S.layer.clientHeight || 1);   // parallax never scales; guard anyway
    S.doors = [];
    S.layer.querySelectorAll(':scope > .sv-slot').forEach(slot => {
      if (slot.hidden) return;
      const btn = slot.querySelector('[data-kwh]');
      const artEl = btn && (btn.querySelector('.kwh-img') || btn.querySelector('.kwh-hut') || btn.querySelector('.kwh-prop-art'));
      const box = (artEl || slot).getBoundingClientRect();
      const rect = { left: (box.left - lr.left) / sx, top: (box.top - lr.top) / sy, width: box.width / sx, height: box.height / sy };
      const foot = rect.top + rect.height;
      if (!slot.classList.contains('sv-dragging')) slot.style.zIndex = String(depth(foot));
      if (!btn || btn.classList.contains('kwh-prop')) return;
      const key = btn.getAttribute('data-kwh');
      const art = artEl && artEl.classList.contains('kwh-img') && global.KWHome ? global.KWHome.art(key) : artEl && artEl.classList.contains('kwh-hut') ? { hut: true } : null;
      const d = doorPoint(rect, art);
      const g = onGround(S.area, d.x / W() * 100, d.y / H() * 100);
      S.doors.push({ key, x: g.x / 100 * W(), y: g.y / 100 * H() });
    });
  }
  const depth = footY => Math.max(1, Math.min(1000, Math.round(footY / (H() || 1) * 1000)));

  // ── Villagers ───────────────────────────────────────────────────────────
  function make(c, at, emerging) {
    const v = { id: Number(c.id), c, el: V().makeFigure(), x: at.x, y: at.y, tx: at.x, ty: at.y, state: 'idle', until: 0, t: S.rand() * 2000, dir: 's',
      child: isChild(c), elder: isElder(c) };
    v.speed = v.child ? SPEED.child : v.elder ? SPEED.elder : SPEED.adult;
    v.until = performanceNow() + IDLE_MS[0] * S.rand();
    const tint = TINTS[Math.abs(Number(c.family_id) || 0) % TINTS.length];
    if (tint) v.el.firstChild.style.filter = tint;
    v.el.classList.add('kwv-cit');
    v.el.setAttribute('data-cid', String(v.id));
    if (emerging) { v.el.classList.add('kwv-gone'); requestFrame(() => v.el.classList.remove('kwv-gone')); }
    S.layer.appendChild(v.el);
    S.vs.set(v.id, v);
    return v;
  }
  const performanceNow = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
  const requestFrame = f => (global.requestAnimationFrame ? global.requestAnimationFrame(f) : setTimeout(f, 16));

  function nearestDoor(x, y) {
    let best = null, d = Infinity;
    for (const o of S.doors) { const k = (o.x - x) ** 2 + (o.y - y) ** 2; if (k < d) { d = k; best = o; } }
    return best;
  }
  // Somewhere to go: a door (2 in 5), a named spot (1 in 5), or open ground.
  function nextTarget() {
    const r = S.rand();
    if (r < 0.4 && S.doors.length) { const o = S.doors[Math.floor(S.rand() * S.doors.length)]; return { x: o.x + (S.rand() - 0.5) * 24, y: o.y + 4 + S.rand() * 8 }; }
    const spots = SPOTS[S.area] || [];
    if (r < 0.6 && spots.length) { const s = spots[Math.floor(S.rand() * spots.length)]; return px({ x: s.x + (S.rand() - 0.5) * 3, y: s.y + (S.rand() - 0.5) * 2 }); }
    return px(groundPoint(S.area, S.rand));
  }

  // Leaving: walk to the nearest door, fade, gone.
  function leave(v) {
    if (v.state === 'leave' || v.state === 'gone') return;
    const d = nearestDoor(v.x, v.y);
    v.state = 'leave';
    if (d) { v.tx = d.x; v.ty = d.y; } else { v.tx = v.x; v.ty = v.y; }
  }
  function drop(v) {
    v.state = 'gone';
    v.el.classList.add('kwv-gone');
    setTimeout(() => { v.el.remove(); S.vs.delete(v.id); }, 320);
  }

  // Choose the cast and bring the scene in line with it. `first`: Home just
  // opened, so people start spread out on the ground (some at doors).
  function recast(first) {
    if (!S.layer || !V() || !V().meta) return;
    survey();
    const cap = isPhone() ? CAP.phone : CAP.desktop;
    const all = cits();
    const want = pickCast(all, { cap, area: S.area, areaOf: c => areaOf(c, builtArea), away: awayOf, momentIds: momentIds(), rand: S.rand });
    const byId = new Map(all.map(c => [Number(c.id), c]));
    // Gone from the cast (left town, died, now away): walk off.
    for (const v of S.vs.values()) {
      const c = byId.get(v.id);
      if (!want.includes(v.id) && v.state !== 'leave' && v.state !== 'gone') {
        if (first) { v.el.remove(); S.vs.delete(v.id); } else leave(v);
      } else if (c) v.c = c;
    }
    // New to the cast: out of a door (or anywhere, on opening).
    const present = () => [...S.vs.values()].filter(x => x.state !== 'gone' && x.state !== 'leave').length;
    for (const id of want) {
      if (S.vs.has(id) || present() >= cap) continue;
      const c = byId.get(id);
      if (!c) continue;
      const door = S.doors.length ? S.doors[Math.floor(S.rand() * S.doors.length)] : null;
      const at = first || !door ? px(groundPoint(S.area, S.rand)) : { x: door.x, y: door.y };
      make(c, at, !first);
    }
    S.sig = signature(all);
  }
  // What a change in the town looks like to the cast: who is alive and in town.
  function signature(all) {
    return all.filter(living).map(c => c.id + (awayOf(c) ? 'a' : '') + ':' + (c.role || '') + ':' + (c.stage || '')).join(',') + '|' + momentIds().join(',');
  }
  // Now and then one walks into a building and someone else comes out.
  function rotate() {
    const cap = isPhone() ? CAP.phone : CAP.desktop;
    const all = cits();
    const pool = all.filter(c => living(c) && !awayOf(c) && areaOf(c, builtArea) === S.area && !isChild(c) && !S.vs.has(Number(c.id)));
    const moments = momentIds().map(Number);
    const out = [...S.vs.values()].filter(v => v.state !== 'leave' && v.state !== 'gone' && !v.child && !moments.includes(v.id)
      && ![...S.vs.values()].some(k => k.child && parentsOf(k.c).includes(v.id)));
    if (!pool.length || !out.length || S.vs.size > cap) return;
    leave(out[Math.floor(S.rand() * out.length)]);
    const inn = pool[Math.floor(S.rand() * pool.length)];
    const door = S.doors.length ? S.doors[Math.floor(S.rand() * S.doors.length)] : null;
    if (door) setTimeout(() => { if (S.shown && !S.paused && !S.vs.has(Number(inn.id))) make(inn, { x: door.x, y: door.y }, true); }, 2500);
  }

  // ── The loop ────────────────────────────────────────────────────────────
  function step(v, dt, now) {
    if (v.state === 'gone') return;
    v.t += dt;
    if (v.state === 'idle') {
      if (now >= v.until) { const t = nextTarget(); v.tx = t.x; v.ty = t.y; v.state = 'walk'; }
      return;
    }
    const dx = v.tx - v.x, dy = v.ty - v.y, dist = Math.hypot(dx, dy);
    const stepPx = v.speed * dt / 1000;
    if (dist <= stepPx) {
      v.x = v.tx; v.y = v.ty;
      if (v.state === 'leave') { drop(v); return; }
      v.state = 'idle';
      v.dir = 's';
      v.until = now + IDLE_MS[0] + S.rand() * (IDLE_MS[1] - IDLE_MS[0]);
      return;
    }
    v.x += dx / dist * stepPx; v.y += dy / dist * stepPx;
    v.dir = V().dirFromVector(dx, dy);
  }
  function draw(v, still) {
    const meta = V().meta;
    const walking = !still && (v.state === 'walk' || v.state === 'leave');
    const s = V().spriteFor(meta, v.c.species || townSpecies(), walking ? 'walk' : 'idle', still ? 's' : v.dir);
    if (!s) return;
    const frame = still ? 0 : Math.floor(v.t / s.ms) % s.frames;
    V().paint(v.el, s, frame, v.child ? 0.75 : 1, v.x, v.y);
    v.el.style.zIndex = String(depth(v.y));
  }
  function tick(now) {
    S.raf = 0;
    if (!running()) return;
    const dt = Math.min(100, S.last ? now - S.last : 0);
    S.last = now;
    if ((S.syncT += dt) > 5000) {   // the town changes: refresh the cast
      S.syncT = 0;
      survey();
      if (signature(cits()) !== S.sig) recast(false);
    }
    if ((S.rotateT += dt) > ROTATE_MS) { S.rotateT = 0; rotate(); }
    const t0 = performanceNow();
    for (const v of S.vs.values()) { step(v, dt, now); draw(v, false); }
    S.ms = S.ms * 0.95 + (performanceNow() - t0) * 0.05;   // the loop's own cost (target: under 2 ms)
    S.raf = requestFrame(tick);
  }
  const running = () => S.shown && !S.paused && S.layer && !doc.hidden && !(V() && V().reducedMotion());

  function clear() { for (const v of S.vs.values()) v.el.remove(); S.vs.clear(); }
  function start() {
    if (!S.shown || S.paused || !S.layer || !V()) return;
    V().injectStyles();
    V().load().then(() => {
      if (!S.shown || S.paused) return;
      // Wait a frame for the scene's buttons to be drawn and measured.
      requestFrame(() => {
        if (!S.shown || S.paused) return;
        if (!S.vs.size) recast(true); else survey();
        if (V().reducedMotion()) { for (const v of S.vs.values()) draw(v, true); return; }   // standing still
        if (!S.raf) { S.last = 0; S.raf = requestFrame(tick); }
      });
    });
  }
  function stop() { if (S.raf) { (global.cancelAnimationFrame || clearTimeout)(S.raf); S.raf = 0; } }

  function sceneShown(layer) {
    const area = layer && layer.id === 'sv-layer-fg-outskirts' ? 'outskirts' : 'town';
    if (layer !== S.layer || area !== S.area) { clear(); S.layer = layer; S.area = area; }
    S.shown = true;
    start();
  }
  function sceneHidden() { S.shown = false; stop(); clear(); }
  function setPaused(p) {
    S.paused = !!p;
    if (S.paused) { stop(); for (const v of S.vs.values()) v.el.style.display = 'none'; }
    else { for (const v of S.vs.values()) v.el.style.display = ''; start(); }
  }
  if (doc) doc.addEventListener('visibilitychange', () => { if (doc.hidden) stop(); else start(); });
  if (global.addEventListener) global.addEventListener('resize', () => { if (S.shown) survey(); });

  global.KWCast = {
    sceneShown, sceneHidden, setPaused,
    get frameMs() { return S.ms; },
    get count() { return [...S.vs.values()].filter(v => v.state !== 'gone').length; },
    get villagers() { return [...S.vs.values()].map(v => ({ id: v.id, x: v.x, y: v.y, state: v.state, dir: v.dir })); },
    GROUND, SPOTS, CAP, ROLE_BUILDING, SPEED,
    _pickCast: pickCast, _areaOf: areaOf, _inPolygon: inPolygon, _groundPoint: groundPoint, _onGround: onGround, _doorPoint: doorPoint, _seeded: seeded,
    _seed: n => { S.rand = seeded(n); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
