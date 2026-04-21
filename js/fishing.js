// ══════════════════════════════════════════════
//  FISHING POST — Kindlewood
// ══════════════════════════════════════════════

// ── Fish data ────────────────────────────────

const FISH_TABLE = [
  { id:'minnow',     name:'Minnow',      icon:'🐟', rarity:'common',    difficulty:1,  seasons:['spring','summer','autumn','winter'], river_only:true, value:2,   weight:60, flavour:'A small, darting thing. Common but plentiful.' },
  { id:'gudgeon',    name:'Gudgeon',     icon:'🐟', rarity:'common',    difficulty:1,  seasons:['spring','summer','autumn'],          river_only:true, value:2,   weight:55, flavour:'Barely worth the trouble, but the river is full of them.' },
  { id:'dace',       name:'Dace',        icon:'🐠', rarity:'common',    difficulty:2,  seasons:['spring','summer','winter'],          river_only:true, value:4,   weight:45, flavour:'Quick and silver-sided. Slips the hook easily.' },
  { id:'perch',      name:'Perch',       icon:'🐠', rarity:'common',    difficulty:2,  seasons:['spring','summer','autumn'],          river_only:true, value:5,   weight:40, flavour:'Spiny and stubborn. Puts up a decent fight.' },
  { id:'roach',      name:'Roach',       icon:'🐟', rarity:'common',    difficulty:2,  seasons:['spring','autumn','winter'],          river_only:true, value:4,   weight:42, flavour:'Red-finned and restless. A staple of the river.' },
  { id:'trout',      name:'Trout',       icon:'🐡', rarity:'uncommon',  difficulty:4,  seasons:['spring','autumn','winter'],          river_only:true, value:10,  weight:22, flavour:'A strong swimmer. Worth the effort.' },
  { id:'chub',       name:'Chub',        icon:'🐡', rarity:'uncommon',  difficulty:3,  seasons:['summer','autumn'],                   river_only:true, value:8,   weight:28, flavour:'Thick-bodied and suspicious. Pulls hard when hooked.' },
  { id:'catfish',    name:'Catfish',     icon:'🐊', rarity:'uncommon',  difficulty:5,  seasons:['summer','autumn'],                   river_only:true, value:14,  weight:18, flavour:'Bottom-dwelling and fierce. Hunts at dusk.' },
  { id:'bream',      name:'Bream',       icon:'🐡', rarity:'uncommon',  difficulty:4,  seasons:['spring','summer'],                   river_only:true, value:11,  weight:20, flavour:'Deep-bodied and slow to start, then suddenly wild.' },
  { id:'pike',       name:'Pike',        icon:'🦷', rarity:'uncommon',  difficulty:6,  seasons:['autumn','winter'],                   river_only:true, value:18,  weight:14, flavour:'Teeth like needles and a temper to match.' },
  { id:'salmon',     name:'Salmon',      icon:'🍣', rarity:'rare',      difficulty:7,  seasons:['autumn'],                            river_only:true, value:28,  weight:8,  flavour:'Runs against the current with furious strength.' },
  { id:'eel',        name:'River Eel',   icon:'〰️', rarity:'rare',     difficulty:7,  seasons:['summer','autumn'],                   river_only:true, value:25,  weight:9,  flavour:'Writhes and twists. Keeping it on the line takes nerve.' },
  { id:'golden_carp',name:'Golden Carp', icon:'✨', rarity:'rare',      difficulty:8,  seasons:['winter'],                            river_only:true, value:35,  weight:5,  flavour:'Gleams beneath the ice. Legends say it brings fortune.' },
  { id:'shadowfin',  name:'Shadowfin',   icon:'🌑', rarity:'legendary', difficulty:9,  seasons:['autumn','winter'],                   river_only:true, value:60,  weight:2,  flavour:'Dark as river-bottom mud. Few have seen one. Fewer have caught one.' },
  { id:'moontrout',  name:'Moontrout',   icon:'🌕', rarity:'legendary', difficulty:10, seasons:['winter'],                            river_only:true, value:100, weight:1,  flavour:'Said to swim only on clear winter nights. Landing one is the stuff of legend.' },
];

const JUNK_TABLE = [
  { id:'old_boot',    name:'Old Boot',     icon:'👢', flavour:'Waterlogged and falling apart. Not yours, hopefully.' },
  { id:'tin_can',     name:'Tin Can',      icon:'🥫', flavour:'Rusted through. Something once lived inside it.' },
  { id:'soggy_hat',   name:'Soggy Hat',    icon:'🎩', flavour:'A fine hat, once. The river has had its way with it.' },
  { id:'tangled_net', name:'Tangled Net',  icon:'🕸',  flavour:'Someone lost this long ago. Easy to see why.' },
  { id:'river_stone', name:'Smooth Stone', icon:'🪨', flavour:'Perfectly round. The river shaped it over centuries.' },
  { id:'broken_rod',  name:'Broken Rod',   icon:'🎣', flavour:"Another fisher\'s misfortune. Maybe it snapped on a big one." },
  { id:'old_coin',    name:'Old Coin',     icon:'🪙', flavour:'Worn smooth. The face on it is unrecognisable.' },
];

const RARITY_COLORS = {
  common:'#a0c880', uncommon:'#70b8e0', rare:'#e8a020', legendary:'#e060f0', junk:'#807060',
};

const JUNK_CHANCE_NORMAL = 0.07;
const JUNK_CHANCE_RIPPLE = 0.03;

// ── Session catch log ─────────────────────────

function _loadCatchLog() {
  try { return JSON.parse(localStorage.getItem('kw_catch_log') || '[]'); } catch { return []; }
}
function _saveCatch(fishId) {
  const log = _loadCatchLog();
  log.push({ fishId, ts: Date.now() });
  if (log.length > 100) log.splice(0, log.length - 100);
  try { localStorage.setItem('kw_catch_log', JSON.stringify(log)); } catch {}
  _updateCatchDisplay();
}
function _getCatchCounts() {
  return _loadCatchLog().reduce((acc, e) => { acc[e.fishId] = (acc[e.fishId] || 0) + 1; return acc; }, {});
}

// ── Season pool ───────────────────────────────

function _getSeasonalPool() {
  const season = (typeof calcCurrentSeason === 'function') ? calcCurrentSeason().id
               : (typeof currentSeason !== 'undefined' && currentSeason?.id) || 'spring';
  return FISH_TABLE.filter(f => f.seasons.includes(season));
}

function _rollFish(inRippleZone) {
  const junkChance = inRippleZone ? JUNK_CHANCE_RIPPLE : JUNK_CHANCE_NORMAL;
  if (Math.random() < junkChance) {
    const junk = JUNK_TABLE[Math.floor(Math.random() * JUNK_TABLE.length)];
    return { ...junk, rarity:'junk', difficulty:1, value:0, weight:0, seasons:[] };
  }
  const pool = _getSeasonalPool();
  if (!pool.length) return FISH_TABLE[0];
  const totalWeight = pool.reduce((s, f) => s + f.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const fish of pool) { roll -= fish.weight; if (roll <= 0) return fish; }
  return pool[pool.length - 1];
}

// ── Open / Close ──────────────────────────────

async function visitFishingPost() {
  const overlay = document.getElementById('fishing-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _resetFishingState();
  if (typeof loadCitizens === 'function') await loadCitizens();
  _renderFishingHome();
  _updateCatchDisplay();
}

function leaveFishingPost() {
  const overlay = document.getElementById('fishing-overlay');
  if (overlay) overlay.style.display = 'none';
  _reelStop();
  _stopMinigame();
}

// ── Main home screen ──────────────────────────

function _renderFishingHome() {
  const area = document.getElementById('fishing-main-area');
  if (!area) return;
  const season = (typeof calcCurrentSeason === 'function') ? calcCurrentSeason() : { name:'Spring', emoji:'🌸' };
  const pool = _getSeasonalPool();

  const fishers = (typeof citizensData !== 'undefined' ? citizensData : [])
    .filter(c => c.role === 'fisher')
    .sort((a, b) => (b.skills?.fishing ?? 0) - (a.skills?.fishing ?? 0));

  const fisherDropdown = fishers.length
    ? `<div class="fp-fisher-row">
        <label class="fp-fisher-label">👤 Fishing with</label>
        <select class="fp-fisher-select" id="fp-fisher-select" onchange="_onFisherChange(this.value)">
          ${fishers.map(c => {
            const skill = c.skills?.fishing ?? 1;
            return '<option value="' + c.id + '">' + c.name + ' (Fishing ' + skill + ')</option>';
          }).join('')}
        </select>
      </div>`
    : '<div class="fp-fisher-none">No citizens assigned to <em>Fisher</em> role.</div>';

  if (fishers.length) _selectedFisherSkill = fishers[0].skills?.fishing ?? 1;

  area.innerHTML =
    '<div class="fp-intro"><div class="fp-flavor">The river runs quiet here. ' + season.emoji + ' <em>' + season.name + '</em> brings its own catch.</div></div>' +
    '<div class="fp-available-fish"><div class="fp-fish-label">In Season</div><div class="fp-fish-list">' +
    pool.map(f => '<span class="fp-fish-pill" style="color:' + RARITY_COLORS[f.rarity] + '">' + f.icon + ' ' + f.name + '</span>').join('') +
    '</div></div>' +
    fisherDropdown +
    '<button class="fp-cast-btn" id="fp-cast-btn" onclick="_showCastingZone()">🎣 Choose Spot &amp; Cast</button>' +
    '<div class="fp-result-area" id="fp-result-area"></div>';
}

function _onFisherChange(citizenId) {
  const citizen = (typeof citizensData !== 'undefined' ? citizensData : [])
    .find(c => c.id === parseInt(citizenId));
  _selectedFisherSkill = citizen?.skills?.fishing ?? 1;
}

// ══════════════════════════════════════════════
//  CASTING ZONE SELECTOR
// ══════════════════════════════════════════════

let _castInRippleZone = false;
let _bobberCanvasX = 0.5;

function _showCastingZone() {
  // Show instruction and make the overlay clickable in the lower cast area
  var overlay = document.getElementById('fishing-overlay');
  if (overlay) {
    overlay.classList.add('casting-mode');
    overlay.addEventListener('click', _onOverlayCastClick);
  }

  // Show a small instruction in the main area
  var area = document.getElementById('fishing-main-area');
  if (area) {
    area.innerHTML =
      '<div class="fp-cast-instruction" id="fp-cast-instruction">' +
      '<div class="fp-cast-instruction-text">🎣 Click the water to cast your line</div>' +
      '<div class="fp-cast-instruction-sub">Aim for the <span class="fp-cz-good">ripple zone</span> for better fishing</div>' +
      '<button class="fp-leave-btn" style="margin-top:12px" onclick="_cancelCastMode()">← Back</button>' +
      '</div>';
  }
}

function _cancelCastMode() {
  var overlay = document.getElementById('fishing-overlay');
  if (overlay) {
    overlay.classList.remove('casting-mode');
    overlay.removeEventListener('click', _onOverlayCastClick);
  }
  _renderFishingHome();
}

function _onOverlayCastClick(e) {
  // Ignore clicks on UI elements (buttons, selects, the main content area above water)
  if (e.target.closest('button') || e.target.closest('select') || e.target.closest('.fp-leave-btn')) return;

  var overlay = document.getElementById('fishing-overlay');
  var rect = overlay.getBoundingClientRect();
  var relY = (e.clientY - rect.top) / rect.height; // 0=top 1=bottom

  // Only accept clicks in the lower 40% of the overlay (the water area)
  if (relY < 0.60) return;

  var relX = (e.clientX - rect.left) / rect.width;
  _bobberCanvasX = relX;

  // Is it near the existing ripple zone? Ripples are centered around 50% X, bottom ~15% Y
  var distFromRippleX = Math.abs(relX - 0.5);
  var distFromRippleY = Math.abs(relY - 0.92);
  _castInRippleZone = (distFromRippleX < 0.22 && distFromRippleY < 0.08);

  // Remove casting mode
  overlay.classList.remove('casting-mode');
  overlay.removeEventListener('click', _onOverlayCastClick);

  // Move the bobber to where they clicked
  var bobberFloat = document.getElementById('fp-bobber-float');
  if (bobberFloat) {
    bobberFloat.classList.remove('cast', 'biting');
    var leftPct = relX * 100;
    var bottomPct = (1 - relY) * 100 + 2;
    bobberFloat.style.transition = 'none';
    bobberFloat.style.left   = leftPct + '%';
    bobberFloat.style.bottom = bottomPct + '%';
    void bobberFloat.offsetWidth;
    bobberFloat.style.transition = 'left 0.3s ease, bottom 0.3s ease';
    bobberFloat.classList.add('cast');
    // Small splash ripple at click point
    _spawnClickRipple(e.clientX - rect.left, e.clientY - rect.top, overlay);
  }

  // Brief flash of confirmation then start waiting
  var area = document.getElementById('fishing-main-area');
  if (area) {
    var zoneText = _castInRippleZone ? '🎣 Cast into the ripples!' : '🎣 Line cast!';
    area.innerHTML = '<div class="fp-cast-confirm-flash">' + zoneText + '</div>';
  }
  setTimeout(function() { _startWaiting(); }, 600);
}

function _spawnClickRipple(x, y, parent) {
  // Create a temporary ripple element at the click point
  for (var i = 0; i < 3; i++) {
    (function(delay, size) {
      setTimeout(function() {
        var el = document.createElement('div');
        el.className = 'fp-click-ripple';
        el.style.left   = x + 'px';
        el.style.top    = y + 'px';
        el.style.width  = size + 'px';
        el.style.height = Math.round(size * 0.28) + 'px';
        parent.appendChild(el);
        setTimeout(function() { el.remove(); }, 1200);
      }, delay);
    })(i * 200, 40 + i * 35);
  }
}

function _confirmCast() {}

function _startWaiting() {
  _fishState = 'waiting';
  const area = document.getElementById('fishing-main-area');
  if (area) {
    area.innerHTML =
      '<div class="fp-waiting">' +
      '<div class="fp-waiting-text">Line in the water…</div>' +
      '<div class="fp-waiting-sub">Waiting for a bite</div>' +
      '<div class="fp-waiting-dots"><span></span><span></span><span></span></div>' +
      '</div>';
  }
  const biteDelay = 2000 + Math.random() * 3000;
  _biteTimeout = setTimeout(function() { _fishBite(); }, biteDelay);
}

// ══════════════════════════════════════════════
//  MINIGAME STATE
// ══════════════════════════════════════════════

let _fishState = 'idle';

let _reelAudioNormal  = null;
let _reelAudioTension = null;
let _biteAudio  = null;
let _failAudio  = null;
let _currentReelMode = null; // 'normal' | 'tension' | null

function _getReelNormal() {
  if (!_reelAudioNormal) { _reelAudioNormal = new Audio('/assets/audio/reel.wav'); _reelAudioNormal.loop = true; _reelAudioNormal.volume = 0.55; }
  return _reelAudioNormal;
}
function _getReelTension() {
  if (!_reelAudioTension) { _reelAudioTension = new Audio('/assets/audio/tension.wav'); _reelAudioTension.loop = true; _reelAudioTension.volume = 0.65; }
  return _reelAudioTension;
}

function _reelStart() {
  var mode = _fishActive ? 'tension' : 'normal';
  if (_currentReelMode === mode) return; // already playing correct track
  _reelStopAll();
  _currentReelMode = mode;
  var a = mode === 'tension' ? _getReelTension() : _getReelNormal();
  a.play().catch(function(){});
}

function _reelStop() {
  _reelStopAll();
}

function _reelStopAll() {
  _currentReelMode = null;
  if (_reelAudioNormal  && !_reelAudioNormal.paused)  { _reelAudioNormal.pause();  _reelAudioNormal.currentTime  = 0; }
  if (_reelAudioTension && !_reelAudioTension.paused) { _reelAudioTension.pause(); _reelAudioTension.currentTime = 0; }
}
function _playBiteSound() {
  if (!_biteAudio) { _biteAudio = new Audio('/assets/audio/fishcatch.wav'); _biteAudio.volume = 0.7; }
  _biteAudio.currentTime = 0; _biteAudio.play().catch(function(){});
}
function _playFailSound() {
  if (!_failAudio) { _failAudio = new Audio('/assets/audio/fail.wav'); _failAudio.volume = 0.6; }
  _failAudio.currentTime = 0; _failAudio.play().catch(function(){});
}
function _playSuccessSound() {
  var a = new Audio('/assets/audio/success.mp3'); a.volume = 0.75; a.play().catch(function(){});
}

let _catchBarY   = 50;
let _targetY     = 40;
let _targetVY    = 0;
let _progress    = 0;
let _tension     = 0;
let _holding     = false;
let _currentFish = null;
let _fishActive  = false;
let _fishActiveTimer = 0;
let _minigameLoop = null;
let _biteTimeout  = null;

const CATCH_BAR_HEIGHT    = 17;
const PROGRESS_FILL_RATE  = 0.32;
const PROGRESS_DRAIN_RATE = 0.295;
const BAR_RISE_SPEED      = 1.6;
const BAR_FALL_SPEED      = 1.1;
const TARGET_ACCEL        = 0.22;
const TARGET_MAX_V        = 1.8;
const TENSION_BUILD_RATE  = 1.2;
const TENSION_DRAIN_RATE  = 0.8;
const TENSION_MAX         = 100;
const DORMANT_MIN = 1800;
const DORMANT_MAX = 3500;
const ACTIVE_MIN  = 1200;
const ACTIVE_MAX  = 2800;

let _selectedFisherSkill = 1;

function _resetFishingState() {
  _fishState = 'idle';
  _reelStop();
  _stopMinigame();
  _holding = false;
  _progress = 0;
  _tension  = 0;
  _fishActive = false;
  if (_biteTimeout) { clearTimeout(_biteTimeout); _biteTimeout = null; }
  var bobber = document.getElementById('fp-bobber-float');
  if (bobber) { bobber.classList.remove('cast','biting'); bobber.style.left = ''; bobber.style.bottom = ''; }
}

function _fishBite() {
  if (_fishState !== 'waiting') return;
  _fishState = 'biting';
  _currentFish = _rollFish(_castInRippleZone);
  _playBiteSound();
  var bobber = document.getElementById('fp-bobber-float');
  if (bobber) bobber.classList.add('biting');
  _renderBiteAlert();
  _biteTimeout = setTimeout(function() {
    if (_fishState === 'biting') { _fishState = 'fail'; _playFailSound(); _renderGotAway(); }
  }, 1000);
}

function _renderBiteAlert() {
  var area = document.getElementById('fishing-main-area');
  if (!area) return;
  var isJunk = _currentFish.rarity === 'junk';
  area.innerHTML =
    '<div class="fp-bite-alert" id="fp-bite-alert" onclick="confirmBite()">' +
    '<div class="fp-bite-pulse"></div>' +
    '<div class="fp-bite-icon">' + (isJunk ? '❓' : '🎣') + '</div>' +
    '<div class="fp-bite-text">' + (isJunk ? 'Something snagged the line!' : "Something's biting!") + '</div>' +
    '<div class="fp-bite-sub">Click or Space!</div>' +
    '<div class="fp-bite-timer-bar"><div class="fp-bite-timer-fill" id="fp-bite-timer-fill"></div></div>' +
    '</div>';
  requestAnimationFrame(function() {
    var fill = document.getElementById('fp-bite-timer-fill');
    if (fill) { fill.style.transition = 'width 1s linear'; fill.style.width = '0%'; }
  });
}

function confirmBite() {
  if (_fishState !== 'biting') return;
  clearTimeout(_biteTimeout); _biteTimeout = null;
  var bobber = document.getElementById('fp-bobber-float');
  if (bobber) bobber.classList.remove('biting');
  if (_currentFish.rarity === 'junk') { _fishState = 'success'; _showJunkResult(); return; }
  _fishState = 'active';
  _catchBarY = 50;
  _targetY   = 30 + Math.random() * 40;
  _targetVY  = (Math.random() - 0.5) * 2;
  _progress  = 25;
  _tension   = 0;
  _fishActive = false;
  _fishActiveTimer = DORMANT_MIN + Math.random() * (DORMANT_MAX - DORMANT_MIN);
  _renderMinigame();
  _startMinigameLoop();
}

function _getTargetHeight() {
  var d = _currentFish ? _currentFish.difficulty : 1;
  var base = Math.round(20 - (d - 1) * 1.35);
  var skillBonus = Math.round((_selectedFisherSkill - 1) * 0.9);
  return Math.min(28, Math.max(6, base + skillBonus));
}

function _renderMinigame() {
  var area = document.getElementById('fishing-main-area');
  if (!area) return;
  var th = _getTargetHeight();
  var fish = _currentFish;
  area.innerHTML =
    '<div class="fp-minigame">' +
    '<div class="fp-mg-fish-hint">🎣 Something is on the line!</div>' +
    '<div class="fp-mg-state-badge" id="fp-mg-state-badge">💤 Dormant</div>' +
    '<div class="fp-mg-instruction">Hold <kbd>Space</kbd> or <kbd>Click</kbd> to reel — careful when fish is <span class="fp-mg-hint-red">active</span>!</div>' +
    '<div class="fp-mg-arena" id="fp-mg-arena">' +
    '<div class="fp-mg-progress-wrap" title="Catch progress">' +
    '<div class="fp-mg-progress-fill" id="fp-mg-progress" style="height:' + _progress + '%"></div>' +
    '<div class="fp-mg-progress-label" id="fp-mg-progress-label">📈</div>' +
    '</div>' +
    '<div class="fp-mg-meter" id="fp-mg-meter">' +
    '<div class="fp-mg-target" id="fp-mg-target" style="top:' + _targetY + '%; height:' + th + '%">' +
    '<div class="fp-mg-target-fish">' + fish.icon + '</div>' +
    '</div>' +
    '<div class="fp-mg-bar" id="fp-mg-bar" style="top:' + _catchBarY + '%; height:' + CATCH_BAR_HEIGHT + '%"></div>' +
    '</div>' +
    '<div class="fp-mg-tension-wrap" title="Line tension">' +
    '<div class="fp-mg-tension-fill" id="fp-mg-tension" style="height:' + _tension + '%"></div>' +
    '<div class="fp-mg-tension-label" id="fp-mg-tension-label">💢</div>' +
    '</div>' +
    '</div>' +
    '<div class="fp-mg-hint">Keep <span class="fp-mg-hint-green">bar on fish</span> · Stop reeling when fish is <span class="fp-mg-hint-red">active!</span></div>' +
    '</div>';

  var meter = document.getElementById('fp-mg-meter');
  if (meter) {
    meter.addEventListener('mousedown', _holdStart);
    meter.addEventListener('touchstart', _holdStart, { passive: true });
  }
}

function _holdStart(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (_fishState !== 'active') return;
  _holding = true;
  _reelStart();
}
function _holdEnd() {
  _holding = false;
  _reelStop();
}

document.addEventListener('keydown', function(e) {
  if (e.code === 'Space') {
    e.preventDefault();
    if (_fishState === 'biting') { confirmBite(); }
    else if (_fishState === 'active' && !_holding) { _holding = true; _reelStart(); }
  }
});
document.addEventListener('keyup', function(e) {
  if (e.code === 'Space') { _holding = false; _reelStop(); }
});
document.addEventListener('mouseup',  _holdEnd);
document.addEventListener('touchend', _holdEnd);

function _startMinigameLoop() {
  _stopMinigame();
  var last = performance.now();

  function tick(now) {
    if (_fishState !== 'active') return;
    var dt = Math.min((now - last) / 16.67, 3);
    last = now;

    // Fish state machine
    _fishActiveTimer -= dt * 16.67;
    if (_fishActiveTimer <= 0) {
      _fishActive = !_fishActive;
      var min = _fishActive ? ACTIVE_MIN  : DORMANT_MIN;
      var max = _fishActive ? ACTIVE_MAX  : DORMANT_MAX;
      _fishActiveTimer = min + Math.random() * (max - min);
      var badge = document.getElementById('fp-mg-state-badge');
      if (badge) {
        badge.textContent = _fishActive ? '⚡ ACTIVE — STOP REELING!' : '💤 Dormant — reel now';
        badge.className = 'fp-mg-state-badge' + (_fishActive ? ' active' : '');
      }
      var meter = document.getElementById('fp-mg-meter');
      if (meter) {
        if (_fishActive) { meter.classList.add('fish-active'); }
        else             { meter.classList.remove('fish-active'); }
      }
      // Switch reel audio if player is currently holding
      if (_holding) { _reelStart(); }
    }

    // Move catch bar
    if (_holding) {
      _catchBarY = Math.max(0, _catchBarY - BAR_RISE_SPEED * dt);
    } else {
      _catchBarY = Math.min(100 - CATCH_BAR_HEIGHT, _catchBarY + BAR_FALL_SPEED * dt);
    }

    // Move fish target
    var d = _currentFish ? _currentFish.difficulty : 1;
    var actMult = _fishActive ? 2.2 : 0.7;  // active: notably faster, dormant: gentle drift
    var diffScale = (0.18 + Math.pow(d / 10, 1.6) * 2.2) * actMult;
    if (_fishActive && Math.random() < 0.015 * Math.max(d, 3) * dt) _targetVY *= -1.6; // more frequent, all fish
    _targetVY += (Math.random() - 0.48) * TARGET_ACCEL * diffScale * dt;
    _targetVY = Math.max(-TARGET_MAX_V * diffScale, Math.min(TARGET_MAX_V * diffScale, _targetVY));
    _targetY  += _targetVY * dt;
    if (_targetY < 0) { _targetY = 0; _targetVY = Math.abs(_targetVY); }
    var th = _getTargetHeight();
    if (_targetY > 100 - th) { _targetY = 100 - th; _targetVY = -Math.abs(_targetVY); }

    // Line tension — only builds when reeling during active, never drains
    if (_holding && _fishActive) {
      _tension = Math.min(TENSION_MAX, _tension + TENSION_BUILD_RATE * dt);
    }
    // tension does not drain — every mistake is permanent

    // Catch progress
    var barTop  = _catchBarY;
    var barBot  = _catchBarY + CATCH_BAR_HEIGHT;
    var targTop = _targetY;
    var targBot = _targetY + th;
    var overlaps = barTop < targBot && barBot > targTop;
    if (overlaps) {
      _progress = Math.min(100, _progress + PROGRESS_FILL_RATE * dt);
    } else {
      _progress = Math.max(0, _progress - PROGRESS_DRAIN_RATE * dt);
    }

    // Update DOM
    var barEl     = document.getElementById('fp-mg-bar');
    var targetEl  = document.getElementById('fp-mg-target');
    var progEl    = document.getElementById('fp-mg-progress');
    var progLabel = document.getElementById('fp-mg-progress-label');
    var tensEl    = document.getElementById('fp-mg-tension');

    if (barEl)    barEl.style.top    = _catchBarY + '%';
    if (targetEl) targetEl.style.top = _targetY + '%';
    if (progEl) {
      progEl.style.height = _progress + '%';
      progEl.style.background = overlaps
        ? 'linear-gradient(180deg,#a0e060,#60b030)'
        : 'linear-gradient(180deg,#e0a040,#c06820)';
    }
    if (progLabel) progLabel.textContent = _progress > 70 ? '🎣' : _progress > 35 ? '📈' : '📉';
    if (tensEl) {
      tensEl.style.height = _tension + '%';
      var r = Math.round(60  + _tension * 1.9);
      var g = Math.round(200 - _tension * 1.4);
      tensEl.style.background = 'linear-gradient(180deg,rgb(' + r + ',' + g + ',60),rgb(' + Math.min(255,r+20) + ',' + Math.max(0,g-20) + ',40))';
    }

    if (_tension >= TENSION_MAX) { _lineSnap(); return; }
    if (_progress >= 100) { _catchSuccess(); return; }
    if (_progress <= 0)   { _catchFail();    return; }

    _minigameLoop = requestAnimationFrame(tick);
  }

  _minigameLoop = requestAnimationFrame(tick);
}

function _stopMinigame() {
  if (_minigameLoop) { cancelAnimationFrame(_minigameLoop); _minigameLoop = null; }
  if (_biteTimeout)  { clearTimeout(_biteTimeout); _biteTimeout = null; }
  _holding = false;
}

function _lineSnap() {
  _fishState = 'fail';
  _reelStop();
  _stopMinigame();
  _playFailSound();
  var area = document.getElementById('fishing-main-area');
  if (!area) return;
  area.innerHTML =
    '<div class="fp-result fp-result-fail">' +
    '<div class="fp-result-splash">💥 Line snapped!</div>' +
    '<div class="fp-result-fish-icon" style="opacity:0.35">' + (_currentFish ? _currentFish.icon : '🐟') + '</div>' +
    '<div class="fp-result-flavour"><em>You reeled too hard while the fish was fighting. The line gave way.</em></div>' +
    '<div class="fp-result-actions">' +
    '<button class="fp-cast-btn" onclick="startFishingAgain()">🎣 Try Again</button>' +
    '<button class="fp-leave-btn" onclick="leaveFishingPost()">← Leave</button>' +
    '</div></div>';
}

function _catchSuccess() {
  _fishState = 'success';
  _reelStop();
  _stopMinigame();
  _playSuccessSound();
  var fish = _currentFish;
  _saveCatch(fish.id);
  var area = document.getElementById('fishing-main-area');
  if (!area) return;
  area.innerHTML =
    '<div class="fp-result fp-result-success">' +
    '<div class="fp-result-splash">✨ Caught! ✨</div>' +
    '<div class="fp-result-fish-icon">' + fish.icon + '</div>' +
    '<div class="fp-result-fish-name" style="color:' + RARITY_COLORS[fish.rarity] + '">' + fish.name + '</div>' +
    '<div class="fp-result-rarity">' + fish.rarity + '</div>' +
    '<div class="fp-result-flavour"><em>' + fish.flavour + '</em></div>' +
    '<div class="fp-result-actions">' +
    '<button class="fp-cast-btn" onclick="startFishingAgain()">🎣 Cast Again</button>' +
    '<button class="fp-leave-btn" onclick="leaveFishingPost()">← Leave</button>' +
    '</div></div>';
}

function _catchFail() {
  _fishState = 'fail';
  _reelStop();
  _stopMinigame();
  _playFailSound();
  _renderGotAway();
}

function _renderGotAway() {
  var area = document.getElementById('fishing-main-area');
  if (!area) return;
  area.innerHTML =
    '<div class="fp-result fp-result-fail">' +
    '<div class="fp-result-splash">💨 It got away!</div>' +
    '<div class="fp-result-fish-icon" style="opacity:0.35">' + (_currentFish ? _currentFish.icon : '🐟') + '</div>' +
    '<div class="fp-result-flavour"><em>The line went slack. Better luck next time.</em></div>' +
    '<div class="fp-result-actions">' +
    '<button class="fp-cast-btn" onclick="startFishingAgain()">🎣 Try Again</button>' +
    '<button class="fp-leave-btn" onclick="leaveFishingPost()">← Leave</button>' +
    '</div></div>';
}

function _showJunkResult() {
  var junk = _currentFish;
  _saveCatch(junk.id);
  var area = document.getElementById('fishing-main-area');
  if (!area) return;
  area.innerHTML =
    '<div class="fp-result fp-result-junk">' +
    '<div class="fp-result-splash">🪣 You pulled up…</div>' +
    '<div class="fp-result-fish-icon">' + junk.icon + '</div>' +
    '<div class="fp-result-fish-name" style="color:#a09080">' + junk.name + '</div>' +
    '<div class="fp-result-rarity" style="color:#807060">junk</div>' +
    '<div class="fp-result-flavour"><em>' + junk.flavour + '</em></div>' +
    '<div class="fp-result-actions">' +
    '<button class="fp-cast-btn" onclick="startFishingAgain()">🎣 Cast Again</button>' +
    '<button class="fp-leave-btn" onclick="leaveFishingPost()">← Leave</button>' +
    '</div></div>';
}

function startFishingAgain() {
  _fishState = 'idle';
  _currentFish = null;
  _tension = 0;
  _reelStop();
  _stopMinigame();
  var bobber = document.getElementById('fp-bobber-float');
  if (bobber) { bobber.classList.remove('cast','biting'); bobber.style.left = ''; bobber.style.bottom = ''; }
  _renderFishingHome();
}

function _updateCatchDisplay() {
  var el = document.getElementById('fp-catch-log');
  if (!el) return;
  var counts = _getCatchCounts();
  var total = Object.values(counts).reduce(function(a,b){return a+b;},0);
  if (!total) { el.innerHTML = '<div class="fp-cl-empty">No catches yet.</div>'; return; }
  el.innerHTML = FISH_TABLE.concat(JUNK_TABLE)
    .filter(function(f){ return counts[f.id]; })
    .map(function(f){
      return '<div class="fp-cl-row"><span>' + f.icon + ' ' + f.name + '</span>' +
             '<span class="fp-cl-count" style="color:' + (RARITY_COLORS[f.rarity] || '#807060') + '">×' + counts[f.id] + '</span></div>';
    }).join('');
}

function startFishing() { _showCastingZone(); }
