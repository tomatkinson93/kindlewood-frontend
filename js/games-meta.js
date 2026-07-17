// js/games-meta.js — single source of truth for tavern card-game display
// metadata (spec 19 §4.1). Keyed by the SERVER game-type key. No player-facing
// game name should be hardcoded anywhere else — read it from window.KWGames.
//
// Loaded before lobby.js and tavern.js so both can consume it at module load.
window.KWGames = window.KWGames || {};
window.KWGames.META = {
  briar: {
    key: 'briar',                       // matches the server game-type key exactly
    displayName: 'Briarwood Court',
    tagline: 'Bluff, challenge and banish — last courtier standing wins.',
    crest: '/assets/img/games/crest_briarwood_court.png',
    icon: '🌿',                         // fallback when the crest asset is missing
    reward: '4 gold',
    accent: 'court',                    // theme class suffix → .theme-court
  },
  squirrel: {
    key: 'squirrel',
    displayName: "Squirrel's Stash",
    tagline: 'Push your luck drawing acorns — bank before you bust.',
    crest: '/assets/img/games/crest_squirrels_stash.png',
    icon: '🐿️',
    reward: '4 gold',
    accent: 'stash',
  },
};
// Display name for a game key, falling back to the key itself.
window.KWGames.name = function (key) {
  const m = window.KWGames.META[key];
  return m ? m.displayName : key;
};
