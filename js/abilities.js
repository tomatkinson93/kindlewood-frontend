// ══════════════════════════════════════════════════════════════════════════
//  KWAbilities — the Abilities tab on a citizen (docs/TACTICS.md §6).
//
//  What a citizen brings to a battle on the board: their Attack (their
//  class's own, on its own button), everything their class
//  has taught them (their school, with the plain blow of Basics), what the
//  class has still to teach, and their second school: up to five abilities
//  from one other class they have levels in, which work at three-quarters
//  strength. Which class and which five is chosen here and kept until
//  changed. It also shows what their class's building teaches (extra
//  abilities and passives, each for hours and a fee: POST /api/tactics/study/:id)
//  and the one passive they carry.
//
//  The server decides what is known and keeps the choice
//  (lib/tactics_abilities.js there: GET /api/tactics/abilities/:id,
//  POST …/second { cls, keys }). This file shows the answer and sends the
//  choice. The pictures and the words for what an ability does are the
//  battle screen's own (KWTactics.icon, effectText, reachText).
//
//  Every battle is fought on the board, so the tab is on every grown
//  citizen's page.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  // page: what the server last said; pick: { cls, keys } as chosen now for the second school (null until the player changes something).
  // study: what the server last said about study and the passive slot (GET /api/tactics/study/:id).
  const S = { id: null, page: null, study: null, pick: null, busy: false, wired: null, clock: null };

  // Every player's battles are fought on the board, so every grown citizen has the tab.
  const available = () => true;

  // ── Words (pure) ────────────────────────────────────────────────────────
  const T = () => global.KWTactics || {};
  const icon = a => (T().icon ? T().icon(a) : esc(a.icon || '•'));
  const effect = a => (T().effectText ? T().effectText(a) : '');
  const reach = a => (T().reachText ? T().reachText(a) : '');
  // "every 3rd turn", "twice a battle", "quick".
  function pace(a) {
    const bits = [];
    if (a.quick) bits.push('quick: does not end the turn');
    if (a.uses != null) bits.push(a.uses === 1 ? 'once a battle' : a.uses === 2 ? 'twice a battle' : `${a.uses} times a battle`);
    else if (a.cooldown > 0) bits.push(a.cooldown === 1 ? 'every other turn' : `every ${a.cooldown + 1}${a.cooldown + 1 === 3 ? 'rd' : 'th'} turn`);
    return bits.join(' · ');
  }
  // The second school as the server has it: { cls, keys } ('none' when nothing is brought).
  const saved = p => { const o = (p.second.options || []).find(x => x.cls === p.second.cls); return { cls: o ? o.cls : 'none', keys: o ? o.abilities.filter(a => a.ready).map(a => a.key) : [] }; };
  const chosen = p => (S.pick && S.id === p.citizen.id ? S.pick : saved(p));
  const sameSet = (a, b) => a.length === b.length && a.every(k => b.includes(k));
  const pct100 = n => Math.round((Number(n) || 0) * 100);

  // ── Markup (pure) ───────────────────────────────────────────────────────
  // How near an ability is to being mastered: used in battle so many times of the number it takes (the page's
  // `mastery`, kept in M while a page is drawn). Nothing for one not known yet.
  let M = null;
  function masteryHtml(a) {
    if (!M || a.known === false || a.used == null) return '';      // `used`: times used in battle; `uses` is an ability's own limit a battle
    return a.star ? `<span class="kwab-mastery is-done">✦ Mastered: ${Math.round((M.edge - 1) * 100)}% stronger</span>`
      : `<span class="kwab-mastery" role="img" aria-label="Used ${esc(a.used)} of ${esc(M.uses)} times in battle towards mastery"><span class="kwab-mastery-bar"><span style="width:${Math.round(a.used / M.uses * 100)}%"></span></span> ${esc(a.used)} of ${esc(M.uses)} uses to ✦</span>`;
  }
  // One ability. `state`: the markup at the end of its row (a level, a tick box, "brought").
  function rowHtml(a, state, cls) {
    const words = [effect(a), reach(a), pace(a)].filter(Boolean).join(' · ');
    return `<li class="kwab-row${cls ? ' ' + cls : ''}" aria-label="${esc(a.name)}">`
      + `<span class="kwab-ico" aria-hidden="true">${icon(a)}</span>`
      + `<span class="kwab-what"><b>${esc(a.name)}${a.signature ? ' <span class="kwab-sig" title="Their family\'s signature">⚜</span>' : ''}${a.star ? ' <span class="kwab-star" title="Mastered: a fifth stronger">✦</span>' : ''}</b>${a.signature ? `<span class="kwab-desc kwab-sig-by">A family signature${a.taught_by ? `, taught by ${esc(a.taught_by)}` : ''}: theirs for life, whatever work they take up.</span>` : ''}${a.lore ? `<span class="kwab-desc kwab-sig-by">Village lore${a.taught_by ? `, taught at ${esc(a.taught_by)}` : ''}: theirs for life. An Allied village teaches it.</span>` : ''}<span class="kwab-does">${esc(words)}</span>${a.desc ? `<span class="kwab-desc">${esc(a.desc)}</span>` : ''}${masteryHtml(a)}</span>`
      + state + `</li>`;
  }
  // The second school: which other class to bring abilities from, and which of them (up to p.second.max).
  function secondHtml(p, pick) {
    const sec = p.second, opts = sec.options || [];
    const title = `<h4 class="kwab-h">Second school <span class="kwab-h-sub">up to ${esc(sec.max)} abilities from an old career, at ${pct100(sec.strength)}% strength</span></h4>`;
    if (!opts.length) return title + `<p class="kwab-note">${esc(p.citizen.name)} has never been anything else. A citizen who changes career keeps what the old class taught them and can bring up to ${esc(sec.max)} of it into battle. It works at three-quarters strength, and leans on their own stats and gear: a Guard's healing is a poor thing beside a Hearthkeeper's.</p>`;
    const was = saved(p), can = !sec.busy;
    const radio = (value, label, sub) => `<label class="kwab-school${pick.cls === value ? ' is-on' : ''}"><input type="radio" name="kwab-second" data-kwab="school" value="${esc(value)}"${pick.cls === value ? ' checked' : ''}${can ? '' : ' disabled'}> <span><b>${label}</b>${sub ? ` <i>${sub}</i>` : ''}</span></label>`;
    const open = opts.find(o => o.cls === pick.cls);
    const list = open ? `<ul class="kwab-list">` + open.abilities.map(a => {
      const on = pick.keys.includes(a.key);
      return rowHtml(a, `<label class="kwab-tick"><input type="checkbox" data-kwab="toggle" data-key="${esc(a.key)}"${on ? ' checked' : ''}${!can || (!on && pick.keys.length >= sec.max) ? ' disabled' : ''}> <span>${on ? 'Brought' : 'At home'}</span></label>`, on ? 'is-ready is-off' : 'is-off');
    }).join('') + `</ul>` : '';
    const dirty = pick.cls !== was.cls || !sameSet(pick.keys, was.keys), ok = pick.cls === 'none' || (pick.keys.length >= 1 && pick.keys.length <= sec.max);
    return title
      + (sec.busy ? `<p class="kwab-note">${esc(p.citizen.name)} is away at a dungeon. Abilities are chosen at home.</p>` : '')
      + `<div class="kwab-schools" role="radiogroup" aria-label="Which old career to bring abilities from">`
      + opts.map(o => radio(o.cls, `${esc(o.school.icon || '')} ${esc(o.school.name)}`, `${esc(o.label)} level ${esc(o.level)}`)).join('') + radio('none', 'None', 'bring only their own')
      + `</div>` + list
      + (can ? `<div class="kwab-bar"><span class="kwab-count${open && pick.keys.length === sec.max ? ' is-full' : ''}" role="status">${open ? `${pick.keys.length} of ${esc(sec.max)} chosen` : 'Nothing from another class'}</span>`
        + `<button type="button" class="kw-btn primary" data-kwab="save"${!dirty || !ok ? ' disabled' : ''}>Save</button></div>` : '');
  }
  // What they hold and wear, and what its kind does to their abilities (the server's lib/gear_kinds.js).
  function gearHtml(p) {
    if (!p.kinds) return '';
    const g = p.gear || {}, rows = [];
    if (g.weapon) rows.push(`<li><span aria-hidden="true">${esc(g.weapon.icon || '')}</span> <b>${esc(g.weapon.name)}</b>${g.weapon.kind_name ? ` <i>${esc(g.weapon.kind_name)}</i>` : ''} ${esc(g.weapon.says || 'An odd thing to fight with: it changes nothing.')}</li>`);
    if (g.shield) rows.push(`<li><span aria-hidden="true">${esc(g.shield.icon || '')}</span> <b>${esc(g.shield.name)}</b> ${esc(g.shield.says || '')}</li>`);
    if (g.idle) rows.push(`<li class="is-idle"><span aria-hidden="true">${esc(g.idle.icon || '')}</span> <b>${esc(g.idle.name)}</b> ${esc(g.idle.says || '')}</li>`);
    if (g.armour) rows.push(`<li><span aria-hidden="true">${esc(g.armour.icon || '')}</span> <b>${esc(g.armour.name)}</b> Takes the edge off every hit.</li>`);
    // What the town has researched for battle at the Library (the Battlecraft path): every citizen has it.
    const lore = (p.research || []).length ? `<ul class="kwab-gear kwab-lore">${p.research.map(x => `<li><span aria-hidden="true">${esc(x.icon || '📚')}</span> <b>${esc(x.name)}</b> <i>from the Library</i> ${esc(x.says || '')}</li>`).join('')}</ul>` : '';
    return `<h4 class="kwab-h">Gear <span class="kwab-h-sub">what they hold changes what their abilities do</span></h4>`
      + (rows.length ? `<ul class="kwab-gear">${rows.join('')}</ul>` : `<p class="kwab-note">${esc(p.citizen.name)} carries nothing that changes a fight. Weapons, shields and armour are equipped from the town's stores.</p>`)
      + lore
      + `<details class="kwab-kinds"><summary>What each kind of weapon does</summary><ul>${p.kinds.map(k => `<li><b>${esc(k.name)}</b>${k.hands === 2 ? ' <i>two hands</i>' : ''} ${esc(k.says)}</li>`).join('')}<li><b>Shield</b> Arms blocks are stronger by the shield's worth. Not with a weapon that takes two hands.</li></ul>`
      + `<p class="kwab-note">These read the school of an ability, not the class of whoever uses it: a lantern helps a Guard's borrowed healing as much as a Hearthkeeper's own.</p></details>`;
  }
  // ── Study at the class building, and the passive slot (the server's lib/tactics_study.js) ──
  // "1:32:10" until a time the server gave; "now" once it has passed.
  function untilWords(when, now) {
    const left = Math.max(0, Math.ceil((new Date(when).getTime() - (now == null ? Date.now() : now)) / 1000));
    if (left <= 0) return 'now';
    const h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), sec = left % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  // The one passive a citizen carries into battle, chosen among those they have learned.
  function passiveHtml(st) {
    if (!st) return '';
    const title = `<h4 class="kwab-h">Passive <span class="kwab-h-sub">one always-on trait in battle</span></h4>`;
    if (!(st.passives || []).length) return title + `<p class="kwab-note">None yet. Passives are learned by study${st.building ? ` at the ${esc(st.building.name)}` : ''}.</p>`;
    const radio = (key, label, sub) => `<label class="kwab-school${(st.passive || 'none') === key ? ' is-on' : ''}"><input type="radio" name="kwab-passive" data-kwab="passive" value="${esc(key)}"${(st.passive || 'none') === key ? ' checked' : ''}> <span><b>${label}</b>${sub ? ` <i>${sub}</i>` : ''}</span></label>`;
    return title + `<div class="kwab-schools kwab-passives" role="radiogroup" aria-label="Which passive to carry">`
      + st.passives.map(x => radio(x.key, `${esc(x.icon || '')} ${esc(x.name)}`, esc(x.says))).join('') + radio('none', 'None', '') + `</div>`;
  }
  // What the class's building teaches: each lesson with what it is, what it takes, and a button or the reason it is closed.
  function studyHtml(st, now) {
    if (!st || !st.building) return '';
    const b = st.building;
    const head = `<h4 class="kwab-h">Study <span class="kwab-h-sub">at the ${esc(b.name)}${b.level ? ` · level ${esc(b.level)} · ${esc(b.used)} of ${esc(b.seats)} seat${b.seats === 1 ? '' : 's'} taken` : ''}</span></h4>`;
    if (!b.level) return head + `<p class="kwab-note">The town has no ${esc(b.name)}. Build one and ${esc(st.citizen.name)} can study there: extra abilities and passives, each for some hours and a fee.</p>`;
    const now2 = st.studying ? `<div class="kwab-studying" role="status">📖 Studying <b>${esc(st.studying.name)}</b>: done in <b class="kwab-clock" data-kwab-clock="${esc(st.studying.done_at)}">${esc(untilWords(st.studying.done_at, now))}</b>. They carry on as normal meanwhile. `
      + `<button type="button" class="kw-btn quiet" data-kwab="study-stop">Stop (the fee comes back)</button></div>` : '';
    const rows = (st.lessons || []).map(l => {
      const tag = `<i class="kwab-kind">${l.kind === 'passive' ? 'Passive' : 'Ability'}</i>`, cost = `${esc(l.hours)} hour${l.hours === 1 ? '' : 's'} · ${esc(l.wealth)} wealth`;
      const end = l.state === 'known' ? `<span class="kwab-when is-on">✓ Known</span>`
        : l.state === 'studying' ? `<span class="kwab-when is-on">Studying…</span>`
          : l.state === 'open' ? `<button type="button" class="kw-btn primary" data-kwab="study" data-key="${esc(l.key)}">Study <span class="kwab-cost">${cost}</span></button>`
            : `<span class="kwab-when">🔒 ${esc(l.why || '')}</span>`;
      return `<li class="kwab-row kwab-lesson is-${esc(l.state)}"><span class="kwab-ico" aria-hidden="true">${esc(l.icon || '•')}</span>`
        + `<span class="kwab-what"><b>${esc(l.name)} ${tag}</b><span class="kwab-does">${esc(l.says || '')}</span>${l.state === 'known' || l.state === 'studying' ? '' : `<span class="kwab-desc">${cost}</span>`}</span>${end}</li>`;
    }).join('');
    return head + now2 + `<ul class="kwab-list">${rows}</ul>`;
  }
  function pageHtml(p, pickNow, study) {
    if (!p) return '<div class="cp-rel-loading">Reading what they know…</div>';
    const pick = pickNow || saved(p), next = (p.ahead || [])[0];
    M = p.mastery || null;
    const pct = p.xp && p.xp.need ? Math.max(0, Math.min(100, Math.round(p.xp.into / p.xp.need * 100))) : 100;
    const head = p.career
      ? `<div class="kwab-head"><span class="kwab-big" aria-hidden="true">${esc(p.icon || '')}</span><div><div class="kwab-title">${esc(p.label)} · level ${esc(p.level)}</div>`
        + `<div class="kwab-xp" role="img" aria-label="${p.xp && p.xp.need ? `${esc(p.xp.into)} of ${esc(p.xp.need)} experience towards level ${p.level + 1}` : 'the highest level'}"><span style="width:${pct}%"></span></div>`
        + `<div class="kwab-sub">${next ? `Next: <b>${esc(next.name)}</b> at level ${esc(next.at)}.` : 'Every ability the class teaches by level is known.'} Levels come from battles won, and from working at the job.</div></div></div>`
      : `<div class="kwab-head"><span class="kwab-big" aria-hidden="true">${esc(p.icon || '🧺')}</span><div><div class="kwab-title">Villager</div>`
        + `<div class="kwab-sub">${esc(p.citizen.name)} has no fighting class, so they fight with a swing, a duck, and what their trade taught them. As a Guard, Archer, Wizard or Hearthkeeper they would learn ten more.</div></div></div>`;
    // Their Attack: its own button in a battle, apart from their abilities.
    const attack = p.attack ? `<h4 class="kwab-h">Attack <span class="kwab-h-sub">${p.cls === 'guard' || p.cls === 'archer' ? 'a fighter\'s: it hits well' : p.cls === 'villager' ? 'a swing with whatever is to hand' : 'their craft is magic: a blow from them is a feeble thing'}</span></h4>`
      + `<ul class="kwab-list">${rowHtml(p.attack, `<span class="kwab-when is-on">Always</span>`, 'is-ready is-attack')}</ul>` : '';
    // Their own: everything here goes into every battle. An ability of another school (the plain blow of Basics, a trade's trick) says so.
    const own = `<h4 class="kwab-h">${esc(p.school.icon || '')} ${esc(p.school.name)} <span class="kwab-h-sub">${p.abilities.length} known: all of them go into battle</span></h4>`
      + `<ul class="kwab-list">${p.abilities.map(a => rowHtml(a, `<span class="kwab-when is-on">${a.signature ? '⚜ Signature' : a.lore ? '🏡 Village lore' : a.school !== p.school.key && a.school_name ? esc(a.school_name) : '✓ Brought'}</span>`, 'is-ready')).join('')}</ul>`;
    const ahead = (p.ahead || []).length ? `<h4 class="kwab-h">Still to learn</h4><ul class="kwab-list">${p.ahead.map(a => rowHtml(a, `<span class="kwab-when">🔒 Level ${esc(a.at)}</span>`, 'is-locked')).join('')}</ul>` : '';
    return `<div class="kwab">${head}${gearHtml(p)}${attack}${own}${ahead}${passiveHtml(study)}${studyHtml(study)}${secondHtml(p, pick)}</div>`;
  }

  // ── The tab on a citizen's page (js/citizens.js) ────────────────────────
  // The button and its panel, or nothing where battles on the board are not open (or for a child).
  const tabHtml = c => (available() && c && c.life_stage !== 'child'
    ? `<button class="cp-tab" data-cp="abilities" onclick="cpSwitchTab(this,'cp-tab-abilities'); KWAbilities.renderTab(${Number(c.id)})">⚔ Abilities</button>` : '');
  const panelHtml = c => (available() && c && c.life_stage !== 'child'
    ? `<div class="cp-tab-panel" id="cp-tab-abilities" style="display:none"><div id="cp-abilities-content">${pageHtml(null)}</div></div>` : '');

  function paint() {
    const el = doc.getElementById('cp-abilities-content');
    if (!el) return;
    el.innerHTML = pageHtml(S.page, S.page ? chosen(S.page) : null, S.study);
    if (S.wired !== el) {
      S.wired = el;
      el.addEventListener('change', ev => {
        const t = ev.target.closest('[data-kwab="toggle"]'), sc = ev.target.closest('[data-kwab="school"]'), pa = ev.target.closest('[data-kwab="passive"]');
        if (t) toggle(t.getAttribute('data-key'), t.checked);
        else if (sc) school(sc.value);
        else if (pa) study('passive', { key: pa.value === 'none' ? null : pa.value }, '⚔ Saved: they carry it into the next battle.');
      });
      el.addEventListener('click', ev => {
        const t = ev.target.closest('[data-kwab="save"]'), st = ev.target.closest('[data-kwab="study"]'), stop = ev.target.closest('[data-kwab="study-stop"]');
        if (t && !t.disabled) save();
        else if (st && !st.disabled) study('', { lesson: st.getAttribute('data-key') }, '📖 The lesson has begun.');
        else if (stop) study('cancel', {}, 'The lesson is stopped and the fee is back.');
      });
    }
  }
  // Another old career is chosen (or none): its first five come ticked, to be changed.
  function school(cls) {
    if (!S.page) return;
    const was = saved(S.page), o = (S.page.second.options || []).find(x => x.cls === cls);
    S.pick = !o ? { cls: 'none', keys: [] } : cls === was.cls ? was : { cls, keys: o.abilities.slice(0, S.page.second.max).map(a => a.key) };
    paint();
    const again = doc.querySelector(`#cp-abilities-content [data-kwab="school"][value="${cls}"]`);
    if (again) again.focus();
  }
  function toggle(key, on) {
    if (!S.page) return;
    const now = chosen(S.page), keys = now.keys.filter(k => k !== key);
    if (on && keys.length < S.page.second.max) keys.push(key);
    S.pick = { cls: now.cls, keys };
    paint();
    // Redrawing moved the keyboard's place: put it back on the box that was ticked.
    const again = doc.querySelector(`#cp-abilities-content [data-kwab="toggle"][data-key="${key}"]`);
    if (again) again.focus();
  }
  async function call(path, body) {
    const res = await global.apiFetch('/api/tactics/abilities/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.error || 'That did not work. Try again.');
    return d;
  }
  // Both halves of the page: what they bring (abilities) and what they can learn (study).
  async function reload(id) {
    const [page, st] = await Promise.all([call(String(id)), studyCall(String(id)).catch(() => null)]);
    if (S.id === id) { S.page = page; S.study = st; }
  }
  async function studyCall(path, body) {
    const res = await global.apiFetch('/api/tactics/study/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.error || 'That did not work. Try again.');
    return d;
  }
  // Begin a lesson, stop it, or choose the passive; then read the page again (a studied ability or a passive changes what they bring).
  async function study(what, body, done) {
    if (S.busy || !S.id) return;
    S.busy = true;
    const id = S.id;
    try {
      await studyCall(id + (what ? '/' + what : ''), body || {});
      await reload(id);
      toast(done);
      try { if (what !== 'passive' && typeof global.refreshResources === 'function') global.refreshResources(); } catch (e) { /* not loaded */ }
    } catch (e) { toast('⚠️ ' + e.message); }
    finally { S.busy = false; paint(); }
  }
  // Counts a lesson down once a second while the tab is on screen, and reads the page again when its time is up.
  function tick() {
    const el = doc.getElementById('cp-abilities-content');
    if (!el || !el.querySelector) { if (S.clock) { clearInterval(S.clock); S.clock = null; } return; }
    const c = el.querySelector('[data-kwab-clock]');
    if (!c) return;
    const t = untilWords(c.getAttribute('data-kwab-clock'));
    c.textContent = t;
    if (t === 'now' && !S.busy && S.id) { const id = S.id; S.busy = true; reload(id).catch(() => {}).then(() => { S.busy = false; paint(); }); }
  }
  // A live event (js/realtime.js): a lesson is finished. Say so, and redraw the tab if it is this citizen's.
  function onEvent(ev) {
    if (!ev || ev.type !== 'study_done') return;
    if (ev.message) toast(ev.message);
    if (S.id && Number(ev.citizen_id) === Number(S.id) && doc.getElementById('cp-abilities-content')) reload(S.id).then(paint).catch(() => {});
  }
  async function renderTab(id) {
    if (S.id !== id) { S.id = id; S.page = null; S.study = null; S.pick = null; }
    paint();
    try {
      if (T().loadAssets) await T().loadAssets();      // the pictures, before the list is drawn
      await reload(id);
    } catch (e) { const el = doc.getElementById('cp-abilities-content'); if (el) el.innerHTML = `<p class="kwab-note">⚠️ ${esc(e.message)}</p>`; return; }
    if (S.id === id) paint();
    if (!S.clock && typeof setInterval === 'function') S.clock = setInterval(tick, 1000);
  }
  async function save() {
    if (S.busy || !S.page || !S.pick) return;
    S.busy = true;
    try { S.page = await call(S.id + '/second', { cls: S.pick.cls, keys: S.pick.keys }); S.pick = null; toast('⚔ Saved: these go into the next battle.'); }
    catch (e) { toast('⚠️ ' + e.message); }
    finally { S.busy = false; paint(); }
  }

  global.KWAbilities = { available, tabHtml, panelHtml, renderTab, _pageHtml: pageHtml, _rowHtml: rowHtml, _secondHtml: secondHtml, _masteryHtml: masteryHtml, _gearHtml: gearHtml, _studyHtml: studyHtml, _passiveHtml: passiveHtml, _untilWords: untilWords, onEvent, _pace: pace, _state: S, _toggle: toggle, _school: school, _save: save };
})(typeof window !== 'undefined' ? window : globalThis);
