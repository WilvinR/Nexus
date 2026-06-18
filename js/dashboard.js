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
  loot: '📋',
};

function api(path, opts = {}) {
  return fetch(`${NEXUS_API.replace(/\/$/, '')}${path}`, {
    cache: 'no-store',
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
  const dashUrl = new URL('dashboard.html', location.href).href;
  NexusAuth.startLogin(NEXUS_API, dashUrl);
}

function showLoginPending() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-dash').classList.add('hidden');
  document.getElementById('dash-header-nav')?.classList.add('hidden');
  document.getElementById('dash-nav-right')?.classList.add('hidden');
}

function beginAuth() {
  showLoginPending();
  loginRedirect();
}

function showDash() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-dash').classList.remove('hidden');
  const nav = document.getElementById('site-nav-dash');
  if (nav) nav.classList.add('has-badge');
  document.getElementById('dash-header-nav')?.classList.remove('hidden');
  document.getElementById('dash-nav-right')?.classList.remove('hidden');
}

let currentNav = 'dashboard';

function guildById(id) {
  return guildsData.find((x) => x.id === id);
}

function setNavMode(mode) {
  document.querySelectorAll('.dash-nav-guild-only').forEach((el) => {
    el.classList.toggle('hidden', mode !== 'guild');
  });
}

function setActiveNav(nav) {
  currentNav = nav;
  document.querySelectorAll('.dash-header-nav-link').forEach((b) => {
    b.classList.toggle('active', b.dataset.nav === nav);
  });
}

function hideAllDashViews() {
  document.getElementById('view-dashboard')?.classList.add('hidden');
  document.getElementById('guild-home')?.classList.add('hidden');
  document.getElementById('guild-modules')?.classList.add('hidden');
  document.getElementById('view-help')?.classList.add('hidden');
  document.getElementById('view-search')?.classList.add('hidden');
  document.getElementById('view-loot')?.classList.add('hidden');
}

function setGuildAvatarEl(el, g) {
  if (!el || !g) return;
  el.replaceChildren();
  const url = guildIconUrl(g);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = g.name;
    el.appendChild(img);
  } else {
    const ph = document.createElement('span');
    ph.className = 'guild-avatar-ph';
    ph.textContent = guildInitial(g.name);
    el.appendChild(ph);
  }
}

function setGuildModulesHeader(g) {
  setGuildAvatarEl(document.getElementById('guild-modules-avatar'), g);
  document.getElementById('guild-modules-name').textContent = g.name;
}

function updatePageHeader(nav) {
  const titleEl = document.getElementById('dash-page-title');
  const sectionLabel = document.getElementById('dash-section-label');
  const hint = document.getElementById('dash-hint');
  const g = currentGuildId ? guildById(currentGuildId) : null;

  if (nav === 'dashboard') {
    titleEl.innerHTML = 'DASH<span>BOARD</span>';
    sectionLabel.textContent = '// DASHBOARD';
    hint.classList.remove('hidden');
  } else if (nav === 'home') {
    titleEl.textContent = g?.name || 'Servidor';
    sectionLabel.textContent = '// INICIO';
    hint.classList.add('hidden');
  } else if (nav === 'modules') {
    titleEl.textContent = g?.name || 'Servidor';
    sectionLabel.textContent = '// MÓDULOS';
    hint.classList.add('hidden');
  } else if (nav === 'help') {
    titleEl.innerHTML = 'AY<span>UDA</span>';
    sectionLabel.textContent = '// AYUDA';
    hint.classList.add('hidden');
  } else if (nav === 'search') {
    titleEl.innerHTML = 'INFORMACIÓN <span>ALBION</span>';
    sectionLabel.textContent = '// ALBION';
    hint.classList.add('hidden');
  } else if (nav === 'loot') {
    titleEl.innerHTML = 'COMPARAR <span>LOOT</span>';
    sectionLabel.textContent = '// LOOT';
    hint.classList.add('hidden');
  }
}

function switchNav(nav) {
  if (nav === 'home' || nav === 'modules') {
    if (!currentGuildId) {
      switchNav('dashboard');
      return;
    }
    setNavMode('guild');
  } else if (nav === 'dashboard') {
    setNavMode('global');
    currentGuildId = null;
  } else {
    setNavMode(currentGuildId ? 'guild' : 'global');
  }

  hideAllDashViews();
  setActiveNav(nav);
  updatePageHeader(nav);

  if (nav === 'dashboard') {
    document.getElementById('view-dashboard').classList.remove('hidden');
  } else if (nav === 'home') {
    document.getElementById('guild-home').classList.remove('hidden');
    loadGuildHome();
  } else if (nav === 'modules') {
    document.getElementById('guild-modules').classList.remove('hidden');
    const g = guildById(currentGuildId);
    if (g) {
      setGuildModulesHeader(g);
      renderModules(document.getElementById('mod-list'), g.id, g.modules || []);
    }
  } else if (nav === 'help') {
    document.getElementById('view-help').classList.remove('hidden');
    loadHelpVideos();
  } else if (nav === 'search') {
    document.getElementById('view-search').classList.remove('hidden');
    document.getElementById('albion-search-q')?.focus();
  } else if (nav === 'loot') {
    document.getElementById('view-loot').classList.remove('hidden');
  }
}

async function safeJsonFetch(path) {
  try {
    const r = await api(path);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

function fmtRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return fmtDate(iso);
}

function fmtSancionActivity(s) {
  const tipo = s.tipo || 'sanción';
  if (s.action === 'apply') {
    return `Aplicó ${tipo}${s.amount ? ` (${s.amount})` : ''}${s.reason ? `: ${s.reason}` : ''}`;
  }
  if (s.action === 'remove') {
    return `Quitó ${tipo}${s.reason ? `: ${s.reason}` : ''}`;
  }
  return `${s.action || 'Registro'}${s.reason ? `: ${s.reason}` : ''}`;
}

function pickMemberStats(...sources) {
  for (const s of sources) {
    if (s && typeof s.humans === 'number') return s;
  }
  return null;
}

async function loadGuildHome() {
  const box = document.getElementById('guild-home');
  const g = guildById(currentGuildId);
  if (!box || !g) return;

  box.innerHTML = '<p class="dash-empty">Cargando resumen…</p>';

  const gid = encodeURIComponent(g.id);
  const [pub, channelsRes, voiceRes, rolesRes, memberStatsRes, eventosRes, sancionesRes] =
    await Promise.all([
      safeJsonFetch('/api/public'),
      safeJsonFetch(`/api/guilds/${gid}/channels`),
      safeJsonFetch(`/api/guilds/${gid}/voice-channels`),
      safeJsonFetch(`/api/guilds/${gid}/roles`),
      safeJsonFetch(`/api/guilds/${gid}/member-stats`),
      safeJsonFetch(`/api/guilds/${gid}/eventos`),
      safeJsonFetch(`/api/guilds/${gid}/sanciones`),
    ]);

  const textCh = channelsRes?.channels || [];
  const voiceCh = voiceRes?.channels || [];
  const roleList = rolesRes?.roles || [];
  let memberStats = pickMemberStats(
    memberStatsRes,
    rolesRes?.memberStats,
    channelsRes?.memberStats,
    g.memberStats,
  );
  if (!memberStats) {
    const dash = await safeJsonFetch('/api/me/dashboard');
    if (dash?.guilds?.length) {
      guildsData = dash.guilds;
      memberStats = pickMemberStats(guildById(currentGuildId)?.memberStats);
    }
  }
  const memberHumans = memberStats?.humans ?? '—';
  const memberBots = memberStats?.bots ?? '—';
  const eventList = (eventosRes?.events || [])
    .slice()
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .slice(0, 5);
  const sancLog = (sancionesRes?.log || []).slice(0, 5);
  const modules = g.modules || [];
  const enabledCount = modules.filter((m) => m.enabled).length;
  const botOnline = pub?.ready ?? pub?.bot ?? false;

  const iconUrl = guildIconUrl(g);
  const iconHtml = iconUrl
    ? `<img src="${escapeHtml(iconUrl)}" alt="" width="48" height="48">`
    : `<span class="guild-avatar-ph">${escapeHtml(guildInitial(g.name))}</span>`;

  const statsHtml = `
    <div class="dash-stat-card"><span class="dash-stat-icon">📢</span><span class="dash-stat-label">Canales texto</span><span class="dash-stat-value">${textCh.length}</span></div>
    <div class="dash-stat-card"><span class="dash-stat-icon">🔊</span><span class="dash-stat-label">Canales voz</span><span class="dash-stat-value">${voiceCh.length}</span></div>
    <div class="dash-stat-card"><span class="dash-stat-icon">🏷️</span><span class="dash-stat-label">Roles</span><span class="dash-stat-value">${roleList.length}</span></div>
    <div class="dash-stat-card"><span class="dash-stat-icon">👥</span><span class="dash-stat-label">Miembros</span><span class="dash-stat-value">${memberHumans}</span></div>
    <div class="dash-stat-card"><span class="dash-stat-icon">🤖</span><span class="dash-stat-label">Bots total</span><span class="dash-stat-value">${memberBots}</span></div>
    <div class="dash-stat-card"><span class="dash-stat-icon">🧩</span><span class="dash-stat-label">Módulos activos</span><span class="dash-stat-value">${enabledCount}/${modules.length}</span></div>`;

  const activeModules = modules.filter((m) => m.enabled);
  const modMini = activeModules.length
    ? activeModules
        .map((m) => {
          const emoji = MODULE_EMOJI[m.id] || '⚙️';
          return `<div class="dash-mod-mini on"><span>${emoji}</span><span>${escapeHtml(m.name)}</span><span class="dash-mod-mini-state">Activo</span></div>`;
        })
        .join('')
    : '<p class="modal-meta">Ningún módulo activo. Ve a Módulos para activar uno.</p>';

  const activityItems = [];
  for (const ev of eventList) {
    activityItems.push({
      icon: '🏹',
      cls: 'join',
      title: ev.name || 'Evento',
      desc: `${ev.location || 'Sin ubicación'} · ${ev.time || ''}`,
      time: ev.time,
    });
  }
  for (const s of sancLog) {
    activityItems.push({
      icon: '⚖️',
      cls: 'alert',
      title: `Sanción — ${s.username || s.userId}`,
      desc: fmtSancionActivity(s),
      time: s.createdAt,
    });
  }

  const activityHtml = activityItems.length
    ? activityItems
        .slice(0, 6)
        .map(
          (a) => `<div class="dash-activity-item">
        <div class="dash-act-icon ${a.cls}">${a.icon}</div>
        <div class="dash-act-body"><div class="dash-act-title">${escapeHtml(a.title)}</div><div class="dash-act-desc">${escapeHtml(a.desc)}</div></div>
        <div class="dash-act-time">${escapeHtml(fmtRelativeTime(a.time) || fmtDate(a.time))}</div>
      </div>`,
        )
        .join('')
    : '<p class="modal-meta">Sin actividad reciente.</p>';

  const rolesHtml = roleList.length
    ? roleList
        .slice(0, 12)
        .map((r) => {
          const color = r.color ? `#${Number(r.color).toString(16).padStart(6, '0')}` : '#64748b';
          return `<span class="dash-role-pill"><i style="background:${color}"></i>${escapeHtml(r.name)}</span>`;
        })
        .join('') + (roleList.length > 12 ? `<span class="dash-role-pill dash-role-more">+${roleList.length - 12} más</span>` : '')
    : '<p class="modal-meta">Sin roles visibles.</p>';

  box.innerHTML = `
    <div class="dash-home-header">
      <div class="dash-server-chip">${iconHtml}<div><strong>${escapeHtml(g.name)}</strong><span class="modal-meta">ID: ${escapeHtml(g.id)}</span></div></div>
    </div>
    <div class="dash-bot-bar">
      <span class="dash-bot-status"><span class="dash-status-dot ${botOnline ? 'online' : ''}"></span>Nexus Bot · ${botOnline ? 'ONLINE' : 'OFFLINE'}</span>
      <span class="dash-bot-divider"></span>
      <span class="modal-meta">Servidor Albion: <strong>Américas</strong></span>
      <button type="button" class="btn btn-accent btn-sm dash-bot-cta" data-go-modules>Ir a módulos</button>
    </div>
    <div class="dash-stats-grid">${statsHtml}</div>
    <div class="dash-two-col">
      <div class="dash-section-card">
        <div class="dash-card-head"><h3>Módulos</h3><button type="button" class="link-btn" data-go-modules>Gestionar →</button></div>
        <div class="dash-mod-mini-grid">${modMini}</div>
      </div>
      <div class="dash-section-card">
        <div class="dash-card-head"><h3>Actividad reciente</h3></div>
        <div class="dash-activity-list">${activityHtml}</div>
      </div>
    </div>
    <div class="dash-section-card">
      <div class="dash-card-head"><h3>Roles del servidor</h3></div>
      <div class="dash-roles-list">${rolesHtml}</div>
    </div>`;

  box.querySelectorAll('[data-go-modules]').forEach((btn) => {
    btn.addEventListener('click', () => switchNav('modules'));
  });
}

function guildIconUrl(g) {
  if (!g.icon) return null;
  return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128`;
}

function guildInitial(name) {
  const t = (name || '?').trim();
  return (t[0] || '?').toUpperCase();
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
    <div class="albion-duel" aria-hidden="true">
      <div class="duel-fighter duel-fighter-left">
        <div class="duel-sword">
          <span class="duel-blade"></span>
          <span class="duel-guard"></span>
          <span class="duel-hilt"></span>
        </div>
      </div>
      <div class="duel-clash">
        <span class="duel-spark-core"></span>
        <span class="duel-spark-flash"></span>
        <span class="duel-spark-burst">
          <i style="--spark-angle:0deg"></i>
          <i style="--spark-angle:45deg"></i>
          <i style="--spark-angle:90deg"></i>
          <i style="--spark-angle:135deg"></i>
          <i style="--spark-angle:180deg"></i>
          <i style="--spark-angle:225deg"></i>
          <i style="--spark-angle:270deg"></i>
          <i style="--spark-angle:315deg"></i>
        </span>
      </div>
      <div class="duel-fighter duel-fighter-right">
        <div class="duel-sword">
          <span class="duel-blade"></span>
          <span class="duel-guard"></span>
          <span class="duel-hilt"></span>
        </div>
      </div>
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
  currentGuildId = g.id;
  channelsCacheReset();
  setGuildModulesHeader(g);
  renderModules(document.getElementById('mod-list'), g.id, g.modules || []);
  switchNav('home');
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
    beginAuth();
    return;
  }
  const me = await meRes.json();
  let userLine = `Conectado como ${me.user.username}`;
  if (me.isOwner) {
    userLine += ' · 👑 Dueño del bot';
  }
  document.getElementById('user-label').innerHTML = userLine;
  const navUser = document.getElementById('nav-user-label');
  if (navUser) navUser.textContent = me.user.username;
  showDash();
  switchNav('dashboard');

  const grid = document.getElementById('guild-grid');
  grid.innerHTML = '<p class="dash-empty">Cargando servidores…</p>';

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
      ? 'Elige un servidor donde seas dueño de Discord (con Nexus instalado).'
      : 'Elige un servidor que administres.';
  hint += ' Desde Inicio verás el resumen; en Módulos activas y configuras cada uno.';
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

let lootCsvText = '';
let chestCsvText = '';

function bindLootFileInput(inputId, nameId, setter) {
  const input = document.getElementById(inputId);
  const nameEl = document.getElementById(nameId);
  if (!input || !nameEl) return;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) {
      setter('');
      nameEl.textContent = 'Ningún archivo';
      return;
    }
    nameEl.textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result || ''));
    reader.readAsText(file);
  });
}

function renderLootResults(data) {
  const box = document.getElementById('loot-compare-results');
  if (!box) return;
  box.replaceChildren();

  const summary = document.createElement('div');
  summary.className = 'loot-summary';
  summary.innerHTML =
    `<p class="loot-window"><strong>Ventana de pelea:</strong> ${escapeHtml(data.window.fromLabel)} → ${escapeHtml(data.window.toLabel)}</p>` +
    `<p class="loot-stats">Jugadores: <strong>${data.stats.players}</strong> · Pendientes: <strong>${data.stats.pending}</strong> · ✅ Entregado: <strong>${data.stats.delivered}</strong></p>` +
    `<p class="modal-meta">Loot: ${data.stats.lootRows} filas · Cofre en ventana: ${data.stats.chestInWindow}/${data.stats.chestRows}</p>` +
    (data.stats.filesSwapped
      ? '<p class="loot-swap-note">ℹ️ Los archivos estaban al revés; se compararon automáticamente.</p>'
      : '') +
    (data.stats.windowNote
      ? `<p class="loot-swap-note">ℹ️ ${escapeHtml(data.stats.windowNote)}</p>`
      : '') +
    (data.stats.warning
      ? `<p class="loot-warn-note">⚠️ ${escapeHtml(data.stats.warning)}</p>`
      : '');
  box.appendChild(summary);

  if (!data.stats.pending) {
    const ok = document.createElement('p');
    ok.className = 'loot-all-ok';
    ok.textContent = '✅ Todos los jugadores entregaron su loot al cofre.';
    box.appendChild(ok);
    return;
  }

  for (const p of data.players) {
    const card = document.createElement('article');
    card.className = 'loot-player-card';
    if (p.status === 'ok') {
      card.classList.add('loot-player-ok');
      card.innerHTML = `<h4 class="loot-player-name">✅ ${escapeHtml(p.name)}</h4><p class="loot-player-status">Todo entregado</p>`;
    } else {
      card.innerHTML = `<h4 class="loot-player-name">⚠️ ${escapeHtml(p.name)}</h4>`;
      const grid = document.createElement('div');
      grid.className = 'loot-item-grid';
      for (const it of p.missing) {
        const cell = document.createElement('div');
        cell.className = 'loot-item-cell';
        cell.title = `${it.object} (×${it.missing})`;
        if (it.imageUrl) {
          const img = document.createElement('img');
          img.src = it.imageUrl;
          img.alt = it.object;
          img.width = 72;
          img.height = 72;
          img.loading = 'lazy';
          cell.appendChild(img);
        } else {
          const ph = document.createElement('span');
          ph.className = 'loot-item-ph';
          ph.textContent = '?';
          cell.appendChild(ph);
        }
        const qty = document.createElement('span');
        qty.className = 'loot-item-qty';
        qty.textContent = `×${it.missing}`;
        cell.appendChild(qty);
        grid.appendChild(cell);
      }
      card.appendChild(grid);
    }
    box.appendChild(card);
  }
}

async function runLootCompare() {
  const status = document.getElementById('loot-compare-status');
  const btn = document.getElementById('loot-compare-btn');
  const box = document.getElementById('loot-compare-results');
  if (!lootCsvText || !chestCsvText) {
    if (status) {
      status.textContent = 'Selecciona ambos archivos antes de comparar.';
      status.classList.remove('hidden');
    }
    return;
  }
  if (status) {
    status.textContent = 'Comparando y resolviendo imágenes de ítems…';
    status.classList.remove('hidden');
  }
  if (btn) btn.disabled = true;
  if (box) box.replaceChildren();
  try {
    const r = await api('/api/loot/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lootCsv: lootCsvText, chestCsv: chestCsvText }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Error al comparar');
    if (status) status.classList.add('hidden');
    renderLootResults(data);
  } catch (e) {
    if (status) {
      status.textContent = e.message || 'Error al comparar';
      status.classList.remove('hidden');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
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
  document.getElementById('btn-logout').addEventListener('click', () => {
    NexusAuth.clearToken();
    currentGuildId = null;
    beginAuth();
  });

  document.querySelectorAll('.dash-header-nav-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (!nav) return;
      switchNav(nav);
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

  bindLootFileInput('loot-file-loot', 'loot-file-loot-name', (t) => {
    lootCsvText = t;
  });
  bindLootFileInput('loot-file-chest', 'loot-file-chest-name', (t) => {
    chestCsvText = t;
  });
  document.getElementById('loot-compare-btn')?.addEventListener('click', runLootCompare);

  const authFromUrl = NexusAuth.applyTokenFromUrl(showAuthError);
  if (authFromUrl === 'token' || NexusAuth.getToken()) {
    loadDashboard();
  } else {
    beginAuth();
  }

  window.addEventListener('pageshow', (e) => {
    if (e.persisted && NexusAuth.getToken()) loadDashboard();
    else if (e.persisted && !NexusAuth.getToken()) beginAuth();
  });
});
