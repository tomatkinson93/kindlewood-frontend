/**
 * card-hand-ui.js  (frontend only)
 *
 * Deploys to: js/card-hand-ui.js
 * Script tag (bump ?v= on changes):
 *     <script src="js/card-definitions.js?v=..."></script>
 *     <script src="js/card-engine.js?v=..."></script>
 *     <script src="js/card-combat.js?v=..."></script>
 *     <script src="js/card-hand-ui.js?v=..."></script>
 *
 * Renders the player's current hand, energy pips, and an end-turn button into
 * the combat modal. This module is intentionally thin: it reads state.deck and
 * dispatches plays/end-turn back through callbacks the combat-ui wires up. It
 * does NOT mutate battle state directly — the engine owns that.
 *
 * Integration: in combat-ui.js, after building the battle state, call
 *     CardHandUI.mount({
 *       container: <DOM node for the hand>,
 *       getState:  () => _battle,
 *       onPlay:    (handIndex, targetId) => { ...call engine playCard... },
 *       onEndTurn: () => { ...call engine endTurn cycle... },
 *       isPlayerTurn: () => <bool>,
 *     });
 * then call CardHandUI.render() on every relevant engine event.
 */
(function (window) {
  'use strict';

  // Read the card source lazily (registry first for DB cards, then code defs)
  // so script load order can't leave us with an undefined reference.
  var _hoverAudio = null;
  var _hoverLast = 0;
  // Play the UI hover blip. Reuses one Audio element and throttles so rapid
  // hovers across the fan don't stack into a buzz.
  function _playHoverSfx() {
    var now = Date.now();
    if (now - _hoverLast < 60) return;
    _hoverLast = now;
    try {
      if (!_hoverAudio) _hoverAudio = new Audio('/assets/audio/ui-hover.wav');
      _hoverAudio.volume = (window.getSfxVolume ? getSfxVolume() : 0.4);
      _hoverAudio.currentTime = 0;
      _hoverAudio.play().catch(function () {});
    } catch (e) {}
  }

  // ── Touch tap-select (Mobile Spec Phase 4.2/4.3) ─────────────────────────
  // There is no hover on touch, and a single tap would otherwise play a card
  // immediately (easy to misfire) with no chance to read it first. On
  // (hover:none) devices we switch to a two-step model: first tap selects +
  // enlarges the card (and reveals its effect preview); a second tap on the
  // same card plays it; a tap anywhere else deselects. Desktop click-to-play
  // is byte-for-byte unchanged (every branch below is gated on _isTouchInput).
  var _touchDeselectWired = false;
  function _isTouchInput() {
    return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  }
  function _clearTouchSelect(scope) {
    (scope || document).querySelectorAll('.kw-card.kw-card-tap-selected').forEach(function (c) {
      c.classList.remove('kw-card-tap-selected');
      c.style.transform = c.getAttribute('data-rest-transform') || '';
      if (c.hasAttribute('data-z-rest')) c.style.zIndex = c.getAttribute('data-z-rest');
    });
  }
  function _wireTouchDeselect() {
    if (_touchDeselectWired) return;
    _touchDeselectWired = true;
    // Capture phase so a tap on a card is seen here first: if it lands on a
    // card we leave it for that card's own click handler; otherwise we clear.
    document.addEventListener('click', function (e) {
      if (!_isTouchInput()) return;
      if (e.target && e.target.closest && e.target.closest('.kw-card')) return;
      _clearTouchSelect(document);
    }, true);
  }

  function defs() { return window.CARD_REGISTRY || window.CARD_DEFS || null; }
  var cfg = null;
  var _renderRAF = null;   // coalesced-render frame handle
  var _pendingArgs = null; // accumulated render args during a burst
  var _lastPlayerActor = null; // last player unit acting (keeps formation block stable)

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  // Inline SVG icons for each pile type, each visually distinct so the pile is
  // recognisable at a glance (label + hover tooltip reinforce it).
  function _pileIcon(kind) {
    var c = { draw: '#cdb27a', discard: '#9aa0a6', exhaust: '#e0843c', withered: '#b487ff' }[kind] || '#cdb27a';
    if (kind === 'draw') {
      return '<svg class="kw-pile-svg" viewBox="0 0 32 32" fill="none">'
        + '<rect x="6" y="9" width="16" height="20" rx="2.5" fill="#1c150c" stroke="' + c + '" stroke-width="1.6"/>'
        + '<rect x="9" y="6" width="16" height="20" rx="2.5" fill="#241a0e" stroke="' + c + '" stroke-width="1.6"/>'
        + '<rect x="12" y="3" width="16" height="20" rx="2.5" fill="#2c2010" stroke="' + c + '" stroke-width="1.6"/>'
        + '</svg>';
    }
    if (kind === 'discard') {
      return '<svg class="kw-pile-svg" viewBox="0 0 32 32" fill="none">'
        + '<rect x="8" y="4" width="16" height="20" rx="2.5" fill="#20242a" stroke="' + c + '" stroke-width="1.6"/>'
        + '<path d="M16 28 L11 21 L21 21 Z" fill="' + c + '"/>'
        + '<line x1="16" y1="10" x2="16" y2="20" stroke="' + c + '" stroke-width="1.6" stroke-linecap="round"/>'
        + '</svg>';
    }
    if (kind === 'exhaust') {
      return '<svg class="kw-pile-svg" viewBox="0 0 32 32" fill="none">'
        + '<rect x="8" y="5" width="16" height="22" rx="2.5" fill="#2a1a0e" stroke="' + c + '" stroke-width="1.6"/>'
        + '<path d="M16 9c3 3 1 5 0 7-2-1-3-3-1-7zM16 9c-3 3-1 6 1 8 3-2 3-5 0-9z" fill="' + c + '" opacity=".85"/>'
        + '</svg>';
    }
    return '<svg class="kw-pile-svg" viewBox="0 0 32 32" fill="none">'
      + '<rect x="8" y="4" width="16" height="22" rx="2.5" fill="#241433" stroke="' + c + '" stroke-width="1.6"/>'
      + '<path d="M16 5 L14 12 L18 15 L13 19 L16 25" stroke="' + c + '" stroke-width="1.4" fill="none" stroke-linejoin="round"/>'
      + '<path d="M12 9 L10 11 M20 13 L22 12 M11 20 L9 22" stroke="' + c + '" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>'
      + '</svg>';
  }

  // Build a static (non-interactive) card face element for a card key. Used by
  // the pile modals (draw/discard). Mirrors the hand card's inner structure.
  function staticCardFace(key) {
    var D = defs();
    var card = D ? D.getCard(key) : null;
    if (!card) return el('div', 'kw-card kw-card-static', key);
    var node = el('div', 'kw-card kw-card-static kw-card-' + card.type);
    var inner = el('div', 'kw-card-inner');
    inner.appendChild(el('span', 'kw-card-cost', String(card.cost)));
    inner.appendChild(el('span', 'kw-card-name', card.name));
    inner.appendChild(el('span', 'kw-card-type', card.type));
    inner.appendChild(el('span', 'kw-card-desc', card.desc || ''));
    node.appendChild(inner);
    if (card.art_url) {
      node.style.backgroundImage =
        'linear-gradient(180deg,rgba(20,16,10,.25),rgba(20,16,10,.85)),url(' + card.art_url + ')';
      node.style.backgroundSize = 'cover';
      node.style.backgroundPosition = 'center';
    }
    return node;
  }

  // Pop a modal listing a pile's contents as cards. Order is SORTED (grouped by
  // name) so it never reveals the real draw order.
  function showPileModal(kind, pileArray, title) {
    closePileModal();
    var counts = {};
    (pileArray || []).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
    var keys = Object.keys(counts).sort();

    var overlay = el('div', 'kw-pile-overlay');
    overlay.id = 'kw-pile-overlay';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePileModal(); });

    var modal = el('div', 'kw-pile-modal');
    var header = el('div', 'kw-pile-modal-head');
    header.appendChild(el('span', 'kw-pile-modal-title', title + ' (' + (pileArray ? pileArray.length : 0) + ')'));
    var close = el('button', 'kw-pile-modal-close', '\u2715');
    close.addEventListener('click', closePileModal);
    header.appendChild(close);
    modal.appendChild(header);

    if (kind === 'draw') {
      modal.appendChild(el('div', 'kw-pile-modal-note', 'Contents only \u2014 not the order they\u2019ll be drawn.'));
    }

    var grid = el('div', 'kw-pile-grid');
    if (!keys.length) grid.appendChild(el('div', 'kw-cards-empty', 'Empty.'));
    keys.forEach(function (k) {
      var wrap = el('div', 'kw-pile-card-wrap');
      wrap.appendChild(staticCardFace(k));
      if (counts[k] > 1) wrap.appendChild(el('span', 'kw-pile-count', '\u00d7' + counts[k]));
      grid.appendChild(wrap);
    });
    modal.appendChild(grid);
    overlay.appendChild(modal);
    // Append inside the combat modal when present so we share its stacking
    // context and reliably paint on top; fall back to body otherwise.
    var host = document.getElementById('combat-modal') || document.body;
    host.appendChild(overlay);
  }

  function closePileModal() {
    var ex = document.getElementById('kw-pile-overlay');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
  }

  function mount(options) {
    cfg = options;
    if (!cfg.container) return;
    cfg.container.classList.add('kw-cards-root');
    render();
  }

  function unmount() {
    if (cfg && cfg.container) cfg.container.innerHTML = '';
    cfg = null;
  }

  // Public render: coalesce bursts of calls (the combat UI fires several per
  // action) into a single actual render on the next frame, so a multi-card draw
  // animates once over the final hand instead of rebuilding mid-animation.
  function render(pendingIndex, animateDeal) {
    // Remember the strongest animation request in the burst. 'all' wins; numeric
    // draw counts accumulate (two draw events of 1 each → animate 2 trailing).
    if (!_pendingArgs) _pendingArgs = { pendingIndex: pendingIndex, animateDeal: animateDeal || 0 };
    else {
      _pendingArgs.pendingIndex = pendingIndex;
      if (animateDeal === 'all' || _pendingArgs.animateDeal === 'all') {
        _pendingArgs.animateDeal = 'all';
      } else if (typeof animateDeal === 'number') {
        _pendingArgs.animateDeal = (typeof _pendingArgs.animateDeal === 'number' ? _pendingArgs.animateDeal : 0) + animateDeal;
      }
    }
    if (_renderRAF) return;
    _renderRAF = requestAnimationFrame(function () {
      _renderRAF = null;
      var args = _pendingArgs || {};
      _pendingArgs = null;
      _renderNow(args.pendingIndex, args.animateDeal);
    });
  }

  function _renderNow(pendingIndex, animateDeal) {
    if (!cfg || !cfg.container) return;
    if (typeof pendingIndex !== 'number') pendingIndex = -1;
    var state = cfg.getState ? cfg.getState() : null;
    var deck = state && state.deck;
    var container = cfg.container;

    _wireTouchDeselect();   // once; deselects tap-selected cards on outside taps

    if (!deck) {
      container.innerHTML = '';
      container.appendChild(el('div', 'kw-cards-empty', 'No deck active (using classic actions).'));
      return;
    }

    container.innerHTML = '';

    // ── Deal-in animation ───────────────────────────────────────────────────
    // animateDeal can be:
    //   'all'        animate the whole hand (end turn / battle start)
    //   <number>     animate exactly that many trailing cards (in-turn draws)
    //   falsy        animate nothing
    // Draws always append to the end of the hand, so the freshly-drawn cards are
    // always the trailing N.
    var handLen = deck.hand.length;
    var animateFromIdx;
    if (animateDeal === 'all') {
      animateFromIdx = 0;
    } else if (typeof animateDeal === 'number' && animateDeal > 0) {
      animateFromIdx = Math.max(0, handLen - animateDeal);
    } else {
      animateFromIdx = handLen; // animate nothing
    }

    var playerTurn = cfg.isPlayerTurn ? cfg.isPlayerTurn() : true;

    // --- energy + piles: rendered into the left rail (vertical) if present,
    //     otherwise into the container above the cards (fallback). ---
    var bar = el('div', 'kw-cards-bar');
    var energy = el('div', 'kw-energy');
    energy.appendChild(el('span', 'kw-energy-label', 'Energy'));
    var pips = el('span', 'kw-energy-pips');
    for (var i = 0; i < deck.energyMax; i++) {
      pips.appendChild(el('span', 'kw-pip' + (i < deck.energy ? ' on' : ''), ''));
    }
    energy.appendChild(pips);
    energy.appendChild(el('span', 'kw-energy-num', deck.energy + '/' + deck.energyMax));
    bar.appendChild(energy);

    // Three compact pile icons in a row (draw / discard / withered) with a
    // count badge over each. Keeps the rail height fixed so adding the withered
    // pile never pushes the UI off-screen. Hover shows a label.
    var piles = el('div', 'kw-piles');
    function pileTile(kind, label, count, list, title) {
      var tile = el('button', 'kw-pile-tile kw-pile-' + kind);
      tile.setAttribute('title', title);
      tile.innerHTML = _pileIcon(kind)
        + '<span class="kw-pile-badge">' + count + '</span>'
        + '<span class="kw-pile-cap">' + label + '</span>';
      tile.addEventListener('click', function () { showPileModal(kind, list, title); });
      return tile;
    }
    piles.appendChild(pileTile('draw', 'Draw', deck.drawPile.length, deck.drawPile, 'Draw Pile — cards waiting to be drawn'));
    piles.appendChild(pileTile('discard', 'Discard', deck.discardPile.length, deck.discardPile, 'Discard Pile — played/discarded cards, reshuffled when the draw pile empties'));
    if (deck.exhausted && deck.exhausted.length) {
      piles.appendChild(pileTile('exhaust', 'Exhaust', deck.exhausted.length, deck.exhausted, 'Exhausted — removed for the rest of this battle'));
    }
    piles.appendChild(pileTile('withered', 'Withered', (deck.withered ? deck.withered.length : 0), deck.withered || [], 'Withered — single-use cards spent for this battle, never redrawn'));
    bar.appendChild(piles);

    // --- formation move controls. Always rendered (even on the enemy turn) so
    //     the rail height stays stable and the UI doesn't jump; disabled when
    //     it's not the player's turn or there's no energy. ---
    var actor = cfg.getActor ? cfg.getActor() : null;
    var playerTurnNow = cfg.isPlayerTurn ? cfg.isPlayerTurn() : false;
    var formActor = (actor && actor.side === 'player') ? actor
                  : _lastPlayerActor; // fall back so we can still show a position
    if (formActor && formActor.pos != null) {
      if (actor && actor.side === 'player') _lastPlayerActor = actor;
      var canMove = playerTurnNow && deck.energy >= 1;
      var form = el('div', 'kw-formation');
      form.appendChild(el('div', 'kw-formation-title', 'Formation — position #' + formActor.pos));
      var fwd = el('button', 'kw-form-btn' + (canMove ? '' : ' disabled'));
      fwd.innerHTML = '<span class="kw-form-arrow">▶</span><span class="kw-form-label">Move to front<small>1 energy</small></span>';
      fwd.disabled = !canMove;
      fwd.addEventListener('click', function () { if (window.combatMove) combatMove(-1); });
      var back = el('button', 'kw-form-btn' + (canMove ? '' : ' disabled'));
      back.innerHTML = '<span class="kw-form-label" style="text-align:right">Move to back<small>1 energy</small></span><span class="kw-form-arrow">◀</span>';
      back.disabled = !canMove;
      back.addEventListener('click', function () { if (window.combatMove) combatMove(1); });
      form.appendChild(fwd);
      form.appendChild(back);
      bar.appendChild(form);
    }

    var leftRail = document.getElementById('cm-leftrail');
    if (leftRail) {
      leftRail.innerHTML = '';
      bar.classList.add('kw-cards-bar-vertical');
      leftRail.appendChild(bar);
    } else {
      container.appendChild(bar);
    }

    // --- hand (fanned arc) ---
    var hand = el('div', 'kw-hand');
    if (!deck.hand.length) {
      hand.appendChild(el('div', 'kw-cards-empty', 'Hand empty \u2014 end your turn to draw.'));
    }
    var D = defs();

    var n = deck.hand.length;
    // Fan geometry. Total spread scales gently with hand size but is capped so
    // big hands don't wrap past the edges. Each card is rotated around a point
    // far below the hand, and lifted slightly toward the centre, producing the
    // classic arc. center index is the pivot; cards left of it tilt left.
    var MAX_SPREAD_DEG = 26;        // total fan angle across the whole hand
    var spread = n > 1 ? Math.min(MAX_SPREAD_DEG, n * 5) : 0;
    var step = n > 1 ? spread / (n - 1) : 0;
    var mid = (n - 1) / 2;

    deck.hand.forEach(function (key, idx) {
      var card = D ? D.getCard(key) : null;
      if (!card) return;
      var affordable = card.cost <= deck.energy;
      var btn = el('button', 'kw-card kw-card-' + card.type +
        (affordable && playerTurn ? '' : ' disabled') +
        (card.wither ? ' kw-card-wither' : '') +
        (idx === pendingIndex ? ' kw-card-pending' : ''));
      btn.disabled = !(affordable && playerTurn);

      // Per-card fan transform — a smooth, even arc. Cards rotate progressively
      // from left to right and ride a shallow circular path so the hand reads as
      // one continuous fan (no individual cards popping up). The vertical drop at
      // the edges follows the same arc as the rotation, so it stays smooth.
      var off = idx - mid;                          // signed distance from centre
      var rot = off * step;                         // even rotation per card
      // Arc: y rises toward the centre along a gentle circle. Using (1 - cos)
      // gives a smooth bowl; scale keeps the lift subtle and even.
      var arcLift = (1 - Math.cos(rot * Math.PI / 180)) * 90;  // px downward at edges
      var nudgeX = off * -3;                         // slight overlap pull
      var tf = 'translateX(' + nudgeX + 'px) translateY(' + arcLift + 'px) rotate(' + rot + 'deg)';
      // A pending (selected-for-targeting) card stays raised and upright.
      if (idx === pendingIndex) {
        tf = 'translateY(-30px) rotate(0deg) scale(1.16)';
      }
      btn.style.zIndex = idx === pendingIndex ? '60' : String(10 + idx);
      btn.setAttribute('data-rest-transform', tf);
      btn.setAttribute('data-z-rest', btn.style.zIndex);

      // Deal-in animation: animate cards at/after animateFromIdx exactly once.
      var shouldAnimate = (idx >= animateFromIdx) && (idx !== pendingIndex);
      if (shouldAnimate) {
        // Fly in from the draw pile (lower-left, where the Draw Pile button is).
        var dealFrom = 'translate(-520px, 80px) rotate(-24deg) scale(.55)';
        btn.style.transition = 'none';
        btn.style.transform = dealFrom;
        btn.style.opacity = '0';
        (function (b, finalTf, i, base) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              var delay = Math.max(0, (i - base)) * 0.10;
              b.style.transition = 'transform .40s cubic-bezier(.2,.8,.3,1) ' + delay + 's, opacity .24s ' + delay + 's';
              b.style.transform = finalTf;
              b.style.opacity = '1';
            });
          });
        })(btn, tf, idx, animateFromIdx);
      } else {
        btn.style.transform = tf;
      }

      var inner = el('div', 'kw-card-inner');
      var cost = el('span', 'kw-card-cost', String(card.cost));
      var name = el('span', 'kw-card-name', card.name);
      var typeTag = el('span', 'kw-card-type', card.type);
      var desc = el('span', 'kw-card-desc', card.desc || '');
      inner.appendChild(cost);
      inner.appendChild(name);
      inner.appendChild(typeTag);
      inner.appendChild(desc);

      // Card art: paint the configured background image behind the text (same
      // treatment as the pile-modal faces). A dark gradient keeps text legible.
      if (card.art_url) {
        btn.style.backgroundImage =
          'linear-gradient(180deg,rgba(20,16,10,.25),rgba(20,16,10,.85)),url(' + card.art_url + ')';
        btn.style.backgroundSize = 'cover';
        btn.style.backgroundPosition = 'center';
      }

      // Calculated effect preview for THIS actor. For DB cards we compute from
      // the formula; if a card has no formula (code-only fallback), we show its
      // description as the bubble so there's always something. Element is always
      // created so CSS can reveal it on hover / when the card is selected.
      var actor = cfg.getActor ? cfg.getActor() : null;
      var preview = '';
      if (window.CARD_FORMULA && card.formula && actor) {
        try { preview = window.CARD_FORMULA.previewEffect(card.formula, actor); } catch (e) {}
      }
      if (!preview) preview = card.desc || '';
      btn.appendChild(inner);
      // Preview bubble is appended to the BUTTON (not inner, which clips with
      // overflow:hidden) so it can pop out above the card's top edge.
      if (preview) {
        var prevEl = el('span', 'kw-card-preview-val', preview);
        btn.appendChild(prevEl);
      }

      btn.setAttribute('data-hand-index', String(idx));
      btn.setAttribute('data-card-key', key);
      btn.setAttribute('data-target-mode', card.target || 'none');

      // Hover: straighten the card and lift it with a gentle zoom (much less
      // than Briar's 2.1x — per request). Inline style beats any CSS :hover
      // rule because of specificity, so we swap the inline transform directly
      // and restore the resting fan transform on mouse-leave.
      btn.addEventListener('mouseenter', function () {
        if (_isTouchInput()) return;          // touch uses tap-select, not hover
        if (btn.disabled) return;
        btn.style.transform = 'translateY(-22px) rotate(0deg) scale(1.22)';
        btn.style.zIndex = '50';
        _playHoverSfx();
      });
      btn.addEventListener('mouseleave', function () {
        if (_isTouchInput()) return;
        btn.style.transform = btn.getAttribute('data-rest-transform') || '';
        btn.style.zIndex = String(10 + idx);
      });

      btn.addEventListener('click', function () {
        if (!cfg || !cfg.onPlay) return;
        // Touch two-step: first tap selects + enlarges (no play); second tap on
        // the same card plays. A card already pending a target is past this.
        if (_isTouchInput() && idx !== pendingIndex &&
            !btn.classList.contains('kw-card-tap-selected')) {
          _clearTouchSelect(hand);
          btn.classList.add('kw-card-tap-selected');
          btn.style.transform = 'translateY(-22px) rotate(0deg) scale(1.22)';
          btn.style.zIndex = '55';
          return;
        }
        var requestedTarget = (cfg.getRequestedTarget &&
          cfg.getRequestedTarget(card.target)) || null;
        cfg.onPlay(idx, requestedTarget, card);
      });
      hand.appendChild(btn);
    });
    container.appendChild(hand);
    // NOTE: End Turn is rendered/owned by combat-ui in the right rail, not here,
    // to avoid duplicate buttons accumulating across re-renders.
  }

  window.CardHandUI = { mount: mount, unmount: unmount, render: render };
})(window);
