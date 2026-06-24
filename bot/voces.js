const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { isModuleEnabled } = require('./modules');

const PREFIX = 'voces';
const HUB_NAME = '➕ Crear canal';
const EMBED_COLOR = 0x3498db;
const CREATE_COOLDOWN_MS = 5000;
const MAX_STATUS_LEN = 500;

const createCooldown = new Map();
const creatingUsers = new Set();

function gid(id) {
  return String(id);
}

function parseRoleIds(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getConfig(getDb, guildId) {
  const row = getDb()
    .prepare('SELECT * FROM voces_config WHERE guild_id = ?')
    .get(gid(guildId));
  if (!row) return null;
  return {
    guildId: row.guild_id,
    categoryId: row.category_id,
    hubChannelId: row.hub_channel_id,
    namingMode: row.naming_mode || 'username',
    allowedRoleIds: parseRoleIds(row.allowed_role_ids),
    sequenceCounter: row.sequence_counter || 0,
    enabled: row.enabled === 1,
  };
}

function saveConfig(getDb, guildId, data) {
  getDb()
    .prepare(`
      INSERT INTO voces_config (
        guild_id, category_id, hub_channel_id, naming_mode, allowed_role_ids, sequence_counter, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        category_id = excluded.category_id,
        hub_channel_id = excluded.hub_channel_id,
        naming_mode = excluded.naming_mode,
        allowed_role_ids = excluded.allowed_role_ids,
        sequence_counter = excluded.sequence_counter,
        enabled = excluded.enabled
    `)
    .run(
      gid(guildId),
      data.categoryId ? gid(data.categoryId) : null,
      data.hubChannelId ? gid(data.hubChannelId) : null,
      data.namingMode || 'username',
      JSON.stringify(data.allowedRoleIds || []),
      data.sequenceCounter ?? 0,
      data.enabled === false ? 0 : 1,
    );
}

function setSequenceCounter(getDb, guildId, value) {
  getDb()
    .prepare('UPDATE voces_config SET sequence_counter = ? WHERE guild_id = ?')
    .run(value, gid(guildId));
}

function getTempChannel(getDb, channelId) {
  return getDb()
    .prepare('SELECT * FROM voces_temp_channels WHERE channel_id = ?')
    .get(gid(channelId));
}

function listActiveTempChannels(getDb, guildId) {
  return getDb()
    .prepare('SELECT * FROM voces_temp_channels WHERE guild_id = ?')
    .all(gid(guildId));
}

function getTempByOwner(getDb, guildId, ownerId) {
  return getDb()
    .prepare('SELECT * FROM voces_temp_channels WHERE guild_id = ? AND owner_id = ?')
    .get(gid(guildId), gid(ownerId));
}

function insertTempChannel(getDb, { channelId, guildId, ownerId, sequenceNumber, controlMessageId }) {
  getDb()
    .prepare(`
      INSERT INTO voces_temp_channels (channel_id, guild_id, owner_id, sequence_number, control_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      gid(channelId),
      gid(guildId),
      gid(ownerId),
      sequenceNumber ?? null,
      controlMessageId ? gid(controlMessageId) : null,
      Date.now(),
    );
}

function deleteTempChannelRow(getDb, channelId) {
  getDb().prepare('DELETE FROM voces_temp_channels WHERE channel_id = ?').run(gid(channelId));
}

function nextSequenceNumber(getDb, guildId) {
  const cfg = getConfig(getDb, guildId);
  const peak = cfg?.sequenceCounter || 0;
  const active = listActiveTempChannels(getDb, guildId);
  const peakInUse = active.some((r) => r.sequence_number === peak);
  if (peak > 0 && !peakInUse) return peak;
  return peak + 1;
}

function sanitizeChannelName(raw) {
  let name = String(raw || 'Sala')
    .replace(/[\n\r\t]/g, ' ')
    .trim()
    .slice(0, 100);
  if (name.length < 2) name = 'Sala';
  return name;
}

function memberHasAllowedRole(member, roleIds) {
  if (!roleIds?.length) return true;
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

function canControlChannel(ix, tempRow) {
  if (!tempRow) return false;
  if (gid(tempRow.owner_id) === gid(ix.user.id)) return true;
  return ix.member?.permissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
}

async function setVoiceChannelStatus(client, channelId, status) {
  const text = status == null ? '' : String(status).slice(0, MAX_STATUS_LEN);
  await client.rest.put(`/channels/${gid(channelId)}/voice-status`, {
    body: { status: text },
  });
}

function buildControlPanelComponents(channelId) {
  const configMenu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:cfg:${channelId}`)
    .setPlaceholder('🎛️ Configuración del canal')
    .addOptions(
      { label: 'Nombre', description: 'Cambiar el nombre del canal', value: 'nombre', emoji: '📝' },
      { label: 'Límite', description: 'Cambiar el límite de usuarios (0 = sin límite)', value: 'limite', emoji: '👥' },
      { label: 'Estado', description: 'Estado de voz bajo el nombre del canal', value: 'estado', emoji: '💬' },
    );

  const permMenu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:perm:${channelId}`)
    .setPlaceholder('🔐 Permisos del canal')
    .addOptions(
      { label: 'Bloquear', description: 'Nadie más puede entrar (@everyone)', value: 'bloquear', emoji: '🔒' },
      { label: 'Desbloquear', description: 'Permitir entrar a @everyone', value: 'desbloquear', emoji: '🔓' },
      { label: 'Permitir', description: 'Permitir a un usuario concreto', value: 'permitir', emoji: '✅' },
      { label: 'Rechazar', description: 'Expulsar y bloquear a un usuario', value: 'rechazar', emoji: '⛔' },
      { label: 'Invitar', description: 'Permitir e invitar a un usuario', value: 'invitar', emoji: '📨' },
    );

  return [
    new ActionRowBuilder().addComponents(configMenu),
    new ActionRowBuilder().addComponents(permMenu),
  ];
}

function buildControlPanelPayload(ownerId, channelId) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🎛️ Configuración del canal')
    .setDescription(
      'Usa los menús para gestionar tu sala de voz.\n\n' +
        '**Configuración** — nombre, límite, estado\n' +
        '**Permisos** — bloquear, permitir, invitar…',
    );

  return {
    content: `<@${gid(ownerId)}>`,
    embeds: [embed],
    components: buildControlPanelComponents(channelId),
  };
}

async function sendControlPanel(client, channel, ownerId, log) {
  const payload = buildControlPanelPayload(ownerId, channel.id);
  try {
    const msg = await channel.send(payload);
    return msg.id;
  } catch (e) {
    log.warn(`[voces] Panel en VC ${channel.id}: ${e.message}`);
    try {
      const user = await client.users.fetch(gid(ownerId));
      const dm = await user.send({
        ...payload,
        content: `<@${gid(ownerId)}> — panel de control de tu sala **${channel.name}**:`,
      });
      return dm.id;
    } catch (e2) {
      log.warn(`[voces] Panel DM fallback: ${e2.message}`);
      return null;
    }
  }
}

function isPrivateVoces(allowedRoleIds) {
  return Array.isArray(allowedRoleIds) && allowedRoleIds.length > 0;
}

function buildHubOverwrites(guild, allowedRoleIds) {
  const privateMode = isPrivateVoces(allowedRoleIds);
  const overwrites = [
    {
      id: guild.id,
      ...(privateMode
        ? { deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }
        : { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }),
    },
  ];
  if (privateMode) {
    for (const rid of allowedRoleIds) {
      overwrites.push({
        id: rid,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
      });
    }
  }
  return overwrites;
}

function buildTempOverwrites(guild, ownerId, allowedRoleIds) {
  const privateMode = isPrivateVoces(allowedRoleIds);
  const ownerPerms = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.MuteMembers,
    PermissionFlagsBits.MoveMembers,
  ];
  const overwrites = [
    {
      id: guild.id,
      ...(privateMode
        ? { deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }
        : {
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          }),
    },
    {
      id: gid(ownerId),
      allow: ownerPerms,
    },
  ];
  if (privateMode) {
    for (const rid of allowedRoleIds) {
      overwrites.push({
        id: rid,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
      });
    }
  }
  return overwrites;
}

async function ensureHubChannel(client, getDb, guildId, log, { categoryId, allowedRoleIds, existingHubId }) {
  const guild = await client.guilds.fetch(gid(guildId)).catch(() => null);
  if (!guild) throw new Error('Servidor no encontrado');

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('El bot necesita permiso **Gestionar canales**');
  }

  const parent =
    categoryId && guild.channels.cache.get(gid(categoryId))?.type === ChannelType.GuildCategory
      ? gid(categoryId)
      : null;
  if (!parent) throw new Error('Categoría no válida');

  let hub = existingHubId ? guild.channels.cache.get(gid(existingHubId)) : null;
  if (hub && hub.type !== ChannelType.GuildVoice) hub = null;

  if (hub) {
    await hub.edit({ name: HUB_NAME, parent, permissionOverwrites: buildHubOverwrites(guild, allowedRoleIds) });
  } else {
    hub = await guild.channels.create({
      name: HUB_NAME,
      type: ChannelType.GuildVoice,
      parent,
      reason: 'Nexus — hub auto voz',
      permissionOverwrites: buildHubOverwrites(guild, allowedRoleIds),
    });
  }

  return hub.id;
}

async function applyVocesSetup(client, getDb, guildId, log, opts) {
  const { categoryId, namingMode, allowedRoleIds = [], enabled = true } = opts;
  if (!categoryId) throw new Error('La categoría es obligatoria');

  const prev = getConfig(getDb, guildId);
  const hubChannelId = await ensureHubChannel(client, getDb, guildId, log, {
    categoryId,
    allowedRoleIds,
    existingHubId: prev?.hubChannelId,
  });

  saveConfig(getDb, guildId, {
    categoryId,
    hubChannelId,
    namingMode: namingMode === 'sequence' ? 'sequence' : 'username',
    allowedRoleIds,
    sequenceCounter: prev?.sequenceCounter ?? 0,
    enabled,
  });

  return { hubChannelId, namingMode, allowedRoleIds };
}

async function deleteTempChannel(client, getDb, guildId, channelId, log) {
  const row = getTempChannel(getDb, channelId);
  if (!row) return;

  deleteTempChannelRow(getDb, channelId);

  const remaining = listActiveTempChannels(getDb, guildId);
  if (!remaining.length) {
    setSequenceCounter(getDb, guildId, 0);
  }

  try {
    const ch = await client.channels.fetch(gid(channelId)).catch(() => null);
    if (ch) await ch.delete('Nexus — sala temporal vacía');
  } catch (e) {
    log.warn(`[voces] Borrar temporal ${channelId}: ${e.message}`);
  }
}

async function createTempChannel(client, getDb, member, cfg, log) {
  const guild = member.guild;
  const guildId = guild.id;
  const userId = member.id;
  const key = `${guildId}:${userId}`;

  if (creatingUsers.has(key)) return;
  creatingUsers.add(key);

  try {
    const existing = getTempByOwner(getDb, guildId, userId);
    if (existing) {
      const ch = guild.channels.cache.get(gid(existing.channel_id));
      if (ch) {
        await member.voice.setChannel(ch).catch(() => {});
        return;
      }
      deleteTempChannelRow(getDb, existing.channel_id);
    }

    const cdKey = key;
    const last = createCooldown.get(cdKey) || 0;
    if (Date.now() - last < CREATE_COOLDOWN_MS) return;
    createCooldown.set(cdKey, Date.now());

    let channelName;
    let sequenceNumber = null;

    if (cfg.namingMode === 'sequence') {
      sequenceNumber = nextSequenceNumber(getDb, guildId);
      channelName = `Sala ${sequenceNumber}`;
      const current = getConfig(getDb, guildId);
      setSequenceCounter(getDb, guildId, Math.max(current?.sequenceCounter || 0, sequenceNumber));
    } else {
      channelName = sanitizeChannelName(member.displayName || member.user.username);
    }

    const tempChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: cfg.categoryId,
      reason: `Nexus auto voz — ${member.user.tag}`,
      permissionOverwrites: buildTempOverwrites(guild, userId, cfg.allowedRoleIds),
    });

    const controlMessageId = await sendControlPanel(client, tempChannel, userId, log);

    insertTempChannel(getDb, {
      channelId: tempChannel.id,
      guildId,
      ownerId: userId,
      sequenceNumber,
      controlMessageId,
    });

    await member.voice.setChannel(tempChannel);
    log.info(`[voces] ${guild.name}: ${channelName} ← ${member.user.tag}`);
  } finally {
    creatingUsers.delete(key);
  }
}

async function handleHubJoin(client, getDb, member, cfg, log) {
  if (!memberHasAllowedRole(member, cfg.allowedRoleIds)) {
    await member.voice.disconnect('Sin rol para crear salas de voz').catch(() => {});
    return;
  }
  await createTempChannel(client, getDb, member, cfg, log);
}

async function handleTempLeave(client, getDb, guildId, channelId, log) {
  const ch = await client.channels.fetch(gid(channelId)).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildVoice) {
    deleteTempChannelRow(getDb, channelId);
    return;
  }
  if (ch.members.size === 0) {
    await deleteTempChannel(client, getDb, guildId, channelId, log);
  }
}

async function handleConfigSelect(ix, getDb, log) {
  const channelId = ix.customId.split(':')[2];
  const tempRow = getTempChannel(getDb, channelId);
  if (!canControlChannel(ix, tempRow)) {
    await ix.reply({ content: '❌ Solo el creador de la sala o un admin puede usar esto.', ephemeral: true });
    return;
  }

  const action = ix.values[0];
  if (action === 'nombre') {
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:modal:nombre:${channelId}`)
      .setTitle('Cambiar nombre');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('valor')
          .setLabel('Nuevo nombre')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(100)
          .setRequired(true),
      ),
    );
    await ix.showModal(modal);
    return;
  }

  if (action === 'limite') {
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:modal:limite:${channelId}`)
      .setTitle('Límite de usuarios');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('valor')
          .setLabel('0 = sin límite, máximo 99')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(2)
          .setRequired(true),
      ),
    );
    await ix.showModal(modal);
    return;
  }

  if (action === 'estado') {
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:modal:estado:${channelId}`)
      .setTitle('Estado del canal de voz');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('valor')
          .setLabel('Texto bajo el nombre (vacío = quitar)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MAX_STATUS_LEN)
          .setRequired(false),
      ),
    );
    await ix.showModal(modal);
  }
}

async function handlePermSelect(ix, getDb) {
  const channelId = ix.customId.split(':')[2];
  const tempRow = getTempChannel(getDb, channelId);
  if (!canControlChannel(ix, tempRow)) {
    await ix.reply({ content: '❌ Solo el creador de la sala o un admin puede usar esto.', ephemeral: true });
    return;
  }

  const action = ix.values[0];
  const ch = await ix.guild.channels.fetch(gid(channelId)).catch(() => null);
  if (!ch?.isVoiceBased()) {
    await ix.reply({ content: '❌ Canal no encontrado.', ephemeral: true });
    return;
  }

  if (action === 'bloquear') {
    await ch.permissionOverwrites.edit(ix.guild.id, { Connect: false });
    await ix.reply({ content: '🔒 Canal bloqueado para @everyone.', ephemeral: true });
    return;
  }

  if (action === 'desbloquear') {
    await ch.permissionOverwrites.edit(ix.guild.id, { Connect: true });
    await ix.reply({ content: '🔓 Canal desbloqueado.', ephemeral: true });
    return;
  }

  const labels = { permitir: 'permitir', rechazar: 'rechazar', invitar: 'invitar' };
  if (labels[action]) {
    await ix.reply({
      content: `Elige el usuario a **${labels[action]}**:`,
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`${PREFIX}:user:${action}:${channelId}`)
            .setPlaceholder('Selecciona un usuario')
            .setMinValues(1)
            .setMaxValues(1),
        ),
      ],
      ephemeral: true,
    });
  }
}

async function handleUserSelect(ix, getDb, client) {
  const parts = ix.customId.split(':');
  const action = parts[2];
  const channelId = parts[3];
  const tempRow = getTempChannel(getDb, channelId);
  if (!canControlChannel(ix, tempRow)) {
    await ix.reply({ content: '❌ Sin permiso.', ephemeral: true });
    return;
  }

  const targetId = ix.values[0];
  const ch = await ix.guild.channels.fetch(gid(channelId)).catch(() => null);
  if (!ch?.isVoiceBased()) {
    await ix.reply({ content: '❌ Canal no encontrado.', ephemeral: true });
    return;
  }

  if (action === 'permitir' || action === 'invitar') {
    await ch.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
    });
    const link = `https://discord.com/channels/${ix.guildId}/${channelId}`;
    if (action === 'invitar') {
      const user = await client.users.fetch(targetId).catch(() => null);
      if (user) {
        await user
          .send(`📨 **${ix.member.displayName}** te invita a **${ch.name}**:\n${link}`)
          .catch(() => {});
      }
    }
    await ix.update({
      content: action === 'invitar' ? `📨 Invitación enviada a <@${targetId}>.` : `✅ <@${targetId}> puede entrar.`,
      components: [],
    });
    return;
  }

  if (action === 'rechazar') {
    await ch.permissionOverwrites.edit(targetId, { Connect: false, Speak: false });
    const member = await ix.guild.members.fetch(targetId).catch(() => null);
    if (member?.voice?.channelId === gid(channelId)) {
      await member.voice.disconnect('Rechazado de la sala').catch(() => {});
    }
    await ix.update({ content: `⛔ <@${targetId}> rechazado.`, components: [] });
  }
}

async function handleModalSubmit(ix, getDb, client, log) {
  const parts = ix.customId.split(':');
  const kind = parts[2];
  const channelId = parts[3];
  const tempRow = getTempChannel(getDb, channelId);
  if (!canControlChannel(ix, tempRow)) {
    await ix.reply({ content: '❌ Sin permiso.', ephemeral: true });
    return;
  }

  const ch = await ix.guild.channels.fetch(gid(channelId)).catch(() => null);
  if (!ch?.isVoiceBased()) {
    await ix.reply({ content: '❌ Canal no encontrado.', ephemeral: true });
    return;
  }

  const raw = ix.fields.getTextInputValue('valor')?.trim() ?? '';

  if (kind === 'nombre') {
    const name = sanitizeChannelName(raw);
    await ch.setName(name);
    await ix.reply({ content: `📝 Nombre actualizado: **${name}**`, ephemeral: true });
    return;
  }

  if (kind === 'limite') {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      await ix.reply({ content: '❌ Introduce un número entre 0 y 99.', ephemeral: true });
      return;
    }
    await ch.setUserLimit(n);
    await ix.reply({
      content: n === 0 ? '👥 Sin límite de usuarios.' : `👥 Límite: **${n}** usuarios.`,
      ephemeral: true,
    });
    return;
  }

  if (kind === 'estado') {
    try {
      await setVoiceChannelStatus(client, channelId, raw);
      await ix.reply({
        content: raw ? `💬 Estado actualizado.` : `💬 Estado eliminado.`,
        ephemeral: true,
      });
    } catch (e) {
      log.warn(`[voces] voice-status ${channelId}: ${e.message}`);
      await ix.reply({
        content: `❌ No se pudo cambiar el estado. ¿El bot tiene permiso de gestionar canales?\n\`${e.message}\``,
        ephemeral: true,
      });
    }
  }
}

function collectRolesFromOptions(ix) {
  const ids = [];
  for (const key of ['rol', 'rol_2', 'rol_3', 'rol_4', 'rol_5']) {
    const r = ix.options.getRole(key);
    if (r) ids.push(r.id);
  }
  return [...new Set(ids)];
}

const configurarAutovoz = new SlashCommandBuilder()
  .setName('configurar_autovoz')
  .setDescription('Configura canales de voz automáticos (join-to-create)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) =>
    o
      .setName('categoria')
      .setDescription('Categoría donde se creará el hub y las salas')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('modo_nombre')
      .setDescription('Cómo nombrar las salas nuevas')
      .setRequired(true)
      .addChoices(
        { name: 'Por nombre del creador', value: 'username' },
        { name: 'Por número secuencial', value: 'sequence' },
      ),
  )
  .addRoleOption((o) =>
    o
      .setName('rol')
      .setDescription('Rol con acceso (opcional; sin roles = público)')
      .setRequired(false),
  )
  .addRoleOption((o) => o.setName('rol_2').setDescription('Rol adicional (opcional)'))
  .addRoleOption((o) => o.setName('rol_3').setDescription('Rol adicional (opcional)'))
  .addRoleOption((o) => o.setName('rol_4').setDescription('Rol adicional (opcional)'))
  .addRoleOption((o) => o.setName('rol_5').setDescription('Rol adicional (opcional)'));

module.exports = {
  id: 'voces',
  getConfig,
  saveConfig,
  applyVocesSetup,

  commands: [
    {
      data: configurarAutovoz,
      async run(ix, { getDb, log }) {
        const category = ix.options.getChannel('categoria');
        const namingMode = ix.options.getString('modo_nombre');
        const allowedRoleIds = collectRolesFromOptions(ix);

        await ix.deferReply({ ephemeral: true });
        try {
          const result = await applyVocesSetup(ix.client, getDb, ix.guildId, log, {
            categoryId: category.id,
            namingMode,
            allowedRoleIds,
            enabled: true,
          });
          const modeLabel =
            result.namingMode === 'sequence' ? 'Número secuencial' : 'Nombre del creador';
          const accessLabel = isPrivateVoces(result.allowedRoleIds)
            ? `Privado — ${result.allowedRoleIds.map((id) => `<@&${id}>`).join(', ')}`
            : 'Público — cualquier miembro del servidor';
          await ix.editReply({
            content:
              `✅ **Auto voz** configurado\n` +
              `📁 Categoría: **${category.name}**\n` +
              `📝 Modo nombre: **${modeLabel}**\n` +
              `🔐 Acceso: ${accessLabel}\n` +
              `🔊 Hub: <#${result.hubChannelId}> (\`${HUB_NAME}\`)`,
          });
        } catch (e) {
          await ix.editReply({ content: `❌ ${e.message}` });
        }
      },
    },
  ],

  onGuildRemove(guildId, { getDb }) {
    const id = gid(guildId);
    getDb().prepare('DELETE FROM voces_temp_channels WHERE guild_id = ?').run(id);
    getDb().prepare('DELETE FROM voces_config WHERE guild_id = ?').run(id);
  },

  onInit(client, { getDb, log }) {
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      try {
        const guildId = newState.guild?.id || oldState.guild?.id;
        if (!guildId) return;
        if (!isModuleEnabled(getDb, guildId, 'voces')) return;

        const cfg = getConfig(getDb, guildId);
        if (!cfg?.enabled || !cfg.hubChannelId) return;

        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const joinedId = newState.channelId;
        const leftId = oldState.channelId;

        if (joinedId && gid(joinedId) === gid(cfg.hubChannelId)) {
          await handleHubJoin(client, getDb, member, cfg, log);
        }

        if (leftId && getTempChannel(getDb, leftId)) {
          await handleTempLeave(client, getDb, guildId, leftId, log);
        }

        if (joinedId && getTempChannel(getDb, joinedId) && gid(joinedId) !== gid(cfg.hubChannelId)) {
          const temp = getTempChannel(getDb, joinedId);
          if (temp && !memberHasAllowedRole(member, cfg.allowedRoleIds)) {
            const ownerOk = gid(temp.owner_id) === gid(member.id);
            const ow = await newState.channel?.permissionOverwrites?.cache?.get(member.id);
            const hasAllow = ow?.allow?.has(PermissionFlagsBits.Connect);
            if (!ownerOk && !hasAllow) {
              await member.voice.disconnect('Sin permiso para esta sala').catch(() => {});
            }
          }
        }
      } catch (e) {
        log.warn(`[voces] VoiceStateUpdate: ${e.message}`);
      }
    });

    log.info('Auto voz: hub join-to-create activo');

    client.on(Events.ChannelDelete, (channel) => {
      if (!channel.guildId || channel.type !== ChannelType.GuildVoice) return;
      const row = getTempChannel(getDb, channel.id);
      if (!row) return;
      deleteTempChannelRow(getDb, channel.id);
      const remaining = listActiveTempChannels(getDb, channel.guildId);
      if (!remaining.length) setSequenceCounter(getDb, channel.guildId, 0);
    });
  },

  async handleInteraction(ix, { getDb, log }) {
    if (ix.isChatInputCommand() && ix.commandName === 'configurar_autovoz') {
      const cmd = module.exports.commands[0];
      await cmd.run(ix, { getDb, log });
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId.startsWith(`${PREFIX}:cfg:`)) {
      await handleConfigSelect(ix, getDb, log);
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId.startsWith(`${PREFIX}:perm:`)) {
      await handlePermSelect(ix, getDb);
      return true;
    }

    if (ix.isUserSelectMenu() && ix.customId.startsWith(`${PREFIX}:user:`)) {
      await handleUserSelect(ix, getDb, ix.client);
      return true;
    }

    if (ix.isModalSubmit() && ix.customId.startsWith(`${PREFIX}:modal:`)) {
      await handleModalSubmit(ix, getDb, ix.client, log);
      return true;
    }

    return false;
  },
};
