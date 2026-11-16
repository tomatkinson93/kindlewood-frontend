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

  // ── Behaviour rules (§3.5), pure ────────────────────────────────────────
  // Time of day from the game clock: dawn, day, dusk (evening) or night.
  const CHAT_RANGE = 200, CHAT_GAP = 56, CHAT_COOLDOWN = 120000, CHAT_MS = [4000, 7000];
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
    if (ctx.phase === 'dusk') {
      if (ctx.tavern && r < 0.3) return door(ctx.tavern);
      if (ctx.home && r < 0.45) return door(ctx.home);
      return outdoors();
    }
    // Morning sends workers to their buildings; by day now and then.
    if (ctx.work && r < (ctx.phase === 'dawn' ? 0.4 : 0.1)) return door(ctx.work);
    if (ctx.doors.length && r < (ctx.phase === 'dawn' ? 0.45 : 0.14)) return door(ctx.doors[Math.floor(rand() * ctx.doors.length)]);
    return outdoors();
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

  // Where a child walking with a parent aims: a little behind them.
  function followPoint(parent, behind = 28) {
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
  const W = () => S.layer.clientWidth, H = () => S.layer.clientHeight;
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
    S.doors = []; S.exits = [];
    S.layer.querySelectorAll(':scope > .sv-slot').forEach(slot => {
      if (slot.hidden) return;
      const btn = slot.querySelector('[data-kwh]');
      const artEl = btn && (btn.querySelector('.kwh-img') || btn.querySelector('.kwh-hut') || btn.querySelector('.kwh-prop-art'));
      const box = (artEl || slot).getBoundingClientRect();
      const rect = { left: (box.left - lr.left) / sx, top: (box.top - lr.top) / sy, width: box.width / sx, height: box.height / sy };
      const foot = rect.top + rect.height;
      if (!slot.classList.contains('sv-dragging')) slot.style.zIndex = String(depth(foot));
      if (!btn) return;
      const key = btn.getAttribute('data-kwh');
      const art = artEl && artEl.classList.contains('kwh-img') && global.KWHome ? global.KWHome.art(key) : artEl && artEl.classList.contains('kwh-hut') ? { hut: true } : null;
      const d = doorPoint(rect, art);
      const g = onGround(S.area, d.x / W() * 100, d.y / H() * 100);
      const p = { key, x: g.x / 100 * W(), y: g.y / 100 * H(), btn };
      if (btn.classList.contains('kwh-prop-signpost')) S.exits.push(p);
      else if (!btn.classList.contains('kwh-prop')) S.doors.push(p);
    });
  }
  const depth = footY => Math.max(1, Math.min(1000, Math.round(footY / (H() || 1) * 1000)));
  const doorOf = key => S.doors.find(d => d.key === key) || null;

  // ── Villagers ───────────────────────────────────────────────────────────
  function make(c, at, emerging) {
    const v = { id: Number(c.id), c, el: V().makeFigure(), x: at.x, y: at.y, tx: at.x, ty: at.y, state: 'idle', until: 0, t: S.rand() * 2000, dir: 's',
      child: isChild(c), elder: isElder(c), goal: null, partner: null, say: null };
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
    const home = S.area === 'town' ? doorOf('neighbourhood') : nearestDoor(v.x, v.y, S.exits);
    const ctx = { phase: S.phase, work: doorOf(ROLE_BUILDING[v.c.role]), tavern: doorOf('tavern'), home, doors: S.doors,
      spots: (SPOTS[S.area] || []).map(px), ground: () => px(groundPoint(S.area, S.rand)), owl: owls.has(v.id) };
    const g = chooseErrand(ctx, S.rand);
    walkTo(v, g.kind === 'door' ? { x: g.x + (S.rand() - 0.5) * 10, y: g.y + 2 } : g, g.kind === 'door' ? g.key : null);
  }
  function walkTo(v, p, doorKey) { v.tx = p.x; v.ty = p.y; v.goal = doorKey ? { door: doorKey } : null; v.state = 'walk'; }
  function idle(v, now, ms) {
    v.state = 'idle'; v.goal = null;
    v.until = now + (ms != null ? ms : IDLE_MS[0] + S.rand() * (IDLE_MS[1] - IDLE_MS[0]));
    // Face the camera, or the nearest villager close by.
    let near = null, d = 150;
    for (const o of S.vs.values()) if (o !== v && live(o) && o.state !== 'indoors') { const k = Math.hypot(o.x - v.x, o.y - v.y); if (k < d) { d = k; near = o; } }
    v.dir = near ? V().dirFromVector(near.x - v.x, near.y - v.y) : 's';
  }

  // Indoors: fade at the door, stay 20–60 s (at night, until morning), come
  // out and go on. The building gives a little bounce as someone goes in.
  function goIndoors(v, now, key) {
    v.state = 'indoors'; v.inside = key;
    v.until = now + INDOORS_MS[0] + S.rand() * (INDOORS_MS[1] - INDOORS_MS[0]);
    v.el.classList.add('kwv-gone');
    const d = doorOf(key) || S.exits.find(e => e.key === key);
    if (d && d.btn) { d.btn.classList.remove('kwh-bounce'); void d.btn.offsetWidth; d.btn.classList.add('kwh-bounce'); }
    // Children walking with this parent go in with them.
    for (const k of S.vs.values()) if (k.child && k.state !== 'indoors' && live(k) && parentsOf(k.c).includes(v.id)) walkTo(k, { x: v.x, y: v.y }, key);
  }
  function comeOut(v, now) {
    const d = doorOf(v.inside) || nearestDoor(v.x, v.y) || { x: v.x, y: v.y };
    v.x = d.x; v.y = d.y; v.inside = null;
    v.el.classList.remove('kwv-gone');
    idle(v, now, 600 + S.rand() * 1200);
  }

  // Leaving town: walk to the nearest door, fade, gone.
  function leave(v) {
    if (!live(v)) return;
    endChat(v, performanceNow());
    const d = nearestDoor(v.x, v.y);
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
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const side = a.x <= b.x ? -1 : 1;
    a.partner = b.id; b.partner = a.id;
    walkTo(a, { x: mx + side * CHAT_GAP / 2, y: my }, null); a.state = 'tochat'; a.until = now + 8000;
    walkTo(b, { x: mx - side * CHAT_GAP / 2, y: my }, null); b.state = 'tochat'; b.until = now + 8000;   // give up if they never meet
    S.cool[pairKey(a.id, b.id)] = now;
  }
  function chatting(a, b, now) {
    const len = CHAT_MS[0] + S.rand() * (CHAT_MS[1] - CHAT_MS[0]);
    for (const [x, y] of [[a, b], [b, a]]) { x.state = 'chat'; x.until = now + len; x.dir = V().dirFromVector(y.x - x.x, 0) || 'e'; }
    a.sayFrom = now; a.leads = true; b.leads = false;
  }
  function endChat(v, now) {
    const p = v.partner != null ? S.vs.get(v.partner) : null;
    for (const x of [v, p]) if (x) { x.partner = null; setSay(x, null); if (x.state === 'chat' || x.state === 'tochat' || x.state === 'waitchat') idle(x, now, 500 + S.rand() * 1500); }
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
    S.phase = clockPhase();
    const cap = isPhone() ? CAP.phone : CAP.desktop;
    const all = cits();
    const want = pickCast(all, { cap, area: S.area, areaOf: c => areaOf(c, builtArea), away: awayOf, momentIds: momentIds(), rand: S.rand });
    const byId = new Map(all.map(c => [Number(c.id), c]));
    for (const v of S.vs.values()) {
      const c = byId.get(v.id);
      if (!want.includes(v.id) && live(v)) { if (first) { v.el.remove(); S.vs.delete(v.id); } else leave(v); }
      else if (c) v.c = c;
    }
    const present = () => [...S.vs.values()].filter(live).length;
    const now = performanceNow();
    for (const id of want) {
      if (S.vs.has(id) || present() >= cap) continue;
      const c = byId.get(id);
      if (!c) continue;
      const door = S.doors.length ? S.doors[Math.floor(S.rand() * S.doors.length)] : null;
      const at = first || !door ? px(groundPoint(S.area, S.rand)) : { x: door.x, y: door.y };
      const v = make(c, at, !first);
      // On opening, some start indoors (most of them at night).
      if (first && door && !v.child && S.rand() < (S.phase === 'night' ? 0.85 : 0.2)) { v.x = door.x; v.y = door.y; goIndoors(v, now, door.key); v.until = now + S.rand() * INDOORS_MS[1]; }
    }
    S.sig = signature(all);
  }
  function signature(all) {
    return all.filter(living).map(c => c.id + (awayOf(c) ? 'a' : '') + ':' + (c.role || '') + ':' + (c.stage || '')).join(',') + '|' + momentIds().join(',');
  }
  // Now and then one walks into a building and someone else comes out.
  function rotate() {
    const cap = isPhone() ? CAP.phone : CAP.desktop;
    const pool = cits().filter(c => living(c) && !awayOf(c) && areaOf(c, builtArea) === S.area && !isChild(c) && !S.vs.has(Number(c.id)));
    const moments = momentIds().map(Number);
    const out = [...S.vs.values()].filter(v => live(v) && v.state !== 'chat' && v.state !== 'tochat' && !v.child && !moments.includes(v.id)
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
    if (v.state === 'indoors') {
      // Night keeps people in until morning (staggered); otherwise their time is up.
      const nightIn = S.phase === 'night' && !S.owls.has(v.id);
      if (now >= v.until && !nightIn && !(v.child && parentOf(v) && parentOf(v).state === 'indoors')) comeOut(v, now);
      return;
    }
    if (v.child && v.state !== 'leave' && child(v, now)) { /* targets set */ }
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
    const stepPx = v.speed * (v.state === 'chase' || v.state === 'ahead' ? 1.3 : 1) * dt / 1000;
    if (dist <= stepPx) {
      v.x = v.tx; v.y = v.ty;
      if (v.state === 'leave') { drop(v); return; }
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
    const walking = !still && ['walk', 'leave', 'tochat', 'follow', 'ahead', 'chase'].includes(v.state) && Math.hypot(v.tx - v.x, v.ty - v.y) > 1;
    const s = V().spriteFor(meta, v.c.species || townSpecies(), walking ? 'walk' : 'idle', still ? 's' : v.dir);
    if (!s) return;
    const frame = still ? 0 : Math.floor(v.t / s.ms) % s.frames;
    V().paint(v.el, s, frame, v.child ? 0.75 : 1, v.x, v.y);
    v.el.style.zIndex = String(depth(v.y));
  }
  // Every couple of seconds, maybe one pair stops for a chat.
  function maybeChat(now) {
    const free = [...S.vs.values()].map(v => ({ id: v.id, x: v.x, y: v.y, child: v.child, selected: !!v.selected,
      free: live(v) && (v.state === 'idle' || v.state === 'walk') && !v.goal && v.partner == null && (S.phase !== 'night') }));
    const pairs = chatPairs(free, now, S.cool);
    if (pairs.length && S.rand() < 0.35) startChat(S.vs.get(pairs[0][0]), S.vs.get(pairs[0][1]), now);
  }
  function tick(now) {
    S.raf = 0;
    if (!running()) return;
    const dt = Math.min(100, S.last ? now - S.last : 0);
    S.last = now;
    if ((S.syncT += dt) > 5000) {   // the town changes: refresh the cast; the clock moves on
      S.syncT = 0;
      survey();
      const ph = clockPhase();
      if (ph !== S.phase) { S.phase = ph; nightLights(); }
      if (signature(cits()) !== S.sig) recast(false);
    }
    if ((S.rotateT += dt) > ROTATE_MS) { S.rotateT = 0; if (S.phase !== 'night') rotate(); }
    if ((S.chatT += dt) > 2000) { S.chatT = 0; maybeChat(now); }
    const t0 = performanceNow();
    S.owls = nightOwls([...S.vs.values()].filter(x => live(x) && !x.child).map(x => x.id));
    for (const v of S.vs.values()) { step(v, dt, now); draw(v, false); }
    S.ms = S.ms * 0.95 + (performanceNow() - t0) * 0.05;   // the loop's own cost (target: under 2 ms)
    S.raf = requestFrame(tick);
  }
  const running = () => S.shown && !S.paused && S.layer && !doc.hidden && !(V() && V().reducedMotion());
  // Evening and night: the tavern's windows glow.
  function nightLights() {
    const v = doc.getElementById('settlement-view');
    if (v) v.classList.toggle('kwv-night', S.phase === 'night' || S.phase === 'dusk');
  }

  function clear() { for (const v of S.vs.values()) v.el.remove(); S.vs.clear(); }
  function start() {
    if (!S.shown || S.paused || !S.layer || !V()) return;
    V().injectStyles();
    S.phase = clockPhase();
    nightLights();
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
    get phase() { return S.phase; },
    get count() { return [...S.vs.values()].filter(v => v.state !== 'gone').length; },
    get villagers() { return [...S.vs.values()].map(v => ({ id: v.id, x: v.x, y: v.y, state: v.state, dir: v.dir, child: v.child, partner: v.partner, say: v.say, inside: v.inside || null })); },
    GROUND, SPOTS, CAP, ROLE_BUILDING, SPEED, CHAT_RANGE, CHAT_COOLDOWN, INDOORS_MS, NIGHT_OUT,
    _pickCast: pickCast, _areaOf: areaOf, _inPolygon: inPolygon, _groundPoint: groundPoint, _onGround: onGround, _doorPoint: doorPoint, _seeded: seeded,
    _chooseErrand: chooseErrand, _nightOwls: nightOwls, _chatPairs: chatPairs, _followPoint: followPoint,
    _seed: n => { S.rand = seeded(n); },
    _setPhase: p => { S.phase = p; nightLights(); },   // Dev and tests: see night or evening now
  };
})(typeof window !== 'undefined' ? window : globalThis);
