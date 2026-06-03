const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  Colors,
} = require('discord.js');

const PREFIX = 'mod';
const pendingAutorol = new Map();

const COLORS = {
  rojo: Colors.Red,
  verde: Colors.Green,
  azul: Colors.Blue,
  blanco: 0xffffff,
  negro: 0x000000,
  morado: Colors.Purple,
  naranja: Colors.Orange,
  amarillo: Colors.Yellow,
};

function gid(id) {
  return String(id);
}

function modPerms(ix) {
  return ix.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);
}

function getAutorol(getDb, messageId) {
  const row = getDb()
    .prepare('SELECT config_json FROM autorol_configs WHERE message_id = ?')
    .get(gid(messageId));
  if (!row) return null;
  try {
    return JSON.parse(row.config_json);
  } catch {
    return null;
  }
}

function saveAutorol(getDb, messageId, guildId, config) {
  getDb()
    .prepare(`
      INSERT INTO autorol_configs (message_id, guild_id, config_json) VALUES (?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET config_json = excluded.config_json
    `)
    .run(gid(messageId), gid(guildId), JSON.stringify(config));
}

function tienePrivilegios(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.MuteMembers) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('warning')
      .setDescription('Envía una advertencia por DM a un usuario')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addStringOption((o) => o.setName('mensaje').setDescription('Mensaje').setRequired(true)),
    async run(ix) {
      const user = ix.options.getUser('usuario');
      const msg = ix.options.getString('mensaje');
      await ix.deferReply({ ephemeral: true });
      try {
        const member = await ix.guild.members.fetch(user.id);
        await member.send(`⚠️ **Advertencia:** ${msg}`);
        await ix.editReply(`✅ Advertencia enviada a ${member}.`);
      } catch (e) {
        await ix.editReply(`❌ No se pudo enviar: ${e.message}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('limpiar')
      .setDescription('Elimina mensajes del canal actual')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addIntegerOption((o) =>
        o.setName('cantidad').setDescription('1–500').setRequired(true).setMinValue(1).setMaxValue(500),
      ),
    async run(ix) {
      const cantidad = ix.options.getInteger('cantidad');
      await ix.deferReply({ ephemeral: true });
      try {
        let total = 0;
        let rest = cantidad;
        while (rest > 0) {
          const batch = Math.min(100, rest);
          const deleted = await ix.channel.bulkDelete(batch, true);
          if (!deleted.size) break;
          total += deleted.size;
          rest -= deleted.size;
          if (deleted.size < batch) break;
        }
        await ix.editReply(`✅ Eliminados ${total} mensaje(s).`);
      } catch (e) {
        await ix.editReply(`❌ ${e.message}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('autorol')
      .setDescription('Configura roles automáticos por reacción')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async run(ix) {
      const key = `${ix.guildId}:${ix.user.id}`;
      pendingAutorol.set(key, { title: null, description: null, color: Colors.Blue, channelId: null, roles: [] });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:ar:title`).setLabel('Título/Descripción').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:ar:emoji`).setLabel('Emoji/Rol').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:ar:channel`).setLabel('Canal').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:ar:color`).setLabel('Color').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:ar:save`).setLabel('Guardar').setStyle(ButtonStyle.Success),
      );

      await ix.reply({
        content: 'Configura el panel de autoroles:',
        components: [row],
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('automute')
      .setDescription('Silencia a todos en un canal de voz (excepto mods)')
      .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers)
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal de voz').addChannelTypes(ChannelType.GuildVoice).setRequired(true),
      ),
    async run(ix) {
      const canal = ix.options.getChannel('canal');
      await ix.deferReply({ ephemeral: true });
      const muteados = [];
      const omitidos = [];
      for (const member of canal.members.values()) {
        if (member.user.bot) continue;
        if (tienePrivilegios(member)) {
          omitidos.push(member.displayName);
          continue;
        }
        try {
          await member.voice.setMute(true, `AutoMute por ${ix.user.tag}`);
          muteados.push(member.displayName);
        } catch {
          omitidos.push(`${member.displayName} (error)`);
        }
      }
      const embed = new EmbedBuilder()
        .setTitle('🔇 AutoMute')
        .setColor(Colors.Red)
        .setDescription(
          (muteados.length ? `**Silenciados (${muteados.length}):**\n${muteados.map((m) => `• ${m}`).join('\n')}\n\n` : '') +
          (omitidos.length ? `**Omitidos (${omitidos.length}):**\n${omitidos.map((m) => `• ${m}`).join('\n')}` : '') ||
          `Canal **${canal.name}** vacío.`,
        )
        .setFooter({ text: `Por ${ix.user.displayName}` });
      await ix.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('autounmute')
      .setDescription('Quita el silencio a todos en un canal de voz')
      .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers)
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal de voz').addChannelTypes(ChannelType.GuildVoice).setRequired(true),
      ),
    async run(ix) {
      const canal = ix.options.getChannel('canal');
      await ix.deferReply({ ephemeral: true });
      const ok = [];
      const err = [];
      for (const member of canal.members.values()) {
        if (member.user.bot) continue;
        try {
          await member.voice.setMute(false, `AutoUnmute por ${ix.user.tag}`);
          ok.push(member.displayName);
        } catch {
          err.push(member.displayName);
        }
      }
      const embed = new EmbedBuilder()
        .setTitle('🔊 AutoUnmute')
        .setColor(Colors.Green)
        .setDescription(
          (ok.length ? `**Des-silenciados (${ok.length}):**\n${ok.map((m) => `• ${m}`).join('\n')}\n\n` : '') +
          (err.length ? `**Errores (${err.length}):**\n${err.map((m) => `• ${m}`).join('\n')}` : '') ||
          `Canal **${canal.name}** vacío.`,
        )
        .setFooter({ text: `Por ${ix.user.displayName}` });
      await ix.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('infoserver').setDescription('Información del servidor'),
    async run(ix) {
      const g = ix.guild;
      const owner = await g.fetchOwner();
      const bots = g.members.cache.filter((m) => m.user.bot).size;
      const embed = new EmbedBuilder()
        .setTitle(`Información: ${g.name}`)
        .setColor(Colors.Blue)
        .setDescription(`ID: \`${g.id}\``)
        .addFields(
          { name: '👑 Dueño', value: `${owner}`, inline: false },
          { name: '📆 Creado', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F>`, inline: false },
          { name: '💬 Texto', value: String(g.channels.cache.filter((c) => c.isTextBased()).size), inline: true },
          { name: '🔊 Voz', value: String(g.channels.cache.filter((c) => c.isVoiceBased()).size), inline: true },
          { name: '👥 Miembros', value: String(g.memberCount - bots), inline: true },
          { name: '🤖 Bots', value: String(bots), inline: true },
          { name: '🔒 Verificación', value: String(g.verificationLevel), inline: true },
        )
        .setFooter({ text: `Solicitado por ${ix.user.username}` });
      if (g.iconURL()) embed.setThumbnail(g.iconURL({ size: 128 }));
      await ix.reply({ embeds: [embed] });
    },
  },
];

async function handleAutorolInteraction(ix, { getDb }) {
  const key = `${ix.guildId}:${ix.user.id}`;
  const cfg = pendingAutorol.get(key);
  if (!cfg) {
    await ix.reply({ content: 'Sesión expirada. Usa `/autorol` de nuevo.', ephemeral: true });
    return true;
  }

  if (ix.isButton()) {
    const action = ix.customId.split(':')[2];
    if (action === 'title') {
      const modal = new ModalBuilder()
        .setCustomId(`${PREFIX}:ar:modal:title`)
        .setTitle('Título y descripción')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('titulo').setLabel('Título').setStyle(TextInputStyle.Short).setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('desc').setLabel('Descripción').setStyle(TextInputStyle.Paragraph).setRequired(true),
          ),
        );
      await ix.showModal(modal);
      return true;
    }
    if (action === 'emoji') {
      const modal = new ModalBuilder()
        .setCustomId(`${PREFIX}:ar:modal:emoji`)
        .setTitle('Emoji y rol')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(true),
          ),
        );
      await ix.showModal(modal);
      return true;
    }
    if (action === 'channel') {
      const sel = new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}:ar:pick:channel`)
        .setPlaceholder('Canal de texto')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);
      await ix.reply({ content: 'Selecciona canal:', components: [new ActionRowBuilder().addComponents(sel)], ephemeral: true });
      return true;
    }
    if (action === 'color') {
      const sel = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:ar:pick:color`)
        .setPlaceholder('Color del embed')
        .addOptions(Object.keys(COLORS).map((c) => ({ label: c, value: c })));
      await ix.reply({ content: 'Selecciona color:', components: [new ActionRowBuilder().addComponents(sel)], ephemeral: true });
      return true;
    }
    if (action === 'save') {
      if (!cfg.title || !cfg.description || !cfg.channelId || !cfg.roles.length) {
        await ix.reply({ content: '❌ Completa título, descripción, canal y al menos un emoji/rol.', ephemeral: true });
        return true;
      }
      const ch = ix.guild.channels.cache.get(cfg.channelId);
      if (!ch?.isTextBased()) {
        await ix.reply({ content: '❌ Canal no encontrado.', ephemeral: true });
        return true;
      }
      const embed = new EmbedBuilder()
        .setTitle(cfg.title)
        .setDescription(cfg.description)
        .setColor(cfg.color)
        .setFooter({ text: 'Reacciona para obtener o quitar roles.' });
      const msg = await ch.send({ embeds: [embed] });
      for (const r of cfg.roles) {
        try {
          await msg.react(r.emoji);
        } catch {
          /* emoji inválido */
        }
      }
      saveAutorol(getDb, msg.id, ix.guildId, cfg.roles);
      pendingAutorol.delete(key);
      await ix.reply({ content: `✅ Panel publicado en ${ch}`, ephemeral: true });
      return true;
    }
  }

  if (ix.isModalSubmit()) {
    if (ix.customId === `${PREFIX}:ar:modal:title`) {
      cfg.title = ix.fields.getTextInputValue('titulo');
      cfg.description = ix.fields.getTextInputValue('desc');
      pendingAutorol.set(key, cfg);
      await ix.reply({ content: '✅ Título y descripción guardados.', ephemeral: true });
      return true;
    }
    if (ix.customId === `${PREFIX}:ar:modal:emoji`) {
      const emoji = ix.fields.getTextInputValue('emoji').trim();
      const sel = new RoleSelectMenuBuilder()
        .setCustomId(`${PREFIX}:ar:pick:role:${encodeURIComponent(emoji)}`)
        .setPlaceholder('Rol para este emoji')
        .setMaxValues(1);
      await ix.reply({ content: `Rol para ${emoji}:`, components: [new ActionRowBuilder().addComponents(sel)], ephemeral: true });
      return true;
    }
  }

  if (ix.isChannelSelectMenu() && ix.customId === `${PREFIX}:ar:pick:channel`) {
    cfg.channelId = ix.channels.first().id;
    pendingAutorol.set(key, cfg);
    await ix.reply({ content: `✅ Canal: ${ix.channels.first()}`, ephemeral: true });
    return true;
  }

  if (ix.isStringSelectMenu() && ix.customId === `${PREFIX}:ar:pick:color`) {
    cfg.color = COLORS[ix.values[0]] || Colors.Blue;
    pendingAutorol.set(key, cfg);
    await ix.reply({ content: `✅ Color: ${ix.values[0]}`, ephemeral: true });
    return true;
  }

  if (ix.isRoleSelectMenu() && ix.customId.startsWith(`${PREFIX}:ar:pick:role:`)) {
    const emoji = decodeURIComponent(ix.customId.split(':')[4]);
    const role = ix.roles.first();
    if (cfg.roles.some((r) => r.emoji === emoji)) {
      await ix.reply({ content: '❌ Ese emoji ya está configurado.', ephemeral: true });
      return true;
    }
    cfg.roles.push({ emoji, roleId: role.id });
    pendingAutorol.set(key, cfg);
    await ix.reply({ content: `✅ ${emoji} → ${role.name}`, ephemeral: true });
    return true;
  }

  return false;
}

async function handleReaction(reaction, user, add, getDb) {
  if (user.bot) return;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }
  const configs = getAutorol(getDb, reaction.message.id);
  if (!configs) return;
  const guild = reaction.message.guild;
  if (!guild) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  const emoji = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
  const match = configs.find((c) => c.emoji === emoji || c.emoji === reaction.emoji.name);
  if (!match) return;
  const role = guild.roles.cache.get(match.roleId);
  if (!role) return;
  try {
    if (add) await member.roles.add(role);
    else await member.roles.remove(role);
  } catch {
    /* sin permiso */
  }
}

module.exports = {
  id: 'moderacion',
  commands,

  onGuildRemove(guildId, { getDb }) {
    getDb().prepare('DELETE FROM autorol_configs WHERE guild_id = ?').run(gid(guildId));
  },

  onInit(client, { getDb, log }) {
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      await handleReaction(reaction, user, true, getDb);
    });
    client.on(Events.MessageReactionRemove, async (reaction, user) => {
      await handleReaction(reaction, user, false, getDb);
    });
    log.info('Módulo moderación listo');
  },

  async handleInteraction(ix, ctx) {
    if (ix.customId?.startsWith(`${PREFIX}:ar:`)) {
      return handleAutorolInteraction(ix, ctx);
    }
    if (!ix.isChatInputCommand()) return false;
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!cmd) return false;
    await cmd.run(ix, ctx);
    return true;
  },
};
