// ══════════════════════════════════════════════════════════════════════════
//  CAREER TREE — a class's skill tree drawn as an actual tree (SVG).
//
//  The trunk holds the base class's perks (Lv1–10); after the fork two
//  boughs curve away left and right, one per specialisation, ending in a
//  blossom (the Lv20 capstone). Classes without a fork grow straight up.
//  Leaves are perks; their colour follows the season. The path not taken
//  goes bare and grey.
//
//  layout(cls) is pure: positions come from each node's branch, tier
//  (level) and lane — nothing is placed by hand. render() draws into a
//  container and calls back on node clicks. No fetching here
//  (js/careers.js owns the API).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const W = 1000, H = 1120;
  const ROOT = { x: 500, y: 1060 };
  const FORK = { x: 500, y: 600 };
  const LANE = 108, BOUGH_LANE = 86;

  const PALETTES = {
    spring: { leaf: '#f2a7c3', leafOwned: '#e86fa0', glow: '#ffd6e6', sky: '#1d2a22' },
    summer: { leaf: '#7fcf6a', leafOwned: '#3fa64a', glow: '#d9ffb8', sky: '#1b2a1c' },
    autumn: { leaf: '#f0a04b', leafOwned: '#d8622a', glow: '#ffe0a8', sky: '#2a2016' },
    winter: { leaf: '#bfe3ef', leafOwned: '#7fbfdc', glow: '#ecfbff', sky: '#1a2230' },
  };
  const BARK = '#6b4a2b', BARK_DARK = '#4a321c', BARE = '#5e5a55';

  // Quadratic bezier point + unit normal at t.
  function bez(p0, c, p1, t) {
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x;
    const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y;
    const dx = 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x);
    const dy = 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y);
    const len = Math.hypot(dx, dy) || 1;
    return { x, y, nx: -dy / len, ny: dx / len };
  }

  function boughCurve(side) {   // side −1 left, +1 right
    return { p0: FORK, c: { x: 500 + side * 250, y: 480 }, p1: { x: 500 + side * 330, y: 120 } };
  }

  // { nodes: { id: { x, y } }, boughs: { spec: {curve, side} }, forked }
  function layout(cls) {
    const tree = (cls && cls.tree) || [];
    const forked = !!(cls && cls.fork && cls.fork.length === 2);
    const nodes = {}, boughs = {};
    if (forked) cls.fork.forEach((f, i) => { boughs[f.key] = { curve: boughCurve(i === 0 ? -1 : 1), side: i === 0 ? -1 : 1 }; });
    // Fork trees: trunk to Lv10 then boughs. Straight trees are taller so
    // twenty levels of leaves don't crowd each other.
    const height = forked ? H : 1420;
    const root = { x: 500, y: height - 60 };
    const topTier = forked ? 10 : 20;
    const trunkTop = forked ? FORK.y : 120;
    const step = (root.y - 40 - trunkTop) / (topTier - 1);
    for (const n of tree) {
      if (n.branch === 'trunk') {
        const y = root.y - 40 - (Math.min(n.tier, topTier) - 1) * step;
        nodes[n.id] = { x: 500 + (n.capstone ? 0 : n.lane * LANE), y: n.capstone ? trunkTop - 50 : y };
      } else if (boughs[n.branch]) {
        const b = boughs[n.branch];
        // Lv11 starts well clear of the fork; Lv19 near the tip; capstone above it.
        const t = n.capstone ? 1 : 0.2 + (Math.min(19, Math.max(11, n.tier)) - 11) / 8 * 0.7;
        const p = bez(b.curve.p0, b.curve.c, b.curve.p1, t);
        const lane = n.capstone ? 0 : n.lane;
        nodes[n.id] = { x: p.x + p.nx * lane * BOUGH_LANE * b.side, y: p.y + p.ny * lane * BOUGH_LANE * b.side - (n.capstone ? 50 : 0) };
      }
    }
    return { nodes, boughs, forked, width: W, height, root };
  }

  // Node state for a class row: 'owned' | 'maxed' | 'available' | 'locked' |
  // 'closed' (other path) | 'secret' (talent not revealed).
  function stateOf(n, row, ctx) {
    const M = global.KWCareerMath;
    const rank = Number((row.nodes || {})[n.id]) || 0;
    if (n.capstone) {
      if (n.branch !== 'trunk' && row.spec && row.spec !== n.branch) return 'closed';
      return row.level >= 20 && (n.branch === 'trunk' || row.spec === n.branch) ? 'maxed' : 'locked';
    }
    if (n.branch !== 'trunk' && row.spec && row.spec !== n.branch) return 'closed';
    if (n.secret && !(ctx.revealed || []).includes(n.secret)) return rank ? 'owned' : 'secret';
    if (rank >= (n.maxRank || 1)) return 'maxed';
    const why = M ? M.buyBlocker(ctx.tree, row, n.id, ctx) : 'locked';
    if (!why) return rank ? 'owned available' : 'available';
    return rank ? 'owned' : 'locked';
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Draws the tree. opts: { cls, row, revealed, season, onNode(node), grow }
  function render(el, opts) {
    const { cls, row } = opts;
    const pal = PALETTES[opts.season] || PALETTES.summer;
    const L = layout(cls);
    const ROOT = L.root;
    const ctx = { tree: cls.tree, revealed: opts.revealed || [], now: Date.now() };
    const parts = [];
    // Ground and roots.
    parts.push(`<ellipse cx="500" cy="${ROOT.y + 18}" rx="330" ry="34" fill="${BARK_DARK}" opacity=".35"/>`);
    parts.push(`<path class="ct-root" d="M500 ${ROOT.y} C 450 ${ROOT.y + 20}, 400 ${ROOT.y + 30}, 360 ${ROOT.y + 40} M500 ${ROOT.y} C 560 ${ROOT.y + 22}, 610 ${ROOT.y + 30}, 650 ${ROOT.y + 42}" stroke="${BARK_DARK}" stroke-width="14" fill="none" stroke-linecap="round"/>`);
    // Trunk.
    const trunkTop = L.forked ? FORK.y : 90;
    const grown = Math.max(1, Math.min(20, row.level));
    parts.push(`<path class="ct-trunk" d="M500 ${ROOT.y} L500 ${trunkTop}" stroke="${BARK}" stroke-width="${L.forked ? 46 : 38}" stroke-linecap="round"/>`);
    // Boughs: the chosen path in bark, the other bare and grey.
    for (const [key, b] of Object.entries(L.boughs)) {
      const { p0, c, p1 } = b.curve;
      const closed = row.spec && row.spec !== key;
      const col = closed ? BARE : BARK;
      parts.push(`<path class="ct-bough${closed ? ' ct-bare' : ''}" data-spec="${esc(key)}" d="M${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}" stroke="${col}" stroke-width="26" fill="none" stroke-linecap="round"/>`);
    }
    // Twigs: prerequisites.
    for (const n of cls.tree) {
      const a = L.nodes[n.id];
      if (!a) continue;
      for (const r of n.requires || []) {
        const b = L.nodes[r];
        if (b) parts.push(`<line class="ct-twig" x1="${b.x}" y1="${b.y}" x2="${a.x}" y2="${a.y}" stroke="${BARK}" stroke-width="5" stroke-linecap="round" opacity=".8"/>`);
      }
      // A stalk from the leaf to its branch.
      const base = n.branch === 'trunk' ? { x: 500, y: a.y } : null;
      if (base && Math.abs(base.x - a.x) > 4) parts.push(`<line class="ct-stalk" x1="${base.x}" y1="${base.y}" x2="${a.x}" y2="${a.y}" stroke="${BARK}" stroke-width="6" stroke-linecap="round"/>`);
    }
    // Leaves.
    for (const n of cls.tree) {
      const p = L.nodes[n.id];
      if (!p) continue;
      const st = stateOf(n, row, ctx);
      const rank = Number((row.nodes || {})[n.id]) || 0;
      const secret = st === 'secret';
      const r = n.capstone ? 40 : 30;
      const owned = rank > 0 || st === 'maxed';
      const fill = st === 'closed' ? '#3d3a37' : n.capstone ? (owned ? pal.leafOwned : '#4a4038') : owned ? pal.leafOwned : st.includes('available') ? pal.leaf : '#3a4436';
      const pips = !n.capstone && (n.maxRank || 1) > 1
        ? Array.from({ length: n.maxRank }, (_, i) => `<circle cx="${p.x - (n.maxRank - 1) * 7 + i * 14}" cy="${p.y + r + 10}" r="4.5" fill="${i < rank ? pal.glow : '#2a2a2a'}" stroke="${pal.leafOwned}" stroke-width="1"/>`).join('')
        : '';
      const label = secret ? '???' : n.name;
      parts.push(`<g class="ct-node ct-${st.split(' ').join(' ct-')}${n.capstone ? ' ct-cap' : ''}${opts.grow === n.id ? ' ct-grow' : ''}" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(label)}${rank ? ', rank ' + rank : ''}">
        ${st.includes('available') ? `<circle class="ct-glow" cx="${p.x}" cy="${p.y}" r="${r + 9}" fill="${pal.glow}" opacity=".35"/>` : ''}
        <path class="ct-leaf" d="${leafPath(p.x, p.y, r, n.capstone)}" fill="${fill}" stroke="${st === 'closed' ? '#2b2926' : pal.leafOwned}" stroke-width="${owned ? 3 : 2}"/>
        <text class="ct-icon" x="${p.x}" y="${p.y + 9}" text-anchor="middle" font-size="${n.capstone ? 30 : 24}">${secret ? '✨' : esc(n.icon || '•')}</text>
        ${pips}
        <text class="ct-label" x="${p.x}" y="${p.y - r - 8}" text-anchor="middle">${esc(label)}</text>
        <text class="ct-tier" x="${p.x + r - 2}" y="${p.y - r + 8}" text-anchor="middle">${n.tier}</text>
      </g>`);
    }
    // Spec labels at the bough tips' base.
    for (const [key, b] of Object.entries(L.boughs)) {
      const f = cls.fork.find(x => x.key === key);
      const mid = bez(b.curve.p0, b.curve.c, b.curve.p1, 0.02);
      parts.push(`<text class="ct-spec${row.spec && row.spec !== key ? ' ct-bare' : ''}" x="${mid.x + b.side * 120}" y="${mid.y - 10}" text-anchor="middle">${esc(f.icon)} ${esc(f.label)}</text>`);
    }
    parts.push(`<text class="ct-level" x="500" y="${ROOT.y + 64}" text-anchor="middle">Level ${grown}</text>`);
    el.innerHTML = `<svg class="ct-svg" viewBox="0 0 ${W} ${L.height + 90}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(cls.label)} skill tree">${parts.join('')}</svg>`;
    el.querySelectorAll('.ct-node').forEach(g => {
      const pick = () => opts.onNode && opts.onNode(cls.tree.find(n => n.id === g.dataset.node), g);
      g.addEventListener('click', pick);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    return L;
  }

  // A leaf shape (or a round blossom for capstones).
  function leafPath(x, y, r, round) {
    if (round) {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2, rr = i % 2 ? r * 0.82 : r;
        pts.push(`${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`);
      }
      return 'M' + pts.join(' L') + 'Z';
    }
    return `M${x} ${y - r} C ${x + r * 1.05} ${y - r * 0.6}, ${x + r * 1.05} ${y + r * 0.6}, ${x} ${y + r} C ${x - r * 1.05} ${y + r * 0.6}, ${x - r * 1.05} ${y - r * 0.6}, ${x} ${y - r}Z`;
  }

  // Leaf burst where a perk was bought (skipped with reduced motion).
  function burst(el, nodeId, season) {
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const svg = el.querySelector('svg');
    const g = el.querySelector(`[data-node="${nodeId}"] .ct-leaf`);
    if (!svg || !g || !g.getBBox) return;
    const b = g.getBBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const pal = PALETTES[season] || PALETTES.summer;
    const ns = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 12; i++) {
      const c = document.createElementNS(ns, 'path');
      const a = (Math.PI * 2 * i) / 12;
      c.setAttribute('d', leafPath(cx, cy, 8, false));
      c.setAttribute('fill', i % 2 ? pal.leaf : pal.leafOwned);
      c.setAttribute('class', 'ct-spark');
      c.style.setProperty('--dx', `${Math.cos(a) * 70}px`);
      c.style.setProperty('--dy', `${Math.sin(a) * 70 - 20}px`);
      svg.appendChild(c);
      setTimeout(() => c.remove(), 900);
    }
  }

  // Pan & zoom: drag, wheel, pinch. Returns a reset function.
  function panZoom(viewport, content) {
    let s = 1, tx = 0, ty = 0, drag = null;
    const pts = new Map();
    const apply = () => { content.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };
    const zoomAt = (f, cx, cy) => {
      const ns = Math.max(0.6, Math.min(3, s * f));
      const r = viewport.getBoundingClientRect();
      const px = cx - r.left, py = cy - r.top;
      tx = px - (px - tx) * (ns / s); ty = py - (py - ty) * (ns / s); s = ns; apply();
    };
    viewport.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); }, { passive: false });
    viewport.addEventListener('pointerdown', e => {
      if (e.target.closest && e.target.closest('.ct-node')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX - tx, y: e.clientY - ty };
      viewport.setPointerCapture && viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const others = [...pts.entries()].find(([id]) => id !== e.pointerId)[1];
        const before = Math.hypot(prev.x - others.x, prev.y - others.y), after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 0) zoomAt(after / before, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); }
    });
    const end = e => { pts.delete(e.pointerId); if (!pts.size) drag = null; };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    return () => { s = 1; tx = 0; ty = 0; apply(); };
  }

  global.KWCareerTree = { layout, render, burst, panZoom, stateOf, PALETTES };
})(typeof window !== 'undefined' ? window : this);
