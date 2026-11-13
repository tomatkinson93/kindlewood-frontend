// ══════════════════════════════════════════════════════════════════════════
//  KWFamilies — the Families screen (docs/PHASE_1_LIFE_CYCLE.md §6).
//
//    KWFamilies.open()            a large window: family lines, the town's
//                                 chronicle, and those remembered
//    KWFamilies.open({ family })  straight to one line: its tree and record
//
//  Built on KWWindow (js/window.js). Data: GET /api/families,
//  /api/families/:id and /api/families/:id/chronicle ('all' = the town).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STAGE = { child: ['🍼', 'Child'], youth: ['🌱', 'Youth'], adult: ['', 'Adult'], elder: ['🦉', 'Elder'], deceased: ['🕯', 'Remembered'] };
  const KIND = { birth: '🍼', came_of_age: '🎓', partnership: '💕', death: '🕯', inheritance: '📜', settler: '🧳', quest: '📜', raid: '🛡', discovery: '💎', craft: '⚒' };

  const st = { lines: null, family: null, chronicle: { all: null }, more: {}, busy: false, error: null };

  async function get(path) {
    const res = await global.apiFetch(path);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Could not load that.');
    return d;
  }
  function when(at) {
    const d = new Date(at);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  // ── Pure renderers (proofs use these) ───────────────────────────────────
  function stageCounts(s) {
    const parts = [];
    if (s.adult) parts.push(`${s.adult} adult${s.adult === 1 ? '' : 's'}`);
    if (s.elder) parts.push(`${s.elder} elder${s.elder === 1 ? '' : 's'}`);
    if (s.youth) parts.push(`${s.youth} youth${s.youth === 1 ? '' : 's'}`);
    if (s.child) parts.push(`${s.child} child${s.child === 1 ? '' : 'ren'}`);
    return parts.join(' · ');
  }
  function linesHtml(lines) {
    if (!lines) return '<div class="kw-empty">Gathering the families…</div>';
    if (!lines.length) return '<div class="kw-empty">No families yet. They begin with the townsfolk you have.</div>';
    return `<div class="kwf-cards">${lines.map(f => `
      <button type="button" class="kw-box kwf-card${f.living.length ? '' : ' kwf-gone'}" data-action="family" data-id="${f.id}">
        <div class="kw-box-title">The ${esc(f.name)} family</div>
        <div class="kw-list-row-sub">${f.head ? `Head: <b>${esc(f.head.name)}</b>, ${f.head.age}` : f.living.length ? 'No grown head yet' : 'The line has ended'}</div>
        <div class="kwf-stages">${f.living.length ? esc(stageCounts(f.stages)) : ''}${f.remembered ? `${f.living.length ? ' · ' : ''}🕯 ${f.remembered} remembered` : ''}</div>
        <div class="kwf-names">${f.living.slice(0, 6).map(m => `<span class="kw-chip">${STAGE[m.stage] ? STAGE[m.stage][0] : ''} ${esc(m.name.split(' ')[0])}</span>`).join(' ')}${f.living.length > 6 ? ` <span class="kw-chip">+${f.living.length - 6}</span>` : ''}</div>
        ${f.heirlooms.length ? `<div class="kwf-heir">🗝 ${f.heirlooms.map(h => esc(h.name)).join(', ')}</div>` : ''}
        ${f.generations > 1 ? `<div class="kw-list-row-sub">${f.generations} generations</div>` : ''}
      </button>`).join('')}</div>`;
  }

  // The tree: one row per generation; couples side by side; the dead greyed.
  function treeHtml(data) {
    if (!data) return '<div class="kw-empty">Drawing the tree…</div>';
    const all = [...data.members, ...(data.partners || [])];
    const byGen = {};
    for (const m of all) (byGen[m.generation] = byGen[m.generation] || []).push(m);
    const gens = Object.keys(byGen).map(Number).sort((a, b) => a - b);
    const byId = new Map(all.map(m => [m.id, m]));
    const person = m => {
      const [icon, label] = STAGE[m.stage] || ['', ''];
      const parents = m.parent_ids.map(id => byId.get(id)).filter(Boolean).map(p => p.name.split(' ')[0]);
      return `<div class="kwf-person kwf-${esc(m.stage)}${m.outsider ? ' kwf-outsider' : ''}${m.id === data.family.head_id ? ' kwf-head' : ''}"${m.stage === 'deceased' ? ` data-action="memorial" data-id="${m.id}" role="button" tabindex="0"` : ''}>
        <div class="kwf-pname">${icon ? icon + ' ' : ''}${esc(m.name)}${m.id === data.family.head_id ? ' <span class="kw-chip good">Head</span>' : ''}</div>
        <div class="kw-list-row-sub">${m.stage === 'deceased' ? `died at ${m.age}` : `${label}, ${m.age}`}${m.outsider ? ' · married in' : ''}${parents.length ? ` · child of ${esc(parents.join(' & '))}` : ''}</div>
      </div>`;
    };
    // Order each generation so partners sit together.
    const ordered = gen => {
      const list = byGen[gen].slice().sort((a, b) => new Date(a.born_at) - new Date(b.born_at));
      const out = [], seen = new Set();
      for (const m of list) {
        if (seen.has(m.id)) continue;
        out.push(m); seen.add(m.id);
        const p = m.partner_id && byId.get(m.partner_id);
        if (p && !seen.has(p.id) && p.generation === gen) { out.push(p); seen.add(p.id); }
      }
      return out;
    };
    return `<div class="kwf-tree">${gens.map(g => `<div class="kwf-gen"><div class="kwf-gen-label">Generation ${g}</div><div class="kwf-gen-row">${ordered(g).map(person).join('')}</div></div>`).join('')}</div>`;
  }

  function chronicleHtml(entries, moreKey) {
    if (!entries) return '<div class="kw-empty">Reading the chronicle…</div>';
    if (!entries.length) return '<div class="kw-empty">Nothing written yet. Births, comings of age, partnerships and passings will be kept here.</div>';
    return `<div class="kwf-chron">${entries.map(e => `<div class="kw-list-row"><span class="kw-list-row-icon">${KIND[e.kind] || '📜'}</span><span class="kw-list-row-main">${esc(e.text)}</span><span class="kw-list-row-sub">${when(e.at)}</span></div>`).join('')}</div>
      ${moreKey ? `<div class="kwf-more"><button type="button" class="kw-btn quiet small" data-action="more" data-key="${esc(moreKey)}">Older entries</button></div>` : ''}`;
  }

  function rememberedHtml(list) {
    if (!list.length) return '<div class="kw-empty">No one has died yet.</div>';
    return list.slice().sort((a, b) => new Date(b.died_at || 0) - new Date(a.died_at || 0)).map(c => `
      <button type="button" class="kw-list-row kwf-rem" data-action="memorial" data-id="${c.id}">
        <span class="kw-list-row-icon">🕯</span>
        <span class="kw-list-row-main">${esc(c.name)}<div class="kw-list-row-sub">${esc(c.memorial || '')}</div></span>
        ${c.inheritance && c.inheritance.status === 'open' ? '<span class="kw-chip short">Things wait for an heir</span>' : ''}
      </button>`).join('');
  }

  // ── The window ───────────────────────────────────────────────────────────
  function remembered() {
    return (typeof citizensRemembered !== 'undefined' && Array.isArray(citizensRemembered)) ? citizensRemembered : [];
  }

  function render(body, state, w) {
    if (st.error) { body.innerHTML = `<div class="kw-note bad">${esc(st.error)}</div>`; return; }
    if (state.familyId) {
      const fam = st.family && st.family.family && st.family.family.id === state.familyId ? st.family : null;
      const key = 'f' + state.familyId;
      body.innerHTML = `<div class="kwf-back"><button type="button" class="kw-btn quiet small" data-action="back">‹ All families</button></div>
        ${fam ? `<h3 class="kwf-h">The ${esc(fam.family.name)} family</h3>` : ''}
        <div class="kwf-split"><section><div class="kwf-sub">Family tree</div>${treeHtml(fam)}</section>
        <section><div class="kwf-sub">Their record</div>${chronicleHtml(st.chronicle[key] || null, st.more[key])}</section></div>`;
      return;
    }
    if (state.tab === 'chronicle') { body.innerHTML = chronicleHtml(st.chronicle.all, st.more.all); return; }
    if (state.tab === 'remembered') { body.innerHTML = rememberedHtml(remembered()); return; }
    body.innerHTML = linesHtml(st.lines);
  }

  async function loadLines(w) {
    try { st.lines = (await get('/api/families')).families; st.error = null; }
    catch (e) { st.error = e.message; }
    if (w.isOpen()) w.refresh();
  }
  async function loadChronicle(w, key, more) {
    const id = key === 'all' ? 'all' : key.slice(1);
    try {
      const d = await get(`/api/families/${id}/chronicle${more ? `?before=${more}` : ''}`);
      st.chronicle[key] = more ? (st.chronicle[key] || []).concat(d.entries) : d.entries;
      st.more[key] = d.more;
    } catch (e) { st.error = e.message; }
    if (w.isOpen()) w.refresh();
  }
  async function openFamily(w, id) {
    w.state.familyId = id;
    w.refresh();
    try { st.family = await get(`/api/families/${id}`); w.setTitle('Families', `The ${st.family.family.name} family`); }
    catch (e) { st.error = e.message; }
    if (w.isOpen()) w.refresh();
    loadChronicle(w, 'f' + id);
  }

  function open(opts = {}) {
    if (!global.KWWindow) return null;
    const w = global.KWWindow.open({
      id: 'families', title: 'Families', icon: 'families', size: 'L', help: 'families',
      tabs: [{ key: 'lines', label: 'Family lines' }, { key: 'chronicle', label: 'Chronicle' }, { key: 'remembered', label: 'Remembered' }],
      tab: 'lines',
      render,
      onTab(key, win) {
        win.state.familyId = null;
        win.setTitle('Families', '');
        if (key === 'chronicle' && !st.chronicle.all) loadChronicle(win, 'all');
      },
      actions: {
        family: (el, ev, win) => openFamily(win, Number(el.getAttribute('data-id'))),
        back: (el, ev, win) => { win.state.familyId = null; win.setTitle('Families', ''); win.refresh(); },
        memorial: el => { if (global.KWLife) global.KWLife.openMemorial(Number(el.getAttribute('data-id'))); },
        more: (el, ev, win) => { const k = el.getAttribute('data-key'); loadChronicle(win, k, st.more[k]); },
      },
    });
    st.error = null;
    loadLines(w);
    if (w.tab === 'chronicle') loadChronicle(w, 'all');
    if (opts.family) openFamily(w, Number(opts.family));
    return w;
  }

  global.KWFamilies = { open, _linesHtml: linesHtml, _treeHtml: treeHtml, _chronicleHtml: chronicleHtml, _rememberedHtml: rememberedHtml, _stageCounts: stageCounts };
})(typeof window !== 'undefined' ? window : globalThis);
