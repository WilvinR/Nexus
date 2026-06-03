const NEXUS_API = 'https://nexus-bot.discloud.app';
/** ID público de la aplicación Discord (Developer Portal → General) */
const DISCORD_CLIENT_ID = '1348090006547337318';
const BOT_INVITE = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&permissions=268568576&scope=bot%20applications.commands`;

function apiUrl(path) {
  return `${NEXUS_API.replace(/\/$/, '')}${path}`;
}

function setInviteLinks(url) {
  const invite = url || BOT_INVITE;
  for (const id of ['btn-invite', 'btn-invite-2']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.href = invite;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
  }
}

async function loadPublicStats() {
  setInviteLinks(BOT_INVITE);

  const el = document.getElementById('srv-count');
  const botEl = document.getElementById('bot-status');
  if (!el) return;

  try {
    const res = await fetch(apiUrl('/api/public'));
    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        animateCount(el, data.guilds ?? 0);
        if (botEl) botEl.textContent = data.ready ? 'Online' : 'Conectando…';
        if (data.invite) setInviteLinks(data.invite);
        return;
      }
    }
  } catch {
    /* CORS o API antigua en Discloud — probamos /health */
  }

  try {
    const res = await fetch(apiUrl('/health'));
    const data = await res.json();
    if (data.ok) {
      animateCount(el, data.guilds ?? 0);
      if (botEl) botEl.textContent = data.ready ? 'Online' : 'Offline';
    }
  } catch {
    el.textContent = '—';
    if (botEl) botEl.textContent = 'Sin conexión';
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
