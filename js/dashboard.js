const NEXUS_API = 'https://nexus-bot.discloud.app';
const TOKEN_KEY = 'nexus_session';

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

function renderModules(modList, guildId, modules) {
  modList.innerHTML = '';
  for (const m of modules) {
    const row = document.createElement('div');
    row.className = 'mod-row';
    row.innerHTML = `
      <div><span>${escapeHtml(m.name)}</span><small>${escapeHtml(m.description)}</small></div>
      <button type="button" class="toggle ${m.enabled ? 'on' : ''}" aria-label="${m.name}"></button>
    `;
    const btn = row.querySelector('.toggle');
    btn.addEventListener('click', async () => {
      const next = !btn.classList.contains('on');
      const r = await api(`/api/guilds/${guildId}/modules/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (r.ok) btn.classList.toggle('on', next);
      else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || 'No se pudo guardar el cambio.');
      }
    });
    modList.appendChild(row);
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
  showDash();

  const list = document.getElementById('guild-list');
  list.innerHTML = '<p class="dash-empty">Cargando servidores…</p>';

  const dashRes = await api('/api/me/dashboard');
  if (!dashRes.ok) {
    const err = await dashRes.json().catch(() => ({}));
    list.innerHTML = `<p class="dash-empty">${escapeHtml(err.error || 'Error al cargar el panel.')}</p>`;
    return;
  }

  const data = await dashRes.json();
  document.querySelector('.dash-hint').textContent = data.ownersOnly
    ? 'Solo servidores de los que eres dueño y donde Nexus está instalado.'
    : 'Servidores que administras y donde Nexus está instalado.';

  if (!data.guilds.length) {
    list.innerHTML =
      '<p class="dash-empty">No hay servidores elegibles.<br>Debes ser dueño e invitar a Nexus.</p>';
    return;
  }

  list.innerHTML = '';
  for (const g of data.guilds) {
    const card = document.createElement('div');
    card.className = 'guild-card';
    card.innerHTML = `<h2>${escapeHtml(g.name)}</h2><div class="mod-list"></div>`;
    list.appendChild(card);
    renderModules(card.querySelector('.mod-list'), g.id, g.modules || []);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  saveTokenFromUrl();
  document.getElementById('btn-login').addEventListener('click', loginRedirect);
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  if (sessionStorage.getItem(TOKEN_KEY)) loadDashboard();
  else showLogin();
});
