const NEXUS_API = 'https://nexus-bot.discloud.app';

function apiUrl(path) {
  return `${NEXUS_API.replace(/\/$/, '')}${path}`;
}

async function loadPublicStats() {
  const el = document.getElementById('srv-count');
  const botEl = document.getElementById('bot-status');
  if (!el) return;

  try {
    const res = await fetch(apiUrl('/api/public'));
    const data = await res.json();
    if (!data.ok) return;

    animateCount(el, data.guilds ?? 0);
    if (botEl && data.bot) botEl.textContent = data.ready ? 'Online' : 'Conectando…';

    for (const id of ['btn-invite', 'btn-invite-2']) {
      const btn = document.getElementById(id);
      if (btn && data.invite) btn.href = data.invite;
    }
  } catch {
    el.textContent = '—';
  }
}

function animateCount(el, target) {
  let count = 0;
  const interval = setInterval(() => {
    count += Math.max(1, Math.ceil((target - count) / 8));
    if (count >= target) {
      count = target;
      clearInterval(interval);
    }
    el.textContent = count;
  }, 45);
}

function initModuleCards() {
  const cards = document.querySelectorAll('.mod-card');
  const reveal = () => {
    cards.forEach((card) => {
      if (card.getBoundingClientRect().top < window.innerHeight * 0.88) card.classList.add('visible');
    });
  };
  reveal();
  window.addEventListener('scroll', reveal, { passive: true });
}

document.addEventListener('DOMContentLoaded', () => {
  loadPublicStats();
  initModuleCards();
  for (const id of ['btn-dashboard', 'btn-dashboard-2']) {
    document.getElementById(id)?.addEventListener('click', () => {
      alert('Dashboard — inicio de sesión con Discord próximamente.');
    });
  }
});
