const NEXUS_API = 'https://nexus-bot.discloud.app';

let guildsData = [];
let currentGuildId = null;
let moduleModals = null;

const MODULE_EMOJI = {
  registro: '🏰',
  kill: '⚔️',
  battle: '🛡️',
  mercado: '🪙',
  logs: '📜',
  moderacion: '⚒️',
  eventos: '🏹',
  musica: '🎵',
  bal: '💰',
  utilidad: '📩',
};

function api(path, opts = {}) {
  return fetch(`${NEXUS_API.replace(/\/$/, '')}${path}`, {
    ...opts,
    headers: NexusAuth.authHeaders(opts.headers || {}),
  });
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function loginRedirect() {
  NexusAuth.startLogin(NEXUS_API);
}

function showLogin() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-dash').classList.add('hidden');
}

function showDash() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-dash').classList.remove('hidden');
}

function guildIconUrl(g) {
  if (!g.icon) return null;
  return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128`;
}

function guildInitial(name) {
  const t = (name || '?').trim();
  return (t[0] || '?').toUpperCase();
}

function setGuildHeader(g) {
  const avatar = document.getElementById('guild-config-avatar');
  avatar.replaceChildren();
  document.getElementById('guild-config-name').textContent = g.name;
  const url = guildIconUrl(g);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = g.name;
    avatar.appendChild(img);
  } else {
    const ph = document.createElement('span');
    ph.className = 'guild-avatar-ph';
    ph.textContent = guildInitial(g.name);
    avatar.appendChild(ph);
  }
}

function showGuildGrid() {
  document.getElementById('guild-grid').classList.remove('hidden');
  document.getElementById('guild-config').classList.add('hidden');
  document.querySelector('.dash-head h1').textContent = 'TUS SERVIDORES';
  document.getElementById('dash-hint').classList.remove('hidden');
}

function openGuild(g) {
  document.getElementById('guild-grid').classList.add('hidden');
  document.getElementById('guild-config').classList.remove('hidden');
  document.querySelector('.dash-head h1').textContent = 'CONFIGURAR';
  document.getElementById('dash-hint').classList.add('hidden');
  currentGuildId = g.id;
  channelsCacheReset();
  setGuildHeader(g);
  renderModules(document.getElementById('mod-list'), g.id, g.modules || []);
}

function channelsCacheReset() {
  /* reinicia caché de canales/roles al cambiar de servidor */
  if (typeof window.__dashResetCaches === 'function') window.__dashResetCaches();
}

function renderGuildGrid() {
  const grid = document.getElementById('guild-grid');
  grid.innerHTML = '';
  for (const g of guildsData) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'guild-pick';
    const url = guildIconUrl(g);
    const iconHtml = url
      ? `<img src="${url}" alt="" width="72" height="72" loading="lazy">`
      : `<span class="guild-pick-ph" aria-hidden="true">${escapeHtml(guildInitial(g.name))}</span>`;
    btn.innerHTML = `${iconHtml}<span class="guild-pick-name">${escapeHtml(g.name)}</span>`;
    btn.addEventListener('click', () => openGuild(g));
    grid.appendChild(btn);
  }
}

function renderModules(modList, guildId, modules) {
  modList.innerHTML = '';
  const configurable = moduleModals?.CONFIG_MODULES || new Set(['registro', 'kill', 'battle', 'logs', 'utilidad']);
  for (const m of modules) {
    const showConfig = configurable.has(m.id);
    const emoji = MODULE_EMOJI[m.id] || '⚙️';
    const card = document.createElement('div');
    card.className = `dash-mod-card${m.enabled ? '' : ' dash-mod-off'}`;
    card.innerHTML = `
      <div class="dash-mod-top">
        <span class="dash-mod-emoji" aria-hidden="true">${emoji}</span>
        <button type="button" class="toggle ${m.enabled ? 'on' : ''}" aria-label="${escapeHtml(m.name)}"></button>
      </div>
      <div class="dash-mod-name">${escapeHtml(m.name)}</div>
      ${showConfig ? '<button type="button" class="dash-mod-config">Configurar</button>' : ''}
      <p class="dash-mod-desc">${escapeHtml(m.description)}</p>
    `;
    card.querySelector('.toggle').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const next = !btn.classList.contains('on');
      const r = await api(`/api/guilds/${guildId}/modules/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (r.ok) {
        const g = guildsData.find((x) => x.id === guildId);
        if (g?.modules) {
          const mod = g.modules.find((x) => x.id === m.id);
          if (mod) mod.enabled = next;
        }
        renderModules(modList, guildId, g?.modules || modules);
      } else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || 'No se pudo guardar el cambio.');
      }
    });
    const cfgBtn = card.querySelector('.dash-mod-config');
    if (cfgBtn) {
      cfgBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.openModuleConfig?.(m.id);
      });
    }
    modList.appendChild(card);
  }
}

async function loadDashboard() {
  const meRes = await api('/api/me');
  if (!meRes.ok) {
    NexusAuth.clearToken();
    showLogin();
    return;
  }
  const me = await meRes.json();
  let userLine = `Conectado como ${me.user.username}`;
  if (me.isOwner) {
    userLine += ' · 👑 Dueño del bot';
  }
  document.getElementById('user-label').innerHTML = userLine;
  showDash();
  showGuildGrid();

  const grid = document.getElementById('guild-grid');
  grid.innerHTML = '<p class="dash-empty">Cargando servidores…</p>';
  document.getElementById('guild-config').classList.add('hidden');

  const dashRes = await api('/api/me/dashboard');
  if (!dashRes.ok) {
    const err = await dashRes.json().catch(() => ({}));
    grid.innerHTML = `<p class="dash-empty">${escapeHtml(err.error || 'Error al cargar el panel.')}</p>`;
    return;
  }

  const data = await dashRes.json();
  const hintEl = document.getElementById('dash-hint');
  let hint = data.isOwner
    ? '👑 Dueño del bot: ves todos los servidores con Nexus.'
    : data.ownersOnly
      ? 'Toca un servidor donde seas dueño de Discord (con Nexus instalado).'
      : 'Toca un servidor que administres.';
  hint += ' Registro, Killboard, Battle y Logs tienen Configurar.';
  if (me.isOwner) {
    hint += ' · <a href="admin.html" class="admin-link">Panel owner</a>';
  }
  hintEl.innerHTML = hint;

  if (!data.guilds.length) {
    guildsData = [];
    grid.innerHTML =
      '<p class="dash-empty">No hay servidores elegibles.<br>Debes ser dueño e invitar a Nexus.</p>';
    return;
  }

  guildsData = data.guilds;
  renderGuildGrid();
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  moduleModals = initModuleModals({
    api,
    escapeHtml,
    getGuildId: () => currentGuildId,
  });
  window.__dashResetCaches = () => {
    /* dashboard-modules.js resetea al abrir modal */
  };
  NexusAuth.applyTokenFromUrl(showAuthError);
  document.getElementById('btn-login').addEventListener('click', loginRedirect);
  document.getElementById('btn-logout').addEventListener('click', () => {
    NexusAuth.clearToken();
    showLogin();
  });
  document.getElementById('btn-back').addEventListener('click', showGuildGrid);

  if (NexusAuth.getToken()) loadDashboard();
  else showLogin();

  window.addEventListener('pageshow', (e) => {
    if (e.persisted && NexusAuth.getToken()) loadDashboard();
  });
});
