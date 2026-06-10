const crypto = require('crypto');
const { MODULES, getGuildModuleStates, setModuleEnabled } = require('./modules');
const { registerGuildConfigRoutes } = require('./guildConfigRoutes');
const { registerAdminRoutes, logSystem, isBotOwner, getBotOwnerIds, parseYoutubeId } = require('./adminRoutes');
const { buildInviteUrl, getClientId } = require('./invite');

let server = null;
const userGuildCache = new Map();

function ownersOnly() {
  return process.env.DASHBOARD_OWNERS_ONLY !== 'false';
}

function oauthCallbackUrl() {
  return process.env.OAUTH_REDIRECT_URI || 'https://nexus-bot.discloud.app/api/auth/callback';
}

function buildLoginUrl(redirectTo) {
  const clientId = getClientId();
  if (!clientId) return null;
  const state = Buffer.from(
    JSON.stringify({ r: redirectTo || `${process.env.WEB_URL || ''}/dashboard.html` }),
  ).toString('base64url');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthCallbackUrl(),
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function canManageGuild(g) {
  if (ownersOnly()) return !!g.owner;
  if (g.owner) return true;
  try {
    const perms = BigInt(String(g.permissions ?? 0));
    return (perms & 8n) === 8n || (perms & 32n) === 32n;
  } catch {
    return false;
  }
}

async function fetchUserGuilds(session, log) {
  const key = session.token;
  const hit = userGuildCache.get(key);
  if (hit && Date.now() - hit.at < 120_000) return hit.guilds;

  const guilds = await discordApi('/users/@me/guilds', session.access_token);
  if (!guilds) {
    log.warn('Discord /users/@me/guilds falló');
    return hit?.guilds ?? null;
  }
  userGuildCache.set(key, { guilds, at: Date.now() });
  return guilds;
}

function buildManagedGuildList(client, rawGuilds) {
  return rawGuilds
    .filter((g) => canManageGuild(g) && client.guilds.cache.has(String(g.id)))
    .map((g) => {
      const id = String(g.id);
      const botGuild = client.guilds.cache.get(id);
      return {
        id,
        name: botGuild?.name || g.name,
        icon: g.icon,
        owner: !!g.owner,
        botPresent: true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function assertGuildAccess(client, session, guildId, log) {
  const id = String(guildId);
  if (!client.guilds.cache.has(id)) {
    return { ok: false, status: 400, error: 'Nexus no está en este servidor' };
  }
  if (isBotOwner(session.user_id)) {
    return { ok: true, guildId: id, botOwner: true };
  }
  const guilds = await fetchUserGuilds(session, log);
  if (!guilds) return { ok: false, status: 502, error: 'No se pudo verificar con Discord' };
  const g = guilds.find((x) => String(x.id) === id);
  if (!g || !canManageGuild(g)) {
    return { ok: false, status: 403, error: 'Sin permiso (solo dueños del servidor)' };
  }
  return { ok: true, guildId: id };
}

function buildGuildListForUser(client, rawGuilds, userId) {
  if (isBotOwner(userId)) {
    return [...client.guilds.cache.values()]
      .map((g) => ({
        id: String(g.id),
        name: g.name,
        icon: g.icon,
        owner: true,
        botOwnerAccess: true,
        botPresent: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return buildManagedGuildList(client, rawGuilds);
}

async function discordTokenExchange(code, log) {
  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthCallbackUrl(),
  });
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    if (log) log.warn(`OAuth token: ${r.status} ${detail.slice(0, 200)}`);
    return null;
  }
  return r.json();
}

async function discordApi(path, accessToken) {
  const r = await fetch(`https://discord.com/api${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return r.json();
}

function start(client, log, getDb, hooks = {}) {
  if (process.env.API_ENABLED === 'false') {
    log.warn('API desactivada (API_ENABLED=false).');
    return;
  }

  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  const corsOrigins = (process.env.API_CORS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const vercelOk = origin && /\.vercel\.app$/i.test(origin);
    if (!corsOrigins.length) {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      else res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && (corsOrigins.includes(origin) || vercelOk)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const apiSecretAuth = (req, res, next) => {
    const secret = process.env.API_SECRET;
    if (!secret) return res.status(503).json({ error: 'Sin API_SECRET' });
    const header = req.headers['x-api-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if ((header || req.query.secret) !== secret) return res.status(401).json({ error: 'No autorizado' });
    next();
  };

  function loadSession(req) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;
    if (!token) return null;
    return getDb()
      .prepare('SELECT token, user_id, access_token, username, avatar FROM auth_sessions WHERE token = ?')
      .get(token);
  }

  const sessionAuth = (req, res, next) => {
    const session = loadSession(req);
    if (!session) return res.status(401).json({ error: 'Sesión inválida. Inicia sesión de nuevo.' });
    req.session = session;
    next();
  };

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      bot: client.user?.tag ?? null,
      ready: client.isReady?.() ?? false,
      guilds: client.guilds?.cache?.size ?? 0,
    });
  });

  app.get('/api/public', (_req, res) => {
    const web = (process.env.WEB_URL || '').replace(/\/$/, '');
    res.json({
      ok: true,
      bot: client.user?.tag ?? null,
      ready: client.isReady?.() ?? false,
      guilds: client.guilds?.cache?.size ?? 0,
      invite: buildInviteUrl() || null,
      loginUrl: buildLoginUrl(`${web}/dashboard.html`),
      webUrl: web || null,
    });
  });

  app.get('/api/auth/login', (req, res) => {
    const url = buildLoginUrl(req.query.redirect);
    if (!url) return res.status(503).send('OAuth no configurado (CLIENT_ID / DISCORD_CLIENT_SECRET)');
    res.redirect(url);
  });

  app.get('/api/auth/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code) return res.status(400).send('Sin código de Discord');

      let redirectTo = `${(process.env.WEB_URL || '').replace(/\/$/, '')}/dashboard.html`;
      if (state) {
        try {
          redirectTo = JSON.parse(Buffer.from(String(state), 'base64url').toString()).r || redirectTo;
        } catch {
          /* ignore */
        }
      }

      if (!process.env.DISCORD_CLIENT_SECRET) {
        return res.status(503).send('Falta DISCORD_CLIENT_SECRET en Discloud');
      }

      const tokens = await discordTokenExchange(code, log);
      if (!tokens?.access_token) {
        const sep = redirectTo.includes('?') ? '&' : '?';
        return res.redirect(`${redirectTo}${sep}auth_error=discord`);
      }

      const user = await discordApi('/users/@me', tokens.access_token);
      if (!user?.id) return res.status(401).send('Usuario no válido');

      const sessionToken = newSessionToken();
      getDb()
        .prepare(`
          INSERT INTO auth_sessions (token, user_id, access_token, username, avatar, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          sessionToken,
          user.id,
          tokens.access_token,
          user.global_name || user.username,
          user.avatar || '',
          Date.now(),
        );

      const sep = redirectTo.includes('?') ? '&' : '?';
      res.redirect(`${redirectTo}${sep}token=${sessionToken}`);
    } catch (e) {
      log.error('OAuth callback:', e);
      res.status(500).send('Error en inicio de sesión');
    }
  });

  app.get('/api/me', sessionAuth, async (req, res) => {
    const uid = req.session.user_id;
    const ownerIds = getBotOwnerIds();
    res.json({
      ok: true,
      user: {
        id: uid,
        username: req.session.username,
        avatar: req.session.avatar,
      },
      isOwner: isBotOwner(uid),
      botOwnerConfigured: ownerIds.length > 0,
      discordUserId: uid,
    });
  });

  app.get('/api/me/guilds', sessionAuth, async (req, res) => {
    const uid = req.session.user_id;
    if (isBotOwner(uid)) {
      return res.json({ ok: true, guilds: buildGuildListForUser(client, [], uid), botOwner: true });
    }
    const raw = await fetchUserGuilds(req.session, log);
    if (!raw) return res.status(502).json({ error: 'No se pudieron cargar tus servidores' });
    res.json({ ok: true, guilds: buildGuildListForUser(client, raw, uid) });
  });

  app.get('/api/me/dashboard', sessionAuth, async (req, res) => {
    const uid = req.session.user_id;
    const botOwner = isBotOwner(uid);
    let guilds;
    if (botOwner) {
      guilds = buildGuildListForUser(client, [], uid);
    } else {
      const raw = await fetchUserGuilds(req.session, log);
      if (!raw) return res.status(502).json({ error: 'No se pudieron cargar tus servidores' });
      guilds = buildGuildListForUser(client, raw, uid);
    }

    const withModules = guilds.map((g) => ({
      ...g,
      modules: getGuildModuleStates(getDb, g.id),
    }));

    res.json({
      ok: true,
      guilds: withModules,
      ownersOnly: ownersOnly(),
      isOwner: botOwner,
      botOwnerConfigured: getBotOwnerIds().length > 0,
    });
  });

  app.get('/api/guilds/:guildId/modules', sessionAuth, async (req, res) => {
    const access = await assertGuildAccess(client, req.session, req.params.guildId, log);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    res.json({ ok: true, modules: getGuildModuleStates(getDb, access.guildId) });
  });

  app.patch('/api/guilds/:guildId/modules/:moduleId', sessionAuth, async (req, res) => {
    const { moduleId } = req.params;
    if (!MODULES.some((m) => m.id === moduleId)) {
      return res.status(400).json({ error: 'Módulo desconocido' });
    }
    const access = await assertGuildAccess(client, req.session, req.params.guildId, log);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const enabled = !!req.body?.enabled;
    setModuleEnabled(getDb, access.guildId, moduleId, enabled);
    const gName = client.guilds.cache.get(access.guildId)?.name || access.guildId;
    logSystem(getDb, 'info', `Módulo ${moduleId} ${enabled ? 'activado' : 'desactivado'} en ${gName}`, {
      guildId: access.guildId,
      extra: { moduleId, enabled },
    });
    if (hooks.onModuleToggle) {
      hooks.onModuleToggle(access.guildId).catch((e) => log.warn(`Comandos ${access.guildId}: ${e.message}`));
    }
    res.json({ ok: true, moduleId, enabled });
  });

  app.get('/api/status', apiSecretAuth, (_req, res) => {
    res.json({
      ok: true,
      bot: client.user?.tag,
      guilds: client.guilds?.cache?.size ?? 0,
      modules: MODULES.map((m) => m.id),
    });
  });

  const ALBION_API = 'https://gameinfo.albiononline.com/api/gameinfo';
  const ALBION_RETRIES = 3;
  const ALBION_TIMEOUT_MS = 20_000;

  async function albionFetchWithRetry(url, { notFoundOn404 = false } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= ALBION_RETRIES; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(ALBION_TIMEOUT_MS) });
        if (r.status === 404 && notFoundOn404) return { notFound: true };
        if (!r.ok) {
          lastErr = new Error(`HTTP ${r.status}`);
          if (attempt < ALBION_RETRIES) {
            await new Promise((res) => setTimeout(res, 600 * attempt));
            continue;
          }
          return null;
        }
        return r.json();
      } catch (e) {
        lastErr = e;
        if (attempt < ALBION_RETRIES) {
          await new Promise((res) => setTimeout(res, 600 * attempt));
          continue;
        }
        throw lastErr;
      }
    }
    return null;
  }

  async function albionSearchQuery(q) {
    return albionFetchWithRetry(`${ALBION_API}/search?q=${encodeURIComponent(q)}`);
  }

  app.get('/api/help/videos', sessionAuth, (req, res) => {
    const rows = getDb()
      .prepare('SELECT * FROM help_videos ORDER BY sort_order ASC, id ASC')
      .all();
    res.json({
      ok: true,
      videos: rows.map((r) => ({
        id: r.id,
        title: r.title,
        youtubeUrl: r.youtube_url,
        youtubeId: parseYoutubeId(r.youtube_url),
      })),
    });
  });

  async function albionFetchJson(path) {
    return albionFetchWithRetry(`${ALBION_API}${path}`, { notFoundOn404: true });
  }

  function mapPlayerLifetime(ls) {
    if (!ls) return null;
    return {
      pve: {
        total: ls.PvE?.Total ?? null,
        royal: ls.PvE?.Royal ?? null,
        outlands: ls.PvE?.Outlands ?? null,
        avalon: ls.PvE?.Avalon ?? null,
        hellgate: ls.PvE?.Hellgate ?? null,
        corruptedDungeon: ls.PvE?.CorruptedDungeon ?? null,
        mists: ls.PvE?.Mists ?? null,
      },
      gathering: {
        fiber: ls.Gathering?.Fiber?.Total ?? null,
        hide: ls.Gathering?.Hide?.Total ?? null,
        ore: ls.Gathering?.Ore?.Total ?? null,
        rock: ls.Gathering?.Rock?.Total ?? null,
        wood: ls.Gathering?.Wood?.Total ?? null,
        all: ls.Gathering?.All?.Total ?? null,
      },
      crafting: {
        total: ls.Crafting?.Total ?? null,
        royal: ls.Crafting?.Royal ?? null,
        outlands: ls.Crafting?.Outlands ?? null,
        avalon: ls.Crafting?.Avalon ?? null,
      },
      fishingFame: ls.FishingFame ?? null,
      farmingFame: ls.FarmingFame ?? null,
      crystalLeague: ls.CrystalLeague ?? null,
    };
  }

  async function fetchGuildTopPlayers(guildId) {
    const dataRes = await albionFetchJson(`/guilds/${guildId}/data`);
    if (dataRes && !dataRes.notFound && dataRes.topPlayers?.length) {
      return dataRes.topPlayers.slice(0, 5);
    }
    const memRes = await albionFetchJson(`/guilds/${guildId}/members`);
    if (!memRes || memRes.notFound || !Array.isArray(memRes)) return [];
    return [...memRes].sort((a, b) => (b.KillFame || 0) - (a.KillFame || 0)).slice(0, 5);
  }

  app.get('/api/albion/players/:playerId', sessionAuth, async (req, res) => {
    const id = String(req.params.playerId || '').trim();
    if (!id) return res.status(400).json({ error: 'ID requerido' });
    try {
      const data = await albionFetchJson(`/players/${encodeURIComponent(id)}`);
      if (data?.notFound) return res.status(404).json({ error: 'Jugador no encontrado' });
      if (!data) return res.status(502).json({ error: 'API de Albion no disponible' });
      res.json({
        ok: true,
        player: {
          id: data.Id,
          name: data.Name,
          guildId: data.GuildId || null,
          guildName: data.GuildName || null,
          allianceId: data.AllianceId || null,
          allianceName: data.AllianceName || null,
          allianceTag: data.AllianceTag || null,
          killFame: data.KillFame ?? null,
          deathFame: data.DeathFame ?? null,
          fameRatio: data.FameRatio ?? null,
          averageItemPower: data.AverageItemPower ?? null,
          lifetime: mapPlayerLifetime(data.LifetimeStatistics),
          killboardUrl: `https://albiononline.com/en/killboard/player/${data.Id}`,
        },
      });
    } catch (e) {
      res.status(502).json({ error: e.message || 'Error al cargar jugador' });
    }
  });

  app.get('/api/albion/guilds/:guildId', sessionAuth, async (req, res) => {
    const id = String(req.params.guildId || '').trim();
    if (!id) return res.status(400).json({ error: 'ID requerido' });
    try {
      const data = await albionFetchJson(`/guilds/${encodeURIComponent(id)}`);
      if (data?.notFound) return res.status(404).json({ error: 'Gremio no encontrado' });
      if (!data) return res.status(502).json({ error: 'API de Albion no disponible' });
      let allianceTag = data.AllianceTag || data.AllianceName || null;
      if (data.AllianceId && !allianceTag) {
        const al = await albionFetchJson(`/alliances/${data.AllianceId}`);
        if (al && !al.notFound) {
          allianceTag = al.Tag || al.AllianceTag || al.AllianceName || null;
        }
      }
      const topPlayers = await fetchGuildTopPlayers(id);
      res.json({
        ok: true,
        guild: {
          id: data.Id,
          name: data.Name,
          founderName: data.FounderName || null,
          founded: data.Founded || null,
          memberCount: data.MemberCount ?? null,
          allianceId: data.AllianceId || null,
          allianceName: data.AllianceName || null,
          allianceTag,
          killFame: data.KillFame ?? data.killFame ?? null,
          deathFame: data.DeathFame ?? data.deathFame ?? null,
          topPlayers: topPlayers.map((p) => ({
            id: p.Id,
            name: p.Name,
            killFame: p.KillFame ?? null,
          })),
          killboardUrl: `https://albiononline.com/en/killboard/guild/${data.Id}`,
        },
      });
    } catch (e) {
      res.status(502).json({ error: e.message || 'Error al cargar gremio' });
    }
  });

  app.get('/api/albion/search/players', sessionAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ error: 'Escribe al menos 2 caracteres' });
    try {
      const data = await albionSearchQuery(q);
      if (!data) return res.status(502).json({ error: 'API de Albion no disponible' });
      const players = (data.players || []).slice(0, 15).map((p) => ({
        id: p.Id,
        name: p.Name,
        guildName: p.GuildName || null,
        guildId: p.GuildId || null,
        allianceName: p.AllianceName || null,
        allianceTag: p.AllianceTag || null,
        killFame: p.KillFame ?? null,
        deathFame: p.DeathFame ?? null,
        fameRatio: p.FameRatio ?? null,
      }));
      res.json({ ok: true, players });
    } catch (e) {
      res.status(502).json({ error: e.message || 'Error de búsqueda' });
    }
  });

  app.get('/api/albion/search/guilds', sessionAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ error: 'Escribe al menos 2 caracteres' });
    try {
      const data = await albionSearchQuery(q);
      if (!data) return res.status(502).json({ error: 'API de Albion no disponible' });
      const guilds = (data.guilds || []).slice(0, 15).map((g) => ({
        id: g.Id,
        name: g.Name,
        allianceName: g.AllianceName || null,
        allianceTag: g.AllianceTag || null,
        memberCount: g.MemberCount ?? null,
        killFame: g.KillFame ?? null,
      }));
      res.json({ ok: true, guilds });
    } catch (e) {
      res.status(502).json({ error: e.message || 'Error de búsqueda' });
    }
  });

  registerGuildConfigRoutes(app, { client, getDb, log, sessionAuth, assertGuildAccess });
  registerAdminRoutes(app, { client, getDb, log, sessionAuth });
  if (hooks.syncGuildCommands) {
    app.locals.commandSyncHook = { syncGuildCommands: hooks.syncGuildCommands };
  }

  const port = Number(process.env.PORT || process.env.API_PORT) || 8080;
  server = app.listen(port, '0.0.0.0', () => {
    log.info(`API en 0.0.0.0:${port}`);
  });
}

function stop() {
  if (server) server.close();
}

module.exports = { start, stop };
