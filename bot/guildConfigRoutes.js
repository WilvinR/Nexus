const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { albionGuild, albionAlliance, albionPlayer } = require('./albionApi');
const { getUtcClock, setupUtcInGuild, removeUtcFromGuild, listUtcClocksInGuild, UTC_TICK_MS } = require('./utcClock');
const {
  getConfig: getSancionesConfig,
  setChannel: setSancionesChannel,
  getRecord: getSancionRecord,
  listRecords: listSancionRecords,
  listLog: listSancionLog,
  applyInfraccion,
  removeInfraccion,
  getNotifyChannel,
  syncRecordChanges,
  clearRecordWithNotify,
  MAX_STRIKES,
} = require('./sanciones');
const {
  listGuildEvents,
  getGuildEvent,
  eventToDashboardPayload,
  createEventFromDashboard,
  updateEventFromDashboard,
  deleteEventFromDashboard,
} = require('./eventos');
const { resolveGuildBattleInput, seedBattles } = require('./battle');
const { GUCCI_MIN_FAME } = require('./kill');
const { resolveMemberStats } = require('./memberStats');
const {
  listHubs,
  getHubById,
  createHub,
  updateHub,
  deleteHub,
} = require('./voces');

function gid(id) {
  return String(id);
}

function discordGuild(client, guildId) {
  return client.guilds.cache.get(gid(guildId)) || null;
}

function listTextChannels(guild) {
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText)
    .map((c) => ({ id: c.id, name: c.name, category: c.parent?.name || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listVoiceChannels(guild) {
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildVoice)
    .map((c) => ({ id: c.id, name: c.name, category: c.parent?.name || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listCategories(guild) {
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildCategory)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listRoles(guild) {
  return [...guild.roles.cache.values()]
    .filter((r) => !r.managed && r.id !== guild.id)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Nombre visible; consulta Discord si el miembro no está en caché del bot. */
async function resolveDiscordLabel(guild, userId, cache = new Map()) {
  if (!userId) return null;
  const key = String(userId);
  if (cache.has(key)) return cache.get(key);

  const cached = guild.members.cache.get(key);
  if (cached) {
    const label =
      cached.displayName ||
      cached.user?.globalName ||
      cached.user?.username ||
      cached.user?.tag ||
      key;
    cache.set(key, label);
    return label;
  }

  let label = key;
  try {
    const member = await guild.members.fetch(key);
    label =
      member.displayName ||
      member.user?.globalName ||
      member.user?.username ||
      member.user?.tag ||
      key;
  } catch {
    try {
      const user = await guild.client.users.fetch(key);
      label = user.globalName || user.username || user.tag || key;
    } catch {
      /* ID sin acceso */
    }
  }
  cache.set(key, label);
  return label;
}

function canBotManageRole(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  const me = guild.members.me;
  if (!role || !me) return 'Rol no encontrado.';
  if (role.position >= me.roles.highest.position) return 'El bot no puede asignar ese rol (jerarquía).';
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return 'El bot no tiene permiso de gestionar roles.';
  return null;
}

const STATIC_EMOJI_LIMITS = [50, 100, 150, 250];

function sanitizeEmojiName(raw) {
  let n = String(raw || 'emoji')
    .replace(/\.[^.]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (n.length < 2) n = `e_${Date.now().toString(36).slice(-8)}`;
  return n.slice(0, 32);
}

function canBotManageEmojis(guild) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    return 'El bot no tiene permiso de gestionar emojis (Expresiones del servidor).';
  }
  return null;
}

function emojiQuota(guild) {
  const tier = Math.min(Math.max(guild.premiumTier ?? 0, 0), 3);
  const limit = STATIC_EMOJI_LIMITS[tier];
  const all = [...guild.emojis.cache.values()];
  return {
    staticCount: all.filter((e) => !e.animated).length,
    animatedCount: all.filter((e) => e.animated).length,
    staticLimit: limit,
    animatedLimit: limit,
    total: all.length,
  };
}

function mapGuildEmojis(guild) {
  return [...guild.emojis.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.imageURL({ size: 64 }),
    }));
}

function registroGuilds(getDb, discordGuildId) {
  return getDb()
    .prepare(`
      SELECT g.id, g.albion_guild_id, g.albion_guild_name, g.nickname_tag, g.role_id, g.alliance_id,
             g.registro_mode, a.albion_alliance_id, a.albion_alliance_name, a.albion_alliance_tag
      FROM registro_guilds g
      LEFT JOIN registro_alliances a ON g.alliance_id = a.id
      WHERE g.discord_guild_id = ?
      ORDER BY g.id ASC
    `)
    .all(gid(discordGuildId));
}

function registroPayload(getDb, discordGuildId) {
  const alliances = getDb()
    .prepare(
      'SELECT id, albion_alliance_id, albion_alliance_name, albion_alliance_tag FROM registro_alliances WHERE discord_guild_id = ? ORDER BY id ASC',
    )
    .all(gid(discordGuildId));
  const guilds = registroGuilds(getDb, discordGuildId);
  const principal = guilds.find((g) => g.registro_mode !== 'alliance') || null;
  const allianceGuilds = guilds.filter((g) => g.registro_mode === 'alliance');
  return { alliance: alliances[0] || null, alliances, principal, allianceGuilds };
}

async function upsertAlliance(getDb, discordGuildId, albionAllianceId) {
  const res = await albionAlliance(albionAllianceId);
  if (!res.ok) return { ok: false, error: 'ID de alianza inválido en Albion.' };
  const name = res.data?.Name || res.data?.AllianceName || 'Alianza';
  const tag = res.data?.Tag || res.data?.AllianceTag || '';
  getDb()
    .prepare(`
      INSERT INTO registro_alliances (discord_guild_id, albion_alliance_id, albion_alliance_name, albion_alliance_tag)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(discord_guild_id, albion_alliance_id) DO UPDATE SET
        albion_alliance_name = excluded.albion_alliance_name,
        albion_alliance_tag = excluded.albion_alliance_tag
    `)
    .run(gid(discordGuildId), albionAllianceId, name, tag);
  const row = getDb()
    .prepare('SELECT * FROM registro_alliances WHERE discord_guild_id = ? AND albion_alliance_id = ?')
    .get(gid(discordGuildId), albionAllianceId);
  return { ok: true, row };
}

function registerGuildConfigRoutes(app, { client, getDb, log, sessionAuth, assertGuildAccess }) {
  async function access(req, res) {
    const a = await assertGuildAccess(client, req.session, req.params.guildId, log);
    if (!a.ok) {
      res.status(a.status).json({ error: a.error });
      return null;
    }
    const guild = discordGuild(client, a.guildId);
    if (!guild) {
      res.status(400).json({ error: 'Servidor no disponible' });
      return null;
    }
    return { guildId: a.guildId, guild };
  }

  app.get('/api/guilds/:guildId/channels', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const memberStats = await resolveMemberStats(ctx.guild);
    res.json({ ok: true, channels: listTextChannels(ctx.guild), memberStats });
  });

  app.get('/api/guilds/:guildId/roles', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const memberStats = await resolveMemberStats(ctx.guild);
    res.json({ ok: true, roles: listRoles(ctx.guild), memberStats });
  });

  app.get('/api/guilds/:guildId/emojis', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    try {
      await ctx.guild.emojis.fetch();
    } catch {
      /* cache parcial */
    }
    const emojis = mapGuildEmojis(ctx.guild);
    res.json({ ok: true, emojis, count: emojis.length, quota: emojiQuota(ctx.guild) });
  });

  app.post('/api/guilds/:guildId/emojis', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const permErr = canBotManageEmojis(ctx.guild);
    if (permErr) return res.status(403).json({ error: permErr });

    const name = sanitizeEmojiName(req.body?.name);
    const b64 = String(req.body?.imageBase64 || '').trim();
    if (!b64) return res.status(400).json({ error: 'Imagen requerida' });

    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Imagen no válida' });
    }
    if (!buf.length) return res.status(400).json({ error: 'Imagen vacía' });
    if (buf.length > 256 * 1024) {
      return res.status(400).json({ error: 'La imagen no puede superar 256 KB (límite de Discord para emojis).' });
    }

    await ctx.guild.emojis.fetch().catch(() => {});
    const quota = emojiQuota(ctx.guild);
    const imageName = String(req.body?.imageName || '');
    const isAnimated = /\.gif$/i.test(imageName) || req.body?.animated === true;
    if (isAnimated && quota.animatedCount >= quota.animatedLimit) {
      return res.status(400).json({ error: `Límite de emojis animados alcanzado (${quota.animatedLimit}).` });
    }
    if (!isAnimated && quota.staticCount >= quota.staticLimit) {
      return res.status(400).json({ error: `Límite de emojis estáticos alcanzado (${quota.staticLimit}).` });
    }
    if (ctx.guild.emojis.cache.some((e) => e.name === name)) {
      return res.status(400).json({ error: `Ya existe un emoji llamado :${name}:` });
    }

    try {
      const emoji = await ctx.guild.emojis.create({ attachment: buf, name });
      res.json({
        ok: true,
        emoji: {
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated,
          url: emoji.imageURL({ size: 64 }),
        },
        quota: emojiQuota(ctx.guild),
      });
    } catch (e) {
      log.warn(`emoji create ${ctx.guildId}: ${e.message}`);
      res.status(400).json({ error: e.message || 'No se pudo crear el emoji' });
    }
  });

  app.delete('/api/guilds/:guildId/emojis/:emojiId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const permErr = canBotManageEmojis(ctx.guild);
    if (permErr) return res.status(403).json({ error: permErr });

    let emoji = ctx.guild.emojis.cache.get(gid(req.params.emojiId));
    if (!emoji) {
      try {
        emoji = await ctx.guild.emojis.fetch(gid(req.params.emojiId));
      } catch {
        emoji = null;
      }
    }
    if (!emoji) return res.status(404).json({ error: 'Emoji no encontrado' });

    try {
      await emoji.delete();
      res.json({ ok: true, quota: emojiQuota(ctx.guild) });
    } catch (e) {
      log.warn(`emoji delete ${ctx.guildId}: ${e.message}`);
      res.status(400).json({ error: e.message || 'No se pudo eliminar el emoji' });
    }
  });

  app.get('/api/guilds/:guildId/registro', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    res.json({ ok: true, ...registroPayload(getDb, ctx.guildId) });
  });

  app.post('/api/guilds/:guildId/registro/alliance', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const id = String(req.body?.albionAllianceId || '').trim();
    if (!id) return res.status(400).json({ error: 'Falta ID de alianza' });
    const up = await upsertAlliance(getDb, ctx.guildId, id);
    if (!up.ok) return res.status(400).json({ error: up.error });
    res.json({ ok: true, alliance: up.row });
  });

  app.post('/api/guilds/:guildId/registro/principal', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const { principal } = registroPayload(getDb, ctx.guildId);
    if (principal && !req.body?.replace) {
      return res.status(400).json({ error: 'Ya hay un gremio principal. Edítalo o elimínalo primero.' });
    }
    const albionGuildId = String(req.body?.albionGuildId || '').trim();
    const nicknameTag = String(req.body?.nicknameTag || '').trim();
    const roleId = String(req.body?.roleId || '').trim();
    if (!albionGuildId || !nicknameTag || !roleId) {
      return res.status(400).json({ error: 'Nombre/ID, tag y rol son obligatorios' });
    }
    const err = canBotManageRole(ctx.guild, roleId);
    if (err) return res.status(400).json({ error: err });
    const gRes = await albionGuild(albionGuildId);
    if (!gRes.ok) return res.status(400).json({ error: 'ID de gremio inválido en Albion.' });
    const gName = req.body?.guildName?.trim() || gRes.data?.Name || albionGuildId;
    if (principal) {
      getDb().prepare('DELETE FROM registro_users WHERE registro_guild_id = ?').run(principal.id);
      getDb().prepare('DELETE FROM registro_guilds WHERE id = ?').run(principal.id);
    }
    getDb()
      .prepare(`
        INSERT INTO registro_guilds (discord_guild_id, albion_guild_id, albion_guild_name, nickname_tag, role_id, alliance_id, registro_mode)
        VALUES (?, ?, ?, ?, ?, NULL, 'guild')
        ON CONFLICT(discord_guild_id, albion_guild_id) DO UPDATE SET
          nickname_tag = excluded.nickname_tag, role_id = excluded.role_id,
          albion_guild_name = excluded.albion_guild_name, registro_mode = 'guild', alliance_id = NULL
      `)
      .run(gid(ctx.guildId), albionGuildId, gName, nicknameTag, roleId);
    res.json({ ok: true, ...registroPayload(getDb, ctx.guildId) });
  });

  app.post('/api/guilds/:guildId/registro/alliance-guild', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const albionGuildId = String(req.body?.albionGuildId || '').trim();
    const nicknameTag = String(req.body?.nicknameTag || '').trim();
    const roleId = String(req.body?.roleId || '').trim();
    if (!albionGuildId || !nicknameTag || !roleId) {
      return res.status(400).json({ error: 'ID, tag y rol son obligatorios' });
    }
    const err = canBotManageRole(ctx.guild, roleId);
    if (err) return res.status(400).json({ error: err });
    const gRes = await albionGuild(albionGuildId);
    if (!gRes.ok) return res.status(400).json({ error: 'ID de gremio inválido en Albion.' });
    const gName = req.body?.guildName?.trim() || gRes.data?.Name || albionGuildId;
    const allianceAlbionId = gRes.data?.AllianceId;
    if (!allianceAlbionId) {
      return res.status(400).json({ error: 'Ese gremio no pertenece a una alianza en Albion.' });
    }
    const up = await upsertAlliance(getDb, ctx.guildId, String(allianceAlbionId));
    if (!up.ok) return res.status(400).json({ error: up.error });
    getDb()
      .prepare(`
        INSERT INTO registro_guilds (discord_guild_id, albion_guild_id, albion_guild_name, nickname_tag, role_id, alliance_id, registro_mode)
        VALUES (?, ?, ?, ?, ?, ?, 'alliance')
        ON CONFLICT(discord_guild_id, albion_guild_id) DO UPDATE SET
          nickname_tag = excluded.nickname_tag, role_id = excluded.role_id,
          albion_guild_name = excluded.albion_guild_name, alliance_id = excluded.alliance_id, registro_mode = 'alliance'
      `)
      .run(gid(ctx.guildId), albionGuildId, gName, nicknameTag, roleId, up.row.id);
    res.json({ ok: true, ...registroPayload(getDb, ctx.guildId) });
  });

  app.patch('/api/guilds/:guildId/registro/guilds/:rowId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const rowId = Number(req.params.rowId);
    const row = getDb()
      .prepare('SELECT * FROM registro_guilds WHERE id = ? AND discord_guild_id = ?')
      .get(rowId, gid(ctx.guildId));
    if (!row) return res.status(404).json({ error: 'Gremio no encontrado' });

    const nicknameTag = req.body?.nicknameTag != null ? String(req.body.nicknameTag).trim() : row.nickname_tag;
    const roleId = req.body?.roleId != null ? String(req.body.roleId).trim() : row.role_id;
    let albionGuildId = row.albion_guild_id;
    let gName = row.albion_guild_name;

    if (req.body?.albionGuildId) {
      albionGuildId = String(req.body.albionGuildId).trim();
      const gRes = await albionGuild(albionGuildId);
      if (!gRes.ok) return res.status(400).json({ error: 'ID de gremio inválido' });
      gName = req.body?.guildName?.trim() || gRes.data?.Name || albionGuildId;
    } else if (req.body?.guildName) {
      gName = String(req.body.guildName).trim();
    }

    if (roleId) {
      const err = canBotManageRole(ctx.guild, roleId);
      if (err) return res.status(400).json({ error: err });
    }

    getDb()
      .prepare(`
        UPDATE registro_guilds SET albion_guild_id = ?, albion_guild_name = ?, nickname_tag = ?, role_id = ?
        WHERE id = ? AND discord_guild_id = ?
      `)
      .run(albionGuildId, gName, nicknameTag, roleId, rowId, gid(ctx.guildId));
    res.json({ ok: true, ...registroPayload(getDb, ctx.guildId) });
  });

  app.delete('/api/guilds/:guildId/registro/guilds/:rowId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const rowId = Number(req.params.rowId);
    getDb().prepare('DELETE FROM registro_users WHERE registro_guild_id = ?').run(rowId);
    const r = getDb()
      .prepare('DELETE FROM registro_guilds WHERE id = ? AND discord_guild_id = ?')
      .run(rowId, gid(ctx.guildId));
    if (!r.changes) return res.status(404).json({ error: 'Gremio no encontrado' });
    res.json({ ok: true, ...registroPayload(getDb, ctx.guildId) });
  });

  app.get('/api/guilds/:guildId/kill/entities', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const entities = getDb()
      .prepare('SELECT * FROM kill_entities WHERE discord_guild_id = ? ORDER BY id ASC')
      .all(gid(ctx.guildId))
      .map((e) => ({
        id: e.id,
        name: e.name,
        albionEntityId: e.albion_entity_id,
        entityType: e.entity_type,
        killChannelId: e.kill_channel_id,
        deathChannelId: e.death_channel_id,
      }));
    res.json({ ok: true, entities });
  });

  app.post('/api/guilds/:guildId/kill/entities', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const name = String(req.body?.name || '').trim();
    const albionEntityId = String(req.body?.albionEntityId || '').trim();
    const killChannelId = String(req.body?.killChannelId || '').trim();
    const entityType = req.body?.entityType === 'player' ? 'player' : 'guild';
    if (!name || !albionEntityId || !killChannelId) {
      return res.status(400).json({ error: 'Nombre, ID y canal son obligatorios' });
    }
    const ch = ctx.guild.channels.cache.get(killChannelId);
    if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });
    const exists = getDb()
      .prepare(
        'SELECT 1 FROM kill_entities WHERE discord_guild_id = ? AND albion_entity_id = ? AND entity_type = ?',
      )
      .get(gid(ctx.guildId), albionEntityId, entityType);
    if (exists) return res.status(400).json({ error: 'Ya está en seguimiento' });
    const valid =
      entityType === 'guild'
        ? (await albionGuild(albionEntityId)).ok
        : (await albionPlayer(albionEntityId)).ok;
    if (!valid) return res.status(400).json({ error: 'ID inválido en Albion' });

    getDb()
      .prepare(`
        INSERT INTO kill_entities (
          discord_guild_id, entity_type, name, albion_entity_id,
          kill_channel_id, death_channel_id, last_death_event_ids
        ) VALUES (?, ?, ?, ?, ?, ?, '{}')
      `)
      .run(gid(ctx.guildId), entityType, name, albionEntityId, killChannelId, killChannelId);
    const entities = getDb()
      .prepare('SELECT * FROM kill_entities WHERE discord_guild_id = ? ORDER BY id DESC LIMIT 1')
      .get(gid(ctx.guildId));
    res.json({ ok: true, entity: entities });
  });

  app.patch('/api/guilds/:guildId/kill/entities/:id', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const id = Number(req.params.id);
    const row = getDb()
      .prepare('SELECT * FROM kill_entities WHERE id = ? AND discord_guild_id = ?')
      .get(id, gid(ctx.guildId));
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    const name = req.body?.name != null ? String(req.body.name).trim() : row.name;
    const albionEntityId =
      req.body?.albionEntityId != null ? String(req.body.albionEntityId).trim() : row.albion_entity_id;
    const killChannelId =
      req.body?.killChannelId != null ? String(req.body.killChannelId).trim() : row.kill_channel_id;
    const ch = ctx.guild.channels.cache.get(killChannelId);
    if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });
    getDb()
      .prepare(`
        UPDATE kill_entities SET name = ?, albion_entity_id = ?, kill_channel_id = ?, death_channel_id = ?
        WHERE id = ? AND discord_guild_id = ?
      `)
      .run(name, albionEntityId, killChannelId, killChannelId, id, gid(ctx.guildId));
    res.json({ ok: true });
  });

  app.delete('/api/guilds/:guildId/kill/entities/:id', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    getDb()
      .prepare('DELETE FROM kill_entities WHERE id = ? AND discord_guild_id = ?')
      .run(Number(req.params.id), gid(ctx.guildId));
    res.json({ ok: true });
  });

  app.get('/api/guilds/:guildId/kill/gucci', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const row = getDb()
      .prepare('SELECT * FROM gucci_kills_config WHERE discord_guild_id = ?')
      .get(gid(ctx.guildId));
    res.json({
      ok: true,
      config: row ? { channelId: row.channel_id, enabled: row.enabled === 1 } : null,
      minFame: GUCCI_MIN_FAME,
    });
  });

  app.put('/api/guilds/:guildId/kill/gucci', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const channelId = String(req.body?.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Canal requerido' });
    const ch = ctx.guild.channels.cache.get(channelId);
    if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });
    getDb()
      .prepare(`
        INSERT INTO gucci_kills_config (discord_guild_id, channel_id, enabled)
        VALUES (?, ?, 1)
        ON CONFLICT(discord_guild_id) DO UPDATE SET channel_id = excluded.channel_id, enabled = 1
      `)
      .run(gid(ctx.guildId), channelId);
    res.json({ ok: true, minFame: GUCCI_MIN_FAME });
  });

  app.delete('/api/guilds/:guildId/kill/gucci', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    getDb().prepare('DELETE FROM gucci_kills_config WHERE discord_guild_id = ?').run(gid(ctx.guildId));
    res.json({ ok: true });
  });

  app.get('/api/guilds/:guildId/battle/tracking', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const tracks = getDb()
      .prepare('SELECT * FROM battle_tracking WHERE discord_guild_id = ? ORDER BY id ASC')
      .all(gid(ctx.guildId))
      .map((t) => ({
        id: t.id,
        channelId: t.channel_id,
        albionGuildId: t.albion_guild_id,
        allianceId: t.alliance_id,
        allianceTag: t.alliance_tag,
        label: t.alliance_tag ? `${t.alliance_tag} (${t.albion_guild_id.slice(0, 8)}…)` : t.albion_guild_id,
      }));
    res.json({ ok: true, tracks });
  });

  app.post('/api/guilds/:guildId/battle/tracking', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const channelId = String(req.body?.channelId || '').trim();
    const albionInput = String(req.body?.albionGuildId || req.body?.albionId || '').trim();
    if (!channelId || !albionInput) {
      return res.status(400).json({ error: 'Canal e ID del gremio son obligatorios' });
    }
    const ch = ctx.guild.channels.cache.get(channelId);
    if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });

    const resolved = await resolveGuildBattleInput(albionInput);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const dup = getDb()
      .prepare('SELECT 1 FROM battle_tracking WHERE discord_guild_id = ? AND albion_guild_id = ?')
      .get(gid(ctx.guildId), resolved.albionGuildId);
    if (dup) return res.status(400).json({ error: 'Ese gremio ya está en seguimiento' });

    const r = getDb()
      .prepare(`
        INSERT INTO battle_tracking (
          discord_guild_id, track_type, channel_id, albion_guild_id, alliance_id, alliance_tag, sent_battles
        ) VALUES (?, 'guild', ?, ?, ?, ?, '[]')
      `)
      .run(
        gid(ctx.guildId),
        channelId,
        resolved.albionGuildId,
        resolved.allianceId,
        resolved.allianceTag,
      );
    await seedBattles(getDb, r.lastInsertRowid, resolved, log);
    res.json({
      ok: true,
      track: {
        id: r.lastInsertRowid,
        label: resolved.guildName,
        allianceTag: resolved.allianceTag,
      },
    });
  });

  app.patch('/api/guilds/:guildId/battle/tracking/:id', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const id = Number(req.params.id);
    const row = getDb()
      .prepare('SELECT * FROM battle_tracking WHERE id = ? AND discord_guild_id = ?')
      .get(id, gid(ctx.guildId));
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    const channelId = req.body?.channelId != null ? String(req.body.channelId).trim() : row.channel_id;
    const ch = ctx.guild.channels.cache.get(channelId);
    if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });

    if (req.body?.albionGuildId != null || req.body?.albionId != null) {
      const albionInput = String(req.body?.albionGuildId ?? req.body?.albionId ?? '').trim();
      const resolved = await resolveGuildBattleInput(albionInput);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      getDb()
        .prepare(`
          UPDATE battle_tracking SET channel_id = ?, albion_guild_id = ?, alliance_id = ?, alliance_tag = ?, track_type = 'guild'
          WHERE id = ?
        `)
        .run(
          channelId,
          resolved.albionGuildId,
          resolved.allianceId,
          resolved.allianceTag,
          id,
        );
    } else {
      getDb()
        .prepare('UPDATE battle_tracking SET channel_id = ? WHERE id = ?')
        .run(channelId, id);
    }
    res.json({ ok: true });
  });

  app.delete('/api/guilds/:guildId/battle/tracking/:id', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    getDb()
      .prepare('DELETE FROM battle_tracking WHERE id = ? AND discord_guild_id = ?')
      .run(Number(req.params.id), gid(ctx.guildId));
    res.json({ ok: true });
  });

  app.get('/api/guilds/:guildId/logs', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const row = getDb()
      .prepare('SELECT logs_channel_id, logs_paused FROM logs_config WHERE guild_id = ?')
      .get(gid(ctx.guildId));
    res.json({
      ok: true,
      channelId: row?.logs_channel_id ?? null,
      paused: Boolean(row?.logs_paused),
    });
  });

  app.patch('/api/guilds/:guildId/logs', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const row = getDb()
      .prepare('SELECT logs_channel_id, logs_paused FROM logs_config WHERE guild_id = ?')
      .get(gid(ctx.guildId));
    const channelId =
      req.body?.channelId != null ? String(req.body.channelId).trim() : row?.logs_channel_id ?? null;
    const paused = req.body?.paused != null ? (req.body.paused ? 1 : 0) : row?.logs_paused ? 1 : 0;
    if (channelId) {
      const ch = ctx.guild.channels.cache.get(channelId);
      if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });
    }
    getDb()
      .prepare(`
        INSERT INTO logs_config (guild_id, logs_channel_id, logs_paused) VALUES (?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET logs_channel_id = excluded.logs_channel_id, logs_paused = excluded.logs_paused
      `)
      .run(gid(ctx.guildId), channelId, paused);
    res.json({ ok: true, channelId, paused: Boolean(paused) });
  });

  app.get('/api/guilds/:guildId/voice-channels', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    res.json({ ok: true, channels: listVoiceChannels(ctx.guild) });
  });

  app.get('/api/guilds/:guildId/member-stats', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    try {
      const stats = await resolveMemberStats(ctx.guild);
      res.json({ ok: true, ...stats });
    } catch (e) {
      log.warn(`member-stats ${ctx.guildId}: ${e.message}`);
      res.status(500).json({ error: 'No se pudieron cargar las estadísticas de miembros' });
    }
  });

  app.get('/api/guilds/:guildId/members', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const q = String(req.query.q || '').trim().toLowerCase();

    try {
      if (q.length >= 2) {
        await ctx.guild.members.fetch({ query: q, limit: 100 });
      } else if (ctx.guild.members.cache.size < Math.min(ctx.guild.memberCount, 100)) {
        await ctx.guild.members.fetch({ limit: 100 }).catch(() => {});
      }
    } catch {
      /* cache parcial */
    }

    let members = [...ctx.guild.members.cache.values()]
      .filter((m) => !m.user.bot)
      .map((m) => ({
        id: m.id,
        username: m.user.tag,
        displayName: m.displayName,
        globalName: m.user.globalName || '',
      }));

    if (q) {
      members = members.filter((m) => {
        const fields = [m.username, m.displayName, m.globalName, m.id]
          .filter(Boolean)
          .map((s) => String(s).toLowerCase());
        return fields.some((s) => s.includes(q));
      });
      members.sort((a, b) => {
        const rank = (m) => {
          const names = [m.displayName, m.globalName, m.username]
            .filter(Boolean)
            .map((s) => String(s).toLowerCase());
          if (names.some((n) => n.startsWith(q))) return 0;
          if (names.some((n) => n.includes(q))) return 1;
          return 2;
        };
        return rank(a) - rank(b);
      });
    }

    res.json({ ok: true, members: members.slice(0, 20) });
  });

  app.get('/api/guilds/:guildId/categories', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    res.json({ ok: true, categories: listCategories(ctx.guild) });
  });

  app.get('/api/guilds/:guildId/utc', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const clocks = await listUtcClocksInGuild(client, getDb, ctx.guildId);
    const row = getUtcClock(getDb, ctx.guildId);
    res.json({
      ok: true,
      channelId: row?.channel_id ?? clocks[0]?.channelId ?? null,
      clocks,
      renameMinutes: UTC_TICK_MS / 60000,
    });
  });

  app.patch('/api/guilds/:guildId/utc', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    if (req.body?.create === true) {
      const categoryId = req.body?.categoryId ? String(req.body.categoryId).trim() : null;
      try {
        const result = await setupUtcInGuild(client, getDb, ctx.guildId, log, { categoryId });
        return res.json({ ok: true, channelId: result.channelId });
      } catch (e) {
        return res.status(400).json({ error: e.message || 'No se pudo crear el reloj UTC' });
      }
    }

    const channelId = req.body?.channelId ? String(req.body.channelId).trim() : null;
    const removed = await removeUtcFromGuild(client, getDb, gid(ctx.guildId), log, channelId);
    if (channelId && !removed) {
      return res.status(404).json({ error: 'Reloj no encontrado' });
    }
    res.json({ ok: true, channelId: null, removed });
  });

  app.get('/api/guilds/:guildId/sanciones', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const cfg = getSancionesConfig(getDb, ctx.guildId);
    const nameCache = new Map();
    const records = await Promise.all(
      listSancionRecords(getDb, ctx.guildId).map(async (r) => ({
        userId: r.user_id,
        username: await resolveDiscordLabel(ctx.guild, r.user_id, nameCache),
        strikes: r.strikes,
        multas: r.multas,
      })),
    );
    const logRows = await Promise.all(
      listSancionLog(getDb, ctx.guildId, 40).map(async (row) => ({
        id: row.id,
        userId: row.user_id,
        username: await resolveDiscordLabel(ctx.guild, row.user_id, nameCache),
        action: row.action,
        tipo: row.tipo,
        amount: row.amount,
        reason: row.reason,
        moderator: row.moderator_id
          ? await resolveDiscordLabel(ctx.guild, row.moderator_id, nameCache)
          : null,
        createdAt: row.created_at,
      })),
    );
    res.json({
      ok: true,
      channelId: cfg.channelId,
      maxStrikes: MAX_STRIKES,
      records,
      log: logRows,
    });
  });

  app.patch('/api/guilds/:guildId/sanciones', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const channelId =
      req.body?.channelId != null ? String(req.body.channelId).trim() : null;
    if (channelId) {
      const ch = ctx.guild.channels.cache.get(channelId);
      if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });
    }
    setSancionesChannel(getDb, ctx.guildId, channelId);
    res.json({ ok: true, channelId });
  });

  app.patch('/api/guilds/:guildId/sanciones/users/:userId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const userId = gid(req.params.userId);
    const strikes = Number(req.body?.strikes);
    const multas = Number(req.body?.multas);
    const reason = String(req.body?.reason || req.body?.razon || 'Ajuste desde el dashboard').trim();
    if (!Number.isFinite(strikes) || !Number.isFinite(multas)) {
      return res.status(400).json({ error: 'Strikes y multas deben ser números' });
    }
    if (strikes < 0 || strikes > MAX_STRIKES || multas < 0) {
      return res.status(400).json({ error: `Valores inválidos (strikes 0-${MAX_STRIKES})` });
    }

    const channel = getNotifyChannel(ctx.guild, getDb);
    if (!channel) {
      return res.status(400).json({ error: 'Configura el canal de infracciones primero' });
    }

    const member = await ctx.guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(400).json({ error: 'Miembro no encontrado' });

    const oldRecord = getSancionRecord(getDb, userId, ctx.guildId);
    if (oldRecord.strikes === strikes && oldRecord.multas === multas) {
      return res.json({ ok: true, userId, strikes, multas, unchanged: true });
    }

    try {
      await syncRecordChanges({
        getDb,
        guild: ctx.guild,
        channel,
        member,
        oldRecord,
        newStrikes: strikes,
        newMultas: multas,
        moderatorId: req.session.user_id,
        reason,
      });
      const updated = getSancionRecord(getDb, userId, ctx.guildId);
      res.json({ ok: true, userId, strikes: updated.strikes, multas: updated.multas });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo actualizar' });
    }
  });

  app.post('/api/guilds/:guildId/sanciones/aplicar', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const userId = gid(req.body?.userId || '');
    const tipo = req.body?.tipo === 'multa' ? 'multa' : 'strike';
    const cantidad = Number(req.body?.cantidad);
    const razon = String(req.body?.razon || req.body?.reason || '').trim();
    if (!userId) return res.status(400).json({ error: 'Usuario requerido' });
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
    if (!razon) return res.status(400).json({ error: 'Razón requerida' });

    const channel = getNotifyChannel(ctx.guild, getDb);
    if (!channel) {
      return res.status(400).json({ error: 'Configura el canal de infracciones primero' });
    }

    const member = await ctx.guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(400).json({ error: 'Miembro no encontrado' });

    try {
      const result = await applyInfraccion({
        getDb,
        guild: ctx.guild,
        channel,
        usuario: member,
        tipo,
        cantidad,
        razon,
        moderatorId: req.session.user_id,
      });
      res.json({ ok: true, userId, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo aplicar' });
    }
  });

  app.post('/api/guilds/:guildId/sanciones/quitar', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const userId = gid(req.body?.userId || '');
    const tipo = req.body?.tipo === 'multa' ? 'multa' : 'strike';
    const cantidad = Number(req.body?.cantidad);
    if (!userId) return res.status(400).json({ error: 'Usuario requerido' });
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }

    const channel = getNotifyChannel(ctx.guild, getDb);
    if (!channel) {
      return res.status(400).json({ error: 'Configura el canal de infracciones primero' });
    }

    const member = await ctx.guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(400).json({ error: 'Miembro no encontrado' });

    try {
      const result = await removeInfraccion({
        getDb,
        guild: ctx.guild,
        channel,
        usuario: member,
        tipo,
        cantidad,
        moderatorId: req.session.user_id,
      });
      res.json({ ok: true, userId, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo quitar' });
    }
  });

  app.delete('/api/guilds/:guildId/sanciones/users/:userId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const userId = gid(req.params.userId);
    const channel = getNotifyChannel(ctx.guild, getDb);
    if (!channel) {
      return res.status(400).json({ error: 'Configura el canal de infracciones primero' });
    }
    const member = await ctx.guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(400).json({ error: 'Miembro no encontrado' });
    try {
      await clearRecordWithNotify({
        getDb,
        guild: ctx.guild,
        channel,
        member,
        moderatorId: req.session.user_id,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo limpiar' });
    }
  });

  app.get('/api/guilds/:guildId/eventos', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const events = listGuildEvents(ctx.guildId).map((e) => ({
      messageId: e.messageId,
      name: e.name,
      time: e.ev.time,
      location: e.ev.location,
      channelId: e.ev.channel_id,
      voiceChannelId: e.ev.voice_channel_id,
    }));
    res.json({ ok: true, events });
  });

  app.get('/api/guilds/:guildId/eventos/:messageId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const ev = getGuildEvent(ctx.guildId, req.params.messageId);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ ok: true, event: eventToDashboardPayload(ev) });
  });

  app.post('/api/guilds/:guildId/eventos', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const channelId = String(req.body?.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Canal de publicación requerido' });
    const ch = ctx.guild.channels.cache.get(channelId);
    if (!ch?.isTextBased()) return res.status(400).json({ error: 'Canal no válido' });
    if (req.body?.voiceChannelId) {
      const vc = ctx.guild.channels.cache.get(String(req.body.voiceChannelId));
      if (!vc || vc.type !== ChannelType.GuildVoice) {
        return res.status(400).json({ error: 'Canal de voz no válido' });
      }
    }
    try {
      const msg = await createEventFromDashboard(
        client,
        getDb,
        ctx.guild,
        channelId,
        req.body,
        req.session.username || 'Dashboard',
      );
      res.json({ ok: true, messageId: msg.id, channelId: msg.channelId });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo crear el evento' });
    }
  });

  app.patch('/api/guilds/:guildId/eventos/:messageId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (req.body?.voiceChannelId) {
      const vc = ctx.guild.channels.cache.get(String(req.body.voiceChannelId));
      if (!vc || vc.type !== ChannelType.GuildVoice) {
        return res.status(400).json({ error: 'Canal de voz no válido' });
      }
    }
    try {
      const msg = await updateEventFromDashboard(
        client,
        getDb,
        ctx.guild,
        req.params.messageId,
        req.body,
      );
      res.json({ ok: true, messageId: msg.id, channelId: msg.channelId });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo actualizar el evento' });
    }
  });

  app.delete('/api/guilds/:guildId/eventos/:messageId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    try {
      await deleteEventFromDashboard(client, getDb, ctx.guildId, req.params.messageId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo eliminar el evento' });
    }
  });

  const HUB_NAME_VOCES = '➕ Crear canal';

  function hubToJson(hub, guild) {
    const ch = hub.hubChannelId ? guild.channels.cache.get(hub.hubChannelId) : null;
    const cat = hub.categoryId ? guild.channels.cache.get(hub.categoryId) : null;
    const activeTempChannels =
      getDb()
        .prepare('SELECT COUNT(*) AS n FROM voces_temp_channels WHERE hub_id = ?')
        .get(hub.id)?.n ?? 0;
    return {
      id: hub.id,
      hubChannelId: hub.hubChannelId,
      hubName: ch?.name ?? HUB_NAME_VOCES,
      categoryId: hub.categoryId,
      categoryName: cat?.name ?? null,
      namingMode: hub.namingMode,
      allowedRoleIds: hub.allowedRoleIds,
      enabled: hub.enabled,
      sequenceCounter: hub.sequenceCounter,
      activeTempChannels,
    };
  }

  app.get('/api/guilds/:guildId/voces', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const hubs = listHubs(getDb, ctx.guildId).map((h) => hubToJson(h, ctx.guild));
    res.json({ ok: true, hubs });
  });

  app.post('/api/guilds/:guildId/voces', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const categoryId = req.body?.categoryId ? String(req.body.categoryId).trim() : null;
    const namingMode = req.body?.namingMode === 'sequence' ? 'sequence' : 'username';
    let allowedRoleIds = req.body?.allowedRoleIds;
    if (!Array.isArray(allowedRoleIds)) allowedRoleIds = [];
    allowedRoleIds = [...new Set(allowedRoleIds.map(String).filter(Boolean))];

    if (!categoryId) {
      return res.status(400).json({ error: 'La categoría es obligatoria' });
    }

    const cat = ctx.guild.channels.cache.get(categoryId);
    if (!cat || cat.type !== ChannelType.GuildCategory) {
      return res.status(400).json({ error: 'Categoría no válida' });
    }

    for (const rid of allowedRoleIds) {
      const err = canBotManageRole(ctx.guild, rid);
      if (err) return res.status(400).json({ error: err });
    }

    try {
      const hub = await createHub(client, getDb, ctx.guildId, log, {
        categoryId,
        namingMode,
        allowedRoleIds,
        enabled: req.body?.enabled !== false,
      });
      res.json({ ok: true, hub: hubToJson(hub, ctx.guild) });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo crear el hub' });
    }
  });

  app.patch('/api/guilds/:guildId/voces/:hubId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const hubId = Number(req.params.hubId);
    const prev = getHubById(getDb, hubId);
    if (!prev || String(prev.guildId) !== String(ctx.guildId)) {
      return res.status(404).json({ error: 'Hub no encontrado' });
    }

    if (req.body?.enabled === false && !req.body?.categoryId) {
      try {
        const hub = await updateHub(client, getDb, ctx.guildId, hubId, log, { enabled: false });
        return res.json({ ok: true, hub: hubToJson(hub, ctx.guild) });
      } catch (e) {
        return res.status(400).json({ error: e.message || 'No se pudo desactivar el hub' });
      }
    }

    const categoryId = req.body?.categoryId ? String(req.body.categoryId).trim() : prev.categoryId;
    const namingMode =
      req.body?.namingMode === 'sequence'
        ? 'sequence'
        : req.body?.namingMode === 'username'
          ? 'username'
          : prev.namingMode;
    let allowedRoleIds = req.body?.allowedRoleIds;
    if (!Array.isArray(allowedRoleIds)) allowedRoleIds = prev.allowedRoleIds;
    allowedRoleIds = [...new Set(allowedRoleIds.map(String).filter(Boolean))];

    const cat = ctx.guild.channels.cache.get(categoryId);
    if (!cat || cat.type !== ChannelType.GuildCategory) {
      return res.status(400).json({ error: 'Categoría no válida' });
    }

    for (const rid of allowedRoleIds) {
      const err = canBotManageRole(ctx.guild, rid);
      if (err) return res.status(400).json({ error: err });
    }

    try {
      const hub = await updateHub(client, getDb, ctx.guildId, hubId, log, {
        categoryId,
        namingMode,
        allowedRoleIds,
        enabled: req.body?.enabled !== false,
      });
      res.json({ ok: true, hub: hubToJson(hub, ctx.guild) });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo actualizar el hub' });
    }
  });

  app.delete('/api/guilds/:guildId/voces/:hubId', sessionAuth, async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const hubId = Number(req.params.hubId);
    const prev = getHubById(getDb, hubId);
    if (!prev || String(prev.guildId) !== String(ctx.guildId)) {
      return res.status(404).json({ error: 'Hub no encontrado' });
    }

    try {
      await deleteHub(client, getDb, ctx.guildId, hubId, log);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo eliminar el hub' });
    }
  });
}

module.exports = { registerGuildConfigRoutes };
