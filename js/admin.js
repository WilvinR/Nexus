const NEXUS_API = 'https://nexus-bot.discloud.app';

let allGuilds = [];

function api(path, opts = {}) {
  return fetch(`${NEXUS_API.replace(/\/$/, '')}${path}`, {
    ...opts,
    headers: NexusAuth.authHeaders(opts.headers || {}),
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function fmtDay(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  return p.length >= 3 ? `${p[2]}/${p[1]}` : iso;
}

function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function cmdLabel(name) {
  const n = String(name || '');
  const map = {
    registrarse: '/registrarse',
    registro_manual: '/registro_manual',
    configurar_registro: '/configurar_registro',
    informacion_gremio: '/informacion_gremio',
    killboard: '/killboard',
    precio: '/precio',
    utc: '/utc',
    sugerencia: '/sugerencia',
    ayuda: '/ayuda',
  };
  if (map[n]) return map[n];
  if (n.includes(':')) return `/${n.replace(':', ' ')}`;
  return `/${n}`;
}

function renderMemoryDiagnostics(detail) {
  if (!detail?.memory) return '';
  const m = detail.memory;
  const d = detail.discord || {};
  const db = detail.database || {};
  const caches = detail.caches || {};
  const suspects = detail.suspects || [];

  const suspectHtml = suspects.length
    ? `<ul class="memory-suspects">${suspects
        .map(
          (s) =>
            `<li class="memory-suspect severity-${esc(s.severity)}"><strong>${esc(s.label)}</strong></li>`,
        )
        .join('')}</ul>`
    : '<p class="modal-meta">Sin sospechosos claros — revisa RSS vs Heap abajo.</p>';

  const cacheRows = [
    ['Imágenes kill', caches.killImages ? `${caches.killImages.imageCache}/${caches.killImages.imageCacheMax}` : '—'],
    ['Mercado (ítems)', caches.mercado?.itemsLoaded ? `${caches.mercado.itemsCount} cargados` : 'no cargado'],
    ['Eventos activos', caches.eventos?.activeEvents ?? '—'],
    ['OAuth caché API', caches.api?.oauthGuildCache ?? '—'],
    ['Kill dedupe', caches.kill?.recentEvents ?? '—'],
  ];

  return statSection(
    'Diagnóstico de RAM',
    'Desglose en tiempo real. La causa más habitual es la caché de miembros de Discord (intent GuildMembers).',
    [
      statCard('RSS total', `${m.rssMb} MB`, 'Memoria total del proceso'),
      statCard('Heap JS', `${m.heapMb} MB`, 'Objetos JavaScript'),
      statCard('Nativa / Ext', `${m.externalMb} MB`, 'Canvas, buffers, librerías nativas'),
      statCard('Miembros en caché', (d.membersCached ?? 0).toLocaleString('es-ES'), 'Principal sospechoso si es alto'),
      statCard('Canales caché', d.channels ?? '—', 'Canales cargados en Discord.js'),
      statCard('Killboard activos', db.killEntities ?? '—', 'Entidades monitoreadas en DB'),
    ].join('') +
      `<div class="memory-detail-block">
        <h4 class="memory-detail-title">Causas probables</h4>
        ${suspectHtml}
        <h4 class="memory-detail-title">Cachés del bot</h4>
        <table class="memory-table"><tbody>${cacheRows
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`)
          .join('')}</tbody></table>
      </div>`,
  );
}

function formatSyslogMeta(meta) {
  if (!meta || typeof meta !== 'object' || !meta.suspects) return '';
  const lines = [];
  if (meta.memory) {
    lines.push(
      `RSS ${meta.memory.rssMb} MB · Heap ${meta.memory.heapMb} · Ext ${meta.memory.externalMb} · AB ${meta.memory.arrayBuffersMb}`,
    );
  }
  if (meta.discord?.membersCached != null) {
    lines.push(`Discord: ${meta.discord.membersCached} miembros en caché, ${meta.discord.channels} canales`);
  }
  if (meta.suspects?.length) {
    lines.push(`Causas: ${meta.suspects.map((s) => s.label).join(' · ')}`);
  }
  if (!lines.length) return '';
  return `<div class="syslog-meta">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
}

function statCard(label, value, hint) {
  return `<div class="stat-card">
    <span class="stat-card-label">${esc(label)}</span>
    <strong class="stat-card-value">${value}</strong>
    ${hint ? `<small class="stat-card-hint">${esc(hint)}</small>` : ''}
  </div>`;
}

function statSection(title, desc, cardsHtml) {
  return `<section class="stat-section">
    <h3 class="stat-section-title">${esc(title)}</h3>
    ${desc ? `<p class="stat-section-desc">${esc(desc)}</p>` : ''}
    <div class="stat-grid">${cardsHtml}</div>
  </section>`;
}

function emptyStat(msg) {
  return `<p class="stat-empty">${esc(msg)}</p>`;
}

function renderCmdRank(list) {
  if (!list.length) return emptyStat('Nadie ha usado comandos en los últimos 7 días.');
  const max = Math.max(...list.map((x) => x.total), 1);
  return `<div class="cmd-rank">${list
    .map(
      (c) => `<div class="cmd-rank-row">
        <span class="cmd-rank-name">${esc(cmdLabel(c.command))}</span>
        <div class="cmd-rank-bar"><i style="width:${Math.round((c.total / max) * 100)}%"></i></div>
        <span class="cmd-rank-num">${c.total}×</span>
      </div>`,
    )
    .join('')}</div>`;
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
  const min = Math.min(...values, 0);
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 32;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const step = plotW / (labels.length - 1);

  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(padL, padT, plotW, plotH);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padT + (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    const val = Math.round(max - ((max - min) * i) / 3);
    ctx.fillStyle = '#8899aa';
    ctx.font = '10px Rajdhani,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(val), padL - 6, y + 3);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = padL + i * step;
    const y = padT + plotH - ((v - min) / (max - min || 1)) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = color;
  values.forEach((v, i) => {
    const x = padL + i * step;
    const y = padT + plotH - ((v - min) / (max - min || 1)) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#8899aa';
  ctx.font = '10px Rajdhani,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(labels[0], padL, h - 8);
  if (labels.length > 2) {
    const mid = Math.floor(labels.length / 2);
    ctx.fillText(labels[mid], padL + mid * step, h - 8);
  }
  ctx.fillText(labels[labels.length - 1], padL + (labels.length - 1) * step, h - 8);
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
  const status = d.online ? '🟢 En línea' : '🔴 Desconectado';
  const uptimeH = Math.floor(d.uptime / 3600);
  const uptimeM = Math.floor((d.uptime % 3600) / 60);

  el.innerHTML =
    statSection(
      'Estado del bot',
      'Salud del proceso en Discloud. Se actualiza al abrir esta pestaña.',
      [
        statCard('Conexión', status, 'Si el bot está conectado a Discord'),
        statCard('Latencia', `${d.ping} ms`, 'Tiempo de respuesta a Discord'),
        statCard('Tiempo activo', `${uptimeH}h ${uptimeM}m`, 'Desde el último reinicio del bot'),
        statCard('Memoria RAM', `${d.memoryMb} MB`, 'Uso de memoria del servidor'),
        statCard('Carga CPU', d.cpuLoad?.toFixed?.(2) ?? '—', 'Carga del servidor (no es % exacto)'),
        statCard('Versión', esc(d.version), 'Versión desplegada de Nexus'),
      ].join(''),
    ) +
    statSection(
      'Alcance en Discord',
      'Cuántos servidores usan Nexus y cuántas personas están en esos servidores (miembros totales, no usuarios únicos).',
      [
        statCard('Servidores con Nexus', d.guilds, 'Servidores donde está instalado el bot'),
        statCard('Miembros totales', d.users.toLocaleString('es-ES'), 'Suma de miembros en todos esos servidores'),
      ].join(''),
    ) +
    statSection(
      'Uso de funciones',
      'Totales guardados en la base de datos del bot (desde que hay registro).',
      [
        statCard('Seguimientos killboard', s.kills, 'Gremios/jugadores en monitoreo de kills'),
        statCard('Seguimientos de batallas', s.battles, 'Batallas que algún servidor sigue'),
        statCard('Jugadores vinculados', s.playersMonitored, 'Registros Albion + jugadores en killboard'),
        statCard('Comandos usados', s.commandsExecuted.toLocaleString('es-ES'), 'Veces que alguien usó un /comando'),
        statCard('Sugerencias recibidas', s.suggestions, 'Enviadas con /sugerencia'),
      ].join(''),
    ) +
    (d.memoryDetail ? renderMemoryDiagnostics(d.memoryDetail) : '') +
    `<p class="stat-updated">Actualizado: ${fmtDateTime(d.updatedAt)}</p>`;
}

async function loadStats() {
  const el = document.getElementById('tab-stats');
  const r = await api('/api/admin/stats/charts');
  if (!r.ok) {
    el.innerHTML = emptyStat('No se pudieron cargar las estadísticas.');
    return;
  }
  const { growth, commandUsage, activity } = await r.json();

  const lastGrowth = growth.length ? growth[growth.length - 1] : null;
  const guildTrend =
    growth.length >= 2
      ? lastGrowth.guilds - growth[growth.length - 2].guilds
      : 0;
  const userTrend =
    growth.length >= 2 ? lastGrowth.users - growth[growth.length - 2].users : 0;

  let html = `<p class="stat-section-desc stat-intro">
    Historial de los últimos 30 días. El bot guarda un resumen cada 6 horas.
    Si acabas de desplegar, verás pocos datos al principio — es normal.
  </p>`;

  html += statSection(
    'Resumen reciente',
    lastGrowth
      ? `Último registro: ${fmtDay(lastGrowth.day)} — ${lastGrowth.guilds} servidores, ${lastGrowth.users.toLocaleString('es-ES')} miembros.`
      : 'Aún no hay registros diarios.',
    lastGrowth
      ? [
          statCard(
            'Servidores',
            lastGrowth.guilds,
            guildTrend > 0 ? `+${guildTrend} vs día anterior` : guildTrend < 0 ? `${guildTrend} vs día anterior` : 'Sin cambio vs ayer',
          ),
          statCard(
            'Miembros',
            lastGrowth.users.toLocaleString('es-ES'),
            userTrend > 0 ? `+${userTrend} vs día anterior` : userTrend < 0 ? `${userTrend} vs día anterior` : 'Sin cambio vs ayer',
          ),
          statCard('Comandos ese día', lastGrowth.commands, 'Slash commands usados ese día'),
        ].join('')
      : '',
  );

  html += `<section class="stat-section">
    <h3 class="stat-section-title">Comandos más usados (7 días)</h3>
    <p class="stat-section-desc">Qué /comandos usa la gente con más frecuencia.</p>
    ${renderCmdRank(commandUsage)}
  </section>`;

  if (growth.length >= 2) {
    html += `<section class="stat-section">
      <h3 class="stat-section-title">Servidores en el tiempo</h3>
      <p class="stat-section-desc">Cuántos servidores tenían Nexus cada día.</p>
      <canvas id="chart-guilds" class="admin-chart" width="900" height="200"></canvas>
    </section>
    <section class="stat-section">
      <h3 class="stat-section-title">Miembros en el tiempo</h3>
      <p class="stat-section-desc">Total de miembros en servidores con Nexus (suma, no usuarios únicos).</p>
      <canvas id="chart-users" class="admin-chart" width="900" height="200"></canvas>
    </section>`;
  } else {
    html += emptyStat('Los gráficos de crecimiento aparecerán cuando haya al menos 2 días de historial.');
  }

  if (activity.length >= 2) {
    html += `<section class="stat-section">
      <h3 class="stat-section-title">Actividad diaria</h3>
      <p class="stat-section-desc">Cuántos comandos se ejecutaron cada día en todos los servidores.</p>
      <canvas id="chart-activity" class="admin-chart" width="900" height="200"></canvas>
    </section>`;
  } else if (activity.length === 1) {
    html += `<section class="stat-section">
      <h3 class="stat-section-title">Actividad hoy</h3>
      <p class="stat-section-desc">${activity[0].commands} comando(s) registrado(s) el ${fmtDay(activity[0].day)}.</p>
    </section>`;
  }

  el.innerHTML = html;

  if (growth.length >= 2) {
    const gLabels = growth.map((x) => fmtDay(x.day));
    drawLineChart('chart-guilds', gLabels, growth.map((x) => x.guilds));
    drawLineChart('chart-users', gLabels, growth.map((x) => x.users), '#6ee7b7');
  }
  if (activity.length >= 2) {
    drawLineChart(
      'chart-activity',
      activity.map((x) => fmtDay(x.day)),
      activity.map((x) => x.commands),
      '#fbbf24',
    );
  }
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
    const t = NexusAuth.getToken();
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
              ${er.guildId ? `<p class="capsule-meta">Servidor: ${esc(er.guildName || 'Desconocido')}</p>` : ''}
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
              <div class="syslog-body">
                <span class="syslog-msg">${esc(l.message)}</span>
                ${formatSyslogMeta(l.meta)}
              </div>
              ${l.guildId ? `<span class="syslog-guild">${esc(l.guildName || 'Servidor desconocido')}</span>` : ''}
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

async function loadHelpVideosAdmin() {
  const el = document.getElementById('tab-help');
  el.innerHTML = `
    <div class="modal-section">
      <h3>Videos de ayuda</h3>
      <p class="modal-meta">Los usuarios los ven en Dashboard → Ayuda. Solo título y URL de YouTube.</p>
      <label class="form-label">Título<input class="form-input" id="hv-title" placeholder="Ej: Configurar Killboard"></label>
      <label class="form-label">URL YouTube<input class="form-input" id="hv-url" placeholder="https://www.youtube.com/watch?v=..."></label>
      <div class="form-actions">
        <button type="button" class="btn btn-accent" id="hv-add">Agregar video</button>
      </div>
    </div>
    <div id="hv-list" class="modal-section"></div>`;

  async function renderList() {
    const r = await api('/api/admin/help-videos');
    const box = document.getElementById('hv-list');
    if (!r.ok) {
      box.innerHTML = '<p class="dash-empty">Error al cargar</p>';
      return;
    }
    const { videos } = await r.json();
    if (!videos.length) {
      box.innerHTML = '<p class="dash-empty">No hay videos aún.</p>';
      return;
    }
    box.innerHTML = videos
      .map(
        (v) => `<div class="capsule" data-id="${v.id}">
          <span class="capsule-name">${esc(v.title)}</span>
          <button type="button" class="icon-btn" data-hv-edit="${v.id}" title="Editar" aria-label="Editar">✏️</button>
          <button type="button" class="icon-btn icon-btn-danger" data-hv-del="${v.id}" title="Eliminar" aria-label="Eliminar">×</button>
        </div>`,
      )
      .join('');

    box.querySelectorAll('[data-hv-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este video?')) return;
        await api(`/api/admin/help-videos/${btn.dataset.hvDel}`, { method: 'DELETE' });
        renderList();
      });
    });
    box.querySelectorAll('[data-hv-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const vid = videos.find((x) => String(x.id) === btn.dataset.hvEdit);
        if (!vid) return;
        const title = prompt('Título', vid.title);
        if (title == null) return;
        const youtubeUrl = prompt('URL YouTube', vid.youtubeUrl);
        if (youtubeUrl == null) return;
        const res = await api(`/api/admin/help-videos/${vid.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), youtubeUrl: youtubeUrl.trim() }),
        });
        if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Error');
        else renderList();
      });
    });
  }

  document.getElementById('hv-add').addEventListener('click', async () => {
    const title = document.getElementById('hv-title').value.trim();
    const youtubeUrl = document.getElementById('hv-url').value.trim();
    if (!title || !youtubeUrl) return alert('Título y URL requeridos');
    const res = await api('/api/admin/help-videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, youtubeUrl }),
    });
    if (!res.ok) {
      alert((await res.json().catch(() => ({}))).error || 'Error');
      return;
    }
    document.getElementById('hv-title').value = '';
    document.getElementById('hv-url').value = '';
    renderList();
  });

  renderList();
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
  const meRes = await api('/api/me');
  const me = meRes.ok ? await meRes.json() : null;
  const owner = await api('/api/admin/me');
  if (!owner.ok) {
    show('login');
    const loginSec = document.getElementById('admin-login');
    if (me && loginSec) {
      const extra = document.createElement('p');
      extra.className = 'dash-sub owner-setup';
      if (!me.botOwnerConfigured) {
        extra.innerHTML = `Pon en Discloud: <code>BOT_OWNER_ID=${esc(me.discordUserId)}</code> y reinicia el bot.`;
      } else {
        extra.textContent = `Tu ID (${me.discordUserId}) no coincide con BOT_OWNER_ID del servidor.`;
      }
      loginSec.appendChild(extra);
    }
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
    if (tab === 'help') await loadHelpVideosAdmin();
    if (tab === 'services') await loadServices();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  NexusAuth.applyTokenFromUrl((msg) => {
    const el = document.getElementById('auth-error');
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  });
  document.getElementById('admin-btn-login').onclick = () => NexusAuth.startLogin(NEXUS_API);
  document.getElementById('admin-logout').onclick = () => {
    NexusAuth.clearToken();
    show('login');
  };
  if (NexusAuth.getToken()) initAdmin();
  else show('login');

  window.addEventListener('pageshow', (e) => {
    if (e.persisted && NexusAuth.getToken()) initAdmin();
  });
});
