// ══════════════════════════════════════════════════════════════════════════
//  The battle jukebox (jukebox.html): a page of its own, for anyone with the
//  link. It plays the battle music (assets/audio/tactics/music, as listed in
//  assets/tactics/manifest.json), shows behind each piece the kind of battle
//  it is for, played by the rules' own mind (KWTactics.demo with the two sides
//  from assets/tactics/demo.json), and takes a rating and a comment
//  (the server's /api/jukebox: no sign-in; a listener is a random id this
//  browser keeps).
//
//  A piece belongs to a place by its file's name (<place>-<title>.mp3): a land,
//  or boss, or boss-withered. The place decides the land and the foes shown.
//  Everything a listener types is shown back as text, never as markup.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const $ = id => doc.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const API = () => String(global.KINDLEWOOD_API || '').replace(/\/+$/, '');
  const MUSIC = '/assets/audio/tactics/music/';
  // The places in the order they are listed, with the words shown for each.
  const PLACES = [
    ['plains', 'The meadows', '🌾'], ['forest', 'The deep wood', '🌲'], ['hills', 'The hills', '⛰️'], ['mountain', 'The mountains', '🏔️'],
    ['river', 'The river', '🏞️'], ['marsh', 'The marsh', '🌫️'], ['ruins', 'The ruins', '🏚️'], ['boss', 'A boss', '👑'], ['boss-withered', 'The Withered\'s boss', '💀'],
  ];
  const placeOf = key => PLACES.find(p => p[0] === key) || [key || '', 'Anywhere', '🎵'];
  const still = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const J = { tracks: [], demo: null, at: -1, audio: null, ratings: {}, mine: {}, stars: 0, seedN: 0, bossN: 0, apiOk: true, visitor: null };

  // A listener's id: random, made once, kept by this browser. It is all the server knows of them.
  function visitor() {
    let id = null;
    try { id = global.localStorage.getItem('kw_jukebox_id'); } catch (e) { /* private window */ }
    if (!/^[a-z0-9]{16,40}$/.test(id || '')) {
      const bytes = new Uint8Array(18);
      (global.crypto || global.msCrypto).getRandomValues(bytes);
      id = Array.from(bytes, b => (b % 36).toString(36)).join('').padEnd(24, '0');
      try { global.localStorage.setItem('kw_jukebox_id', id); } catch (e) { /* kept for this visit only */ }
    }
    return id;
  }
  const getJson = async url => { const r = await global.fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
  const clock = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const starsText = n => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

  // ── The list ──────────────────────────────────────────────────────────────
  function paintList() {
    const box = $('jb-tracks');
    if (!J.tracks.length) { box.innerHTML = '<p class="jb-loading">There is no music to play yet.</p>'; return; }
    let html = '', last = null;
    J.tracks.forEach((t, i) => {
      if (t.place !== last) { const p = placeOf(t.place); html += `<div class="jb-group">${esc(p[2])} ${esc(p[1])}</div>`; last = t.place; }
      const r = J.ratings[t.key], mine = J.mine[t.key];
      html += `<button type="button" class="jb-track${i === J.at ? ' is-on' : ''}${mine ? ' is-rated' : ''}" data-i="${i}" aria-pressed="${i === J.at}">`
        + `<span class="jb-disc" aria-hidden="true">${esc(placeOf(t.place)[2])}</span><span class="jb-track-name">${esc(t.title)}</span>`
        + `<span class="jb-track-rate">${r ? `<b>★ ${r.stars.toFixed(1)}</b> (${r.count})` : 'not rated yet'}</span></button>`;
    });
    box.innerHTML = html;
    const done = J.tracks.filter(t => J.mine[t.key]).length;
    $('jb-progress').textContent = done ? `You have rated ${done} of ${J.tracks.length}.${done === J.tracks.length ? ' Thank you!' : ''}` : `${J.tracks.length} pieces. Rate as many as you like.`;
  }

  // ── The battle in the window ──────────────────────────────────────────────
  function showBattle() {
    const t = J.tracks[J.at], D = J.demo, T = global.KWTactics;
    if (!t || !D || !T || !T.demo) return;
    const p = D.places[t.place] || D.places.plains;
    let land = p.land, band = p.band;
    // "A boss" has no land of its own: each time it shows a different band's, on that band's land.
    if (p.also && p.also.length) { const all = [[p.land, p.band]].concat(p.also), pick = all[J.bossN % all.length]; land = pick[0]; band = pick[1]; }
    const kind = p.fight || 'hard', foes = (D.bands[band] || {})[kind] || [];
    const copy = v => JSON.parse(JSON.stringify(v));
    const setup = { seed: 1 + Math.floor(Math.random() * 2000000000), land, tier: D.tier, skull: D.skull, name: (D.bands[band] || {}).name || 'A battle', band, fight: kind === 'boss' ? 'boss' : 'fight', party: copy(D.party), enemies: copy(foes) };
    const again = () => { if (J.tracks[J.at] !== t) return; if (p.also) J.bossN++; if (!still()) showBattle(); };
    T.demo(setup, $('jb-scene'), { onEnd: again });      // silent: the piece is what is being listened to
    $('jb-scene-note').textContent = `${(D.bands[band] || {}).name || 'A battle'}${kind === 'boss' ? ': the boss' : ''}. A battle from the game, playing itself: nobody is steering.`;
  }

  // ── Choosing and playing ──────────────────────────────────────────────────
  function select(i, play) {
    if (!J.tracks.length) return;
    J.at = (i + J.tracks.length) % J.tracks.length;
    const t = J.tracks[J.at], p = placeOf(t.place), a = J.audio;
    $('jb-title').textContent = t.title;
    $('jb-place').textContent = `${p[2]} ${p[1]}`;
    a.src = MUSIC + t.file;
    $('jb-seek').value = 0; $('jb-now').textContent = '0:00'; $('jb-len').textContent = '0:00';
    paintList(); paintMine(); showBattle();
    if (play) a.play().catch(() => { /* the browser wants a tap first: the big button is there */ });
    paintPlay();
  }
  function paintPlay() {
    const on = J.audio && !J.audio.paused && !J.audio.ended;
    doc.querySelector('.jb-cabinet').classList.toggle('is-playing', !!on);
    for (const id of ['jb-play', 'jb-bigplay']) { const b = $(id); if (b) { b.textContent = on ? '⏸' : '▶'; b.setAttribute('aria-label', on ? 'Pause' : 'Play'); } }
    $('jb-bigplay').hidden = !!on || (J.audio && J.audio.currentTime > 0);
  }
  function toggle() {
    if (J.at < 0) return select(0, true);
    if (J.audio.paused) J.audio.play().catch(() => {}); else J.audio.pause();
  }

  // ── Rating ────────────────────────────────────────────────────────────────
  function paintStars(n, hover) {
    for (const b of doc.querySelectorAll('.jb-star')) {
      const k = Number(b.getAttribute('data-stars'));
      b.classList.toggle('is-on', k <= n);
      b.classList.toggle('is-lit', hover != null && k <= hover);
      b.setAttribute('aria-checked', String(k === n));
    }
  }
  function paintMine() {
    const t = J.tracks[J.at], mine = t && J.mine[t.key], r = t && J.ratings[t.key];
    J.stars = mine ? mine.stars : 0;
    paintStars(J.stars);
    $('jb-comment').value = mine ? mine.comment || '' : '';
    $('jb-others').textContent = r ? `Listeners so far: ${starsText(r.stars)} ${r.stars.toFixed(1)} from ${r.count}` : 'Nobody has rated this one yet.';
    say('');
  }
  function say(text, bad) { const s = $('jb-status'); s.textContent = text; s.classList.toggle('is-bad', !!bad); }
  async function send(quiet) {
    const t = J.tracks[J.at];
    if (!t) return say('Choose a piece first.', true);
    if (!J.stars) return say('Give it some stars first: one for "not for me", five for "perfect".', true);
    const name = $('jb-name').value.trim();
    try { global.localStorage.setItem('kw_jukebox_name', name); } catch (e) { /* private window */ }
    $('jb-send').disabled = true;
    try {
      const r = await global.fetch(API() + '/api/jukebox/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor: J.visitor, track: t.key, stars: J.stars, comment: $('jb-comment').value, name }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || 'The rating could not be saved.');
      J.ratings = d.tracks || {}; J.mine = d.mine || {};
      paintList();
      const now = J.ratings[t.key];
      $('jb-others').textContent = now ? `Listeners so far: ${starsText(now.stars)} ${now.stars.toFixed(1)} from ${now.count}` : '';
      say(quiet ? `Saved: ${J.stars} star${J.stars === 1 ? '' : 's'} for ${t.title}.` : `Saved. Thank you! ${J.stars} star${J.stars === 1 ? '' : 's'} for ${t.title}.`);
    } catch (e) { say(e.message === 'Failed to fetch' ? 'The rating could not be sent just now. Please try again in a moment.' : e.message, true); }
    $('jb-send').disabled = false;
  }
  async function loadRatings() {
    try {
      const d = await getJson(`${API()}/api/jukebox?visitor=${encodeURIComponent(J.visitor)}`);
      J.ratings = d.tracks || {}; J.mine = d.mine || {}; J.apiOk = true;
    } catch (e) { J.apiOk = false; }
    paintList(); if (J.at >= 0) paintMine();
    if (!J.apiOk) say('Ratings cannot be reached just now. The music still plays.', true);
  }

  // ── For the makers: every rating and comment, when signed in to the game as an admin on this browser ──
  async function loadAdmin() {
    let token = null;
    try { token = global.localStorage.getItem('kw_token'); } catch (e) { /* private window */ }
    if (!token) return;
    try {
      const r = await global.fetch(API() + '/api/jukebox/admin/feedback', { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) return;
      const d = await r.json(), rows = d.feedback || [], title = key => (J.tracks.find(t => t.key === key) || { title: key }).title;
      const box = $('jb-admin');
      box.hidden = false;
      box.innerHTML = `<h2>What listeners said <small>(only you can see this)</small></h2>`
        + (rows.length ? `<table><thead><tr><th>Piece</th><th>Stars</th><th>From</th><th>Comment</th><th>When</th></tr></thead><tbody>`
          + rows.map(x => `<tr><td>${esc(title(x.track))}</td><td class="is-stars">${esc(starsText(x.stars))}</td><td>${esc(x.name || '—')}</td><td>${esc(x.comment || '')}</td><td>${esc(new Date(x.updated_at).toLocaleString())}</td></tr>`).join('') + `</tbody></table>`
          : `<p>Nobody has rated anything yet.</p>`);
    } catch (e) { /* not an admin, or offline */ }
  }

  // ── Starting up ───────────────────────────────────────────────────────────
  async function init() {
    J.visitor = visitor();
    J.audio = new global.Audio();
    J.audio.preload = 'metadata';
    J.audio.volume = 0.8;
    const a = J.audio;
    a.addEventListener('play', paintPlay); a.addEventListener('pause', paintPlay);
    a.addEventListener('ended', () => select(J.at + 1, true));
    a.addEventListener('loadedmetadata', () => { $('jb-len').textContent = clock(a.duration); });
    a.addEventListener('timeupdate', () => { if (!J.seeking && a.duration) { $('jb-seek').value = Math.round(1000 * a.currentTime / a.duration); $('jb-now').textContent = clock(a.currentTime); } });
    $('jb-play').addEventListener('click', toggle); $('jb-bigplay').addEventListener('click', toggle);
    $('jb-prev').addEventListener('click', () => select(J.at - 1, true));
    $('jb-next').addEventListener('click', () => select(J.at + 1, true));
    $('jb-seek').addEventListener('input', () => { J.seeking = true; if (a.duration) $('jb-now').textContent = clock(a.duration * $('jb-seek').value / 1000); });
    $('jb-seek').addEventListener('change', () => { if (a.duration) a.currentTime = a.duration * $('jb-seek').value / 1000; J.seeking = false; });
    $('jb-vol').addEventListener('input', () => { a.volume = $('jb-vol').value / 100; });
    $('jb-tracks').addEventListener('click', ev => { const b = ev.target.closest('.jb-track'); if (b) select(Number(b.getAttribute('data-i')), true); });
    const stars = $('jb-stars');
    stars.addEventListener('click', ev => { const b = ev.target.closest('.jb-star'); if (!b) return; J.stars = Number(b.getAttribute('data-stars')); paintStars(J.stars); send(true); });
    stars.addEventListener('mouseover', ev => { const b = ev.target.closest('.jb-star'); if (b) paintStars(J.stars, Number(b.getAttribute('data-stars'))); });
    stars.addEventListener('mouseleave', () => paintStars(J.stars));
    stars.addEventListener('keydown', ev => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
      ev.preventDefault();
      J.stars = Math.max(1, Math.min(5, (J.stars || 0) + (ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : -1)));
      paintStars(J.stars);
      const b = stars.querySelector(`[data-stars="${J.stars}"]`); if (b) b.focus();
    });
    $('jb-rate').addEventListener('submit', ev => { ev.preventDefault(); send(false); });
    try { $('jb-name').value = global.localStorage.getItem('kw_jukebox_name') || ''; } catch (e) { /* private window */ }

    // The music and the battles' two sides are files on the site; the ratings are the server's.
    const [man, demo] = await Promise.all([getJson('/assets/tactics/manifest.json').catch(() => null), getJson('/assets/tactics/demo.json').catch(() => null)]);
    const order = PLACES.map(p => p[0]);
    J.tracks = ((man && man.tracks) || []).slice().sort((x, y) => (order.indexOf(x.place) - order.indexOf(y.place)) || (x.title < y.title ? -1 : 1));
    J.demo = demo;
    if (global.KWVillagers && global.KWVillagers.load) { try { await global.KWVillagers.load(); } catch (e) { /* the party shows as dots */ } }
    paintList();
    if (J.tracks.length) select(0, false);
    loadRatings();
    loadAdmin();
  }
  global.KWJukebox = { init, _state: J, _select: select, _send: send, _visitor: visitor, _PLACES: PLACES };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
