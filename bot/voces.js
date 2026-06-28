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
  MessageFlags,
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

function hubFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    categoryId: row.category_id,
    hubChannelId: row.hub_channel_id,
    namingMode: row.naming_mode || 'username',
    allowedRoleIds: parseRoleIds(row.allowed_role_ids),
    sequenceCounter: row.sequence_counter || 0,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

function listHubs(getDb, guildId) {
  return getDb()
    .prepare('SELECT * FROM voces_hubs WHERE guild_id = ? ORDER BY id ASC')
    .all(gid(guildId))
    .map(hubFromRow);
}

function listEnabledHubs(getDb, guildId) {
  return listHubs(getDb, guildId).filter((h) => h.enabled && h.hubChannelId);
}

function getHubById(getDb, hubId) {
  const row = getDb().prepare('SELECT * FROM voces_hubs WHERE id = ?').get(Number(hubId));
  return hubFromRow(row);
}

function getHubByChannelId(getDb, channelId) {
  const row = getDb()
    .prepare('SELECT * FROM voces_hubs WHERE hub_channel_id = ?')
    .get(gid(channelId));
  return hubFromRow(row);
}

function getHubForTemp(getDb, tempRow) {
  if (!tempRow?.hub_id) return null;
  return getHubById(getDb, tempRow.hub_id);
}

function insertHubRow(getDb, data) {
  const r = getDb()
    .prepare(`
      INSERT INTO voces_hubs (
        guild_id, hub_channel_id, category_id, naming_mode, allowed_role_ids, sequence_counter, enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      gid(data.guildId),
      gid(data.hubChannelId),
      gid(data.categoryId),
      data.namingMode || 'username',
      JSON.stringify(data.allowedRoleIds || []),
      data.sequenceCounter ?? 0,
      data.enabled === false ? 0 : 1,
      data.createdAt ?? Date.now(),
    );
  return getHubById(getDb, r.lastInsertRowid);
}

function updateHubRow(getDb, hubId, data) {
  const prev = getHubById(getDb, hubId);
  if (!prev) return null;
  getDb()
    .prepare(`
      UPDATE voces_hubs SET
        hub_channel_id = ?,
        category_id = ?,
        naming_mode = ?,
        allowed_role_ids = ?,
        sequence_counter = ?,
        enabled = ?
      WHERE id = ?
    `)
    .run(
      data.hubChannelId != null ? gid(data.hubChannelId) : gid(prev.hubChannelId),
      data.categoryId != null ? gid(data.categoryId) : gid(prev.categoryId),
      data.namingMode != null ? data.namingMode : prev.namingMode,
      JSON.stringify(data.allowedRoleIds != null ? data.allowedRoleIds : prev.allowedRoleIds),
      data.sequenceCounter != null ? data.sequenceCounter : prev.sequenceCounter,
      data.enabled === false ? 0 : data.enabled === true ? 1 : prev.enabled ? 1 : 0,
      Number(hubId),
    );
  return getHubById(getDb, hubId);
}

function deleteHubRow(getDb, hubId) {
  getDb().prepare('DELETE FROM voces_hubs WHERE id = ?').run(Number(hubId));
}

/** @deprecated usar listHubs — compatibilidad mínima */
function getConfig(getDb, guildId) {
  const hubs = listHubs(getDb, guildId);
  return hubs[0] || null;
}

function setSequenceCounter(getDb, hubId, value) {
  getDb().prepare('UPDATE voces_hubs SET sequence_counter = ? WHERE id = ?').run(value, Number(hubId));
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

function listActiveTempChannelsForHub(getDb, hubId) {
  return getDb()
    .prepare('SELECT * FROM voces_temp_channels WHERE hub_id = ?')
    .all(Number(hubId));
}

function getTempByOwner(getDb, guildId, ownerId) {
  return getDb()
    .prepare('SELECT * FROM voces_temp_channels WHERE guild_id = ? AND owner_id = ?')
    .get(gid(guildId), gid(ownerId));
}

function insertTempChannel(getDb, { channelId, guildId, hubId, ownerId, sequenceNumber, controlMessageId }) {
  getDb()
    .prepare(`
      INSERT INTO voces_temp_channels (channel_id, guild_id, hub_id, owner_id, sequence_number, control_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      gid(channelId),
      gid(guildId),
      hubId != null ? Number(hubId) : null,
      gid(ownerId),
      sequenceNumber ?? null,
      controlMessageId ? gid(controlMessageId) : null,
      Date.now(),
    );
}

function deleteTempChannelRow(getDb, channelId) {
  getDb().prepare('DELETE FROM voces_temp_channels WHERE channel_id = ?').run(gid(channelId));
}

function nextSequenceNumber(getDb, hubId) {
  const hub = getHubById(getDb, hubId);
  const peak = hub?.sequenceCounter || 0;
  const active = listActiveTempChannelsForHub(getDb, hubId);
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
      { label: 'Bloquear', description: 'Nadie más puede entrar', value: 'bloquear', emoji: '🔒' },
      { label: 'Desbloquear', description: 'Permitir entrar a roles configurados', value: 'desbloquear', emoji: '🔓' },
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

async function createHubChannel(client, guildId, log, { categoryId, allowedRoleIds }) {
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

  const hub = await guild.channels.create({
    name: HUB_NAME,
    type: ChannelType.GuildVoice,
    parent,
    reason: 'Nexus — hub auto voz',
    permissionOverwrites: buildHubOverwrites(guild, allowedRoleIds),
  });

  return hub.id;
}

async function syncHubChannel(client, guildId, log, hub) {
  const guild = await client.guilds.fetch(gid(guildId)).catch(() => null);
  if (!guild) throw new Error('Servidor no encontrado');

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('El bot necesita permiso **Gestionar canales**');
  }

  const parent =
    hub.categoryId && guild.channels.cache.get(gid(hub.categoryId))?.type === ChannelType.GuildCategory
      ? gid(hub.categoryId)
      : null;
  if (!parent) throw new Error('Categoría no válida');

  let channel = hub.hubChannelId ? guild.channels.cache.get(gid(hub.hubChannelId)) : null;
  if (channel && channel.type !== ChannelType.GuildVoice) channel = null;

  if (channel) {
    await channel.edit({
      parent,
      permissionOverwrites: buildHubOverwrites(guild, hub.allowedRoleIds),
    });
    return channel.id;
  }

  return createHubChannel(client, guildId, log, {
    categoryId: hub.categoryId,
    allowedRoleIds: hub.allowedRoleIds,
  });
}

async function createHub(client, getDb, guildId, log, opts) {
  const { categoryId, namingMode, allowedRoleIds = [], enabled = true } = opts;
  if (!categoryId) throw new Error('La categoría es obligatoria');

  const hubChannelId = await createHubChannel(client, guildId, log, { categoryId, allowedRoleIds });
  const hub = insertHubRow(getDb, {
    guildId,
    hubChannelId,
    categoryId,
    namingMode: namingMode === 'sequence' ? 'sequence' : 'username',
    allowedRoleIds,
    sequenceCounter: 0,
    enabled,
  });

  return hub;
}

async function updateHub(client, getDb, guildId, hubId, log, opts) {
  const prev = getHubById(getDb, hubId);
  if (!prev || gid(prev.guildId) !== gid(guildId)) throw new Error('Hub no encontrado');

  const categoryId = opts.categoryId != null ? gid(opts.categoryId) : prev.categoryId;
  const namingMode = opts.namingMode === 'sequence' ? 'sequence' : opts.namingMode === 'username' ? 'username' : prev.namingMode;
  const allowedRoleIds = Array.isArray(opts.allowedRoleIds) ? opts.allowedRoleIds : prev.allowedRoleIds;
  const enabled = opts.enabled !== undefined ? opts.enabled !== false : prev.enabled;

  const draft = {
    ...prev,
    categoryId,
    namingMode,
    allowedRoleIds,
    enabled,
  };

  const hubChannelId = await syncHubChannel(client, guildId, log, draft);
  return updateHubRow(getDb, hubId, {
    hubChannelId,
    categoryId,
    namingMode,
    allowedRoleIds,
    enabled,
  });
}

async function deleteHub(client, getDb, guildId, hubId, log) {
  const hub = getHubById(getDb, hubId);
  if (!hub || gid(hub.guildId) !== gid(guildId)) throw new Error('Hub no encontrado');

  if (hub.hubChannelId) {
    try {
      const ch = await client.channels.fetch(gid(hub.hubChannelId)).catch(() => null);
      if (ch) await ch.delete('Nexus — eliminar hub auto voz');
    } catch (e) {
      log.warn(`[voces] Borrar hub ${hub.hubChannelId}: ${e.message}`);
    }
  }

  deleteHubRow(getDb, hubId);
}

/** Compat: crear hub (antes applyVocesSetup reemplazaba el único hub) */
async function applyVocesSetup(client, getDb, guildId, log, opts) {
  const hub = await createHub(client, getDb, guildId, log, opts);
  return {
    hubId: hub.id,
    hubChannelId: hub.hubChannelId,
    namingMode: hub.namingMode,
    allowedRoleIds: hub.allowedRoleIds,
  };
}

async function deleteTempChannel(client, getDb, guildId, channelId, log) {
  const row = getTempChannel(getDb, channelId);
  if (!row) return;

  const hubId = row.hub_id;
  deleteTempChannelRow(getDb, channelId);

  if (hubId) {
    const remaining = listActiveTempChannelsForHub(getDb, hubId);
    if (!remaining.length) setSequenceCounter(getDb, hubId, 0);
  }

  try {
    const ch = await client.channels.fetch(gid(channelId)).catch(() => null);
    if (ch) await ch.delete('Nexus — sala temporal vacía');
  } catch (e) {
    log.warn(`[voces] Borrar temporal ${channelId}: ${e.message}`);
  }
}

async function createTempChannel(client, getDb, member, hub, log) {
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

    if (hub.namingMode === 'sequence') {
      sequenceNumber = nextSequenceNumber(getDb, hub.id);
      channelName = `Sala ${sequenceNumber}`;
      const current = getHubById(getDb, hub.id);
      setSequenceCounter(getDb, hub.id, Math.max(current?.sequenceCounter || 0, sequenceNumber));
    } else {
      channelName = sanitizeChannelName(member.displayName || member.user.username);
    }

    const tempChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: hub.categoryId,
      reason: `Nexus auto voz — ${member.user.tag}`,
      permissionOverwrites: buildTempOverwrites(guild, userId, hub.allowedRoleIds),
    });

    const controlMessageId = await sendControlPanel(client, tempChannel, userId, log);

    insertTempChannel(getDb, {
      channelId: tempChannel.id,
      guildId,
      hubId: hub.id,
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

async function handleHubJoin(client, getDb, member, hub, log) {
  if (!memberHasAllowedRole(member, hub.allowedRoleIds)) {
    await member.voice.disconnect('Sin rol para crear salas de voz').catch(() => {});
    return;
  }
  await createTempChannel(client, getDb, member, hub, log);
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

function hubChannelIdSet(hubs) {
  return new Set(hubs.map((h) => gid(h.hubChannelId)).filter(Boolean));
}

async function handleConfigSelect(ix, getDb, log) {
  const channelId = ix.customId.split(':')[2];
  const tempRow = getTempChannel(getDb, channelId);
  if (!canControlChannel(ix, tempRow)) {
    await ix.reply({ content: '❌ Solo el creador de la sala o un admin puede usar esto.', flags: MessageFlags.Ephemeral });
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
    await ix.reply({ content: '❌ Solo el creador de la sala o un admin puede usar esto.', flags: MessageFlags.Ephemeral });
    return;
  }

  const hub = getHubForTemp(getDb, tempRow);

  const action = ix.values[0];
  const ch = await ix.guild.channels.fetch(gid(channelId)).catch(() => null);
  if (!ch?.isVoiceBased()) {
    await ix.reply({ content: '❌ Canal no encontrado.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'bloquear') {
    await ch.permissionOverwrites.edit(ix.guild.id, { Connect: false });
    if (hub && isPrivateVoces(hub.allowedRoleIds)) {
      for (const rid of hub.allowedRoleIds) {
        await ch.permissionOverwrites.edit(rid, { Connect: false }).catch(() => {});
      }
    }
    await ix.reply({
      content: '🔒 Canal bloqueado. Nadie más puede entrar.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'desbloquear') {
    if (hub && isPrivateVoces(hub.allowedRoleIds)) {
      await ch.permissionOverwrites.edit(ix.guild.id, { Connect: false });
      for (const rid of hub.allowedRoleIds) {
        await ch.permissionOverwrites
          .edit(rid, { ViewChannel: true, Connect: true, Speak: true })
          .catch(() => {});
      }
      await ix.reply({
        content: '🔓 Roles configurados pueden entrar de nuevo.',
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ch.permissionOverwrites.edit(ix.guild.id, { Connect: true, Speak: true });
      await ix.reply({
        content: '🔓 Canal desbloqueado. Cualquiera puede entrar.',
        flags: MessageFlags.Ephemeral,
      });
    }
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
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleUserSelect(ix, getDb, client) {
  const parts = ix.customId.split(':');
  const action = parts[2];
  const channelId = parts[3];
  const tempRow = getTempChannel(getDb, channelId);
  if (!canControlChannel(ix, tempRow)) {
    await ix.reply({ content: '❌ Sin permiso.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetId = ix.values[0];
  const ch = await ix.guild.channels.fetch(gid(channelId)).catch(() => null);
  if (!ch?.isVoiceBased()) {
    await ix.reply({ content: '❌ Canal no encontrado.', flags: MessageFlags.Ephemeral });
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
    await ix.reply({ content: '❌ Sin permiso.', flags: MessageFlags.Ephemeral });
    return;
  }

  const ch = await ix.guild.channels.fetch(gid(channelId)).catch(() => null);
  if (!ch?.isVoiceBased()) {
    await ix.reply({ content: '❌ Canal no encontrado.', flags: MessageFlags.Ephemeral });
    return;
  }

  const raw = ix.fields.getTextInputValue('valor')?.trim() ?? '';

  if (kind === 'nombre') {
    const name = sanitizeChannelName(raw);
    await ch.setName(name);
    await ix.reply({ content: `📝 Nombre actualizado: **${name}**`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (kind === 'limite') {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      await ix.reply({ content: '❌ Introduce un número entre 0 y 99.', flags: MessageFlags.Ephemeral });
      return;
    }
    await ch.setUserLimit(n);
    await ix.reply({
      content: n === 0 ? '👥 Sin límite de usuarios.' : `👥 Límite: **${n}** usuarios.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (kind === 'estado') {
    try {
      await setVoiceChannelStatus(client, channelId, raw);
      await ix.reply({
        content: raw ? `💬 Estado actualizado.` : `💬 Estado eliminado.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      log.warn(`[voces] voice-status ${channelId}: ${e.message}`);
      await ix.reply({
        content: `❌ No se pudo cambiar el estado. ¿El bot tiene permiso de gestionar canales?\n\`${e.message}\``,
        flags: MessageFlags.Ephemeral,
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

function formatHubAccess(allowedRoleIds) {
  return isPrivateVoces(allowedRoleIds)
    ? `Privado — ${allowedRoleIds.map((id) => `<@&${id}>`).join(', ')}`
    : 'Público — cualquier miembro del servidor';
}

const configurarAutovoz = new SlashCommandBuilder()
  .setName('configurar_autovoz')
  .setDescription('Canales de voz automáticos (join-to-create)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName('crear')
      .setDescription('Añade un nuevo hub ➕ Crear canal')
      .addChannelOption((o) =>
        o
          .setName('categoria')
          .setDescription('Categoría del hub y salas temporales')
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
        o.setName('rol').setDescription('Rol con acceso (opcional; sin roles = público)').setRequired(false),
      )
      .addRoleOption((o) => o.setName('rol_2').setDescription('Rol adicional (opcional)'))
      .addRoleOption((o) => o.setName('rol_3').setDescription('Rol adicional (opcional)'))
      .addRoleOption((o) => o.setName('rol_4').setDescription('Rol adicional (opcional)'))
      .addRoleOption((o) => o.setName('rol_5').setDescription('Rol adicional (opcional)')),
  )
  .addSubcommand((sc) => sc.setName('listar').setDescription('Muestra los hubs de auto voz configurados'))
  .addSubcommand((sc) =>
    sc
      .setName('eliminar')
      .setDescription('Elimina un hub de auto voz')
      .addChannelOption((o) =>
        o
          .setName('hub')
          .setDescription('Canal hub a eliminar')
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      ),
  );

async function runConfigurarAutovoz(ix, { getDb, log }) {
  const sub = ix.options.getSubcommand();

  if (sub === 'listar') {
    const hubs = listHubs(getDb, ix.guildId);
    if (!hubs.length) {
      await ix.reply({ content: 'No hay hubs de auto voz configurados.', flags: MessageFlags.Ephemeral });
      return;
    }
    const lines = hubs.map((h) => {
      const mode = h.namingMode === 'sequence' ? 'Secuencial' : 'Nombre creador';
      const st = h.enabled ? '✅' : '⏸';
      const ch = h.hubChannelId ? `<#${h.hubChannelId}>` : '—';
      return `${st} **#${h.id}** ${ch} · cat \`${h.categoryId}\` · ${mode} · ${formatHubAccess(h.allowedRoleIds)}`;
    });
    await ix.reply({
      content: `**Hubs auto voz (${hubs.length})**\n${lines.join('\n')}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'eliminar') {
    const ch = ix.options.getChannel('hub');
    const hub = getHubByChannelId(getDb, ch.id);
    if (!hub || gid(hub.guildId) !== gid(ix.guildId)) {
      await ix.reply({ content: '❌ Ese canal no es un hub de auto voz de Nexus.', flags: MessageFlags.Ephemeral });
      return;
    }
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await deleteHub(ix.client, getDb, ix.guildId, hub.id, log);
      await ix.editReply({ content: `✅ Hub eliminado (<#${ch.id}>).` });
    } catch (e) {
      await ix.editReply({ content: `❌ ${e.message}` });
    }
    return;
  }

  if (sub === 'crear') {
    const category = ix.options.getChannel('categoria');
    const namingMode = ix.options.getString('modo_nombre');
    const allowedRoleIds = collectRolesFromOptions(ix);

    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const hub = await createHub(ix.client, getDb, ix.guildId, log, {
        categoryId: category.id,
        namingMode,
        allowedRoleIds,
        enabled: true,
      });
      const modeLabel = hub.namingMode === 'sequence' ? 'Número secuencial' : 'Nombre del creador';
      await ix.editReply({
        content:
          `✅ **Hub auto voz** creado (#${hub.id})\n` +
          `📁 Categoría: **${category.name}**\n` +
          `📝 Modo nombre: **${modeLabel}**\n` +
          `🔐 Acceso: ${formatHubAccess(hub.allowedRoleIds)}\n` +
          `🔊 Hub: <#${hub.hubChannelId}> (\`${HUB_NAME}\`)`,
      });
    } catch (e) {
      await ix.editReply({ content: `❌ ${e.message}` });
    }
  }
}

module.exports = {
  id: 'voces',
  listHubs,
  getHubById,
  getHubByChannelId,
  getConfig,
  createHub,
  updateHub,
  deleteHub,
  applyVocesSetup,

  commands: [
    {
      data: configurarAutovoz,
      run: runConfigurarAutovoz,
    },
  ],

  onGuildRemove(guildId, { getDb }) {
    const id = gid(guildId);
    getDb().prepare('DELETE FROM voces_temp_channels WHERE guild_id = ?').run(id);
    getDb().prepare('DELETE FROM voces_hubs WHERE guild_id = ?').run(id);
    getDb().prepare('DELETE FROM voces_config WHERE guild_id = ?').run(id);
  },

  onInit(client, { getDb, log }) {
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      try {
        const guildId = newState.guild?.id || oldState.guild?.id;
        if (!guildId) return;
        if (!isModuleEnabled(getDb, guildId, 'voces')) return;

        const enabledHubs = listEnabledHubs(getDb, guildId);
        if (!enabledHubs.length) return;

        const hubIds = hubChannelIdSet(enabledHubs);

        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const joinedId = newState.channelId;
        const leftId = oldState.channelId;

        if (joinedId) {
          const joinedHub = enabledHubs.find((h) => gid(h.hubChannelId) === gid(joinedId));
          if (joinedHub) {
            await handleHubJoin(client, getDb, member, joinedHub, log);
          }
        }

        if (leftId && getTempChannel(getDb, leftId)) {
          await handleTempLeave(client, getDb, guildId, leftId, log);
        }

        if (joinedId && getTempChannel(getDb, joinedId) && !hubIds.has(gid(joinedId))) {
          const temp = getTempChannel(getDb, joinedId);
          const hub = getHubForTemp(getDb, temp);
          const roleIds = hub?.allowedRoleIds || [];
          if (hub && !memberHasAllowedRole(member, roleIds)) {
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

      const hub = getHubByChannelId(getDb, channel.id);
      if (hub) {
        deleteHubRow(getDb, hub.id);
        return;
      }

      const row = getTempChannel(getDb, channel.id);
      if (!row) return;

      const hubId = row.hub_id;
      deleteTempChannelRow(getDb, channel.id);
      if (hubId) {
        const remaining = listActiveTempChannelsForHub(getDb, hubId);
        if (!remaining.length) setSequenceCounter(getDb, hubId, 0);
      }
    });
  },

  async handleInteraction(ix, { getDb, log }) {
    if (ix.isChatInputCommand() && ix.commandName === 'configurar_autovoz') {
      await runConfigurarAutovoz(ix, { getDb, log });
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
