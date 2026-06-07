const { ChannelType, PermissionFlagsBits } = require('discord.js');

/** Discord permite ~2 cambios de nombre por canal cada 10 minutos. */
const UTC_RENAME_MS = 10 * 60 * 1000;

function utcTimeString() {
  return new Date().toISOString().slice(11, 19);
}

function formatUtcVoiceChannelName(withSeconds = false) {
  const iso = new Date().toISOString();
  const time = withSeconds ? iso.slice(11, 19) : iso.slice(11, 16);
  return `🕐 ${time} UTC`;
}

function getUtcClock(getDb, guildId) {
  return getDb()
    .prepare('SELECT channel_id, message_id FROM utc_clock WHERE guild_id = ?')
    .get(String(guildId));
}

function saveUtcClock(getDb, guildId, channelId) {
  getDb()
    .prepare(`
      INSERT INTO utc_clock (guild_id, channel_id, message_id) VALUES (?, ?, 'voice')
      ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = 'voice'
    `)
    .run(String(guildId), String(channelId));
}

function clearUtcClock(getDb, guildId) {
  getDb().prepare('DELETE FROM utc_clock WHERE guild_id = ?').run(String(guildId));
}

async function deleteUtcChannel(client, row) {
  if (!row?.channel_id) return;
  try {
    const ch = await client.channels.fetch(row.channel_id).catch(() => null);
    if (ch) await ch.delete().catch(() => {});
  } catch {
    /* ignore */
  }
}

function isUtcClockChannelName(name) {
  return /^🕐\s+\d{2}:\d{2}(:\d{2})?\s+UTC$/i.test(String(name || '').trim());
}

function scanUtcClockChannels(guild) {
  if (!guild?.channels?.cache) return [];
  return guild.channels.cache
    .filter((ch) => ch.type === ChannelType.GuildVoice && isUtcClockChannelName(ch.name))
    .map((ch) => ({ channelId: ch.id, channelName: ch.name }))
    .sort((a, b) => a.channelName.localeCompare(b.channelName));
}

async function listUtcClocksInGuild(client, getDb, guildId) {
  const gid = String(guildId);
  const guild = await client.guilds.fetch(gid).catch(() => null);
  if (!guild) return [];

  const tracked = getUtcClock(getDb, gid);
  const byId = new Map();

  for (const ch of scanUtcClockChannels(guild)) {
    byId.set(ch.channelId, {
      channelId: ch.channelId,
      channelName: ch.channelName,
      tracked: tracked?.channel_id === ch.channelId,
    });
  }

  if (tracked?.channel_id && !byId.has(tracked.channel_id)) {
    const ch = await client.channels.fetch(tracked.channel_id).catch(() => null);
    byId.set(tracked.channel_id, {
      channelId: tracked.channel_id,
      channelName: ch?.name || `Canal ${tracked.channel_id}`,
      tracked: true,
      missing: !ch,
    });
  }

  return [...byId.values()];
}

async function removeUtcChannelById(client, getDb, guildId, channelId, log) {
  const gid = String(guildId);
  const cid = String(channelId);
  const row = getUtcClock(getDb, gid);

  if (row?.channel_id === cid) {
    await deleteUtcChannel(client, row);
    clearUtcClock(getDb, gid);
    log.info(`UTC voice clock quitado en guild ${gid}`);
    return true;
  }

  const ch = await client.channels.fetch(cid).catch(() => null);
  if (!ch || ch.guildId !== gid) return false;
  await ch.delete().catch(() => {});
  log.info(`UTC reloj huérfano eliminado ${cid} en guild ${gid}`);
  return true;
}

async function removeAllUtcClocksFromGuild(client, getDb, guildId, log) {
  const clocks = await listUtcClocksInGuild(client, getDb, guildId);
  if (!clocks.length) return 0;
  let n = 0;
  for (const c of clocks) {
    if (await removeUtcChannelById(client, getDb, guildId, c.channelId, log)) n += 1;
  }
  clearUtcClock(getDb, String(guildId));
  return n;
}

async function refreshUtcClock(client, getDb, guildId, log) {
  const row = getUtcClock(getDb, guildId);
  if (!row) return;

  const ch = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildVoice) {
    clearUtcClock(getDb, guildId);
    return;
  }

  const newName = formatUtcVoiceChannelName(false);
  if (ch.name === newName) return;

  try {
    await ch.setName(newName);
  } catch (e) {
    const msg = e.message || String(e);
    if (e.status === 429 || e.code === 50035 || /rate/i.test(msg)) {
      log.warn(`UTC rename (rate limit) ${guildId}: ${msg}`);
    } else {
      log.warn(`UTC rename ${guildId}: ${msg}`);
    }
  }
}

async function tickAllUtcClocks(client, getDb, log) {
  const rows = getDb().prepare('SELECT guild_id FROM utc_clock').all();
  for (const r of rows) {
    await refreshUtcClock(client, getDb, r.guild_id, log);
  }
}

async function setupUtcInGuild(client, getDb, guildId, log, { categoryId } = {}) {
  const gid = String(guildId);
  const guild = await client.guilds.fetch(gid).catch(() => null);
  if (!guild) throw new Error('Servidor no encontrado');

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('El bot necesita permiso de Gestionar canales');
  }

  const prev = getUtcClock(getDb, gid);
  if (prev) await deleteUtcChannel(client, prev);

  const parent =
    categoryId && guild.channels.cache.get(String(categoryId))?.type === ChannelType.GuildCategory
      ? String(categoryId)
      : null;

  const channel = await guild.channels.create({
    name: formatUtcVoiceChannelName(true),
    type: ChannelType.GuildVoice,
    parent,
    reason: 'Nexus — reloj UTC Albion',
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.Connect],
        allow: [PermissionFlagsBits.ViewChannel],
      },
    ],
  });

  saveUtcClock(getDb, gid, channel.id);
  log.info(`UTC voice clock creado en ${guild.name} (${channel.name})`);
  return { channelId: channel.id };
}

async function removeUtcFromGuild(client, getDb, guildId, log, channelId = null) {
  if (channelId) {
    return removeUtcChannelById(client, getDb, guildId, channelId, log);
  }
  const removed = await removeAllUtcClocksFromGuild(client, getDb, guildId, log);
  return removed > 0;
}

async function setupUtcChannel(ix, { getDb, log }) {
  try {
    const parentId = ix.channel?.parentId || null;
    const { channelId } = await setupUtcInGuild(ix.client, getDb, ix.guildId, log, {
      categoryId: parentId,
    });
    const ch = await ix.client.channels.fetch(channelId);
    await ix.reply({
      content:
        `✅ Canal de voz **${ch.name}** creado.\n` +
        `El nombre se actualiza cada ${UTC_RENAME_MS / 60000} min (límite de Discord).`,
      ephemeral: true,
    });
  } catch (e) {
    await ix.reply({ content: `❌ ${e.message}`, ephemeral: true });
  }
}

module.exports = {
  UTC_TICK_MS: UTC_RENAME_MS,
  UTC_RENAME_MS,
  utcTimeString,
  formatUtcVoiceChannelName,
  getUtcClock,
  isUtcClockChannelName,
  scanUtcClockChannels,
  listUtcClocksInGuild,
  removeUtcChannelById,
  removeAllUtcClocksFromGuild,
  setupUtcInGuild,
  removeUtcFromGuild,
  setupUtcChannel,
  refreshUtcClock,
  tickAllUtcClocks,
  clearUtcClock,
};
