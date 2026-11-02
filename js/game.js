// ── Resource tick ──
let tickResources = null;
let tickRates = null;
let tickInterval = null;
let syncInterval = null;

function startResourceTick(resources, rates) {
  tickResources = { ...resources };
  tickRates = { ...rates };

  if (tickInterval) clearInterval(tickInterval);
  if (syncInterval) clearInterval(syncInterval);

  // Update display every second
  tickInterval = setInterval(() => {
    if (!tickResources || !tickRates) return;
    // Every resource with a rate (the base five, and ores once mines turn them up).
    for (const k of Object.keys(tickRates)) {
      if (typeof tickRates[k] === 'number') tickResources[k] = (Number(tickResources[k]) || 0) + tickRates[k] / 3600;
    }
    updateTopbarDisplay();
    // Fire the floater for any resource whose integer displayed value
    // just changed. The function is supplied by resources.js; guarded
    // with typeof so this file still works if resources.js isn't loaded.
    if (typeof checkResourceFloaters === 'function') {
      checkResourceFloaters(tickResources);
    }
  }, 1000);

  // Initialise the floater baseline so the first tick after start doesn't
  // diff against undefined and spawn a spurious "+N" for an N as large as
  // the entire current stockpile.
  if (typeof resetResourceFloaterBaseline === 'function') {
    resetResourceFloaterBaseline(tickResources);
  }

  // Sync with server every 5 minutes
  syncInterval = setInterval(() => {
    apiFetch('/api/game/settlement')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.settlement) {
          tickResources = { ...data.settlement.resources };
          tickRates = { ...data.settlement.rates };
          if (gameData?.settlement) {
            gameData.settlement.discovered = data.settlement.discovered || [];
            gameData.settlement.new_discoveries = data.settlement.new_discoveries || [];
          }
          if (window.KWStores) KWStores.onSettlement(data.settlement);
          if (gameData?.settlement) gameData.settlement.famine = data.settlement.famine || null;
          if (typeof renderFamineBanner === 'function') renderFamineBanner(data.settlement.famine);
          if (gameData?.settlement) gameData.settlement.town = data.settlement.town || null;
          if (window.KWTown) KWTown.onSettlement(data.settlement);
          if (window.KWRaids) KWRaids.onSettlement(data.settlement);   // a Withered raid on its way
          // Reset baseline after the sync — the server may have added a
          // chunk of resources for offline time, and we don't want a
          // surprise "+8,432 food" floater to flash over the topbar.
          if (typeof resetResourceFloaterBaseline === 'function') {
            resetResourceFloaterBaseline(tickResources);
          }
        }
      })
      .catch(() => {});
  }, 5 * 60 * 1000);
}

function stopResourceTick() {
  if (tickInterval) clearInterval(tickInterval);
  if (syncInterval) clearInterval(syncInterval);
  tickResources = null;
  tickRates = null;
}

function updateTopbarDisplay() {
  if (!tickResources || !tickRates) return;
  // Sync any resource that gameData says is higher than our local tick copy.
  // This covers one-time awards (quest gold, combat loot, etc.) that update
  // gameData but don't go through the per-second tick path.
  if (gameData?.settlement?.resources) {
    const r = gameData.settlement.resources;
    if (r.wealth  > tickResources.wealth)  tickResources.wealth  = r.wealth;
    if (r.food    > tickResources.food)    tickResources.food    = r.food;
    if (r.timber  > tickResources.timber)  tickResources.timber  = r.timber;
    if (r.stone   > tickResources.stone)   tickResources.stone   = r.stone;
    if (r.metal   > tickResources.metal)   tickResources.metal   = r.metal;
    for (const k of (window.KWResources ? KWResources.EXTRA : [])) {
      if (r[k] > (tickResources[k] || 0)) tickResources[k] = r[k];
    }
  }
  const set = (id, val, rate) => {
    const el = document.getElementById('res-' + id);
    if (!el) return;
    el.querySelector('.res-val').textContent = Math.floor(val).toLocaleString();
    el.querySelector('.res-rate').textContent = `+${rate}/hr`;
  };
  set('food',   tickResources.food,   tickRates.food);
  set('timber', tickResources.timber, tickRates.timber);
  set('stone',  tickResources.stone,  tickRates.stone);
  set('metal',  tickResources.metal,  tickRates.metal);
  set('wealth', tickResources.wealth, tickRates.wealth);
  if (window.KWStores) KWStores.render();
}

// ── Settlement naming modal ──
function showNamingModal(currentName, onConfirm) {
  const backdrop = document.getElementById('naming-backdrop');
  const input = document.getElementById('naming-input');
  const preview = document.getElementById('naming-preview');
  input.value = '';
  preview.textContent = currentName;
  backdrop.classList.add('open');
  input.focus();

  input.oninput = () => {
    preview.textContent = input.value.trim() || currentName;
  };

  document.getElementById('naming-confirm').onclick = async () => {
    const name = input.value.trim();
    if (!name || name.length < 2) {
      document.getElementById('naming-error').style.display = 'block';
      return;
    }
    document.getElementById('naming-error').style.display = 'none';
    backdrop.classList.remove('open');
    await onConfirm(name);
  };

  document.getElementById('naming-skip').onclick = () => {
    backdrop.classList.remove('open');
  };
}

async function renameSettlement(name) {
  try {
    const res = await apiFetch('/api/game/settlement/rename', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.ok) {
      gameData.settlement.name = data.name;
      document.getElementById('panel-title').textContent = data.name;
    }
  } catch (e) {}
}
