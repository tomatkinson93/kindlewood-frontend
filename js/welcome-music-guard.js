// ══════════════════════════════════════════════
//  WELCOME MUSIC GUARD  (deploys to js/welcome-music-guard.js)
//  Load AFTER audio.js & main.js.
//
//  This is the SINGLE authority over #bg-music (welcome.mp3). It guarantees:
//   1. The track NEVER autoplays on page load.
//   2. It only ever plays while a pre-login screen is active.
//   3. It can never overlap itself — duplicate play() calls are coalesced, so
//      you never hear two copies at once (the "playing twice" bug).
//   4. It hard-stops the instant we leave the welcome/login/register screens
//      (e.g. auto-login dropping a returning visitor straight into the game).
//
//  It works WITHOUT knowing audio.js internals: it neutralises the <audio>
//  element's own autoplay, wraps its play() to enforce the rules, and starts
//  the track itself on the first user gesture while on a pre-login screen.
// ══════════════════════════════════════════════
(function () {
  'use strict';

  var PRELOGIN = ['screen-welcome', 'screen-login', 'screen-register'];

  function bgMusic() { return document.getElementById('bg-music'); }
  function activeScreenId() {
    var el = document.querySelector('.screen.active');
    return el ? el.id : null;
  }
  function onPreloginScreen() { return PRELOGIN.indexOf(activeScreenId()) !== -1; }

  // Neutralise the element's own autoplay/preload, and wrap play() so WE decide
  // when it may sound.
  function harden(a) {
    if (!a || a._wmHardened) return;
    a._wmHardened = true;

    try {
      a.autoplay = false;
      a.removeAttribute('autoplay');
      a.preload = 'none';
      a.setAttribute('preload', 'none');
    } catch (e) {}

    var nativePlay = a.play.bind(a);
    a._wmNativePlay = nativePlay;
    a.play = function () {
      // Disallowed context → resolve quietly without sounding.
      if (a.dataset.guardSilenced === '1' || !onPreloginScreen()) {
        try { a.pause(); a.currentTime = 0; } catch (e) {}
        return Promise.resolve();
      }
      // Already audible or a play is in flight → don't stack a second one.
      if (a._wmPlaying || (!a.paused && !a.ended)) {
        return Promise.resolve();
      }
      a._wmPlaying = true;
      var p = nativePlay();
      if (p && typeof p.then === 'function') {
        return p.catch(function () { a._wmPlaying = false; });
      }
      return p;
    };

    a.addEventListener('pause', function () { a._wmPlaying = false; });
    a.addEventListener('ended', function () { a._wmPlaying = false; });
    a.addEventListener('play', function () {
      if (a.dataset.guardSilenced === '1' || !onPreloginScreen()) {
        try { a.pause(); a.currentTime = 0; } catch (e) {}
        a._wmPlaying = false;
      }
    });
  }

  function stopWelcomeMusic() {
    var a = bgMusic();
    if (!a) return;
    try { if (!a.paused) a.pause(); a.currentTime = 0; } catch (e) {}
    a._wmPlaying = false;
    a.dataset.guardSilenced = '1';
  }

  function allowWelcomeMusic() {
    var a = bgMusic();
    if (a) delete a.dataset.guardSilenced;
  }

  // Start the track once, only on a user gesture, only on a pre-login screen.
  function tryStartOnGesture() {
    var a = bgMusic();
    if (!a) return;
    if (!onPreloginScreen()) return;
    if (a.dataset.guardSilenced === '1') return;
    if (a._wmPlaying || (!a.paused && !a.ended)) return;
    var r = a.play();
    if (r && typeof r.catch === 'function') r.catch(function () {});
  }

  function enforce() {
    var a = bgMusic();
    if (!a) return;
    harden(a);
    if (onPreloginScreen()) allowWelcomeMusic();
    else stopWelcomeMusic();
  }

  function init() {
    var a = bgMusic();
    if (a) harden(a);
    enforce();   // start silenced; nothing plays until a gesture on pre-login

    // Prototype-level safety net: some code paths create a SEPARATE Audio object
    // for welcome.mp3 (not the #bg-music element), which is the usual cause of
    // hearing the track twice. Wrap HTMLMediaElement.play so ANY element whose
    // source is welcome.mp3 obeys the same rules: never while off a pre-login
    // screen, and never a second overlapping instance.
    try {
      if (!HTMLMediaElement.prototype._wmPatched) {
        HTMLMediaElement.prototype._wmPatched = true;
        var proto = HTMLMediaElement.prototype;
        var origPlay = proto.play;
        proto.play = function () {
          var src = (this.currentSrc || this.src || '');
          var isWelcome = src.indexOf('welcome.mp3') !== -1;
          if (isWelcome) {
            if (!onPreloginScreen()) {
              try { this.pause(); this.currentTime = 0; } catch (e) {}
              return Promise.resolve();
            }
            // Stop any OTHER welcome.mp3 elements already sounding, so only one
            // plays at a time.
            var all = document.querySelectorAll('audio, video');
            for (var i = 0; i < all.length; i++) {
              var m = all[i];
              if (m !== this && ((m.currentSrc || m.src || '').indexOf('welcome.mp3') !== -1) && !m.paused) {
                try { m.pause(); m.currentTime = 0; } catch (e) {}
              }
            }
            if (!this.paused && !this.ended) return Promise.resolve();
          }
          return origPlay.apply(this, arguments);
        };
      }
    } catch (e) { /* prototype patch best-effort */ }

    var gestureEvents = ['click', 'keydown', 'touchstart'];
    function onGesture() { tryStartOnGesture(); }
    gestureEvents.forEach(function (ev) {
      document.addEventListener(ev, onGesture, { passive: true });
    });

    var screens = document.querySelectorAll('.screen');
    if (screens.length) {
      var parent = screens[0].parentElement || document.body;
      var obs = new MutationObserver(function () { enforce(); });
      obs.observe(parent, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }

    setTimeout(enforce, 300);
    setTimeout(enforce, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
