// ══════════════════════════════════════════════════════════════════════════
//  KWSceneEvents — events in the scene (docs/HOME_SCENE.md Part F, F.12;
//  step 26).
//
//  Three moments happen in the town and can be answered there:
//    a fire          flames and smoke on one building; click it for the
//                    choices (a bucket chain, or pull down the roof)
//    a lost child    the child hides somewhere in Home; finding and clicking
//                    them is the good ending
//    a runaway cart  it rolls up and down the lane; click it to stop it
//
//  They are ordinary moments: the server starts them, times them and
//  decides every outcome (lib/moments_scene.js there), and each also has its
//  card and dialogue like any other moment. This file only draws them where
//  the moment's seed says and sends the player's answer through KWMoments.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const PAINT_MS = 1000, INK = '#3b2a1a';
  const AREA_NAME = { town: 'in Town', neighbourhood: 'in the Neighbourhood', outskirts: 'in the Outskirts' };
  const S = { timer: null, busy: false, out: new Map() };   // out: moment id → until (ms): the fire dying down after an answer
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const o = `stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;
  const FLAMES = `<svg class="kwe-flames" width="70" height="60" viewBox="0 0 70 60" aria-hidden="true" focusable="false">`
    + `<path class="kwe-f1" d="M14 58C4 46 12 36 16 26c4 8 8 8 9 2 8 10 8 22-1 30z" fill="#ff8a2a" ${o}/>`
    + `<path class="kwe-f2" d="M34 58C20 44 30 30 36 14c6 12 12 14 12 6 10 14 10 28-2 38z" fill="#ffb02e" ${o}/>`
    + `<path class="kwe-f3" d="M54 58c-8-10-2-18 2-26 3 6 6 6 7 2 6 8 6 18-2 24z" fill="#ff8a2a" ${o}/>`
    + `<path d="M34 56c-6-8-2-14 2-22 4 8 8 12 2 22z" fill="#ffe58a"/></svg>`;
  const BUSH = `<svg width="54" height="40" viewBox="0 0 54 40" aria-hidden="true" focusable="false">`
    + `<ellipse cx="27" cy="37" rx="24" ry="3" fill="rgba(40,30,20,.22)"/>`
    + `<path d="M6 34c-6-10 2-20 10-18 2-10 18-12 22-2 10-4 16 8 10 20z" fill="#5f9a3a" ${o}/>`
    + `<path d="M14 26c3-4 7-4 9 0M30 22c3-4 8-4 10 0" fill="none" stroke="#3f7a2a" stroke-width="2" stroke-linecap="round"/>`
    + `<g class="kwe-eyes"><ellipse cx="22" cy="27" rx="3.4" ry="4" fill="#fff" stroke="${INK}" stroke-width="1.6"/><ellipse cx="33" cy="27" rx="3.4" ry="4" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`
    + `<circle cx="22.6" cy="27.6" r="1.7" fill="${INK}"/><circle cx="33.6" cy="27.6" r="1.7" fill="${INK}"/></g></svg>`;
  const CART = `<svg width="66" height="46" viewBox="0 0 66 46" aria-hidden="true" focusable="false">`
    + `<ellipse cx="33" cy="43" rx="28" ry="3" fill="rgba(40,30,20,.24)"/>`
    + `<path d="M8 10h46l-4 20H12z" fill="#b5743a" ${o}/><path d="M54 14l10-6" fill="none" ${o}/>`
    + `<circle cx="20" cy="9" r="5" fill="#e2574c" ${o}/><circle cx="31" cy="8" r="5.5" fill="#f2c14e" ${o}/><circle cx="42" cy="9" r="5" fill="#7dbb5a" ${o}/>`
    + `<g class="kwe-wheel"><circle cx="22" cy="34" r="9" fill="#7a5a3a" ${o}/><path d="M22 25v18M13 34h18" fill="none" stroke="${INK}" stroke-width="1.6"/></g>`
    + `<g class="kwe-wheel kwe-wheel-2"><circle cx="44" cy="34" r="9" fill="#7a5a3a" ${o}/><path d="M44 25v18M35 34h18" fill="none" stroke="${INK}" stroke-width="1.6"/></g></svg>`;

  // The drawing, or its picture once the art is in the props manifest
  // (docs/ART_GUIDE.md §8, batch R: event_fire, event_bush, event_cart).
  const hasPic = key => !!(global.KWGround && global.KWGround.picture && global.KWGround.picture(key));
  const pictureOr = (key, drawing, cls) => { const p = global.KWGround && global.KWGround.picture ? global.KWGround.picture(key, cls) : null; return p ? p.html : drawing; };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // The moments the scene shows. `list`: KWMoments.list().
  const sceneMoments = list => (list || []).filter(m => m && m.subject && ['fire', 'lost_child', 'cart'].includes(m.subject.scene));
  // What a click in the scene sends, or null when the click opens the dialogue instead.
  const clickChoice = scene => (scene === 'lost_child' ? 'found' : scene === 'cart' ? 'stop' : null);
  // Where the child hides: the same seeded place rule as a lost thing (js/lost.js).
  function hidingPlace(seed, placeOf, ground, covered) { return placeOf(seed, ground, covered); }
  // A line for the dialogue when an option is only in the scene.
  function hint(m, areaOf) {
    if (!m || !m.subject || m.subject.scene !== 'lost_child') return '';
    const a = areaOf ? areaOf(m.subject.seed) : null;
    return `Or look for them yourself${a && AREA_NAME[a] ? ': they were last seen ' + AREA_NAME[a] : ''}.`;
  }
  // Bucket chain: `n` points in a line from the water to the fire. Pure.
  function chain(from, to, n) {
    return Array.from({ length: n }, (_, i) => { const t = (i + 0.5) / n; return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }; });
  }

  // ── The scene ───────────────────────────────────────────────────────────
  const homeOpen = () => typeof global._svIsOpen === 'function' && global._svIsOpen();
  const activeArea = () => (global._svActiveAreaName ? global._svActiveAreaName() : 'town');
  const layer = () => { const v = doc.getElementById('settlement-view'); return v ? v.querySelector('.sv-fg-layer:not(.sv-area-hidden)') : null; };
  const list = () => sceneMoments(global.KWMoments && global.KWMoments.list ? global.KWMoments.list() : []);
  function covered(L, p) {
    const lr = L.getBoundingClientRect();
    if (!lr.width || !lr.height) return false;
    const x = lr.left + p.x / 100 * lr.width, y = lr.top + p.y / 100 * lr.height;
    for (const a of L.querySelectorAll(':scope > .sv-slot:not([hidden]) .kwh-art, :scope > .sv-slot:not([hidden]) .kwh-plate, :scope > .kwd-item, :scope > .kwm-cart')) {
      const r = a.getBoundingClientRect();
      if (x > r.left - 20 && x < r.right + 20 && y > r.top - 8 && y < r.bottom + 16) return true;
    }
    return false;
  }
  // The child who is hiding is not also walking about.
  function hideChildren(ids) {
    let st = doc.getElementById('kwe-hidden');
    const css = ids.map(id => `#settlement-view .kwv-cit[data-cid="${Number(id)}"]{visibility:hidden!important;pointer-events:none!important}`).join('');
    if (!css) { if (st) st.remove(); return; }
    if (!st) { st = doc.createElement('style'); st.id = 'kwe-hidden'; doc.head.appendChild(st); }
    if (st.textContent !== css) st.textContent = css;
  }
  async function answer(m, key, at) {
    if (S.busy || !global.KWMoments || !global.KWMoments.answer) return;
    S.busy = true;
    try {
      const r = await global.KWMoments.answer(m.id, key);
      if (r && r.outcome) {
        const C = global.KWCast;
        if (C && C.floatAt && at) C.floatAt(at.x, at.y - 26, m.subject.scene === 'cart' ? '🛒 Stopped!' : '🧒 Found!', 'good');
        toast(`${m.icon} ${r.outcome}`, 'success');
      } else if (r && r.error) toast('⚠️ ' + r.error);
    } finally { S.busy = false; paint(); }
  }
  function button(cls, m, label, html, style) {
    const b = doc.createElement('button');
    if (/<img /.test(html)) b.setAttribute('data-pic', '1');
    b.type = 'button'; b.className = 'kwe ' + cls; b.setAttribute('data-kwe', String(m.id)); b.setAttribute('aria-label', label);
    if (style) b.style.cssText = style;
    b.innerHTML = html;
    return b;
  }
  function paint() {
    if (!doc) return;
    const view = doc.getElementById('settlement-view');
    if (!view) return;
    const L = homeOpen() ? layer() : null, ms = L ? list() : [], area = activeArea(), now = Date.now();
    const C = global.KWCast, LO = global.KWLost;
    hideChildren(ms.filter(m => m.subject.scene === 'lost_child' && m.subject.child_id).map(m => m.subject.child_id));
    const keep = new Set();
    for (const m of ms) {
      const sc = m.subject.scene, id = String(m.id);
      if (sc === 'fire') {
        const art = L.querySelector(`:scope > .sv-slot:not([hidden]) .sv-building[data-kwh="${m.subject.building}"] .kwh-art`);
        if (!art) continue;
        keep.add(id);
        const was = art.querySelector(`:scope > .kwe-fire[data-kwe="${id}"]`);
        if (was && (was.getAttribute('data-pic') === '1') === hasPic('event_fire')) continue;
        if (was) was.remove();   // its picture has arrived since it was drawn
        const b = button('kwe-fire', m, `Fire at the ${m.subject.building.replace(/_/g, ' ')}! Choose what to do`, pictureOr('event_fire', FLAMES, 'kwe-flames') + '<i class="kwe-smoke"></i><i class="kwe-smoke kwe-smoke-2"></i><i class="kwe-smoke kwe-smoke-3"></i><span class="kwe-alarm" aria-hidden="true">🔥</span>');
        b.addEventListener('click', e => { e.stopPropagation(); if (global.KWMoments) global.KWMoments.open(m.id); });   // clickChoice('fire') is null: the choices are in the dialogue
        art.appendChild(b);
      } else if (sc === 'lost_child' && LO && LO._placeOf && C && C._groundPoint) {
        if (LO._areaOf(m.subject.seed) !== area) continue;
        keep.add(id);
        const was = L.querySelector(`:scope > .kwe-child[data-kwe="${id}"]`);
        if (was && (was.getAttribute('data-pic') === '1') === hasPic('event_bush')) continue;
        if (was) was.remove();
        const p = hidingPlace(m.subject.seed, LO._placeOf, (a, r) => C._groundPoint(a, r), (a, pt) => covered(L, pt));
        const b = button('kwe-child', m, 'Something is hiding in this bush. Look', pictureOr('event_bush', BUSH), `left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;z-index:${Math.max(1, Math.round(p.y * 10))}`);
        b.addEventListener('click', e => { e.stopPropagation(); answer(m, clickChoice(sc), { x: b.offsetLeft, y: b.offsetTop }); });
        L.appendChild(b);
      } else if (sc === 'cart' && area === 'town') {
        keep.add(id);
        const was = L.querySelector(`:scope > .kwe-cart[data-kwe="${id}"]`);
        if (was && (was.getAttribute('data-pic') === '1') === hasPic('event_cart')) continue;
        if (was) was.remove();
        const y = 78 + (Number(m.subject.seed) % 9);
        const b = button('kwe-cart', m, 'A runaway cart! Stop it', `<span class="kwe-roll">${pictureOr('event_cart', CART)}</span>`, `left:${18 + (Number(m.subject.seed) % 37)}%;top:${y}%;z-index:${Math.round(y * 10)};--kwe-run:${Math.max(220, Math.min(460, Math.round(L.clientWidth * 0.18)))}px`);   // a short run, slow enough to catch
        b.addEventListener('click', e => { e.stopPropagation(); const r = b.querySelector('.kwe-roll').getBoundingClientRect(), lr = L.getBoundingClientRect(), k = lr.width / (L.clientWidth || lr.width); answer(m, clickChoice(sc), { x: (r.left - lr.left) / k + 30, y: b.offsetTop }); });
        L.appendChild(b);
      }
    }
    // What is over goes; a fire that was answered dies down first.
    view.querySelectorAll('.kwe[data-kwe]').forEach(el => {
      const id = el.getAttribute('data-kwe');
      if (keep.has(id)) return;
      if (el.classList.contains('kwe-fire') && S.out.has(id) && now < S.out.get(id)) { el.classList.add('kwe-dying'); return; }
      el.remove(); S.out.delete(id);
    });
  }
  // A bucket chain: a few free villagers line up from the water to the fire.
  function bucketChain(m) {
    const L = layer(), C = global.KWCast;
    if (!L || !C || !C.playScript) return;
    const art = L.querySelector(`:scope > .sv-slot:not([hidden]) .sv-building[data-kwh="${m.subject.building}"] .kwh-art`);
    if (!art) return;
    const lr = L.getBoundingClientRect(), k = lr.width / (L.clientWidth || lr.width), ar = art.getBoundingClientRect();
    const to = { x: (ar.left + ar.width / 2 - lr.left) / k, y: (ar.bottom - lr.top) / k + 14 };
    const water = L.querySelector(':scope > .kwd-well, :scope > .kwd-pond');
    const wr = water ? water.getBoundingClientRect() : null;
    const from = wr ? { x: (wr.left + wr.width / 2 - lr.left) / k, y: (wr.bottom - lr.top) / k + 8 } : { x: to.x + (to.x > L.clientWidth / 2 ? -240 : 240), y: Math.min(L.clientHeight - 20, to.y + 60) };
    chain(from, to, 4).forEach((p, i) => C.playScript('buckets-' + m.id + '-' + i, [{ to: p, speed: 1.6 }, { wait: 5200, say: '🪣' }, { wait: 300, say: null }]));
  }
  if (doc) {
    S.timer = setInterval(() => { if (homeOpen() && !doc.hidden) paint(); }, PAINT_MS);
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) setTimeout(paint, 120); else hideChildren([]); });
    // The player answered one (here): the fire dies down, with a chain if that was the choice.
    global.addEventListener('kw:moment-answered', e => {
      const d = e.detail || {}, m = d.moment;
      if (!m || !m.subject || m.subject.scene !== 'fire') return;
      S.out.set(String(m.id), Date.now() + (d.choice === 'buckets' ? 6500 : 1200));
      if (d.choice === 'buckets') bucketChain(m);
      paint();
    });
  }

  global.KWSceneEvents = {
    hint: m => hint(m, global.KWLost && global.KWLost._areaOf),
    // A parent's thought while their child is lost (js/villager-engine.js reads it like a lost thing).
    thoughtFor: id => { const m = list().find(x => x.subject.scene === 'lost_child' && (x.subject.citizen_ids || []).map(Number).includes(Number(id)) && Number(x.subject.child_id) !== Number(id)); return m ? 'Looking everywhere for a lost child.' : null; },
    _sceneMoments: sceneMoments, _clickChoice: clickChoice, _hint: hint, _chain: chain, _hidingPlace: hidingPlace, _paint: paint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
