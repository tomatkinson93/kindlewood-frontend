// ══════════════════════════════════════════════════════════════════════════
//  CHAT HUB — clan forum + live chat (spec 016 §7, Phase 4)
//
//  Opened from the Chat comm-btn. Left: channel list — "Town Square"
//  (community-wide boards/chat, coming soon) and your clan's hall with
//  Forum and Live tabs. Right: the open view. On phones (body.kw-shell) it
//  is one full-screen column: the list, then a pushed view with a back
//  button. #chat-hub is registered in mobile-shell watchOverlays().
//
//  Server: /api/chat/*. Locked tabs (forum < clan level 2, live < level 4)
//  stay visible with a progress bar. Live chat keeps a persisted backlog;
//  reconnects and tab-resumes fetch ?after=<lastId> to fill the gap.
//  Unread = last seen message id per channel in localStorage (per device).
//
//  Depends on: apiFetch, escHtml, ClanPalette, showBuildToast (optional).
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const esc = s => (typeof global.escHtml === 'function' ? global.escHtml(s) : String(s ?? ''));
  const P = () => global.ClanPalette;
  const LIMIT = { title: 80, post: 2000, chat: 500 };

  const st = {
    channels: null,          // from /api/chat/channels
    view: 'home',            // home | forum | thread | compose | live
    threads: [], threadsMore: false,
    thread: null, posts: [], postsMore: false, editing: null,
    messages: [], moreOlder: false, stick: true, newBelow: 0,
    busy: false,
    myName: null,
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
  const channel = () => (st.channels && st.channels[0]) || null;
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

  async function openChatHub(tab) {
    el().classList.add('open');
    document.querySelectorAll('.comm-btn').forEach(b => b.classList.remove('active'));
    await loadChannels();
    const ch = channel();
    if (tab && ch) { await go(tab); return; }
    // On wide screens open straight into the most useful unlocked tab.
    if (ch && !isNarrow()) await go(ch.chat.unlocked ? 'live' : ch.forum.unlocked ? 'forum' : 'home');
    else render();
  }
  function closeChatHub() { const r = byId('chat-hub'); if (r) r.classList.remove('open'); }
  const isNarrow = () => document.body.classList.contains('kw-shell') || window.innerWidth < 760;

  async function loadChannels() {
    try { st.channels = (await call('GET', '/api/chat/channels')).channels; }
    catch (e) { st.channels = []; }
    updateBadge();
  }

  async function go(view) {
    st.view = view;
    st.editing = null;
    if (view === 'forum') await loadThreads();
    if (view === 'live') await loadMessages();
    render();
    if (view === 'live') { scrollToBottom(true); focusComposer(); }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function render() {
    if (!isOpen()) return;
    const root = byId('chat-hub');
    root.classList.toggle('chat-pushed', st.view !== 'home');
    byId('chat-side').innerHTML = sideHtml();
    byId('chat-main').innerHTML = mainHtml();
    wireLiveScroll();
  }

  function sideHtml() {
    const ch = channel();
    let clan;
    if (!st.channels) clan = '<div class="chat-muted">Loading…</div>';
    else if (!ch) clan = `<div class="chat-muted">Join or found a clan to open a clan hall.</div>
        <button type="button" class="chat-btn ghost small" data-act="open-clan">🛡️ Clan panel</button>`;
    else {
      const unread = ch.chat.unlocked && (ch.last_message_id || 0) > getSeen(ch.id);
      clan = `
        <div class="chat-clan-name">${esc(ch.banner.glyph)} ${esc(ch.name)}</div>
        ${tabBtn('forum', '📜 Forum', ch.forum)}
        ${tabBtn('live', '💬 Live chat', ch.chat, unread)}`;
    }
    return `
      <div class="chat-side-title">Chat</div>
      <div class="chat-sec">
        <div class="chat-sec-label">Town Square</div>
        <div class="chat-soon">Realm-wide boards and chat — coming soon.</div>
      </div>
      <div class="chat-sec">
        <div class="chat-sec-label">Clan hall</div>
        ${clan}
      </div>`;
  }

  function tabBtn(view, label, gate, dot) {
    const on = st.view === view || (view === 'forum' && (st.view === 'thread' || st.view === 'compose'));
    return `<button type="button" class="chat-tab${on ? ' on' : ''}${gate.unlocked ? '' : ' locked'}" data-act="go" data-view="${view}">
      <span>${label}</span>${gate.unlocked ? (dot ? '<span class="chat-dot"></span>' : '') : `<span class="chat-lock">🔒 L${gate.unlock_level}</span>`}</button>`;
  }

  function lockedHtml(what, gate) {
    const ch = channel();
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
    if (st.view === 'home' || !ch) {
      return header('Chat') + `<div class="chat-empty">${ch
        ? 'Pick your clan’s Forum or Live chat.'
        : 'Chat lives in your clan hall for now. Join or found a clan to talk with your clanmates — realm-wide channels are on the way.'}</div>`;
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
    } catch (e) { handleErr(e); }
  }

  function forumHtml() {
    const ch = channel();
    const newBtn = ch.permissions.post_forum
      ? '<button type="button" class="chat-btn small" data-act="compose">✎ New thread</button>'
      : '<span class="chat-muted small">Recruits can read; posting opens at Member.</span>';
    const rows = st.threads.length ? st.threads.map(t => `
      <li><button type="button" class="chat-thread" data-act="thread" data-id="${t.id}">
        <span class="chat-thread-title">${t.pinned ? '📌 ' : ''}${esc(t.title)}</span>
        <span class="chat-muted small">${esc(t.author || 'someone')} · ${t.reply_count} ${t.reply_count === 1 ? 'reply' : 'replies'} · ${esc(timeLabel(t.last_post_at))}</span>
      </button></li>`).join('') : '<li class="chat-empty">No threads yet — start the first one.</li>';
    return header('📜 Forum', 'home', newBtn) + `<div class="chat-scroll"><ul class="chat-threads">${rows}</ul>
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
      const actions = (mine || mod) && !editing ? `<span class="chat-post-actions">
          <button type="button" class="chat-link" data-act="edit" data-id="${p.id}">Edit</button>
          ${p.id !== t.first_post_id ? `<button type="button" class="chat-link danger" data-act="del-post" data-id="${p.id}">Delete</button>` : ''}
        </span>` : '';
      return `<article class="chat-post${p.id === t.first_post_id ? ' first' : ''}">
        <div class="chat-post-meta"><b>${esc(p.author || 'someone')}</b> <span class="chat-muted small">${esc(timeLabel(p.created_at))}${p.edited_at ? ' · edited' : ''}</span>${actions}</div>
        ${editing
          ? `<form data-form="edit" data-id="${p.id}"><textarea name="body" maxlength="${LIMIT.post}" rows="4">${esc(p.body)}</textarea>
              <div class="chat-form-row"><button type="button" class="chat-btn ghost small" data-act="cancel-edit">Cancel</button><button class="chat-btn small">Save</button></div></form>`
          : `<div class="chat-post-body">${esc(p.body)}</div>`}
      </article>`;
    }).join('');
    const reply = ch.permissions.post_forum
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
      <div class="chat-msg-meta"><b>${esc(m.author || 'someone')}</b> <span class="chat-muted small">${esc(timeLabel(m.created_at))}</span>${del}</div>
      <div class="chat-msg-body">${esc(m.body)}</div></li>`;
  }

  function liveHtml() {
    return header('💬 Live chat', 'home') + `
      <div class="chat-scroll chat-live" id="chat-live">
        ${st.moreOlder ? '<button type="button" class="chat-btn ghost block small" data-act="older">Earlier messages</button>' : ''}
        <ul class="chat-msgs" id="chat-msgs">${st.messages.map(msgHtml).join('') || '<li class="chat-empty">No messages yet.</li>'}</ul>
      </div>
      <button type="button" class="chat-new-chip" id="chat-new-chip" data-act="to-bottom" hidden>New messages ↓</button>
      <form class="chat-composer" data-form="chat">
        <input name="body" maxlength="${LIMIT.chat}" placeholder="Message your clan…" autocomplete="off" required>
        <button class="chat-btn">Send</button>
      </form>`;
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

  // ── Events ──────────────────────────────────────────────────────────────
  function handleErr(e) {
    if (e && e.data && e.data.locked) { loadChannels().then(render); }
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
      case 'go': go(t.dataset.view); break;
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
    } else if (kind === 'edit') {
      run(async () => {
        await call('PATCH', `/api/chat/posts/${f.dataset.id}`, { body: f.elements.body.value });
        st.editing = null;
        await openThread(st.thread.id);
      });
    }
  }

  function onKey(e) {
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
  function updateBadge() {
    const ch = channel();
    const on = !!(ch && ch.chat.unlocked && (ch.last_message_id || 0) > getSeen(ch.id));
    const b = byId('nav-chat') || chatBtn();
    if (b) b.classList.toggle('has-dot', on);
    if (global.KWShell && global.KWShell.syncBadges) global.KWShell.syncBadges();
  }

  // ── Realtime hooks (called from realtime.js) ──────────────────────────
  function onChat(ev) {
    const m = ev && ev.message;
    if (!m) return;
    const ch = channel();
    if (ch && m.channel_id === ch.id) ch.last_message_id = Math.max(ch.last_message_id || 0, m.id);
    if (isOpen() && st.view === 'live') addMessage(m);
    else updateBadge();
  }
  function onChatDeleted(ev) { removeMessage(ev.message_id); }
  function onForumUpdated(ev) {
    if (!isOpen()) return;
    if (st.view === 'forum') loadThreads().then(render);
    else if (st.view === 'thread' && st.thread && ev.thread_id === st.thread.id && !st.editing) {
      if (ev.what === 'thread_deleted') go('forum'); else openThread(st.thread.id);
    }
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
      else render();
    });
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isOpen()) onReconnect(); });

  global.openChatHub = openChatHub;
  global.closeChatHub = closeChatHub;
  global.ChatHub = { onChat, onChatDeleted, onForumUpdated, onLevelOrMembership, onReconnect, refreshBadge: loadChannels };
})(typeof window !== 'undefined' ? window : globalThis);
