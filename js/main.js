const API = window.KINDLEWOOD_API || '';

let chosenSpecies = null;
let gameData = null;
let worldMapData = null;
let _selectedFogTile = null; // {wx, wy} — persists across re-renders

function getStoredToken() {
  return localStorage.getItem('kw_token') || '';
}