// ══════════════════════════════════════════════════════════════════════════
//  KWRaidLayer — a Withered raid on its way, on the world map (uifx canvas)
//
//  A glowing red trail from where the raiders gather (their camp or village)
//  to the spot they will strike, dashes marching toward it, a 🔥 that creeps
//  along the trail as the countdown runs, and a pulsing red ring on the
//  target tile.
//
//  Data: window.KWRaids.state().raid (js/raids.js) — from_at / target_at
//  tiles, warned_at / arrives_at. Called once per frame from
//  KWMap.controller.renderFrame after the travel layer. Works in both views
//  through renderer.projectAxial().
//
//  Proof rules (MAP_RENDERER.md): no network calls and no unseeded randomness
//  in kwmap-* files; with no raid on its way draw() returns without touching
//  the context.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const RED = '#d8321e', GLOW = 'rgba(255,70,40,0.35)';

  // The wrapped copy of the trail nearest the screen centre (drawn once).
  function trail(from, to, renderer, cam, W, H) {
    const MW = typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40, MH = typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40;
    // Shortest way across the wrap from `from` to `to`.
    let dq = to.q - from.q, dr = to.r - from.r;
    if (dq > MW / 2) dq -= MW; else if (dq < -MW / 2) dq += MW;
    if (dr > MH / 2) dr -= MH; else if (dr < -MH / 2) dr += MH;
    let best = null, bestD = Infinity;
    for (let kq = -1; kq <= 1; kq++) for (let kr = -1; kr <= 1; kr++) {
      const oq = from.q + kq * MW, or = from.r + kr * MH;
      const m = renderer.projectAxial(oq + dq / 2, or + dr / 2, cam, W, H);
      const d = (m.x - W / 2) ** 2 + (m.y - H / 2) ** 2;
      if (d < bestD) { bestD = d; best = { oq, or }; }
    }
    const a = renderer.projectAxial(best.oq, best.or, cam, W, H);
    const b = renderer.projectAxial(best.oq + dq, best.or + dr, cam, W, H);
    return { a, b, hexW: b.hexW || a.hexW || 48 };
  }

  function draw(ctx, W, H, renderer, cam, now) {
    const R = global.KWRaids && global.KWRaids.state && global.KWRaids.state();
    const raid = R && R.raid;
    if (!raid || raid.resolved_at || !raid.target_at || !renderer || !renderer.projectAxial) return;
    const from = raid.from_at || raid.target_at;
    const t = trail(from, raid.target_at, renderer, cam, W, H);
    const scale = Math.max(0.7, Math.min(1.5, t.hexW / 48));
    const anim = now || 0;
    const warned = Date.parse(raid.warned_at) || Date.now(), arrives = Date.parse(raid.arrives_at) || Date.now();
    const f = Math.max(0, Math.min(1, (Date.now() - warned) / Math.max(1, arrives - warned)));
    const reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (from !== raid.target_at) {
      // Glow, then marching red dashes toward the target.
      ctx.strokeStyle = GLOW; ctx.lineWidth = 9 * scale;
      ctx.beginPath(); ctx.moveTo(t.a.x, t.a.y); ctx.lineTo(t.b.x, t.b.y); ctx.stroke();
      ctx.setLineDash([10 * scale, 7 * scale]);
      ctx.lineDashOffset = reduced ? 0 : -((anim / 40) % (17 * scale));
      ctx.strokeStyle = RED; ctx.lineWidth = 3 * scale;
      ctx.beginPath(); ctx.moveTo(t.a.x, t.a.y); ctx.lineTo(t.b.x, t.b.y); ctx.stroke();
      ctx.setLineDash([]);
      // The raiders, creeping along as the clock runs down.
      const x = t.a.x + (t.b.x - t.a.x) * f, y = t.a.y + (t.b.y - t.a.y) * f;
      ctx.fillStyle = 'rgba(40,8,4,0.85)';
      ctx.beginPath(); ctx.arc(x, y, 11 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = RED; ctx.lineWidth = 2 * scale; ctx.stroke();
      ctx.font = `${Math.round(13 * scale)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🔥', x, y + 1);
    }
    // A pulsing ring on the spot they will strike.
    const pulse = reduced ? 0.5 : (Math.sin(anim / 260) + 1) / 2;
    ctx.strokeStyle = `rgba(216,50,30,${0.55 + 0.4 * pulse})`;
    ctx.lineWidth = (3 + 2 * pulse) * scale;
    ctx.beginPath(); ctx.arc(t.b.x, t.b.y, t.hexW * (0.42 + 0.08 * pulse), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  global.KWRaidLayer = { draw, _trail: trail };
})(typeof window !== 'undefined' ? window : globalThis);
