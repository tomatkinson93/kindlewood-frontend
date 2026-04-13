const CAROUSEL_SPECIES = ['mouse','badger','fox','otter','hare','mole'];
let carouselIdx = 0;

// Preload sound
const pageTurnAudio = new Audio('/assets/pageturn.wav');
pageTurnAudio.volume = 0.5;

function playPageTurn() {
  pageTurnAudio.currentTime = 0;
  pageTurnAudio.play().catch(() => {});
}

function carouselRender() {
  const cards = Array.from(document.querySelectorAll('#carousel-track .sp-card'));
  const total = cards.length;

  cards.forEach((card, i) => {
    card.classList.remove('pos-active','pos-l1','pos-r1','pos-l2','pos-r2','pos-hidden');
    card.onclick = null;

    let offset = i - carouselIdx;
    if (offset > total / 2) offset -= total;
    if (offset < -total / 2) offset += total;

    if (offset === 0) {
      card.classList.add('pos-active');
    } else if (offset === -1) {
      card.classList.add('pos-l1');
      card.onclick = () => carouselGo(carouselIdx - 1);
    } else if (offset === 1) {
      card.classList.add('pos-r1');
      card.onclick = () => carouselGo(carouselIdx + 1);
    } else if (offset === -2) {
      card.classList.add('pos-l2');
      card.onclick = () => carouselGo(carouselIdx - 2);
    } else if (offset === 2) {
      card.classList.add('pos-r2');
      card.onclick = () => carouselGo(carouselIdx + 2);
    } else {
      card.classList.add('pos-hidden');
    }
  });

  const dots = document.getElementById('carousel-dots');
  if (dots) {
    dots.innerHTML = CAROUSEL_SPECIES.map((_, i) =>
      `<div class="carousel-dot ${i === carouselIdx ? 'active' : ''}" onclick="carouselGo(${i})"></div>`
    ).join('');
  }
}

function carouselGo(idx) {
  const total = CAROUSEL_SPECIES.length;
  const newIdx = ((idx % total) + total) % total;
  if (newIdx === carouselIdx) return;
  carouselIdx = newIdx;
  playPageTurn();
  carouselRender();
}

function carouselNext() { carouselGo(carouselIdx + 1); }
function carouselPrev() { carouselGo(carouselIdx - 1); }

function openModalCurrent() { openModal(CAROUSEL_SPECIES[carouselIdx]); }

function selectCurrentSpecies() {
  showScreen('register');
  setTimeout(() => {
    const spName = SPECIES_DATA[CAROUSEL_SPECIES[carouselIdx]].name;
    document.querySelectorAll('.sp-option').forEach(o => {
      if (o.dataset.sp === spName) pickSpecies(o);
    });
  }, 80);
}

document.addEventListener('keydown', e => {
  const welcome = document.getElementById('screen-welcome');
  if (!welcome || !welcome.classList.contains('active')) return;
  if (e.key === 'ArrowLeft') carouselPrev();
  if (e.key === 'ArrowRight') carouselNext();
});

let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, {passive:true});
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const welcome = document.getElementById('screen-welcome');
  if (!welcome || !welcome.classList.contains('active')) return;
  if (dx < -40) carouselNext();
  if (dx > 40) carouselPrev();
});

window.addEventListener('DOMContentLoaded', () => { carouselRender(); });

function scrollToSpecies() {
  document.querySelector('.species-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
