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

  const gRes = await api('/api/me/guilds');
  const list = document.getElementById('guild-list');
  if (!gRes.ok) {
    list.innerHTML = '<p class="dash-empty">No se pudieron cargar tus servidores.</p>';
    return;
  }
  const { guilds } = await gRes.json();
  if (!guilds.length) {
    list.innerHTML =
      '<p class="dash-empty">No hay servidores con Nexus donde tengas permiso de administrador.<br>Invita el bot desde la página principal.</p>';
    return;
  }

  list.innerHTML = '';
  for (const g of guilds) {
    const card = document.createElement('div');
    card.className = 'guild-card';
    card.innerHTML = `<h2>${escapeHtml(g.name)}</h2><div class="mod-list"></div>`;
    list.appendChild(card);
    const modList = card.querySelector('.mod-list');
    const mRes = await api(`/api/guilds/${g.id}/modules`);
    if (!mRes.ok) {
      modList.innerHTML = '<p class="dash-empty">Sin acceso a este servidor.</p>';
      continue;
    }
    const { modules } = await mRes.json();
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
        const r = await api(`/api/guilds/${g.id}/modules/${m.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        });
        if (r.ok) btn.classList.toggle('on', next);
        else alert('No se pudo guardar. ¿Sigues con permisos en ese servidor?');
      });
      modList.appendChild(row);
    }
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
