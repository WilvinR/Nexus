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
  sanciones: '⚖️',
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
  switchDashView('servers');
  document.getElementById('guild-grid').classList.remove('hidden');
  document.getElementById('guild-config').classList.add('hidden');
}

function switchDashView(view) {
  document.querySelectorAll('.dash-subnav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.getElementById('view-servers').classList.toggle('hidden', view !== 'servers');
  document.getElementById('view-help').classList.toggle('hidden', view !== 'help');
  document.getElementById('view-search').classList.toggle('hidden', view !== 'search');
  document.getElementById('dash-hint').classList.toggle('hidden', view !== 'servers');

  const titles = { servers: 'TUS SERVIDORES', help: 'AYUDA', search: 'BUSCAR' };
  document.getElementById('dash-page-title').textContent = titles[view] || 'DASHBOARD';

  if (view === 'help') loadHelpVideos();
  if (view === 'search') document.getElementById('albion-search-q')?.focus();
}

async function loadHelpVideos() {
  const box = document.getElementById('help-videos-list');
  if (!box) return;
  box.innerHTML = '<p class="dash-empty">Cargando…</p>';
  const r = await api('/api/help/videos');
  if (!r.ok) {
    box.innerHTML = '<p class="dash-empty">No se pudieron cargar los videos.</p>';
    return;
  }
  const { videos } = await r.json();
  if (!videos.length) {
    box.innerHTML = '<p class="dash-empty">Aún no hay videos de ayuda.</p>';
    return;
  }
  box.innerHTML = videos
    .map(
      (v) => `<div class="help-video-card">
        <h4 class="help-video-title">${escapeHtml(v.title)}</h4>
        ${
          v.youtubeId
            ? `<div class="help-video-embed"><iframe src="https://www.youtube.com/embed/${escapeHtml(v.youtubeId)}" title="${escapeHtml(v.title)}" allowfullscreen loading="lazy"></iframe></div>`
            : `<p class="modal-meta"><a href="${escapeHtml(v.youtubeUrl)}" target="_blank" rel="noopener">Ver en YouTube</a></p>`
        }
      </div>`,
    )
    .join('');
}

let searchMode = 'players';

function fmtAlbionFame(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '—';
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(x);
}

async function runAlbionSearch() {
  const q = document.getElementById('albion-search-q')?.value.trim();
  const box = document.getElementById('albion-search-results');
  if (!q || q.length < 2) {
    box.innerHTML = '<p class="modal-meta">Escribe al menos 2 caracteres.</p>';
    return;
  }
  box.innerHTML = '<p class="dash-empty">Buscando…</p>';
  const path =
    searchMode === 'guilds'
      ? `/api/albion/search/guilds?q=${encodeURIComponent(q)}`
      : `/api/albion/search/players?q=${encodeURIComponent(q)}`;
  const r = await api(path);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    box.innerHTML = `<p class="dash-empty">${escapeHtml(err.error || 'Error de búsqueda')}</p>`;
    return;
  }
  const data = await r.json();
  if (searchMode === 'guilds') {
    const list = data.guilds || [];
    box.innerHTML = list.length
      ? list
          .map(
            (g) => `<div class="capsule search-result-item">
              <div class="capsule-name"><strong>${escapeHtml(g.name)}</strong>
                ${g.allianceName ? `<span class="modal-meta"> · [${escapeHtml(g.allianceTag || g.allianceName)}]</span>` : ''}
                <br><span class="modal-meta">ID: ${escapeHtml(g.id)} · Miembros: ${g.memberCount ?? '—'} · Fama: ${fmtAlbionFame(g.killFame)}</span>
              </div>
            </div>`,
          )
          .join('')
      : '<p class="dash-empty">Sin resultados.</p>';
  } else {
    const list = data.players || [];
    box.innerHTML = list.length
      ? list
          .map(
            (p) => `<div class="capsule search-result-item">
              <div class="capsule-name"><strong>${escapeHtml(p.name)}</strong>
                ${p.guildName ? `<span class="modal-meta"> · ${escapeHtml(p.guildName)}</span>` : ''}
                <br><span class="modal-meta">ID: ${escapeHtml(p.id)} · Kill: ${fmtAlbionFame(p.killFame)} · Death: ${fmtAlbionFame(p.deathFame)}</span>
              </div>
            </div>`,
          )
          .join('')
      : '<p class="dash-empty">Sin resultados.</p>';
  }
}

function openGuild(g) {
  document.getElementById('view-servers').classList.remove('hidden');
  document.getElementById('guild-grid').classList.add('hidden');
  document.getElementById('guild-config').classList.remove('hidden');
  document.getElementById('dash-page-title').textContent = 'CONFIGURAR';
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
  const configurable = moduleModals?.CONFIG_MODULES || new Set(['registro', 'kill', 'battle', 'logs', 'utilidad', 'sanciones', 'eventos']);
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
  switchDashView('servers');

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
  hint += ' Registro, Killboard, Battle, Logs, Sanciones, Eventos y Utilidad tienen Configurar.';
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

  document.querySelectorAll('.dash-subnav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'servers') showGuildGrid();
      switchDashView(btn.dataset.view);
    });
  });

  document.querySelectorAll('.search-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      searchMode = btn.dataset.search;
      document.querySelectorAll('.search-tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('albion-search-results').innerHTML = '';
    });
  });

  document.getElementById('albion-search-btn')?.addEventListener('click', runAlbionSearch);
  document.getElementById('albion-search-q')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runAlbionSearch();
  });

  if (NexusAuth.getToken()) loadDashboard();
  else showLogin();

  window.addEventListener('pageshow', (e) => {
    if (e.persisted && NexusAuth.getToken()) loadDashboard();
  });
});
