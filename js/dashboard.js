const NEXUS_API = 'https://nexus-bot.discloud.app';
const TOKEN_KEY = 'nexus_session';

let guildsData = [];
let currentGuildId = null;
let moduleModals = null;

function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${NEXUS_API.replace(/\/$/, '')}${path}`, { ...opts, headers });
}

function saveTokenFromUrl() {
  const p = new URLSearchParams(location.search);
  const t = p.get('token');
  if (t) {
    sessionStorage.setItem(TOKEN_KEY, t);
    history.replaceState({}, '', location.pathname);
  }
}

function loginRedirect() {
  const back = `${location.origin}${location.pathname}`;
  window.location.href = `${NEXUS_API}/api/auth/login?redirect=${encodeURIComponent(back)}`;
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
  const configurable = moduleModals?.CONFIG_MODULES || new Set();
  for (const m of modules) {
    const card = document.createElement('div');
    card.className = `mod-card ${m.enabled ? '' : 'mod-card-off'}`;
    const canConfig = configurable.has(m.id) && m.enabled;
    card.innerHTML = `
      <div class="mod-card-info">
        <span class="mod-card-name">${escapeHtml(m.name)}</span>
        <small>${escapeHtml(m.description)}</small>
      </div>
      <div class="mod-card-actions">
        ${canConfig ? `<button type="button" class="btn btn-sm btn-config" data-mod="${m.id}">Configurar</button>` : ''}
        <button type="button" class="toggle ${m.enabled ? 'on' : ''}" aria-label="${m.name}"></button>
      </div>
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
        btn.classList.toggle('on', next);
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
    if (canConfig) {
      card.querySelector('.btn-config').addEventListener('click', () => {
        if (window.openModuleConfig) window.openModuleConfig(m.id);
      });
      card.classList.add('mod-card-click');
      card.addEventListener('click', (e) => {
        if (e.target.closest('.toggle') || e.target.closest('.btn-config')) return;
        window.openModuleConfig?.(m.id);
      });
    }
    modList.appendChild(card);
  }
}

async function loadDashboard() {
  const meRes = await api('/api/me');
  if (!meRes.ok) {
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
    return;
  }
  const me = await meRes.json();
  document.getElementById('user-label').textContent = `Conectado como ${me.user.username}`;
  if (me.isOwner) {
    const hint = document.getElementById('dash-hint');
    hint.innerHTML +=
      ' · <a href="admin.html" class="admin-link">Panel owner</a>';
  }
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
  document.getElementById('dash-hint').textContent = data.ownersOnly
    ? 'Toca un servidor para configurar módulos (solo dueños con Nexus instalado).'
    : 'Toca un servidor para configurar módulos.';

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
  saveTokenFromUrl();
  document.getElementById('btn-login').addEventListener('click', loginRedirect);
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
  });
  document.getElementById('btn-back').addEventListener('click', showGuildGrid);

  if (sessionStorage.getItem(TOKEN_KEY)) loadDashboard();
  else showLogin();
});
