const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const MAX_STRIKES = 3;

function gid(id) {
  return String(id);
}

function getConfig(getDb, guildId) {
  const row = getDb()
    .prepare('SELECT channel_id FROM sanciones_config WHERE guild_id = ?')
    .get(gid(guildId));
  return { channelId: row?.channel_id ?? null };
}

function setChannel(getDb, guildId, channelId) {
  getDb()
    .prepare(`
      INSERT INTO sanciones_config (guild_id, channel_id) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
    `)
    .run(gid(guildId), channelId ? gid(channelId) : null);
}

function getRecord(getDb, userId, guildId) {
  const uid = gid(userId);
  const g = gid(guildId);
  let row = getDb()
    .prepare('SELECT strikes, multas FROM sanciones_records WHERE user_id = ? AND guild_id = ?')
    .get(uid, g);
  if (!row) {
    getDb()
      .prepare('INSERT INTO sanciones_records (user_id, guild_id, strikes, multas) VALUES (?, ?, 0, 0)')
      .run(uid, g);
    return { strikes: 0, multas: 0 };
  }
  return { strikes: row.strikes, multas: row.multas };
}

function updateRecord(getDb, userId, guildId, strikes, multas) {
  getRecord(getDb, userId, guildId);
  getDb()
    .prepare(
      'UPDATE sanciones_records SET strikes = ?, multas = ? WHERE user_id = ? AND guild_id = ?',
    )
    .run(strikes, multas, gid(userId), gid(guildId));
}

function appendLog(getDb, { guildId, userId, action, tipo, amount, reason, moderatorId }) {
  getDb()
    .prepare(`
      INSERT INTO sanciones_log (guild_id, user_id, action, tipo, amount, reason, moderator_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      gid(guildId),
      gid(userId),
      action,
      tipo,
      amount,
      reason || null,
      moderatorId ? gid(moderatorId) : null,
      Date.now(),
    );
}

function listRecords(getDb, guildId) {
  return getDb()
    .prepare(`
      SELECT user_id, strikes, multas FROM sanciones_records
      WHERE guild_id = ? AND (strikes > 0 OR multas > 0)
      ORDER BY strikes DESC, multas DESC
    `)
    .all(gid(guildId));
}

function listLog(getDb, guildId, limit = 50) {
  return getDb()
    .prepare(`
      SELECT * FROM sanciones_log WHERE guild_id = ?
      ORDER BY created_at DESC LIMIT ?
    `)
    .all(gid(guildId), limit);
}

function isModerator(member) {
  const perms = member?.permissions;
  return perms?.has(PermissionFlagsBits.Administrator) || perms?.has(PermissionFlagsBits.ModerateMembers);
}

async function resolveChannel(guild, getDb, replyFn) {
  const cfg = getConfig(getDb, guild.id);
  if (!cfg.channelId) {
    await replyFn('❌ No hay un canal configurado. Configúralo en el Dashboard o con `/config_canal`.');
    return null;
  }
  const ch = guild.channels.cache.get(cfg.channelId);
  if (!ch?.isTextBased()) {
    await replyFn('❌ El canal configurado ya no existe. Elige uno nuevo en el Dashboard o con `/config_canal`.');
    return null;
  }
  return ch;
}

function buildApplyEmbed(usuario, tipo, cantidad, razon, record, nuevoStrikes, nuevoMultas) {
  if (tipo === 'strike') {
    if (nuevoStrikes >= MAX_STRIKES) {
      return new EmbedBuilder()
        .setColor(0xff0000)
        .addFields(
          { name: '🚫 EXPULSIÓN — 3 STRIKES ACUMULADOS', value: '\u200b', inline: false },
          { name: 'Miembro', value: `${usuario}`, inline: true },
          { name: 'Total de strikes', value: `${nuevoStrikes}/${MAX_STRIKES}`, inline: true },
          { name: 'Razón', value: razon, inline: false },
        );
    }
    return new EmbedBuilder()
      .setColor(0xff6600)
      .addFields(
        { name: '⚠️ INFRACCIÓN — STRIKE', value: '\u200b', inline: false },
        { name: 'Miembro', value: `${usuario}`, inline: true },
        { name: 'Strikes añadidos', value: `+${cantidad}`, inline: true },
        { name: 'Total de strikes', value: `${nuevoStrikes}/${MAX_STRIKES}`, inline: true },
        { name: 'Razón', value: razon, inline: false },
      );
  }
  return new EmbedBuilder()
    .setColor(0xffaa00)
    .addFields(
      { name: '💰 INFRACCIÓN — MULTA', value: '\u200b', inline: false },
      { name: 'Miembro', value: `${usuario}`, inline: true },
      { name: 'Multa', value: `${cantidad.toLocaleString('es')} de plata`, inline: true },
      { name: 'Razón', value: razon, inline: false },
      {
        name: 'Multas pendientes',
        value: `${nuevoMultas.toLocaleString('es')} de plata en total`,
        inline: false,
      },
    );
}

function buildRemoveEmbed(usuario, tipo, removidos, nuevoStrikes, nuevoMultas) {
  if (tipo === 'strike') {
    return new EmbedBuilder()
      .setColor(0x00cc66)
      .addFields(
        { name: '✅ REDUCCIÓN — STRIKE', value: '\u200b', inline: false },
        { name: 'Miembro', value: `${usuario}`, inline: true },
        { name: 'Strikes removidos', value: `-${removidos}`, inline: true },
        { name: 'Total de strikes', value: `${nuevoStrikes}/${MAX_STRIKES}`, inline: true },
      );
  }
  return new EmbedBuilder()
    .setColor(0x00cc66)
    .addFields(
      { name: '✅ REDUCCIÓN — MULTA', value: '\u200b', inline: false },
      { name: 'Miembro', value: `${usuario}`, inline: true },
      { name: 'Multa removida', value: `${removidos.toLocaleString('es')} de plata`, inline: true },
      {
        name: 'Multas pendientes',
        value: `${nuevoMultas.toLocaleString('es')} de plata en total`,
        inline: false,
      },
    );
}

function buildConsultEmbed(usuario, strikes, multas, title) {
  return new EmbedBuilder()
    .setColor(0x2f3136)
    .addFields(
      { name: title, value: '\u200b', inline: false },
      { name: 'Miembro', value: `${usuario}`, inline: true },
      { name: 'Strikes', value: `${strikes}/${MAX_STRIKES}`, inline: true },
      { name: 'Multas pendientes', value: `${multas.toLocaleString('es')} de plata`, inline: true },
    );
}

async function applyInfraccion({ getDb, guild, channel, usuario, tipo, cantidad, razon, moderatorId }) {
  const record = getRecord(getDb, usuario.id, guild.id);
  let nuevoStrikes = record.strikes;
  let nuevoMultas = record.multas;

  if (tipo === 'strike') {
    if (cantidad > MAX_STRIKES) throw new Error(`El máximo de strikes a añadir de una vez es ${MAX_STRIKES}.`);
    nuevoStrikes = Math.min(record.strikes + cantidad, MAX_STRIKES);
    updateRecord(getDb, usuario.id, guild.id, nuevoStrikes, record.multas);
  } else {
    nuevoMultas = record.multas + cantidad;
    updateRecord(getDb, usuario.id, guild.id, record.strikes, nuevoMultas);
  }

  appendLog(getDb, {
    guildId: guild.id,
    userId: usuario.id,
    action: 'apply',
    tipo,
    amount: cantidad,
    reason: razon,
    moderatorId,
  });

  const embed = buildApplyEmbed(usuario, tipo, cantidad, razon, record, nuevoStrikes, nuevoMultas);
  await channel.send({ content: `${usuario}`, embeds: [embed] });
  return { strikes: nuevoStrikes, multas: nuevoMultas };
}

async function removeInfraccion({ getDb, guild, channel, usuario, tipo, cantidad, moderatorId }) {
  const record = getRecord(getDb, usuario.id, guild.id);
  let removidos = 0;
  let nuevoStrikes = record.strikes;
  let nuevoMultas = record.multas;

  if (tipo === 'strike') {
    if (record.strikes === 0) throw new Error('El usuario no tiene strikes.');
    nuevoStrikes = Math.max(0, record.strikes - cantidad);
    removidos = record.strikes - nuevoStrikes;
    updateRecord(getDb, usuario.id, guild.id, nuevoStrikes, record.multas);
  } else {
    if (record.multas === 0) throw new Error('El usuario no tiene multas pendientes.');
    nuevoMultas = Math.max(0, record.multas - cantidad);
    removidos = record.multas - nuevoMultas;
    updateRecord(getDb, usuario.id, guild.id, record.strikes, nuevoMultas);
  }

  appendLog(getDb, {
    guildId: guild.id,
    userId: usuario.id,
    action: 'remove',
    tipo,
    amount: removidos,
    reason: null,
    moderatorId,
  });

  const embed = buildRemoveEmbed(
    usuario,
    tipo,
    removidos,
    nuevoStrikes,
    nuevoMultas,
  );
  await channel.send({ content: `${usuario}`, embeds: [embed] });
  return { strikes: nuevoStrikes, multas: nuevoMultas };
}

const tipoChoices = [
  { name: 'Strike', value: 'strike' },
  { name: 'Multa', value: 'multa' },
];

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('config_canal')
      .setDescription('Canal donde se publicarán las infracciones')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal de texto').setRequired(true),
      ),
    async run(ix, { getDb }) {
      const canal = ix.options.getChannel('canal');
      if (!canal?.isTextBased()) {
        await ix.reply({ content: '❌ Elige un canal de texto.', ephemeral: true });
        return;
      }
      setChannel(getDb, ix.guildId, canal.id);
      await ix.reply({ content: `✅ Canal de infracciones configurado en ${canal}.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('infraccion')
      .setDescription('Aplicar un strike o multa a un miembro')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('tipo')
          .setDescription('Strike o multa')
          .setRequired(true)
          .addChoices(...tipoChoices),
      )
      .addIntegerOption((o) =>
        o.setName('cantidad').setDescription('Strikes (1-3) o monto de plata').setRequired(true).setMinValue(1),
      )
      .addStringOption((o) => o.setName('razon').setDescription('Motivo').setRequired(true)),
    async run(ix, { getDb }) {
      const canal = await resolveChannel(ix.guild, getDb, (msg) =>
        ix.reply({ content: msg, ephemeral: true }),
      );
      if (!canal) return;

      const usuario = ix.options.getUser('usuario');
      const member = await ix.guild.members.fetch(usuario.id).catch(() => null);
      if (!member) {
        await ix.reply({ content: '❌ Miembro no encontrado.', ephemeral: true });
        return;
      }

      const tipo = ix.options.getString('tipo');
      const cantidad = ix.options.getInteger('cantidad');
      const razon = ix.options.getString('razon');

      try {
        await applyInfraccion({
          getDb,
          guild: ix.guild,
          channel: canal,
          usuario: member,
          tipo,
          cantidad,
          razon,
          moderatorId: ix.user.id,
        });
        await ix.reply({
          content: `✅ Infracción registrada y publicada en ${canal}.`,
          ephemeral: true,
        });
      } catch (e) {
        await ix.reply({ content: `❌ ${e.message}`, ephemeral: true });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('remover')
      .setDescription('Remover un strike o multa de un miembro')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('tipo')
          .setDescription('Strike o multa')
          .setRequired(true)
          .addChoices(...tipoChoices),
      )
      .addIntegerOption((o) =>
        o.setName('cantidad').setDescription('Cantidad a remover').setRequired(true).setMinValue(1),
      ),
    async run(ix, { getDb }) {
      const canal = await resolveChannel(ix.guild, getDb, (msg) =>
        ix.reply({ content: msg, ephemeral: true }),
      );
      if (!canal) return;

      const usuario = ix.options.getUser('usuario');
      const member = await ix.guild.members.fetch(usuario.id).catch(() => null);
      if (!member) {
        await ix.reply({ content: '❌ Miembro no encontrado.', ephemeral: true });
        return;
      }

      const tipo = ix.options.getString('tipo');
      const cantidad = ix.options.getInteger('cantidad');

      try {
        await removeInfraccion({
          getDb,
          guild: ix.guild,
          channel: canal,
          usuario: member,
          tipo,
          cantidad,
          moderatorId: ix.user.id,
        });
        await ix.reply({
          content: `✅ Infracción removida y publicada en ${canal}.`,
          ephemeral: true,
        });
      } catch (e) {
        await ix.reply({ content: `❌ ${e.message}`, ephemeral: true });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('mis_infracciones')
      .setDescription('Consulta tus strikes y multas pendientes'),
    async run(ix, { getDb }) {
      const record = getRecord(getDb, ix.user.id, ix.guildId);
      const embed = buildConsultEmbed(ix.user, record.strikes, record.multas, '📋 TUS INFRACCIONES');
      await ix.reply({ embeds: [embed], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('infracciones')
      .setDescription('Ver strikes y multas de un miembro (mods)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true)),
    async run(ix, { getDb }) {
      const usuario = ix.options.getUser('usuario');
      const record = getRecord(getDb, usuario.id, ix.guildId);
      const embed = buildConsultEmbed(
        usuario,
        record.strikes,
        record.multas,
        '📋 HISTORIAL DE INFRACCIONES',
      );
      await ix.reply({ embeds: [embed], ephemeral: true });
    },
  },
];

module.exports = {
  id: 'sanciones',
  MAX_STRIKES,
  commands,
  getConfig,
  setChannel,
  getRecord,
  updateRecord,
  listRecords,
  listLog,
  applyInfraccion,
  removeInfraccion,

  onGuildRemove(guildId, { getDb }) {
    const id = gid(guildId);
    getDb().prepare('DELETE FROM sanciones_config WHERE guild_id = ?').run(id);
    getDb().prepare('DELETE FROM sanciones_records WHERE guild_id = ?').run(id);
    getDb().prepare('DELETE FROM sanciones_log WHERE guild_id = ?').run(id);
  },

  async handleInteraction(ix, ctx) {
    if (!ix.isChatInputCommand()) return false;
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!cmd) return false;
    try {
      await cmd.run(ix, ctx);
    } catch (e) {
      const msg = { content: `❌ ${e.message}`, ephemeral: true };
      if (ix.deferred || ix.replied) await ix.editReply(msg).catch(() => ix.followUp(msg));
      else await ix.reply(msg);
    }
    return true;
  },
};
