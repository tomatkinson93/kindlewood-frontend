// ══════════════════════════════════════════════════════════════════════════
//  KWPhoto — photo mode (docs/HOME_SCENE.md Part F, F.10; step 24).
//
//  A camera chip on Home. While it is on, the interface over the scene is
//  hidden, a small bar lets the player choose the time of day and the
//  weather for the picture, and "Save picture" saves the view as an image
//  with the town's name in a corner.
//
//  Nothing in the game changes: the time and weather are a look held on
//  this device (KWCast.preview, KWWeather.preview), put back on Done.
//
//  The picture is painted on a canvas from what the scene is showing: every
//  picture, drawing and sprite in the world, in the order the page stacks
//  them, then the evening's tint, the lit windows and the weather. It is
//  our own painter (no library), so it knows the scene's parts by name;
//  something new in the scene that is not a picture, a drawing or one of
//  the kinds below will be missing from photos until it is added to KIND.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const PHASES = [['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']];
  const SKIES = [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['snow', 'Snow']];
  const MAX_PIXELS = 8000000;   // the saved picture is at most about this many pixels
  const S = { on: false, phase: null, sky: null, busy: false };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // Paint order: the page's own. Things with a lower z come first; equal z
  // keeps the order they are in the page. `items`: [{ z, order }].
  const paintOrder = items => items.slice().sort((a, b) => (a.z - b.z) || (a.order - b.order));
  // How much bigger than the screen the picture is drawn: the device's own
  // sharpness, to at most 2, and less for a very large view.
  function scaleFor(w, h, dpr) {
    let k = Math.max(1, Math.min(2, Number(dpr) || 1));
    if (w * h * k * k > MAX_PIXELS) k = Math.max(1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    return Math.round(k * 100) / 100;
  }
  // "linear-gradient(rgb(…) 0%, rgb(…) 18%, …)" → [[0, 'rgb(…)'], …].
  function gradientStops(css) {
    const out = [], re = /(rgba?\([^)]+\))\s+([\d.]+)%/g;
    let m;
    while ((m = re.exec(String(css || '')))) out.push([Math.max(0, Math.min(1, Number(m[2]) / 100)), m[1]]);
    return out;
  }
  // A safe file name: kindlewood-<town>-<yyyy-mm-dd>.png
  function fileName(town, date) {
    const slug = String(town || 'town').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'town';
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return `kindlewood-${slug}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.png`;
  }
  // What a thing in the world is, for the painter. `el`: an element. → a kind or null.
  function kindOf(el) {
    const t = el.tagName, c = el.classList;
    if (t === 'IMG') return 'img';
    if (t === 'CANVAS') return 'canvas';
    if (t === 'svg' || t === 'SVG') return 'svg';
    if (!c) return null;
    if (c.contains('kwv-sprite')) return 'sprite';
    if (c.contains('kwv-shadow')) return 'shadow';
    if (c.contains('sv-bd-sky')) return 'sky';
    if (c.contains('sv-bd')) return 'strip';
    if (c.contains('sv-night') || c.contains('kww-tint')) return 'fill';
    if (c.contains('kww-ground')) return 'snow-ground';
    if (c.contains('kww-cloud')) return 'cloud';
    if (c.contains('kww-puddle')) return 'puddle';
    if (c.contains('kwa-smoke') || c.contains('kwa-dust')) return 'puff';
    if (c.contains('kwa-firefly') || c.contains('kwa-spark') || c.contains('kwa-seed') || c.contains('kwa-blossom') || c.contains('kwa-leaf') || c.contains('kwa-butterfly')) return 'dot';
    if (c.contains('kwd-glow') || c.contains('kwa-forge')) return 'glow';
    if (c.contains('kwl-icon')) return 'emoji';
    return null;
  }
  const KIND = ['img', 'canvas', 'svg', 'sprite', 'shadow', 'sky', 'strip', 'fill', 'snow-ground', 'cloud', 'puddle', 'puff', 'dot', 'glow', 'emoji'];

  // ── The painter ─────────────────────────────────────────────────────────
  const images = new Map();
  function loadImage(url) {
    if (images.has(url)) return images.get(url);
    const p = new Promise(res => { const im = new global.Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
    images.set(url, p);
    return p;
  }
  const urlOf = css => { const m = /url\((['"]?)(.*?)\1\)/.exec(String(css || '')); return m ? m[2] : null; };
  // A drawing as a picture: the styles the page gives it by class are written onto a copy.
  function svgUrl(svg) {
    const copy = svg.cloneNode(true), from = [svg, ...svg.querySelectorAll('*')], to = [copy, ...copy.querySelectorAll('*')];
    from.forEach((el, i) => {
      const cs = global.getComputedStyle(el), t = to[i];
      for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'stroke-dasharray']) { const v = cs.getPropertyValue(p); if (v) t.style.setProperty(p, v); }
    });
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const r = svg.getBoundingClientRect();
    if (!copy.getAttribute('viewBox') && svg.getAttribute('width')) copy.setAttribute('viewBox', `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`);
    copy.setAttribute('width', Math.max(1, Math.round(r.width * 2))); copy.setAttribute('height', Math.max(1, Math.round(r.height * 2)));
    copy.removeAttribute('class'); copy.style.overflow = 'visible';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new global.XMLSerializer().serializeToString(copy));
  }
  // Everything to paint, in the page's order. `box`: the part of the screen being photographed.
  function collect(world, box) {
    const out = [], cs = el => global.getComputedStyle(el);
    let order = 0;
    const walk = (el, z, alpha, blend, filter) => {
      for (const ch of el.children) {
        const s = cs(ch);
        if (s.display === 'none' || s.visibility === 'hidden' || ch.hidden) continue;
        const a = alpha * (Number(s.opacity) || 0);
        if (a < 0.02) continue;
        // The outermost thing with its own z sorts its whole inside.
        const zi = z == null && s.zIndex !== 'auto' && s.position !== 'static' ? Number(s.zIndex) || 0 : z;
        const bl = s.mixBlendMode && s.mixBlendMode !== 'normal' ? s.mixBlendMode : blend;
        const fl = s.filter && s.filter !== 'none' && s.filter.indexOf('url(') < 0 ? (filter ? filter + ' ' : '') + s.filter : filter;
        const kind = kindOf(ch);
        if (kind) {
          const r = ch.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom || kind === 'fill' || kind === 'sky')
            out.push({ el: ch, kind, z: zi == null ? 0 : zi, order: order++, alpha: a, blend: bl || null, filter: fl || null, style: s });
          if (kind === 'svg' || kind === 'img' || kind === 'canvas' || kind === 'sprite') continue;
        }
        walk(ch, zi, a, bl, fl);
      }
    };
    walk(world, null, 1, null, null);
    return paintOrder(out);
  }
  async function prepare(items) {
    await Promise.all(items.map(async it => {
      if (it.kind === 'svg') it.img = await loadImage(svgUrl(it.el));
      else if (it.kind === 'sprite' || it.kind === 'strip') { const u = urlOf(it.style.backgroundImage); it.img = u ? await loadImage(u) : null; }
    }));
  }
  const px = v => parseFloat(v) || 0;
  function draw(ctx, it, box) {
    const el = it.el, r = el.getBoundingClientRect(), s = it.style;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, it.alpha));
    if (it.blend === 'multiply' || it.blend === 'screen') ctx.globalCompositeOperation = it.blend;
    if (it.filter && 'filter' in ctx) ctx.filter = it.filter;
    try {
      if (it.kind === 'img') { if (el.complete && el.naturalWidth) ctx.drawImage(el, r.left, r.top, r.width, r.height); }
      else if (it.kind === 'canvas') { if (el.width && el.height) ctx.drawImage(el, r.left, r.top, r.width, r.height); }
      else if (it.kind === 'svg') { if (it.img) ctx.drawImage(it.img, r.left, r.top, r.width, r.height); }
      else if (it.kind === 'sprite') {
        if (it.img) {
          const [bw, bh] = String(s.backgroundSize).split(' ').map(px), [bx, by] = String(s.backgroundPosition).split(' ').map(px);
          const w = el.offsetWidth, h = el.offsetHeight, fx = it.img.naturalWidth / (bw || it.img.naturalWidth), fy = it.img.naturalHeight / (bh || it.img.naturalHeight);
          ctx.imageSmoothingEnabled = s.imageRendering !== 'pixelated' && s.imageRendering !== 'crisp-edges';
          if (el.classList.contains('kwv-flip')) { ctx.translate(r.left + r.right, 0); ctx.scale(-1, 1); }
          ctx.drawImage(it.img, -bx * fx, -by * fy, w * fx, h * fy, r.left, r.top, r.width, r.height);
        }
      } else if (it.kind === 'shadow') {
        ctx.fillStyle = 'rgba(30, 22, 12, 0.28)'; ctx.beginPath(); ctx.ellipse(r.left + r.width / 2, r.top + r.height / 2, r.width / 2, r.height / 2, 0, 0, 6.2832); ctx.fill();
      } else if (it.kind === 'sky') {
        const stops = gradientStops(s.backgroundImage), g = ctx.createLinearGradient(0, r.top, 0, r.bottom);
        if (stops.length) { stops.forEach(([p, c]) => g.addColorStop(p, c)); ctx.fillStyle = g; ctx.fillRect(box.left, r.top, box.width, r.height); }
      } else if (it.kind === 'strip') {
        if (it.img) {
          const k = el.offsetWidth ? r.width / el.offsetWidth : 1, [bw, bh] = String(s.backgroundSize).split(' ').map(px);
          const tw = (bw || it.img.naturalWidth) * k, th = (bh || it.img.naturalHeight) * k, rows = /repeat-x/.test(s.backgroundRepeat) ? 1 : Math.ceil(r.height / th);
          const x0 = r.left + Math.floor((box.left - r.left) / tw) * tw;
          for (let y = 0; y < rows; y++) for (let x = x0; x < box.right; x += tw) {
            const ty = r.top + y * th;
            if (ty > box.bottom || ty + th < box.top) continue;
            ctx.drawImage(it.img, x, ty, tw + 0.5, th + 0.5);
          }
        }
      } else if (it.kind === 'fill') {
        ctx.fillStyle = s.backgroundColor; ctx.fillRect(box.left, box.top, box.width, box.height);
      } else if (it.kind === 'snow-ground') {
        const g = ctx.createLinearGradient(0, r.top, 0, r.bottom); g.addColorStop(0, 'rgba(250,252,255,0)'); g.addColorStop(0.07, 'rgba(250,252,255,0.5)'); g.addColorStop(1, 'rgba(250,252,255,0.5)');
        ctx.fillStyle = g; ctx.fillRect(box.left, r.top, box.width, r.height);
      } else if (it.kind === 'cloud') {
        ctx.fillStyle = '#fff';
        const w = r.width, h = r.height, e = (cx, cy, rx, ry) => { ctx.beginPath(); ctx.ellipse(r.left + cx * w, r.top + cy * h, rx * w, ry * h, 0, 0, 6.2832); ctx.fill(); };
        e(0.5, 0.55, 0.5, 0.45); e(0.33, 0.15, 0.2, 0.75); e(0.64, -0.1, 0.22, 0.9);
        ctx.fillStyle = 'rgba(176, 200, 226, 0.6)'; ctx.beginPath(); ctx.ellipse(r.left + w * 0.5, r.top + h * 0.86, w * 0.42, h * 0.14, 0, 0, 6.2832); ctx.fill();
      } else if (it.kind === 'puddle' || it.kind === 'puff' || it.kind === 'glow') {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const col = it.kind === 'puddle' ? ['rgba(196,222,244,0.85)', 'rgba(120,160,200,0)'] : it.kind === 'glow' ? ['rgba(255,214,120,0.9)', 'rgba(255,160,60,0)'] : ['rgba(244,240,232,0.9)', 'rgba(244,240,232,0)'];
        ctx.translate(cx, cy); ctx.scale(1, r.height / r.width); ctx.translate(-cx, -cy);
        const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.width / 2); g2.addColorStop(0, col[0]); g2.addColorStop(1, col[1]);
        ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cx, cy, r.width / 2, 0, 6.2832); ctx.fill();
      } else if (it.kind === 'dot') {
        ctx.fillStyle = s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? s.backgroundColor : '#ffd35c';
        ctx.beginPath(); ctx.arc(r.left + r.width / 2, r.top + r.height / 2, Math.max(1.5, Math.min(r.width, r.height) / 2), 0, 6.2832); ctx.fill();
      } else if (it.kind === 'emoji') {
        ctx.font = `${Math.round(r.height)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(el.textContent || '', r.left + r.width / 2, r.bottom);
      }
    } catch (_) { /* one thing that would not paint must not lose the picture */ }
    ctx.restore();
  }
  // Rain or snow over the picture, as on screen.
  function fall(ctx, box, kind) {
    if (kind !== 'rain' && kind !== 'snow') return;
    let a = 12345;
    const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    ctx.save();
    if (kind === 'rain') {
      ctx.strokeStyle = 'rgba(219, 234, 255, 0.6)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.beginPath();
      for (let i = 0, n = Math.round(box.width * box.height / 5200); i < n; i++) { const x = box.left + rnd() * box.width, y = box.top + rnd() * box.height; ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 20); }
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      for (let i = 0, n = Math.round(box.width * box.height / 4200); i < n; i++) { ctx.beginPath(); ctx.arc(box.left + rnd() * box.width, box.top + rnd() * box.height, 1.2 + rnd() * 1.8, 0, 6.2832); ctx.fill(); }
    }
    ctx.restore();
  }
  // The town's name in a corner.
  function caption(ctx, box, town) {
    ctx.save();
    const g = ctx.createLinearGradient(0, box.bottom - 70, 0, box.bottom);
    g.addColorStop(0, 'rgba(20, 14, 8, 0)'); g.addColorStop(1, 'rgba(20, 14, 8, 0.55)');
    ctx.fillStyle = g; ctx.fillRect(box.left, box.bottom - 70, box.width, 70);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'; ctx.shadowBlur = 4;
    ctx.fillStyle = '#f6e7c1'; ctx.font = "600 22px 'Cinzel', Georgia, serif"; ctx.fillText(String(town || 'Kindlewood'), box.left + 16, box.bottom - 16);
    ctx.textAlign = 'right'; ctx.font = "500 13px 'Cinzel', Georgia, serif"; ctx.fillStyle = 'rgba(246, 231, 193, 0.85)'; ctx.fillText('Kindlewood', box.right - 16, box.bottom - 16);
    ctx.restore();
  }
  // The view as a canvas.
  async function capture() {
    const sc = doc.getElementById('sv-scene'), world = doc.getElementById('sv-world');
    if (!sc || !world) return null;
    const r = sc.getBoundingClientRect();
    const box = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(global.innerWidth, r.right), bottom: Math.min(global.innerHeight, r.bottom) };
    box.width = box.right - box.left; box.height = box.bottom - box.top;
    if (box.width < 10 || box.height < 10) return null;
    const k = scaleFor(box.width, box.height, global.devicePixelRatio), cv = doc.createElement('canvas');
    cv.width = Math.round(box.width * k); cv.height = Math.round(box.height * k);
    const ctx = cv.getContext('2d');
    const items = collect(world, box);
    await prepare(items);
    ctx.scale(k, k); ctx.translate(-box.left, -box.top);
    ctx.fillStyle = '#bfe0f7'; ctx.fillRect(box.left, box.top, box.width, box.height);
    for (const it of items) draw(ctx, it, box);   // one pass, so nobody moves between two strokes
    fall(ctx, box, global.KWWeather ? global.KWWeather.now() : 'clear');
    const g = global.gameData;
    caption(ctx, box, g && g.settlement && g.settlement.name);
    return cv;
  }
  async function save() {
    if (S.busy) return;
    S.busy = true; paintBar();
    try {
      const cv = await capture();
      if (!cv) { toast('⚠️ There is nothing to photograph yet.'); return; }
      const g = global.gameData, name = fileName(g && g.settlement && g.settlement.name, new Date());
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      if (!blob) { toast('⚠️ The picture could not be made on this device.'); return; }
      // A phone shares it (to Photos, a message…); a computer downloads it.
      const nav = global.navigator, coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
      if (coarse && nav && nav.canShare && global.File) {
        const file = new global.File([blob], name, { type: 'image/png' });
        if (nav.canShare({ files: [file] })) { try { await nav.share({ files: [file], title: 'Kindlewood' }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      }
      const url = global.URL.createObjectURL(blob), a = doc.createElement('a');
      a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => global.URL.revokeObjectURL(url), 30000);
      toast('📷 Picture saved: ' + name, 'success');
    } catch (_) { toast('⚠️ The picture could not be made. Try again.'); } finally { S.busy = false; paintBar(); }
  }

  // ── Photo mode ──────────────────────────────────────────────────────────
  const view = () => doc.getElementById('settlement-view');
  function look() {
    const C = global.KWCast, A = global.KWAmbient, W = global.KWWeather;
    if (C && C.preview) C.preview(S.phase);
    if (A && A.preview) A.preview(S.phase);
    if (W && W.preview) W.preview(S.sky);
  }
  function paintBar() {
    const v = view();
    if (!v) return;
    let bar = v.querySelector(':scope > .kwph-bar');
    if (!S.on) { if (bar) bar.remove(); return; }
    if (!bar) { bar = doc.createElement('div'); bar.className = 'kwph-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Photo mode'); v.appendChild(bar); }
    const C = global.KWCast, W = global.KWWeather, ph = S.phase || (C && C.phase) || 'day', sky = S.sky || (W ? W.now() : 'clear');
    const group = (label, list, cur, attr) => `<div class="kwph-group" role="group" aria-label="${label}"><span>${label}</span>`
      + list.map(([k, t]) => `<button type="button" data-kwph-${attr}="${k}" aria-pressed="${k === cur}">${t}</button>`).join('') + '</div>';
    const html = group('Time', PHASES, ph, 'phase') + group('Weather', SKIES, sky, 'sky')
      + `<div class="kwph-group kwph-acts"><button type="button" class="kwph-save" data-kwph-save${S.busy ? ' disabled' : ''}>📷 ${S.busy ? 'Saving…' : 'Save picture'}</button><button type="button" data-kwph-done>Done</button></div>`;
    if (bar.innerHTML !== html) bar.innerHTML = html;
    const r = v.getBoundingClientRect();
    bar.style.setProperty('--kwph-under', Math.max(0, Math.round(r.bottom - global.innerHeight)) + 'px');
    bar.style.setProperty('--kwph-side', Math.max(0, Math.round(-r.left)) + 'px');
  }
  function open() {
    if (S.on) return;
    if (global._svIsBuildMode && global._svIsBuildMode() && global._svToggleBuildMode) global._svToggleBuildMode(false);
    if (global.KWCast && global.KWCast.deselect) global.KWCast.deselect();
    if (global.KWBuildingMenu && global.KWBuildingMenu.close) global.KWBuildingMenu.close(false, true);
    S.on = true; S.phase = null; S.sky = null;
    doc.body.classList.add('kw-photo');
    paintBar();
    if (global.KWPlaces && global.KWPlaces.refreshTools) global.KWPlaces.refreshTools();
  }
  function close() {
    if (!S.on) return;
    S.on = false; S.phase = null; S.sky = null;
    look();   // back to the real hour and sky
    doc.body.classList.remove('kw-photo');
    paintBar();
    if (global.KWPlaces && global.KWPlaces.refreshTools) global.KWPlaces.refreshTools();
  }
  if (doc) {
    doc.addEventListener('click', e => {
      if (!S.on) return;
      const t = e.target.closest && e.target.closest('.kwph-bar button');
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      if (t.hasAttribute('data-kwph-phase')) { S.phase = t.getAttribute('data-kwph-phase'); look(); paintBar(); }
      else if (t.hasAttribute('data-kwph-sky')) { S.sky = t.getAttribute('data-kwph-sky'); look(); paintBar(); }
      else if (t.hasAttribute('data-kwph-save')) save();
      else if (t.hasAttribute('data-kwph-done')) close();
    }, true);
    doc.addEventListener('keydown', e => { if (S.on && e.key === 'Escape' && !e.defaultPrevented) { close(); e.stopPropagation(); } });
    global.addEventListener('kw:home', e => { if (!(e.detail && e.detail.open)) close(); });
  }

  global.KWPhoto = {
    open, close, toggle: () => (S.on ? close() : open()), save, capture,
    get on() { return S.on; },
    PHASES, SKIES, KIND,
    _paintOrder: paintOrder, _scaleFor: scaleFor, _gradientStops: gradientStops, _fileName: fileName, _kindOf: kindOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
