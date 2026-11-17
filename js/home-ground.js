// ══════════════════════════════════════════════════════════════════════════
//  KWGround — the Home scene's ground: dirt paths drawn by code and the
//  props layer (docs/ART_GUIDE.md §4b, docs/HOME_SCENE.md §3.4).
//
//  Paths: a soft band about 28 px wide under everything, from each door down
//  to its row's lane, the lanes joined, and the signpost on the nearest lane.
//  Redrawn when the buildings change (the villager engine's survey hands us
//  the doors; js/villager-engine.js).
//
//  Props: trees, bushes, flowers, tufts, rocks, a well, benches, lantern
//  posts, fence pieces and a pond, from assets/images/scene_v2/props/
//  manifest.json (file, on-screen size, foot point; files at 2×, smooth).
//  Scattered from a seed fixed per town, never on a path, a plot or a
//  building; depth-sorted with buildings and villagers; not clickable. The
//  manifest ships empty, so nothing is drawn until the art arrives.
//
//  The planning and scattering are pure (numbers in, numbers out) so the
//  proofs can run them (verify/scene_proofs.js §20).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const BASE = 'assets/images/scene_v2/props/';
  const PATH_W = 28;            // the band's width, px
  const LANE_DROP = 22;         // a lane runs this far below its row's doors
  const HORIZON = 0.25;         // the sky ends at 25 % of the height
  const TREELINE = [0.255, 0.31];   // the band just under the trees strip

  // What each kind of prop does: where it goes, how many (per 2600 px of
  // world), whether villagers keep off it (big), and which named spot it makes.
  const KINDS = {
    tree:    { where: 'edge',   n: [10, 16], big: true },
    bush:    { where: 'edge',   n: [8, 14] },
    fence:   { where: 'back',   n: [3, 6] },
    flower:  { where: 'meadow', n: [14, 22], small: true },
    tuft:    { where: 'meadow', n: [18, 28], small: true },
    rock:    { where: 'meadow', n: [3, 6] },
    well:    { where: 'centre', n: [1, 1], big: true, spot: 'well', town: true },
    bench:   { where: 'lane',   n: [2, 3], spot: 'bench' },
    pond:    { where: 'open',   n: [1, 1], big: true, flat: true, spot: 'pond' },
    lantern: { where: 'path',   every: 340 },
  };

  // ── Seeds ──────────────────────────────────────────────────────────────
  function seeded(n) {
    let a = (n >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ── Paths ──────────────────────────────────────────────────────────────
  // doors: [{ x, y }] and exits (signposts): [{ x, y }], in layer pixels.
  // → segments [{ x1, y1, x2, y2 }]: each door down to its lane, each lane
  // from its first door to its last, the lanes joined, each exit to the
  // nearest lane.
  function planPaths({ doors = [], exits = [], h = 600 } = {}) {
    const segs = [];
    if (!doors.length) return segs;
    // Rows: doors whose feet are within 10 % of the height of each other.
    const rows = [];
    doors.slice().sort((a, b) => a.y - b.y).forEach(d => {
      const r = rows.find(r => Math.abs(r.y - d.y) < h * 0.1);
      if (r) { r.doors.push(d); r.y = Math.max(r.y, d.y); } else rows.push({ y: d.y, doors: [d] });
    });
    rows.forEach(r => {
      r.lane = r.y + LANE_DROP;
      r.x1 = Math.min(...r.doors.map(d => d.x)); r.x2 = Math.max(...r.doors.map(d => d.x));
      r.doors.forEach(d => segs.push({ x1: d.x, y1: d.y, x2: d.x, y2: r.lane, kind: 'door' }));
    });
    // Lanes joined, back to front: at the middle of where they overlap, or
    // by stretching the nearer lane to the other's end.
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      const lo = Math.max(a.x1, b.x1), hi = Math.min(a.x2, b.x2);
      let x;
      if (lo <= hi) x = (lo + hi) / 2;
      else { x = a.x2 < b.x1 ? b.x1 : b.x2; a.x1 = Math.min(a.x1, x); a.x2 = Math.max(a.x2, x); }
      segs.push({ x1: x, y1: a.lane, x2: x, y2: b.lane, kind: 'join' });
    }
    // Exits: along the nearest lane to below the signpost, then up to it.
    exits.forEach(e => {
      const r = rows.reduce((best, r) => (Math.abs(r.lane - e.y) < Math.abs(best.lane - e.y) ? r : best), rows[0]);
      r.x1 = Math.min(r.x1, e.x); r.x2 = Math.max(r.x2, e.x);
      if (Math.abs(e.y - r.lane) > 1) segs.push({ x1: e.x, y1: r.lane, x2: e.x, y2: e.y, kind: 'exit' });
    });
    rows.forEach(r => { if (r.x2 > r.x1) segs.push({ x1: r.x1, y1: r.lane, x2: r.x2, y2: r.lane, kind: 'lane' }); });
    return segs;
  }
  // Distance from a point to a segment.
  function segDist(s, x, y) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / L)) : 0;
    return Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy));
  }
  const onPath = (segs, x, y, pad = 0) => segs.some(s => segDist(s, x, y) < PATH_W / 2 + pad);
  // The SVG path data for the segments.
  const pathD = segs => segs.map(s => `M${s.x1.toFixed(1)} ${s.y1.toFixed(1)}L${s.x2.toFixed(1)} ${s.y2.toFixed(1)}`).join('');

  // ── Props ──────────────────────────────────────────────────────────────
  // The ground a prop covers: a box at its foot, 80 % of its width and a
  // quarter of its height (at least 10 px); all of it for a flat thing (the pond).
  function base(p) {
    const bw = p.w * 0.8, bh = p.flat ? p.h : Math.max(10, p.h * 0.25);
    return { l: p.x - bw / 2, r: p.x + bw / 2, t: p.y - bh, b: p.y };
  }
  const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  // Plots: the ground a building slot claims, whether built or not, with its
  // doorstep and nameplate.
  const plotBox = q => ({ l: q.x - 115, r: q.x + 115, t: q.y - 210, b: q.y + 44 });

  // manifest: { props: { key: { file, w, h, foot: [x, y], kind, lit? } } }.
  // → [{ key, kind, x, y (the foot), w, h, file, lit, fx, fy }].
  // `skip`: kinds the player has placed themselves (js/decor.js): none of those is scattered.
  function scatter({ manifest, seed = 1, w = 2600, h = 600, area = 'town', segs = [], plots = [], blocks = [], skip = [] } = {}) {
    const defs = Object.entries((manifest && manifest.props) || {}).filter(([key, d]) => d && KINDS[d.kind] && d.w > 0 && d.h > 0 && !skip.includes(d.kind) && key.indexOf('decor_') !== 0);
    if (!defs.length) return [];
    const rand = seeded(seed);
    const R = (a, b) => a + rand() * (b - a);
    const scale = w / 2600;
    const placed = [];
    const no = [...plots.map(plotBox), ...blocks];
    const fits = (p, small) => {
      const b = base(p);
      if (b.l < 0 || b.r > w || b.b > h || b.t < h * HORIZON) return false;
      if (no.some(o => overlap(b, o))) return false;
      const corners = [[b.l, b.b], [b.r, b.b], [p.x, b.b], [b.l, b.t], [b.r, b.t]];
      if (corners.some(([x, y]) => onPath(segs, x, y, 2))) return false;
      return !placed.some(q => (small && q.small) ? Math.hypot(q.x - p.x, q.y - p.y) < 18 : overlap(b, base(q)));
    };
    const lanes = segs.filter(s => s.kind === 'lane');
    const where = {
      edge: () => rand() < 0.7 ? [R(0, w), R(TREELINE[0], TREELINE[1]) * h] : [rand() < 0.5 ? R(0, w * 0.035) : R(w * 0.965, w), R(TREELINE[0] * h, h)],
      back: () => [rand() < 0.5 ? R(w * 0.01, w * 0.12) : R(w * 0.88, w * 0.99), R(TREELINE[0], TREELINE[1] + 0.02) * h],
      meadow: () => [R(w * 0.02, w * 0.98), R(TREELINE[1] + 0.02, 0.99) * h],
      open: () => [R(w * 0.06, w * 0.94), R(TREELINE[1] + 0.06, 0.95) * h],
      centre: tries => {
        if (tries > 20) return where.lane();   // no room in the middle: beside a lane
        const j = segs.find(s => s.kind === 'join');
        const cx = j ? j.x1 : w / 2, cy = j ? (j.y1 + j.y2) / 2 : h * 0.72;
        return [cx + R(-180, 180), cy + R(-40, 60)];
      },
      lane: () => {
        if (!lanes.length) return where.meadow();
        const s = lanes[Math.floor(rand() * lanes.length)];
        return [R(s.x1, s.x2), s.y1 + (rand() < 0.5 ? -1 : 1) * R(PATH_W / 2 + 14, PATH_W / 2 + 26)];
      },
    };
    const make = (key, d, x, y) => ({ key, kind: d.kind, x: Math.round(x), y: Math.round(y), w: d.w, h: d.h, file: d.file, lit: d.lit || null,
      fx: d.foot ? d.foot[0] : d.w / 2, fy: d.foot ? d.foot[1] : d.h, big: !!KINDS[d.kind].big, small: !!KINDS[d.kind].small, flat: !!KINDS[d.kind].flat });
    // Big things first, so the small ones fill round them.
    const order = ['well', 'pond', 'tree', 'bench', 'lantern', 'fence', 'rock', 'bush', 'flower', 'tuft'];
    order.forEach(kind => {
      const k = KINDS[kind];
      if (k.town && area !== 'town') return;
      const opts = defs.filter(([, d]) => d.kind === kind);
      if (!opts.length) return;
      const pick = () => opts[Math.floor(rand() * opts.length)];
      if (kind === 'lantern') {   // along each lane, just above it, every so often
        lanes.forEach(s => {
          for (let x = s.x1 + k.every / 2; x < s.x2; x += k.every) {
            const [key, d] = pick();
            const p = make(key, d, x, s.y1 - PATH_W / 2 - 4);
            if (fits(p)) placed.push(p);
          }
        });
        return;
      }
      const n = Math.round(R(k.n[0], k.n[1]) * (k.n[0] === k.n[1] ? 1 : scale));
      for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
        const [key, d] = pick();
        const [x, y] = where[k.where](tries);
        const p = make(key, d, x, y);
        if (fits(p, k.small)) { placed.push(p); i++; }
      }
    });
    return placed;
  }

  // Named spots from props: in front of the well and the benches, at the
  // pond's near edge. → [{ id, x, y }].
  function spotsOf(props) {
    const n = {};
    return props.filter(p => KINDS[p.kind] && KINDS[p.kind].spot).map(p => {
      const s = KINDS[p.kind].spot; n[s] = (n[s] || 0) + 1;
      return { id: s + (n[s] > 1 ? '-' + n[s] : ''), x: p.x, y: p.y + (s === 'bench' ? 10 : 24) };
    });
  }
  // Where villagers don't stop: the big props' ground, with room round it.
  const blocksOf = props => props.filter(p => p.big).map(p => { const b = base(p); return { l: b.l - 10, r: b.r + 10, t: b.t - 10, b: b.b + 6 }; });

  // ── The manifest ───────────────────────────────────────────────────────
  let manifest = null, loading = null;
  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (loading) return loading;
    if (typeof global.fetch !== 'function') return Promise.resolve(manifest = { props: {} });
    loading = global.fetch(BASE + 'manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { props: {} }))
      .catch(() => ({ props: {} })).then(m => (manifest = m && m.props ? m : { props: {} }));
    return loading;
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const depth = (y, h) => Math.max(1, Math.min(1000, Math.round(y / (h || 1) * 1000)));
  function townSeed(area) {
    let id = null;
    try { const gd = typeof gameData !== 'undefined' ? gameData : global.gameData; id = gd && gd.settlement && (gd.settlement.id || gd.settlement.name); } catch (_) {}   // eslint-disable-line no-undef
    return hash((id || 'kindlewood') + '|' + area);
  }
  function pathsSvg(segs, w, h) {
    const d = pathD(segs);
    return `<svg class="kwg-paths" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">`
      + (d ? `<path d="${d}" stroke-width="${PATH_W + 8}" class="kwg-edge"/><path d="${d}" stroke-width="${PATH_W - 6}" class="kwg-core"/>` : '') + '</svg>';
  }
  function propHtml(p, h) {
    const st = `left:${p.x - p.fx}px;top:${p.y - p.fy}px;width:${p.w}px;height:${p.h}px;z-index:${depth(p.y, h)}`;
    return `<span class="kwg-prop kwg-${esc(p.kind)}" style="${st}" aria-hidden="true">`
      + `<img src="${BASE + esc(p.file)}" class="kwh-img kwh-day" alt="" draggable="false">`
      + (p.lit ? `<img src="${BASE + esc(p.lit)}" class="kwh-img kwh-lit" alt="" draggable="false" loading="lazy">` : '') + '</span>';
  }

  // Called by the villager engine whenever it surveys an area (doors and
  // exits in layer pixels). Redraws only when something moved. → { spots, blocks }.
  const last = new WeakMap();   // layer → { key, spots, blocks }
  function sync({ layer, area = 'town', doors = [], exits = [], blocks = [], w, h }) {
    if (!layer || !doc) return { spots: [], blocks: [] };
    const plots = [...layer.querySelectorAll(':scope > .sv-slot')].filter(s => !s.hidden && !s.querySelector('.kwh-prop'))
      .map(s => ({ x: parseFloat(s.style.left) / 100 * w, y: parseFloat(s.style.top) / 100 * h })).filter(q => isFinite(q.x) && isFinite(q.y));
    const skip = global.KWDecor && global.KWDecor.placedKinds ? global.KWDecor.placedKinds() : [];
    const key = [w, h, area, manifest ? 1 : 0, skip.join('+'), ...doors.map(d => d.x.toFixed(0) + ',' + d.y.toFixed(0)), ...exits.map(d => d.x.toFixed(0) + ',' + d.y.toFixed(0)), ...plots.map(q => q.x.toFixed(0) + ',' + q.y.toFixed(0))].join('|');
    const was = last.get(layer);
    if (was && was.key === key && layer.querySelector(':scope > .kwg-paths')) return was;   // (a re-render empties the layer)
    const segs = planPaths({ doors, exits, h });
    const props = scatter({ manifest, seed: townSeed(area), w, h, area, segs, plots, blocks, skip });
    layer.querySelectorAll(':scope > .kwg-paths, :scope > .kwg-prop').forEach(el => el.remove());
    layer.insertAdjacentHTML('afterbegin', pathsSvg(segs, w, h) + props.map(p => propHtml(p, h)).join(''));
    const out = { key, segs, props, spots: spotsOf(props), blocks: blocksOf(props) };
    last.set(layer, out);
    if (!manifest) loadManifest().then(() => { last.delete(layer); if (global.KWCast && global.KWCast.resurvey) global.KWCast.resurvey(); });
    return out;
  }

  // A picture from the props manifest by its key, for the things code draws
  // itself until their art arrives (a lost ribbon, the merchant's cart, a
  // puddle…): → { w, h, html } or null. An entry needs `file`, `w` and `h`
  // (on-screen pixels); one with no `kind` is never scattered as scenery.
  function picture(key, cls) {
    const m = manifest && manifest.props && manifest.props[key];
    if (!m || !m.file || !(m.w > 0) || !(m.h > 0)) return null;
    return { w: m.w, h: m.h, html: `<img src="${BASE + esc(m.file)}" class="kwh-img kwh-day${cls ? ' ' + esc(cls) : ''}" alt="" draggable="false" style="width:${m.w}px;height:${m.h}px">` };
  }

  global.KWGround = {
    KINDS, PATH_W, LANE_DROP, BASE, sync, loadManifest, picture,
    planPaths, scatter, spotsOf, blocksOf, onPath, segDist, base, plotBox, seeded, hash, pathD,
    get manifest() { return manifest; }, _setManifest: m => { manifest = m; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
