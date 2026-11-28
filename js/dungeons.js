// ══════════════════════════════════════════════════════════════════════════
//  KWDungeon — the path screen of a dungeon run (docs/DUNGEONS.md §3, §9.4).
//
//  A party of four walks a small branching path of rooms on each floor:
//  fights, rests, treasure, and a boss at the end. This file shows where the
//  party stands, how hurt each citizen is, what they carry, and the ways on;
//  it sends each step and draws the answer.
//
//  The server decides everything (lib/dungeons.js there): what is in a room,
//  where the party may go, what a fight gave, how the run ended. Nothing here
//  rolls, counts loot or changes health.
//
//  Every fight is a battle on the board (js/tactics.js, docs/TACTICS.md):
//  this screen steps aside for it and comes back when the battle is left.
//  The party fights with what their classes have taught them. The card
//  battles, and with them the decks, the draft at the door, honing and the
//  "Class cards" window, left the dungeons on 2026-11-23 (TACTICS.md §8).
//
//  Dungeons sit on the world map (the server's lib/dungeon_map.js): each is
//  there for three days, every town that has found it may go in once, and
//  then it is gone and another opens somewhere else. The map draws a skull on
//  the tile (js/kwmap-dungeons.js); the tile's panel shows the dungeon's card
//  and takes the party of four (tileHtml, wireTile); The Land → Dungeons
//  lists the ones this town has found (listOpen). Dev Tools → 💀 Dungeons can
//  still start a test dungeon or a generated one, and can make the map's
//  dungeons come and go (devOpen).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const S = { on: false, run: null, last: null, busy: false, win: null };
  const LANES = 3;

  // ── Words (pure) ────────────────────────────────────────────────────────
  const ENDINGS = {
    cleared:   { title: '👑 Dungeon cleared', line: 'The boss is beaten. The party comes home with everything it found.' },
    left:      { title: '↩ Turned back', line: 'The party turned back and kept everything it had found.' },
    fled:      { title: '🏃 Fled', line: 'The party ran from a fight and dropped half of what it carried.' },
    defeat:    { title: '☠ Driven out', line: 'The party lost a battle. Everything found on this run is lost.' },
    timed_out: { title: '⌛ The party came home', line: 'The run was left alone too long, so the party came home with what it had found.' },
    recalled:  { title: '↩ Called back', line: 'The party was called back on the road. They never went in, so your town can still try this dungeon once they are home.' },
  };
  const pct = n => Math.round((Number(n) || 0) * 100);
  const list = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  // "🪙 12 wealth · 📦 Hide ×2", or the given words when there is nothing.
  function lootLine(loot, none) {
    const parts = [];
    if (loot && loot.wealth > 0) parts.push(`🪙 ${loot.wealth} wealth`);
    ((loot && loot.items) || []).forEach(i => parts.push(`${i.icon || '📦'} ${i.name} ×${i.qty}`));
    return parts.length ? parts.join(' · ') : (none || 'Nothing yet');
  }
  function subtitle(run) {
    if (!run) return '';
    const d = run.dungeon;
    if (run.status === 'travelling') return `${d.skull} ${d.tier_name} · On the road`;
    return `${d.skull} ${d.tier_name}${d.floors > 1 ? ` · Floor ${run.floor + 1} of ${d.floors}` : ''}${d.test ? ' · Test dungeon' : ''}`;
  }
  // What a room is, in words, for screen readers and the tooltip.
  function roomWords(r) {
    let s = r.label;
    if (r.enemies && r.enemies.length) s += ': ' + list(r.enemies.map(e => e.name));
    if (r.current) s += '. The party is here';
    else if (r.visited) s += '. Already passed';
    else if (r.can_enter) s += '. You can go here';
    return s + '.';
  }

  // ── Markup (pure) ───────────────────────────────────────────────────────
  function partyHtml(party) {
    return `<div class="kwdg-party" role="list" aria-label="The party">${(party || []).map(m => {
      const w = m.max ? Math.max(0, Math.min(100, Math.round(m.hp / m.max * 100))) : 0;
      const state = m.down ? 'Down' : `${m.hp} of ${m.max} health`;
      return `<div class="kwdg-member${m.down ? ' is-down' : ''}" role="listitem" aria-label="${esc(m.name)}: ${esc(state)}${m.was_down && !m.down ? ', went down earlier' : ''}">`
        + `<div class="kwdg-member-name">${esc(m.name)}${m.was_down ? ' <span class="kwdg-mark" title="Went down on this run: rolls for injury when it ends">✚</span>' : ''}</div>`
        + `<div class="kwdg-hp" aria-hidden="true"><span style="width:${w}%"></span></div>`
        + `<div class="kwdg-member-hp">${m.down ? 'Down' : `${m.hp} / ${m.max}`}</div>`
        + `</div>`;
    }).join('')}</div>`;
  }
  // The whole floor: rooms placed by step (left to right) and lane, with the links between them.
  function mapHtml(run) {
    const rooms = run.rooms || [];
    const steps = rooms.reduce((n, r) => Math.max(n, r.step), 1);
    const x = r => (r.step - 0.5) / steps * 100, y = r => (r.lane - 0.5) / LANES * 100;
    const byId = {}; rooms.forEach(r => { byId[r.id] = r; });
    const lines = rooms.map(r => (r.next || []).map(id => {
      const t = byId[id]; if (!t) return '';
      const walked = (r.visited || r.current) && (t.visited || t.current);
      const open = r.current && t.can_enter;
      return `<line x1="${x(r).toFixed(2)}" y1="${y(r).toFixed(2)}" x2="${x(t).toFixed(2)}" y2="${y(t).toFixed(2)}" class="${walked ? 'is-walked' : open ? 'is-open' : ''}"/>`;
    }).join('')).join('');
    const live = run.status === 'active';
    // The wrap scrolls sideways on its own when a long floor is wider than the window.
    return `<div class="kwdg-map-wrap"><div class="kwdg-map" style="--kwdg-steps:${steps}" role="group" aria-label="Floor ${run.floor + 1}: the rooms, from the door on the left to the last room on the right">`
      + `<svg class="kwdg-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${lines}</svg>`
      + rooms.map(r => {
        const cls = ['kwdg-room', 'kwdg-' + r.type, r.current ? 'is-here' : '', r.visited && !r.current ? 'is-passed' : '', r.can_enter ? 'can-enter' : ''].filter(Boolean).join(' ');
        const can = live && r.can_enter;
        return `<button type="button" class="${cls}" style="left:${x(r).toFixed(2)}%;top:${y(r).toFixed(2)}%" data-action="enter" data-room="${esc(r.id)}"`
          + `${can ? '' : ' disabled'}${r.current ? ' aria-current="step"' : ''} aria-label="${esc(roomWords(r))}" title="${esc(roomWords(r))}">`
          + `<span class="kwdg-room-ico" aria-hidden="true">${esc(r.icon)}</span><span class="kwdg-room-lbl" aria-hidden="true">${esc(r.label)}</span></button>`;
      }).join('') + `</div></div>`;
  }
  // ── Event rooms (the server's lib/dungeon_events.js) ─────────────────────
  // An option is certain, a try (someone of the party tries it: the chance and
  // who are shown) or a gamble (plain odds). The server decides all of it; the
  // screen says what each option would bring before it is chosen, and what
  // came of it after.
  function oddsHtml(o) {
    if (o.kind === 'certain') return `<span class="kwdg-ev-says">${esc(o.text === 'nothing' ? (o.cost ? 'The party goes on its way.' : 'Nothing happens.') : cap(o.text) + '.')}</span>`;
    const who = o.who ? `<b>${esc(o.who.name)}</b> (${esc(o.who.role)}) tries` : o.kind === 'gamble' ? 'A gamble' : '';
    return `<span class="kwdg-ev-says"><span class="kwdg-ev-line"><span class="kwdg-odds${o.chance >= 70 ? ' is-good' : o.chance < 40 ? ' is-poor' : ''}" title="${o.kind === 'try' ? `Suits ${esc(o.suits || 'anyone')}. A good ${esc(o.stat || 'stat')} helps.` : 'The same odds whoever is in the party.'}">${o.chance != null ? o.chance + '%' : '–'}</span> ${who}${o.kind === 'try' && o.who && !o.who.suited && o.suits ? ` <i>(better with ${esc(o.suits)})</i>` : ''}</span>`
      + `<span class="kwdg-ev-ends"><span><b>If it comes off:</b> ${esc(o.win || 'nothing')}.</span><span><b>If not:</b> ${esc(o.lose || 'nothing')}.</span></span></span>`;
  }
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
  function eventHtml(p) {
    return `<div class="kw-box kwdg-pending kwdg-ev"><div class="kw-box-title">${esc(p.icon || '❓')} ${esc(p.title)}</div><p>${esc(p.text)}</p>`
      + (p.options || []).map(o => `<div class="kwdg-option kwdg-ev-opt${o.disabled ? ' is-off' : ''}"><button type="button" class="kw-btn primary" data-action="choose" data-option="${esc(o.key)}"${o.disabled ? ' disabled' : ''}>${esc(o.label)}${o.cost ? ` <span class="kwdg-cost">🪙 ${o.cost}</span>` : ''}</button>`
        + (o.disabled ? `<span class="kwdg-ev-says">${esc(o.why || 'Not now.')}</span>` : oddsHtml(o)) + `</div>`).join('')
      + `<p class="kw-note">Coin is paid from what the party is carrying. Nothing here can take the last of anyone's health.</p></div>`;
  }
  // What came of the event in this room: the choice, the roll if there was one, and each thing it changed.
  function happenedHtml(h) {
    if (!h) return '';
    const roll = h.kind === 'certain' ? '' : `<p class="kwdg-roll ${h.won ? 'is-won' : 'is-lost'}">${h.who ? `${esc(h.who.name)} tried it` : 'The party took the gamble'}: a ${h.chance}% chance. <b>${h.won ? 'It came off.' : 'It did not come off.'}</b></p>`;
    const lines = (h.lines || []).concat(h.after_lines || []);
    return `<div class="kw-box kwdg-happened" role="status"><div class="kw-box-title">${esc(h.icon || '❓')} ${esc(h.title)}: ${esc(h.label)}</div>${roll}<p>${esc(h.text)}${h.after_text ? ' ' + esc(h.after_text) : ''}</p>`
      + (lines.length ? `<ul class="kwdg-lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '') + `</div>`;
  }
  // What the run carries besides loot: blessings, curses and keepsakes, each a chip that says what it does.
  function carriedHtml(carried) {
    const c = carried || [];
    if (!c.length) return '';
    return `<div class="kwdg-carried" role="list" aria-label="Blessings, curses and keepsakes">` + c.map(x =>
      `<span class="kwdg-chip is-${esc(x.kind)}" role="listitem" tabindex="0" title="${esc(x.says)}" aria-label="${esc(x.kind === 'keepsake' ? 'Keepsake' : x.kind === 'curse' ? 'Curse' : 'Blessing')}: ${esc(x.name)}. ${esc(x.says)}">${esc(x.icon)} ${esc(x.name)}${x.fights ? ` <i>(next fight)</i>` : ''}</span>`).join('') + `</div>`;
  }

  // The thing the room in front of the party wants: a fight, or an answer.
  function pendingHtml(run) {
    const p = run.pending;
    if (!p) return '';
    if (p.kind === 'event') return eventHtml(p);
    if (p.kind === 'battle') {
      const here = (run.rooms || []).find(r => r.current) || {};
      // An event's fight is against whoever the option woke (the server names them), not the room's own list.
      const who = list((p.foes || here.enemies || []).map(e => e.name));
      return `<div class="kw-box kwdg-pending"><div class="kw-box-title">${p.room === 'boss' ? '👑 The boss' : p.room === 'elite' ? '💀 An elite fight' : '⚔ A fight'}</div>`
        + `<p>${who ? esc(who) + ' block the way.' : 'Something blocks the way.'} The party cannot walk on until the fight is won.</p>`
        + `<div class="kwdg-btns"><button type="button" class="kw-btn primary" data-action="fight">⚔ Fight</button>`
        + `<button type="button" class="kw-btn danger" data-action="flee">🏃 Flee the dungeon</button></div>`
        + `<p class="kw-note">Fleeing ends the run and the party drops half of what it carries.</p></div>`;
    }
    const title = p.kind === 'landing' ? '🪜 A landing between floors' : '🔥 A place to rest';
    return `<div class="kw-box kwdg-pending"><div class="kw-box-title">${title}</div>`
      + (p.options || []).map(o => `<div class="kwdg-option"><button type="button" class="kw-btn primary" data-action="choose" data-option="${esc(o.key)}">${esc(o.label)}</button><span>${esc(o.text)}</span></div>`).join('')
      + `</div>`;
  }
  function runHtml(run) {
    const d = run.dungeon, moves = (run.moves || []).length;
    const hint = run.pending ? '' : moves ? `<p class="kwdg-hint">Choose the next room${moves > 1 ? ': there are ' + moves + ' ways on' : ''}.</p>` : '';
    return `<div class="kwdg">`
      + `<p class="kwdg-intro">${esc(d.intro)}${d.boss ? ` At the end: ${esc(d.boss)}.` : ''}${d.suggested_party ? ` <span class="kwdg-scale">Written for a party of ${esc(d.suggested_party)}.</span>` : ''}</p>`
      + partyHtml(run.party)
      + mapHtml(run)
      + hint
      + (run.pending && run.pending.kind === 'event' ? '' : happenedHtml(run.happened))
      + pendingHtml(run)
      + carriedHtml(run.carried)
      + `<div class="kwdg-foot"><div class="kwdg-loot" aria-live="polite"><b>Carried:</b> ${esc(lootLine(run.loot))}</div>`
      + `<div class="kwdg-btns">`
      + (run.can_leave ? `<button type="button" class="kw-btn" data-action="leave">↩ Turn back and keep it</button>` : '')
      + `</div></div></div>`;
  }
  // How a finished run ended: what came home, what was lost, who was hurt.
  function endHtml(run, now) {
    const r = run.result || {}, e = ENDINGS[run.status] || ENDINGS.left;
    const line = run.status === 'timed_out' && r.half ? 'The run was left alone in the middle of a fight, so the party came home with half of what it carried.' : e.line;
    const names = {}; (run.party || []).forEach(m => { names[m.id] = m.name; });
    const rolled = (r.rolled || []).map(x => names[x.id]).filter(Boolean);
    const inj = (r.injuries || []).map(i => `<li class="kwdg-inj kwdg-inj-${esc(i.severity || '')}">${esc(i.narrative || '')}</li>`).join('');
    const lost = r.lost && (r.lost.wealth || (r.lost.items || []).length);
    // After a dungeon on the map the party walks home: what it carries reaches the stores when it arrives.
    const walk = run.walking_home ? `<div class="kw-box kwdg-walk"><div class="kw-box-title">🚶 Walking home</div><p>Back in <b class="kwdg-clock" data-kwdg-clock="${esc(run.home_at)}">${esc(clock(run.home_at, now))}</b>.${run.status === 'recalled' ? '' : ' What they carry reaches your stores when they arrive.'}</p></div>` : '';
    const closeBtn = `<div class="kwdg-btns"><button type="button" class="kw-btn primary" data-action="close">Close</button></div>`;
    // Called back on the road: nothing was found and nobody was hurt, so there is only the walk to show.
    if (run.status === 'recalled') return `<div class="kwdg kwdg-end"><h3 class="kwdg-end-title">${esc(e.title)}</h3><p>${esc(line)}</p>${walk}${closeBtn}</div>`;
    return `<div class="kwdg kwdg-end">`
      + `<h3 class="kwdg-end-title">${esc(e.title)}</h3><p>${esc(line)}</p>`
      // The first town to clear a map dungeon takes a trophy from its boss (the server's lib/dungeon_trophies.js).
      + (r.trophy ? `<div class="kw-box kwdg-trophy"><div class="kw-box-title">🏆 First of any town to clear it</div><p><b>${esc(r.trophy.icon)} ${esc(r.trophy.title)}</b> now hangs in your trophy hall${r.trophy.wealth ? `, and the town is ${esc(r.trophy.wealth)} wealth richer` : ''}.</p><p class="kwdg-intro">${esc(r.trophy.words || '')}</p></div>` : '')
      + walk
      + `<div class="kw-box"><div class="kw-box-title">${run.walking_home ? 'Carrying home' : 'Came home'}</div><p>${esc(lootLine(r.kept, 'Nothing'))}</p></div>`
      + (lost ? `<div class="kw-box"><div class="kw-box-title">Lost</div><p>${esc(lootLine(r.lost))}</p></div>` : '')
      + `<div class="kw-box"><div class="kw-box-title">Injuries</div>`
      + (rolled.length
        ? `<p>${esc(list(rolled))} ${rolled.length === 1 ? 'was' : 'were'} at risk of injury.</p>${inj ? `<ul class="kwdg-injs">${inj}</ul>` : '<p>All of them got away without a wound.</p>'}`
        : '<p>Nobody went down, so nobody was hurt.</p>')
      + `</div>`
      + ((r.upgraded || []).length ? `<p class="kw-note">${esc(list(r.upgraded.map(u => u.name)))} came back a better fighter.</p>` : '')
      + `<div class="kwdg-btns"><button type="button" class="kw-btn primary" data-action="close">Close</button></div></div>`;
  }
  // ── The walk (dungeons on the map) ──────────────────────────────────────
  // "1:32" until a time the server gave; "now" once it has passed.
  function clock(until, now) {
    const left = Math.max(0, Math.ceil((new Date(until).getTime() - (now == null ? Date.now() : now)) / 1000));
    return left <= 0 ? 'now' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  // "30 seconds", "2 minutes", "about 3 minutes": how long a walk is, in words.
  function walkWords(secs) {
    secs = Math.round(Number(secs) || 0);
    if (secs <= 0) return '';
    if (secs < 90) return `${secs} seconds`;
    const m = secs / 60;
    return `${Number.isInteger(m) ? '' : 'about '}${Math.round(m)} minutes`;
  }
  // The party is on the road to the dungeon: who, how long, and a way to call them back.
  function travelHtml(run, now) {
    return `<div class="kwdg kwdg-road">`
      + `<p class="kwdg-intro">${esc(run.dungeon.intro || '')}${run.dungeon.suggested_party ? ` <span class="kwdg-scale">Written for a party of ${esc(run.dungeon.suggested_party)}.</span>` : ''}</p>`
      + partyHtml(run.party)
      + `<div class="kw-box kwdg-walk"><div class="kw-box-title">🚶 On the road</div>`
      + `<p>The party is walking to ${esc(run.dungeon.name)}. They reach the door in <b class="kwdg-clock" data-kwdg-clock="${esc(run.arrives_at)}">${esc(clock(run.arrives_at, now))}</b>.</p>`
      + `<p class="kwdg-intro">You can follow them on the map. Called back now, they walk home the way they came and the dungeon is not used up.</p></div>`
      + `<div class="kwdg-btns"><button type="button" class="kw-btn" data-action="recall">↩ Call them back</button><button type="button" class="kw-btn primary" data-action="close">Close</button></div></div>`;
  }
  function bodyHtml() {
    const run = S.run || S.last;
    if (!S.on) return '<p class="kw-empty">Dungeons are not open yet.</p>';
    if (!run) return '<p class="kw-empty">No party of yours is in a dungeon.</p>';
    return run.status === 'travelling' ? travelHtml(run) : run.status === 'active' ? runHtml(run) : endHtml(run);
  }

  // ── Data ────────────────────────────────────────────────────────────────
  // Keep what the server said: `run` is the unfinished run or the one that
  // just ended; `last` (when given) is the most recent finished run.
  function take(d) {
    if (!d) return;
    if ('on' in d) S.on = !!d.on;
    if ('run' in d || 'last' in d) {
      const run = d.run || null, was = S.run, wasWalking = !!(S.last && S.last.walking_home);
      if (run && (run.status === 'active' || run.status === 'travelling')) { S.run = run; S.last = null; }
      else {
        S.run = null;
        if (run) S.last = run; else if ('last' in d) S.last = d.last || null;
        // The run has just ended; or the party that was walking home is in, and the stores have what it carried.
        if (was || (wasWalking && !(S.last && S.last.walking_home))) afterEnd();
      }
    }
    paint();
  }
  // A run has ended: the town's stores, wealth and citizens have changed.
  function afterEnd() {
    try { if (typeof global.refreshResources === 'function') global.refreshResources(); } catch (e) { /* not loaded */ }
    try { if (typeof global.loadCitizens === 'function') global.loadCitizens(); } catch (e) { /* not loaded */ }
    // The dungeon's skull on the map goes faint: this town has had its go.
    MAP.in_dungeon = null;
    mapAgain();
    roads();
  }
  // Read the map again (a skull's ring or a town's busy flag has changed), and
  // if a dungeon's card is showing in the tile's panel, draw it again from the
  // new data.
  function mapAgain() {
    try {
      if (typeof global.loadWorldMap !== 'function') return;
      Promise.resolve(global.loadWorldMap()).then(() => {
        const last = global._lastSelectedTile, data = typeof worldMapData !== 'undefined' ? worldMapData : null;
        if (!last || !data || !doc.querySelector || !doc.querySelector('.op-dungeon')) return;
        const t = (data.tiles || []).find(x => x.q === last.q && x.r === last.r);
        if (t && typeof selectWorldTile === 'function') selectWorldTile(t);
      }).catch(() => { /* the map is not up */ });
    } catch (e) { /* not loaded */ }
  }
  // The party on the map's travel layer (js/travel.js): read again when it sets out, turns back or ends its run.
  function roads() { try { if (global.KWTravel && global.KWTravel.refresh) global.KWTravel.refresh(); } catch (e) { /* not loaded */ } }
  async function load() {
    if (typeof global.apiFetch !== 'function') return null;
    try {
      const res = await global.apiFetch('/api/dungeons/run');
      const d = await res.json();
      if (res.ok && d && d.ok) { S.on = !!d.on; take(d); }
    } catch (e) { /* offline or paused: keep what we have */ }
    return S.run || S.last;
  }
  async function post(path, body) {
    if (S.busy) return null;
    S.busy = true;
    try {
      const res = await global.apiFetch('/api/dungeons/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { toast('⚠️ ' + (d.error || 'That did not work. Try again.')); await load(); return null; }
      S.on = true;
      take(d);
      return d;
    } catch (e) { toast('⚠️ Could not reach the server.'); return null; }
    finally { S.busy = false; }
  }

  // ── The window ──────────────────────────────────────────────────────────
  function paint() {
    if (!S.win) return;
    const run = S.run || S.last;
    try { if (run) S.win.setTitle(run.dungeon.name, subtitle(run)); S.win.refresh(); } catch (e) { /* closed */ }
  }
  async function confirmed(o) {
    if (global.KWDialog && global.KWDialog.confirm) return global.KWDialog.confirm(o);
    return true;
  }
  const ACTIONS = {
    async enter(el) {
      const d = await post('run/move', { room: el.getAttribute('data-room') });
      if (!d) return;
      if (d.found) toast('🎁 Found: ' + lootLine(d.found, 'nothing') + (d.found.keepsake ? ` · and a keepsake: ${d.found.keepsake.icon} ${d.found.keepsake.name} (${d.found.keepsake.says})` : ''));
    },
    fight() {
      const p = S.run && S.run.pending;
      if (!p || p.kind !== 'battle') return;
      // A fight on the board (docs/TACTICS.md): the path screen steps aside and comes back when the battle is left.
      if (!global.KWTactics || !global.KWTactics.openById) return toast('⚠️ The battle screen is not loaded.');
      if (S.win) { const w = S.win; S.win = null; try { w.close(); } catch (e) { /* gone */ } }
      global.KWTactics.openById(p.battle_id).catch(e => { toast('⚠️ ' + e.message); open(); });
    },
    async choose(el) { await post('run/choose', { option: el.getAttribute('data-option') }); },
    async leave() {
      const run = S.run; if (!run) return;
      const ok = await confirmed({ title: 'Turn back?', message: `The party leaves ${run.dungeon.name} and keeps everything it has found: ${lootLine(run.loot, 'nothing so far')}. Your town cannot enter this dungeon again.`, ok: 'Turn back' });
      if (ok) await post('run/leave');
    },
    async flee() { await flee(); },
    async recall() {
      const run = S.run; if (!run || run.status !== 'travelling') return;
      const ok = await confirmed({ title: 'Call them back?', message: `The party turns round and walks home the way it came. They have not gone in, so your town can still try ${run.dungeon.name} once they are home.`, ok: 'Call them back' });
      if (ok && await post('run/recall')) roads();
    },
    close(el, ev, w) { if (w) w.close(); },
  };
  async function flee() {
    const run = S.run; if (!run) return false;
    const ok = await confirmed({
      title: 'Flee the dungeon?', danger: true, ok: 'Flee',
      message: `The run ends here. The party drops half of what it carries (it keeps ${pct(run.flee_keeps)}%), and anyone who went down is at risk of injury. Your town cannot enter this dungeon again.`,
    });
    if (!ok) return false;
    return !!(await post('run/flee'));
  }
  // Counts the walk down once a second while the window is open, and asks the
  // server again when the time is up (it says when the party has arrived).
  let _clock = null, _asked = 0;
  function tickClock() {
    if (!S.win) { if (_clock) { clearInterval(_clock); _clock = null; } return; }
    let due = false;
    doc.querySelectorAll('[data-kwdg-clock]').forEach(el => { const t = clock(el.getAttribute('data-kwdg-clock')); el.textContent = t; if (t === 'now') due = true; });
    if (due && Date.now() - _asked > 3000 && !S.busy) { _asked = Date.now(); load(); }
  }
  async function open() {
    await load();
    const run = S.run || S.last;
    if (!global.KWWindow) return null;
    S.win = global.KWWindow.open({
      id: 'dungeon', title: run ? run.dungeon.name : 'Dungeon', subtitle: subtitle(run), icon: '💀', size: 'L',
      render(body) { body.innerHTML = bodyHtml(); },
      actions: ACTIONS,
      onClose() { S.win = null; },
    });
    if (!_clock && typeof setInterval === 'function') _clock = setInterval(tickClock, 1000);
    return S.win;
  }

  // ── On the world map ────────────────────────────────────────────────────
  // What the server's rules are (GET /api/dungeons), the list, and its window.
  const MAP = { reach: 8, party: 4, list: null, in_dungeon: null, win: null, hall: null };
  // How long a dungeon has left, in words.
  function leftWords(h) {
    h = Number(h) || 0;
    if (h >= 36) return `gone in ${Math.round(h / 24)} days`;
    if (h >= 1.5) return `gone in ${Math.round(h)} hours`;
    return h > 0 ? 'gone within the hour' : 'gone';
  }
  // The facts under a dungeon's name: floors, who lives there, who it is for, how long it stays.
  function factsLine(d) {
    return [`${d.floors} floor${d.floors === 1 ? '' : 's'}`, d.band || null, d.suggested_party ? `written for ${d.suggested_party}` : null, leftWords(d.hours_left)].filter(Boolean).join(' · ');
  }
  // What this town may do there now: { state, words }. `busy`: its party is in another dungeon.
  function standing(d, busy) {
    if (d.mine === 'travelling') return { state: 'inside', words: 'Your party is on its way there.' };
    if (d.mine === 'active') return { state: 'inside', words: 'Your party is inside.' };
    if (d.mine === 'recalled') return { state: 'wait', words: 'Your party was called back and is walking home. You can send one again when they are in.' };
    if (d.mine) return { state: 'done', words: `Your town has been here: ${String((ENDINGS[d.mine] || {}).title || d.mine).replace(/^\S+\s/, '').toLowerCase()}. Each town goes in once.` };
    if (!d.in_reach) return { state: 'far', words: `Too far to walk: ${d.distance == null ? 'your town is not on the map' : d.distance + ' tiles away'}. A party goes up to ${MAP.reach} tiles from the town.` };
    if (busy) return { state: 'busy', words: 'Your town already has a party in another dungeon.' };
    return { state: 'open', words: '' };
  }
  const clearWords = d => d.cleared_by ? `Cleared by ${d.cleared_by} town${d.cleared_by === 1 ? '' : 's'}. ${d.first_clear} was first.`
    : 'No town has cleared it yet.' + (d.prize ? ` The first wins ${d.prize.icon} ${d.prize.title} (+${d.prize.wealth} wealth).` : '');
  // The town's trophy hall: one chip for each kind it has, and how far along the full hall it is.
  function hallHtml(h) {
    if (!h) return '';
    const chips = (h.trophies || []).map(t => `<span class="kwdg-trophy-chip kwdg-skull-${esc(t.tier)}" title="${esc(t.words || '')} Won in ${esc((t.last || {}).dungeon || 'a dungeon')}.">${esc(t.icon)} ${esc(t.title)}${t.count > 1 ? ` <b>×${esc(t.count)}</b>` : ''}</span>`).join('');
    return `<div class="kw-box kwdg-hall"><div class="kw-box-title">🏆 Trophy hall <span class="kwdg-hall-count">${esc(h.have || 0)} of ${esc(h.kinds || 0)}</span></div>`
      + (chips ? `<div class="kwdg-trophies">${chips}</div>` : `<p class="kwdg-intro">Empty so far. Be the first town to clear a dungeon and a trophy from its boss hangs here.</p>`)
      + `</div>`;
  }

  // The dungeon's card in the tile's panel (js/main.js _outpostSectionHtml).
  // `people`: the town's free adults.
  function tileHtml(tile, people) {
    const d = tile && tile.dungeon;
    if (!d) return '';
    const st = standing(d, !!d.busy);
    const fighter = p => p.role === 'soldier' || p.role === 'archer';
    const free = (people || []).slice().sort((a, b) => fighter(b) - fighter(a));
    const opts = free.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.role === 'soldier' ? ' (Guard)' : p.role === 'archer' ? ' (Archer)' : ''}</option>`).join('');
    let act;
    if (st.state === 'inside') act = `<div class="op-worker-hint">${esc(st.words)}</div><button type="button" class="action-btn op-worker-btn" data-dungeon-open>💀 Open the dungeon</button>`;
    else if (st.state !== 'open') act = `<div class="op-worker-hint op-worker-none">${esc(st.words)}</div>`;
    else if (!free.length) act = `<div class="op-worker-hint op-worker-none">No adult is free to go.</div>`;
    // One to four go. The dungeon is written for four and does not shrink: fewer is harder.
    else act = `<div class="op-worker-hint">Send up to ${MAP.party}. ${d.walk_secs ? `It is ${walkWords(d.walk_secs)} on foot each way. ` : ''}They fight on the board, room by room, and bring home what they find. Your town goes in once.${free.length < MAP.party ? ` Only ${free.length} ${free.length === 1 ? 'adult is' : 'adults are'} free: a dungeon is written for ${MAP.party}, so fewer is harder.` : ''}</div>`
      + `<div class="op-worker-pick op-camp-pick">${[0, 1, 2, 3].slice(0, Math.min(MAP.party, free.length)).map(i => `<select class="op-worker-select" data-dungeon-pick="${i}" aria-label="Party member ${i + 1}"><option value="">${i ? '— and —' : '— Who goes? —'}</option>${opts}</select>`).join('')}</div>`
      + `<button type="button" class="action-btn op-worker-btn" data-dungeon-enter="${esc(d.id)}">💀 Send them in</button>`;
    return `<div class="op-section op-dungeon kwdg-skull-${esc(d.tier)}">`
      + `<div class="op-title">💀 ${esc(d.name)} <span class="op-level">${esc(d.skull)} ${esc(d.tier_name)}</span> <button type="button" class="kw-help-q" aria-label="How dungeons work" title="How dungeons work" data-dungeon-help>?</button></div>`
      + (d.intro ? `<div class="op-note">${esc(d.intro)}</div>` : '')
      + `<div class="op-worker-hint">${esc(factsLine(d))}</div>`
      + `<div class="op-worker-hint">${esc(clearWords(d))}</div>`
      + act
      + `<div class="op-reason" data-op-reason style="display:none"></div></div>`;
  }
  // The buttons of that card.
  function wireTile(body, tile) {
    const box = body && body.querySelector('.op-dungeon');
    if (!box) return;
    const say = m => { const r = box.querySelector('[data-op-reason]'); if (r) { r.textContent = m; r.style.display = 'block'; } };
    const help = box.querySelector('[data-dungeon-help]');
    if (help) help.addEventListener('click', () => { if (global.KWHelp) global.KWHelp.open('dungeons'); });
    const openBtn = box.querySelector('[data-dungeon-open]');
    if (openBtn) openBtn.addEventListener('click', () => open());
    const btn = box.querySelector('[data-dungeon-enter]');
    if (!btn) return;
    // Someone picked in one box is not offered in the others.
    const picks = Array.from(box.querySelectorAll('[data-dungeon-pick]'));
    const sync = () => { const taken = picks.map(s => s.value).filter(Boolean); picks.forEach(s => Array.from(s.options).forEach(o => { o.disabled = !!o.value && o.value !== s.value && taken.includes(o.value); })); };
    picks.forEach(s => s.addEventListener('change', () => { sync(); const r = box.querySelector('[data-op-reason]'); if (r) r.style.display = 'none'; }));
    btn.addEventListener('click', async () => {
      const ids = [...new Set(picks.map(s => Number(s.value)).filter(Boolean))];
      if (!ids.length) return say('Choose who goes.');
      // Fewer than a full party is allowed, and said once before they go.
      if (ids.length < MAP.party && btn.getAttribute('data-short') !== String(ids.length)) {
        btn.setAttribute('data-short', String(ids.length));
        return say(`Only ${ids.length} of ${MAP.party}: the dungeon is written for ${MAP.party}, so it will be harder. Press again to send them.`);
      }
      btn.disabled = true;
      const d = await enter(btn.getAttribute('data-dungeon-enter'), ids);
      if (d && d.error) { btn.disabled = false; say(d.error); }
    });
  }
  // Send a party in, then show the path screen. → the server's answer, or { error }.
  async function enter(id, ids) {
    try {
      const res = await global.apiFetch('/api/dungeons/' + encodeURIComponent(id) + '/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ citizen_ids: ids }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) return { error: d.error || 'They could not go.' };
      S.on = true; MAP.in_dungeon = Number(id);
      take(d);
      // The map's skull turns gold, and the four are busy.
      mapAgain();
      try { if (typeof global.loadCitizens === 'function') global.loadCitizens(); } catch (e) { /* not loaded */ }
      roads();
      if (MAP.win) { try { MAP.win.close(); } catch (e) { /* gone */ } }
      open();
      return d;
    } catch (e) { return { error: 'Connection hiccup. Try again.' }; }
  }

  // ── The Land → Dungeons: the ones this town has found ───────────────────
  function listHtml(list, inDungeon, hall) {
    if (!list) return '<p class="kw-empty">Looking over the land…</p>';
    if (!list.length) return '<div class="kwdg"><p class="kw-empty">Your town has found no dungeon yet.</p><p class="kwdg-intro">Dungeons open on the land around every town and stay for three days. Scout the tiles near your town to find them: a skull marks each one on the map.</p>' + hallHtml(hall) + '</div>';
    return `<div class="kwdg"><p class="kwdg-intro">Each dungeon stays for three days, and your town may go in once. A party of up to ${MAP.party} walks up to ${MAP.reach} tiles to reach one. <button type="button" class="kw-help-q" aria-label="How dungeons work" title="How dungeons work" data-action="help">?</button></p>`
      + `<div class="kwdg-list">` + list.map(d => {
        const st = standing(d, !!inDungeon && inDungeon !== d.id);
        return `<div class="kwdg-entry kwdg-skull-${esc(d.tier)}${st.state === 'done' ? ' is-done' : ''}">`
          + `<div class="kwdg-entry-head"><span class="kwdg-entry-name">💀 ${esc(d.name)}</span><span class="kwdg-entry-skull">${esc(d.skull)} ${esc(d.tier_name)}</span></div>`
          + (d.intro ? `<p class="kwdg-intro">${esc(d.intro)}</p>` : '')
          + `<p class="kwdg-entry-facts">${esc(factsLine(d))}${d.distance != null ? ` · ${d.distance} tile${d.distance === 1 ? '' : 's'} away` : ''}</p>`
          + `<p class="kwdg-entry-facts">${esc(clearWords(d))}</p>`
          + (st.words ? `<p class="kwdg-entry-state">${esc(st.words)}</p>` : '')
          + `<div class="kwdg-btns">`
          + (st.state === 'inside' ? `<button type="button" class="kw-btn primary" data-action="inside">Open the dungeon</button>` : '')
          + `<button type="button" class="kw-btn${st.state === 'open' ? ' primary' : ''}" data-action="show" data-q="${esc(d.q)}" data-r="${esc(d.r)}">${st.state === 'open' ? 'Choose a party on the map' : 'Show on the map'}</button>`
          + `</div></div>`;
      }).join('') + `</div>` + hallHtml(hall) + `</div>`;
  }
  async function listLoad() {
    try {
      const res = await global.apiFetch('/api/dungeons');
      const d = await res.json();
      if (res.ok && d && d.ok) { MAP.list = d.dungeons || []; MAP.in_dungeon = d.in_dungeon || null; MAP.hall = d.hall || null; if (d.rules) { MAP.reach = d.rules.reach || MAP.reach; MAP.party = d.rules.party || MAP.party; } }
      else MAP.list = MAP.list || [];
    } catch (e) { MAP.list = MAP.list || []; }
    if (MAP.win) { try { MAP.win.refresh(); } catch (e) { /* closed */ } }
    return MAP.list;
  }
  // Centre the map on a tile and open its panel. (camera, worldMapData and the
  // two functions are top-level in js/main.js: shared scope, not window.)
  function showOnMap(q, r) {
    q = Number(q); r = Number(r);
    try {
      if (typeof camera !== 'undefined') { camera.q = q; camera.r = r; }
      const data = typeof worldMapData !== 'undefined' ? worldMapData : null;
      if (data && typeof renderWorldMap === 'function') renderWorldMap(data);
      const tile = data && (data.tiles || []).find(t => t.q === q && t.r === r);
      if (!tile || typeof selectWorldTile !== 'function') return;
      if (global.KWPlaces && global.KWPlaces.current && global.KWPlaces.current() !== 'land') global.KWPlaces.go('land');
      selectWorldTile(tile);
      // The tile's panel, where the party is chosen: the sheet on a phone, the side panel on a desk.
      if (doc.body && doc.body.classList.contains('kw-shell')) { if (global.KWShell && global.KWShell.openPanel) global.KWShell.openPanel(); }
      else if (global.KWContext && global.KWContext.open) global.KWContext.open();
    } catch (e) { /* the map is not up */ }
  }
  // A live event (js/realtime.js). Word of a dungeon: say so and put its
  // skull on the map. A run ended by itself (left idle, or its dungeon went):
  // read how it ended.
  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'dungeon_found') {
      if (ev.message) toast(ev.message);
      mapAgain();
      if (MAP.win) listLoad();
    } else if (ev.type === 'dungeon_ended' && S.run && !S.busy) load();
    // The party has reached the door: the path screen takes over from the road.
    else if (ev.type === 'dungeon_arrived') { toast('💀 Your party has reached the dungeon.'); load(); mapAgain(); roads(); }
    // The party is home: the stores, the town's wealth, the citizens and the trophy hall have changed.
    else if (ev.type === 'dungeon_home') {
      if (ev.message) toast(ev.message);
      load(); afterEnd();
      mapAgain();
      if (MAP.win) listLoad();
    }
  }
  function listOpen() {
    if (!global.KWWindow) return null;
    MAP.win = global.KWWindow.open({
      id: 'dungeon-list', title: 'Dungeons', subtitle: 'Found on the land around your town', icon: '💀', size: 'M',
      render(body) { body.innerHTML = listHtml(MAP.list, MAP.in_dungeon, MAP.hall); },
      actions: {
        show(el, ev, w) { if (w) w.close(); showOnMap(el.getAttribute('data-q'), el.getAttribute('data-r')); },
        inside(el, ev, w) { if (w) w.close(); open(); },
        help() { if (global.KWHelp) global.KWHelp.open('dungeons'); },
      },
      onClose() { MAP.win = null; },
    });
    listLoad();
    return MAP.win;
  }

  // ── Dev Tools → 💀 Dungeons ─────────────────────────────────────────────
  // `pick`: the skull, land and seed last chosen, kept while the panel is redrawn.
  const DEV = { data: null, wired: false, pick: { tier: '', land: '', seed: '' } };
  function devHtml(d, pick) {
    if (!d) return '<div class="cheat-desc">Loading…</div>';
    const run = d.run, p = pick || {};
    return `<div class="cheat-section-label">Dungeons</div>`
      + `<div class="cheat-desc">Dungeons are <b>${d.on ? 'ON' : 'off'}</b> for players. While off, only admins can play a run, started from here.</div>`
      + `<button type="button" class="cheat-all-btn" data-kwdg="switch" data-on="${d.on ? 0 : 1}">${d.on ? 'Turn dungeons off for players' : 'Turn dungeons on for players'}</button>`
      // Every dungeon is fought on the board; fights with cards left the dungeons on 2026-11-23 (docs/TACTICS.md §8).
      + `<div class="cheat-desc">Every fight is on the board.</div>`
      + `<div class="cheat-section-label" style="margin-top:10px">Test dungeons</div>`
      + `<div class="cheat-desc">Starts with the first ${d.party} adults who are free, or as many as there are (${d.free_adults} free now). Each start is a fresh copy, so it can be played again.</div>`
      + (d.stories || []).map(s => `<button type="button" class="cheat-all-btn" data-kwdg="start" data-story="${esc(s.key)}"${run || !d.free_adults ? ' disabled' : ''}>${esc(s.skull)} Start: ${esc(s.name)} (${s.floors} floor${s.floors === 1 ? '' : 's'})</button>`).join('')
      + `<div class="cheat-section-label" style="margin-top:10px">Generated dungeons</div>`
      + `<div class="cheat-desc">Made from a seed for a skull and a land (the same three always give the same dungeon). Leave the seed empty for a new one each time.</div>`
      + `<div class="kwdg-dev-row"><label>Skull <select id="kwdg-dev-tier" class="ce-input">${(d.tiers || []).map(t => `<option value="${esc(t.key)}"${t.key === p.tier ? ' selected' : ''}>${esc(t.skull)} ${esc(t.name)}</option>`).join('')}</select></label>`
      + `<label>Land <select id="kwdg-dev-land" class="ce-input">${(d.lands || []).map(l => `<option value="${esc(l)}"${l === p.land ? ' selected' : ''}>${esc(l[0].toUpperCase() + l.slice(1))}</option>`).join('')}</select></label>`
      + `<label>Seed <input id="kwdg-dev-seed" class="ce-input" type="number" min="1" inputmode="numeric" placeholder="any" value="${esc(p.seed || '')}"></label></div>`
      + `<button type="button" class="cheat-all-btn" data-kwdg="generate"${run || !d.free_adults ? ' disabled' : ''}>Generate and start</button>`
      + `<div class="cheat-section-label" style="margin-top:10px">Dungeons on the map</div>`
      + `<div class="cheat-desc">${d.map ? `<b>${d.map.live}</b> on the map now. ` : ''}Every town is kept at two within reach, one of them easy; each stays three days. The game tops them up every half hour.</div>`
      + `<button type="button" class="cheat-all-btn" data-kwdg="map-fill">Top the map up now</button>`
      + `<button type="button" class="cheat-all-btn" data-kwdg="map-new">Clear them all and make new ones</button>`
      + `<div class="cheat-section-label" style="margin-top:10px">The run</div>`
      + (run
        ? `<div class="cheat-desc">A party is in <b>${esc(run.dungeon.name)}</b>${run.dungeon.generated ? ` (${esc(run.dungeon.skull)} ${esc(run.dungeon.terrain || '')}, seed ${esc(run.dungeon.seed)})` : ''}${run.pending ? ' (' + esc(run.pending.kind === 'battle' ? 'a fight is open' : 'a choice is waiting') + ')' : ''}.</div>`
          + `<button type="button" class="cheat-all-btn" data-kwdg="open">Open the path screen</button>`
          + (run.status === 'travelling' ? `<button type="button" class="cheat-all-btn" data-kwdg="arrive">Finish the walk now</button>` : '')
          + `<button type="button" class="cheat-all-btn" data-kwdg="win"${run.can_flee ? '' : ' disabled'}>Win the open fight</button>`
          + `<button type="button" class="cheat-all-btn" data-kwdg="heal">Heal the party, everyone up</button>`
          + `<button type="button" class="cheat-all-btn" data-kwdg="idle">Leave it idle for a day (ends the run)</button>`
        : `<div class="cheat-desc">No party is in a dungeon.${d.last ? ' The last run: ' + esc((ENDINGS[d.last.status] || {}).title || d.last.status) + '.' : ''}</div>`
          + (d.last ? `<button type="button" class="cheat-all-btn" data-kwdg="open">See how the last run ended</button>` : '')
          + (d.last && d.last.walking_home ? `<div class="cheat-desc">The party is walking home with what it found.</div><button type="button" class="cheat-all-btn" data-kwdg="arrive">Finish the walk now</button>` : ''))
      + `<div class="cheat-desc" style="margin-top:10px">How tough each skull's foes are (health and power), rest healing, the flee share and idle hours are under 👪 Life → Dungeons.</div>`
      + `<div id="kwt-dev-box"></div>`
      + `<div class="cheat-rel-feedback" id="kwdg-dev-msg" role="status"></div>`;
  }
  async function devCall(method, path, body) {
    const res = await global.apiFetch('/api/dungeons/admin/' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.error || 'That did not work.');
    return d;
  }
  async function devOpen() {
    const el = doc.getElementById('ct-dungeons-body');
    if (!el) return;
    if (!DEV.wired || DEV.el !== el) {
      DEV.wired = true; DEV.el = el;
      el.addEventListener('click', ev => { const t = ev.target.closest('[data-kwdg]'); if (t && !t.disabled) devAct(t); });
      // What was chosen stays chosen when the panel is redrawn.
      const keep = ev => { const k = { 'kwdg-dev-tier': 'tier', 'kwdg-dev-land': 'land', 'kwdg-dev-seed': 'seed' }[ev.target && ev.target.id]; if (k) DEV.pick[k] = ev.target.value; };
      el.addEventListener('change', keep);
      el.addEventListener('input', keep);
    }
    el.innerHTML = devHtml(DEV.data, DEV.pick);
    try { DEV.data = await devCall('GET', 'status'); take(DEV.data); } catch (e) { DEV.data = null; el.innerHTML = `<div class="cheat-desc">⚠️ ${esc(e.message)}</div>`; return; }
    el.innerHTML = devHtml(DEV.data, DEV.pick);
    // The tactics battle has its own box here (js/tactics.js).
    if (global.KWTactics && global.KWTactics.devMount) global.KWTactics.devMount(doc.getElementById('kwt-dev-box'));
  }
  async function devAct(t) {
    const a = t.getAttribute('data-kwdg');
    const say = m => { const e = doc.getElementById('kwdg-dev-msg'); if (e) e.textContent = m; };
    let made = null;
    try {
      if (a === 'open') { if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu(); return void open(); }
      if (a === 'switch') await devCall('POST', 'switch', { on: t.getAttribute('data-on') === '1' });
      else if (a === 'start') {
        const d = await devCall('POST', 'test', { story: t.getAttribute('data-story') });
        S.on = true; take(d);
        if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
        return void open();
      } else if (a === 'generate') {
        const val = id => { const e = doc.getElementById(id); return e ? e.value : ''; };
        const seed = parseInt(val('kwdg-dev-seed'), 10);
        const d = await devCall('POST', 'generate', { tier: val('kwdg-dev-tier'), terrain: val('kwdg-dev-land'), seed: seed > 0 ? seed : undefined });
        S.on = true; take(d);
        if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
        return void open();
      } else if (a === 'win') take(await devCall('POST', 'win'));
      else if (a === 'heal') take(await devCall('POST', 'heal'));
      else if (a === 'idle') take(await devCall('POST', 'sweep', { idle_run: true }));
      else if (a === 'arrive') { take(await devCall('POST', 'arrive')); afterEnd(); }
      else if (a === 'map-fill' || a === 'map-new') {
        made = await devCall('POST', 'map', { expire: a === 'map-new' });
        mapAgain();
      }
      await devOpen();
      say(made ? `${made.gone ? made.gone + ' gone, ' : ''}${made.made} made; ${made.live} on the map.` : a === 'switch' ? 'Saved.' : a === 'win' ? 'The fight is won.' : a === 'heal' ? 'The party is at full health.' : a === 'idle' ? 'The run ended by itself.' : a === 'arrive' ? 'The walk is over.' : '');
    } catch (e) { say('⚠️ ' + e.message); }
  }

  global.KWDungeon = {
    open, load, flee, devOpen, listOpen, tileHtml, wireTile, enter, onEvent,
    current: () => S.run,
    _lootLine: lootLine, _subtitle: subtitle, _roomWords: roomWords, _partyHtml: partyHtml, _mapHtml: mapHtml,
    _pendingHtml: pendingHtml, _eventHtml: eventHtml, _happenedHtml: happenedHtml, _carriedHtml: carriedHtml, _oddsHtml: oddsHtml, _runHtml: runHtml, _endHtml: endHtml, _devHtml: devHtml, _take: take, _state: S, ENDINGS,
    _leftWords: leftWords, _factsLine: factsLine, _standing: standing, _listHtml: listHtml, _hallHtml: hallHtml, _map: MAP, _clock: clock, _walkWords: walkWords, _travelHtml: travelHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
