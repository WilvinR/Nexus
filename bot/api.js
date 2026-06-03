let server = null;

function getClientId() {
  if (process.env.CLIENT_ID) return process.env.CLIENT_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  try {
    return Buffer.from(token.split('.')[0], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function buildInviteUrl() {
  if (process.env.DISCORD_INVITE_URL) return process.env.DISCORD_INVITE_URL;
  const clientId = getClientId();
  if (!clientId) return null;
  const perms = process.env.DISCORD_INVITE_PERMISSIONS || '268568576';
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=bot%20applications.commands`;
}

function start(client, log) {
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
    if (!corsOrigins.length) {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      else res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const auth = (req, res, next) => {
    const secret = process.env.API_SECRET;
    if (!secret) return res.status(503).json({ error: 'Sin API_SECRET configurado en el host' });
    const header = req.headers['x-api-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if ((header || req.query.secret) !== secret) {
      return res.status(401).json({ error: 'No autorizado' });
    }
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
    res.json({
      ok: true,
      bot: client.user?.tag ?? null,
      ready: client.isReady?.() ?? false,
      guilds: client.guilds?.cache?.size ?? 0,
      invite: buildInviteUrl(),
      oauthUrl: null,
    });
  });

  app.get('/api/status', auth, (_req, res) => {
    res.json({
      ok: true,
      bot: client.user?.tag,
      guilds: client.guilds?.cache?.size ?? 0,
      modules: ['registro', 'logs', 'kill', 'mercado', 'battle', 'bal'],
    });
  });

  const port = Number(process.env.PORT || process.env.API_PORT) || 8080;
  server = app.listen(port, '0.0.0.0', () => {
    log.info(`API en 0.0.0.0:${port} (web en Vercel → ${process.env.WEB_URL || 'vercel'})`);
  });
}

function stop() {
  if (server) server.close();
}

module.exports = { start, stop };
