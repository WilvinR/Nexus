const os = require('os');
const { getGuildModuleStates } = require('./modules');
const { getChartData, getGlobalStats, ensureGuildMeta } = require('./stats');
const { getBotOwnerIds, isBotOwner } = require('./owner');

function ownerAuth(req, res, next) {
  if (!isBotOwner(req.session?.user_id)) {
    return res.status(403).json({ error: 'Solo el dueño del bot' });
  }
  next();
}

function logSystem(getDb, level, message, meta = {}) {
  getDb()
    .prepare(
      'INSERT INTO system_logs (level, message, guild_id, user_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      level,
      message,
      meta.guildId || null,
      meta.userId || null,
      JSON.stringify(meta.extra || {}),
      Date.now(),
    );
}

function logError(getDb, err, meta = {}) {
  getDb()
    .prepare(
      `INSERT INTO error_logs (level, message, stack, guild_id, user_id, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      meta.level || 'error',
      String(err?.message || err),
      String(err?.stack || ''),
      meta.guildId || null,
      meta.userId || null,
      Date.now(),
    );
}

function saveSuggestion(getDb, { userId, username, guildId, guildName, content }) {
  getDb()
    .prepare(
      `INSERT INTO suggestions (user_id, username, guild_id, guild_name, content, read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(userId, username, guildId, guildName, content, Date.now());
}

function registerAdminRoutes(app, { client, getDb, log, sessionAuth }) {
  app.get('/api/admin/me', sessionAuth, ownerAuth, (req, res) => {
    res.json({ ok: true, owner: true });
  });

  app.get('/api/admin/overview', sessionAuth, ownerAuth, (req, res) => {
    const mem = process.memoryUsage();
    const guilds = client.guilds?.cache;
    let users = 0;
    if (guilds) for (const g of guilds.values()) users += g.memberCount || 0;

    res.json({
      ok: true,
      online: client.isReady(),
      ping: client.ws.ping,
      guilds: guilds?.size ?? 0,
      users,
      uptime: Math.floor(process.uptime()),
      memoryMb: Math.round(mem.rss / 1024 / 1024),
      cpuLoad: os.loadavg()[0],
      version: process.env.npm_package_version || '1.0.0',
      updatedAt: new Date().toISOString(),
      stats: getGlobalStats(getDb),
    });
  });

  app.get('/api/admin/stats/charts', sessionAuth, ownerAuth, (req, res) => {
    res.json({ ok: true, ...getChartData(getDb, 30) });
  });

  app.get('/api/admin/guilds', sessionAuth, ownerAuth, async (req, res) => {
    const list = [];
    for (const g of client.guilds.cache.values()) {
      const meta = ensureGuildMeta(getDb, g.id, { ownerId: g.ownerId, joinedAt: g.joinedAt?.getTime?.() });
      let ownerTag = meta.owner_tag;
      if (!ownerTag) {
        const owner = await g.fetchOwner().catch(() => null);
        ownerTag = owner?.user?.tag || null;
        if (ownerTag) {
          getDb().prepare('UPDATE guild_meta SET owner_tag = ? WHERE guild_id = ?').run(ownerTag, g.id);
        }
      }
      list.push({
        id: g.id,
        name: g.name,
        icon: g.icon,
        memberCount: g.memberCount,
        ownerId: g.ownerId,
        ownerTag,
        premium: meta.premium === 1,
        joinedAt: meta.joined_at ? new Date(meta.joined_at).toISOString() : g.joinedAt?.toISOString?.() || null,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, guilds: list });
  });

  app.get('/api/admin/guilds/:guildId', sessionAuth, ownerAuth, async (req, res) => {
    const g = client.guilds.cache.get(String(req.params.guildId));
    if (!g) return res.status(404).json({ error: 'Servidor no encontrado' });
    const meta = ensureGuildMeta(getDb, g.id, { ownerId: g.ownerId });
    const owner = await g.fetchOwner().catch(() => null);
    const registroUsers = getDb()
      .prepare('SELECT COUNT(*) AS n FROM registro_users WHERE discord_guild_id = ?')
      .get(g.id).n;
    const killN = getDb()
      .prepare('SELECT COUNT(*) AS n FROM kill_entities WHERE discord_guild_id = ?')
      .get(g.id).n;
    const battleN = getDb()
      .prepare('SELECT COUNT(*) AS n FROM battle_tracking WHERE discord_guild_id = ?')
      .get(g.id).n;
    res.json({
      ok: true,
      guild: {
        id: g.id,
        name: g.name,
        icon: g.icon,
        memberCount: g.memberCount,
        ownerId: g.ownerId,
        ownerTag: owner?.user?.tag || meta.owner_tag,
        premium: meta.premium === 1,
        joinedAt: meta.joined_at ? new Date(meta.joined_at).toISOString() : null,
        modules: getGuildModuleStates(getDb, g.id),
        stats: { registroUsers, killEntities: killN, battleTracks: battleN },
      },
    });
  });

  app.patch('/api/admin/guilds/:guildId/premium', sessionAuth, ownerAuth, (req, res) => {
    const id = String(req.params.guildId);
    if (!client.guilds.cache.has(id)) return res.status(404).json({ error: 'Servidor no encontrado' });
    ensureGuildMeta(getDb, id);
    const premium = req.body?.premium ? 1 : 0;
    getDb().prepare('UPDATE guild_meta SET premium = ? WHERE guild_id = ?').run(premium, id);
    logSystem(getDb, 'info', `Premium ${premium ? 'ON' : 'OFF'} en ${id}`, { guildId: id });
    res.json({ ok: true, premium: !!premium });
  });

  app.delete('/api/admin/guilds/:guildId', sessionAuth, ownerAuth, async (req, res) => {
    const id = String(req.params.guildId);
    const g = client.guilds.cache.get(id);
    if (!g) return res.status(404).json({ error: 'Servidor no encontrado' });
    try {
      await g.leave();
      logSystem(getDb, 'warn', `Bot expulsado manualmente de ${g.name}`, { guildId: id });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/guilds/:guildId/sync', sessionAuth, ownerAuth, async (req, res) => {
    const hooks = req.app.locals?.commandSyncHook;
    if (hooks?.syncGuildCommands) {
      await hooks.syncGuildCommands(client, getDb, log, req.params.guildId);
    }
    logSystem(getDb, 'info', `Sincronización manual ${req.params.guildId}`, { guildId: req.params.guildId });
    res.json({ ok: true });
  });

  app.get('/api/admin/suggestions', sessionAuth, ownerAuth, (req, res) => {
    const rows = getDb()
      .prepare('SELECT * FROM suggestions ORDER BY created_at DESC LIMIT 200')
      .all()
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        username: r.username,
        guildId: r.guild_id,
        guildName: r.guild_name,
        content: r.content,
        read: r.read === 1,
        createdAt: r.created_at,
      }));
    res.json({ ok: true, suggestions: rows });
  });

  app.patch('/api/admin/suggestions/:id/read', sessionAuth, ownerAuth, (req, res) => {
    const read = req.body?.read !== false ? 1 : 0;
    getDb().prepare('UPDATE suggestions SET read = ? WHERE id = ?').run(read, Number(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/admin/errors/export', sessionAuth, ownerAuth, (req, res) => {
    const rows = getDb().prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 500').all();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="nexus-errors.json"');
    res.send(JSON.stringify(rows, null, 2));
  });

  app.get('/api/admin/errors', sessionAuth, ownerAuth, (req, res) => {
    const level = req.query.level;
    const rows = level
      ? getDb()
          .prepare('SELECT * FROM error_logs WHERE level = ? ORDER BY created_at DESC LIMIT 150')
          .all(level)
      : getDb().prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 150').all();
    res.json({
      ok: true,
      errors: rows.map((r) => ({
        id: r.id,
        level: r.level,
        message: r.message,
        stack: r.stack,
        guildId: r.guild_id,
        userId: r.user_id,
        resolved: r.resolved === 1,
        createdAt: r.created_at,
      })),
    });
  });

  app.patch('/api/admin/errors/:id/resolve', sessionAuth, ownerAuth, (req, res) => {
    getDb().prepare('UPDATE error_logs SET resolved = 1 WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/admin/system-logs', sessionAuth, ownerAuth, (req, res) => {
    const level = req.query.level;
    const rows = level
      ? getDb()
          .prepare('SELECT * FROM system_logs WHERE level = ? ORDER BY created_at DESC LIMIT 300')
          .all(level)
      : getDb().prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 300').all();
    res.json({
      ok: true,
      logs: rows.map((r) => ({
        id: r.id,
        level: r.level,
        message: r.message,
        guildId: r.guild_id,
        userId: r.user_id,
        meta: r.meta_json,
        createdAt: r.created_at,
      })),
    });
  });

  app.get('/api/admin/services', sessionAuth, ownerAuth, async (req, res) => {
    let albion = 'operational';
    try {
      const r = await fetch('https://gameinfo.albiononline.com/api/gameinfo/search?q=test', {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) albion = 'degraded';
    } catch {
      albion = 'down';
    }
    res.json({
      ok: true,
      services: [
        { id: 'db', name: 'Base de datos', status: 'operational' },
        { id: 'albion', name: 'API de Albion', status: albion },
        { id: 'bot', name: 'API del Bot', status: client.isReady() ? 'operational' : 'down' },
        { id: 'web', name: 'Dashboard Web', status: 'operational' },
        { id: 'announce', name: 'Sistema de Anuncios', status: 'operational' },
      ],
    });
  });

  app.post('/api/admin/announce', sessionAuth, ownerAuth, async (req, res) => {
    const { title, description, imageUrl, buttonUrl, buttonLabel, guildIds } = req.body || {};
    if (!title && !description) {
      return res.status(400).json({ error: 'Título o descripción requeridos' });
    }
    const targets = Array.isArray(guildIds) && guildIds.length
      ? guildIds.map(String)
      : [...client.guilds.cache.keys()];
    let sent = 0;
    let errors = 0;
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    for (const gid of targets) {
      const g = client.guilds.cache.get(gid);
      if (!g) {
        errors++;
        continue;
      }
      const ch = g.systemChannel || g.channels.cache.find((c) => c.isTextBased() && c.permissionsFor(g.members.me)?.has('SendMessages'));
      if (!ch) {
        errors++;
        continue;
      }
      try {
        const embed = new EmbedBuilder().setTitle(title || 'Nexus').setDescription(description || '').setColor(0x00d4ff);
        if (imageUrl) embed.setImage(imageUrl);
        const payload = { embeds: [embed] };
        if (buttonUrl && buttonLabel) {
          payload.components = [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setLabel(buttonLabel).setStyle(ButtonStyle.Link).setURL(buttonUrl),
            ),
          ];
        }
        await ch.send(payload);
        sent++;
      } catch (e) {
        errors++;
        log.warn(`Anuncio ${gid}: ${e.message}`);
      }
    }
    getDb()
      .prepare(
        `INSERT INTO announcements (title, body, guilds_target, sent_count, error_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(title || '', description || '', JSON.stringify(targets), sent, errors, Date.now());
    logSystem(getDb, 'info', `Anuncio global: ${sent} enviados, ${errors} errores`);
    res.json({ ok: true, sent, errors, reached: targets.length });
  });

  app.get('/api/admin/announcements', sessionAuth, ownerAuth, (req, res) => {
    const rows = getDb()
      .prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50')
      .all();
    res.json({ ok: true, announcements: rows });
  });
}

module.exports = { registerAdminRoutes, logSystem, logError, saveSuggestion };
