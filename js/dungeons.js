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
//  Every citizen has their own deck (docs/DUNGEON_CLASS_DECKS.md): the party
//  strip opens each one. At the door each citizen keeps one card of three;
//  after a fight the party keeps one of three; a rest room offers rest or
//  honing a card. "Class cards" shows each class's pack, what the town has
//  unlocked, and which cards are prepared (offered).
//
//  Fights open the ordinary battle screen (js/combat-ui.js) and come back
//  here. That screen asks this file for the words of a dungeon fight's result
//  (battleResult) and for Flee (fleeFromBattle).
//
//  So far dungeons are started from Dev Tools only (devOpen: the 💀 Dungeons
//  tab): the hand-written test dungeons, or one made by the generator for a
//  skull, a land and a seed. Map and quest dungeons, the draft, events and
//  supplies come later.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  // deckOf: the citizen whose deck is open; honing: choosing a card to hone (at a rest, or in place of a fight's card).
  const S = { on: false, run: null, last: null, busy: false, win: null, deckOf: null, honing: false, cards: null };
  const LANES = 3;

  // ── Words (pure) ────────────────────────────────────────────────────────
  const ENDINGS = {
    cleared:   { title: '👑 Dungeon cleared', line: 'The boss is beaten. The party comes home with everything it found.' },
    left:      { title: '↩ Turned back', line: 'The party turned back and kept everything it had found.' },
    fled:      { title: '🏃 Fled', line: 'The party ran from a fight and dropped half of what it carried.' },
    defeat:    { title: '☠ Driven out', line: 'The party lost a battle. Everything found on this run is lost.' },
    timed_out: { title: '⌛ The party came home', line: 'The run was left alone too long, so the party came home with what it had found.' },
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

  // ── Cards (pure) ────────────────────────────────────────────────────────
  // One card as the server describes it: what it costs, what it does in its
  // holder's hands, whom it reaches. `attrs` makes it a button.
  function cardHtml(c, attrs, extra) {
    const tags = [c.heal ? 'Spent until the party rests' : '', c.once ? 'Once a fight' : ''].filter(Boolean);
    const words = `${c.name}, costs ${c.cost}. ${c.text || c.desc || ''}${c.reach ? ' Reaches ' + c.reach + '.' : ''}${tags.length ? ' ' + tags.join('. ') + '.' : ''}`;
    const inner = `<span class="kwdg-card-cost" aria-hidden="true">${esc(c.cost)}</span>`
      + `<span class="kwdg-card-name">${esc(c.name)}${c.n > 1 ? ` <i>×${esc(c.n)}</i>` : ''}</span>`
      + `<span class="kwdg-card-text">${esc(c.text || c.desc || '')}</span>`
      + (c.reach ? `<span class="kwdg-card-reach">${esc(c.reach)}</span>` : '')
      + tags.map(t => `<span class="kwdg-card-tag">${esc(t)}</span>`).join('')
      + (extra || '');
    const cls = `kwdg-card kwdg-card-${esc(c.type || 'attack')}${c.honed ? ' is-honed' : ''}${c.basic ? ' is-basic' : ''}`;
    return attrs ? `<button type="button" class="${cls}" ${attrs} aria-label="${esc(words)}" title="${esc(c.desc || '')}">${inner}</button>`
      : `<div class="${cls}" role="listitem" aria-label="${esc(words)}" title="${esc(c.desc || '')}">${inner}</div>`;
  }
  // A citizen's whole deck, opened from their place in the party strip.
  function deckHtml(m) {
    const d = m && m.deck;
    if (!d) return '';
    return `<div class="kw-box kwdg-deck" role="region" aria-label="${esc(m.name)}'s cards"><div class="kw-box-title">${esc(d.icon || '')} ${esc(m.name)}, ${esc(d.label)}: ${d.size} cards`
      + `<button type="button" class="kw-btn quiet small kwdg-deck-close" data-action="deck" data-citizen="${esc(m.id)}">Close</button></div>`
      + `<div class="kwdg-cards" role="list">${d.cards.map(c => cardHtml(c)).join('')}</div>`
      + (d.spent.length ? `<p class="kw-note">Spent until the party rests: ${esc(list(d.spent.map(c => c.name)))}.</p>` : '') + `</div>`;
  }
  // At the door: one card each.
  function doorHtml(p) {
    const left = p.citizens.filter(c => !c.done).length;
    return `<div class="kw-box kwdg-pending kwdg-pick"><div class="kw-box-title">🚪 At the door: one card each</div>`
      + `<p>Each citizen may add one of these to their own deck for this dungeon. ${left} still to choose.</p>`
      + p.citizens.map(c => `<div class="kwdg-pick-row${c.done ? ' is-done' : ''}"><div class="kwdg-pick-who">${esc(c.name)}</div>`
        + (c.done ? `<div class="kwdg-pick-done">✓ Chosen</div>`
          : `<div class="kwdg-cards" role="group" aria-label="Cards for ${esc(c.name)}">${c.cards.map(k => cardHtml(k, `data-action="pick-door" data-citizen="${esc(c.id)}" data-card="${esc(k.key)}"`)).join('')}`
            + `<button type="button" class="kw-btn quiet small" data-action="pick-door" data-citizen="${esc(c.id)}" data-card="">Pass</button></div>`)
        + `</div>`).join('') + `</div>`;
  }
  // After a fight: three cards, each for a different citizen; keep one.
  function rewardHtml(p) {
    return `<div class="kw-box kwdg-pending kwdg-pick"><div class="kw-box-title">🃏 From the fight: keep one card</div>`
      + `<p>Each card is for the citizen named on it. The party keeps one.</p>`
      + `<div class="kwdg-cards" role="group" aria-label="Cards on offer">${p.offers.map(o => cardHtml(o.card, `data-action="pick-reward" data-index="${esc(o.index)}"`, `<span class="kwdg-card-for">for ${esc(o.name)}</span>`)).join('')}</div>`
      + `<div class="kwdg-btns">${p.can_hone ? `<button type="button" class="kw-btn" data-action="hone-open">✦ Hone a card instead</button>` : ''}`
      + `<button type="button" class="kw-btn quiet" data-action="pick-reward" data-index="">Pass</button></div>`
      + (p.can_hone ? `<p class="kw-note">Honing makes a card the party already holds about a third stronger until the run ends, in place of a new card.</p>` : '') + `</div>`;
  }
  // Honing: choose one card of one citizen. At a rest room the party rests as
  // well; after a fight it is in place of the card on offer.
  function honeHtml(run) {
    const reward = !!(run.pending && run.pending.kind === 'reward');
    return `<div class="kw-box kwdg-pending kwdg-pick"><div class="kw-box-title">✦ Hone a card</div>`
      + `<p>Choose one card. It becomes about a third stronger until the run ends. ${reward ? 'The party takes no new card from this fight.' : 'The party rests as well.'}</p>`
      + (run.party || []).filter(m => m.deck).map(m => `<div class="kwdg-pick-row"><div class="kwdg-pick-who">${esc(m.name)}</div>`
        + `<div class="kwdg-cards" role="group" aria-label="${esc(m.name)}'s cards">${m.deck.cards.filter(c => !c.honed).map(c => cardHtml(c, `data-action="hone" data-citizen="${esc(m.id)}" data-card="${esc(c.key)}"`)).join('')}</div></div>`).join('')
      + `<div class="kwdg-btns"><button type="button" class="kw-btn quiet" data-action="hone-cancel">Back</button></div></div>`;
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
        + (m.deck ? `<button type="button" class="kwdg-member-deck" data-action="deck" data-citizen="${esc(m.id)}" aria-expanded="${S.deckOf === m.id}" aria-label="${esc(m.name)}, ${esc(m.deck.label)}: see their ${m.deck.size} cards">${esc(m.deck.icon || '🃏')} ${esc(m.deck.label)} · ${m.deck.size} cards</button>` : '')
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
  // The thing the room in front of the party wants: a fight, or an answer.
  function pendingHtml(run) {
    const p = run.pending;
    if (!p) return '';
    if ((p.kind === 'rest' || (p.kind === 'reward' && p.can_hone)) && S.honing) return honeHtml(run);
    if (p.kind === 'door') return doorHtml(p);
    if (p.kind === 'reward') return rewardHtml(p);
    if (p.kind === 'battle') {
      const here = (run.rooms || []).find(r => r.current) || {};
      const who = list((here.enemies || []).map(e => e.name));
      return `<div class="kw-box kwdg-pending"><div class="kw-box-title">${p.room === 'boss' ? '👑 The boss' : p.room === 'elite' ? '💀 An elite fight' : '⚔ A fight'}</div>`
        + `<p>${who ? esc(who) + ' block the way.' : 'Something blocks the way.'} The party cannot walk on until the fight is won.</p>`
        + `<div class="kwdg-btns"><button type="button" class="kw-btn primary" data-action="fight">⚔ Fight</button>`
        + `<button type="button" class="kw-btn danger" data-action="flee">🏃 Flee the dungeon</button></div>`
        + `<p class="kw-note">Fleeing ends the run and the party drops half of what it carries.</p></div>`;
    }
    const title = p.kind === 'landing' ? '🪜 A landing between floors' : '🔥 A place to rest';
    return `<div class="kw-box kwdg-pending"><div class="kw-box-title">${title}</div>`
      + (p.options || []).map(o => `<div class="kwdg-option"><button type="button" class="kw-btn primary" data-action="${o.needs === 'card' ? 'hone-open' : 'choose'}" data-option="${esc(o.key)}">${esc(o.label)}</button><span>${esc(o.text)}</span></div>`).join('')
      + `</div>`;
  }
  function runHtml(run) {
    const d = run.dungeon, moves = (run.moves || []).length;
    const cardsFirst = !!run.pending && (run.pending.kind === 'door' || run.pending.kind === 'reward');
    const hint = run.pending ? '' : moves ? `<p class="kwdg-hint">Choose the next room${moves > 1 ? ': there are ' + moves + ' ways on' : ''}.</p>` : '';
    return `<div class="kwdg">`
      + `<p class="kwdg-intro">${esc(d.intro)}${d.boss ? ` At the end: ${esc(d.boss)}.` : ''} <span class="kwdg-scale">Creatures here have +${pct(d.creatures.health)}% health and +${pct(d.creatures.strength)}% strength.</span></p>`
      + partyHtml(run.party)
      + deckHtml((run.party || []).find(m => m.id === S.deckOf))
      // A choice of cards is the thing to do now, so it comes before the floor; a room's own choice comes after it.
      + (cardsFirst ? pendingHtml(run) : '')
      + mapHtml(run)
      + hint
      + (cardsFirst ? '' : pendingHtml(run))
      + `<div class="kwdg-foot"><div class="kwdg-loot" aria-live="polite"><b>Carried:</b> ${esc(lootLine(run.loot))}</div>`
      + `<div class="kwdg-btns">${run.combat === 'board' ? '' : `<button type="button" class="kw-btn quiet" data-action="cards">🃏 Class cards</button>`}`
      + (run.can_leave ? `<button type="button" class="kw-btn" data-action="leave">↩ Turn back and keep it</button>` : '')
      + `</div></div></div>`;
  }
  // How a finished run ended: what came home, what was lost, who was hurt.
  function endHtml(run) {
    const r = run.result || {}, e = ENDINGS[run.status] || ENDINGS.left;
    const line = run.status === 'timed_out' && r.half ? 'The run was left alone in the middle of a fight, so the party came home with half of what it carried.' : e.line;
    const names = {}; (run.party || []).forEach(m => { names[m.id] = m.name; });
    const rolled = (r.rolled || []).map(x => names[x.id]).filter(Boolean);
    const inj = (r.injuries || []).map(i => `<li class="kwdg-inj kwdg-inj-${esc(i.severity || '')}">${esc(i.narrative || '')}</li>`).join('');
    const lost = r.lost && (r.lost.wealth || (r.lost.items || []).length);
    return `<div class="kwdg kwdg-end">`
      + `<h3 class="kwdg-end-title">${esc(e.title)}</h3><p>${esc(line)}</p>`
      + `<div class="kw-box"><div class="kw-box-title">Came home</div><p>${esc(lootLine(r.kept, 'Nothing'))}</p></div>`
      + (lost ? `<div class="kw-box"><div class="kw-box-title">Lost</div><p>${esc(lootLine(r.lost))}</p></div>` : '')
      + `<div class="kw-box"><div class="kw-box-title">Injuries</div>`
      + (rolled.length
        ? `<p>${esc(list(rolled))} ${rolled.length === 1 ? 'was' : 'were'} at risk of injury.</p>${inj ? `<ul class="kwdg-injs">${inj}</ul>` : '<p>All of them got away without a wound.</p>'}`
        : '<p>Nobody went down, so nobody was hurt.</p>')
      + `</div>`
      + ((r.upgraded || []).length ? `<p class="kw-note">${esc(list(r.upgraded.map(u => u.name)))} came back a better fighter.</p>` : '')
      + `<div class="kwdg-btns"><button type="button" class="kw-btn primary" data-action="close">Close</button></div></div>`;
  }
  function bodyHtml() {
    const run = S.run || S.last;
    if (!S.on) return '<p class="kw-empty">Dungeons are not open yet.</p>';
    if (!run) return '<p class="kw-empty">No party of yours is in a dungeon.</p>';
    return run.status === 'active' ? runHtml(run) : endHtml(run);
  }

  // ── Data ────────────────────────────────────────────────────────────────
  // Keep what the server said: `run` is the unfinished run or the one that
  // just ended; `last` (when given) is the most recent finished run.
  function take(d) {
    if (!d) return;
    if ('on' in d) S.on = !!d.on;
    if ('run' in d || 'last' in d) {
      const run = d.run || null, was = S.run;
      if (run && run.status === 'active') { S.run = run; S.last = null; if (!(run.pending && (run.pending.kind === 'rest' || run.pending.kind === 'reward'))) S.honing = false; }
      else {
        S.run = null;
        if (run) S.last = run; else if ('last' in d) S.last = d.last || null;
        if (was) afterEnd();
      }
    }
    paint();
  }
  // A run has ended: the town's stores, wealth and citizens have changed.
  function afterEnd() {
    try { if (typeof global.refreshResources === 'function') global.refreshResources(); } catch (e) { /* not loaded */ }
    try { if (typeof global.loadCitizens === 'function') global.loadCitizens(); } catch (e) { /* not loaded */ }
  }
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
  function startBattle(id) {
    if (!id || typeof global.startBattleFromQuest !== 'function') { toast('⚠️ The battle screen is not loaded.'); return; }
    if (S.win) { const w = S.win; S.win = null; try { w.close(); } catch (e) { /* gone */ } }
    global.startBattleFromQuest(id);
  }
  const ACTIONS = {
    async enter(el) {
      const d = await post('run/move', { room: el.getAttribute('data-room') });
      if (!d) return;
      if (d.found) toast('🎁 Found: ' + lootLine(d.found, 'nothing'));
      if (d.quest_run_id) startBattle(d.quest_run_id);
    },
    fight() {
      const p = S.run && S.run.pending;
      if (!p || p.kind !== 'battle') return;
      if (!p.board) return startBattle(p.quest_run_id);
      // A fight on the board (docs/TACTICS.md): the path screen steps aside and comes back when the battle is left.
      if (!global.KWTactics || !global.KWTactics.openById) return toast('⚠️ The battle screen is not loaded.');
      if (S.win) { const w = S.win; S.win = null; try { w.close(); } catch (e) { /* gone */ } }
      global.KWTactics.openById(p.battle_id).catch(e => { toast('⚠️ ' + e.message); open(); });
    },
    async choose(el) { await post('run/choose', { option: el.getAttribute('data-option') }); },
    // A citizen's deck, opened and closed from the party strip.
    deck(el) { const id = Number(el.getAttribute('data-citizen')); S.deckOf = S.deckOf === id ? null : id; paint(); },
    // At the door: keep a card for that citizen, or pass (no card).
    async 'pick-door'(el) { await post('run/pick', { citizen_id: Number(el.getAttribute('data-citizen')), card: el.getAttribute('data-card') || null }); },
    // After a fight: keep one of the three, or pass (no index).
    async 'pick-reward'(el) { const i = el.getAttribute('data-index'); const d = await post('run/pick', { index: i === '' ? null : Number(i) }); if (d && d.took) toast(`🃏 ${d.took.card.name} added.`); },
    // Honing: open the chooser, then send the card.
    'hone-open'() { S.honing = true; paint(); },
    'hone-cancel'() { S.honing = false; paint(); },
    async hone(el) {
      const what = { citizen_id: Number(el.getAttribute('data-citizen')), card: el.getAttribute('data-card') };
      const reward = !!(S.run && S.run.pending && S.run.pending.kind === 'reward');
      const d = reward ? await post('run/pick', { hone: what }) : await post('run/choose', { option: 'hone', ...what });
      if (d) { S.honing = false; toast(reward ? '✦ Honed.' : '✦ Rested, and honed.'); paint(); }
    },
    cards() { openCards(); },
    async leave() {
      const run = S.run; if (!run) return;
      const ok = await confirmed({ title: 'Turn back?', message: `The party leaves ${run.dungeon.name} and keeps everything it has found: ${lootLine(run.loot, 'nothing so far')}. Your town cannot enter this dungeon again.`, ok: 'Turn back' });
      if (ok) await post('run/leave');
    },
    async flee() { await flee(); },
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
    return S.win;
  }

  // ── Class cards: what each class starts with, what the town has unlocked,
  //    and what is prepared (offered at the door and after fights) ─────────
  function collectionHtml(data, cls) {
    const c = ((data && data.classes) || []).find(x => x.cls === cls) || ((data && data.classes) || [])[0];
    if (!c) return '<p class="kw-empty">No class cards.</p>';
    const toggle = k => k.basic ? '' : `<label class="kwdg-prep"><input type="checkbox" data-action="prepare" data-card="${esc(k.key)}"${k.prepared ? ' checked' : ''}${k.owned ? '' : ' disabled'}> Prepared</label>`;
    const row = (k, lead) => `<div class="kwdg-coll-row${k.owned ? '' : ' is-locked'}" role="listitem">${cardHtml(k)}`
      + `<div class="kwdg-coll-side">${lead || ''}${k.owned ? toggle(k) : `<span class="kwdg-locked">🔒 ${esc(k.how || 'Not unlocked yet')}</span>`}</div></div>`;
    return `<div class="kwdg kwdg-coll">`
      + `<p class="kwdg-intro">A ${esc(c.label)} walks into a dungeon with the pack below. At the door, and after each fight, they are offered cards from what is <b>prepared</b>: untick a card and it is never offered.</p>`
      + `<div class="kw-box"><div class="kw-box-title">${esc(c.icon)} The ${esc(c.label)} pack</div><div role="list">${c.pack.map(k => row(k)).join('')}</div></div>`
      + (c.trades.length ? `<div class="kw-box"><div class="kw-box-title">Trade cards: two copies, by the kind of job</div><div role="list">${c.trades.map(k => row(k, `<span class="kwdg-kind">${esc(k.kind)}</span>`)).join('')}</div></div>` : '')
      + (c.more.length ? `<div class="kw-box"><div class="kw-box-title">${cls === 'villager' ? 'Plain cards any villager can be offered' : 'Cards the town can unlock'}</div><div role="list">${c.more.map(k => row(k)).join('')}</div></div>` : '')
      + `</div>`;
  }
  async function loadCards() {
    try { const res = await global.apiFetch('/api/dungeons/cards'); const d = await res.json(); if (res.ok && d.ok) S.cards = d; } catch (e) { /* keep what we have */ }
    return S.cards;
  }
  async function openCards() {
    await loadCards();
    if (!global.KWWindow) return null;
    const classes = (S.cards && S.cards.classes) || [];
    return global.KWWindow.open({
      id: 'dungeon-cards', title: 'Class cards', subtitle: 'What each class brings into a dungeon', icon: '🃏', size: 'L',
      tabs: classes.map(c => ({ key: c.cls, label: c.label })), tab: classes[0] ? classes[0].cls : undefined,
      render(body, state, w) { body.innerHTML = collectionHtml(S.cards, w && w.tab ? w.tab : (classes[0] || {}).cls); },
      actions: {
        async prepare(el, ev, w) {
          try {
            const res = await global.apiFetch('/api/dungeons/cards/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card: el.getAttribute('data-card'), prepared: !!el.checked }) });
            const d = await res.json().catch(() => ({}));
            if (res.ok && d.ok) S.cards = d; else toast('⚠️ ' + (d.error || 'That did not work. Try again.'));
          } catch (e) { toast('⚠️ Could not reach the server.'); }
          if (w) w.refresh();
        },
      },
    });
  }

  // ── The battle screen asks (js/combat-ui.js) ────────────────────────────
  // What the server said a dungeon fight gave, added to the result panel.
  function battleResult(body, data) {
    const d = data && data.dungeon;
    if (!d) return;
    if (d.run) { S.on = true; take({ run: d.run }); }
    let html = '';
    if (d.found && (d.found.wealth || (d.found.items || []).length)) {
      html += `<div class="cm-result-line">Found here: ${esc(lootLine(d.found))}</div>`;
      if (!d.ended) html += '<div class="cm-result-line cm-result-sub">The party carries it until the run ends.</div>';
    }
    if (d.ended && d.run && d.run.status === 'cleared') html += '<div class="cm-result-line">👑 The dungeon is cleared.</div>';
    if (body && html) body.insertAdjacentHTML('beforeend', html);
    const btn = doc.getElementById('cm-result-btn');
    if (btn) btn.textContent = d.ended ? 'See how it ended' : 'Back to the path';
  }
  // The Flee button on the battle screen. → true when the party fled.
  async function fleeFromBattle() {
    if (!S.run) await load();
    return flee();
  }

  // ── Dev Tools → 💀 Dungeons ─────────────────────────────────────────────
  // `pick`: the skull, land and seed last chosen, kept while the panel is redrawn.
  const DEV = { data: null, wired: false, pick: { tier: '', land: '', seed: '', combat: 'board' } };
  function devHtml(d, pick) {
    if (!d) return '<div class="cheat-desc">Loading…</div>';
    const run = d.run, p = pick || {};
    return `<div class="cheat-section-label">Dungeons</div>`
      + `<div class="cheat-desc">Dungeons are <b>${d.on ? 'ON' : 'off'}</b> for players. While off, only admins can play a run, started from here.</div>`
      + `<button type="button" class="cheat-all-btn" data-kwdg="switch" data-on="${d.on ? 0 : 1}">${d.on ? 'Turn dungeons off for players' : 'Turn dungeons on for players'}</button>`
      + `<div class="kwdg-dev-row"><label>Fights <select id="kwdg-dev-combat" class="ce-input"><option value="board"${p.combat !== 'cards' ? ' selected' : ''}>On the board (tactics)</option><option value="cards"${p.combat === 'cards' ? ' selected' : ''}>With cards (the old way)</option></select></label></div>`
      + `<div class="cheat-section-label" style="margin-top:10px">Test dungeons</div>`
      + `<div class="cheat-desc">Starts with the first ${d.party} adults who are free (${d.free_adults} free now). Each start is a fresh copy, so it can be played again.</div>`
      + (d.stories || []).map(s => `<button type="button" class="cheat-all-btn" data-kwdg="start" data-story="${esc(s.key)}"${run || d.free_adults < d.party ? ' disabled' : ''}>${esc(s.skull)} Start: ${esc(s.name)} (${s.floors} floor${s.floors === 1 ? '' : 's'})</button>`).join('')
      + `<div class="cheat-section-label" style="margin-top:10px">Generated dungeons</div>`
      + `<div class="cheat-desc">Made from a seed for a skull and a land (the same three always give the same dungeon). Leave the seed empty for a new one each time.</div>`
      + `<div class="kwdg-dev-row"><label>Skull <select id="kwdg-dev-tier" class="ce-input">${(d.tiers || []).map(t => `<option value="${esc(t.key)}"${t.key === p.tier ? ' selected' : ''}>${esc(t.skull)} ${esc(t.name)}</option>`).join('')}</select></label>`
      + `<label>Land <select id="kwdg-dev-land" class="ce-input">${(d.lands || []).map(l => `<option value="${esc(l)}"${l === p.land ? ' selected' : ''}>${esc(l[0].toUpperCase() + l.slice(1))}</option>`).join('')}</select></label>`
      + `<label>Seed <input id="kwdg-dev-seed" class="ce-input" type="number" min="1" inputmode="numeric" placeholder="any" value="${esc(p.seed || '')}"></label></div>`
      + `<button type="button" class="cheat-all-btn" data-kwdg="generate"${run || d.free_adults < d.party ? ' disabled' : ''}>Generate and start</button>`
      + `<div class="cheat-section-label" style="margin-top:10px">The run</div>`
      + (run
        ? `<div class="cheat-desc">A party is in <b>${esc(run.dungeon.name)}</b>${run.dungeon.generated ? ` (${esc(run.dungeon.skull)} ${esc(run.dungeon.terrain || '')}, seed ${esc(run.dungeon.seed)})` : ''}${run.pending ? ' (' + esc(run.pending.kind === 'battle' ? 'a fight is open' : 'a choice is waiting') + ')' : ''}.</div>`
          + `<button type="button" class="cheat-all-btn" data-kwdg="open">Open the path screen</button>`
          + `<button type="button" class="cheat-all-btn" data-kwdg="win"${run.can_flee ? '' : ' disabled'}>Win the open fight</button>`
          + `<button type="button" class="cheat-all-btn" data-kwdg="heal">Heal the party, everyone up</button>`
          + `<button type="button" class="cheat-all-btn" data-kwdg="idle">Leave it idle for a day (ends the run)</button>`
        : `<div class="cheat-desc">No party is in a dungeon.${d.last ? ' The last run: ' + esc((ENDINGS[d.last.status] || {}).title || d.last.status) + '.' : ''}</div>`
          + (d.last ? `<button type="button" class="cheat-all-btn" data-kwdg="open">See how the last run ended</button>` : ''))
      + `<div class="cheat-section-label" style="margin-top:10px">Class cards</div>`
      + `<div class="cheat-desc">Every citizen brings their own deck: the pack for their class, or the Villager pack. This shows each pack, what the town has unlocked, and what is prepared.</div>`
      + `<button type="button" class="cheat-all-btn" data-kwdg="cards">Open the class cards</button>`
      + `<div class="cheat-desc" style="margin-top:10px">Creature health and strength per skull, rest healing, the flee share and idle hours are under 👪 Life → Dungeons.</div>`
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
      const keep = ev => { const k = { 'kwdg-dev-tier': 'tier', 'kwdg-dev-land': 'land', 'kwdg-dev-seed': 'seed', 'kwdg-dev-combat': 'combat' }[ev.target && ev.target.id]; if (k) DEV.pick[k] = ev.target.value; };
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
    try {
      if (a === 'open') { if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu(); return void open(); }
      if (a === 'cards') { if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu(); return void openCards(); }
      if (a === 'switch') await devCall('POST', 'switch', { on: t.getAttribute('data-on') === '1' });
      else if (a === 'start') {
        const d = await devCall('POST', 'test', { story: t.getAttribute('data-story'), combat: DEV.pick.combat === 'cards' ? 'cards' : 'board' });
        S.on = true; take(d);
        if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
        return void open();
      } else if (a === 'generate') {
        const val = id => { const e = doc.getElementById(id); return e ? e.value : ''; };
        const seed = parseInt(val('kwdg-dev-seed'), 10);
        const d = await devCall('POST', 'generate', { tier: val('kwdg-dev-tier'), terrain: val('kwdg-dev-land'), seed: seed > 0 ? seed : undefined, combat: DEV.pick.combat === 'cards' ? 'cards' : 'board' });
        S.on = true; take(d);
        if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
        return void open();
      } else if (a === 'win') take(await devCall('POST', 'win'));
      else if (a === 'heal') take(await devCall('POST', 'heal'));
      else if (a === 'idle') take(await devCall('POST', 'sweep', { idle_run: true }));
      await devOpen();
      say(a === 'switch' ? 'Saved.' : a === 'win' ? 'The fight is won.' : a === 'heal' ? 'The party is at full health.' : a === 'idle' ? 'The run ended by itself.' : '');
    } catch (e) { say('⚠️ ' + e.message); }
  }

  global.KWDungeon = {
    open, load, flee, fleeFromBattle, battleResult, devOpen, openCards,
    current: () => S.run,
    _cardHtml: cardHtml, _deckHtml: deckHtml, _doorHtml: doorHtml, _rewardHtml: rewardHtml, _honeHtml: honeHtml, _collectionHtml: collectionHtml,
    _lootLine: lootLine, _subtitle: subtitle, _roomWords: roomWords, _partyHtml: partyHtml, _mapHtml: mapHtml,
    _pendingHtml: pendingHtml, _runHtml: runHtml, _endHtml: endHtml, _devHtml: devHtml, _take: take, _state: S, ENDINGS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
