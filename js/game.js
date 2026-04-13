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
    const perSecond = {
      food:   tickRates.food   / 3600,
      timber: tickRates.timber / 3600,
      stone:  tickRates.stone  / 3600,
      metal:  tickRates.metal  / 3600,
      wealth: tickRates.wealth / 3600,
    };
    tickResources.food   += perSecond.food;
    tickResources.timber += perSecond.timber;
    tickResources.stone  += perSecond.stone;
    tickResources.metal  += perSecond.metal;
    tickResources.wealth += perSecond.wealth;
    updateTopbarDisplay();
  }, 1000);

  // Sync with server every 5 minutes
  syncInterval = setInterval(() => {
    apiFetch('/api/game/settlement')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.settlement) {
          tickResources = { ...data.settlement.resources };
          tickRates = { ...data.settlement.rates };
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
