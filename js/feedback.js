// ══════════════════════════════════════════════
//  FEEDBACK / BUG REPORT — deploys to js/feedback.js
//  A modal to submit a bug or suggestion, plus a list view to read/resolve/
//  delete them. For now all users can view/manage; later this gets gated.
// ══════════════════════════════════════════════

function openFeedback() {
  let modal = document.getElementById('feedback-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'feedback-modal';
    modal.className = 'fb-overlay';
    modal.addEventListener('click', (e) => { if (e.target === modal) closeFeedback(); });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  _fbRenderSubmit();
}
function closeFeedback() {
  const m = document.getElementById('feedback-modal');
  if (m) m.style.display = 'none';
}

function _fbRenderSubmit() {
  const m = document.getElementById('feedback-modal');
  if (!m) return;
  m.innerHTML = '<div class="fb-modal">'
    + '<div class="fb-head"><span>🐞 Bug Report / Feedback</span><button class="fb-close" onclick="closeFeedback()">✕</button></div>'
    + '<div class="fb-tabs"><button class="fb-tab on" onclick="_fbRenderSubmit()">Submit</button>'
    + '<button class="fb-tab" onclick="_fbRenderList()">View Reports</button></div>'
    + '<div class="fb-body">'
    + '  <label class="fb-lbl">Type</label>'
    + '  <select class="fb-in" id="fb-kind"><option value="bug">🐞 Bug</option><option value="suggestion">💡 Suggestion</option></select>'
    + '  <label class="fb-lbl">Title</label>'
    + '  <input class="fb-in" id="fb-title" placeholder="Short summary…" maxlength="200">'
    + '  <label class="fb-lbl">Details</label>'
    + '  <textarea class="fb-in" id="fb-body" rows="5" placeholder="What happened, what you expected, steps to reproduce…"></textarea>'
    + '  <div class="fb-actions"><button class="fb-submit" onclick="_fbSubmit()">Send</button>'
    + '  <span class="fb-feedback" id="fb-feedback"></span></div>'
    + '</div></div>';
}

async function _fbSubmit() {
  const title = document.getElementById('fb-title').value.trim();
  if (!title) { _fbFeedback('⚠️ A short title is required.'); return; }
  const body = {
    kind: document.getElementById('fb-kind').value,
    title,
    body: document.getElementById('fb-body').value,
    page_context: (location.hash || location.pathname || ''),
  };
  const r = await apiFetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { _fbFeedback('⚠️ ' + (d.error || 'Failed')); return; }
  _fbFeedback('✓ Thank you! Sent.');
  document.getElementById('fb-title').value = '';
  document.getElementById('fb-body').value = '';
}

async function _fbRenderList() {
  const m = document.getElementById('feedback-modal');
  if (!m) return;
  m.innerHTML = '<div class="fb-modal">'
    + '<div class="fb-head"><span>🐞 Reports</span><button class="fb-close" onclick="closeFeedback()">✕</button></div>'
    + '<div class="fb-tabs"><button class="fb-tab" onclick="_fbRenderSubmit()">Submit</button>'
    + '<button class="fb-tab on" onclick="_fbRenderList()">View Reports</button></div>'
    + '<div class="fb-body" id="fb-list"><div class="fb-muted">Loading…</div></div></div>';
  try {
    const r = await apiFetch('/api/feedback');
    if (!r.ok) { document.getElementById('fb-list').innerHTML = '<div class="fb-err">Could not load (status ' + r.status + ')</div>'; return; }
    const d = await r.json();
    const rows = d.reports || [];
    const el = document.getElementById('fb-list');
    if (!rows.length) { el.innerHTML = '<div class="fb-muted">No reports yet.</div>'; return; }
    el.innerHTML = rows.map(_fbCard).join('');
  } catch (e) { document.getElementById('fb-list').innerHTML = '<div class="fb-err">' + e.message + '</div>'; }
}

function _fbCard(r) {
  const when = new Date(r.created_at).toLocaleString();
  const icon = r.kind === 'suggestion' ? '💡' : '🐞';
  const resolved = r.status === 'resolved';
  return '<div class="fb-card' + (resolved ? ' resolved' : '') + '">'
    + '<div class="fb-card-head"><span>' + icon + ' <b>' + _fbEsc(r.title) + '</b></span>'
    + '<span class="fb-meta">' + _fbEsc(r.reporter_name || 'someone') + ' · ' + when + '</span></div>'
    + (r.body ? '<div class="fb-card-body">' + _fbEsc(r.body) + '</div>' : '')
    + '<div class="fb-card-actions">'
    + '<button class="fb-mini" onclick="_fbToggle(' + r.id + ',\'' + (resolved ? 'open' : 'resolved') + '\')">' + (resolved ? '↩ Reopen' : '✓ Resolve') + '</button>'
    + '<button class="fb-mini fb-del" onclick="_fbDelete(' + r.id + ')">🗑 Delete</button>'
    + '</div></div>';
}
async function _fbToggle(id, status) { await apiFetch('/api/feedback/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); _fbRenderList(); }
async function _fbDelete(id) { if (!confirm('Delete this report?')) return; await apiFetch('/api/feedback/' + id, { method: 'DELETE' }); _fbRenderList(); }

function _fbFeedback(msg) { const el = document.getElementById('fb-feedback'); if (!el) return; el.textContent = msg; el.style.color = msg.startsWith('✓') ? '#8ecf7e' : '#e07a6a'; setTimeout(() => { if (el) el.textContent = ''; }, 3500); }
function _fbEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
