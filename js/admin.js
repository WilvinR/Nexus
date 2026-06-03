const NEXUS_API = 'https://nexus-bot.discloud.app';
const TOKEN_KEY = 'nexus_session';

let allGuilds = [];

function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const t = sessionStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetch(`${NEXUS_API.replace(/\/$/, '')}${path}`, { ...opts, headers });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function show(id) {
  document.getElementById('admin-login').classList.toggle('hidden', id !== 'login');
  document.getElementById('admin-panel').classList.toggle('hidden', id !== 'panel');
}

function switchTab(name) {
  document.querySelectorAll('.admin-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.admin-tab').forEach((el) => el.classList.add('hidden'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
}

function drawBarChart(canvasId, labels, values, color = '#00d4ff') {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !labels.length) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...values, 1);
  const pad = 28;
  const barW = Math.max(8, (w - pad * 2) / labels.length - 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 0, w, h);
  labels.forEach((lb, i) => {
    const v = values[i];
    const bh = ((h - pad * 2) * v) / max;
    const x = pad + i * (barW + 4);
    const y = h - pad - bh;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, barW, bh);
    ctx.fillStyle = '#8899aa';
    ctx.font = '10px Rajdhani,sans-serif';
    ctx.save();
    ctx.translate(x + barW / 2, h - 6);
    ctx.rotate(-0.5);
    ctx.textAlign = 'right';
    const short = String(lb).length > 8 ? String(lb).slice(0, 7) + '…' : lb;
    ctx.fillText(short, 0, 0);
    ctx.restore();
  });
}

function drawLineChart(canvasId, labels, values, color = '#00d4ff') {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !labels.length) return;
  if (labels.length === 1) {
    drawBarChart(canvasId, labels, values, color);
    return;
  }
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...values, 1);
  const pad = 24;
  const step = (w - pad * 2) / (labels.length - 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((h - pad * 2) * v) / max;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = color;
  values.forEach((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((h - pad * 2) * v) / max;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

async function loadOverview() {
  const el = document.getElementById('tab-overview');
  const r = await api('/api/admin/overview');
  if (!r.ok) {
    el.innerHTML = '<p class="dash-empty">Sin acceso owner.</p>';
    return;
  }
  const d = await r.json();
  const s = d.stats;
  const status = d.online ? '🟢 Online' : '🔴 Offline';
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><span>Estado</span><strong>${status}</strong></div>
      <div class="stat-card"><span>Ping</span><strong>${d.ping} ms</strong></div>
      <div class="stat-card"><span>Servidores</span><strong>${d.guilds}</strong></div>
      <div class="stat-card"><span>Usuarios</span><strong>${d.users}</strong></div>
      <div class="stat-card"><span>Uptime</span><strong>${Math.floor(d.uptime / 3600)}h ${Math.floor((d.uptime % 3600) / 60)}m</strong></div>
      <div class="stat-card"><span>RAM</span><strong>${d.memoryMb} MB</strong></div>
      <div class="stat-card"><span>CPU load</span><strong>${d.cpuLoad?.toFixed?.(2) ?? '—'}</strong></div>
      <div class="stat-card"><span>Versión</span><strong>${esc(d.version)}</strong></div>
    </div>
    <h3 class="chart-heading">Datos globales</h3>
    <div class="stat-grid">
      <div class="stat-card"><span>Kills registradas</span><strong>${s.kills}</strong></div>
      <div class="stat-card"><span>Batallas</span><strong>${s.battles}</strong></div>
      <div class="stat-card"><span>Jugadores monitoreados</span><strong>${s.playersMonitored}</strong></div>
      <div class="stat-card"><span>Comandos ejecutados</span><strong>${s.commandsExecuted}</strong></div>
      <div class="stat-card"><span>Sugerencias</span><strong>${s.suggestions}</strong></div>
    </div>
    <p class="modal-meta">Última actualización: ${esc(d.updatedAt)}</p>`;
}

async function loadStats() {
  const el = document.getElementById('tab-stats');
  const r = await api('/api/admin/stats/charts');
  if (!r.ok) {
    el.innerHTML = '<p class="dash-empty">Sin datos aún.</p>';
    return;
  }
  const { growth, commandUsage, activity } = await r.json();
  el.innerHTML = `
    <h3 class="chart-heading">Crecimiento de servidores</h3>
    <canvas id="chart-guilds" class="admin-chart" width="900" height="220"></canvas>
    <h3 class="chart-heading">Crecimiento de usuarios</h3>
    <canvas id="chart-users" class="admin-chart" width="900" height="220"></canvas>
    <h3 class="chart-heading">Uso de comandos (top 7 días)</h3>
    <canvas id="chart-cmds" class="admin-chart" width="900" height="240"></canvas>
    <h3 class="chart-heading">Actividad diaria (comandos)</h3>
    <canvas id="chart-activity" class="admin-chart" width="900" height="220"></canvas>`;

  const gLabels = growth.map((x) => x.day.slice(5));
  drawLineChart('chart-guilds', gLabels, growth.map((x) => x.guilds));
  drawLineChart('chart-users', gLabels, growth.map((x) => x.users), '#6ee7b7');
  drawBarChart(
    'chart-cmds',
    commandUsage.map((x) => x.command),
    commandUsage.map((x) => x.total),
  );
  const aLabels = activity.map((x) => x.day.slice(5));
  drawLineChart('chart-activity', aLabels, activity.map((x) => x.commands), '#fbbf24');
}

async function loadAnnounce() {
  const el = document.getElementById('tab-announce');
  const gr = await api('/api/admin/guilds');
  if (gr.ok) allGuilds = (await gr.json()).guilds;

  el.innerHTML = `
    <div class="sub-form admin-form">
      <label class="form-label">Título<input class="form-input" id="ann-title"></label>
      <label class="form-label">Mensaje<textarea class="form-input" id="ann-body" rows="4"></textarea></label>
      <label class="form-label">URL imagen / banner (opcional)<input class="form-input" id="ann-img"></label>
      <label class="form-label">Botón — texto<input class="form-input" id="ann-btn-label"></label>
      <label class="form-label">Botón — enlace<input class="form-input" id="ann-btn-url"></label>
      <label class="form-label">Destino
        <select class="form-input" id="ann-target">
          <option value="all">Todos los servidores</option>
          <option value="pick">Servidores seleccionados</option>
        </select>
      </label>
      <div id="ann-guild-pick" class="guild-pick-list hidden"></div>
      <button type="button" class="btn btn-accent" id="ann-preview">Vista previa</button>
      <button type="button" class="btn btn-accent" id="ann-send">Enviar anuncio</button>
    </div>
    <div id="ann-preview-box" class="announce-preview hidden"></div>
    <div id="ann-history"></div>`;

  const pickBox = document.getElementById('ann-guild-pick');
  document.getElementById('ann-target').onchange = () => {
    const pick = document.getElementById('ann-target').value === 'pick';
    pickBox.classList.toggle('hidden', !pick);
    if (pick) {
      pickBox.innerHTML = allGuilds
        .map(
          (g) =>
            `<label class="guild-check"><input type="checkbox" value="${g.id}"> ${esc(g.name)}</label>`,
        )
        .join('');
    }
  };

  document.getElementById('ann-preview').onclick = () => {
    const box = document.getElementById('ann-preview-box');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="announce-preview-inner">
      <strong>${esc(document.getElementById('ann-title').value || 'Nexus')}</strong>
      <p>${esc(document.getElementById('ann-body').value || '(sin mensaje)')}</p>
      ${document.getElementById('ann-img').value ? `<img src="${esc(document.getElementById('ann-img').value)}" alt="">` : ''}
    </div>`;
  };

  document.getElementById('ann-send').onclick = async () => {
    const target = document.getElementById('ann-target').value;
    let guildIds;
    if (target === 'pick') {
      guildIds = [...pickBox.querySelectorAll('input:checked')].map((c) => c.value);
      if (!guildIds.length) return alert('Selecciona al menos un servidor.');
    }
    const res = await api('/api/admin/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('ann-title').value,
        description: document.getElementById('ann-body').value,
        imageUrl: document.getElementById('ann-img').value || undefined,
        buttonLabel: document.getElementById('ann-btn-label').value || undefined,
        buttonUrl: document.getElementById('ann-btn-url').value || undefined,
        guildIds,
      }),
    });
    const j = await res.json().catch(() => ({}));
    alert(res.ok ? `Enviado: ${j.sent} · Errores: ${j.errors} · Alcance: ${j.reached}` : j.error || 'Error');
    loadAnnHistory();
  };
  loadAnnHistory();
}

async function loadAnnHistory() {
  const box = document.getElementById('ann-history');
  if (!box) return;
  const r = await api('/api/admin/announcements');
  if (!r.ok) return;
  const { announcements } = await r.json();
  box.innerHTML =
    '<h3>Historial</h3>' +
    (announcements.length
      ? announcements
          .map((a) => {
            let targets = 'todos';
            try {
              const arr = JSON.parse(a.guilds_target || '[]');
              if (arr.length) targets = `${arr.length} servidor(es)`;
            } catch {
              /* ignore */
            }
            return `<p class="capsule-meta">${new Date(a.created_at).toLocaleString('es')} — ${esc(a.title || 'Sin título')} · ${a.sent_count} ok / ${a.error_count} err · ${targets}</p>`;
          })
          .join('')
      : '<p class="dash-empty">Sin anuncios aún.</p>');
}

async function openGuildDetail(guildId) {
  const r = await api(`/api/admin/guilds/${guildId}`);
  if (!r.ok) return alert('No se pudo cargar');
  const { guild: g } = await r.json();
  const bd = document.getElementById('guild-detail-backdrop');
  document.getElementById('guild-detail-title').textContent = g.name;
  const modList = (g.modules || [])
    .filter((m) => m.enabled)
    .map((m) => m.name)
    .join(', ') || 'Ninguno';
  document.getElementById('guild-detail-body').innerHTML = `
    <p><strong>ID:</strong> <code>${esc(g.id)}</code></p>
    <p><strong>Dueño:</strong> ${esc(g.ownerTag || g.ownerId)}</p>
    <p><strong>Miembros:</strong> ${g.memberCount}</p>
    <p><strong>Premium:</strong> ${g.premium ? '⭐ Sí' : 'No'}
      <button type="button" class="btn btn-sm" id="gd-premium">${g.premium ? 'Quitar premium' : 'Marcar premium'}</button>
    </p>
    <p><strong>Bot desde:</strong> ${g.joinedAt ? new Date(g.joinedAt).toLocaleString('es') : '—'}</p>
    <p><strong>Módulos activos:</strong> ${esc(modList)}</p>
    <p><strong>Stats:</strong> ${g.stats.registroUsers} registrados · ${g.stats.killEntities} kill · ${g.stats.battleTracks} batallas</p>
    <div class="form-actions">
      <button type="button" class="btn btn-sm" id="gd-sync">Sincronizar comandos</button>
      <button type="button" class="btn btn-sm btn-danger" id="gd-leave">Expulsar bot</button>
    </div>`;
  bd.classList.remove('hidden');
  document.getElementById('gd-premium').onclick = async () => {
    await api(`/api/admin/guilds/${g.id}/premium`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ premium: !g.premium }),
    });
    openGuildDetail(g.id);
    loadGuilds();
  };
  document.getElementById('gd-sync').onclick = async () => {
    await api(`/api/admin/guilds/${g.id}/sync`, { method: 'POST' });
    alert('Comandos sincronizados.');
  };
  document.getElementById('gd-leave').onclick = async () => {
    if (!confirm(`¿Expulsar Nexus de ${g.name}?`)) return;
    const res = await api(`/api/admin/guilds/${g.id}`, { method: 'DELETE' });
    if (res.ok) {
      bd.classList.add('hidden');
      loadGuilds();
    } else alert((await res.json().catch(() => ({}))).error || 'Error');
  };
}

async function loadGuilds() {
  const el = document.getElementById('tab-guilds');
  const r = await api('/api/admin/guilds');
  if (!r.ok) return;
  const { guilds } = await r.json();
  allGuilds = guilds;
  el.innerHTML =
    '<div class="admin-guild-list">' +
    guilds
      .map((g) => {
        const icon = g.icon
          ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32`
          : '';
        return `<div class="capsule admin-guild-row">
          ${icon ? `<img src="${icon}" alt="" width="32" height="32" class="guild-mini-icon">` : ''}
          <span>${g.premium ? '⭐ ' : ''}${esc(g.name)} · ${g.memberCount} miembros · ${esc(g.ownerTag || g.ownerId)}</span>
          <div class="guild-row-btns">
            <button type="button" class="btn btn-sm" data-view="${g.id}">Ver</button>
            <button type="button" class="btn btn-sm" data-sync="${g.id}">Sync</button>
          </div>
        </div>`;
      })
      .join('') +
    '</div>';
  el.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => openGuildDetail(btn.dataset.view));
  });
  el.querySelectorAll('[data-sync]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/guilds/${btn.dataset.sync}/sync`, { method: 'POST' });
      alert('Sincronizado.');
    });
  });
}

async function loadSuggestions() {
  const el = document.getElementById('tab-suggestions');
  const r = await api('/api/admin/suggestions');
  if (!r.ok) return;
  const { suggestions } = await r.json();
  el.innerHTML = suggestions.length
    ? suggestions
        .map(
          (s) => `<div class="suggestion-item ${s.read ? 'read' : 'unread'}">
            <span class="sug-dot">${s.read ? '⚪' : '🔴'}</span>
            <div>
              <strong>${esc(s.username)}</strong> · ${esc(s.guildName)}<br>
              <small>${new Date(s.createdAt).toLocaleString('es')}</small>
              <p>${esc(s.content)}</p>
              ${!s.read ? `<button type="button" class="btn btn-sm" data-read="${s.id}">Marcar leída</button>` : ''}
            </div>
          </div>`,
        )
        .join('')
    : '<p class="dash-empty">Sin sugerencias.</p>';
  el.querySelectorAll('[data-read]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/suggestions/${btn.dataset.read}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
      loadSuggestions();
    });
  });
}

async function loadErrors() {
  const el = document.getElementById('tab-errors');
  el.innerHTML = `
    <div class="error-filters">
      <button type="button" class="btn btn-sm" data-level="">Todos</button>
      <button type="button" class="btn btn-sm" data-level="error">Error</button>
      <button type="button" class="btn btn-sm" data-level="warning">Advertencia</button>
      <button type="button" class="btn btn-sm" data-level="critical">Crítico</button>
      <a class="btn btn-sm" href="#" id="err-export">Exportar JSON</a>
    </div>
    <div id="errors-list"></div>`;

  document.getElementById('err-export').onclick = async (e) => {
    e.preventDefault();
    const t = sessionStorage.getItem(TOKEN_KEY);
    const r = await fetch(`${NEXUS_API}/api/admin/errors/export`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nexus-errors.json';
    a.click();
  };

  async function render(level) {
    const path = level ? `/api/admin/errors?level=${encodeURIComponent(level)}` : '/api/admin/errors';
    const r = await api(path);
    const list = document.getElementById('errors-list');
    if (!r.ok) {
      list.innerHTML = '<p class="dash-empty">Error al cargar</p>';
      return;
    }
    const { errors } = await r.json();
    list.innerHTML = errors.length
      ? errors
          .map(
            (er) => `<div class="error-item">
              <div class="error-head"><strong>${esc(er.level)}</strong> · ${new Date(er.createdAt).toLocaleString('es')}
                ${er.resolved ? '' : `<button type="button" class="btn btn-sm" data-res="${er.id}">Resuelto</button>`}
                <button type="button" class="btn btn-sm" data-copy="${esc(er.message)}">Copiar</button>
              </div>
              <p>${esc(er.message)}</p>
              <pre class="error-stack">${esc(er.stack || '')}</pre>
            </div>`,
          )
          .join('')
      : '<p class="dash-empty">Sin errores.</p>';
    list.querySelectorAll('[data-res]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/admin/errors/${btn.dataset.res}/resolve`, { method: 'PATCH' });
        render(level);
      });
    });
    list.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => navigator.clipboard.writeText(btn.dataset.copy));
    });
  }

  el.querySelectorAll('[data-level]').forEach((btn) => {
    btn.addEventListener('click', () => render(btn.dataset.level));
  });
  render('');
}

async function loadSysLogs() {
  const el = document.getElementById('tab-syslogs');
  el.innerHTML = `
    <div class="error-filters">
      <button type="button" class="btn btn-sm" data-lv="">Todos</button>
      <button type="button" class="btn btn-sm" data-lv="info">Info</button>
      <button type="button" class="btn btn-sm" data-lv="warn">Advertencia</button>
      <button type="button" class="btn btn-sm" data-lv="error">Error</button>
    </div>
    <div id="syslogs-list"></div>`;

  async function render(level) {
    const path = level ? `/api/admin/system-logs?level=${level}` : '/api/admin/system-logs';
    const r = await api(path);
    const box = document.getElementById('syslogs-list');
    if (!r.ok) {
      box.innerHTML = '<p class="dash-empty">Error</p>';
      return;
    }
    const { logs } = await r.json();
    box.innerHTML = logs.length
      ? logs
          .map(
            (l) => `<div class="syslog-row level-${esc(l.level)}">
              <span class="syslog-time">${new Date(l.createdAt).toLocaleString('es')}</span>
              <span class="syslog-lv">[${esc(l.level)}]</span>
              <span class="syslog-msg">${esc(l.message)}</span>
              ${l.guildId ? `<code>${esc(l.guildId)}</code>` : ''}
            </div>`,
          )
          .join('')
      : '<p class="dash-empty">Sin logs.</p>';
  }

  el.querySelectorAll('[data-lv]').forEach((btn) => {
    btn.addEventListener('click', () => render(btn.dataset.lv));
  });
  render('');
}

async function loadServices() {
  const el = document.getElementById('tab-services');
  const r = await api('/api/admin/services');
  if (!r.ok) return;
  const { services } = await r.json();
  const icon = { operational: '🟢', degraded: '🟡', down: '🔴' };
  el.innerHTML =
    '<div class="stat-grid">' +
    services
      .map(
        (s) =>
          `<div class="stat-card"><span>${esc(s.name)}</span><strong>${icon[s.status] || '⚪'} ${s.status}</strong></div>`,
      )
      .join('') +
    '</div>';
}

async function initAdmin() {
  const owner = await api('/api/admin/me');
  if (!owner.ok) {
    show('login');
    return;
  }
  show('panel');
  switchTab('overview');
  await loadOverview();

  document.getElementById('guild-detail-close').onclick = () => {
    document.getElementById('guild-detail-backdrop').classList.add('hidden');
  };
  document.getElementById('guild-detail-backdrop').onclick = (e) => {
    if (e.target.id === 'guild-detail-backdrop') {
      document.getElementById('guild-detail-backdrop').classList.add('hidden');
    }
  };

  document.getElementById('admin-tabs').addEventListener('click', async (e) => {
    const tab = e.target.closest('button')?.dataset?.tab;
    if (!tab) return;
    switchTab(tab);
    if (tab === 'overview') await loadOverview();
    if (tab === 'stats') await loadStats();
    if (tab === 'announce') await loadAnnounce();
    if (tab === 'guilds') await loadGuilds();
    if (tab === 'suggestions') await loadSuggestions();
    if (tab === 'errors') await loadErrors();
    if (tab === 'syslogs') await loadSysLogs();
    if (tab === 'services') await loadServices();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(location.search);
  const t = p.get('token');
  if (t) {
    sessionStorage.setItem(TOKEN_KEY, t);
    history.replaceState({}, '', location.pathname);
  }
  document.getElementById('admin-btn-login').onclick = () => {
    location.href = `${NEXUS_API}/api/auth/login?redirect=${encodeURIComponent(location.href)}`;
  };
  document.getElementById('admin-logout').onclick = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    show('login');
  };
  if (sessionStorage.getItem(TOKEN_KEY)) initAdmin();
  else show('login');
});
