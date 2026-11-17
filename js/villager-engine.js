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
//  Behaviour (§3.5, step 6): errands that make sense for the time of day
//  (work by day, the tavern or home in the evening, home at night with two
//  or three still out), going indoors for 20–60 s with a little bounce of
//  the building, two grown-ups stopping to chat with speech bubbles, and
//  children walking behind a parent, running ahead or chasing each other.
//
//  Purely a picture: nothing here changes the game or tells the server.
//  Clicking a villager is step 7.
//
//  Drawing comes from js/villagers.js (sheets, paint). Hooks arrive through
//  KWVillagers.sceneShown / sceneHidden / setPaused from the scene.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  const doc = global.document;

  // ── Pure rules (verify/scene_proofs.js) ─────────────────────────────────

  // The ground people may walk on, per area, in percent of the layer.
  // The whole flat meadow below the horizon (25 %), less a margin
  // (docs/ART_GUIDE.md §4.3). x is percent of the world's width.
  const MEADOW = [[1, 31], [99, 31], [99, 97], [1, 97]];
  const GROUND = { town: MEADOW, outskirts: MEADOW, neighbourhood: MEADOW };
  const BUILDERS_SHOWN = 4;         // builders always in the cast while they have a site here
  const HOOD = 'neighbourhood';   // the Neighbourhood scene (js/neighbourhood.js): the cast is who lives there
  // Named spots worth walking to (percent). Placeholders until the new art.
  const SPOTS = {
    // In the gaps between the front row's buildings, and along the front.
    town:      [{ id: 'lane-west', x: 29.5, y: 70 }, { id: 'lane-mid', x: 48.5, y: 72 }, { id: 'lane-east', x: 67.5, y: 70 }, { id: 'front', x: 50, y: 96 }, { id: 'east-end', x: 92, y: 74 }],
    outskirts: [{ id: 'track-west', x: 28.5, y: 70 }, { id: 'track-mid', x: 47.5, y: 72 }, { id: 'track-east', x: 66.5, y: 70 }, { id: 'front', x: 46, y: 96 }],
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
    const cy = 90;
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

  // ── Behaviour rules (§3.5), pure ────────────────────────────────────────
  // Time of day from the game clock: dawn, day, dusk (evening) or night.
  const CHAT_RANGE = 200, CHAT_GAP = 40, CHAT_COOLDOWN = 120000, CHAT_MS = [4000, 7000];
  const INDOORS_MS = [20000, 60000];
  const NIGHT_OUT = 3;   // at night most are indoors; two or three stay out
  const SAY = ['…', '…', '…', '🐟', '❤', '🌰', '♪'];

  // Where someone goes next. ctx: { phase, work (door or null), tavern, home,
  // doors: [door], spots: [{x,y}], ground() → {x,y}, owl (stays out at night) }.
  // → { kind: 'door' | 'spot' | 'ground', key?, x, y }.
  // Indoors lasts 20–60 s against about 15 s for an outdoor errand, so doors
  // are chosen sparingly by day (about a third of the cast inside at once).
  function chooseErrand(ctx, rand) {
    const door = d => ({ kind: 'door', key: d.key, x: d.x, y: d.y });
    const spot = () => { const s = ctx.spots[Math.floor(rand() * ctx.spots.length)]; return { kind: 'spot', x: s.x, y: s.y }; };
    const outdoors = () => (ctx.spots.length && rand() < 0.4 ? spot() : { kind: 'ground', ...ctx.ground() });
    const r = rand();
    if (ctx.phase === 'night') {
      if (ctx.owl) return outdoors();   // the two or three still out stay out
      return ctx.home ? door(ctx.home) : ctx.doors.length ? door(ctx.doors[Math.floor(rand() * ctx.doors.length)]) : outdoors();
    }
    if (ctx.phase === 'dusk') {   // the evening: the tavern fills up
      if (ctx.tavern && r < 0.5) return door(ctx.tavern);
      if (ctx.home && r < 0.65) return door(ctx.home);
      return outdoors();
    }
    // Morning sends workers to their buildings; by day now and then.
    if (ctx.work && r < (ctx.phase === 'dawn' ? 0.4 : 0.1)) return door(ctx.work);
    if (ctx.doors.length && r < (ctx.phase === 'dawn' ? 0.45 : 0.14)) return door(ctx.doors[Math.floor(rand() * ctx.doors.length)]);
    return outdoors();
  }

  // ── The working day (§3.5a), pure ──────────────────────────────────────
  // Someone whose job has a building here spends most of the day inside it:
  // in during the morning (10:00–11:00 game time), out in the evening
  // (22:24–23:00), with two or three breaks adding up to about a quarter of
  // it, each in its own part of the day so different villagers break at
  // different times. From a seed fixed to the villager and the game day, so
  // a reload shows the same day. Hours are the game clock's (UTC).
  // → { start, end, breaks: [[from, to], …] }.
  function routine(id, day) {
    const r = seeded(((Number(id) || 0) * 2654435761 ^ (Number(day) || 0) * 40503) >>> 0);
    r(); r();
    const start = 10 + r(), end = 22.4 + r() * 0.6, len = end - start;
    const n = r() < 0.5 ? 2 : 3, seg = len / n, total = len * (0.22 + r() * 0.06);
    const breaks = [];
    for (let i = 0; i < n; i++) {
      const b = total / n * (0.8 + r() * 0.4);
      const from = start + seg * i + 0.15 + r() * (seg - b - 0.3);
      breaks.push([from, from + b]);
    }
    return { start, end, breaks };
  }
  // At work at this hour: inside the day and not on a break. Pure.
  const atWork = (rt, hour) => hour >= rt.start && hour < rt.end && !rt.breaks.some(([a, b]) => hour >= a && hour < b);
  // Keep the town from looking empty: by day at least `min` villagers out
  // whenever that many are present. Who comes out first: those inside on an
  // errand (children, elders, the idle, anyone visiting), then workers, the
  // one inside longest first (an extra break). vs: [{ id, inside, worker,
  // since }]. → ids to bring out. Pure.
  function callOut(vs, min) {
    if (vs.length < min) return [];   // a town with fewer present: no rule
    const need = min - vs.filter(v => !v.inside).length;
    if (need <= 0) return [];
    const visitors = vs.filter(v => v.inside && !v.worker).sort((a, b) => a.since - b.since || a.id - b.id);
    const workers = vs.filter(v => v.inside && v.worker).sort((a, b) => a.since - b.since || a.id - b.id);
    return visitors.concat(workers).slice(0, need).map(v => v.id);
  }
  const MIN_OUT = { desktop: 4, phone: 3 };
  // How long a stay indoors lasts: the evening at the tavern is a long one.
  function stayMs(key, phase, rand) {
    if (key === 'tavern' && phase === 'dusk') return 90000 + rand() * 150000;
    return INDOORS_MS[0] + rand() * (INDOORS_MS[1] - INDOORS_MS[0]);
  }

  // Who may stay out at night: up to NIGHT_OUT grown-ups, the same ones all
  // night (lowest ids first, so it never flickers). → Set of ids.
  function nightOwls(ids, n = NIGHT_OUT) {
    return new Set([...ids].map(Number).sort((a, b) => a - b).slice(0, n));
  }

  // Two free grown-ups within range, not chatted together lately.
  // vs: [{ id, x, y, free, child, selected }]. → [[idA, idB], …], nearest first.
  function chatPairs(vs, now, cooldowns, range = CHAT_RANGE) {
    const ok = v => v.free && !v.child && !v.selected;
    const out = [];
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j];
      if (!ok(a) || !ok(b)) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const key = Math.min(a.id, b.id) + '_' + Math.max(a.id, b.id);
      if (d > range || (cooldowns[key] && now - cooldowns[key] < CHAT_COOLDOWN)) continue;
      out.push({ pair: [a.id, b.id], d });
    }
    return out.sort((p, q) => p.d - q.d).map(p => p.pair);
  }
  const pairKey = (a, b) => Math.min(a, b) + '_' + Math.max(a, b);

  // ── Keeping apart: nobody stops on top of anyone else ──────────────────
  const APART = 30;
  // The nearest point to `p` at least `min` px from every point in `others`
  // (other villagers' positions and targets), searched on rings round p;
  // `ok(q)` says whether a point is allowed (on the ground). Pure.
  function spreadPoint(p, others, { min = APART, ok = () => true, rings = 6, step = 16 } = {}) {
    const clear = q => others.every(o => Math.hypot(o.x - q.x, o.y - q.y) >= min);
    if (clear(p) && ok(p)) return p;
    for (let r = 1; r <= rings; r++) {
      const n = 8 * r, rad = min + (r - 1) * step;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        const q = { x: p.x + Math.cos(a) * rad, y: p.y + Math.sin(a) * rad * 0.6 };   // flatter rings: the meadow is seen from above at a slant
        if (ok(q) && clear(q)) return q;
      }
    }
    return p;
  }
  // Where someone waits at a door: the doorstep first, then fanning out in an
  // arc in front of it, never within 30 px of anyone. Pure.
  const DOOR_FAN = [[0, 6], [-30, 12], [30, 12], [-54, 24], [54, 24], [-22, 36], [22, 36], [-70, 40], [70, 40], [0, 52]];
  function doorSpot(door, others, min = APART) {
    for (const [dx, dy] of DOOR_FAN) {
      const q = { x: door.x + dx, y: door.y + dy };
      if (others.every(o => Math.hypot(o.x - q.x, o.y - q.y) >= min)) return q;
    }
    return spreadPoint({ x: door.x, y: door.y + 24 }, others, { min });
  }
  // Two chatting: side by side `gap` apart on one line, facing each other,
  // round a meeting point clear of everyone else. Pure.
  function chatSpots(a, b, others = [], gap = CHAT_GAP) {
    const mid = spreadPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, others, { min: APART + gap / 2 });
    const side = a.x <= b.x ? -1 : 1;
    return [{ x: mid.x + side * gap / 2, y: mid.y }, { x: mid.x - side * gap / 2, y: mid.y }];
  }

  // Where a child walking with a parent aims: a little behind them (beyond
  // the 30 px everyone keeps).
  function followPoint(parent, behind = 34) {
    const dx = parent.tx - parent.x, dy = parent.ty - parent.y, d = Math.hypot(dx, dy);
    if (d < 1) return { x: parent.x - behind * 0.7, y: parent.y + 6 };
    return { x: parent.x - dx / d * behind, y: parent.y - dy / d * behind + 4 };
  }

  // ── The scene ───────────────────────────────────────────────────────────
  const S = { layer: null, area: 'town', shown: false, paused: false, raf: 0, last: 0, vs: new Map(), doors: [], exits: [], sig: '', syncT: 0, rotateT: 0, chatT: 0,
    rand: Math.random, ms: 0, cool: {}, phase: 'day', owls: new Set() };
  const V = () => global.KWVillagers;
  const cits = () => { const d = typeof citizensData !== 'undefined' ? citizensData : global.citizensData; return Array.isArray(d) ? d : []; };   // eslint-disable-line no-undef
  const awayOf = c => (typeof global.citizenAway === 'function' ? global.citizenAway(c) : null);
  const isPhone = () => !!(doc.body && doc.body.classList.contains('kw-shell'));
  const townSpecies = () => { const gd = global.gameData; return (gd && (gd.species || (gd.settlement && gd.settlement.species))) || 'Mice'; };
  const momentIds = () => { try { return (global.KWMoments ? global.KWMoments.list() : []).flatMap(m => (m.subject && m.subject.citizen_ids) || []); } catch (_) { return []; } };
  const clockPhase = () => { try { return global.KWClock ? global.KWClock.phase().phase : global.KWDayCycle ? global.KWDayCycle.phaseAt(Date.now()).phase : 'day'; } catch (_) { return 'day'; } };
  // The layer's size: read once at the start of each frame (before any write,
  // so it never forces a layout), live otherwise.
  const W = () => S.size ? S.size.w : S.layer.clientWidth, H = () => S.size ? S.size.h : S.layer.clientHeight;
  const px = p => ({ x: p.x / 100 * W(), y: p.y / 100 * H() });
  const live = v => v.state !== 'gone' && v.state !== 'leave';

  // The area each built building stands in (from the scene's slots).
  function builtArea(buildingId) {
    const el = doc.querySelector('#settlement-view .sv-fg-layer [data-kwh="' + buildingId + '"]');
    if (!el) return null;
    const layer = el.closest('.sv-fg-layer');
    return layer && layer.id === 'sv-layer-fg-outskirts' ? 'outskirts' : 'town';
  }

  // Doors (and the signposts, the way out of the Outskirts at night) for the
  // area showing, in layer pixels; and each slot's depth from its foot.
  function survey() {
    if (!S.layer) return;
    const lr = S.layer.getBoundingClientRect();
    const sx = lr.width / (S.layer.clientWidth || 1), sy = lr.height / (S.layer.clientHeight || 1);   // parallax never scales; guard anyway
    S.doors = []; S.exits = []; S.blocks = []; S.sites = [];
    S.layer.querySelectorAll(':scope > .sv-slot').forEach(slot => {
      if (slot.hidden) return;
      // A construction site (js/construction.js): somewhere the builders work
      // in front of, and something to walk round; never a door.
      const site = slot.querySelector('.kwbt-site');
      if (site) {
        const a = (site.querySelector('.kwbt-site-art') || site).getBoundingClientRect();
        const r = { left: (a.left - lr.left) / sx, top: (a.top - lr.top) / sy, width: a.width / sx, height: a.height / sy };
        slot.style.zIndex = String(depth(r.top + r.height));
        S.blocks.push({ l: r.left, r: r.left + r.width, t: r.top, b: r.top + r.height });
        S.sites.push({ id: Number(site.getAttribute('data-kwbt-site')), x: r.left + r.width / 2, y: r.top + r.height + 24, half: r.width / 2 });   // in front of it, where they can be seen
        return;
      }
      const btn = slot.querySelector('[data-kwh]');
      // The art box (sized by the manifest), the placeholder hut, or a prop.
      const box0 = btn && btn.querySelector('.kwh-art');
      const artEl = box0 ? (box0.classList.contains('kwh-ph') ? box0.querySelector('.kwh-hut') || box0 : box0) : btn && btn.querySelector('.kwh-prop-art');
      const box = (artEl || slot).getBoundingClientRect();
      const rect = { left: (box.left - lr.left) / sx, top: (box.top - lr.top) / sy, width: box.width / sx, height: box.height / sy };
      const foot = rect.top + rect.height;
      // The village green is ground: anyone standing or dancing on it is in
      // front of it (its depth is its far edge, not its near one).
      const flat = btn && btn.classList.contains('kwh-prop-green');
      if (!slot.classList.contains('sv-dragging')) slot.style.zIndex = String(depth(flat ? rect.top + 2 : foot));
      if (!btn) return;
      S.blocks.push({ l: rect.left, r: rect.left + rect.width, t: rect.top, b: foot });   // what stands here (for a clear spot)
      const key = btn.getAttribute('data-kwh');
      const art = artEl && artEl.classList.contains('kwh-art') && global.KWHome ? global.KWHome.art(btn.getAttribute('data-kwh-art') || key) : artEl && artEl.classList.contains('kwh-hut') ? { hut: true } : null;
      const d = doorPoint(rect, art);
      const g = onGround(S.area, d.x / W() * 100, d.y / H() * 100);
      const p = { key, x: g.x / 100 * W(), y: g.y / 100 * H(), btn };
      if (btn.classList.contains('kwh-prop-signpost')) S.exits.push(p);
      else if (!btn.classList.contains('kwh-prop')) S.doors.push(p);
      // Being upgraded: the builders work beside its door.
      const up = btn.classList.contains('kwbt-upgrading') && btn.querySelector('[data-kwbt-pct]');
      if (up) S.sites.push({ id: Number(up.getAttribute('data-kwbt-pct')), x: p.x, y: p.y + 12, half: 60 });
    });
    // The ground: paths between the doors, and the props (js/home-ground.js).
    // Big props are places not to stop; the well, benches and pond are spots.
    const G = global.KWGround;
    const g = G ? G.sync({ layer: S.layer, area: S.area, doors: S.doors, exits: S.exits, blocks: S.blocks.slice(), w: W(), h: H() }) : null;
    S.propBlocks = (g && g.blocks) || [];
    S.propSpots = (g && g.spots) || [];
    S.blocks.push(...S.propBlocks);
  }
  const depth = footY => Math.max(1, Math.min(1000, Math.round(footY / (H() || 1) * 1000)));
  const doorOf = key => S.doors.find(d => d.key === key) || null;
  // The game clock: its day number and hour (a held time of day for a look
  // stands at that phase's middle).
  const HOLD_HOUR = { dawn: 10, day: 16, dusk: 23.6, night: 4 };
  function gameClock() {
    if (S.clock) return S.clock();
    const ms = global.KWClock && global.KWClock.now ? global.KWClock.now() : Date.now();
    const day = Math.floor(ms / 86400000);
    return { day, hour: S.hold && HOLD_HOUR[S.hold] != null ? HOLD_HOUR[S.hold] : (ms % 86400000) / 3600000 };
  }
  // Their job's building, when it stands in this area; grown-ups only.
  const workKey = v => (!v.child && !isElder(v.c) && doorOf(ROLE_BUILDING[v.c.role])) ? ROLE_BUILDING[v.c.role] : null;
  // ── The Neighbourhood (HOME_SCENE.md C.5) ──────────────────────────────
  // Its cast is the people who live there (and anyone with no bed). Someone
  // whose job has a building anywhere in town is away at it during their
  // working hours: they walk out past the signpost in the morning and come
  // back that way in the evening.
  const inHood = () => S.area === HOOD;
  const livesHere = c => (global.KWHood && global.KWHood.livesHere ? global.KWHood.livesHere(c) : false);
  function outAtWork(c) {
    if (isChild(c) || isElder(c) || !ROLE_BUILDING[c.role] || !builtArea(ROLE_BUILDING[c.role])) return false;
    const k = gameClock();
    return atWork(routine(Number(c.id), k.day), k.hour);
  }
  // ── Builders (HOME_SCENE.md D.8; js/construction.js) ───────────────────
  // While something is being built and someone is building, every builder is
  // where the first site in the queue is: at it, hammering, with a rest now
  // and then and the odd walk to the stores. Around the clock.
  const isBuilder = c => !!c && c.role === 'builder' && !isChild(c);
  function firstSite() {
    const B = global.KWBuild;
    if (!B || !B.data || !(B.data.rate > 0)) return null;
    return B.sites()[0] || null;
  }
  // The area the first site is in: the Neighbourhood for a home, else where
  // its building's plot is.
  function siteArea() {
    const f = firstSite();
    if (!f) return null;
    return f.kind === 'house' ? HOOD : builtArea(f.type) || 'town';
  }
  // Where a builder stands to work on the first site, when it is in the
  // scene showing: beside it, each builder in their own place.
  function buildSpot(v) {
    const f = firstSite();
    if (!f || !isBuilder(v.c)) return null;
    const st = (S.sites || []).find(x => x.id === f.id);
    if (!st) return null;
    const crew = [...S.vs.values()].filter(x => live(x) && isBuilder(x.c)).map(x => x.id).sort((a, b) => a - b);
    const i = Math.max(0, crew.indexOf(v.id));
    const side = i % 2 ? 1 : -1, out = Math.min(st.half, 70) * 0.6 + 24 * Math.floor(i / 2);
    return { id: f.id, x: st.x + side * out, y: st.y + 4 * (i % 3), sx: st.x };
  }
  // The area someone is in, for the scene showing.
  const areaFor = c => {
    const sa = isBuilder(c) ? siteArea() : null;
    if (sa) return sa === S.area ? sa : sa === HOOD || inHood() ? null : sa;
    if (inHood()) return livesHere(c) && !outAtWork(c) ? HOOD : null;
    // Someone whose job is in another part of town (a forager's hut in the
    // Outskirts) is there while they are at work, and in Town the rest of
    // the day: off work, on their breaks, and on an errand to town.
    const a = areaOf(c, builtArea);
    if (a === 'town' || (S.visitors && S.visitors.has(Number(c.id)))) return 'town';
    return outAtWork(c) ? a : 'town';
  };
  // Outskirts workers who are in Town for this stretch of the day (20
  // minutes): each has about a one in four chance of an errand there, and by
  // day more are sent until Town has its minimum of grown-ups. Seeded by the
  // villager and the stretch, so a reload shows the same town. `list`: [{ id }]
  // at work elsewhere; `inTown`: grown-ups already in Town. → ids. Pure.
  const VISIT = { MS: 20 * 60000, SHARE: 0.25 };
  function townVisitors(list, slot, inTown, min) {
    const rank = id => { const r = seeded(((Number(id) || 0) * 2654435761 ^ (Number(slot) || 0) * 40503) >>> 0); r(); r(); return r(); };
    const ranked = list.map(c => ({ id: Number(c.id), r: rank(c.id) })).sort((x, y) => x.r - y.r || x.id - y.id);
    const out = ranked.filter(x => x.r < VISIT.SHARE).map(x => x.id);
    for (const x of ranked) { if (inTown + out.length >= min) break; if (!out.includes(x.id)) out.push(x.id); }
    return out;
  }
  function visitorsNow() {
    const out = new Set();
    if (inHood()) return out;
    const working = [];
    let inTown = 0;
    for (const c of cits()) {
      if (!living(c) || awayOf(c) || isChild(c)) continue;
      if (isBuilder(c) && siteArea()) continue;
      if (areaOf(c, builtArea) !== 'town' && outAtWork(c)) working.push({ id: c.id }); else inTown++;
    }
    const day = S.phase === 'day' || S.phase === 'dawn';
    for (const id of townVisitors(working, Math.floor(clockMs() / VISIT.MS), inTown, day ? minOut() : 0)) out.add(id);
    return out;
  }
  // Their own front door: their house in the Neighbourhood, the
  // Neighbourhood's door in Town, the way back to town from the Outskirts.
  function homeDoor(v) {
    if (inHood()) return v.c.house_id != null ? doorOf('house-' + v.c.house_id) : null;
    return S.area === 'town' ? doorOf('neighbourhood') : nearestDoor(v.x, v.y, S.exits);
  }
  // At work right now (their routine, and not on an extra break).
  function working(v, now) {
    if (!workKey(v) || (v.breakUntil && now < v.breakUntil)) return false;
    const c = gameClock();
    if (!v.rt || v.rtDay !== c.day) { v.rt = routine(v.id, c.day); v.rtDay = c.day; }
    return atWork(v.rt, c.hour);
  }

  // ── Villagers ───────────────────────────────────────────────────────────
  function make(c, at, emerging) {
    const v = { id: Number(c.id), c, el: V().makeFigure(true), x: at.x, y: at.y, tx: at.x, ty: at.y, state: 'idle', until: 0, t: S.rand() * 2000, dir: 's',
      child: isChild(c), elder: isElder(c), goal: null, partner: null, say: null };
    v.speed = v.child ? SPEED.child : v.elder ? SPEED.elder : SPEED.adult;
    v.until = performanceNow() + IDLE_MS[0] * S.rand();
    const tint = TINTS[Math.abs(Number(c.family_id) || 0) % TINTS.length];
    if (tint) v.el.firstChild.style.setProperty('--kwv-tint', tint);   // with the outline (css/home-scene.css)
    v.el.classList.add('kwv-cit');
    v.el.setAttribute('data-cid', String(v.id));
    // A real button (step 7): Tab reaches it after the buildings; a small hit
    // box round the figure takes clicks, so the empty corners of the frame
    // don't steal them from buildings behind.
    v.el.setAttribute('aria-label', nameLine(c) + '. Show choices');
    v.el.setAttribute('aria-haspopup', 'menu');
    const hit = doc.createElement('span'); hit.className = 'kwv-hit'; v.el.appendChild(hit);
    // Their name plate (first name), shown with Names on, or on hover/focus.
    const tag = doc.createElement('span'); tag.className = 'kwv-tag'; tag.setAttribute('aria-hidden', 'true');
    tag.textContent = String(c.name || '').split(' ')[0]; v.el.appendChild(tag);
    // Pointer selection is press-and-release (below, pressAt); this click is
    // the keyboard's (Enter or Space: detail 0).
    v.el.addEventListener('click', e => { e.stopPropagation(); if (e.detail !== 0) return; if (v.selected) deselect(true); else select(v, true); });
    if (emerging) { v.el.classList.add('kwv-gone'); requestFrame(() => v.el.classList.remove('kwv-gone')); }
    S.layer.appendChild(v.el);
    S.vs.set(v.id, v);
    return v;
  }
  const performanceNow = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
  const requestFrame = f => (global.requestAnimationFrame ? global.requestAnimationFrame(f) : setTimeout(f, 16));

  function nearestDoor(x, y, list = S.doors) {
    let best = null, d = Infinity;
    for (const o of list) { const k = (o.x - x) ** 2 + (o.y - y) ** 2; if (k < d) { d = k; best = o; } }
    return best;
  }
  const parentOf = v => { for (const id of parentsOf(v.c)) { const p = S.vs.get(id); if (p && live(p)) return p; } return null; };

  // A grown-up's next errand (§3.5): work by day, the tavern or home in the
  // evening, home at night (all but two or three), else a spot or open ground.
  function errand(v, now) {
    const owls = S.owls.size ? S.owls : nightOwls([...S.vs.values()].filter(x => live(x) && !x.child).map(x => x.id));
    const home = homeDoor(v);
    // Town-wide (§3.10). A raid about to strike: guards to their post by the
    // way out, everyone else runs for the nearest door.
    if (S.event === 'raid') {
      if (isGuard(v.c)) { const post = S.exits[0] || nearestDoor(v.x, v.y) || { x: v.x, y: v.y }; walkTo(v, spreadPoint({ x: post.x + 30, y: post.y + 18 }, othersOf(v), { ok: onMeadow }), null); v.guarding = true; return; }
      const d = nearestDoor(v.x, v.y) || home;
      if (d) { v.run = true; walkTo(v, { x: d.x, y: d.y }, d.key || null); return; }
    }
    // A festival: most gather on the green and dance in a loose ring.
    if (S.event === 'festival' && !isBuilder(v.c) && S.rand() < TOWN.RING) {
      const g = greenPoint();
      if (g) { const n = Math.max(6, [...S.vs.values()].filter(live).length); walkTo(v, ringSpot(g, v.id % n, n), null); v.state = 'toring'; return; }
    }
    // A builder with a site here goes to it (after a rest, or back from the
    // stores); now and then they fetch something from the stores first.
    const bs = buildSpot(v);
    if (bs) {
      const store = !v.fetched && S.rand() < 0.18 ? doorOf('granary') || doorOf('workshop') || doorOf('lumber_camp') : null;
      if (store) { v.fetched = true; walkTo(v, doorSpot(store, othersOf(v)), null); return; }
      v.fetched = false;
      walkTo(v, bs, null); v.state = 'tosite'; v.siteId = bs.id; v.siteX = bs.sx;
      return;
    }
    // Mood (§3.8): with food short some stand by the granary; someone with no
    // bed stands about near the Neighbourhood.
    const town = S.mood || {};
    const gather = town.hungry && town.hungry !== 'ok' && S.rand() < 0.3 ? doorOf('granary') : v.c.house_id == null && !v.child && S.rand() < 0.5 ? doorOf('neighbourhood') : null;
    if (gather) { walkTo(v, spreadPoint({ x: gather.x + (S.rand() - 0.5) * 90, y: gather.y + 14 + S.rand() * 22 }, othersOf(v), { ok: onMeadow }), null); return; }
    // Their working day (§3.5a): at work, they go to it; on a break or off
    // work, they do what everyone does.
    if (working(v, now)) { const d = doorOf(workKey(v)); walkTo(v, doorSpot(d, othersOf(v)), d.key); return; }
    const ctx = { phase: S.phase, work: workKey(v) ? null : doorOf(ROLE_BUILDING[v.c.role]), tavern: doorOf('tavern'), home, doors: S.doors,
      spots: (SPOTS[S.area] || []).map(px).concat(S.propSpots || []), ground: () => px(groundPoint(S.area, S.rand)), owl: owls.has(v.id) };
    let g = chooseErrand(ctx, S.rand);
    // By day, don't go in if that would leave too few outside.
    if (g.kind === 'door' && (S.phase === 'day' || S.phase === 'dawn') && [...S.vs.values()].filter(live).length >= minOut() && outsideCount() <= minOut()) g = { kind: 'ground', ...px(groundPoint(S.area, S.rand)) };
    // Never stop on top of anyone: a door fans out, anywhere else spreads.
    const others = othersOf(v);
    walkTo(v, g.kind === 'door' ? doorSpot(g, others) : spreadPoint(g, others, { ok: onMeadow }), g.kind === 'door' ? g.key : null);
  }
  // Everyone else's position, and their target while they walk.
  function othersOf(...not) {
    const out = [];
    for (const o of S.vs.values()) {
      if (not.includes(o) || o.state === 'gone' || o.state === 'indoors') continue;
      out.push({ x: o.x, y: o.y });
      if (Math.hypot(o.tx - o.x, o.ty - o.y) > 1) out.push({ x: o.tx, y: o.ty });
    }
    return out;
  }
  const onMeadow = q => inPolygon(q.x / W() * 100, q.y / H() * 100, GROUND[S.area] || GROUND.town) && !offLimits(q);
  // Never stop on a big prop (a tree, the well, the pond): no path-finding,
  // just somewhere else to stand.
  const offLimits = q => (S.propBlocks || []).some(b => q.x > b.l && q.x < b.r && q.y > b.t && q.y < b.b);
  function walkTo(v, p, doorKey) { v.tx = p.x; v.ty = p.y; v.goal = doorKey ? { door: doorKey } : null; v.state = 'walk'; }
  function idle(v, now, ms) {
    v.state = 'idle'; v.goal = null;
    v.until = now + (ms != null ? ms : (IDLE_MS[0] + S.rand() * (IDLE_MS[1] - IDLE_MS[0])) * (lowMood(v) ? MOOD.LOW_IDLE : 1));
    // Face the camera, or the nearest villager close by.
    let near = null, d = 150;
    for (const o of S.vs.values()) if (o !== v && live(o) && o.state !== 'indoors') { const k = Math.hypot(o.x - v.x, o.y - v.y); if (k < d) { d = k; near = o; } }
    v.dir = near ? V().dirFromVector(near.x - v.x, near.y - v.y) : 's';
  }

  // Indoors: fade at the door, stay 20–60 s (at night, until morning), come
  // out and go on. The building gives a little bounce as someone goes in.
  function goIndoors(v, now, key) {
    v.state = 'indoors'; v.inside = key; v.inSince = now; v.run = false;
    if (v.emote) { v.emote = null; setSay(v, null); }   // a bubble does not hang in the doorway
    v.until = now + stayMs(key, S.phase, S.rand);   // at work, they stay while working (step)
    v.el.classList.add('kwv-gone');
    const d = doorOf(key) || S.exits.find(e => e.key === key);
    if (d && d.btn) { d.btn.classList.remove('kwh-bounce'); void d.btn.offsetWidth; d.btn.classList.add('kwh-bounce'); }
    // Children walking with this parent go in with them.
    for (const k of S.vs.values()) if (k.child && k.state !== 'indoors' && live(k) && parentsOf(k.c).includes(v.id)) walkTo(k, { x: v.x, y: v.y }, key);
  }
  // By day at least 4 out (3 on a phone) whenever that many are present:
  // visitors come out first, then a worker takes an extra break (4–8 min).
  const minOut = () => (isPhone() ? MIN_OUT.phone : MIN_OUT.desktop);
  const outsideCount = () => [...S.vs.values()].filter(v => live(v) && v.state !== 'indoors').length;
  function keepSomeOut(now) {
    if (S.event === 'raid') return;   // nobody is called out while raiders are near
    if (S.phase !== 'day' && S.phase !== 'dawn') return;
    const list = [...S.vs.values()].filter(v => live(v) && !v.selected && !v.held)
      .map(v => ({ id: v.id, inside: v.state === 'indoors', worker: v.state === 'indoors' && !!workKey(v) && v.inside === workKey(v), since: v.inSince || 0, v }));
    for (const id of callOut(list, minOut())) {
      const v = S.vs.get(id);
      if (!v || v.state !== 'indoors') continue;
      if (workKey(v) && v.inside === workKey(v)) v.breakUntil = now + 240000 + S.rand() * 240000;
      comeOut(v, now);
    }
  }
  // Why someone is in a building, for Who's here: they work there, live
  // there, or are visiting.
  function insideWhy(v, key) {
    if (key === 'neighbourhood') return 'at home';
    if (key.indexOf('house-') === 0) return key === 'house-' + v.c.house_id ? 'at home' : 'visiting';
    const w = ROLE_BUILDING[v.c.role];
    return w === key ? 'working' : 'visiting';
  }
  function comeOut(v, now) {
    const d = doorOf(v.inside) || nearestDoor(v.x, v.y) || { x: v.x, y: v.y };
    v.x = d.x; v.y = d.y; v.inside = null;
    v.el.classList.remove('kwv-gone');
    idle(v, now, 600 + S.rand() * 1200);
  }

  // Leaving town: walk to the nearest door, fade, gone.
  // `why`: 'town' (they left town or died: they must go) or 'rotate' (the
  // cast changing: selecting them on the way cancels it).
  function leave(v, why = 'town') {
    if (v.state === 'gone') return;
    if (v.state === 'leave') { if (why === 'town') v.leaveWhy = 'town'; return; }
    v.leaveWhy = why;
    if (v.selected) { deselect(true); return; }   // deselect resumes a 'town' leave
    v.held = false;
    endChat(v, performanceNow());
    // Out of the Neighbourhood: by the signpost back to town.
    // (When the cast is only changing, they go indoors at their own house.)
    const d = (inHood() && ((why === 'rotate' && homeDoor(v)) || S.exits[0])) || (v.viaExit && S.exits[0]) || nearestDoor(v.x, v.y);
    v.viaExit = false;
    if (v.state === 'indoors') { drop(v); return; }
    v.state = 'leave';
    if (d) { v.tx = d.x; v.ty = d.y; } else { v.tx = v.x; v.ty = v.y; }
  }
  function drop(v) {
    v.state = 'gone';
    v.el.classList.add('kwv-gone');
    setTimeout(() => { v.el.remove(); S.vs.delete(v.id); }, 320);
  }

  // Chat (§3.5): two free grown-ups close by walk to each other, stop a step
  // apart, face each other and take turns with a speech bubble for 4–7 s.
  function startChat(a, b, now) {
    const [pa, pb] = chatSpots(a, b, othersOf(a, b));
    a.partner = b.id; b.partner = a.id;
    walkTo(a, pa, null); a.state = 'tochat'; a.until = now + 8000;
    walkTo(b, pb, null); b.state = 'tochat'; b.until = now + 8000;   // give up if they never meet
    S.cool[pairKey(a.id, b.id)] = now;
  }
  function chatting(a, b, now) {
    const len = a.talk ? TALK_MS : CHAT_MS[0] + S.rand() * (CHAT_MS[1] - CHAT_MS[0]);
    for (const [x, y] of [[a, b], [b, a]]) { x.state = 'chat'; x.until = now + len; x.dir = V().dirFromVector(y.x - x.x, 0) || 'e'; }
    a.sayFrom = now; a.leads = true; b.leads = false;
    if (a.talk) { const sp = a.talk.speaker === a.id ? a : b, li = sp === a ? b : a; sp.leads = true; li.leads = false; sp.sayFrom = now; }
  }
  function endChat(v, now) {
    const p = v.partner != null ? S.vs.get(v.partner) : null;
    if (v.talk) talkResult(v.talk);   // cut short (someone was picked, or they never met): the result still shows
    for (const x of [v, p]) if (x) { x.partner = null; x.talk = null; setSay(x, null); if (x.state === 'chat' || x.state === 'tochat' || x.state === 'waitchat') idle(x, now, 500 + S.rand() * 1500); }
  }
  // ── A chat the player set up, and praise (js/social.js; Part F) ─────────
  // The server has already decided how it went; this plays it out. The
  // speaker hurries over to the listener (who waits, and steps out if they
  // were indoors), the topic's picture goes up in a bubble, the listener
  // answers, and a heart with the bond gained, or a storm cloud with the bond
  // lost, floats up between them. `done` is called once it has shown.
  // → false when it cannot be played here (the scene is not showing, or the
  // speaker is not in it): the caller tells it in words instead.
  const TALK_MS = 3800, TALK_WAIT = 45000;
  const FELT = { likes: '😊', dull: '😴', fine: '🙂' };
  function playTalk(o, done) {
    if (!S.shown || S.paused || !S.layer) return false;
    const a = S.vs.get(Number(o.speaker)), b = S.vs.get(Number(o.listener));
    const usable = x => x && x.state !== 'gone' && x.state !== 'leave' && !x.moment;
    if (!usable(a)) return false;
    const now = performanceNow();
    const t = { speaker: a.id, listener: usable(b) ? b.id : null, icon: o.icon || '💬', good: !!o.good, delta: Number(o.delta) || 0, speakerFelt: o.speakerFelt, listenerFelt: o.listenerFelt, done, shown: false };
    for (const x of [a, t.listener != null ? b : null]) {
      if (!x) continue;
      if (M.v === x) deselect(true, true);
      endChat(x, now);
      if (x.state === 'indoors') comeOut(x, now);
      x.held = false; x.heldBy = null; x.goal = null;
    }
    if (t.listener == null) {
      // The listener is somewhere else (another part of town, or indoors out
      // of the scene): the speaker says it where they stand.
      a.talk = t; a.state = 'solo'; a.until = now + 1500; a.dir = 's'; setSay(a, t.icon);
      return true;
    }
    a.partner = b.id; b.partner = a.id; a.talk = b.talk = t;
    const side = a.x <= b.x ? -1 : 1;
    const behind = (x, y) => (S.blocks || []).some(k => k.b > y && x + 24 > k.l && x - 24 < k.r && y - 64 < k.b && y > k.t);
    let pa = { x: b.x + side * CHAT_GAP, y: b.y }, pb = null;
    if (behind(b.x, b.y) || behind(pa.x, pa.y)) {
      // The listener stands behind a building: they meet at the nearest spot in the open.
      const spot = clearSpot(b.x, { w: W(), h: H(), blocks: S.blocks || [] });
      pa = { x: spot.x + side * CHAT_GAP / 2, y: spot.y }; pb = { x: spot.x - side * CHAT_GAP / 2, y: spot.y };
    }
    walkTo(a, pa, null); a.state = 'tochat'; a.until = now + TALK_WAIT;
    if (pb) { walkTo(b, pb, null); b.state = 'tochat'; }
    else { b.state = 'waitchat'; b.tx = b.x; b.ty = b.y; b.dir = V().dirFromVector(a.x - b.x, 0) || 'w'; }
    b.until = now + TALK_WAIT;
    return true;
  }
  // The heart or the storm cloud, once; then the caller's line.
  function talkResult(t) {
    if (t.shown) return;
    t.shown = true;
    const a = S.vs.get(t.speaker), b = t.listener != null ? S.vs.get(t.listener) : null;
    const at = a && b ? { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) } : a || b;
    const n = Math.abs(t.delta);
    if (at) floater(at.x, at.y - 74, t.good ? `💗${n ? ' +' + n : ''}` : `🌩️${n ? ' −' + n : ''}`, t.good ? 'good' : 'bad');
    if (typeof t.done === 'function') { try { t.done(); } catch (_) { /* told elsewhere */ } }
  }
  // The scripted part of a chat: topic, answer, how it ended.
  function talkStep(v, p, now) {
    const t = v.talk, e = now - v.sayFrom;
    const li = S.vs.get(t.listener) || p, sp = S.vs.get(t.speaker) || v;
    if (e < 1300) { setSay(sp, t.icon); setSay(li, null); }
    else if (e < 2500) { setSay(sp, null); setSay(li, FELT[t.listenerFelt] || '…'); }
    else { talkResult(t); setSay(sp, t.good ? '😄' : '😕'); setSay(li, t.good ? '😄' : '😒'); }
  }
  // Praise: a happy bubble and "+2" floating up. → false when they are not in the scene.
  function playPraise(id, amount) {
    const v = S.vs.get(Number(id));
    if (!S.shown || S.paused || !v || v.state === 'gone' || v.state === 'indoors') return false;
    floater(v.x, v.y - 74, `👏 +${Number(amount) || 2}`, 'good');
    if (!v.partner && !v.talk) { setSay(v, '😊'); setTimeout(() => { if (v.say === '😊') setSay(v, null); }, 1600); }
    return true;
  }
  // ── Mood (§3.8) ─────────────────────────────────────────────────────────
  // Small emotes over heads, from the town's real state, so the scene reads
  // as a picture of how the town is doing. One little bubble for 2 to 3 s,
  // on at most two villagers at a time, each at most once a minute. The mix
  // follows the numbers: a villager's own happiness where the citizen has
  // it, the town's otherwise; no bed, short food and a festival come first.
  // (Emoji stand in until the owner's emote sheet arrives: ART_GUIDE.)
  const EMOTES = {
    happy: ['😊', '🎵', '❤️'], low: ['☹️', '🌧️'], hungry: ['🥣'], homeless: ['🏠❓'], festival: ['🎵', '🏮'], plain: ['…'],
  };
  const MOOD = { HIGH: 70, LOW: 40, AT_ONCE: 2, EVERY_MS: 60000, SHOW_MS: [2000, 3000], LOW_SPEED: 0.8, LOW_IDLE: 1.5, LOW_CHAT: 0.4 };
  const happinessOf = c => { const h = c && c.life && c.life.happiness; return Number.isFinite(Number(h)) && h != null ? Number(h) : null; };
  // The town, as far as mood goes. `scene`: KWHome.sceneState(). Pure.
  function townMood(citizens, scene = {}) {
    const grown = citizens.filter(c => living(c) && !isChild(c)).map(happinessOf).filter(h => h != null);
    const fam = scene.famine && scene.famine.state;
    return { happy: grown.length ? Math.round(grown.reduce((a, b) => a + b, 0) / grown.length) : null,
      hungry: fam === 'famine' || fam === 'low' ? fam : 'ok', festival: !!(scene.town && scene.town.festival && scene.town.festival.active) };
  }
  // What one villager feels, by what comes first: no bed (that villager
  // only), short food, a festival, then how happy they are. Pure.
  function moodOf(c, town) {
    if (c.house_id == null && !isChild(c)) return 'homeless';
    if (town.hungry !== 'ok') return 'hungry';
    if (town.festival) return 'festival';
    const h = happinessOf(c) != null ? happinessOf(c) : town.happy;
    return h == null ? 'plain' : h >= MOOD.HIGH ? 'happy' : h < MOOD.LOW ? 'low' : 'plain';
  }
  // Who may show an emote now: at most AT_ONCE showing; each at most once
  // per EVERY_MS. `list`: [{ id, free, last, showing }]. → an id, or null. Pure.
  function emoteTurn(list, now, rand = Math.random) {
    if (list.filter(v => v.showing).length >= MOOD.AT_ONCE) return null;
    const ok = list.filter(v => v.free && !v.showing && (v.last == null || now - v.last >= MOOD.EVERY_MS));
    return ok.length ? ok[Math.floor(rand() * ok.length)].id : null;
  }
  function sceneNow() { try { return global.KWHome && global.KWHome.sceneState ? global.KWHome.sceneState() : {}; } catch (_) { return {}; } }
  function maybeMood(now) {
    const town = S.mood = townMood(cits(), sceneNow());
    if (S.hush && now < S.hush) return;   // a sad time: no emotes for a while (§3.9)
    if (S.event === 'raid') return;       // nobody stops to feel things with raiders at the gate
    const list = [...S.vs.values()].map(v => ({ id: v.id, last: v.emoteAt, showing: !!v.emote,
      free: live(v) && (v.state === 'idle' || v.state === 'walk') && !v.selected && !v.held && !v.say && v.partner == null && !v.talk && !v.moment }));
    const id = emoteTurn(list, now, S.rand);
    if (id == null) return;
    const v = S.vs.get(id), kind = moodOf(v.c, town);
    v.emoteAt = now;
    if (kind === 'plain' && S.rand() < 0.75) return;   // middling: mostly nothing
    const set = EMOTES[kind];
    v.emote = set[Math.floor(S.rand() * set.length)];
    v.emoteUntil = now + MOOD.SHOW_MS[0] + S.rand() * (MOOD.SHOW_MS[1] - MOOD.SHOW_MS[0]);
    setSay(v, v.emote);
    // Happy: now and then a little hop.
    if ((kind === 'happy' || kind === 'festival') && S.rand() < 0.4) hop(v);
  }
  function hop(v) {
    v.el.classList.remove('kwv-hop'); void v.el.offsetWidth; v.el.classList.add('kwv-hop');
    setTimeout(() => v.el.classList.remove('kwv-hop'), 700);
  }
  // Their own mood slows or steadies them: unhappy villagers walk slower
  // and stand about longer.
  const lowMood = v => { const h = happinessOf(v.c); return (h != null ? h : S.mood && S.mood.happy != null ? S.mood.happy : 70) < MOOD.LOW; };

  // ── Life events seen happening (§3.9) ───────────────────────────────────
  // A new line in the chronicle (a birth, a coming of age, a partnership, a
  // death, a settler, an inheritance) plays as a small scene, once, when
  // Home is showing: within ten minutes of it happening. One at a time; up
  // to three wait their turn. Each is under a minute. People in a scene join
  // the cast for its length. Nothing here changes the game: the chronicle
  // line is the event, this only shows it.
  const LIFE = { KINDS: ['birth', 'came_of_age', 'partnership', 'death', 'settler', 'inheritance'], FRESH_MS: 600000, WAITING: 3, HUSH_MS: 240000, POLL_MS: 45000 };
  // Who does what. `entry`: { kind, citizen_ids }. `at`: { home(id), work(id),
  // edge, centre, across } points in the scene. `who`: { family(id) → ids,
  // neighbour(not) → id|null }. → { actors: [{ id, from?, greet?, steps }], hush? } or null. Pure.
  // A step: { to, speed?, say? (null clears), wait?, hop?, inside? }.
  function lifeScene(entry, at, who) {
    const ids = (entry.citizen_ids || []).map(Number).filter(Boolean), a = ids[0], b = ids[1];
    const off = (p, dx, dy = 0) => ({ x: p.x + dx, y: p.y + dy });
    if (!a) return null;
    if (entry.kind === 'birth') {
      const home = at.home(a), n = who.neighbour(ids);
      const actors = [{ id: a, steps: [{ to: off(home, -16, 14) }, { say: '❤️', wait: 9000 }, { say: null }] }];
      if (b) actors.push({ id: b, steps: [{ to: off(home, 16, 16) }, { say: '❤️', wait: 9000 }, { say: null }] });
      if (n != null) actors.push({ id: n, steps: [{ wait: 2500 }, { to: off(home, 0, 46) }, { say: '…', wait: 3000 }, { say: '😊', wait: 1800 }, { say: null }] });
      return { actors };
    }
    if (entry.kind === 'came_of_age') {
      return { actors: [{ id: a, greet: true, steps: [{ to: off(at.home(a), 0, 16) }, { say: '⭐', wait: 1200 }, { to: at.work(a) || at.centre, say: '⭐' }, { hop: true, wait: 1500 }, { say: null }] }] };
    }
    if (entry.kind === 'partnership') {
      if (!b) return null;
      return { need: 2, actors: [   // both of them, or not at all
        { id: a, steps: [{ to: at.centre }, { say: '❤️', wait: 800 }, { to: at.across, say: '❤️', speed: 0.8 }, { wait: 1500 }, { say: null }] },
        { id: b, steps: [{ to: off(at.centre, -24, 8) }, { say: '❤️', wait: 800 }, { to: off(at.across, -24, 8), say: '❤️', speed: 0.8 }, { wait: 1500 }, { say: null }] },
      ] };
    }
    if (entry.kind === 'death') {
      const mourners = who.family(a).slice(0, 4);
      if (!mourners.length) return null;
      const home = at.home(mourners[0]);
      return { hush: LIFE.HUSH_MS, actors: mourners.map((id, i) => ({ id, steps: [{ to: off(home, (i - (mourners.length - 1) / 2) * 46, 18 + (i % 2) * 12) }, { say: '🕯️', wait: 15000 }, { say: null }, { to: off(home, (i - 1.5) * 90, 70), speed: 0.6 }] })) };
    }
    if (entry.kind === 'settler') {
      const n = who.neighbour(ids), home = at.home(a), mid = { x: (at.edge.x + home.x) / 2, y: (at.edge.y + home.y) / 2 };
      const actors = [{ id: a, from: at.edge, steps: [{ to: mid, say: '🎒' }, { wait: 2500 }, { to: off(home, 0, 14), say: '🎒' }, { say: '😊', wait: 2000 }, { say: null }] }];
      if (n != null) actors.push({ id: n, steps: [{ to: off(mid, 30, 6) }, { say: '👋', wait: 3000 }, { say: null }] });
      return { actors };
    }
    if (entry.kind === 'inheritance') {
      return { actors: [{ id: a, steps: [{ to: off(at.home(a), 0, 6) }, { inside: 2500 }, { say: '✨', wait: 2800 }, { say: null }] }] };
    }
    return null;
  }
  // Which chronicle lines to play. `entries`: newest first. `seen`: the
  // highest id already dealt with (null: this is the first look, so only
  // fresh ones). → { play: [oldest first, at most WAITING], seen }. Pure.
  function lifeNews(entries, seen, now) {
    const list = (entries || []).filter(e => e && LIFE.KINDS.includes(e.kind));
    const top = (entries || []).reduce((m, e) => Math.max(m, Number(e.id) || 0), seen || 0);
    const fresh = list.filter(e => (seen == null || Number(e.id) > seen) && now - new Date(e.at).getTime() <= LIFE.FRESH_MS);
    // More than three waiting: the newest are dropped first.
    return { play: fresh.sort((x, y) => Number(x.id) - Number(y.id)).slice(0, LIFE.WAITING), seen: top };
  }
  const lifeSeen = v => { try { if (v === undefined) { const n = Number(global.sessionStorage.getItem('kw_life_seen')); return Number.isFinite(n) && n > 0 ? n : null; } global.sessionStorage.setItem('kw_life_seen', String(v)); } catch (_) { /* private mode */ } return null; };
  // Chronicle lines arrive from js/life-scenes.js (the engine itself never
  // calls the server): the fresh ones wait their turn.
  function offerLife(entries) {
    const out = lifeNews(entries || [], S.lifeSeen !== undefined ? S.lifeSeen : lifeSeen(), clockMs());
    S.lifeSeen = out.seen; lifeSeen(out.seen);
    S.lifeWaiting = (S.lifeWaiting || []).concat(out.play).slice(0, LIFE.WAITING);
    return out.play.length;
  }
  const clockMs = () => (global.KWClock && global.KWClock.now ? global.KWClock.now() : Date.now());
  // The next waiting scene, when none is playing and the scene shows homes
  // (Town or the Neighbourhood).
  function lifeTick(now) {
    if (S.lifePlaying) {
      const busy = [...S.vs.values()].some(v => v.act && v.act.scene === S.lifePlaying.id);
      if (!busy || now > S.lifePlaying.until) { for (const v of S.vs.values()) if (v.act && v.act.scene === S.lifePlaying.id) endAct(v, now); S.lifePlaying = null; }
      return;
    }
    if (!S.lifeWaiting || !S.lifeWaiting.length || S.area === 'outskirts') return;
    const entry = S.lifeWaiting.shift();
    const byId = new Map(cits().map(c => [Number(c.id), c]));
    const ok = id => { const c = byId.get(Number(id)); return !!c && living(c) && !awayOf(c); };
    const here = id => { const v = S.vs.get(Number(id)); return v && live(v) ? v : null; };
    const homeOf = id => { const c = byId.get(Number(id)); const d = (inHood() && c && c.house_id != null && doorOf('house-' + c.house_id)) || doorOf('neighbourhood') || S.exits[0] || S.doors[0]; return d ? { x: d.x, y: d.y } : px({ x: 50, y: 80 }); };
    const places = {
      home: homeOf,
      work: id => { const c = byId.get(Number(id)); const d = c && doorOf(ROLE_BUILDING[c.role]); return d ? { x: d.x, y: d.y + 12 } : null; },
      edge: { x: W() * 0.03, y: H() * 0.86 }, centre: px({ x: 50, y: 84 }), across: px({ x: 82, y: 86 }),
    };
    const who = {
      family: id => { const dead = byId.get(Number(id)); const fam = dead && dead.family_id; const kin = cits().filter(c => ok(c.id) && !isChild(c) && Number(c.id) !== Number(id) && fam != null && c.family_id === fam).map(c => Number(c.id));
        const rest = [...S.vs.values()].filter(v => live(v) && !v.child && !kin.includes(v.id) && v.id !== Number(id)).map(v => v.id); return kin.concat(rest); },
      neighbour: not => { const o = [...S.vs.values()].filter(v => live(v) && !v.child && v.state !== 'indoors' && !not.includes(v.id) && !v.act && !v.moment && !v.selected); return o.length ? o[Math.floor(S.rand() * o.length)].id : null; },
    };
    const scene = lifeScene(entry, places, who);
    if (!scene) return;
    let longest = 0;
    // Who can take part: living, in town, and not busy with the player (picked,
    // a window open on them, a moment waiting, a chat the player set up).
    const can = a => { if (!ok(a.id)) return false; const v = here(a.id); return !v || !(v.selected || v.held || v.moment || v.talk); };
    if (scene.actors.filter(can).length < (scene.need || 1)) return;
    for (const a of scene.actors) {
      if (!can(a)) continue;
      let v = here(a.id);
      if (!v) { const d = a.from || homeOf(a.id); v = make(byId.get(a.id), { x: d.x, y: d.y }, true); v.guest = true; }   // they join the cast for the scene
      if (v.state === 'indoors') comeOut(v, now);
      endChat(v, now);
      if (a.from) { v.x = a.from.x; v.y = a.from.y; }
      v.act = { scene: entry.id, steps: a.steps, i: -1, greet: !!a.greet }; v.state = 'act'; v.goal = null;
      longest = Math.max(longest, a.steps.reduce((t, st) => t + (st.wait || st.inside || 0) + (st.to ? 12000 : 0), 0));
    }
    if (scene.hush) S.hush = now + scene.hush;
    S.lifePlaying = { id: entry.id, kind: entry.kind, until: now + Math.min(58000, longest + 3000) };
  }
  function endAct(v, now) {
    v.act = null; setSay(v, null); v.el.classList.remove('kwv-gone');
    if (v.guest) { v.guest = false; leave(v, 'rotate'); } else idle(v, now, 500 + S.rand() * 1200);
  }
  // One actor's part: walk, say, wait, hop, step indoors and out.
  function actStep(v, dt, now) {
    const a = v.act;
    let st = a.steps[a.i];
    const next = () => {
      a.i++; st = a.steps[a.i];
      if (!st) { endAct(v, now); return false; }
      if ('say' in st) setSay(v, st.say);
      if (st.hop) hop(v);
      if (st.inside) v.el.classList.add('kwv-gone');
      a.until = now + (st.wait || st.inside || 0);
      if (st.to) { v.tx = st.to.x; v.ty = st.to.y; }
      return true;
    };
    if (!st && !next()) return;
    if (st.to) {
      const dx = v.tx - v.x, dy = v.ty - v.y, dist = Math.hypot(dx, dy), stepPx = v.speed * 1.15 * (st.speed || 1) * dt / 1000;
      if (dist > stepPx) {
        v.x += dx / dist * stepPx; v.y += dy / dist * stepPx; v.dir = V().dirFromVector(dx, dy);
        // Coming of age: the first villager they pass gives a hop.
        if (a.greet) for (const o of S.vs.values()) if (o !== v && live(o) && o.state !== 'indoors' && !o.act && Math.hypot(o.x - v.x, o.y - v.y) < 44) { hop(o); a.greet = false; break; }
        return;
      }
      v.x = v.tx; v.y = v.ty; v.dir = 's';
      next();
      return;
    }
    if (now >= a.until) { if (st.inside) v.el.classList.remove('kwv-gone'); next(); }
  }

  // ── Town-wide events (§3.10) ────────────────────────────────────────────
  // What the whole town is doing, from what the client already knows. By
  // priority: a raid about to strike (or under way), then a death (its hush),
  // then a festival. A raid that is still hours off changes nothing: an empty
  // town for a whole warning would be bleak, so people only run for cover in
  // its last ten minutes.
  const TOWN = { RAID_NEAR_MS: 600000, RING: 0.8, RUN: 1.7, RING_R: 74, DANCE_MS: [8000, 14000] };
  const GUARDS = ['soldier', 'archer'];
  const isGuard = c => !!c && GUARDS.includes(c.role) && !isChild(c);
  // `scene`: KWHome.sceneState(). `hushed`: a death is being mourned. Pure.
  function townEvent(scene, now, hushed) {
    const r = scene && scene.raid;
    if (r && !r.resolved_at) { const left = new Date(r.arrives_at).getTime() - now; if (!(left > TOWN.RAID_NEAR_MS)) return 'raid'; }
    if (hushed) return null;
    if (scene && scene.town && scene.town.festival && scene.town.festival.active) return 'festival';
    return null;
  }
  // Place `i` of `n` in a loose ring round a point (flattened: seen from in front). Pure.
  function ringSpot(c, i, n, r = TOWN.RING_R) {
    const a = (i / Math.max(3, n)) * Math.PI * 2;
    return { x: Math.round(c.x + Math.cos(a) * r), y: Math.round(c.y + Math.sin(a) * r * 0.45) };
  }
  // The village green, when it is in the scene showing (the festival's ring).
  function greenPoint() {
    const el = S.layer && S.layer.querySelector('#sv-prop-green .kwh-prop');
    if (!el || !el.getBoundingClientRect) return null;
    const lr = S.layer.getBoundingClientRect(), r = el.getBoundingClientRect();
    const sx = lr.width / (S.layer.clientWidth || 1), sy = lr.height / (S.layer.clientHeight || 1);
    if (!r.width) return null;
    return { x: (r.left + r.width / 2 - lr.left) / sx, y: (r.top + r.height * 0.72 - lr.top) / sy };
  }
  function townTick(now) {
    const scene = sceneNow(), was = S.event || null;
    S.event = townEvent(scene, clockMs(), !!(S.hush && now < S.hush));
    if (scene.raid) S.raidLast = scene.raid;
    // A raid begins: everyone outdoors makes for cover at once; guards come out.
    if (S.event === 'raid' && was !== 'raid') {
      for (const v of S.vs.values()) {
        if (!live(v) || v.selected || v.held || v.act || v.moment) continue;
        if (isGuard(v.c)) { if (v.state === 'indoors') comeOut(v, now); }
        if (v.state !== 'indoors') { endChat(v, now); v.emote = null; setSay(v, null); errand(v, now); }
      }
    }
    // A festival begins: those out and free set off for the green at once.
    if (S.event === 'festival' && was !== 'festival') {
      for (const v of S.vs.values()) if (live(v) && (v.state === 'idle' || v.state === 'walk') && !v.goal && !v.selected && !v.held && !v.act && !v.moment && v.partner == null) errand(v, now);
    }
    // It is over: people come out, relieved or sad by how it went.
    if (was === 'raid' && S.event !== 'raid') {
      const bad = S.raidLast && (S.raidLast.outcome === 'lost' || S.raidLast.outcome === 'partial');
      let n = 0;
      for (const v of S.vs.values()) {
        v.run = false;
        if (!live(v) || v.selected || v.held) continue;
        if (v.state === 'indoors') { comeOut(v, now); v.until = now + 600 + S.rand() * 2500; }
        if (n++ < 6) { v.emote = bad ? '😢' : '😌'; v.emoteUntil = now + 3500 + S.rand() * 2000; v.emoteAt = now; setSay(v, v.emote); }
      }
    }
    // The town has grown a tier: everyone out cheers once.
    const tier = scene.tier || null, order = ['camp', 'village', 'town', 'city'];
    if (S.tierSeen && tier && order.indexOf(tier) > order.indexOf(S.tierSeen)) {
      for (const v of S.vs.values()) {
        if (!live(v) || v.state === 'indoors' || v.selected || v.held || v.act || v.talk || v.moment) continue;
        endChat(v, now); v.state = 'cheer'; v.until = now + 2600; v.dir = 's'; v.goal = null; setSay(v, '⭐'); hop(v);
      }
    }
    if (tier) S.tierSeen = tier;
  }
  // The festival ring: turn through the directions, a note or a lantern now
  // and then, a hop here and there.
  function danceStep(v, now) {
    if (S.event !== 'festival' || now >= v.until) { setSay(v, null); idle(v, now, 600 + S.rand() * 1500); return; }
    const t = now - v.danceFrom;
    v.dir = ['s', 'e', 'n', 'w'][Math.floor(t / 380) % 4];
    const beat = t % 3200;
    setSay(v, beat < 1300 ? v.danceSay : null);
    if (beat < 40 && S.rand() < 0.5) hop(v);
  }

  // A builder at the site: the hammer goes up in a bubble in a steady beat,
  // dust puffs at the site, then a short rest. (The idle picture stands in
  // until the owner's work animation arrives: docs/ART_GUIDE.md.)
  const BUILD_MS = [14000, 30000], REST_MS = [2500, 5500];
  function buildStep(v, now) {
    if (v.state === 'cheer') { if (now >= v.until) { setSay(v, null); idle(v, now, 400 + S.rand() * 900); } return; }
    const bs = buildSpot(v);
    if (!bs || bs.id !== v.siteId) { setSay(v, null); idle(v, now, 300 + S.rand() * 700); return; }   // finished, cancelled, or another came first
    if (now >= v.until) { setSay(v, null); idle(v, now, REST_MS[0] + S.rand() * (REST_MS[1] - REST_MS[0])); return; }
    const beat = (now - v.hamFrom) % 1500;
    setSay(v, beat < 850 ? '🔨' : null);
    if (now >= v.puffAt) { v.puffAt = now + 1500; puff(bs.sx + (S.rand() - 0.5) * 50, bs.y - 10 - S.rand() * 14); }
  }
  function puff(x, y) {
    if (!S.layer || (V().reducedMotion && V().reducedMotion())) return;
    const d = doc.createElement('span');
    d.className = 'kwv-dust';
    d.style.left = Math.round(x) + 'px'; d.style.top = Math.round(y) + 'px';
    d.style.zIndex = String(depth(y + 20));
    S.layer.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }
  // Something was finished (js/construction.js): the builders here cheer.
  function cheer() {
    if (!S.shown || S.paused) return;
    const now = performanceNow();
    let any = null;
    for (const v of S.vs.values()) {
      if (!live(v) || !isBuilder(v.c) || v.state === 'indoors' || v.selected || v.held || v.talk || v.moment) continue;
      v.state = 'cheer'; v.until = now + 2600; v.dir = 's'; v.goal = null; setSay(v, '🎉');
      any = any || v;
    }
    if (any) floater(any.siteX || any.x, any.y - 90, '🎉 Finished!', 'good');
  }
  if (global.addEventListener) global.addEventListener('kw:built', () => { try { cheer(); } catch (_) { /* scene closed */ } });
  // The builders' queue changed: who is where may have too.
  // (A little later, so builders at a site just finished cheer before they go.)
  if (global.addEventListener) global.addEventListener('kw:build', () => { setTimeout(() => { if (S.shown && S.layer && cits().length && signature(cits()) !== S.sig) recast(false); }, 3200); });

  // A small sign that rises from a point in the scene and fades.
  function floater(x, y, text, tone) {
    if (!S.layer) return;
    const f = doc.createElement('span');
    f.className = 'kwv-float' + (tone ? ' kwv-float-' + tone : '');
    f.textContent = text;
    f.style.left = Math.round(x) + 'px'; f.style.top = Math.round(y) + 'px';
    S.layer.appendChild(f);
    setTimeout(() => f.remove(), 2200);
  }
  function setSay(v, text) {
    if (v.say === text) return;
    v.say = text;
    let b = v.el.querySelector('.kwv-say');
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = doc.createElement('span'); b.className = 'kwv-say'; v.el.appendChild(b); }
    b.textContent = text;
  }

  // A child: walks a little behind a parent, now and then runs ahead and
  // waits; two children near each other may chase for a few seconds.
  function child(v, now) {
    const p = parentOf(v);
    if (!p) return false;
    if (p.state === 'indoors' && v.state !== 'indoors') { if (!v.goal) walkTo(v, doorOf(p.inside) || { x: p.x, y: p.y }, p.inside); return true; }
    if (v.state === 'chase' && now < v.until) { const o = S.vs.get(v.chasing); if (o && live(o)) { v.tx = o.x; v.ty = o.y; } return true; }
    if (v.state === 'ahead' && now < v.until) return true;
    if (S.rand() < 0.0004) {   // run ahead now and then (about once a minute at 60 fps)
      const t = followPoint(p, -70);
      walkTo(v, onGroundPx(t), null); v.state = 'ahead'; v.until = now + 4000; return true;
    }
    const kid = [...S.vs.values()].find(o => o !== v && o.child && live(o) && o.state !== 'indoors' && o.state !== 'chase' && Math.hypot(o.x - v.x, o.y - v.y) < 120);
    // A chase now and then.
    if (kid && S.rand() < 0.0006) { v.state = 'chase'; v.chasing = kid.id; v.until = now + 3000 + S.rand() * 2000; walkTo(kid, onGroundPx({ x: kid.x + (kid.x - v.x) * 2, y: kid.y }), null); kid.state = 'ahead'; kid.until = now + 3000; v.state = 'chase'; return true; }
    const t = followPoint(p);
    const far = Math.hypot(t.x - v.x, t.y - v.y);
    if (far > 14) { v.tx = t.x; v.ty = t.y; v.state = 'follow'; }
    else if (v.state === 'follow') { v.state = 'idle'; v.until = now + 400; v.dir = p.dir; }
    return true;
  }
  const onGroundPx = p => { const g = onGround(S.area, p.x / W() * 100, p.y / H() * 100); return px(g); };

  // Choose the cast and bring the scene in line with it. `first`: Home just
  // opened, so people start spread out on the ground (some indoors).
  function recast(first) {
    if (!S.layer || !V() || !V().meta) return;
    survey();
    S.phase = S.hold || clockPhase();
    const cap = isPhone() ? CAP.phone : CAP.desktop;
    const all = cits();
    S.visitors = visitorsNow();
    // Builders with a site in this part of town are always in the cast (up to 4).
    const crew = siteArea() === S.area ? all.filter(c => living(c) && isBuilder(c) && !awayOf(c)).slice(0, BUILDERS_SHOWN).map(c => Number(c.id)) : [];
    const want = pickCast(all, { cap, area: S.area, areaOf: areaFor, away: awayOf, momentIds: momentIds().concat(crew), rand: S.rand });
    const byId = new Map(all.map(c => [Number(c.id), c]));
    for (const v of S.vs.values()) {
      const c = byId.get(v.id);
      if (!want.includes(v.id) && live(v) && !(v.act && !first)) {   // someone in a scene stays for it
        if (first) { v.el.remove(); S.vs.delete(v.id); }
        else { v.viaExit = !!c && living(c) && !awayOf(c) && !inHood(); leave(v); }   // off to another part of town: by the signpost
      }
      else if (c) v.c = c;
    }
    const present = () => [...S.vs.values()].filter(live).length;
    const now = performanceNow();
    for (const id of want) {
      if (S.vs.has(id) || present() >= cap) continue;
      const c = byId.get(id);
      if (!c) continue;
      // In the Neighbourhood people start at (or in) their own house, and
      // arrive later from town by the signpost.
      const own = inHood() && c.house_id != null ? doorOf('house-' + c.house_id) : null;
      // Someone arriving from the other part of town comes by the signpost.
      const fromAfar = !first && !inHood() && S.exits[0] && (S.area !== 'town' || areaOf(c, builtArea) !== 'town');
      const door = inHood() ? (first ? own : S.exits[0] || own) : fromAfar ? S.exits[0] : S.doors.length ? S.doors[Math.floor(S.rand() * S.doors.length)] : null;
      const at = first || !door ? px(groundPoint(S.area, S.rand)) : { x: door.x, y: door.y };
      const v = make(c, at, !first);
      // On opening, someone at work is in their building; some others start
      // indoors (most of them at night).
      const wk = workKey(v), wd = wk && doorOf(wk);
      if (first && wd && working(v, now)) { v.x = wd.x; v.y = wd.y; goIndoors(v, now, wk); }
      else if (first && door && door.key && !v.child && S.rand() < (S.phase === 'night' ? 0.85 : 0.2)) { v.x = door.x; v.y = door.y; goIndoors(v, now, door.key); v.until = now + S.rand() * INDOORS_MS[1]; }
    }
    S.sig = signature(all);
    markMoments();
  }
  function signature(all) {
    // (In the Neighbourhood, also who is out at work and who lives where.)
    S.visitors = visitorsNow();
    return all.filter(living).map(c => c.id + (awayOf(c) ? 'a' : '') + ':' + (c.role || '') + ':' + (c.stage || '') + (outAtWork(c) ? 'w' : '') + (inHood() ? ':' + (c.house_id || '') : '')).join(',') + '|' + momentIds().join(',')
      + '|' + (siteArea() || '')    // the builders go where the first site is
      + '|' + [...S.visitors].sort((x, y) => x - y).join(',');   // who is on an errand to town
  }
  // Now and then one walks into a building and someone else comes out.
  function rotate() {
    const cap = isPhone() ? CAP.phone : CAP.desktop;
    const pool = cits().filter(c => living(c) && !awayOf(c) && areaFor(c) === S.area && !isChild(c) && !S.vs.has(Number(c.id)));
    const moments = momentIds().map(Number);
    const out = [...S.vs.values()].filter(v => live(v) && !v.selected && !v.held && v.state !== 'chat' && v.state !== 'tochat' && !v.talk && !v.child && !moments.includes(v.id)
      && ![...S.vs.values()].some(k => k.child && parentsOf(k.c).includes(v.id)));
    if (!pool.length || !out.length || S.vs.size > cap) return;
    leave(out[Math.floor(S.rand() * out.length)], 'rotate');
    const inn = pool[Math.floor(S.rand() * pool.length)];
    const door = inHood() ? (inn.house_id != null && doorOf('house-' + inn.house_id)) || S.exits[0] || null
      : S.doors.length ? S.doors[Math.floor(S.rand() * S.doors.length)] : null;
    if (door) setTimeout(() => { if (S.shown && !S.paused && !S.vs.has(Number(inn.id))) make(inn, { x: door.x, y: door.y }, true); }, 2500);
  }

  // ── Selecting a villager: the radial menu (§3.6, step 7) ────────────────
  // A click, tap or Enter selects: they stop facing the camera with a bright
  // outline, a ring on the ground and their name and job under them, and
  // round buttons fan out in an arc above (turned to stay on screen near an
  // edge). Click elsewhere, Esc, or a button deselects. A window opened from
  // the menu holds them standing until it closes. Sounds: a pop as the menu
  // opens, another as it closes.
  const SOUND = { on: 'ui/pop_on.mp3', off: 'ui/pop_off.mp3' };
  const sound = k => { if (typeof global.playSfx === 'function') global.playSfx(SOUND[k]); };
  const M = { v: null, el: null };
  const roleLabel = r => { try { return global.KWCareers && global.KWCareers.roleLabel ? global.KWCareers.roleLabel(r) : null; } catch (_) { return null; } };
  // "Poppy Brightburrow · farmer, 20". Pure.
  function nameLine(c, label = roleLabel) {
    const age = Number.isFinite(Number(c.age)) ? Math.floor(Number(c.age)) : null;
    let what;
    if (c.stage === 'child' || (!c.stage && c.life_stage === 'child')) what = 'child';
    else if (c.stage === 'youth') { const k = c.apprentice && c.apprentice.class_key; what = k ? 'apprentice ' + String(label(k) || k).toLowerCase() : 'youth'; }
    else what = String(label(c.role) || c.role || 'villager').toLowerCase();
    return (c.name || 'Villager') + ' · ' + what + (age != null ? ', ' + age : '');
  }
  // The menu's buttons for someone. Children have no Change work; youths
  // have Apprenticeship in its place. `social` (js/social.js, today's state
  // for them) adds Talk to… and Praise, greyed (`off`) once used. Pure.
  function menuItems(c, social) {
    const youth = c.stage === 'youth', child = !youth && (c.stage === 'child' || (!c.stage && c.life_stage === 'child'));
    const items = [{ key: 'inspect', icon: '🔍', label: 'Inspect' }];
    if (social) {
      items.push({ key: 'talk', icon: '💬', label: social.talked ? 'Chatted today' : 'Talk to…', off: !!social.talked });
      const none = social.ready && !social.praised && social.praiseLeft <= 0;
      items.push({ key: 'praise', icon: '👏', label: social.praised ? 'Praised today' : none ? 'No praise left' : social.ready ? `Praise (${social.praiseLeft})` : 'Praise', off: !!social.praised || none });
    }
    items.push({ key: 'family', icon: '👪', label: 'Family' });
    if (youth) items.push({ key: 'apprentice', icon: '🎓', label: 'Apprenticeship' });
    else if (!child) items.push({ key: 'work', icon: '🛠️', label: 'Change work' });
    items.push({ key: 'house', icon: '🏡', label: 'House' });
    return items;
  }
  // Where the buttons go: an arc of `n` around `centre` degrees (−90 is
  // straight up; screen y grows downward), turned toward the middle when the
  // villager stands near the left or right edge of the view. Pure.
  // Five or six buttons take a wider, larger arc so their labels stay apart.
  function arc(n, { radius = 96, spread = 150, sx = 500, viewW = 1000, edge = 130 } = {}) {
    const atEdge = sx < edge || sx > viewW - edge, many = n > 4;
    if (many) { radius += (n - 4) * 9; spread = 150 + (n - 4) * 30; }
    const at = (deg) => { const r = deg * Math.PI / 180; return { x: Math.round(Math.cos(r) * radius), y: Math.round(Math.sin(r) * radius) }; };
    if (many && atEdge) {
      // Worked out for the left edge, mirrored for the right: the arc starts
      // no further toward the edge than there is room for a button, and runs
      // over the head and down the inner side.
      const room = Math.max(0, (sx < edge ? sx : viewW - sx) - 26);
      const limit = room >= radius ? -180 : -Math.acos(-room / radius) * 180 / Math.PI;
      const from = Math.max(-35 - 85, limit), to = Math.min(from + 170, 75);
      const pts = Array.from({ length: n }, (_, i) => at(from + (to - from) * i / (n - 1)));
      return sx < edge ? pts : pts.map(q => ({ x: -q.x, y: q.y })).reverse();
    }
    const centre = sx < edge ? -60 : sx > viewW - edge ? -120 : -90;
    if (atEdge) spread = Math.min(spread, 115);   // turned, and narrower, so it stays above the head
    const step = n > 1 ? spread / (n - 1) : 0, start = centre - spread / 2 * (n > 1 ? 1 : 0);
    return Array.from({ length: n }, (_, i) => at(start + step * i));
  }

  function select(v, byKeyboard) {
    if (v.state === 'gone' || v.state === 'indoors') return;
    // Someone with a moment waiting opens it in the dialogue box instead (§3.7).
    if (v.moment && global.KWMoments && global.KWMoments.open) {
      if (M.v) deselect(true, true);
      sound('on');
      global.KWMoments.open(v.moment.id);
      return;
    }
    // Someone walking into a building can still be picked: they stop.
    if (v.state === 'leave') v.state = 'idle';
    if (v.act) { v.act = null; v.guest = false; v.el.classList.remove('kwv-gone'); setSay(v, null); }   // picked out of a scene
    if (global.KWBuildingMenu) global.KWBuildingMenu.close(false, true);   // one menu at a time
    if (M.v && M.v !== v) deselect(true, true);
    endChat(v, performanceNow());
    v.selected = true; v.held = false;
    v.dir = 's';
    v.el.classList.add('kwv-selected');
    v.el.setAttribute('aria-expanded', 'true');
    let tag = v.el.querySelector('.kwv-name');
    if (!tag) { tag = doc.createElement('span'); tag.className = 'kwv-name'; v.el.appendChild(tag); }
    tag.textContent = nameLine(v.c);
    const ring = v.el.querySelector('.kwv-ring') || v.el.appendChild(Object.assign(doc.createElement('span'), { className: 'kwv-ring' }));
    placeHit(v); void ring;
    draw(v, false);
    openMenu(v, byKeyboard);
    sound('on');
  }
  // `quiet`: no sound (another villager was picked, or the scene is closing).
  function deselect(soundOff, quiet) {
    const v = M.v;
    closeMenu();
    if (!v) return;
    v.selected = false;
    v.el.classList.remove('kwv-selected');
    v.el.removeAttribute('aria-expanded');
    const tag = v.el.querySelector('.kwv-name'); if (tag) tag.remove();
    const ring = v.el.querySelector('.kwv-ring'); if (ring) ring.remove();
    if (v.leaveWhy === 'town' && !v.held) leave(v, 'town');   // they were on their way out of town
    else { v.leaveWhy = null; if (!v.held) idle(v, performanceNow(), 600 + S.rand() * 900); }
    if (soundOff && !quiet) sound('off');
  }

  function openMenu(v, byKeyboard) {
    closeMenu();
    M.v = v;
    const items = menuItems(v.c, global.KWSocial ? global.KWSocial.forMenu(v.id) : null);
    const sc = doc.getElementById('sv-scene');
    const vr = v.el.getBoundingClientRect(), sr = sc ? sc.getBoundingClientRect() : { left: 0, width: 1000 };
    const pts = arc(items.length, { sx: vr.left + vr.width / 2 - sr.left, viewW: sr.width, radius: isPhone() ? 100 : 96 });
    const m = doc.createElement('div');
    m.className = 'kwv-radial';
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', v.c.name || 'Villager');
    const head = (v.child ? 0.75 : 1) * 62;   // the figure is about 62 px tall
    m.style.left = Math.round(v.x) + 'px';
    m.style.top = Math.round(v.y - head) + 'px';
    m.innerHTML = items.map((it, i) => `<button type="button" class="kwv-rb${it.off ? ' kwv-rb-off' : ''}" role="menuitem" data-kwv-act="${it.key}"${it.off ? ' aria-disabled="true"' : ''} style="--rx:${pts[i].x}px;--ry:${pts[i].y}px">`
      + `<span class="kwv-rb-i" aria-hidden="true">${it.icon}</span><span class="kwv-rb-l">${it.label}</span></button>`).join('');
    m.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('[data-kwv-act]');
      if (!b) return;
      // Greyed (used today): it says why and when it comes back; the menu stays.
      if (b.getAttribute('aria-disabled') === 'true') {
        if (global.KWSocial && typeof global.showToastNotification === 'function') global.showToastNotification(global.KWSocial.why(b.getAttribute('data-kwv-act'), v.id), 'default');
        return;
      }
      choose(b.getAttribute('data-kwv-act'));
    });
    m.addEventListener('keydown', e => {
      const bs = [...m.querySelectorAll('.kwv-rb')], i = bs.indexOf(doc.activeElement);
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        bs[(i + d + bs.length) % bs.length].focus();
      }
    });
    S.layer.appendChild(m);
    M.el = m;
    // Fan out (CSS does 150 ms; none under reduced motion).
    requestFrame(() => m.classList.add('kwv-open'));
    if (byKeyboard) { const first = m.querySelector('.kwv-rb'); if (first) first.focus(); }
  }
  function closeMenu() {
    if (M.el) M.el.remove();
    M.el = null; M.v = null;
  }

  // What each button does. The villager is held until the window closes.
  function choose(key) {
    const v = M.v;
    if (!v) return;
    const c = v.c, id = v.id;
    if (key === 'praise') { deselect(true); if (global.KWSocial) global.KWSocial.praise(id); return; }   // no window: they carry on
    v.held = true; v.heldFrom = performanceNow(); v.heldCheck = performanceNow() + 300; v.heldBy = null;
    deselect(true);
    const call = (name, ...a) => (typeof global[name] === 'function' ? global[name](...a) : null);
    if (key === 'inspect') call('openCitizenProfile', id);
    else if (key === 'family') { if (global.KWFamilies) global.KWFamilies.open(c.family_id ? { family: c.family_id } : {}); }
    else if (key === 'work' || key === 'apprentice') { call('openCitizenProfile', id); focusInProfile('.cp-role-section .cp-role-select'); }   // the job picker, or a youth's trade
    else if (key === 'house') openHome(c);
    else if (key === 'talk') { if (global.KWSocial) global.KWSocial.openTalk(id); }
  }
  // The job picker (or the apprenticeship) is in the citizen's profile: open
  // it there, scrolled to and focused.
  function focusInProfile(sel) {
    let n = 0;
    const tryIt = () => {
      const el = doc.querySelector('#citizen-profile-modal ' + sel);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); const box = el.closest('.cp-role-section'); if (box) { box.classList.remove('kwv-flash'); void box.offsetWidth; box.classList.add('kwv-flash'); } }
      else if (++n < 20) setTimeout(tryIt, 100);
    };
    setTimeout(tryIt, 50);
  }
  // Their home in the Neighbourhood scene, with its window open.
  async function openHome(c) {
    if (global.KWHood) await global.KWHood.open(c.house_id != null ? { house: c.house_id } : {});
  }
  // The window a menu button opened (the topmost one), and whether it is
  // still open. A KWWindow (Families) is tracked by its id.
  function openWindow() {
    const W = global.KWWindow;
    if (W && W.isOpen && W.isOpen('families')) return { kww: 'families' };
    if (W && W.isOpen && W.isOpen('house')) return { kww: 'house' };
    if (W && W.isOpen && W.isOpen('talk')) return { kww: 'talk' };
    const top = global.KWA11y && global.KWA11y.topmost ? global.KWA11y.topmost() : null;
    return top ? { el: top } : null;
  }
  function stillOpen(w) {
    if (w.kww) return !!(global.KWWindow && global.KWWindow.isOpen(w.kww));
    if (!w.el || !w.el.isConnected) return false;
    if (w.cls) return w.el.classList.contains(w.cls);
    const cs = global.getComputedStyle(w.el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && w.el.getBoundingClientRect().width > 0;
  }
  // The hit box: round the figure, from the sheet's foot point.
  function placeHit(v, s) {
    const hit = v.el.querySelector('.kwv-hit');
    if (!hit) return;
    const sp = s || (V().spriteFor(V().meta, v.c.species || townSpecies(), 'idle', 's'));
    if (!sp) return;
    // The whole figure, ears and tail included; roomier on touch screens.
    const k = v.child ? 0.75 : 1, touch = coarse();
    const w = touch ? 58 : 48, h = touch ? 82 : 70;
    hit.style.left = Math.round((sp.foot.x - w / 2) * k) + 'px';
    hit.style.top = Math.round((sp.foot.y - h + 6) * k) + 'px';
    hit.style.width = Math.round(w * k) + 'px';
    hit.style.height = Math.round(h * k) + 'px';
    const tag = v.el.querySelector('.kwv-tag');
    if (tag) { tag.style.left = Math.round(sp.foot.x * k) + 'px'; tag.style.top = Math.round((sp.foot.y + 5) * k) + 'px'; }
    const mark = v.el.querySelector('.kwv-mark');
    if (mark) { mark.style.left = Math.round(sp.foot.x * k) + 'px'; mark.style.top = Math.round((sp.foot.y - 66) * k) + 'px'; }
  }
  const coarse = () => !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
  // The villager under a point, even one standing just behind a building's
  // transparent edge (its image box would otherwise take the press).
  function villagerAt(x, y) {
    if (!S.shown || S.paused || !doc.elementsFromPoint) return null;
    const all = doc.elementsFromPoint(x, y);
    // Only a press on the scene itself: never through a window, panel or card over it.
    if (!all.length || !all[0].closest || !all[0].closest('#sv-scene')) return null;
    for (const el of all) {
      if (el.classList && el.classList.contains('kwv-radial')) return null;
      if (el.classList && el.classList.contains('kwv-hit')) { const b = el.closest('.kwv-cit'); const v = b && S.vs.get(Number(b.getAttribute('data-cid'))); if (v && v.state !== 'gone' && v.state !== 'indoors') return v; }
    }
    return null;
  }
  // Selecting by pointer: press on a villager (they stop while pressed) and
  // let go within 10 px and a second. More movement is a pan. The click that
  // follows is swallowed so the building behind doesn't open too.
  const P = { v: null, x: 0, y: 0, t: 0, id: null, swallow: false };
  function pressEnd(e, cancelled) {
    const v = P.v;
    if (!v || (e && e.pointerId !== P.id)) return;
    P.v = null; v.pressed = false;
    if (cancelled || !e) return;
    if (Math.hypot(e.clientX - P.x, e.clientY - P.y) > 10 || performanceNow() - P.t > 1000) return;
    const sc = doc.getElementById('sv-scene');
    if (sc && sc.classList.contains('sv-panning')) return;   // it became a pan
    P.swallow = true; setTimeout(() => { P.swallow = false; }, 400);
    if (v.selected) deselect(true); else select(v, false);
  }
  // Press elsewhere (or Esc) closes the menu.
  if (doc) {
    doc.addEventListener('pointerdown', e => {
      if (e.target.closest && e.target.closest('.kwv-radial')) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      const v = villagerAt(e.clientX, e.clientY);
      if (M.v && v !== M.v) deselect(true);
      if (v) { P.v = v; P.x = e.clientX; P.y = e.clientY; P.t = performanceNow(); P.id = e.pointerId; v.pressed = true; }
    }, true);
    global.addEventListener('pointerup', e => pressEnd(e, false), true);
    global.addEventListener('pointercancel', e => pressEnd(e, true), true);
    doc.addEventListener('click', e => { if (P.swallow && !(e.target.closest && e.target.closest('.kwv-radial'))) { P.swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
    // Esc with the menu open closes it first: it is the topmost thing, so this
    // listens before js/a11y.js (window, capture), unless a dialog is up.
    global.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !M.v || e.defaultPrevented) return;
      if ((global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen()) || (global.KWWindow && global.KWWindow.isOpen && global.KWWindow.isOpen())) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const v = M.v;
      deselect(true);
      try { v.el.focus({ preventScroll: true }); } catch (_) {}
    }, true);
  }

  // ── Moment markers (§3.7, step 9) ───────────────────────────────────────
  // Each open moment is carried by one villager in the scene: its first
  // citizen who is out, or, for a town-wide question (the season's choices,
  // which name nobody), a messenger: an elder if one is out, else the oldest
  // grown-up. They come outdoors, walk to a clear spot near the middle of the
  // view and stand facing the camera with a bobbing "!". Clicking them opens
  // the moment. Moments about an outpost, a village's envoy or a settler on
  // the road have nobody in town: they stay in the moment cards only.
  const momentList = () => { try { return global.KWMoments ? global.KWMoments.list() : []; } catch (_) { return []; } };
  // → Map(villagerId → moment). Pure: `cast` is [{ id, child, elder, age, out }].
  function assignMoments(moments, cast) {
    const out = new Map();
    const avail = cast.filter(c => c.out);
    const free = id => !out.has(id);
    const messenger = () => {
      const grown = avail.filter(c => !c.child && free(c.id));
      grown.sort((a, b) => (b.elder - a.elder) || ((Number(b.age) || 0) - (Number(a.age) || 0)) || (a.id - b.id));
      return grown[0] || null;
    };
    for (const m of moments || []) {
      const subj = (m && m.subject) || {};
      const ids = (subj.citizen_ids || []).map(Number);
      let who = null;
      if (ids.length) for (const id of ids) { const c = avail.find(x => x.id === id && free(x.id)); if (c) { who = c; break; } }   // the moment's own order: its main person first
      else if (m.source === 'year') who = messenger();
      if (who) out.set(who.id, m);
    }
    return out;
  }
  function markMoments() {
    const cast = [...S.vs.values()].filter(v => v.state !== 'gone' && v.state !== 'leave').map(v => ({ id: v.id, child: v.child, elder: v.elder, age: v.c.age, out: true }));
    const marks = assignMoments(momentList(), cast);
    for (const v of S.vs.values()) {
      const m = marks.get(v.id) || null;
      if ((m && m.id) === (v.moment && v.moment.id)) continue;
      v.moment = m; v.mSpot = null;
      let el = v.el.querySelector('.kwv-mark');
      if (m) {
        if (!el) { el = doc.createElement('span'); el.className = 'kwv-mark'; el.setAttribute('aria-hidden', 'true'); el.textContent = '!'; v.el.appendChild(el); }
        placeHit(v);
        v.el.setAttribute('aria-label', (v.c.name || 'A villager') + ' has something to ask: ' + (m.title || 'a moment') + '. Open');
        endChat(v, performanceNow());
      } else {
        if (el) el.remove();
        v.el.setAttribute('aria-label', nameLine(v.c) + '. Show choices');
        if (v.state === 'tomoment' || v.state === 'waiting') idle(v, performanceNow(), 500 + S.rand() * 1000);
      }
    }
  }
  // A clear spot near the middle of what the player is looking at: on the
  // lane between the rows where no building stands in front of it, else on
  // the open meadow along the front. Others waiting keep 60 px away.
  function momentSpot(v) {
    const sc = doc.getElementById('sv-scene');
    const lr = S.layer.getBoundingClientRect(), sx = lr.width / (S.layer.clientWidth || 1);
    const sr = sc ? sc.getBoundingClientRect() : lr;
    const cx = (sr.left + sr.width / 2 - lr.left) / sx;
    const taken = [...S.vs.values()].filter(o => o !== v && o.moment && o.mSpot).map(o => o.mSpot);
    const spot = clearSpot(cx, { w: W(), h: H(), blocks: S.blocks || [], taken, lane: 0.74, front: 0.965 });
    return spreadPoint(spot, othersOf(v));   // and not on top of anyone
  }
  // The nearest x to `cx` where a villager (48 × 64 px) on the lane is not
  // behind a building that stands in front of it (its foot lower down), and
  // not within 60 px of someone already waiting; else the front. Pure.
  function clearSpot(cx, { w, h, blocks, taken = [], lane = 0.74, front = 0.965, step = 36, reach = 900 }) {
    const free = (x, y) => !taken.some(t => Math.abs(t.x - x) < 60 && Math.abs(t.y - y) < 30);
    const hidden = (x, y) => blocks.some(b => b.b > y && x + 24 > b.l && x - 24 < b.r && y - 64 < b.b && y > b.t);
    for (const y of [lane * h, front * h]) {
      for (let k = 0; k <= reach / step; k++) {
        for (const x of k ? [cx + k * step, cx - k * step] : [cx]) {
          if (x < w * 0.03 || x > w * 0.97) continue;
          if (!hidden(x, y) && free(x, y)) return { x, y };
        }
      }
    }
    return { x: Math.max(w * 0.03, Math.min(w * 0.97, cx)), y: front * h };
  }
  function stepMoment(v, dt, now) {
    if (v.talk) endChat(v, now);   // a moment came up mid-chat: its result shows now
    if (v.state === 'indoors') comeOut(v, now);
    if (!v.mSpot) { v.mSpot = momentSpot(v); v.tx = v.mSpot.x; v.ty = v.mSpot.y; v.state = 'tomoment'; }
    if (v.state === 'waiting') return;
    const dx = v.tx - v.x, dy = v.ty - v.y, dist = Math.hypot(dx, dy), stepPx = v.speed * 1.15 * dt / 1000;
    if (dist <= stepPx) { v.x = v.tx; v.y = v.ty; v.state = 'waiting'; v.dir = 's'; return; }
    v.x += dx / dist * stepPx; v.y += dy / dist * stepPx;
    v.dir = V().dirFromVector(dx, dy);
  }

  // ── The loop ────────────────────────────────────────────────────────────
  function step(v, dt, now) {
    if (v.state === 'gone') return;
    v.t += dt;
    // Selected: stands facing the camera until the menu closes. Held: a window
    // opened from the menu is still up; they walk on once it closes.
    if (v.selected || v.pressed) return;   // a finger or button is on them: they wait
    if (v.act && (v.moment || v.held)) endAct(v, now);   // a moment or a window takes them out of the scene
    if (v.act) { actStep(v, dt, now); return; }
    if (v.moment && !v.held && v.state !== 'leave') { stepMoment(v, dt, now); return; }
    if (v.held) {
      // Held by the window the button opened: found once it appears, released
      // when it closes (or after 3 s if nothing opened; never past 10 minutes).
      if (now >= (v.heldCheck || 0)) {
        v.heldCheck = now + 400;
        if (!v.heldBy) v.heldBy = openWindow();
        const gone = v.heldBy ? !stillOpen(v.heldBy) : now - v.heldFrom > 3000;
        if (gone || now - v.heldFrom > 600000) { v.held = false; v.heldBy = null; idle(v, now, 400 + S.rand() * 800); }
      }
      return;
    }
    if (v.state === 'indoors' && buildSpot(v)) { comeOut(v, now); return; }   // there is building to do
    if (v.state === 'build' || v.state === 'cheer') { buildStep(v, now); return; }
    if (v.state === 'dance') { danceStep(v, now); return; }
    if (v.guarding && S.event !== 'raid') { v.guarding = false; if (v.say === '🛡️') setSay(v, null); }
    // During a raid nobody but the guards comes back out.
    if (v.state === 'indoors' && S.event === 'raid') { if (isGuard(v.c)) comeOut(v, now); return; }
    if (v.state === 'indoors') {
      // At work: in while working, out when the break or the day comes.
      if (workKey(v) && v.inside === workKey(v)) {
        if (working(v, now)) return;
        if (S.phase !== 'night') { comeOut(v, now); return; }
      }
      // Night keeps people in until morning (staggered); otherwise their time is up.
      const nightIn = S.phase === 'night' && !S.owls.has(v.id);
      // Kept in overnight: come out over the next 20 s in the morning, not all at once.
      if (nightIn) v.nightIn = true;
      else if (v.nightIn) { v.nightIn = false; v.until = Math.max(v.until, now + S.rand() * 20000); }
      if (now >= v.until && !nightIn && !(v.child && parentOf(v) && parentOf(v).state === 'indoors')) comeOut(v, now);
      return;
    }
    if (v.emote && (now >= v.emoteUntil || v.say !== v.emote)) { if (v.say === v.emote) setSay(v, null); v.emote = null; }   // an emote's time is up
    if (v.state === 'solo') { if (now >= v.until) { const t = v.talk; v.talk = null; setSay(v, null); if (t) talkResult(t); idle(v, now, 500 + S.rand() * 900); } return; }
    if (v.child && !v.talk && v.state !== 'leave' && child(v, now)) { /* targets set */ }
    else if (v.state === 'idle') { if (now >= v.until) errand(v, now); return; }
    else if (v.state === 'waitchat') {
      const p = S.vs.get(v.partner);
      if (!p || p.partner !== v.id || now >= v.until) endChat(v, now);
      else if (p.state === 'waitchat') chatting(v, p, now);
      return;
    }
    else if (v.state === 'chat') {
      const p = S.vs.get(v.partner);
      if (!p || now >= v.until) { endChat(v, now); return; }
      if (v.talk) { if (v.leads) talkStep(v, p, now); return; }   // set up by the player: scripted
      // Take turns: the bubble passes back and forth every 1.4 s.
      if (v.leads) {
        const turn = Math.floor((now - v.sayFrom) / 1400) % 2 === 0;
        const pick = () => SAY[Math.floor(S.rand() * SAY.length)];
        if (turn && !v.say) { setSay(v, pick()); setSay(p, null); } else if (!turn && !p.say) { setSay(p, pick()); setSay(v, null); }
      }
      return;
    }
    if (v.state === 'idle' || (v.child && v.state === 'idle')) return;
    const dx = v.tx - v.x, dy = v.ty - v.y, dist = Math.hypot(dx, dy);
    if (v.state === 'tochat' && v.talk && now >= v.until) { endChat(v, now); return; }   // never got there
    const stepPx = v.speed * (v.talk ? 1.8 : v.run ? TOWN.RUN : v.state === 'chase' || v.state === 'ahead' || v.state === 'toring' ? 1.3 : lowMood(v) ? MOOD.LOW_SPEED : 1) * dt / 1000;
    if (dist <= stepPx) {
      v.x = v.tx; v.y = v.ty;
      if (v.state === 'leave') { drop(v); return; }
      if (v.state === 'toring') { v.state = 'dance'; v.until = now + TOWN.DANCE_MS[0] + S.rand() * (TOWN.DANCE_MS[1] - TOWN.DANCE_MS[0]); v.danceFrom = now - S.rand() * 3000; v.danceSay = S.rand() < 0.5 ? '🎵' : '🏮'; return; }
      if (v.guarding && S.event === 'raid') { idle(v, now, 6000); v.dir = 's'; setSay(v, '🛡️'); return; }
      if (v.state === 'tosite') { v.state = 'build'; v.until = now + BUILD_MS[0] + S.rand() * (BUILD_MS[1] - BUILD_MS[0]); v.hamFrom = now; v.puffAt = now + 600; v.dir = V().dirFromVector((v.siteX || v.x) - v.x, 0) || 'e'; return; }
      if (v.state === 'tochat') {
        const p = S.vs.get(v.partner);
        if (!p || p.partner !== v.id) { endChat(v, now); return; }
        v.state = 'waitchat';
        if (p.state === 'waitchat') chatting(v, p, now);
        return;
      }
      if (v.goal && v.goal.door) { goIndoors(v, now, v.goal.door); return; }
      if (v.child) { v.state = v.state === 'ahead' ? 'ahead' : 'idle'; v.until = Math.max(v.until, now + 300); return; }
      idle(v, now);
      return;
    }
    v.x += dx / dist * stepPx; v.y += dy / dist * stepPx;
    v.dir = V().dirFromVector(dx, dy);
  }
  function draw(v, still) {
    if (v.state === 'indoors' || v.state === 'gone') return;
    const meta = V().meta;
    const walking = !still && !v.selected && !v.held && ['walk', 'leave', 'tochat', 'tosite', 'toring', 'act', 'follow', 'ahead', 'chase', 'tomoment'].includes(v.state) && Math.hypot(v.tx - v.x, v.ty - v.y) > 1;
    const s = V().spriteFor(meta, v.c.species || townSpecies(), walking ? 'walk' : 'idle', still || v.selected ? 's' : v.dir);
    if (!s) return;
    const frame = still ? 0 : Math.floor(v.t / s.ms) % s.frames;
    V().paint(v.el, s, frame, v.child ? 0.75 : 1, v.x, v.y);
    const z = v.selected ? 1005 : depth(v.y);   // under the night overlay (1050)
    if (v.z !== z) { v.z = z; v.el.style.zIndex = String(z); }
    if (!v.hitSet) { v.hitSet = true; placeHit(v, s); }
  }
  // Every couple of seconds, maybe one pair stops for a chat.
  function maybeChat(now) {
    const free = [...S.vs.values()].map(v => ({ id: v.id, x: v.x, y: v.y, child: v.child, selected: !!v.selected || !!v.held,
      free: live(v) && (v.state === 'idle' || v.state === 'walk') && !v.goal && v.partner == null && (S.phase !== 'night') }));
    const pairs = chatPairs(free, now, S.cool);
    if (S.event === 'raid') return;
    const glum = S.mood && S.mood.happy != null && S.mood.happy < MOOD.LOW;   // an unhappy town chats less
    if (pairs.length && S.rand() < 0.35 * (glum ? MOOD.LOW_CHAT : 1)) startChat(S.vs.get(pairs[0][0]), S.vs.get(pairs[0][1]), now);
  }
  function tick(now) {
    S.raf = 0;
    if (!running()) return;
    const dt = Math.min(100, S.last ? now - S.last : 0);
    S.last = now;
    if ((S.syncT += dt) > 5000) {   // the town changes: refresh the cast; the clock moves on
      S.syncT = 0;
      survey();
      const ph = S.hold || clockPhase();
      if (ph !== S.phase) { S.phase = ph; nightLights(); }
      if (signature(cits()) !== S.sig) recast(false);
    }
    if ((S.rotateT += dt) > ROTATE_MS) { S.rotateT = 0; if (S.phase !== 'night' && S.event !== 'raid') rotate(); }
    if ((S.chatT += dt) > 2000) { S.chatT = 0; maybeChat(now); }
    if ((S.moodT = (S.moodT || 0) + dt) > 2500) { S.moodT = 0; maybeMood(now); }
    if ((S.lifeTickT = (S.lifeTickT || 0) + dt) > 1000) { S.lifeTickT = 0; townTick(now); if (S.event !== 'raid') lifeTick(now); }
    if ((S.markT = (S.markT || 0) + dt) > 1000) { S.markT = 0; markMoments(); }
    const t0 = performanceNow();
    S.owls = nightOwls([...S.vs.values()].filter(x => live(x) && !x.child).map(x => x.id));
    if ((S.outT = (S.outT || 0) + dt) > 2000) { S.outT = 0; keepSomeOut(now); }
    S.size = { w: S.layer.clientWidth, h: S.layer.clientHeight };
    try { for (const v of S.vs.values()) { step(v, dt, now); draw(v, false); } } finally { S.size = null; }
    S.ms = S.ms * 0.95 + (performanceNow() - t0) * 0.05;   // the loop's own cost (target: under 2 ms)
    S.raf = requestFrame(tick);
  }
  const running = () => S.shown && !S.paused && S.layer && !doc.hidden && !(V() && V().reducedMotion());
  // Evening and night: buildings with a lit image glow. data-phase drives the
  // sky, the night tint and the lit windows (css/home-scene.css).
  function nightLights() {
    const v = doc.getElementById('settlement-view');
    if (!v) return;
    v.classList.toggle('kwv-night', S.phase === 'night' || S.phase === 'dusk');
    v.setAttribute('data-phase', S.phase);
    syncGlow();
  }
  // The lit windows' glow sits over the world, so it follows the buildings
  // here: when the scene starts, the area changes or the phase turns.
  function syncGlow() { const H = global.KWHome; if (H && H.syncGlow) requestFrame(() => H.syncGlow()); }

  function clear() {
    closeMenu();
    for (const v of S.vs.values()) { if (v.talk) talkResult(v.talk); v.el.remove(); }   // a chat under way is still told
    S.vs.clear();
  }
  function start() {
    if (!S.shown || S.paused || !S.layer || !V()) return;
    V().injectStyles();
    S.phase = S.hold || clockPhase();
    nightLights();
    V().load().then(() => {
      if (!S.shown || S.paused) return;
      // Wait a frame for the scene's buttons to be drawn and measured.
      requestFrame(() => {
        if (!S.shown || S.paused) return;
        if (!S.vs.size) recast(true); else survey();
        syncGlow();
        if (V().reducedMotion()) { for (const v of S.vs.values()) draw(v, true); return; }   // standing still
        if (!S.raf) { S.last = 0; S.raf = requestFrame(tick); }
      });
    });
  }
  function stop() { if (S.raf) { (global.cancelAnimationFrame || clearTimeout)(S.raf); S.raf = 0; } }

  function sceneShown(layer) {
    const area = layer && /^sv-layer-fg-/.test(layer.id) && GROUND[layer.id.slice(12)] ? layer.id.slice(12) : 'town';
    if (layer !== S.layer || area !== S.area) { clear(); S.layer = layer; S.area = area; S.openedAt = performanceNow(); }
    S.shown = true;
    start();
  }
  function sceneHidden() { S.shown = false; stop(); clear(); }
  function setPaused(p) {
    S.paused = !!p;
    if (S.paused) { deselect(true); stop(); for (const v of S.vs.values()) v.el.style.display = 'none'; }
    else { for (const v of S.vs.values()) v.el.style.display = ''; start(); }
  }
  if (doc) doc.addEventListener('visibilitychange', () => { if (doc.hidden) stop(); else start(); });
  if (global.addEventListener) global.addEventListener('resize', () => { if (S.shown) survey(); });

  global.KWCast = {
    sceneShown, sceneHidden, setPaused,
    get frameMs() { return S.ms; },
    get phase() { return S.phase; },
    get count() { return [...S.vs.values()].filter(v => v.state !== 'gone').length; },
    get villagers() { return [...S.vs.values()].map(v => ({ id: v.id, x: v.x, y: v.y, state: v.state, dir: v.dir, child: v.child, partner: v.partner, say: v.say, inside: v.inside || null, selected: !!v.selected, held: !!v.held })); },
    get selected() { return M.v ? M.v.id : null; },
    select: id => { const v = S.vs.get(Number(id)); if (v) select(v, false); return !!v; },
    _villagerAt: (x, y) => { const v = villagerAt(x, y); return v ? v.id : null; },
    _rotate: () => rotate(),   // tests: send one walking in now
    deselect: () => deselect(true),
    SOUND, _nameLine: nameLine, _menuItems: menuItems, _arc: arc, _assignMoments: assignMoments, _clearSpot: clearSpot,
    get marked() { return [...S.vs.values()].filter(v => v.moment).map(v => ({ id: v.id, moment: v.moment.id, state: v.state })); },
    GROUND, SPOTS, CAP, ROLE_BUILDING, SPEED, CHAT_RANGE, CHAT_COOLDOWN, INDOORS_MS, NIGHT_OUT, MIN_OUT,
    _routine: routine, _atWork: atWork, _callOut: callOut, _stayMs: stayMs, _setClock: f => { S.clock = f || null; },
    _pickCast: pickCast, _areaOf: areaOf, _inPolygon: inPolygon, _groundPoint: groundPoint, _onGround: onGround, _doorPoint: doorPoint, _seeded: seeded,
    _chooseErrand: chooseErrand, _nightOwls: nightOwls, _chatPairs: chatPairs, _followPoint: followPoint,
    _spreadPoint: spreadPoint, _doorSpot: doorSpot, _chatSpots: chatSpots, APART, CHAT_GAP,
    _seed: n => { S.rand = seeded(n); },
    // The scene changed (a building built, moved or removed, a resize): look
    // again at the doors, and redraw the paths and props.
    // (Home's first cast is made before its buildings are drawn, so nobody's
    // workplace is known yet: once they are, the cast is made again at once.)
    resurvey: () => {
      if (!(S.layer && S.shown && S.layer.clientHeight)) return;
      survey(); syncGlow();
      if (S.openedAt && performanceNow() - S.openedAt < 6000 && cits().length && signature(cits()) !== S.sig) recast(true);
    },
    // Who the scene has inside a building right now (js/building-menu.js,
    // Who's here): exactly the villagers whose state is indoors there.
    inside: key => [...S.vs.values()].filter(v => v.state === 'indoors' && v.inside === key)
      .map(v => ({ id: v.id, name: v.c.name || 'Villager', why: insideWhy(v, key) })),
    // From Who's here: they step out of the door and their menu opens.
    callOut: id => {
      const v = S.vs.get(Number(id));
      if (!v) return false;
      if (v.state === 'indoors') comeOut(v, performanceNow());
      draw(v, true);
      requestFrame(() => select(v, false));
      return true;
    },
    deselect: () => { if (M.v) deselect(true); },
    // A chat the player set up, and praise (js/social.js).
    playTalk, playPraise, TALK_MS,
    // Builders (js/construction.js): where they are and what they do.
    // Who is in which part of town.
    VISIT, _townVisitors: townVisitors, get visitors() { return [...(S.visitors || [])]; },
    // Town-wide events (§3.10).
    TOWN, _townEvent: townEvent, _ringSpot: ringSpot, get event() { return S.event || null; },
    // Life events (§3.9).
    LIFE, offerLife, _lifeScene: lifeScene, _lifeNews: lifeNews, get lifePlaying() { return S.lifePlaying ? S.lifePlaying.kind : null; },
    _playLife: e => { S.lifeWaiting = (S.lifeWaiting || []).concat([e]).slice(0, LIFE.WAITING); },   // tests and Dev Tools: play this chronicle line
    // Mood (§3.8).
    EMOTES, MOOD, _townMood: townMood, _moodOf: moodOf, _emoteTurn: emoteTurn, get mood() { return S.mood || null; },
    hush: ms => { S.hush = performanceNow() + (Number(ms) || 0); },   // no emotes for a while (a death: §3.9)
    BUILDERS_SHOWN, _buildSpot: id => { const v = S.vs.get(Number(id)); return v ? buildSpot(v) : null; }, _siteArea: siteArea, _cheer: cheer, get sites() { return (S.sites || []).slice(); },
    // A look at another time of day: KWCast.preview('night' | 'dusk' | 'dawn' | 'day')
    // holds it until KWCast.preview(null) (or a reload) goes back to the clock.
    preview: p => { S.hold = p || null; S.phase = p || clockPhase(); nightLights(); return S.phase; },
    _setPhase: p => { S.hold = p || null; S.phase = p || clockPhase(); nightLights(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
