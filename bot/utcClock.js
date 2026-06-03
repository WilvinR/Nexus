const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const UTC_TICK_MS = 30_000;

function utcTimeString() {
  return new Date().toISOString().slice(11, 19);
}

function utcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function buildUtcClockEmbed() {
  return new EmbedBuilder()
    .setTitle('🕐 Reloj UTC')
    .setDescription(`# ${utcTimeString()}\nReferencia horaria para **Albion Online** y eventos del gremio.`)
    .setColor(0x00e5ff)
    .setFooter({ text: `Nexus · ${utcDateString()} UTC · Actualización automática` });
}

function getUtcClock(getDb, guildId) {
  return getDb()
    .prepare('SELECT channel_id, message_id FROM utc_clock WHERE guild_id = ?')
    .get(String(guildId));
}

function saveUtcClock(getDb, guildId, channelId, messageId) {
  getDb()
    .prepare(`
      INSERT INTO utc_clock (guild_id, channel_id, message_id) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id
    `)
    .run(String(guildId), String(channelId), String(messageId));
}

function clearUtcClock(getDb, guildId) {
  getDb().prepare('DELETE FROM utc_clock WHERE guild_id = ?').run(String(guildId));
}

async function deleteUtcMessage(client, row) {
  if (!row) return;
  try {
    const ch = await client.channels.fetch(row.channel_id).catch(() => null);
    if (ch?.isTextBased()) {
      const msg = await ch.messages.fetch(row.message_id).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

async function refreshUtcClock(client, getDb, guildId, log) {
  const row = getUtcClock(getDb, guildId);
  if (!row) return;

  const ch = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!ch?.isTextBased()) {
    clearUtcClock(getDb, guildId);
    return;
  }

  const embed = buildUtcClockEmbed();
  try {
    const msg = await ch.messages.fetch(row.message_id).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed] });
      return;
    }
    const sent = await ch.send({ embeds: [embed] });
    saveUtcClock(getDb, guildId, ch.id, sent.id);
    await sent.pin().catch(() => {});
  } catch (e) {
    log.warn(`UTC clock ${guildId}: ${e.message}`);
    try {
      const sent = await ch.send({ embeds: [embed] });
      saveUtcClock(getDb, guildId, ch.id, sent.id);
      await sent.pin().catch(() => {});
    } catch (e2) {
      log.warn(`UTC clock recreate ${guildId}: ${e2.message}`);
    }
  }
}

async function tickAllUtcClocks(client, getDb, log) {
  const rows = getDb().prepare('SELECT guild_id FROM utc_clock').all();
  for (const r of rows) {
    await refreshUtcClock(client, getDb, r.guild_id, log);
  }
}

async function setupUtcInGuild(client, getDb, guildId, channelId, log) {
  const gid = String(guildId);
  const ch = await client.channels.fetch(String(channelId)).catch(() => null);
  if (!ch?.isTextBased()) throw new Error('Canal no válido');

  const guild = ch.guild;
  const me = guild?.members?.me;
  if (!me?.permissionsIn(ch).has(PermissionFlagsBits.SendMessages)) {
    throw new Error('El bot no puede enviar mensajes en ese canal');
  }

  const prev = getUtcClock(getDb, gid);
  if (prev && prev.channel_id !== ch.id) {
    await deleteUtcMessage(client, prev);
  } else if (prev?.message_id) {
    await deleteUtcMessage(client, prev);
  }

  const embed = buildUtcClockEmbed();
  const sent = await ch.send({ embeds: [embed] });
  saveUtcClock(getDb, gid, ch.id, sent.id);

  if (me.permissionsIn(ch).has(PermissionFlagsBits.ManageMessages)) {
    await sent.pin().catch(() => {});
  }

  log.info(`UTC clock activado en ${guild.name} (#${ch.name})`);
  return { channelId: ch.id, messageId: sent.id };
}

async function removeUtcFromGuild(client, getDb, guildId, log) {
  const row = getUtcClock(getDb, guildId);
  if (!row) return false;
  await deleteUtcMessage(client, row);
  clearUtcClock(getDb, guildId);
  log.info(`UTC clock quitado en guild ${guildId}`);
  return true;
}

async function setupUtcChannel(ix, { getDb, log }) {
  const channel = ix.channel;
  if (!channel?.isTextBased()) {
    return ix.reply({ content: '❌ Usa este comando en un canal de texto.', ephemeral: true });
  }
  try {
    await setupUtcInGuild(ix.client, getDb, ix.guildId, channel.id, log);
    await ix.reply({
      content: `✅ Reloj UTC activo en ${channel}. Se actualiza cada ${UTC_TICK_MS / 1000} segundos.`,
      ephemeral: true,
    });
  } catch (e) {
    await ix.reply({ content: `❌ ${e.message}`, ephemeral: true });
  }
}

module.exports = {
  UTC_TICK_MS,
  utcTimeString,
  buildUtcClockEmbed,
  getUtcClock,
  setupUtcInGuild,
  removeUtcFromGuild,
  setupUtcChannel,
  refreshUtcClock,
  tickAllUtcClocks,
  deleteUtcMessage,
  clearUtcClock,
};
