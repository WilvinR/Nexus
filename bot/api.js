const crypto = require('crypto');
const { MODULES, getGuildModuleStates, setModuleEnabled } = require('./modules');
const { registerGuildConfigRoutes } = require('./guildConfigRoutes');
const { registerAdminRoutes, logSystem } = require('./adminRoutes');
const { buildInviteUrl, getClientId } = require('./invite');
const { isBotOwner, getBotOwnerIds } = require('./owner');

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
  app.use(express.json());

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
    logSystem(getDb, 'info', `Módulo ${moduleId} ${enabled ? 'activado' : 'desactivado'}`, {
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
