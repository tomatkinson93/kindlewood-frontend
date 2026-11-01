// ══════════════════════════════════════════════════════════════════════════
//  Letters — player-to-player mail (server: routes/mail.js, /api/mail).
//
//  The Messages button (and its More-sheet copy on phones) opens it:
//  Inbox · Sent · Write · Blocked. A letter can be answered, deleted,
//  reported (it goes to the moderators' queue with a copy of the letter)
//  or its sender blocked. An unread badge sits on the Messages button,
//  refreshed on load, on a 'mail' realtime event and every 5 minutes.
//  KWMail.compose(username) opens a blank letter (a player's profile uses it).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = id => document.getElementById(id);
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };
  const REASONS = [['abuse', 'Abuse or harassment'], ['spam', 'Spam'], ['inappropriate', 'Inappropriate'], ['other', 'Something else']];
  const POLL_MS = 5 * 60 * 1000;
  const SUBJECT_MAX = 80, BODY_MAX = 2000;

  const st = { tab: 'inbox', letters: [], blocked: [], unread: 0, letter: null, reporting: false, confirmBlock: false, draft: { to: '', subject: '', body: '' }, busy: false };
  let _timer = null;

  async function call(method, path, body) {
    const res = await global.apiFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function when(ts) {
    const d = new Date(ts), mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  // ── Badge ──────────────────────────────────────────────────────────────
  function setUnread(n) {
    st.unread = Math.max(0, Number(n) || 0);
    const btn = byId('nav-messages');
    if (btn) {
      btn.classList.toggle('has-dot', st.unread > 0);
      btn.setAttribute('aria-label', st.unread ? `Messages, ${st.unread} unread` : 'Messages');
    }
    if (global.KWShell && global.KWShell.syncBadges) global.KWShell.syncBadges();
    const t = byId('mail-tab-inbox');
    if (t) t.textContent = st.unread ? `Inbox (${st.unread})` : 'Inbox';
  }
  async function refreshUnread() {
    try { setUnread((await call('GET', '/api/mail/unread')).unread); } catch (e) { /* offline: keep the last count */ }
  }
  function start() {
    refreshUnread();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(refreshUnread, POLL_MS);
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  function ensureModal() {
    let m = byId('mail-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'mail-modal';
    m.className = 'mail-backdrop';
    m.innerHTML = `<div class="mail-card" role="dialog" aria-modal="true" aria-labelledby="mail-title">
        <div class="mail-head"><div class="mail-title" id="mail-title">✉ Letters</div>
          <button type="button" class="mail-close" data-mail="close" aria-label="Close letters">✕</button></div>
        <div class="mail-tabs" role="tablist">
          <button type="button" class="mail-tab" id="mail-tab-inbox" data-mail="tab" data-tab="inbox" role="tab">Inbox</button>
          <button type="button" class="mail-tab" data-mail="tab" data-tab="sent" role="tab">Sent</button>
          <button type="button" class="mail-tab" data-mail="tab" data-tab="write" role="tab">✎ Write</button>
          <button type="button" class="mail-tab" data-mail="tab" data-tab="blocked" role="tab">Blocked</button>
        </div>
        <div class="mail-body" id="mail-body"></div>
      </div>`;
    m.addEventListener('click', onClick);
    m.addEventListener('input', onInput);
    document.body.appendChild(m);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) close(); });
    return m;
  }

  async function open(tab) {
    const m = ensureModal();
    m.classList.add('open');
    await show(tab || 'inbox');
  }
  function close() { const m = byId('mail-modal'); if (m) m.classList.remove('open'); }

  function compose(to, subject) {
    st.draft = { to: to || '', subject: subject || '', body: '' };
    const m = ensureModal();
    m.classList.add('open');
    st.tab = 'write'; st.letter = null; st.reporting = false;
    render();
    const f = byId(to ? 'mail-f-body' : 'mail-f-to');
    if (f && f.focus) f.focus();
  }

  async function show(tab) {
    st.tab = tab; st.letter = null; st.reporting = false;
    if (tab === 'inbox' || tab === 'sent') {
      byId('mail-body').innerHTML = '<div class="mail-empty">Opening the satchel…</div>';
      try {
        const d = await call('GET', '/api/mail' + (tab === 'sent' ? '?box=sent' : ''));
        st.letters = d.letters || [];
        setUnread(d.unread);
      } catch (e) { byId('mail-body').innerHTML = `<div class="mail-err">${esc(e.message)}</div>`; return; }
    }
    if (tab === 'blocked') {
      try { st.blocked = (await call('GET', '/api/mail/blocks')).blocked || []; } catch (e) { st.blocked = []; }
    }
    render();
  }

  // ── Views ──────────────────────────────────────────────────────────────
  function listHtml() {
    const sent = st.tab === 'sent';
    if (!st.letters.length) return `<div class="mail-empty">${sent ? 'You haven\'t sent any letters yet.' : 'No letters yet. Visit a player\'s profile, or Write one.'}</div>`;
    return '<ul class="mail-list">' + st.letters.map(l => {
      const who = sent ? (l.to && l.to.username) : (l.from ? l.from.username : 'a departed ruler');
      const title = l.removed ? '<i>Removed by a moderator</i>' : esc(l.subject || '(no subject)');
      return `<li><button type="button" class="mail-row${!sent && !l.read ? ' unread' : ''}" data-mail="read" data-id="${l.id}">
          <span class="mail-row-who">${sent ? 'To ' : ''}${esc(who)}</span>
          <span class="mail-row-subject">${title}</span>
          <span class="mail-row-when">${esc(when(l.created_at))}</span></button></li>`;
    }).join('') + '</ul>';
  }

  function letterHtml(l) {
    const sent = l.mine;
    const who = sent ? `To ${esc(l.to.username)}` : `From ${esc(l.from ? l.from.username : 'a departed ruler')}`;
    const body = l.removed ? '<p class="mail-removed">This letter was removed by a moderator.</p>' : `<div class="mail-text">${esc(l.body)}</div>`;
    const acts = [`<button type="button" class="mail-btn" data-mail="back">← Back</button>`];
    if (!sent && l.from && !l.removed) acts.push(`<button type="button" class="mail-btn mail-btn-primary" data-mail="reply">↩ Reply</button>`);
    acts.push(`<button type="button" class="mail-btn" data-mail="delete">🗑 Delete</button>`);
    if (!sent && l.from && !l.removed) {
      acts.push(`<button type="button" class="mail-btn" data-mail="report-open">⚑ Report</button>`);
      acts.push(st.confirmBlock
        ? `<button type="button" class="mail-btn mail-btn-danger" data-mail="block">⛔ Tap again to block ${esc(l.from.username)}</button>`
        : `<button type="button" class="mail-btn" data-mail="block-ask">⛔ Block ${esc(l.from.username)}</button>`);
    }
    const report = st.reporting ? `<div class="mail-report">
        <div class="mail-report-h">Report this letter to the moderators</div>
        <p class="mail-hint">They'll see a copy of it and can remove it and mute the sender. Reports are private — ${esc(l.from.username)} won't know who sent it.</p>
        <div class="mail-reasons">${REASONS.map(([k, t], i) => `<label><input type="radio" name="mail-reason" value="${k}"${i === 0 ? ' checked' : ''}> ${t}</label>`).join('')}</div>
        <textarea class="mail-input" id="mail-report-note" maxlength="300" rows="2" placeholder="Anything they should know? (optional)"></textarea>
        <div class="mail-actions"><button type="button" class="mail-btn" data-mail="report-cancel">Cancel</button>
          <button type="button" class="mail-btn mail-btn-danger" data-mail="report-send">Send report</button></div></div>` : '';
    return `<article class="mail-letter">
        <header><div class="mail-letter-subject">${l.removed ? 'Removed' : esc(l.subject || '(no subject)')}</div>
          <div class="mail-letter-meta">${who} · ${esc(new Date(l.created_at).toLocaleString())}</div></header>
        ${body}
        <div class="mail-actions">${acts.join('')}</div>${report}</article>`;
  }

  function writeHtml() {
    const d = st.draft;
    return `<form class="mail-write" data-mail-form="send" onsubmit="return false">
        <label class="mail-label" for="mail-f-to">To</label>
        <input class="mail-input" id="mail-f-to" data-draft="to" value="${esc(d.to)}" placeholder="Player name" autocomplete="off" maxlength="40">
        <label class="mail-label" for="mail-f-subject">Subject</label>
        <input class="mail-input" id="mail-f-subject" data-draft="subject" value="${esc(d.subject)}" maxlength="${SUBJECT_MAX}" placeholder="(optional)">
        <label class="mail-label" for="mail-f-body">Letter</label>
        <textarea class="mail-input" id="mail-f-body" data-draft="body" rows="8" maxlength="${BODY_MAX}" placeholder="Dear neighbour…">${esc(d.body)}</textarea>
        <div class="mail-actions"><span class="mail-count" id="mail-count">${d.body.length}/${BODY_MAX}</span>
          <button type="button" class="mail-btn mail-btn-primary" data-mail="send">Send letter</button></div>
        <p class="mail-hint">Be kind. Letters can be reported to the moderators.</p></form>`;
  }

  function blockedHtml() {
    const rows = st.blocked.map(u => `<li class="mail-block-row"><span>${esc(u.username)}</span>
        <button type="button" class="mail-btn" data-mail="unblock" data-id="${u.id}">Unblock</button></li>`).join('');
    return `<p class="mail-hint">Blocked players can't send you letters.</p>${rows ? `<ul class="mail-list">${rows}</ul>` : '<div class="mail-empty">Nobody blocked.</div>'}`;
  }

  function render() {
    const body = byId('mail-body');
    if (!body) return;
    document.querySelectorAll('.mail-tab').forEach(t => {
      const on = t.dataset.tab === st.tab;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    body.innerHTML = st.letter ? letterHtml(st.letter)
      : st.tab === 'write' ? writeHtml()
      : st.tab === 'blocked' ? blockedHtml()
      : listHtml();
    setUnread(st.unread);
  }

  // ── Actions ────────────────────────────────────────────────────────────
  function onInput(e) {
    const k = e.target && e.target.dataset && e.target.dataset.draft;
    if (!k) return;
    st.draft[k] = e.target.value;
    if (k === 'body') { const c = byId('mail-count'); if (c) c.textContent = `${st.draft.body.length}/${BODY_MAX}`; }
  }

  async function onClick(e) {
    if (e.target === e.currentTarget) return close();   // click on the backdrop
    const b = e.target.closest('[data-mail]');
    if (!b) return;
    const act = b.dataset.mail, l = st.letter;
    if (act === 'close') return close();
    if (act === 'tab') return show(b.dataset.tab);
    if (act === 'back') { st.letter = null; st.reporting = false; return render(); }
    if (act === 'read') {
      const found = st.letters.find(x => x.id === Number(b.dataset.id));
      if (!found) return;
      st.letter = found; st.reporting = false; st.confirmBlock = false;
      if (!found.mine && !found.read) {
        found.read = true;
        setUnread(st.unread - 1);
        call('POST', `/api/mail/${found.id}/read`).catch(() => {});
      }
      return render();
    }
    if (act === 'reply' && l) return compose(l.from.username, /^re:/i.test(l.subject || '') ? l.subject : `Re: ${l.subject || ''}`.trim().slice(0, SUBJECT_MAX));
    if (act === 'report-open') { st.reporting = true; return render(); }
    if (act === 'block-ask') { st.confirmBlock = true; return render(); }
    if (act === 'report-cancel') { st.reporting = false; return render(); }
    if (st.busy) return;
    st.busy = true;
    try {
      if (act === 'send') {
        if (!st.draft.to.trim()) throw new Error('Who is it for?');
        if (!st.draft.body.trim()) throw new Error('Write something first.');
        await call('POST', '/api/mail', { to: st.draft.to.trim(), subject: st.draft.subject, body: st.draft.body });
        toast(`✉ Letter sent to ${st.draft.to.trim()}.`);
        st.draft = { to: '', subject: '', body: '' };
        st.busy = false;
        return show('sent');
      }
      if (act === 'delete' && l) {
        await call('DELETE', `/api/mail/${l.id}`);
        toast('Letter deleted.', 'info');
        st.busy = false;
        return show(st.tab === 'sent' ? 'sent' : 'inbox');
      }
      if (act === 'report-send' && l) {
        const reason = (document.querySelector('input[name="mail-reason"]:checked') || {}).value || 'abuse';
        const note = (byId('mail-report-note') || {}).value || '';
        const d = await call('POST', `/api/mail/${l.id}/report`, { reason, note });
        toast(d.already ? 'You\'ve already reported this letter.' : 'Thank you — the moderators will take a look.');
        st.reporting = false;
        render();
      }
      if (act === 'block' && l && l.from) {
        await call('POST', '/api/mail/block', { user_id: l.from.id });
        toast(`${l.from.username} is blocked — they can't send you letters.`, 'info');
        st.confirmBlock = false;
        render();
      }
      if (act === 'unblock') {
        await call('DELETE', `/api/mail/block/${b.dataset.id}`);
        st.busy = false;
        return show('blocked');
      }
    } catch (err) { toast(err.message, 'error'); }
    finally { st.busy = false; }
  }

  // Realtime: a letter arrived.
  function onEvent(ev) {
    if (!ev || ev.type !== 'mail') return;
    setUnread(st.unread + 1);
    toast(`✉ A letter from ${ev.from || 'a neighbour'}${ev.subject ? ': ' + ev.subject : ''}`, 'info');
    const m = byId('mail-modal');
    if (m && m.classList.contains('open') && st.tab === 'inbox' && !st.letter) show('inbox');
  }

  global.KWMail = { open, close, compose, start, refreshUnread, onEvent, _state: () => st, _render: render, _setUnread: setUnread };
})(typeof window !== 'undefined' ? window : this);
