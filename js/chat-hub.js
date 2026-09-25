// ══════════════════════════════════════════════════════════════════════════
//  CHAT HUB — clan forum + live chat (spec 016 §7, Phase 4)
//
//  Opened from the Chat comm-btn. Left: channel list — "Town Square" (the
//  realm's boards — Announcements, General, Trade, Help, … — and Realm Chat,
//  open to everyone) and your clan's hall with Forum and Live tabs. Right: the open view. On phones (body.kw-shell) it
//  is one full-screen column: the list, then a pushed view with a back
//  button. #chat-hub is registered in mobile-shell watchOverlays().
//
//  Server: /api/chat/*. Locked tabs (forum < clan level 2, live < level 4)
//  stay visible with a progress bar. Live chat keeps a persisted backlog;
//  reconnects and tab-resumes fetch ?after=<lastId> to fill the gap.
//  Unread = last seen message id per channel in localStorage (per device).
//
//  Moderation: anyone can ⚑ report someone else's line or post. Site staff
//  (admins + moderators) see a Moderation section — the report queue, mutes,
//  the action log and (admins) the moderator list — and MOD/ADMIN badges
//  mark staff authors. Muted players read the realm channels but the
//  composer tells them when they can post again.
//
//  Depends on: apiFetch, escHtml, ClanPalette, showBuildToast (optional).
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const esc = s => (typeof global.escHtml === 'function' ? global.escHtml(s) : String(s ?? ''));
  const P = () => global.ClanPalette;
  const LIMIT = { title: 80, post: 2000, chat: 500 };

  const st = {
    channels: null,          // from /api/chat/channels (clan hall first, then realm)
    channelId: null,         // the open channel
    view: 'home',            // home | forum | thread | compose | live
    threads: [], threadsMore: false,
    thread: null, posts: [], postsMore: false, editing: null,
    messages: [], moreOlder: false, stick: true, newBelow: 0,
    busy: false,
    myName: null,
    // Moderation
    staff: null, admin: false, muted: null, openReports: 0,
    reporting: null,           // { type, id, author, body } while the report sheet is open
    modReports: [], modFilter: 'open', mutes: [], modLog: [], staffList: [],
  };

  function toast(m, t) { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); }
  async function call(method, path, body) {
    const res = await global.apiFetch(path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let d = {}; try { d = await res.json(); } catch (_) {}
    if (!res.ok) { const e = new Error(d.error || 'Something went wrong.'); e.data = d; e.status = res.status; throw e; }
    return d;
  }
  const byId = id => document.getElementById(id);
  const channel = () => (st.channels && st.channels.find(c => c.id === st.channelId)) || null;
  const clanHall = () => (st.channels && st.channels.find(c => c.kind === 'clan')) || null;
  const realm = () => (st.channels || []).filter(c => c.kind === 'global');
  const realmChat = () => realm().find(c => c.features === 'chat') || null;
  // Board "seen" = newest last_post_at viewed, per device.
  const boardKey = id => 'kw_board_seen_' + id;
  function boardSeen(id) { try { return parseInt(localStorage.getItem(boardKey(id)), 10) || 0; } catch (_) { return 0; } }
  function markBoardSeen(ch) {
    if (!ch || !ch.last_post_at) return;
    try { localStorage.setItem(boardKey(ch.id), String(new Date(ch.last_post_at).getTime())); } catch (_) {}
  }
  const boardUnread = ch => !!(ch && ch.last_post_at && new Date(ch.last_post_at).getTime() > boardSeen(ch.id));
  const chatUnread = ch => !!(ch && ch.chat.unlocked && (ch.last_message_id || 0) > getSeen(ch.id));
  const isGlobal = ch => !!ch && ch.kind === 'global';
  const seenKey = id => 'kw_chat_seen_' + id;
  function getSeen(id) { try { return parseInt(localStorage.getItem(seenKey(id)), 10) || 0; } catch (_) { return 0; } }
  function setSeen(id, v) { try { if (v > getSeen(id)) localStorage.setItem(seenKey(id), String(v)); } catch (_) {} }
  function myName() {
    if (st.myName) return st.myName;
    try { st.myName = (typeof gameData !== 'undefined' && gameData && gameData.username) || null; } catch (_) {}
    return st.myName;
  }
  function timeLabel(ts) {
    const d = new Date(ts), s = (Date.now() - d) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString();
  }

  // ── Scaffold ────────────────────────────────────────────────────────────
  function el() {
    let root = byId('chat-hub');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'chat-hub';
    root.className = 'chat-backdrop';
    root.innerHTML = `
      <div class="chat-card" role="dialog" aria-modal="true" aria-label="Chat">
        <aside class="chat-side" id="chat-side"></aside>
        <section class="chat-main" id="chat-main"></section>
        <button class="chat-close" type="button" aria-label="Close" data-act="close">✕</button>
      </div>`;
    root.addEventListener('click', e => { if (e.target === root) closeChatHub(); });
    root.addEventListener('click', onAction);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    return root;
  }
  const isOpen = () => { const r = byId('chat-hub'); return !!r && r.classList.contains('open'); };

  // openChatHub()               → Realm Chat on wide screens, the list on phones
  // openChatHub('forum' | 'live') → your clan hall's tab
  async function openChatHub(tab, channelId) {
    el().classList.add('open');
    document.querySelectorAll('.comm-btn').forEach(b => b.classList.remove('active'));
    await loadChannels();
    const hall = clanHall();
    if (channelId) { await go(tab || 'forum', channelId); return; }
    if (tab && hall) { await go(tab, hall.id); return; }
    const rc = realmChat();
    if (rc && !isNarrow()) await go('live', rc.id);
    else { st.view = 'home'; render(); }
  }
  function closeChatHub() { const r = byId('chat-hub'); if (r) r.classList.remove('open'); }
  const isNarrow = () => document.body.classList.contains('kw-shell') || window.innerWidth < 760;

  async function loadChannels() {
    try {
      const d = await call('GET', '/api/chat/channels');
      st.channels = d.channels;
      st.staff = d.staff || null; st.admin = !!d.admin;
      st.muted = d.muted || null; st.openReports = d.open_reports || 0;
      if (!st.staff && isModView(st.view)) st.view = 'home';
    } catch (e) { st.channels = []; }
    updateBadge();
  }
  const isModView = v => /^mod-/.test(v || '');
  // Muted (realm channels only) and the mute hasn't lapsed yet.
  function mutedHere(ch) {
    if (!isGlobal(ch) || !st.muted) return false;
    if (st.muted.until && new Date(st.muted.until) <= new Date()) { st.muted = null; return false; }
    return true;
  }
  function mutedText() {
    return st.muted && st.muted.until
      ? `You're muted in the Town Square until ${new Date(st.muted.until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. You can still read.`
      : "You're muted in the Town Square until a moderator lifts it. You can still read.";
  }

  async function go(view, channelId) {
    if (channelId) {
      if (channelId !== st.channelId) { st.messages = []; st.threads = []; st.thread = null; st.stick = true; }
      st.channelId = channelId;
    }
    st.view = view;
    st.editing = null;
    if (isModView(view)) st.channelId = null;
    if (view === 'forum') await loadThreads();
    if (view === 'live') await loadMessages();
    if (isModView(view)) await loadMod(view);
    render();
    if (view === 'live') { scrollToBottom(true); focusComposer(); }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function render() {
    if (!isOpen()) return;
    const root = byId('chat-hub');
    root.classList.toggle('chat-pushed', st.view !== 'home');
    byId('chat-side').innerHTML = sideHtml();
    byId('chat-main').innerHTML = mainHtml() + (st.reporting ? reportSheetHtml() : '');
    wireLiveScroll();
  }

  function sideHtml() {
    const hall = clanHall();
    let clan;
    if (!st.channels) clan = '<div class="chat-muted">Loading…</div>';
    else if (!hall) clan = `<div class="chat-muted">Join or found a clan to open a private clan hall.</div>
        <button type="button" class="chat-btn ghost small" data-act="open-clan">🛡️ Clan panel</button>`;
    else {
      clan = `
        <div class="chat-clan-name">${esc(hall.banner.glyph)} ${esc(hall.name)}</div>
        ${tabBtn(hall, 'forum', '📜 Forum', hall.forum)}
        ${tabBtn(hall, 'live', '💬 Live chat', hall.chat, chatUnread(hall))}`;
    }
    const rc = realmChat();
    const boards = realm().filter(c => c.features !== 'chat');
    const square = !st.channels ? '<div class="chat-muted">Loading…</div>' : `
        ${rc ? tabBtn(rc, 'live', `${esc(rc.icon)} ${esc(rc.name)}`, { unlocked: true }, false) : ''}
        ${boards.map(b => tabBtn(b, 'forum', `${esc(b.icon)} ${esc(b.name)}`, { unlocked: true }, boardUnread(b), b.description)).join('')}`;
    return `
      <div class="chat-side-title">Chat</div>
      <div class="chat-sec">
        <div class="chat-sec-label">Town Square</div>
        ${square}
      </div>
      <div class="chat-sec">
        <div class="chat-sec-label">Clan hall</div>
        ${clan}
      </div>${st.staff ? modSideHtml() : ''}`;
  }

  function modSideHtml() {
    const b = (view, label, extra) => {
      const on = st.view === view;
      return `<button type="button" class="chat-tab${on ? ' on' : ''}" data-act="go" data-view="${view}"><span>${label}</span>${extra || ''}</button>`;
    };
    return `<div class="chat-sec">
        <div class="chat-sec-label">Moderation <span class="chat-staff-badge ${st.staff}">${st.staff === 'admin' ? 'Admin' : 'Mod'}</span></div>
        ${b('mod-reports', '⚑ Reports', st.openReports ? `<span class="chat-count">${st.openReports}</span>` : '')}
        ${b('mod-mutes', '🔇 Mutes')}
        ${b('mod-log', '📋 Action log')}
        ${st.admin ? b('mod-staff', '🛡 Moderators') : ''}
      </div>`;
  }

  function tabBtn(ch, view, label, gate, dot, title) {
    const here = st.channelId === ch.id;
    const on = here && (st.view === view || (view === 'forum' && (st.view === 'thread' || st.view === 'compose')));
    return `<button type="button" class="chat-tab${on ? ' on' : ''}${gate.unlocked ? '' : ' locked'}" data-act="go" data-view="${view}" data-channel="${ch.id}"${title ? ` title="${esc(title)}"` : ''}>
      <span>${label}</span>${gate.unlocked ? (dot ? '<span class="chat-dot"></span>' : '') : `<span class="chat-lock">🔒 L${gate.unlock_level}</span>`}</button>`;
  }

  // Header title for the open channel's view.
  function chTitle(ch, view) {
    if (isGlobal(ch)) return `${esc(ch.icon)} ${esc(ch.name)}`;
    return view === 'live' ? '💬 Live chat' : '📜 Forum';
  }
  // Small clan tag after an author's name in realm channels.
  // MOD / ADMIN badge after a staff author's name (every channel).
  function staffBadge(role) {
    return role ? `<span class="chat-staff-badge ${esc(role)}" title="Kindlewood ${role === 'admin' ? 'admin' : 'moderator'}">${role === 'admin' ? 'Admin' : 'Mod'}</span>` : '';
  }
  // ⚑ Report on someone else's (non-system) line/post.
  function reportBtn(type, item) {
    if (!item.author || item.author === myName() || item.system) return '';
    return `<button type="button" class="chat-link chat-report" data-act="report" data-type="${type}" data-id="${item.id}" title="Report to the moderators" aria-label="Report">⚑</button>`;
  }
  function clanTag(ac) {
    if (!ac || !isGlobal(channel())) return '';
    return `<span class="chat-clan-tag" style="--c:${esc(ac.primary)}" title="${esc(ac.name)}">${esc(ac.glyph)} ${esc(ac.name)}</span>`;
  }

  function lockedHtml(what, gate) {
    const ch = clanHall();
    const need = gate.unlock_level;
    const target = (P().levelRow(need) || {}).lifetime || 0;
    return `<div class="chat-locked">
      <div class="chat-locked-ic">🔒</div>
      <div class="chat-locked-title">${what} unlocks at clan level ${need}</div>
      <div class="chat-muted">Your clan is level ${ch.level} · ${ch.prestige_lifetime.toLocaleString()} / ${target.toLocaleString()} lifetime prestige.</div>
      <div class="chat-bar"><span style="width:${Math.max(3, Math.min(100, Math.round(100 * ch.prestige_lifetime / Math.max(1, target))))}%"></span></div>
      <div class="chat-muted">Quests, battles, outposts and settlement upgrades by any member earn prestige.</div>
    </div>`;
  }

  function header(title, back, extra) {
    return `<header class="chat-head">
      ${back ? `<button type="button" class="chat-back" data-act="go" data-view="${back}" aria-label="Back">‹</button>` : ''}
      <div class="chat-head-title">${title}</div>${extra || ''}</header>`;
  }

  function mainHtml() {
    const ch = channel();
    if (isModView(st.view) && st.staff) return modHtml();
    if (st.view === 'home' || !ch) {
      return header('Chat') + `<div class="chat-empty">Pick a board or chat from the list — the Town Square is open to everyone${
        clanHall() ? ', and your clan hall is just for your clan' : ''}.</div>`;
    }
    if (st.view === 'forum') return ch.forum.unlocked ? forumHtml() : header('Forum', 'home') + lockedHtml('The clan forum', ch.forum);
    if (st.view === 'thread') return threadHtml();
    if (st.view === 'compose') return composeHtml();
    if (st.view === 'live') return ch.chat.unlocked ? liveHtml() : header('Live chat', 'home') + lockedHtml('Clan live chat', ch.chat);
    return '';
  }

  // ── Forum ───────────────────────────────────────────────────────────────
  async function loadThreads(more) {
    const ch = channel();
    if (!ch || !ch.forum.unlocked) return;
    try {
      const last = more && st.threads.filter(t => !t.pinned).slice(-1)[0];
      const d = await call('GET', `/api/chat/channels/${ch.id}/threads${last ? `?before=${encodeURIComponent(last.last_post_at)}` : ''}`);
      st.threads = more ? st.threads.concat(d.threads) : d.threads;
      st.threadsMore = d.more;
      if (!more) {
        const newest = d.threads.reduce((mx, t) => Math.max(mx, new Date(t.last_post_at).getTime()), 0);
        if (newest && (!ch.last_post_at || newest > new Date(ch.last_post_at).getTime())) ch.last_post_at = new Date(newest).toISOString();
        markBoardSeen(ch); updateBadge();
      }
    } catch (e) { handleErr(e); }
  }

  function forumHtml() {
    const ch = channel();
    const newBtn = mutedHere(ch) ? '<span class="chat-muted small">🔇 Muted</span>'
      : ch.permissions.post_forum ? '<button type="button" class="chat-btn small" data-act="compose">✎ New thread</button>'
      : `<span class="chat-muted small">${isGlobal(ch) ? 'Posted by the Kindlewood team' : 'Recruits can read; posting opens at Member.'}</span>`;
    const rows = st.threads.length ? st.threads.map(t => `
      <li><button type="button" class="chat-thread" data-act="thread" data-id="${t.id}">
        <span class="chat-thread-title">${t.pinned ? '📌 ' : ''}${esc(t.title)}</span>
        <span class="chat-muted small">${esc(t.author || 'someone')}${clanTag(t.author_clan)} · ${t.reply_count} ${t.reply_count === 1 ? 'reply' : 'replies'} · ${esc(timeLabel(t.last_post_at))}</span>
      </button></li>`).join('') : '<li class="chat-empty">No threads yet — start the first one.</li>';
    const about = isGlobal(ch) && ch.description ? `<div class="chat-about">${esc(ch.description)}</div>` : '';
    return header(chTitle(ch, 'forum'), 'home', newBtn) + about + `<div class="chat-scroll"><ul class="chat-threads">${rows}</ul>
      ${st.threadsMore ? '<button type="button" class="chat-btn ghost block" data-act="threads-more">Older threads</button>' : ''}</div>`;
  }

  async function openThread(id, more) {
    try {
      const after = more && st.posts.length ? st.posts[st.posts.length - 1].id : 0;
      const d = await call('GET', `/api/chat/threads/${id}/posts${after ? `?after=${after}` : ''}`);
      st.thread = d.thread;
      st.posts = more ? st.posts.concat(d.posts) : d.posts;
      st.postsMore = d.more;
      st.view = 'thread';
      render();
    } catch (e) { handleErr(e); }
  }

  function threadHtml() {
    const ch = channel(), t = st.thread;
    if (!t) return '';
    const me = myName();
    const mod = ch.permissions.moderate;
    const canDeleteThread = mod || (t.author === me && t.reply_count === 0);
    const tools = [
      ch.permissions.pin_forum ? `<button type="button" class="chat-btn ghost small" data-act="pin" data-pinned="${t.pinned ? 0 : 1}">${t.pinned ? 'Unpin' : '📌 Pin'}</button>` : '',
      canDeleteThread ? '<button type="button" class="chat-btn danger small" data-act="del-thread">Delete</button>' : '',
    ].join('');
    const posts = st.posts.map(p => {
      const mine = p.author === me;
      const editing = st.editing === p.id;
      const actions = (mine || mod) && !editing && !(mine && mutedHere(ch)) ? `<span class="chat-post-actions">
          <button type="button" class="chat-link" data-act="edit" data-id="${p.id}">Edit</button>
          ${p.id !== t.first_post_id ? `<button type="button" class="chat-link danger" data-act="del-post" data-id="${p.id}">Delete</button>` : ''}
        </span>` : '';
      return `<article class="chat-post${p.id === t.first_post_id ? ' first' : ''}">
        <div class="chat-post-meta"><b>${esc(p.author || 'someone')}</b>${staffBadge(p.author_staff)}${clanTag(p.author_clan)} <span class="chat-muted small">${esc(timeLabel(p.created_at))}${p.edited_at ? ' · edited' : ''}</span>${actions}${editing ? '' : reportBtn('post', p)}</div>
        ${editing
          ? `<form data-form="edit" data-id="${p.id}"><textarea name="body" maxlength="${LIMIT.post}" rows="4">${esc(p.body)}</textarea>
              <div class="chat-form-row"><button type="button" class="chat-btn ghost small" data-act="cancel-edit">Cancel</button><button class="chat-btn small">Save</button></div></form>`
          : `<div class="chat-post-body">${esc(p.body)}</div>`}
      </article>`;
    }).join('');
    const reply = mutedHere(ch) ? `<div class="chat-composer chat-muted small chat-muted-note">🔇 ${esc(mutedText())}</div>`
      : (ch.permissions.post_reply ?? ch.permissions.post_forum)
      ? `<form class="chat-composer" data-form="reply"><textarea name="body" rows="2" maxlength="${LIMIT.post}" placeholder="Write a reply…" required></textarea><button class="chat-btn">Reply</button></form>`
      : '<div class="chat-composer chat-muted small">Recruits can read the forum; replying opens at Member.</div>';
    return header(`${t.pinned ? '📌 ' : ''}${esc(t.title)}`, 'forum', tools)
      + `<div class="chat-scroll">${posts}${st.postsMore ? '<button type="button" class="chat-btn ghost block" data-act="posts-more">More replies</button>' : ''}</div>` + reply;
  }

  function composeHtml() {
    return header('New thread', 'forum') + `<form class="chat-compose" data-form="thread">
      <input name="title" maxlength="${LIMIT.title}" minlength="3" placeholder="Title" required autocomplete="off">
      <textarea name="body" rows="8" maxlength="${LIMIT.post}" placeholder="What's on your mind?" required></textarea>
      <div class="chat-form-row"><button type="button" class="chat-btn ghost" data-act="go" data-view="forum">Cancel</button><button class="chat-btn">Post thread</button></div>
    </form>`;
  }

  // ── Live chat ───────────────────────────────────────────────────────────
  async function loadMessages(older) {
    const ch = channel();
    if (!ch || !ch.chat.unlocked) return;
    try {
      const before = older && st.messages.length ? st.messages[0].id : null;
      const d = await call('GET', `/api/chat/channels/${ch.id}/messages${before ? `?before=${before}` : ''}`);
      st.messages = before ? d.messages.concat(st.messages) : d.messages;
      st.moreOlder = d.more;
      if (!before) { st.newBelow = 0; markSeen(); }
    } catch (e) { handleErr(e); }
  }

  // Fill the gap after a reconnect / tab resume.
  async function catchUp() {
    const ch = channel();
    if (!ch || !ch.chat.unlocked) return;
    if (!st.messages.length) { if (isOpen() && st.view === 'live') { await loadMessages(); render(); scrollToBottom(true); } return; }
    try {
      const d = await call('GET', `/api/chat/channels/${ch.id}/messages?after=${st.messages[st.messages.length - 1].id}`);
      if (d.messages.length) for (const m of d.messages) addMessage(m);
    } catch (_) {}
  }

  function msgHtml(m) {
    const ch = channel(), me = myName();
    if (m.system) return `<li class="chat-msg system" data-id="${m.id}"><span>${esc(m.body)}</span></li>`;
    const del = ch && ch.permissions.moderate ? `<button type="button" class="chat-link danger chat-msg-del" data-act="del-msg" data-id="${m.id}" aria-label="Remove">✕</button>` : '';
    return `<li class="chat-msg${m.author === me ? ' mine' : ''}" data-id="${m.id}">
      <div class="chat-msg-meta"><b>${esc(m.author || 'someone')}</b>${staffBadge(m.author_staff)}${clanTag(m.author_clan)} <span class="chat-muted small">${esc(timeLabel(m.created_at))}</span>${del}${reportBtn('message', m)}</div>
      <div class="chat-msg-body">${esc(m.body)}</div></li>`;
  }

  function liveHtml() {
    const ch = channel();
    return header(chTitle(ch, 'live'), 'home') + (isGlobal(ch) && ch.description ? `<div class="chat-about">${esc(ch.description)}</div>` : '') + `
      <div class="chat-scroll chat-live" id="chat-live">
        ${st.moreOlder ? '<button type="button" class="chat-btn ghost block small" data-act="older">Earlier messages</button>' : ''}
        <ul class="chat-msgs" id="chat-msgs">${st.messages.map(msgHtml).join('') || '<li class="chat-empty">No messages yet.</li>'}</ul>
      </div>
      <button type="button" class="chat-new-chip" id="chat-new-chip" data-act="to-bottom" hidden>New messages ↓</button>
      ${mutedHere(ch) ? `<div class="chat-composer chat-muted small chat-muted-note">🔇 ${esc(mutedText())}</div>` : `<form class="chat-composer" data-form="chat">
        <input name="body" maxlength="${LIMIT.chat}" placeholder="${isGlobal(ch) ? 'Message the realm…' : 'Message your clan…'}" autocomplete="off" required>
        <button class="chat-btn">Send</button>
      </form>`}`;
  }

  function scrollToBottom(force) {
    const box = byId('chat-live');
    if (!box) return;
    if (force || st.stick) { box.scrollTop = box.scrollHeight; st.newBelow = 0; showChip(); }
  }
  function showChip() {
    const chip = byId('chat-new-chip');
    if (chip) chip.hidden = !(st.newBelow > 0 && !st.stick);
  }
  function wireLiveScroll() {
    const box = byId('chat-live');
    if (!box || box._wired) return;
    box._wired = true;
    box.addEventListener('scroll', () => {
      st.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      if (st.stick) { st.newBelow = 0; markSeen(); }
      showChip();
    });
  }
  function focusComposer() {
    if (isNarrow()) return;           // don't pop the keyboard on phones
    const i = document.querySelector('#chat-hub form[data-form="chat"] input');
    if (i) i.focus();
  }
  function markSeen() {
    const ch = channel();
    if (!ch || !st.messages.length) return;
    const last = st.messages[st.messages.length - 1].id;
    setSeen(ch.id, last);
    ch.last_message_id = Math.max(ch.last_message_id || 0, last);
    updateBadge();
  }

  function addMessage(m) {
    if (st.messages.some(x => x.id === m.id)) return;
    st.messages.push(m);
    const ul = byId('chat-msgs');
    if (!ul || st.view !== 'live' || !isOpen()) return;
    const empty = ul.querySelector('.chat-empty');
    if (empty) empty.remove();
    ul.insertAdjacentHTML('beforeend', msgHtml(m));
    if (st.stick || m.author === myName()) { scrollToBottom(true); markSeen(); }
    else { st.newBelow++; showChip(); }
  }

  // ── Reporting ───────────────────────────────────────────────────────────
  const REASONS = [
    ['spam', 'Spam or advertising'], ['abuse', 'Abuse or harassment'],
    ['inappropriate', 'Inappropriate content'], ['other', 'Something else'],
  ];
  function openReport(type, id) {
    const item = type === 'message' ? st.messages.find(m => m.id === id) : st.posts.find(p => p.id === id);
    if (!item) return;
    st.reporting = { type, id, author: item.author, body: item.body };
    render();
  }
  function reportSheetHtml() {
    const r = st.reporting;
    return `<div class="chat-sheet-back" data-act="report-cancel">
      <form class="chat-sheet" data-form="report" role="dialog" aria-label="Report">
        <div class="chat-sheet-title">⚑ Report ${esc(r.author)}'s ${r.type === 'message' ? 'message' : 'post'}</div>
        <blockquote class="mod-snap">${esc(r.body.length > 280 ? r.body.slice(0, 280) + '…' : r.body)}</blockquote>
        <div class="chat-reasons">${REASONS.map(([v, l], i) => `
          <label class="chat-reason"><input type="radio" name="reason" value="${v}"${i === 0 ? ' checked' : ''}> ${l}</label>`).join('')}
        </div>
        <textarea name="note" rows="2" maxlength="300" placeholder="Anything the moderators should know? (optional)"></textarea>
        <div class="chat-muted small">Reports go to the Kindlewood moderators — ${esc(r.author)} won't see who sent it.</div>
        <div class="chat-form-row"><button type="button" class="chat-btn ghost" data-act="report-cancel">Cancel</button><button class="chat-btn">Send report</button></div>
      </form></div>`;
  }

  // ── Moderation (staff) ──────────────────────────────────────────────────
  const MUTE_OPTS = [[1, '1 hour'], [24, '24 hours'], [72, '3 days'], [168, '7 days'], [0, 'Until lifted']];
  const muteSelect = name => `<select name="${name}" class="chat-select">${MUTE_OPTS.map(([h, l]) =>
    `<option value="${h}"${h === 24 ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const REASON_LABEL = Object.fromEntries(REASONS.map(([v, l]) => [v, l]));
  const ACTION_LABEL = {
    remove_message: 'removed a chat line by', remove_post: 'removed a post by', remove_thread: 'removed a thread by',
    pin_thread: 'pinned a thread', unpin_thread: 'unpinned a thread',
    report_dismiss: 'dismissed a report on', report_remove: 'removed reported content by',
    report_remove_and_mute: 'removed reported content and muted', mute: 'muted', unmute: 'lifted the mute on',
    grant_moderator: 'made a moderator:', revoke_moderator: 'revoked moderator from',
  };
  const untilLabel = u => u ? 'until ' + new Date(u).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'until lifted';

  async function loadMod(view) {
    try {
      if (view === 'mod-reports') {
        const d = await call('GET', `/api/chat/reports${st.modFilter === 'resolved' ? '?status=resolved' : ''}`);
        st.modReports = d.reports;
        if (st.modFilter === 'open') { st.openReports = d.open_reports || 0; updateBadge(); }
      } else if (view === 'mod-mutes') st.mutes = (await call('GET', '/api/chat/mutes')).mutes;
      else if (view === 'mod-log') st.modLog = (await call('GET', '/api/chat/mod-log')).actions;
      else if (view === 'mod-staff') st.staffList = (await call('GET', '/api/chat/staff')).staff;
    } catch (e) { handleErr(e); }
  }

  function modHtml() {
    if (st.view === 'mod-reports') return reportsHtml();
    if (st.view === 'mod-mutes') return mutesHtml();
    if (st.view === 'mod-log') return logHtml();
    if (st.view === 'mod-staff') return staffHtml();
    return '';
  }

  function whereLabel(r) {
    const c = r.channel || {};
    const where = c.kind === 'clan' ? `🛡 ${esc(c.name || 'a clan')} (clan hall)` : esc(c.name || 'a deleted channel');
    return where + (r.thread_title ? ` › ${esc(r.thread_title)}` : '');
  }
  function userLine(u) {
    if (!u) return '<b>someone (deleted)</b>';
    return `<b>${esc(u.username)}</b>${staffBadge(u.staff)}${u.muted ? ` <span class="mod-pill">🔇 muted ${esc(untilLabel(u.muted_until))}</span>` : ''}`;
  }

  function reportsHtml() {
    const tog = `<div class="mod-toggle">
      <button type="button" class="chat-btn small ${st.modFilter === 'open' ? '' : 'ghost'}" data-act="mod-filter" data-filter="open">Open${st.openReports ? ` (${st.openReports})` : ''}</button>
      <button type="button" class="chat-btn small ${st.modFilter === 'resolved' ? '' : 'ghost'}" data-act="mod-filter" data-filter="resolved">Resolved</button></div>`;
    let body;
    if (st.modFilter === 'resolved') {
      body = st.modReports.length ? st.modReports.map(r => `
        <article class="mod-card resolved">
          <div class="mod-card-head">${userLine(r.reported_user)} <span class="chat-muted small">in ${whereLabel(r)}</span></div>
          <blockquote class="mod-snap">${esc(r.body)}</blockquote>
          <div class="chat-muted small">${esc(REASON_LABEL[r.reason] || r.reason)} · reported by ${esc(r.reporter || 'someone')}${r.note ? ` — “${esc(r.note)}”` : ''}</div>
          <div class="small mod-outcome ${r.status}">${r.status === 'dismissed' ? '✓ Dismissed' : '⚒ ' + esc(r.resolution || 'actioned')} by ${esc(r.resolver || 'someone')} · ${esc(timeLabel(r.resolved_at))}</div>
        </article>`).join('') : '<div class="chat-empty">Nothing resolved yet.</div>';
    } else {
      body = st.modReports.length ? st.modReports.map(r => {
        const u = r.reported_user;
        const canMute = u && u.staff !== 'admin' && (!u.staff || st.admin);
        return `<article class="mod-card" data-report="${r.id}">
          <div class="mod-card-head">${userLine(u)} <span class="chat-muted small">in ${whereLabel(r)}</span>
            ${r.reports.length > 1 ? `<span class="chat-count">${r.reports.length} reports</span>` : ''}</div>
          <blockquote class="mod-snap">${esc(r.body)}</blockquote>
          ${r.still_there ? '' : '<div class="chat-muted small">Already removed from the channel.</div>'}
          <ul class="mod-reports">${r.reports.map(x => `<li><span class="mod-reason ${esc(x.reason)}">${esc(REASON_LABEL[x.reason] || x.reason)}</span>
            <span class="chat-muted small">${esc(x.reporter || 'someone')} · ${esc(timeLabel(x.created_at))}</span>${x.note ? `<div class="small">“${esc(x.note)}”</div>` : ''}</li>`).join('')}</ul>
          <div class="mod-actions">
            <button type="button" class="chat-btn ghost small" data-act="resolve" data-action="dismiss" data-id="${r.id}">Dismiss</button>
            ${r.still_there ? `<button type="button" class="chat-btn danger small" data-act="resolve" data-action="remove" data-id="${r.id}">${r.is_opening ? 'Remove thread' : 'Remove'}</button>` : ''}
            ${canMute ? `<span class="mod-mute">${muteSelect('hours-' + r.id)}<button type="button" class="chat-btn danger small" data-act="resolve" data-action="remove_and_mute" data-id="${r.id}">${r.still_there ? 'Remove & mute' : 'Mute'}</button></span>` : ''}
          </div>
        </article>`;
      }).join('') : '<div class="chat-empty">No open reports — all quiet in the realm. 🌿</div>';
    }
    return header('⚑ Reports', 'home', tog) + `<div class="chat-scroll">${body}</div>`;
  }

  function mutesHtml() {
    const rows = st.mutes.length ? st.mutes.map(m => `
      <li class="mod-row"><div><b>${esc(m.username)}</b> <span class="chat-muted small">${esc(untilLabel(m.until))} · by ${esc(m.muted_by || 'someone')}</span>
        ${m.reason ? `<div class="small chat-muted">${esc(m.reason)}</div>` : ''}</div>
        <button type="button" class="chat-btn ghost small" data-act="unmute" data-id="${m.user_id}">Lift</button></li>`).join('')
      : '<li class="chat-empty">Nobody is muted.</li>';
    return header('🔇 Mutes', 'home') + `<div class="chat-scroll">
      <form class="mod-form" data-form="mute">
        <input name="username" placeholder="Player name" required autocomplete="off">
        ${muteSelect('hours')}
        <input name="reason" maxlength="200" placeholder="Reason (optional)" autocomplete="off">
        <button class="chat-btn small">Mute</button>
      </form>
      <div class="chat-muted small mod-help">Muted players can read the Town Square but not post. Clan halls are moderated by each clan's own officers.</div>
      <ul class="mod-list">${rows}</ul></div>`;
  }

  function logHtml() {
    const rows = st.modLog.length ? st.modLog.map(a => {
      const d = a.detail || {};
      const snip = d.body || d.title;
      return `<li class="mod-row"><div><b>${esc(a.actor || 'someone')}</b> ${esc(ACTION_LABEL[a.action] || a.action)} ${a.target ? `<b>${esc(a.target)}</b>` : ''}
        ${d.hours !== undefined ? `<span class="chat-muted small">(${d.hours ? d.hours + 'h' : 'until lifted'})</span>` : ''}
        ${snip ? `<div class="small chat-muted mod-snip">“${esc(String(snip).slice(0, 140))}”</div>` : ''}</div>
        <span class="chat-muted small">${esc(timeLabel(a.created_at))}</span></li>`;
    }).join('') : '<li class="chat-empty">No moderator actions yet.</li>';
    return header('📋 Action log', 'home') + `<div class="chat-scroll"><ul class="mod-list">${rows}</ul></div>`;
  }

  function staffHtml() {
    const rows = st.staffList.map(u => `
      <li class="mod-row"><div><b>${esc(u.username)}</b>${staffBadge(u.role)}</div>
        ${u.role === 'moderator' ? `<button type="button" class="chat-btn ghost small" data-act="revoke" data-name="${esc(u.username)}">Revoke</button>`
          : '<span class="chat-muted small">set by server config</span>'}</li>`).join('');
    return header('🛡 Moderators', 'home') + `<div class="chat-scroll">
      <form class="mod-form" data-form="appoint">
        <input name="username" placeholder="Player name" required autocomplete="off">
        <button class="chat-btn small">Make moderator</button>
      </form>
      <div class="chat-muted small mod-help">Moderators can pin, remove posts and chat lines, post announcements, work the report queue and mute players in the Town Square.</div>
      <ul class="mod-list">${rows}</ul></div>`;
  }

  // ── Events ──────────────────────────────────────────────────────────────
  function handleErr(e) {
    if (e && e.data && e.data.locked) { loadChannels().then(render); }
    if (e && e.data && e.data.muted) { st.muted = { until: e.data.muted_until || null }; render(); }
    toast(e.message, 'error');
  }

  async function run(fn) {
    if (st.busy) return;
    st.busy = true;
    try { await fn(); } catch (e) { handleErr(e); } finally { st.busy = false; }
  }

  function onAction(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, id = parseInt(t.dataset.id, 10);
    switch (act) {
      case 'close': closeChatHub(); break;
      case 'go': go(t.dataset.view, parseInt(t.dataset.channel, 10) || undefined); break;
      case 'open-clan': closeChatHub(); if (global.openClanPanel) global.openClanPanel(); break;
      case 'compose': {
        st.view = 'compose'; render();
        const ti = document.querySelector('#chat-hub input[name=title]'); if (ti) ti.focus();
        break;
      }
      case 'thread': openThread(id); break;
      case 'threads-more': loadThreads(true).then(render); break;
      case 'posts-more': openThread(st.thread.id, true); break;
      case 'older': {
        const box = byId('chat-live'), h = box ? box.scrollHeight : 0;
        loadMessages(true).then(() => { render(); const b = byId('chat-live'); if (b) b.scrollTop = b.scrollHeight - h; });
        break;
      }
      case 'to-bottom': st.stick = true; scrollToBottom(true); markSeen(); break;
      case 'edit': st.editing = id; render(); break;
      case 'cancel-edit': st.editing = null; render(); break;
      case 'pin': run(async () => {
        await call('POST', `/api/chat/threads/${st.thread.id}/pin`, { pinned: t.dataset.pinned === '1' });
        await openThread(st.thread.id);
      }); break;
      case 'del-thread':
        if (!confirm(`Delete the thread “${st.thread.title}” and all its replies?`)) break;
        run(async () => { await call('DELETE', `/api/chat/threads/${st.thread.id}`); toast('Thread deleted.'); await go('forum'); });
        break;
      case 'del-post':
        if (!confirm('Delete this reply?')) break;
        run(async () => { await call('DELETE', `/api/chat/posts/${id}`); await openThread(st.thread.id); });
        break;
      case 'report': openReport(t.dataset.type, id); break;
      case 'report-cancel':
        if (e.target !== t) break;       // clicks inside the sheet bubble up to its backdrop
        st.reporting = null; render(); break;
      case 'mod-filter': st.modFilter = t.dataset.filter; go('mod-reports'); break;
      case 'resolve': {
        const action = t.dataset.action;
        const sel = document.querySelector(`#chat-hub select[name="hours-${id}"]`);
        const hours = sel ? parseInt(sel.value, 10) : 24;
        if (action !== 'dismiss' && !confirm(action === 'remove' ? 'Remove this content?'
          : `Remove this content and mute its author ${hours ? 'for ' + sel.selectedOptions[0].textContent : 'until lifted'}?`)) break;
        run(async () => {
          await call('POST', `/api/chat/reports/${id}/resolve`, { action, mute_hours: action === 'remove_and_mute' ? hours : undefined });
          toast(action === 'dismiss' ? 'Report dismissed.' : 'Done — thanks for keeping the realm kind.');
          await go('mod-reports');
        });
        break;
      }
      case 'unmute':
        run(async () => { await call('DELETE', `/api/chat/mutes/${id}`); toast('Mute lifted.'); await go('mod-mutes'); });
        break;
      case 'revoke':
        if (!confirm(`Remove ${t.dataset.name}'s moderator role?`)) break;
        run(async () => { await call('POST', '/api/chat/staff', { username: t.dataset.name, role: 'player' }); await go('mod-staff'); });
        break;
      case 'del-msg':
        run(async () => { await call('DELETE', `/api/chat/messages/${id}`); removeMessage(id); });
        break;
    }
  }

  function onSubmit(e) {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const ch = channel();
    const kind = f.dataset.form;
    if (kind === 'chat') {
      const input = f.elements.body, body = input.value.trim();
      if (!body) return;
      run(async () => {
        const d = await call('POST', `/api/chat/channels/${ch.id}/messages`, { body });
        input.value = '';
        addMessage(d.message);
      });
    } else if (kind === 'thread') {
      run(async () => {
        const d = await call('POST', `/api/chat/channels/${ch.id}/threads`, { title: f.elements.title.value, body: f.elements.body.value });
        toast('Thread posted.');
        await openThread(d.thread_id);
      });
    } else if (kind === 'reply') {
      run(async () => {
        await call('POST', `/api/chat/threads/${st.thread.id}/posts`, { body: f.elements.body.value });
        await openThread(st.thread.id);
        const s = document.querySelector('#chat-hub .chat-scroll'); if (s) s.scrollTop = s.scrollHeight;
      });
    } else if (kind === 'report') {
      const r = st.reporting;
      run(async () => {
        const d = await call('POST', '/api/chat/reports', {
          target_type: r.type, target_id: r.id, reason: f.elements.reason.value, note: f.elements.note.value,
        });
        st.reporting = null; render();
        toast(d.already ? 'You already reported that — the moderators have it.' : 'Report sent. Thank you.');
      });
    } else if (kind === 'mute') {
      run(async () => {
        const d = await call('POST', '/api/chat/mutes', {
          username: f.elements.username.value.trim(), hours: parseInt(f.elements.hours.value, 10), reason: f.elements.reason.value,
        });
        toast(`${d.username} muted ${untilLabel(d.until)}.`);
        await go('mod-mutes');
      });
    } else if (kind === 'appoint') {
      run(async () => {
        const d = await call('POST', '/api/chat/staff', { username: f.elements.username.value.trim(), role: 'moderator' });
        toast(`${d.username} is now a moderator.`);
        await go('mod-staff');
      });
    } else if (kind === 'edit') {
      run(async () => {
        await call('PATCH', `/api/chat/posts/${f.dataset.id}`, { body: f.elements.body.value });
        st.editing = null;
        await openThread(st.thread.id);
      });
    }
  }

  function onKey(e) {
    if (e.key === 'Escape' && st.reporting) { st.reporting = null; render(); return; }
    if (e.key === 'Escape') { if (st.editing) { st.editing = null; render(); } else closeChatHub(); }
    // Ctrl/Cmd+Enter posts from a forum textarea.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.tagName === 'TEXTAREA') {
      const f = e.target.closest('form'); if (f) f.requestSubmit();
    }
  }

  function removeMessage(id) {
    st.messages = st.messages.filter(m => m.id !== id);
    const li = document.querySelector(`#chat-msgs li[data-id="${id}"]`);
    if (li) li.remove();
  }

  // ── Badge (unread live chat) ──────────────────────────────────────────
  function chatBtn() {
    return Array.prototype.find.call(document.querySelectorAll('.community-bar .comm-btn'),
      b => /chat/i.test(b.textContent || '') && !b.id);
  }
  // Nav dot: unread clan-hall chat, an announcement you haven't opened, or
  // (staff) open reports.
  // (Busy realm channels only mark themselves in the hub's list.)
  function updateBadge() {
    const ann = realm().find(c => c.post_policy === 'staff');
    const on = chatUnread(clanHall()) || boardUnread(ann) || (!!st.staff && st.openReports > 0);
    const b = byId('nav-chat') || chatBtn();
    if (b) b.classList.toggle('has-dot', on);
    if (global.KWShell && global.KWShell.syncBadges) global.KWShell.syncBadges();
  }

  // ── Realtime hooks (called from realtime.js) ──────────────────────────
  function onChat(ev) {
    const m = ev && ev.message;
    if (!m) return;
    const ch = (st.channels || []).find(c => c.id === m.channel_id);
    if (ch) ch.last_message_id = Math.max(ch.last_message_id || 0, m.id);
    if (isOpen() && st.view === 'live' && m.channel_id === st.channelId) addMessage(m);
    else { updateBadge(); if (isOpen()) byId('chat-side').innerHTML = sideHtml(); }
  }
  function onChatDeleted(ev) { removeMessage(ev.message_id); }
  function onForumUpdated(ev) {
    const ch = (st.channels || []).find(c => c.id === ev.channel_id);
    if (ch && ev.what !== 'thread_deleted' && ev.what !== 'post_deleted') ch.last_post_at = new Date().toISOString();
    updateBadge();
    if (!isOpen()) return;
    if (ev.channel_id !== st.channelId) { byId('chat-side').innerHTML = sideHtml(); return; }
    if (st.view === 'forum') loadThreads().then(render);
    else if (st.view === 'thread' && st.thread && ev.thread_id === st.thread.id && !st.editing) {
      if (ev.what === 'thread_deleted') go('forum'); else openThread(st.thread.id);
    }
  }
  function onModReports(ev) {
    if (!st.staff) return;
    st.openReports = ev.open_reports || 0;
    updateBadge();
    if (!isOpen()) return;
    byId('chat-side').innerHTML = sideHtml();
    if (st.view === 'mod-reports' && st.modFilter === 'open' && !st.busy) go('mod-reports');
  }
  async function onLevelOrMembership() {
    await loadChannels();
    if (isOpen()) render();
  }
  function onReconnect() {
    // Missed events while the stream was down (phones suspend it).
    loadChannels().then(() => {
      if (!isOpen()) return;
      if (st.view === 'live') catchUp();
      else if (st.view === 'forum') loadThreads().then(render);
      else if (isModView(st.view)) go(st.view);
      else render();
    });
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isOpen()) onReconnect(); });

  global.openChatHub = openChatHub;
  global.closeChatHub = closeChatHub;
  global.ChatHub = { onChat, onChatDeleted, onForumUpdated, onLevelOrMembership, onModReports, onReconnect, refreshBadge: loadChannels };
})(typeof window !== 'undefined' ? window : globalThis);
