const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  Events,
  AuditLogEvent,
  Colors,
} = require('discord.js');

function logsConfig(getDb, guildId) {
  const row = getDb()
    .prepare('SELECT logs_channel_id, logs_paused FROM logs_config WHERE guild_id = ?')
    .get(String(guildId));
  return { channelId: row?.logs_channel_id ?? null, paused: Boolean(row?.logs_paused) };
}

async function sendLog(guild, getDb, log, { title, description, color, footer, fields, thumbnail }) {
  if (!guild) return;
  const cfg = logsConfig(getDb, guild.id);
  if (cfg.paused || !cfg.channelId) return;
  const ch = guild.channels.cache.get(cfg.channelId);
  if (!ch?.isTextBased() || !guild.members.me?.permissionsIn(ch).has('SendMessages')) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color ?? Colors.Blurple)
    .setTimestamp();
  if (description) embed.setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  if (fields?.length) embed.addFields(fields);
  if (thumbnail) embed.setThumbnail(thumbnail);

  try {
    await ch.send({ embeds: [embed] });
  } catch (e) {
    log.warn(`Log fallido ${guild.id}: ${e.message}`);
  }
}

async function modAudit(guild, action, targetId, timeoutMs = 10_000) {
  try {
    const audit = await guild.fetchAuditLogs({ type: action, limit: 5 });
    const entry = audit.entries.find(
      (x) => x.target?.id === targetId && Date.now() - x.createdTimestamp < timeoutMs,
    );
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

function clip(text, max) {
  const s = text || '*Sin contenido*';
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('logs')
      .setDescription('Configura el canal de logs del servidor')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal de texto').addChannelTypes(ChannelType.GuildText).setRequired(true),
      ),
    async run(ix, { getDb }) {
      const canal = ix.options.getChannel('canal');
      const id = String(ix.guildId);
      const cfg = logsConfig(getDb, id);
      getDb()
        .prepare(`
          INSERT INTO logs_config (guild_id, logs_channel_id, logs_paused) VALUES (?, ?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET logs_channel_id = excluded.logs_channel_id
        `)
        .run(id, String(canal.id), cfg.paused ? 1 : 0);
      await ix.reply({ content: `✅ Canal de logs: ${canal}`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('pausar_logs')
      .setDescription('Pausa o reanuda los logs')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async run(ix, { getDb }) {
      const id = String(ix.guildId);
      const cfg = logsConfig(getDb, id);
      const next = !cfg.paused;
      getDb()
        .prepare(`
          INSERT INTO logs_config (guild_id, logs_channel_id, logs_paused) VALUES (?, ?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET logs_paused = excluded.logs_paused
        `)
        .run(id, cfg.channelId, next ? 1 : 0);
      await ix.reply({
        content: `✅ Los logs han sido **${next ? 'pausados' : 'reactivados'}**.`,
        ephemeral: true,
      });
    },
  },
];

module.exports = {
  id: 'logs',
  defaultEnabled: true,
  commands,
  onGuildRemove(guildId, ctx) {
    ctx?.getDb?.().prepare('DELETE FROM logs_config WHERE guild_id = ?').run(String(guildId));
  },
  onInit(client, ctx) {
    const { getDb, log } = ctx;

    // ——— Miembros ———
    client.on(Events.GuildMemberAdd, (m) =>
      sendLog(m.guild, getDb, log, {
        title: '👋 Nuevo miembro',
        description: `${m} se ha unido al servidor.`,
        color: Colors.Green,
        footer: `ID: ${m.id}`,
      }),
    );

    client.on(Events.GuildMemberRemove, async (m) => {
      const kickMod = await modAudit(m.guild, AuditLogEvent.MemberKick, m.id);
      sendLog(m.guild, getDb, log, {
        title: kickMod ? '👢 Miembro expulsado' : '🚪 Miembro salió',
        description:
          `${m.user?.tag || m.id}\n` +
          (kickMod ? `**Moderador:** ${kickMod}` : 'Salió del servidor.'),
        color: Colors.Red,
        footer: `ID: ${m.id}`,
      });
    });

    client.on(Events.GuildBanAdd, async (ban) => {
      const mod = await modAudit(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      sendLog(ban.guild, getDb, log, {
        title: '🔨 Miembro baneado',
        description: `**Usuario:** ${ban.user.tag}\n**Moderador:** ${mod || 'Desconocido'}`,
        color: Colors.Red,
        footer: `ID: ${ban.user.id}`,
      });
    });

    client.on(Events.GuildBanRemove, async (ban) => {
      const mod = await modAudit(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
      sendLog(ban.guild, getDb, log, {
        title: '🔓 Miembro desbaneado',
        description: `**Usuario:** ${ban.user.tag}\n**Moderador:** ${mod || 'Desconocido'}`,
        color: Colors.Green,
        footer: `ID: ${ban.user.id}`,
      });
    });

    client.on(Events.GuildMemberUpdate, async (before, after) => {
      const added = after.roles.cache.filter((r) => r.id !== after.guild.id && !before.roles.cache.has(r.id));
      const removed = before.roles.cache.filter((r) => r.id !== before.guild.id && !after.roles.cache.has(r.id));
      if (!added.size && !removed.size) return;

      const mod = await modAudit(after.guild, AuditLogEvent.MemberRoleUpdate, after.id);

      if (added.size) {
        const roles = added.map((r) => r.toString()).join(' ');
        let desc = `**Usuario:** ${after}\n**Rol(es) añadido(s):** ${roles}`;
        if (mod) desc += `\n**Moderador:** ${mod}`;
        sendLog(after.guild, getDb, log, {
          title: '📝 Rol añadido',
          description: desc,
          color: Colors.Green,
          footer: `ID: ${after.id}`,
        });
      }
      if (removed.size) {
        const roles = removed.map((r) => r.name).join(', ');
        let desc = `**Usuario:** ${after}\n**Rol(es) eliminado(s):** ${roles}`;
        if (mod) desc += `\n**Moderador:** ${mod}`;
        sendLog(after.guild, getDb, log, {
          title: '🗑️ Rol eliminado',
          description: desc,
          color: Colors.Red,
          footer: `ID: ${after.id}`,
        });
      }
    });

    // ——— Mensajes ———
    client.on(Events.MessageDelete, async (message) => {
      if (message.partial) {
        try {
          await message.fetch();
        } catch {
          return;
        }
      }
      if (!message.guild || message.author?.bot) return;
      const content = clip(message.content, 1024);
      const fields = [];
      if (message.attachments?.size) {
        fields.push({
          name: '📎 Adjuntos',
          value: message.attachments.map((a) => a.name).join(', ').slice(0, 1024),
          inline: false,
        });
      }
      sendLog(message.guild, getDb, log, {
        title: '🗑️ Mensaje eliminado',
        description: `**Usuario:** ${message.author}\n**Canal:** ${message.channel}\n**Contenido:** ${content}`,
        color: Colors.Red,
        footer: `ID mensaje: ${message.id}`,
        fields,
      });
    });

    client.on(Events.MessageUpdate, async (before, after) => {
      if (before.partial) {
        try {
          await before.fetch();
        } catch {
          return;
        }
      }
      if (!before.guild || before.author?.bot || before.content === after.content) return;
      sendLog(before.guild, getDb, log, {
        title: '✏️ Mensaje editado',
        color: Colors.Blue,
        footer: `ID: ${before.id}`,
        fields: [
          { name: '👤 Usuario', value: `${before.author}`, inline: false },
          { name: 'Canal', value: `${before.channel}`, inline: false },
          { name: 'Antes', value: clip(before.content, 512), inline: false },
          { name: 'Después', value: clip(after.content, 512), inline: false },
        ],
      });
    });

    // ——— Roles del servidor ———
    client.on(Events.GuildRoleCreate, async (role) => {
      const mod = await modAudit(role.guild, AuditLogEvent.RoleCreate, role.id);
      let desc = `**Rol:** ${role}`;
      if (mod) desc += `\n**Creado por:** ${mod}`;
      sendLog(role.guild, getDb, log, {
        title: '➕ Rol creado',
        description: desc,
        color: role.color || Colors.Blue,
        footer: `ID: ${role.id}`,
      });
    });

    client.on(Events.GuildRoleDelete, async (role) => {
      const mod = await modAudit(role.guild, AuditLogEvent.RoleDelete, role.id);
      let desc = `**Rol:** ${role.name}`;
      if (mod) desc += `\n**Eliminado por:** ${mod}`;
      sendLog(role.guild, getDb, log, {
        title: '🗑️ Rol eliminado',
        description: desc,
        color: Colors.Red,
        footer: `ID: ${role.id}`,
      });
    });

    client.on(Events.GuildRoleUpdate, async (before, after) => {
      const changes = [];
      if (before.name !== after.name) changes.push(`**Nombre:** ${before.name} → ${after.name}`);
      if (before.color !== after.color) changes.push('**Color:** actualizado');
      if (!before.permissions.equals(after.permissions)) changes.push('**Permisos:** actualizados');
      if (before.position !== after.position) changes.push(`**Posición:** ${before.position} → ${after.position}`);
      if (!changes.length) return;

      const mod = await modAudit(after.guild, AuditLogEvent.RoleUpdate, after.id);
      let desc = `**Rol:** ${after}\n${changes.join('\n')}`;
      if (mod) desc += `\n**Modificado por:** ${mod}`;
      sendLog(after.guild, getDb, log, {
        title: '📝 Rol actualizado',
        description: desc,
        color: after.color || Colors.Blue,
        footer: `ID: ${after.id}`,
      });
    });

    // ——— Servidor ———
    client.on(Events.GuildUpdate, async (before, after) => {
      const changes = [];
      if (before.name !== after.name) changes.push(`**Nombre:** ${before.name} → ${after.name}`);
      if (before.icon !== after.icon) changes.push(after.icon ? '**Icono:** actualizado' : '**Icono:** eliminado');
      if (before.banner !== after.banner) changes.push(after.banner ? '**Banner:** actualizado' : '**Banner:** eliminado');
      if (before.description !== after.description) {
        changes.push(`**Descripción:** ${clip(before.description, 30)} → ${clip(after.description, 30)}`);
      }
      if (before.verificationLevel !== after.verificationLevel) {
        changes.push(`**Verificación:** ${before.verificationLevel} → ${after.verificationLevel}`);
      }
      if (before.explicitContentFilter !== after.explicitContentFilter) {
        changes.push(`**Filtro contenido:** ${before.explicitContentFilter} → ${after.explicitContentFilter}`);
      }
      if (!changes.length) return;

      const mod = await modAudit(after, AuditLogEvent.GuildUpdate, after.id);
      let desc = changes.join('\n');
      if (mod) desc += `\n**Modificado por:** ${mod}`;
      sendLog(after, getDb, log, {
        title: '🏠 Servidor actualizado',
        description: desc,
        color: Colors.Gold,
        footer: `ID: ${after.id}`,
        thumbnail: after.iconURL({ size: 128 }),
      });
    });

    // ——— Canales ———
    client.on(Events.ChannelCreate, async (channel) => {
      if (!channel.guild) return;
      const mod = await modAudit(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
      let desc = `**Canal:** ${channel}`;
      if (mod) desc += `\n**Creado por:** ${mod}`;
      sendLog(channel.guild, getDb, log, {
        title: '➕ Canal creado',
        description: desc,
        color: Colors.Green,
        footer: `ID: ${channel.id}`,
      });
    });

    client.on(Events.ChannelDelete, async (channel) => {
      if (!channel.guild) return;
      const mod = await modAudit(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
      let desc = `**Canal:** ${channel.name}`;
      if (mod) desc += `\n**Eliminado por:** ${mod}`;
      sendLog(channel.guild, getDb, log, {
        title: '🗑️ Canal eliminado',
        description: desc,
        color: Colors.Red,
        footer: `ID: ${channel.id}`,
      });
    });

    log.info('Módulo logs completo');
  },
  async handleInteraction(ix, ctx) {
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!ix.isChatInputCommand() || !cmd) return false;
    await cmd.run(ix, ctx);
    return true;
  },
};
