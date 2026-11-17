// ══════════════════════════════════════════════════════════════════════════
//  KWSocial — Talk to… and Praise (docs/HOME_SCENE.md Part F, F.1 and F.2).
//
//  Talk to…: the player sends one villager to talk to another about a topic,
//  or about anything. The server rolls whether they get along (it knows what
//  each likes and finds dull) and moves their bond: +3, or −2. A villager can
//  be sent once a day. What a villager likes is learned through chats: only
//  topics a chat has touched are shown.
//
//  Praise: a little happiness, three villagers a day, each at most once.
//
//  Both are counted on the server (lib/social.js), so a second device shows
//  the same day and gains nothing. This file is the picker window, the
//  buttons' state, the lines in a villager's profile, and the hand-off to the
//  scene (KWCast.playTalk / playPraise), which plays out what happened.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const first = n => String(n || 'Villager').split(' ')[0];
  const S = { data: null, loading: null, busy: false };
  const ANY = { key: 'anything', label: 'Anything', icon: '✨' };
  const STATE_LABEL = { partners: 'Partners', bonded: 'Bonded', close: 'Close', friends: 'Friends', acquaintances: 'Acquaintances', strangers: 'Strangers' };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  const parentsOf = c => { const p = c && c.parent_ids; return (Array.isArray(p) ? p : typeof p === 'string' ? (() => { try { return JSON.parse(p); } catch (_) { return []; } })() : []).map(Number); };
  // Family: parent and child, or sharing a parent. They can be friends, never partners.
  function kin(a, b) {
    const pa = parentsOf(a), pb = parentsOf(b);
    return pa.includes(Number(b.id)) || pb.includes(Number(a.id)) || pa.some(p => pb.includes(p));
  }
  // What the buttons show for a villager today. `data`: GET /api/social (or
  // null before it has loaded); past the reset time it is a new day.
  function menuState(data, id, now) {
    if (!data) return { talked: false, praised: false, praiseLeft: 0, perDay: 0, ready: false };
    if (now >= data.resets_at) return { talked: false, praised: false, praiseLeft: data.praise_per_day, perDay: data.praise_per_day, ready: true, stale: true };
    return { talked: data.talked.includes(Number(id)), praised: data.praised.includes(Number(id)), praiseLeft: data.praise_left, perDay: data.praise_per_day, ready: true };
  }
  // "in 3 h 20 min", "in 12 min", "in a moment".
  function untilLine(ms) {
    const m = Math.ceil(ms / 60000);
    if (m <= 1) return 'in a moment';
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `in ${h} h ${r} min` : `in ${h} h`;
  }
  // How someone is known to feel about a topic: 'likes', 'dull', 'fine' or
  // null (no chat has touched it yet). `k`: their entry in data.known.
  function feeling(k, topic) {
    if (!k) return null;
    return (k.likes || []).includes(topic) ? 'likes' : k.dull === topic ? 'dull' : (k.fine || []).includes(topic) ? 'fine' : null;
  }
  // The small line on a topic button, and its tone ('good', 'bad' or '').
  function topicNote(topic, speaker, listener, known) {
    const fs = feeling(known[speaker.id], topic), fl = feeling(known[listener.id], topic);
    const a = first(speaker.name), b = first(listener.name);
    const likes = [fs === 'likes' && a, fl === 'likes' && b].filter(Boolean), dull = [fs === 'dull' && a, fl === 'dull' && b].filter(Boolean);
    const parts = [];
    if (likes.length) parts.push('♥ ' + likes.join(', '));
    if (dull.length) parts.push('💤 ' + dull.join(', '));
    if (!parts.length && fs === 'fine' && fl === 'fine') parts.push('Neither minds');
    return { text: parts.join(' · '), tone: dull.length ? 'bad' : likes.length ? 'good' : '' };
  }
  // What a chat taught the player: lines for anything newly known.
  function learnedLines(before, after, people, label) {
    const out = [];
    for (const p of people) {
      const was = before[p.id] || { likes: [], dull: null }, now = after[p.id] || { likes: [], dull: null };
      for (const t of now.likes || []) if (!(was.likes || []).includes(t)) out.push(`${first(p.name)} likes ${label(t).toLowerCase()}.`);
      if (now.dull && now.dull !== was.dull) out.push(`${first(p.name)} finds ${label(now.dull).toLowerCase()} dull.`);
    }
    return out;
  }
  // "Poppy and Hazel got along talking about fishing. Bond +3 (friends)."
  function outcomeLine(chat) {
    const a = first(chat.speaker.name), b = first(chat.listener.name), about = String(chat.topic_label || chat.topic).toLowerCase();
    const d = chat.delta > 0 ? '+' + chat.delta : chat.delta < 0 ? '−' + Math.abs(chat.delta) : 'unchanged';
    return chat.got_along ? `${a} and ${b} got along talking about ${about}. Bond ${d} (${String(chat.bond_state || '').toLowerCase()}).`
      : `${a} and ${b} did not get along talking about ${about}. Bond ${d}.`;
  }
  // Who a villager can be sent to: everyone living and in town but
  // themselves, the closest first.
  function people(cits, speakerId, bonds, away = () => null) {
    const me = cits.find(c => Number(c.id) === Number(speakerId));
    return cits.filter(c => c && Number(c.id) !== Number(speakerId) && c.life_stage !== 'deceased' && c.stage !== 'deceased' && !away(c))
      .map(c => { const b = bonds[c.id] || { score: 0, state: 'strangers' }; return { c, score: b.score, state: b.state, partner: !!me && Number(me.partner_id) === Number(c.id), kin: !!me && kin(me, c) }; })
      .sort((x, y) => y.score - x.score || String(x.c.name).localeCompare(String(y.c.name)));
  }

  // ── Data ────────────────────────────────────────────────────────────────
  const cits = () => { const d = typeof citizensData !== 'undefined' ? citizensData : global.citizensData; return Array.isArray(d) ? d : []; };   // eslint-disable-line no-undef
  const byId = id => cits().find(c => Number(c.id) === Number(id));
  const away = c => (typeof global.citizenAway === 'function' ? global.citizenAway(c) : null);
  const clock = () => (global.KWClock && global.KWClock.now ? global.KWClock.now() : Date.now());
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const topics = () => (S.data && S.data.topics) || [];
  const topic = k => (k === ANY.key ? ANY : topics().find(t => t.key === k) || { key: k, label: k, icon: '💬' });
  const label = k => topic(k).label;
  const signedIn = () => { try { return !!global.localStorage.getItem('kw_token'); } catch (_) { return false; } };

  async function load(force) {
    if (!signedIn() || typeof global.apiFetch !== 'function') return null;
    if (S.loading && !force) return S.loading;
    S.loading = (async () => {
      try {
        const r = await global.apiFetch('/api/social');
        if (r.ok) { const d = await r.json(); if (d && d.ok) { S.data = d; changed(); } }
      } catch (_) { /* later */ }
      S.loading = null;
      return S.data;
    })();
    return S.loading;
  }
  function forMenu(id) {
    const m = menuState(S.data, id, clock());
    if (!m.ready || m.stale) load(true);
    return m;
  }
  async function send(path, body) {
    const r = await global.apiFetch('/api/social' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { if (!d.paused) toast('⚠️ ' + (d.error || 'That did not work. Try again.')); if (r.status === 409) load(true); return null; }
    return d;
  }
  // The day changed (here or on another device): the open profile's lines follow.
  function changed() {
    const box = doc && doc.getElementById('kws-profile');
    if (box) { const id = Number(box.getAttribute('data-id')); const c = byId(id); if (c) box.outerHTML = profileHtml(c); }
  }

  // ── Why a greyed button is grey ─────────────────────────────────────────
  function why(key, id) {
    const m = menuState(S.data, id, clock()), c = byId(id) || {}, when = S.data ? untilLine(S.data.resets_at - clock()) : 'tomorrow';
    if (key === 'talk') return `${first(c.name)} has had a chat today. They can be sent again at dawn (${when}).`;
    if (m.praised) return `${first(c.name)} has been praised today.`;
    return `You have praised ${m.perDay} villagers today. More at dawn (${when}).`;
  }

  // ── Praise ──────────────────────────────────────────────────────────────
  async function praise(id) {
    const m = menuState(S.data, id, clock());
    if (m.ready && !m.stale && (m.praised || m.praiseLeft <= 0)) { toast('👏 ' + why('praise', id)); return false; }
    if (S.busy) return false;
    S.busy = true;
    const d = await send('/praise', { citizen_id: Number(id) }).catch(() => null);
    S.busy = false;
    if (!d) return false;
    S.data = d.social; changed();
    const c = byId(id);
    if (c && c.life && typeof c.life.happiness === 'number') c.life.happiness = Math.min(100, c.life.happiness + d.praise.happiness);
    if (global.KWCast && global.KWCast.playPraise) global.KWCast.playPraise(id, d.praise.happiness);
    const left = d.praise.praise_left;
    toast(`👏 You praised ${first(d.praise.citizen.name)}. They are a little happier. ${left ? left + ' left today.' : 'That was the last for today.'}`);
    return true;
  }

  // ── Talk to…: who, then what about ──────────────────────────────────────
  async function openTalk(speakerId) {
    const W = global.KWWindow, me = byId(speakerId);
    if (!W || !me) return;
    if (!S.data) await load();
    if (!S.data) { toast('⚠️ Could not reach the town. Try again.'); return; }
    if (menuState(S.data, speakerId, clock()).talked) { toast('💬 ' + why('talk', speakerId)); return; }
    let bonds = {};
    try { const r = await global.apiFetch('/api/social/bonds/' + Number(speakerId)); const d = await r.json(); if (d && d.ok) bonds = d.bonds || {}; } catch (_) { /* shown as strangers */ }
    W.close('talk');
    W.open({
      id: 'talk', icon: '💬', size: 'M', title: `${first(me.name)} talks to…`, state: { speaker: Number(speakerId), listener: null, bonds },
      render(body, st, w) {
        const sp = byId(st.speaker);
        if (!sp) { body.innerHTML = '<p class="kws-none">They have left town.</p>'; return; }
        const li = st.listener != null ? byId(st.listener) : null;
        if (!li) { w.setTitle(`${first(sp.name)} talks to…`, 'Choose who. One chat a day each.'); body.innerHTML = whoHtml(sp, st.bonds); }
        else { w.setTitle(`${first(sp.name)} and ${first(li.name)}`, 'Choose what they talk about.'); body.innerHTML = topicHtml(sp, li, st.bonds); }
      },
      actions: {
        who(el, ev, w) { w.state.listener = Number(el.dataset.id); redraw(w); },
        back(el, ev, w) { w.state.listener = null; redraw(w); },
        async topic(el, ev, w) {
          if (S.busy) return;
          S.busy = true;
          w.body.querySelectorAll('button').forEach(b => { b.disabled = true; });
          const before = (S.data && S.data.known) || {};
          const d = await send('/talk', { speaker_id: w.state.speaker, listener_id: w.state.listener, topic: el.dataset.topic === ANY.key ? null : el.dataset.topic }).catch(() => null);
          S.busy = false;
          if (!d) { if (global.KWWindow.isOpen('talk')) redraw(w); return; }
          S.data = d.social;
          global.KWWindow.close('talk');
          played(d.chat, before);
          changed();
        },
      },
    });
  }
  // Draws the window again, from the top (a new step).
  function redraw(w) { try { w.refresh(); if (w.body) w.body.scrollTop = 0; } catch (_) { /* closed */ } }
  const face = (c, size) => (global.KWVillagers && global.KWVillagers.faceHtml ? global.KWVillagers.faceHtml(c.species || (global.gameData && global.gameData.species) || 'Mice', size) : '');
  const roleOf = c => (c.life_stage === 'child' && c.stage !== 'youth' ? 'child' : c.stage === 'youth' ? 'youth' : String(c.role || 'villager').replace(/_/g, ' '));
  // The pictures of what is known about someone: likes, then the dull one.
  function knownIcons(id) {
    const k = S.data && S.data.known[id];
    if (!k || !((k.likes || []).length || k.dull)) return '';
    return '<span class="kws-known">' + (k.likes || []).map(t => `<span title="Likes ${esc(label(t).toLowerCase())}">${topic(t).icon}</span>`).join('')
      + (k.dull ? `<span class="kws-dull" title="Finds ${esc(label(k.dull).toLowerCase())} dull">${topic(k.dull).icon}</span>` : '') + '</span>';
  }
  function whoHtml(sp, bonds) {
    const list = people(cits(), sp.id, bonds, away);
    if (!list.length) return '<p class="kws-none">There is nobody else in town to talk to.</p>';
    return '<ul class="kws-people">' + list.map(p => `<li><button type="button" class="kws-person" data-action="who" data-id="${p.c.id}">`
      + face(p.c, 36)
      + `<span class="kws-ptext"><b>${esc(p.c.name)}${p.partner ? ' 💕' : ''}</b>`
      + `<span>${esc(roleOf(p.c))} · ${p.partner ? 'Partners' : STATE_LABEL[p.state] || 'Strangers'}${p.score > 0 ? ' ' + Math.round(p.score) + '%' : ''}${p.kin ? ' · family' : ''}</span></span>`
      + knownIcons(p.c.id) + '</button></li>').join('') + '</ul>';
  }
  function knownLine(c) {
    const k = S.data && S.data.known[c.id];
    const likes = k ? (k.likes || []).map(t => `${topic(t).icon} ${esc(label(t))}`) : [];
    const bits = [];
    if (likes.length) bits.push('likes ' + likes.join(', '));
    if (k && k.dull) bits.push(`finds ${topic(k.dull).icon} ${esc(label(k.dull))} dull`);
    return `<b>${esc(first(c.name))}</b> ${bits.length ? bits.join('; ') : 'nothing known yet'}`;
  }
  function topicHtml(sp, li, bonds) {
    const b = bonds[li.id] || { score: 0, state: 'strangers' };
    const partner = Number(sp.partner_id) === Number(li.id);
    const list = [ANY].concat(topics());
    return `<button type="button" class="kws-back" data-action="back">‹ Someone else</button>`
      + `<p class="kws-bond">They are <b>${partner ? 'partners' : (STATE_LABEL[b.state] || 'Strangers').toLowerCase()}</b>${b.score > 0 ? ` (${Math.round(b.score)}%)` : ''}.`
      + `${kin(sp, li) ? ' They are family: they can grow close, but will never be partners.' : ''}</p>`
      + `<p class="kws-knows">${knownLine(sp)}<br>${knownLine(li)}</p>`
      + '<div class="kws-topics">' + list.map(t => {
        const n = t.key === ANY.key ? { text: 'A surprise', tone: '' } : topicNote(t.key, sp, li, S.data.known);
        return `<button type="button" class="kws-topic${n.tone ? ' kws-' + n.tone : ''}" data-action="topic" data-topic="${esc(t.key)}">`
          + `<span class="kws-ti" aria-hidden="true">${t.icon}</span><span class="kws-tl">${esc(t.label)}</span><span class="kws-tn">${esc(n.text)}</span></button>`;
      }).join('') + '</div>'
      + '<p class="kws-hint">A topic the listener likes helps most; one they find dull hurts most. What they like is learned by talking.</p>';
  }
  // A chat happened here: the scene plays it out, then the line is told.
  function played(chat, before) {
    const lines = learnedLines(before || {}, (S.data && S.data.known) || {}, [chat.speaker, chat.listener], label);
    const tell = () => toast(`${chat.got_along ? '💗' : '🌩️'} ${outcomeLine(chat)}${lines.length ? ' ' + lines.join(' ') : ''}`);
    const C = global.KWCast;
    const playing = !!(C && C.playTalk && C.playTalk({ speaker: chat.speaker.id, listener: chat.listener.id, icon: chat.icon || topic(chat.topic).icon,
      good: chat.got_along, delta: chat.delta, speakerFelt: chat.speaker.felt, listenerFelt: chat.listener.felt }, tell));
    if (!playing) tell();
  }

  // ── In a villager's profile (Relationships) ─────────────────────────────
  function profileHtml(c) {
    const id = Number(c.id), m = menuState(S.data, id, clock());
    if (!S.data) { load(); return `<div id="kws-profile" class="kws-profile" data-id="${id}"></div>`; }
    const gone = c.life_stage === 'deceased' || c.stage === 'deceased', off = !!away(c);
    const today = S.data.chats_today.filter(ch => ch.speaker_id === id || ch.listener_id === id).map(ch => {
      const other = byId(ch.speaker_id === id ? ch.listener_id : ch.speaker_id);
      return `<li>${ch.got_along ? '💗' : '🌩️'} ${ch.speaker_id === id ? 'Talked to' : 'Heard from'} ${esc(first(other && other.name))} about ${topic(ch.topic).icon} ${esc(label(ch.topic).toLowerCase())}: `
        + `${ch.got_along ? 'they got along' : 'it went badly'}${ch.delta ? ` (bond ${ch.delta > 0 ? '+' : '−'}${Math.abs(ch.delta)})` : ''}.</li>`;
    });
    const k = S.data.known[id];
    const likes = k ? (k.likes || []) : [], fine = k ? (k.fine || []) : [];
    const chip = (t, cls) => `<span class="kws-chip${cls ? ' ' + cls : ''}">${topic(t).icon} ${esc(label(t))}</span>`;
    return `<div id="kws-profile" class="kws-profile" data-id="${id}">`
      + '<div class="cp-section-label">Likes to talk about</div>'
      + (likes.length || (k && k.dull) || fine.length
        ? '<div class="kws-chips">' + likes.map(t => chip(t, 'kws-like')).join('') + (k.dull ? `<span class="kws-chip kws-dullchip">💤 ${topic(k.dull).icon} ${esc(label(k.dull))}</span>` : '')
          + fine.map(t => chip(t, 'kws-finechip')).join('') + '</div>'
          + `<div class="kws-legend">${likes.length} of 3 likes found${k.dull ? ', and the topic they find dull' : ''}.${fine.length ? ' Faded: tried, neither liked nor dull.' : ''}</div>`
        : '<div class="kws-legend">Nothing known yet. Send them to talk to someone and you will learn what they like.</div>')
      + (today.length ? `<ul class="kws-today">${today.join('')}</ul>` : '')
      + (gone || off ? '' : '<div class="kws-acts">'
        + `<button type="button" class="kws-btn" data-kws="talk" data-id="${id}"${m.talked ? ' aria-disabled="true"' : ''}>💬 ${m.talked ? 'Has had a chat today' : 'Talk to…'}</button>`
        + `<button type="button" class="kws-btn" data-kws="praise" data-id="${id}"${m.praised || m.praiseLeft <= 0 ? ' aria-disabled="true"' : ''}>👏 ${m.praised ? 'Praised today' : `Praise (${m.praiseLeft} left)`}</button>`
        + '</div>')
      + '</div>';
  }

  if (doc) {
    doc.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-kws]');
      if (!b) return;
      const key = b.getAttribute('data-kws'), id = Number(b.getAttribute('data-id'));
      if (b.getAttribute('aria-disabled') === 'true') { toast((key === 'talk' ? '💬 ' : '👏 ') + why(key, id)); return; }
      if (key === 'talk') openTalk(id); else if (key === 'praise') praise(id);
    });
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) load(true); });
  }

  global.KWSocial = {
    load, forMenu, why, praise, openTalk, profileHtml,
    // From the live stream: it happened (here, or on another device).
    onEvent() { load(true); },
    get data() { return S.data; },
    topic,
    _kin: kin, _menuState: menuState, _untilLine: untilLine, _feeling: feeling, _topicNote: topicNote, _learnedLines: learnedLines, _outcomeLine: outcomeLine, _people: people,
    _set: d => { S.data = d; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
