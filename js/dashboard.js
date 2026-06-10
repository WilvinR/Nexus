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

  const titles = { servers: 'TUS SERVIDORES', help: 'AYUDA', search: 'INFORMACIÓN ALBION' };
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

function fmtAlbionFame(n, showZero = false) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x <= 0) return showZero ? '0' : '—';
  if (x >= 1e12) return `${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return x.toLocaleString('en-US');
}

function fmtRatio(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES');
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copiado';
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    }
  } catch {
    alert('No se pudo copiar');
  }
}

function idRow(label, value) {
  if (!value) return '';
  return `<div class="search-id-row">
    <span class="search-id-label">${escapeHtml(label)}</span>
    <code class="search-id-val">${escapeHtml(value)}</code>
    <button type="button" class="btn btn-ghost btn-sm search-copy-btn" data-copy="${escapeHtml(value)}">Copiar</button>
  </div>`;
}

function bindCopyButtons(root) {
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(btn.getAttribute('data-copy'), btn);
    });
  });
}

function albionLoaderHtml(text = 'Consultando Albion…') {
  return `<div class="albion-loader" role="status" aria-live="polite">
    <div class="albion-loader-swords" aria-hidden="true">
      <span class="albion-sword albion-sword-left">⚔</span>
      <span class="albion-sword-spark"></span>
      <span class="albion-sword albion-sword-right">⚔</span>
    </div>
    <p class="albion-loader-text">${escapeHtml(text)}</p>
  </div>`;
}

function lifetimeStatRow(label, value) {
  if (value == null) return '';
  return `<div class="lifetime-stat"><span>${escapeHtml(label)}</span><strong>${fmtAlbionFame(value, true)}</strong></div>`;
}

function renderLifetimeStats(lifetime) {
  if (!lifetime) return '';
  const { pve, gathering, crafting, fishingFame, farmingFame, crystalLeague } = lifetime;
  const hasPve = pve && [pve.total, pve.royal, pve.outlands, pve.avalon, pve.hellgate, pve.corruptedDungeon, pve.mists].some(
    (v) => Number(v) > 0,
  );
  const hasGathering =
    gathering &&
    [gathering.fiber, gathering.hide, gathering.ore, gathering.rock, gathering.wood, gathering.all].some(
      (v) => Number(v) > 0,
    );
  const hasCrafting =
    (crafting && [crafting.total, crafting.royal, crafting.outlands, crafting.avalon].some((v) => Number(v) > 0)) ||
    Number(fishingFame) > 0 ||
    Number(farmingFame) > 0 ||
    Number(crystalLeague) > 0;
  if (!hasPve && !hasGathering && !hasCrafting) return '';

  const pveCol = hasPve
    ? `<div class="lifetime-col lifetime-col-pve">
        <h5 class="lifetime-col-title">PvE Fame</h5>
        ${lifetimeStatRow('Total', pve.total)}
        ${lifetimeStatRow('Royal', pve.royal)}
        ${lifetimeStatRow('Outlands', pve.outlands)}
        ${lifetimeStatRow('Avalon', pve.avalon)}
        ${Number(pve.hellgate) > 0 ? lifetimeStatRow('Hellgate', pve.hellgate) : ''}
        ${Number(pve.corruptedDungeon) > 0 ? lifetimeStatRow('Corrupted', pve.corruptedDungeon) : ''}
        ${Number(pve.mists) > 0 ? lifetimeStatRow('Mists', pve.mists) : ''}
      </div>`
    : '';

  const gatheringCol = hasGathering
    ? `<div class="lifetime-col lifetime-col-gather">
        <h5 class="lifetime-col-title">Gathering</h5>
        ${lifetimeStatRow('Fiber', gathering.fiber)}
        ${lifetimeStatRow('Hide', gathering.hide)}
        ${lifetimeStatRow('Ore', gathering.ore)}
        ${lifetimeStatRow('Rock', gathering.rock)}
        ${lifetimeStatRow('Wood', gathering.wood)}
        ${Number(gathering.all) >= 0 ? `<div class="lifetime-stat lifetime-stat-total"><span>All</span><strong>${fmtAlbionFame(gathering.all, true)}</strong></div>` : ''}
      </div>`
    : '';

  const craftingCol = hasCrafting
    ? `<div class="lifetime-col lifetime-col-craft">
        <h5 class="lifetime-col-title">Crafting</h5>
        ${crafting ? lifetimeStatRow('Total', crafting.total) : ''}
        ${crafting ? lifetimeStatRow('Royal', crafting.royal) : ''}
        ${crafting ? lifetimeStatRow('Outlands', crafting.outlands) : ''}
        ${crafting ? lifetimeStatRow('Avalon', crafting.avalon) : ''}
        ${Number(fishingFame) > 0 || Number(farmingFame) > 0 || Number(crystalLeague) > 0 ? '<div class="lifetime-extra">' : ''}
        ${Number(fishingFame) > 0 ? lifetimeStatRow('Fishing', fishingFame) : ''}
        ${Number(farmingFame) > 0 ? lifetimeStatRow('Farming', farmingFame) : ''}
        ${Number(crystalLeague) > 0 ? lifetimeStatRow('Crystal League', crystalLeague) : ''}
        ${Number(fishingFame) > 0 || Number(farmingFame) > 0 || Number(crystalLeague) > 0 ? '</div>' : ''}
      </div>`
    : '';

  return `<div class="search-detail-block">
    <p class="search-block-title">Estadísticas de vida</p>
    <div class="lifetime-stats-grid">${pveCol}${gatheringCol}${craftingCol}</div>
  </div>`;
}

function renderPlayerDetail(p) {
  const box = document.getElementById('albion-search-detail');
  if (!box) return;
  box.classList.remove('hidden');
  const alliance = p.allianceTag || p.allianceName || '—';
  box.innerHTML = `
    <div class="search-detail-card">
      <div class="search-detail-head">
        <h4>${escapeHtml(p.name)}</h4>
        <a class="btn btn-ghost btn-sm" href="${escapeHtml(p.killboardUrl)}" target="_blank" rel="noopener">Killboard ↗</a>
      </div>
      <div class="search-stats-grid">
        <div><span class="search-stat-label">Kill fame</span><strong>${fmtAlbionFame(p.killFame)}</strong></div>
        <div><span class="search-stat-label">Death fame</span><strong>${fmtAlbionFame(p.deathFame)}</strong></div>
        <div><span class="search-stat-label">K/D ratio</span><strong>${fmtRatio(p.fameRatio)}</strong></div>
        <div><span class="search-stat-label">IP promedio</span><strong>${p.averageItemPower ? Math.round(p.averageItemPower) : '—'}</strong></div>
      </div>
      ${renderLifetimeStats(p.lifetime)}
      <div class="search-detail-block">
        <p class="search-block-title">Gremio</p>
        <p>${escapeHtml(p.guildName || 'Sin gremio')}${p.guildName ? ` · <button type="button" class="link-btn" data-guild-detail="${escapeHtml(p.guildId)}">Ver gremio</button>` : ''}</p>
        ${idRow('ID jugador', p.id)}
        ${idRow('ID gremio', p.guildId)}
      </div>
      <div class="search-detail-block">
        <p class="search-block-title">Alianza</p>
        <p>${escapeHtml(alliance)}</p>
        ${idRow('ID alianza', p.allianceId)}
      </div>
    </div>`;
  bindCopyButtons(box);
  box.querySelector('[data-guild-detail]')?.addEventListener('click', () => {
    loadGuildDetail(p.guildId);
  });
}

function renderGuildDetail(g) {
  const box = document.getElementById('albion-search-detail');
  if (!box) return;
  box.classList.remove('hidden');
  const alliance = g.allianceTag || g.allianceName || '—';
  const topHtml = g.topPlayers?.length
    ? g.topPlayers
        .map(
          (p) =>
            `<button type="button" class="search-top-player" data-player-detail="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${fmtAlbionFame(p.killFame)}</button>`,
        )
        .join('')
    : '<p class="modal-meta">Sin datos de top players.</p>';

  box.innerHTML = `
    <div class="search-detail-card">
      <div class="search-detail-head">
        <h4>${escapeHtml(g.name)}</h4>
        <a class="btn btn-ghost btn-sm" href="${escapeHtml(g.killboardUrl)}" target="_blank" rel="noopener">Killboard ↗</a>
      </div>
      <div class="search-stats-grid">
        <div><span class="search-stat-label">Miembros</span><strong>${g.memberCount ?? '—'}</strong></div>
        <div><span class="search-stat-label">Kill fame</span><strong>${fmtAlbionFame(g.killFame)}</strong></div>
        <div><span class="search-stat-label">Death fame</span><strong>${fmtAlbionFame(g.deathFame)}</strong></div>
        <div><span class="search-stat-label">Fundado</span><strong>${fmtDate(g.founded)}</strong></div>
      </div>
      <div class="search-detail-block">
        <p class="search-block-title">Fundador</p>
        <p>${escapeHtml(g.founderName || '—')}</p>
        ${idRow('ID gremio', g.id)}
        ${idRow('ID alianza', g.allianceId)}
      </div>
      <div class="search-detail-block">
        <p class="search-block-title">Alianza</p>
        <p>${escapeHtml(alliance)}</p>
      </div>
      <div class="search-detail-block">
        <p class="search-block-title">Top jugadores (kill fame)</p>
        <div class="search-top-list">${topHtml}</div>
      </div>
    </div>`;
  bindCopyButtons(box);
  box.querySelectorAll('[data-player-detail]').forEach((btn) => {
    btn.addEventListener('click', () => loadPlayerDetail(btn.getAttribute('data-player-detail')));
  });
}

async function loadPlayerDetail(id) {
  const box = document.getElementById('albion-search-detail');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = albionLoaderHtml('Cargando jugador…');
  const r = await api(`/api/albion/players/${encodeURIComponent(id)}`);
  if (!r.ok) {
    box.innerHTML = `<p class="dash-empty">${escapeHtml((await r.json().catch(() => ({}))).error || 'Error')}</p>`;
    return;
  }
  const { player } = await r.json();
  renderPlayerDetail(player);
}

async function loadGuildDetail(id) {
  const box = document.getElementById('albion-search-detail');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = albionLoaderHtml('Cargando gremio…');
  const r = await api(`/api/albion/guilds/${encodeURIComponent(id)}`);
  if (!r.ok) {
    box.innerHTML = `<p class="dash-empty">${escapeHtml((await r.json().catch(() => ({}))).error || 'Error')}</p>`;
    return;
  }
  const { guild } = await r.json();
  renderGuildDetail(guild);
}

async function runAlbionSearch() {
  const q = document.getElementById('albion-search-q')?.value.trim();
  const box = document.getElementById('albion-search-results');
  const detail = document.getElementById('albion-search-detail');
  detail?.classList.add('hidden');
  if (detail) detail.innerHTML = '';
  if (!q || q.length < 2) {
    box.innerHTML = '<p class="modal-meta">Escribe al menos 2 caracteres del nombre.</p>';
    return;
  }
  box.innerHTML = albionLoaderHtml('Buscando en Albion…');
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
      ? `<p class="modal-meta search-hint">${list.length} resultado(s) — haz clic para ver detalle</p>${list
          .map(
            (g) => `<button type="button" class="search-result-btn" data-guild-id="${escapeHtml(g.id)}">
              <span class="search-result-name">${escapeHtml(g.name)}</span>
              <span class="search-result-meta">${g.allianceTag || g.allianceName ? `[${escapeHtml(g.allianceTag || g.allianceName)}] · ` : ''}${g.memberCount ?? '—'} miembros · ${fmtAlbionFame(g.killFame)} fama</span>
            </button>`,
          )
          .join('')}`
      : '<p class="dash-empty">Sin gremios con ese nombre.</p>';
    box.querySelectorAll('[data-guild-id]').forEach((btn) => {
      btn.addEventListener('click', () => loadGuildDetail(btn.getAttribute('data-guild-id')));
    });
  } else {
    const list = data.players || [];
    box.innerHTML = list.length
      ? `<p class="modal-meta search-hint">${list.length} resultado(s) — haz clic para ver detalle</p>${list
          .map(
            (p) => `<button type="button" class="search-result-btn" data-player-id="${escapeHtml(p.id)}">
              <span class="search-result-name">${escapeHtml(p.name)}</span>
              <span class="search-result-meta">${p.guildName ? `${escapeHtml(p.guildName)} · ` : ''}K/D ${fmtRatio(p.fameRatio)} · Kill ${fmtAlbionFame(p.killFame)}</span>
            </button>`,
          )
          .join('')}`
      : '<p class="dash-empty">Sin jugadores con ese nombre.</p>';
    box.querySelectorAll('[data-player-id]').forEach((btn) => {
      btn.addEventListener('click', () => loadPlayerDetail(btn.getAttribute('data-player-id')));
    });
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
      const view = btn.dataset.view;
      if (!view) return;
      if (view === 'servers') showGuildGrid();
      switchDashView(view);
    });
  });

  document.querySelectorAll('.search-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      searchMode = btn.dataset.search;
      document.querySelectorAll('.search-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('albion-search-results').innerHTML = '';
      const detail = document.getElementById('albion-search-detail');
      if (detail) {
        detail.classList.add('hidden');
        detail.innerHTML = '';
      }
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
