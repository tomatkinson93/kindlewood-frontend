'use strict';
// Happening visuals + effects, client side (node, no deps).
//   node verify/happening_fx_proofs.js [serverDir]
//   1. js/happening-effects.js byte-identical to the server's lib/happening_effects.js
//   2. no visual running → the overlay makes zero canvas calls; whole frames are
//      byte-identical with and without it (both renderers)
//   3. every visual kind draws; night-only kinds stay dark by day; tints draw by day
//   4. deterministic: same time → same frame; animated kinds change over time;
//      reduced motion freezes particles and skips fireworks / shooting stars
//   5. anchors come from the fog-filtered light sources (hidden settlements excluded)
//   6. clock-panel effect lines = the shared roll (random modifiers included)
//   7. hygiene: no Math.random; admin form validates with the shared rules
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const H = require('./_harness');
const { makeCtx } = H;
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const NOON = Date.parse('2026-11-05T15:00:00Z'), NIGHT = Date.parse('2026-11-05T03:00:00Z');
const FILES = ['day-cycle.js', 'happening-effects.js', 'server-clock.js', 'happenings.js', 'kwmap-core.js', 'kwmap-settlements.js', 'kwmap-daylight.js',
               'kwmap-happening-fx.js', 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'main.js'];
const allDay = (kinds) => [{ id: 'fx', title: 'FX', enabled: true, rule: { type: 'phase', phases: ['dawn', 'day', 'dusk', 'night'] },
                             effects: kinds.map(k => ({ type: 'map_flourish', kind: k })) }];

function env(view, ms, defs, files) {
  const e = H.makeEnv();
  e.sandbox.__KW_NO_AUTOSTART = true; e.sandbox.matchMedia = () => ({ matches: false });
  H.loadTree(e, files || FILES);
  vm.runInContext(`(function(){ const t = worldMapData.tiles.find(t => t.q === 21 && t.r === 17);
    Object.assign(t, { terrain: 'fog', settlement: { settlement_type: 'npc', tier: 'town', name: 'Hidden' } }); })();`, e.context);
  H.setUi(e, null, null, null, { q: 20, r: 15 });
  if (view) vm.runInContext(`KWMap.controller.setRenderer('${view}');`, e.context);
  if (e.sandbox.KWClock) e.sandbox.KWClock.pin(ms);
  if (e.sandbox.KWHappenings) e.sandbox.KWHappenings._setDefsForTest(defs || []);
  return e;
}
const frame = (e, ts) => { e.logs.map.length = 0; vm.runInContext(`KWMap.controller.renderFrame(${ts || 1000});`, e.context); return e.logs.map.slice(); };

(async () => {
  // 1
  {
    const sdir = process.argv[2] || process.env.KW_SERVER_DIR || path.join(ROOT, '..', 'kindlewood-server');
    const sf = path.join(sdir, 'lib', 'happening_effects.js');
    const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (!fs.existsSync(sf)) console.log('  ⚠ 1. SKIPPED byte identity — server not found at ' + sf);
    else check('1. js/happening-effects.js byte-identical to the server lib/happening_effects.js', sha(sf) === sha(path.join(ROOT, 'js', 'happening-effects.js')));
  }

  // 2
  for (const view of ['topdown', 'iso']) {
    const withFx = env(view, NIGHT, []);
    const without = env(view, NIGHT, [], FILES.filter(f => f !== 'kwmap-happening-fx.js'));
    const a = JSON.stringify(frame(withFx)), b = JSON.stringify(frame(without));
    const spy = [];
    const drew = withFx.sandbox.KWHappeningFX.draw(makeCtx(spy), 1400, 800, 1, withFx.sandbox.KWMap.controller.active, 1000);
    check(`2. ${view}: no visual running → overlay draws nothing; frame identical with / without it`, a === b && drew === false && spy.length === 0);
  }

  // 3
  {
    const e = env('iso', NIGHT, []);
    const FXr = e.sandbox.KWHappeningFX, R = e.sandbox.KWMap.controller.active;
    frame(e);
    const VIS = Object.keys(e.sandbox.KWHappeningEffects.VISUALS).filter(k => k !== 'lanterns');
    const calls = (kind, night, t = 4100) => { const s = []; FXr.draw(makeCtx(s), 1400, 800, 1, R, t, { kinds: [kind], night, reduced: false }); return s.length; };
    const drawsAtNight = VIS.filter(k => calls(k, 1) > 0);
    check('3. every visual kind draws at night (' + VIS.length + ' kinds)', drawsAtNight.length === VIS.length, VIS.filter(k => !drawsAtNight.includes(k)).join(',') || 'all');
    const nightOnly = VIS.filter(k => e.sandbox.KWHappeningEffects.VISUALS[k].when === 'night');
    check('3b. night-only kinds (aurora, fireflies, wisps, shooting stars) draw nothing by day', nightOnly.every(k => calls(k, 0) === 0), nightOnly.join(','));
    check('3c. tints (purple / blood / golden) and day kinds still draw by day',
          ['purple_moon', 'blood_moon', 'golden_glow', 'petals', 'mist', 'floating_lanterns', 'fireworks'].every(k => calls(k, 0) > 0));
    const s = []; FXr.draw(makeCtx(s), 1400, 800, 1, R, 1000, { kinds: ['purple_moon'], night: 0 });
    check('3d. purple moon multiplies a violet colour over the whole map', s.some(x => x[0] === 'set:globalCompositeOperation' && x[1] === 'multiply') &&
          s.some(x => x[0] === 'set:fillStyle' && x[1] === 'rgb(208,176,255)') && s.some(x => x[0] === 'fillRect' && x[3] === 1400 && x[4] === 800));
  }

  // 4
  {
    const e = env('topdown', NIGHT, []);
    frame(e);
    const FXr = e.sandbox.KWHappeningFX, R = e.sandbox.KWMap.controller.active;
    const log = (kinds, t, reduced) => { const s = []; FXr.draw(makeCtx(s), 1400, 800, 1, R, t, { kinds, night: 1, reduced }); return JSON.stringify(s); };
    const anim = ['floating_lanterns', 'fireworks', 'fireflies', 'petals', 'aurora'];
    check('4. same time → identical frame', anim.every(k => log([k], 4321) === log([k], 4321)));
    check('4b. animated kinds move over time', anim.every(k => log([k], 4321) !== log([k], 5321)));
    check('4c. reduced motion: particles frozen (same at any time), fireworks + shooting stars skipped',
          log(['floating_lanterns', 'petals'], 1000, true) === log(['floating_lanterns', 'petals'], 9000, true) &&
          log(['fireworks'], 4000, true) === '[]' && log(['shooting_stars'], 4000, true) === '[]');
  }

  // 5
  {
    const e = env('topdown', NIGHT, allDay(['floating_lanterns']));
    frame(e);
    const D = e.sandbox.KWDaylight, R = e.sandbox.KWMap.controller.active;
    const listed = R.visibleSettlements().some(v => v.wq === 21 && v.wr === 17);
    const lit = D.sourcesFor(R, 1400, 800).filter(s => s.light.settlement).map(s => s.q + ',' + s.r);
    check('5. overlay anchors are the fog-filtered settlements (the hidden one is excluded)', listed && lit.indexOf('21,17') < 0 && lit.length >= 3);
    const live = frame(e);
    check('5b. a running visual Happening reaches the map through the renderer', live.some(x => x[0] === 'ellipse'));
  }

  // 6
  {
    const e = env(null, NIGHT, []);
    const K = e.sandbox.KWHappenings, FX = e.sandbox.KWHappeningEffects;
    const h = { id: 'odd_night', title: 'Odd Night', enabled: true, rule: { type: 'daily', start: '02:00', durationMin: 120 },
                effects: [{ type: 'banner' }, { type: 'map_flourish', kind: 'purple_moon' }, { type: 'modifier', stat: 'enemy_health', value: 0.25 }, { type: 'random_modifier', mood: 'bad' }] };
    K._setDefsForTest([h]);
    const start = Date.parse('2026-11-05T02:00:00Z');
    const lines = K.effectLines(h, start);
    const roll = FX.resolveEffects(h, start)[3];
    check('6. effect lines: visual, a bad enemy buff, and the window\'s random roll (same as the shared resolver)',
          lines.length === 3 && /Purple moon/.test(lines[0].text) && lines[1].tone === 'bad' && /enemy health/.test(lines[1].text) &&
          lines[2].text === FX.describeEffect(roll) && lines[2].tone === 'bad');
    check('6b. activeVisuals lists the running visual kinds', JSON.stringify(K.activeVisuals()) === '["purple_moon"]');
    const html = K.hudHtml(NIGHT);
    check('6c. clock panel shows the effects, blessings / curses coloured', /hc-fx hc-fx-bad/.test(html) && /enemy health/.test(html));
  }

  // 7
  {
    const src = read('js/kwmap-happening-fx.js') + read('js/happening-effects.js') + read('js/happenings-admin.js');
    check('7. no Math.random in the effects / visuals / admin files', !/Math\.random/.test(src));
    check('7b. the admin form validates effects with the shared KWHappeningEffects rules', /return KWHappeningEffects\.validateEffects\(fx\);/.test(read('js/happenings-admin.js')));
    const html = read('index.html');
    check('7c. scripts versioned: happening-effects (after day-cycle) and kwmap-happening-fx (after daylight)',
          html.indexOf('/js/day-cycle.js?v=') < html.indexOf('/js/happening-effects.js?v=') &&
          html.indexOf('/js/kwmap-daylight.js?v=') < html.indexOf('/js/kwmap-happening-fx.js?v='));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
