const providers = new Map();

function registerProvider(name, fn) {
  if (typeof fn === 'function') providers.set(name, fn);
}

function countDiscordCaches(client) {
  if (!client?.isReady?.()) {
    return { ready: false, guilds: 0, membersCached: 0, channels: 0, users: 0, roles: 0, emojis: 0 };
  }

  let membersCached = 0;
  let roles = 0;
  let emojis = 0;
  for (const g of client.guilds.cache.values()) {
    membersCached += g.members?.cache?.size ?? 0;
    roles += g.roles?.cache?.size ?? 0;
    emojis += g.emojis?.cache?.size ?? 0;
  }

  return {
    ready: true,
    guilds: client.guilds.cache.size,
    membersCached,
    channels: client.channels.cache.size,
    users: client.users.cache.size,
    roles,
    emojis,
    wsPing: client.ws?.ping ?? null,
  };
}

function countDatabase(getDb) {
  const q = (sql) => {
    try {
      return getDb().prepare(sql).get()?.n ?? 0;
    } catch {
      return 0;
    }
  };
  return {
    killEntities: q('SELECT COUNT(*) AS n FROM kill_entities'),
    registroUsers: q('SELECT COUNT(*) AS n FROM registro_users'),
    eventos: q('SELECT COUNT(*) AS n FROM eventos'),
    authSessions: q('SELECT COUNT(*) AS n FROM auth_sessions'),
    gucciSubscribers: q('SELECT COUNT(*) AS n FROM gucci_kills_config WHERE enabled = 1'),
    battleTracking: q('SELECT COUNT(*) AS n FROM battle_tracking'),
    systemLogs: q('SELECT COUNT(*) AS n FROM system_logs'),
    errorLogs: q('SELECT COUNT(*) AS n FROM error_logs'),
  };
}

function safeProvider(name, fn) {
  try {
    return fn() || {};
  } catch {
    return { error: true };
  }
}

function collectModuleCaches() {
  const out = {};
  for (const [name, fn] of providers) {
    out[name] = safeProvider(name, fn);
  }
  return out;
}

function analyzeSuspects(snapshot) {
  const suspects = [];
  const d = snapshot.discord;
  const m = snapshot.memory;
  const c = snapshot.caches;

  if (d.membersCached >= 200) {
    suspects.push({
      id: 'discord.members',
      label: `Caché miembros Discord (${d.membersCached.toLocaleString('es-ES')})`,
      severity: d.membersCached >= 1500 ? 'high' : 'medium',
    });
  }
  if (d.channels >= 300) {
    suspects.push({
      id: 'discord.channels',
      label: `Canales en caché (${d.channels})`,
      severity: 'medium',
    });
  }

  const img = c.killImages?.imageCache ?? 0;
  if (img >= 80) {
    suspects.push({
      id: 'killImages',
      label: `Imágenes kill en RAM (${img}/${c.killImages?.imageCacheMax ?? '?'})`,
      severity: img >= 200 ? 'high' : 'medium',
    });
  }

  if (c.mercado?.itemsLoaded) {
    suspects.push({
      id: 'mercado.items',
      label: `Catálogo mercado cargado (${(c.mercado.itemsCount || 0).toLocaleString('es-ES')} ítems)`,
      severity: 'medium',
    });
  }

  if ((c.api?.oauthGuildCache ?? 0) >= 20) {
    suspects.push({
      id: 'api.oauth',
      label: `Sesiones OAuth en caché (${c.api.oauthGuildCache})`,
      severity: 'low',
    });
  }

  if ((c.eventos?.activeEvents ?? 0) >= 5) {
    suspects.push({
      id: 'eventos',
      label: `Eventos activos en memoria (${c.eventos.activeEvents})`,
      severity: 'low',
    });
  }

  if (m.externalMb >= 80 || m.arrayBuffersMb >= 40) {
    suspects.push({
      id: 'native.buffers',
      label: `Memoria nativa/buffers (Ext ${m.externalMb} MB, AB ${m.arrayBuffersMb} MB) — canvas, imágenes, Discord`,
      severity: m.externalMb >= 150 ? 'high' : 'medium',
    });
  }

  if (m.rssMb - m.heapMb >= 200 && suspects.length === 0) {
    suspects.push({
      id: 'rss.overhead',
      label: `RSS alto vs heap (${m.rssMb} vs ${m.heapMb} MB) — probable overhead de Discord.js / Node nativo`,
      severity: 'medium',
    });
  }

  suspects.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
  });

  return suspects;
}

function collectSnapshot(client, getDb) {
  const mem = process.memoryUsage();
  const memory = {
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    externalMb: Math.round(mem.external / 1024 / 1024),
    arrayBuffersMb: Math.round(mem.arrayBuffers / 1024 / 1024),
    uptimeSec: Math.floor(process.uptime()),
  };

  const snapshot = {
    at: new Date().toISOString(),
    memory,
    discord: countDiscordCaches(client),
    database: countDatabase(getDb),
    caches: collectModuleCaches(),
  };
  snapshot.suspects = analyzeSuspects(snapshot);
  return snapshot;
}

function formatSummary(snapshot) {
  const m = snapshot.memory;
  const parts = [`${m.rssMb} MB (Heap ${m.heapMb} | Ext ${m.externalMb} | AB ${m.arrayBuffersMb})`];
  if (snapshot.discord.ready) {
    parts.push(
      `Discord: ${snapshot.discord.guilds} srv · ${snapshot.discord.membersCached.toLocaleString('es-ES')} miembros cache`,
    );
  }
  if (snapshot.suspects.length) {
    parts.push(`Causa probable: ${snapshot.suspects.slice(0, 2).map((s) => s.label).join('; ')}`);
  }
  return parts.join(' · ');
}

module.exports = {
  registerProvider,
  collectSnapshot,
  formatSummary,
  analyzeSuspects,
};
