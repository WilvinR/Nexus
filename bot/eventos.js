const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { randomUUID } = require('crypto');

const PREFIX = 'evt';
const pending = new Map();
const pendingRolePick = new Map();
const imageUploadWait = new Map();
const cache = new Map();
const timers = new Map();

const ALLOWED_COLORS = {
  rojo: 0xff0000,
  verde: 0x008000,
  azul: 0x0000ff,
  amarillo: 0xffff00,
  naranja: 0xffa500,
  morado: 0x800080,
  rosa: 0xffc0cb,
  turquesa: 0x40e0d0,
  celeste: 0x87ceeb,
  gris: 0x808080,
  violeta: 0xee82ee,
  cian: 0x00ffff,
  magenta: 0xff00ff,
  lima: 0x32cd32,
  teal: 0x008080,
  coral: 0xff7f50,
  gold: 0xffd700,
  discord: 0x5865f2,
};

function gid(id) {
  return String(id);
}

function toSerifBold(text) {
  return String(text)
    .split('')
    .map((c) => {
      const code = c.codePointAt(0);
      if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d400 + (code - 0x41));
      if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(0x1d41a + (code - 0x61));
      if (code >= 0x30 && code <= 0x39) return String.fromCodePoint(0x1d7ce + (code - 0x30));
      return c;
    })
    .join('');
}

function toBoldSans(text) {
  return String(text)
    .split('')
    .map((c) => {
      const code = c.codePointAt(0);
      if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d5d4 + (code - 0x41));
      if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(0x1d5ee + (code - 0x61));
      if (code >= 0x30 && code <= 0x39) return String.fromCodePoint(0x1d7ec + (code - 0x30));
      return c;
    })
    .join('');
}

function parseTimeUtc(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0));
  if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

function timeRemaining(ts) {
  const d = ts - Math.floor(Date.now() / 1000);
  if (d <= 0) return '00:00:00';
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatRoleEmoji(data) {
  if (data?.emojiId) return `<:${data.emojiName || 'emoji'}:${data.emojiId}>`;
  return data?.emoji || '⭐';
}

function selectMenuEmoji(data) {
  if (data?.emojiId) return { id: String(data.emojiId), name: data.emojiName || 'emoji' };
  const em = data?.emoji;
  if (em && typeof em === 'string' && em.length <= 4) return em;
  return undefined;
}

function roleKey(name, existing) {
  let base = String(name || 'rol')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '')
    .slice(0, 40) || 'rol';
  if (!existing[base]) return base;
  let i = 2;
  while (existing[`${base}_${i}`]) i++;
  return `${base}_${i}`;
}

function normalizeRoles(body) {
  if (Array.isArray(body.roles) && body.roles.length) {
    const roles = {};
    for (const r of body.roles) {
      const name = String(r.name || '').trim();
      if (!name) continue;
      const key = roleKey(name, roles);
      roles[key] = {
        name,
        emojiId: r.emojiId ? String(r.emojiId) : null,
        emojiName: r.emojiName ? String(r.emojiName) : null,
        emoji: r.emojiId ? null : String(r.emoji || '⭐'),
        users: [],
        required: Math.max(0, parseInt(r.required, 10) || 0),
      };
    }
    if (!roles.Ausente) {
      roles.Ausente = { emoji: '❌', users: [], required: 0, name: 'Ausente' };
    }
    return roles;
  }
  return parseRoles(String(body.rolesText || body.roles || ''));
}

function parseRoles(text) {
  const roles = {};
  for (const entry of text.split(',')) {
    const parts = entry.trim().split(':');
    if (parts.length < 3) continue;
    const [name, emoji, req] = parts;
    roles[name.trim()] = { emoji: emoji.trim(), users: [], required: parseInt(req, 10) || 0, name: name.trim() };
  }
  if (!roles.Ausente) roles.Ausente = { emoji: '❌', users: [], required: 0, name: 'Ausente' };
  return roles;
}

function rolesDisplay(roles) {
  let out = '';
  for (const [key, data] of Object.entries(roles)) {
    if (key === 'Ausente') continue;
    const assigned = (data.users || []).length;
    const req = data.required || 0;
    out += `**★-${toBoldSans(String(data.name || key).charAt(0).toUpperCase() + String(data.name || key).slice(1))}** ${formatRoleEmoji(data)} (${assigned}/${req})\n`;
    if (data.users?.length) out += `${data.users.join('\n')}\n`;
  }
  const aus = roles.Ausente;
  if (aus?.users?.length) {
    out += `\n**★-${toBoldSans('Ausente')}** ${formatRoleEmoji(aus)} (${aus.users.length}/0)\n${aus.users.join('\n')}\n`;
  }
  return out.trim() || 'No roles asignados.';
}

const EVENT_IMAGE_BASENAME = 'evento-banner';

function imageUploadFromBase64(base64, imageName) {
  const raw = String(base64 || '').includes(',') ? String(base64).split(',').pop() : String(base64 || '');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new Error('Imagen inválida o vacía');

  let ext = 'png';
  if (imageName && /\.(png|jpe?g|gif|webp)$/i.test(imageName)) {
    ext = imageName.split('.').pop().toLowerCase().replace('jpeg', 'jpg');
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8) ext = 'jpg';
  else if (buffer[0] === 0x47 && buffer[1] === 0x49) ext = 'gif';
  else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[8] === 0x57) ext = 'webp';

  const filename = `${EVENT_IMAGE_BASENAME}.${ext}`;
  return { buffer, filename };
}

function resolveEmbedImage(ev, message) {
  const attachmentName = ev.image_file || `${EVENT_IMAGE_BASENAME}.png`;
  const hasAttachment = message?.attachments?.some?.((a) => a.name === attachmentName);
  if (hasAttachment) return `attachment://${attachmentName}`;
  if (ev.image_url) return ev.image_url;
  if (ev.has_event_image) return `attachment://${attachmentName}`;
  return null;
}

function buildEmbed(ev, message) {
  const color = ev.embed_color ?? 0x5865f2;
  const desc = (ev.description || '').trim();
  const rawName = String(ev.name || 'Evento').trim();
  const title = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const embed = new EmbedBuilder()
    .setTitle(toSerifBold(title))
    .setDescription(desc ? `**${desc}**` : '*Sin descripción*')
    .setColor(color);

  const ts = ev.event_timestamp || 0;
  embed.addFields(
    {
      name: '🕐 Hora del evento',
      value: `\`${ev.time || '??:??'} UTC\`\u3000\u3000\u3000\u3000\u3000\u3000Local: <t:${ts}:t>`,
      inline: false,
    },
    {
      name: '⏳ Tiempo restante',
      value: ev.expired ? '```\n⛔  Evento finalizado\n```' : `\`\`\`\n${timeRemaining(ts)}\n\`\`\``,
      inline: false,
    },
    {
      name: '🔊 Canal de Voz',
      value: ev.voice_channel_id ? `<#${ev.voice_channel_id}>` : 'No especificado',
      inline: true,
    },
    { name: '📍 Lugar', value: ev.location || 'No especificado', inline: true },
  );

  const roles = ev.roles || {};
  const inscritos = Object.entries(roles)
    .filter(([k]) => k !== 'Ausente')
    .reduce((s, [, d]) => s + (d.users?.length || 0), 0);
  embed.addFields({
    name: `👥 Roles  •  ${inscritos} inscrito${inscritos !== 1 ? 's' : ''}`,
    value: rolesDisplay(roles),
    inline: false,
  });

  const image = resolveEmbedImage(ev, message);
  if (image) embed.setImage(image);

  if (ev.creator) embed.setFooter({ text: `Evento organizado por ${ev.creator}` });
  return embed;
}

async function refreshEventMessage(message, ev, messageId) {
  await message.edit({
    embeds: [buildEmbed(ev, message)],
    components: [roleSelectRow(messageId, ev.roles)],
  });
}

function roleSelectRow(messageId, roles) {
  const options = Object.entries(roles).map(([key, data]) => {
    const opt = {
      label: (data.name || key).slice(0, 100),
      value: key,
      description: key === 'Ausente' ? 'Marcarme ausente' : `${(data.users || []).length}/${data.required || 0}`,
    };
    const em = selectMenuEmoji(data);
    if (em) opt.emoji = em;
    return opt;
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:role:${messageId}`)
      .setPlaceholder('Selecciona tu rol')
      .addOptions(options.slice(0, 25)),
  );
}

function saveEvent(getDb, messageId, ev) {
  getDb()
    .prepare(`
      INSERT INTO eventos (message_id, guild_id, channel_id, data_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET data_json = excluded.data_json
    `)
    .run(gid(messageId), gid(ev.guild_id), gid(ev.channel_id), JSON.stringify(ev));
  cache.set(gid(messageId), ev);
}

function deleteEvent(getDb, messageId) {
  getDb().prepare('DELETE FROM eventos WHERE message_id = ?').run(gid(messageId));
  cache.delete(gid(messageId));
  if (timers.has(gid(messageId))) {
    clearInterval(timers.get(gid(messageId)));
    timers.delete(gid(messageId));
  }
}

function loadEvents(getDb) {
  const rows = getDb().prepare('SELECT message_id, data_json FROM eventos').all();
  for (const r of rows) {
    try {
      cache.set(gid(r.message_id), JSON.parse(r.data_json));
    } catch {
      /* skip */
    }
  }
}

function listGuildEvents(guildId) {
  return [...cache.entries()]
    .filter(([, ev]) => String(ev.guild_id) === gid(guildId))
    .map(([mid, ev]) => ({ messageId: mid, name: ev.name, ev }));
}

function startTimer(client, getDb, messageId) {
  const id = gid(messageId);
  if (timers.has(id)) clearInterval(timers.get(id));
  const iv = setInterval(async () => {
    const ev = cache.get(id);
    if (!ev) {
      clearInterval(iv);
      timers.delete(id);
      return;
    }
    if (timeRemaining(ev.event_timestamp) === '00:00:00') ev.expired = true;
    saveEvent(getDb, id, ev);
    try {
      const ch = await client.channels.fetch(ev.channel_id);
      const msg = await ch.messages.fetch(id);
      await refreshEventMessage(msg, ev, id);
    } catch {
      deleteEvent(getDb, id);
      clearInterval(iv);
      timers.delete(id);
    }
  }, 60_000);
  timers.set(id, iv);
}

async function publishEvent(client, getDb, ev, channel) {
  const files = [];
  const hasUpload = Boolean(ev.image_base64);
  let uploadMeta = null;

  if (hasUpload) {
    uploadMeta = imageUploadFromBase64(ev.image_base64, ev.image_name);
    files.push(new AttachmentBuilder(uploadMeta.buffer, { name: uploadMeta.filename }));
    ev.has_event_image = true;
    ev.image_file = uploadMeta.filename;
  }

  delete ev.image_base64;
  delete ev.image_name;

  const payload = {
    embeds: [buildEmbed(ev)],
    components: [roleSelectRow('pending', ev.roles)],
  };
  if (files.length) payload.files = files;

  const msg = await channel.send(payload);
  const att = msg.attachments.find((a) => a.name === ev.image_file) || msg.attachments.first();
  if (att?.url) ev.image_url = att.url;

  ev.message_id = msg.id;
  ev.channel_id = channel.id;
  saveEvent(getDb, msg.id, ev);

  await msg.edit({ components: [roleSelectRow(msg.id, ev.roles)] });
  await channel.send({ content: '@everyone Nuevo evento creado!' });
  startTimer(client, getDb, msg.id);
  return msg;
}

function buildEventFromPayload(body, guildId, creator) {
  const time = String(body.time || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Hora inválida. Usa HH:MM (UTC).');
  let embedColor = body.embedColor ?? body.embed_color ?? null;
  if (typeof embedColor === 'string' && embedColor.startsWith('#')) {
    embedColor = parseInt(embedColor.slice(1), 16);
  } else if (typeof embedColor === 'string' && embedColor) {
    embedColor = parseInt(embedColor, 16);
  }
  return {
    name: String(body.name || '').trim(),
    description: String(body.description || body.desc || '').trim(),
    time,
    location: String(body.location || '').trim(),
    guild_id: gid(guildId),
    voice_channel_id: body.voiceChannelId || body.voice_channel_id || null,
    roles: normalizeRoles(body),
    embed_color: embedColor || 0x5865f2,
    creator: creator || 'Dashboard',
    event_timestamp: parseTimeUtc(time),
    expired: false,
    image_base64: body.imageBase64 || body.image_base64 || null,
    image_name: body.imageName || body.image_name || 'evento.png',
    image_url: body.imageUrl || body.image_url || null,
  };
}

async function createEventFromDashboard(client, getDb, guild, channelId, body, creator) {
  const name = String(body.name || '').trim();
  const location = String(body.location || '').trim();
  if (!name) throw new Error('Nombre requerido');
  if (!location) throw new Error('Lugar requerido');
  const channel = guild.channels.cache.get(String(channelId));
  if (!channel?.isTextBased()) throw new Error('Canal de publicación no válido');
  const ev = buildEventFromPayload(body, guild.id, creator);
  if (!Object.keys(ev.roles || {}).filter((k) => k !== 'Ausente').length) {
    throw new Error('Añade al menos un rol al evento');
  }
  return publishEvent(client, getDb, ev, channel);
}

function getGuildEvent(guildId, messageId) {
  const ev = cache.get(gid(messageId));
  if (!ev || String(ev.guild_id) !== gid(guildId)) return null;
  return ev;
}

function mergeRoleSignups(oldRoles, newRoles) {
  ensureAusente(newRoles);
  if (oldRoles?.Ausente?.users?.length) {
    newRoles.Ausente.users = [...oldRoles.Ausente.users];
  }
  for (const [key, data] of Object.entries(newRoles)) {
    if (key === 'Ausente') continue;
    const byKey = oldRoles?.[key];
    const byName = Object.entries(oldRoles || {}).find(
      ([k, d]) =>
        k !== 'Ausente' &&
        String(d.name || k).toLowerCase() === String(data.name || key).toLowerCase(),
    );
    const old = byKey || byName?.[1];
    if (old?.users?.length) data.users = [...old.users];
  }
  return newRoles;
}

function parseDashboardEmbedColor(raw, fallback = 0x5865f2) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return fallback;
  return parseInt(s, 16);
}

function eventToDashboardPayload(ev) {
  const roles = [];
  for (const [key, data] of Object.entries(ev.roles || {})) {
    if (key === 'Ausente') continue;
    roles.push({
      name: data.name || key,
      emojiId: data.emojiId || null,
      emojiName: data.emojiName || null,
      emoji: data.emoji || null,
      required: data.required || 0,
      signedUp: (data.users || []).length,
    });
  }
  const colorNum = ev.embed_color ?? 0x5865f2;
  return {
    messageId: ev.message_id,
    channelId: ev.channel_id,
    name: ev.name,
    description: ev.description || '',
    time: ev.time,
    location: ev.location,
    voiceChannelId: ev.voice_channel_id || '',
    embedColor: `#${Number(colorNum).toString(16).padStart(6, '0')}`,
    roles,
    hasImage: Boolean(ev.has_event_image || ev.image_url),
    imageUrl: ev.image_url || null,
    creator: ev.creator || '',
  };
}

async function updateEventFromDashboard(client, getDb, guild, messageId, body) {
  const ev = getGuildEvent(guild.id, messageId);
  if (!ev) throw new Error('Evento no encontrado');

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new Error('Nombre requerido');
    ev.name = name;
  }
  if (body.description !== undefined) ev.description = String(body.description || '').trim();
  if (body.location !== undefined) {
    const location = String(body.location).trim();
    if (!location) throw new Error('Lugar requerido');
    ev.location = location;
  }
  if (body.voiceChannelId !== undefined) ev.voice_channel_id = body.voiceChannelId || null;
  if (body.embedColor !== undefined) ev.embed_color = parseDashboardEmbedColor(body.embedColor, ev.embed_color);

  if (body.time !== undefined) {
    const time = String(body.time).trim();
    if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Hora inválida. Usa HH:MM (UTC).');
    ev.time = time;
    ev.event_timestamp = parseTimeUtc(time);
    ev.expired = false;
  }

  if (body.roles !== undefined) {
    const newRoles = normalizeRoles(body);
    if (!Object.keys(newRoles).filter((k) => k !== 'Ausente').length) {
      throw new Error('Añade al menos un rol al evento');
    }
    ev.roles = mergeRoleSignups(ev.roles, newRoles);
  }

  if (body.removeImage) {
    ev.has_event_image = false;
    ev.image_url = null;
    ev.image_file = null;
  }

  const ch = await client.channels.fetch(ev.channel_id);
  const msg = await ch.messages.fetch(messageId);
  const hasNewImage = Boolean(body.imageBase64 || body.image_base64);

  if (hasNewImage) {
    const meta = imageUploadFromBase64(
      body.imageBase64 || body.image_base64,
      body.imageName || body.image_name || 'evento.png',
    );
    const file = new AttachmentBuilder(meta.buffer, { name: meta.filename });
    ev.has_event_image = true;
    ev.image_file = meta.filename;
    const draft = { ...ev, image_url: null };
    await msg.edit({
      embeds: [buildEmbed(draft)],
      files: [file],
      components: [roleSelectRow(messageId, ev.roles)],
    });
    const updated = await ch.messages.fetch(messageId);
    const att = updated.attachments.find((a) => a.name === meta.filename);
    if (att?.url) ev.image_url = att.url;
    await msg.edit({
      embeds: [buildEmbed(ev, updated)],
      components: [roleSelectRow(messageId, ev.roles)],
      attachments: [],
    });
  } else if (body.removeImage) {
    await msg.edit({
      embeds: [buildEmbed(ev)],
      components: [roleSelectRow(messageId, ev.roles)],
      attachments: [],
    });
  } else {
    await refreshEventMessage(msg, ev, messageId);
  }

  saveEvent(getDb, messageId, ev);
  if (!timers.has(gid(messageId))) startTimer(client, getDb, messageId);
  return msg;
}

async function deleteEventFromDashboard(client, getDb, guildId, messageId) {
  const ev = getGuildEvent(guildId, messageId);
  if (!ev) throw new Error('Evento no encontrado');
  try {
    const ch = await client.channels.fetch(ev.channel_id);
    const msg = await ch.messages.fetch(messageId);
    await msg.delete();
  } catch {
    /* mensaje ya eliminado */
  }
  deleteEvent(getDb, messageId);
}

function pendingKey(ix) {
  return `${ix.guildId}:${ix.user.id}`;
}

function ep(payload) {
  const { ephemeral: _e, flags, ...rest } = payload;
  return { ...rest, flags: flags ?? MessageFlags.Ephemeral };
}

function bindWizard(ix, ev, msgId) {
  ev._wizard = {
    appId: ix.applicationId,
    token: ix.token,
    msgId: msgId || ix.message?.id,
  };
}

function wizardBody(payload) {
  const body = { content: payload.content ?? undefined };
  if (payload.components?.length) {
    body.components = payload.components.map((c) => (c.toJSON ? c.toJSON() : c));
  }
  if (payload.embeds?.length) {
    body.embeds = payload.embeds.map((e) => (e.toJSON ? e.toJSON() : e));
  }
  return body;
}

async function editWizardMessage(client, wizard, payload) {
  if (!wizard?.msgId || !wizard?.token) return;
  await client.rest.patch(`/webhooks/${wizard.appId}/${wizard.token}/messages/${wizard.msgId}`, {
    body: wizardBody(payload),
  });
}

function colorNameFromHex(hex) {
  const value = hex ?? ALLOWED_COLORS.discord;
  const entry = Object.entries(ALLOWED_COLORS).find(([, v]) => v === value);
  return entry ? entry[0] : `#${Number(value).toString(16).padStart(6, '0')}`;
}

function eventSummaryShort(ev, step) {
  return `**Crear evento — Paso ${step}/4**\n📌 **${ev.name}** · 🕐 ${ev.time} UTC · 📍 ${ev.location}\n\n`;
}

function buildVoicePayload(ev) {
  return {
    content: `${eventSummaryShort(ev, 1)}¿Canal de voz para el evento?`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:voice:yes`).setLabel('Canal de voz').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:voice:no`).setLabel('Sin canal').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildEmojiTypePayload(ev) {
  const voice = ev.voice_channel_id ? `<#${ev.voice_channel_id}>` : 'No';
  return {
    content: `${eventSummaryShort(ev, 2)}🔊 Voz: ${voice}\n\nSelecciona el tipo de emoji para los roles:`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:emoji:system`).setLabel('Emoji del sistema').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:emoji:guild`).setLabel('Emoji del servidor').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildFinalizePayload(ev, opts = {}) {
  const voice = ev.voice_channel_id ? `<#${ev.voice_channel_id}>` : 'No';
  const colorName = colorNameFromHex(ev.embed_color);
  const hasImage = Boolean(ev.image_base64 || ev.has_event_image);
  let content = `${eventSummaryShort(ev, 4)}**Revisa y publica**\n\n`;
  content += `🔊 Voz: ${voice}\n`;
  content += `👥 Roles:\n${rolesSetupSummary(ev)}\n`;
  content += `🎨 Color: **${colorName}**\n`;
  content += `🖼️ Imagen: ${hasImage ? '✅ Lista' : '_Sin imagen (opcional)_'}\n`;
  if (opts.imageWaiting) content += '\n⏳ **Sube una imagen en este canal** (60 s)…\n';

  const colorOptions = Object.entries(ALLOWED_COLORS)
    .slice(0, 25)
    .map(([name]) => ({ label: name.charAt(0).toUpperCase() + name.slice(1), value: name }));

  return {
    content,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:wiz:color`)
          .setPlaceholder('Color del embed')
          .addOptions(colorOptions),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:wiz:image`).setLabel('Subir imagen').setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:setup:publish`)
          .setLabel('Publicar evento')
          .setStyle(ButtonStyle.Success)
          .setDisabled(countEventRoles(ev) < 1),
        new ButtonBuilder().setCustomId(`${PREFIX}:wiz:back`).setLabel('← Roles').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildWizardPayload(ev, guild, step, opts = {}) {
  if (step === 'voice') return buildVoicePayload(ev);
  if (step === 'emoji-type') return buildEmojiTypePayload(ev);
  if (step === 'finalize') return buildFinalizePayload(ev, opts);
  return buildRolesSetupPayload(ev, guild, opts.emojiPage || 0, opts.guildEmojis !== false);
}

async function wizardAckModal(ix, ev, payload) {
  await editWizardMessage(ix.client, ev._wizard, payload);
  await ix.deferReply({ flags: MessageFlags.Ephemeral });
  await ix.deleteReply();
}

async function updateWizard(ix, ev, step, opts = {}) {
  const payload = ep(buildWizardPayload(ev, ix.guild, step, opts));
  if (!ev._wizard?.msgId) {
    const msg = await ix.reply({ ...payload, fetchReply: true });
    bindWizard(ix, ev, msg.id);
    return;
  }
  if (ix.isModalSubmit()) {
    await wizardAckModal(ix, ev, payload);
    return;
  }
  if (ix.isButton() || ix.isStringSelectMenu() || ix.isChannelSelectMenu()) {
    try {
      await ix.update(payload);
      bindWizard(ix, ev, ix.message.id);
    } catch {
      await editWizardMessage(ix.client, ev._wizard, payload);
      bindWizard(ix, ev, ev._wizard.msgId);
    }
    return;
  }
  if (ix.deferred || ix.replied) {
    await ix.editReply(payload);
    bindWizard(ix, ev, ev._wizard.msgId);
  } else {
    await ix.update(payload).catch(async () => {
      await ix.reply({ ...payload, fetchReply: true }).then((msg) => bindWizard(ix, ev, msg.id));
    });
  }
}

function parseEmbedColor(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('#')) s = s.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

async function downloadAttachment(attachment) {
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error('No se pudo descargar la imagen adjunta');
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), name: attachment.name || 'evento.png' };
}

function ensureAusente(roles) {
  if (!roles.Ausente) {
    roles.Ausente = { emoji: '❌', users: [], required: 0, name: 'Ausente' };
  }
  return roles;
}

function addRoleToEvent(ev, name, emojiId, emojiName, required) {
  if (!ev.roles) ev.roles = {};
  ensureAusente(ev.roles);
  const key = roleKey(name, ev.roles);
  ev.roles[key] = {
    name,
    emojiId: String(emojiId),
    emojiName: String(emojiName),
    emoji: null,
    users: [],
    required: Math.max(1, parseInt(required, 10) || 1),
  };
  return key;
}

function countEventRoles(ev) {
  return Object.keys(ev.roles || {}).filter((k) => k !== 'Ausente').length;
}

function rolesSetupSummary(ev) {
  const lines = [];
  for (const [key, data] of Object.entries(ev.roles || {})) {
    if (key === 'Ausente') continue;
    lines.push(`• **${data.name || key}** ${formatRoleEmoji(data)} ×${data.required || 0}`);
  }
  return lines.length ? lines.join('\n') : '_Sin roles — añade al menos uno._';
}

function emojiSelectOptions(guild, page) {
  const all = [...guild.emojis.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
  const slots = 25;
  const chunkSize = slots - 2;
  const start = page * chunkSize;
  const chunk = all.slice(start, start + chunkSize);
  const opts = [];
  if (page > 0) {
    opts.push({ label: '← Página anterior', value: '__prev__', emoji: '⬅️' });
  }
  for (const e of chunk) {
    opts.push({
      label: e.name.slice(0, 100),
      value: e.id,
      emoji: { id: e.id, name: e.name },
    });
  }
  if (start + chunkSize < all.length) {
    opts.push({ label: 'Más emojis →', value: '__next__', emoji: '➡️' });
  }
  return { options: opts.slice(0, 25), total: all.length };
}

function buildRolesSetupPayload(ev, guild, emojiPage = 0, guildEmojis = true) {
  let content = `${eventSummaryShort(ev, 3)}**Configura roles**\n${rolesSetupSummary(ev)}\n\n`;
  if (guildEmojis) {
    content += 'Elige emoji del servidor → nombre y cantidad. Luego **Siguiente** para color e imagen.';
  } else {
    content += 'Revisa los roles y pulsa **Siguiente** para color e imagen.';
  }
  const components = [];
  if (guildEmojis) {
    const { options, total } = emojiSelectOptions(guild, emojiPage);
    if (total > 0 && options.length) {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${PREFIX}:setup:emoji:${emojiPage}`)
            .setPlaceholder('Emojis del servidor')
            .addOptions(options),
        ),
      );
    } else {
      content += '\n\n⚠️ Sin emojis personalizados. Usa **Emoji del sistema**.';
    }
  }
  const removable = Object.entries(ev.roles || {}).filter(([k]) => k !== 'Ausente');
  if (removable.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:setup:remove`)
          .setPlaceholder('Quitar un rol')
          .addOptions(
            removable.slice(0, 25).map(([key, data]) => ({
              label: (data.name || key).slice(0, 100),
              value: key,
              emoji: selectMenuEmoji(data),
              description: `×${data.required || 0}`,
            })),
          ),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:wiz:next`)
        .setLabel('Siguiente — color e imagen')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(countEventRoles(ev) < 1),
    ),
  );
  return { content, components };
}

async function showRolesSetup(ix, ev, emojiPage = 0, guildEmojis = true) {
  await ix.guild.emojis.fetch().catch(() => {});
  await updateWizard(ix, ev, 'roles', { emojiPage, guildEmojis });
}

async function showRoleNameModal(ix) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:setup:role`)
    .setTitle('Nuevo rol')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Nombre del rol')
          .setPlaceholder('Tanque, Healer, DPS…')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('qty')
          .setLabel('Cantidad')
          .setPlaceholder('1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
  await ix.showModal(modal);
}

async function attachPendingImage(ev, attachment) {
  if (!attachment?.url) return;
  const dl = await downloadAttachment(attachment);
  ev.image_base64 = dl.base64;
  ev.image_name = dl.name;
  ev.has_event_image = true;
}

function publishedFollowupComponents(messageId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:customize:open:${messageId}`)
        .setLabel('Personalizar imagen y color')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:tpl:save:${messageId}`)
        .setLabel('Guardar plantilla')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function buildCustomizePayload(messageId) {
  const colorOptions = Object.entries(ALLOWED_COLORS)
    .slice(0, 25)
    .map(([name]) => ({
      label: name.charAt(0).toUpperCase() + name.slice(1),
      value: name,
    }));
  return ep({
    content: '**Personalizar evento**\nElige un color o sube una imagen en el canal.',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:customize:color:${messageId}`)
          .setPlaceholder('Color del embed')
          .addOptions(colorOptions),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:customize:image:${messageId}`)
          .setLabel('Subir imagen')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  });
}

async function showEmojiTypeSelect(ix, ev) {
  await updateWizard(ix, ev, 'emoji-type');
}

async function applyColorToEvent(client, getDb, messageId, colorName) {
  const ev = cache.get(gid(messageId));
  if (!ev) throw new Error('Evento no encontrado');
  const hex = ALLOWED_COLORS[colorName];
  if (!hex) throw new Error('Color no válido');
  ev.embed_color = hex;
  saveEvent(getDb, messageId, ev);
  const ch = await client.channels.fetch(ev.channel_id);
  const msg = await ch.messages.fetch(messageId);
  await refreshEventMessage(msg, ev, messageId);
}

async function applyImageToEventMessage(client, getDb, messageId, attachment) {
  const ev = cache.get(gid(messageId));
  if (!ev) throw new Error('Evento no encontrado');
  const dl = await downloadAttachment(attachment);
  const meta = imageUploadFromBase64(dl.base64, dl.name);
  const ch = await client.channels.fetch(ev.channel_id);
  const msg = await ch.messages.fetch(messageId);
  const file = new AttachmentBuilder(meta.buffer, { name: meta.filename });
  ev.has_event_image = true;
  ev.image_file = meta.filename;
  const draft = { ...ev, image_url: null };
  await msg.edit({
    embeds: [buildEmbed(draft)],
    files: [file],
    components: [roleSelectRow(messageId, ev.roles)],
  });
  const updated = await ch.messages.fetch(messageId);
  const att = updated.attachments.find((a) => a.name === meta.filename);
  if (att?.url) ev.image_url = att.url;
  saveEvent(getDb, messageId, ev);
  await msg.edit({
    embeds: [buildEmbed(ev, updated)],
    components: [roleSelectRow(messageId, ev.roles)],
    attachments: [],
  });
}

async function showSystemRolesModal(ix) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:setup:system`)
    .setTitle('Roles con emojis del sistema')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('roles')
          .setLabel('Roles')
          .setPlaceholder('Tanque:🛡️:4, Healer:🌿:3')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true),
      ),
    );
  await ix.showModal(modal);
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('crear_evento')
      .setDescription('Crear un nuevo evento')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
    async run(ix) {
      const modal = new ModalBuilder()
        .setCustomId(`${PREFIX}:create`)
        .setTitle('Crear evento')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('name').setLabel('Nombre').setStyle(TextInputStyle.Short).setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('desc').setLabel('Descripción').setStyle(TextInputStyle.Paragraph).setRequired(false),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('time').setLabel('Hora UTC (20:00)').setStyle(TextInputStyle.Short).setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('location').setLabel('Lugar').setStyle(TextInputStyle.Short).setRequired(true),
          ),
        );
      await ix.showModal(modal);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('editar_evento')
      .setDescription('Editar un evento activo')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
    async run(ix) {
      const list = listGuildEvents(ix.guildId);
      if (!list.length) return ix.reply(ep({ content: '❌ No hay eventos activos.' }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:pick:edit`)
        .setPlaceholder('Evento a editar')
        .addOptions(list.slice(0, 25).map((e) => ({ label: e.name.slice(0, 100), value: e.messageId })));
      await ix.reply(ep({ content: 'Selecciona evento:', components: [new ActionRowBuilder().addComponents(menu)] }));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('eliminar_evento')
      .setDescription('Eliminar un evento')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
    async run(ix) {
      const list = listGuildEvents(ix.guildId);
      if (!list.length) return ix.reply(ep({ content: '❌ No hay eventos.' }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:pick:delete`)
        .setPlaceholder('Evento a eliminar')
        .addOptions(list.slice(0, 25).map((e) => ({ label: e.name.slice(0, 100), value: e.messageId })));
      await ix.reply(ep({ content: 'Selecciona evento:', components: [new ActionRowBuilder().addComponents(menu)] }));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('plantillas')
      .setDescription('Administrar plantillas de eventos')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
    async run(ix) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:tpl:load`).setLabel('Cargar plantilla').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:tpl:delbtn`).setLabel('Eliminar plantilla').setStyle(ButtonStyle.Danger),
      );
      await ix.reply(ep({ content: 'Plantillas:', components: [row] }));
    },
  },
];

function getMemoryStats() {
  return {
    activeEvents: cache.size,
    timers: timers.size,
    pending: pending.size,
    pendingRolePick: pendingRolePick.size,
    imageUploadWait: imageUploadWait.size,
  };
}

module.exports = {
  id: 'eventos',
  getMemoryStats,
  commands,
  parseRoles,
  parseTimeUtc,
  buildEmbed,
  listGuildEvents,
  getGuildEvent,
  eventToDashboardPayload,
  publishEvent,
  createEventFromDashboard,
  updateEventFromDashboard,
  deleteEventFromDashboard,

  onGuildRemove(guildId, { getDb }) {
    const id = gid(guildId);
    getDb().prepare('DELETE FROM eventos WHERE guild_id = ?').run(id);
    getDb().prepare('DELETE FROM evento_templates WHERE guild_id = ?').run(id);
    for (const [mid, ev] of cache) {
      if (String(ev.guild_id) === id) cache.delete(mid);
    }
  },

  onInit(client, { getDb, log }) {
    loadEvents(getDb);
    for (const [mid] of cache) startTimer(client, getDb, mid);
    log.info(`Eventos: ${cache.size} cargados`);
  },

  async handleInteraction(ix, ctx) {
    const { getDb, log } = ctx;

    if (ix.isChatInputCommand()) {
      const cmd = commands.find((c) => c.data.name === ix.commandName);
      if (!cmd) return false;
      await cmd.run(ix, ctx);
      return true;
    }

    if (ix.isModalSubmit() && ix.customId === `${PREFIX}:create`) {
      const key = pendingKey(ix);
      const time = ix.fields.getTextInputValue('time');
      let ts;
      try {
        ts = parseTimeUtc(time);
      } catch {
        await ix.reply(ep({ content: '❌ Hora inválida. Usa HH:MM' }));
        return true;
      }
      const ev = {
        name: ix.fields.getTextInputValue('name'),
        description: ix.fields.getTextInputValue('desc'),
        time,
        location: ix.fields.getTextInputValue('location'),
        guild_id: ix.guildId,
        voice_channel_id: null,
        roles: {},
        embed_color: ALLOWED_COLORS.discord,
        creator: ix.member?.displayName || ix.user.username,
        event_timestamp: ts,
        _guildEmojis: true,
      };
      ensureAusente(ev.roles);
      pending.set(key, ev);
      await updateWizard(ix, ev, 'voice');
      return true;
    }

    if (ix.isModalSubmit() && ix.customId === `${PREFIX}:setup:system`) {
      const key = pendingKey(ix);
      const ev = pending.get(key);
      if (!ev) {
        await ix.reply(ep({ content: 'Sesión expirada.' }));
        return true;
      }
      ev.roles = parseRoles(ix.fields.getTextInputValue('roles'));
      ev._guildEmojis = false;
      pending.set(key, ev);
      await updateWizard(ix, ev, 'roles', { emojiPage: 0, guildEmojis: false });
      return true;
    }

    if (ix.isModalSubmit() && ix.customId === `${PREFIX}:setup:role`) {
      const key = pendingKey(ix);
      const ev = pending.get(key);
      const pick = pendingRolePick.get(key);
      if (!ev || !pick) {
        await ix.reply(ep({ content: 'Sesión expirada.' }));
        return true;
      }
      const name = ix.fields.getTextInputValue('name').trim();
      const qty = parseInt(ix.fields.getTextInputValue('qty'), 10) || 1;
      if (!name) {
        await ix.deferReply(ep({ content: '❌ Escribe el nombre del rol.' }));
        await ix.deleteReply();
        return true;
      }
      addRoleToEvent(ev, name, pick.emojiId, pick.emojiName, qty);
      pendingRolePick.delete(key);
      pending.set(key, ev);
      await updateWizard(ix, ev, 'roles', { emojiPage: 0, guildEmojis: true });
      return true;
    }

    if (ix.isModalSubmit() && ix.customId === `${PREFIX}:roles`) {
      const key = pendingKey(ix);
      const ev = pending.get(key);
      if (!ev) {
        await ix.reply(ep({ content: 'Sesión expirada.' }));
        return true;
      }
      ev.roles = parseRoles(ix.fields.getTextInputValue('roles'));
      pending.delete(key);
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const msg = await publishEvent(ix.client, getDb, ev, ix.channel);
        await ix.editReply(ep({
          content: '✅ Evento creado.',
          components: publishedFollowupComponents(msg.id),
        }));
      } catch (e) {
        log.warn(`Evento: ${e.message}`);
        await ix.editReply({ content: `❌ ${e.message}` });
      }
      return true;
    }

    if (ix.isModalSubmit() && ix.customId.startsWith(`${PREFIX}:tpl:name:`)) {
      const msgId = ix.customId.split(':')[3];
      const ev = cache.get(gid(msgId));
      if (!ev) {
        await ix.reply(ep({ content: 'Evento no encontrado.' }));
        return true;
      }
      const tpl = { ...ev };
      delete tpl.message_id;
      delete tpl.channel_id;
      delete tpl.expired;
      getDb()
        .prepare(`
          INSERT INTO evento_templates (template_id, guild_id, creator_id, template_name, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), gid(ix.guildId), gid(ix.user.id), ix.fields.getTextInputValue('name'), JSON.stringify(tpl), Date.now() / 1000);
      await ix.reply(ep({ content: '✅ Plantilla guardada.' }));
      return true;
    }

    if (ix.isModalSubmit() && ix.customId.startsWith(`${PREFIX}:edit:`)) {
      const [, , field, msgId] = ix.customId.split(':');
      const val = ix.fields.getTextInputValue('val');
      const ev = cache.get(gid(msgId));
      if (!ev) {
        await ix.reply(ep({ content: 'Evento no encontrado.' }));
        return true;
      }
      if (field === 'name') ev.name = val;
      else if (field === 'loc') ev.location = val;
      else if (field === 'time') {
        ev.time = val;
        ev.event_timestamp = parseTimeUtc(val);
        ev.expired = false;
      } else if (field === 'roles') ev.roles = parseRoles(val);
      saveEvent(getDb, msgId, ev);
      try {
        const ch = await ix.client.channels.fetch(ev.channel_id);
        const msg = await ch.messages.fetch(msgId);
        await refreshEventMessage(msg, ev, msgId);
      } catch {
        /* */
      }
      await ix.reply(ep({ content: '✅ Actualizado.' }));
      return true;
    }

    if (ix.isButton()) {
      if (ix.customId === `${PREFIX}:voice:yes`) {
        const ev = pending.get(pendingKey(ix));
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        const sel = new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}:voice:pick`)
          .addChannelTypes(ChannelType.GuildVoice)
          .setMaxValues(1);
        await ix.update({
          content: `${eventSummaryShort(ev, 1)}Selecciona canal de voz:`,
          components: [new ActionRowBuilder().addComponents(sel)],
        });
        bindWizard(ix, ev, ix.message.id);
        return true;
      }
      if (ix.customId === `${PREFIX}:voice:no`) {
        const ev = pending.get(pendingKey(ix));
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        await showEmojiTypeSelect(ix, ev);
        return true;
      }
      if (ix.customId === `${PREFIX}:emoji:system`) {
        await showSystemRolesModal(ix);
        return true;
      }
      if (ix.customId === `${PREFIX}:emoji:guild`) {
        const ev = pending.get(pendingKey(ix));
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        ev._guildEmojis = true;
        await showRolesSetup(ix, ev, 0, true);
        return true;
      }
      if (ix.customId === `${PREFIX}:wiz:next`) {
        const key = pendingKey(ix);
        const ev = pending.get(key);
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        if (countEventRoles(ev) < 1) {
          await ix.reply(ep({ content: '❌ Añade al menos un rol.' }));
          return true;
        }
        await updateWizard(ix, ev, 'finalize');
        return true;
      }
      if (ix.customId === `${PREFIX}:wiz:back`) {
        const ev = pending.get(pendingKey(ix));
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        await updateWizard(ix, ev, 'roles', { emojiPage: 0, guildEmojis: ev._guildEmojis !== false });
        return true;
      }
      if (ix.customId === `${PREFIX}:wiz:image`) {
        const key = pendingKey(ix);
        const ev = pending.get(key);
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        imageUploadWait.set(`${ix.user.id}:${ix.channelId}`, {
          pendingKey: key,
          expires: Date.now() + 60_000,
        });
        await updateWizard(ix, ev, 'finalize', { imageWaiting: true });
        return true;
      }
      if (ix.customId.startsWith(`${PREFIX}:customize:open:`)) {
        const msgId = ix.customId.split(':')[3];
        await ix.reply(buildCustomizePayload(msgId));
        return true;
      }
      if (ix.customId.startsWith(`${PREFIX}:customize:image:`)) {
        const msgId = ix.customId.split(':')[3];
        if (!cache.has(gid(msgId))) {
          await ix.reply(ep({ content: '❌ Evento no encontrado.' }));
          return true;
        }
        imageUploadWait.set(`${ix.user.id}:${ix.channelId}`, {
          eventMessageId: msgId,
          expires: Date.now() + 60_000,
        });
        await ix.reply(ep({ content: '📎 Sube una **imagen** en este canal en los próximos 60 segundos.' }));
        return true;
      }
      if (ix.customId === `${PREFIX}:roles:open`) {
        const ev = pending.get(pendingKey(ix));
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        bindWizard(ix, ev, ix.message.id);
        if (countEventRoles(ev) > 0) {
          await showRolesSetup(ix, ev, 0, ev._guildEmojis !== false);
        } else {
          await showEmojiTypeSelect(ix, ev);
        }
        return true;
      }
      if (ix.customId === `${PREFIX}:setup:publish`) {
        const key = pendingKey(ix);
        const ev = pending.get(key);
        if (!ev) {
          await ix.reply(ep({ content: 'Sesión expirada.' }));
          return true;
        }
        if (countEventRoles(ev) < 1) {
          await ix.reply(ep({ content: '❌ Añade al menos un rol.' }));
          return true;
        }
        await ix.deferUpdate();
        bindWizard(ix, ev, ev._wizard?.msgId || ix.message?.id);
        try {
          const msg = await publishEvent(ix.client, getDb, ev, ix.channel);
          pending.delete(key);
          await editWizardMessage(
            ix.client,
            ev._wizard,
            ep({
              content: `✅ **Evento publicado** en ${ix.channel}`,
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(`${PREFIX}:tpl:save:${msg.id}`)
                    .setLabel('Guardar plantilla')
                    .setStyle(ButtonStyle.Success),
                ),
              ],
            }),
          );
        } catch (e) {
          log.warn(`Evento: ${e.message}`);
          await editWizardMessage(ix.client, ev._wizard, ep({ content: `❌ ${e.message}`, components: [] }));
        }
        return true;
      }
      if (ix.customId.startsWith(`${PREFIX}:tpl:save:`)) {
        const modal = new ModalBuilder()
          .setCustomId(`${PREFIX}:tpl:name:${ix.customId.split(':')[3]}`)
          .setTitle('Nombre de plantilla')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('name').setLabel('Nombre').setStyle(TextInputStyle.Short).setRequired(true),
            ),
          );
        await ix.showModal(modal);
        return true;
      }
      if (ix.customId === `${PREFIX}:tpl:load` || ix.customId === `${PREFIX}:tpl:delbtn`) {
        const rows = getDb()
          .prepare('SELECT template_id, template_name FROM evento_templates WHERE guild_id = ? ORDER BY created_at DESC')
          .all(gid(ix.guildId));
        if (!rows.length) {
          await ix.reply(ep({ content: '❌ Sin plantillas.' }));
          return true;
        }
        const action = ix.customId.endsWith('load') ? 'load' : 'del';
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:tpl:${action}`)
          .setPlaceholder('Plantilla')
          .addOptions(rows.slice(0, 25).map((r) => ({ label: r.template_name, value: r.template_id })));
        await ix.reply(ep({ content: 'Selecciona:', components: [new ActionRowBuilder().addComponents(menu)] }));
        return true;
      }
      if (ix.customId.startsWith(`${PREFIX}:edit:`)) {
        const [, , field, msgId] = ix.customId.split(':');
        const modal = new ModalBuilder()
          .setCustomId(`${PREFIX}:edit:${field}:${msgId}`)
          .setTitle(`Editar ${field}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('val').setLabel(field).setStyle(TextInputStyle.Short).setRequired(true),
            ),
          );
        await ix.showModal(modal);
        return true;
      }
    }

    if (ix.isChannelSelectMenu() && ix.customId === `${PREFIX}:voice:pick`) {
      const key = pendingKey(ix);
      const ev = pending.get(key);
      if (!ev) {
        await ix.reply(ep({ content: 'Sesión expirada.' }));
        return true;
      }
      ev.voice_channel_id = ix.channels.first().id;
      await showEmojiTypeSelect(ix, ev);
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId === `${PREFIX}:wiz:color`) {
      const key = pendingKey(ix);
      const ev = pending.get(key);
      if (!ev) {
        await ix.reply(ep({ content: 'Sesión expirada.' }));
        return true;
      }
      const colorName = ix.values[0];
      ev.embed_color = ALLOWED_COLORS[colorName] ?? ev.embed_color;
      await updateWizard(ix, ev, 'finalize');
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId.startsWith(`${PREFIX}:customize:color:`)) {
      const msgId = ix.customId.split(':')[3];
      const colorName = ix.values[0];
      try {
        await applyColorToEvent(ix.client, getDb, msgId, colorName);
        await ix.reply(ep({ content: `✅ Color actualizado: **${colorName}**.` }));
      } catch (e) {
        await ix.reply(ep({ content: `❌ ${e.message}` }));
      }
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId.startsWith(`${PREFIX}:setup:emoji:`)) {
      const key = pendingKey(ix);
      const ev = pending.get(key);
      if (!ev) {
        await ix.reply(ep({ content: 'Sesión expirada.' }));
        return true;
      }
      const page = parseInt(ix.customId.split(':').pop(), 10) || 0;
      const val = ix.values[0];
      if (val === '__next__') {
        await showRolesSetup(ix, ev, page + 1, true);
        return true;
      }
      if (val === '__prev__') {
        await showRolesSetup(ix, ev, Math.max(0, page - 1), true);
        return true;
      }
      await ix.guild.emojis.fetch().catch(() => {});
      const emoji = ix.guild.emojis.cache.get(val);
      if (!emoji) {
        await ix.reply(ep({ content: '❌ Emoji no encontrado.' }));
        return true;
      }
      pendingRolePick.set(key, { emojiId: emoji.id, emojiName: emoji.name });
      await showRoleNameModal(ix);
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId === `${PREFIX}:setup:remove`) {
      const key = pendingKey(ix);
      const ev = pending.get(key);
      if (!ev) {
        await ix.reply(ep({ content: 'Sesión expirada.' }));
        return true;
      }
      const rm = ix.values[0];
      if (rm && rm !== 'Ausente') delete ev.roles[rm];
      ensureAusente(ev.roles);
      await showRolesSetup(ix, ev, 0, ev._guildEmojis !== false);
      return true;
    }

    if (ix.isStringSelectMenu()) {
      if (ix.customId === `${PREFIX}:pick:edit`) {
        const msgId = ix.values[0];
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:edit:name:${msgId}`).setLabel('Nombre').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:edit:time:${msgId}`).setLabel('Hora').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:edit:loc:${msgId}`).setLabel('Lugar').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:edit:roles:${msgId}`).setLabel('Roles').setStyle(ButtonStyle.Secondary),
        );
        await ix.update({ content: 'Campo a editar:', components: [row] });
        return true;
      }
      if (ix.customId === `${PREFIX}:pick:delete`) {
        const msgId = ix.values[0];
        try {
          const ev = cache.get(gid(msgId));
          const ch = await ix.client.channels.fetch(ev.channel_id);
          await (await ch.messages.fetch(msgId)).delete();
        } catch {
          /* */
        }
        deleteEvent(getDb, msgId);
        await ix.update({ content: '✅ Evento eliminado.', components: [] });
        return true;
      }
      if (ix.customId.startsWith(`${PREFIX}:role:`)) {
        const msgId = ix.customId.split(':')[2];
        const ev = cache.get(gid(msgId));
        if (!ev || timeRemaining(ev.event_timestamp) === '00:00:00') {
          await ix.reply(ep({ content: '❌ Evento cerrado.' }));
          return true;
        }
        const roleKey = ix.values[0];
        const display = ix.member?.displayName || ix.user.username;
        for (const d of Object.values(ev.roles)) {
          if (d.users) d.users = d.users.filter((u) => u !== display);
        }
        const rd = ev.roles[roleKey];
        if (roleKey !== 'Ausente' && rd.required > 0 && rd.users.length >= rd.required) {
          await ix.reply(ep({ content: `❌ Rol **${roleKey}** completo.` }));
          return true;
        }
        rd.users.push(display);
        saveEvent(getDb, msgId, ev);
        await ix.update({ embeds: [buildEmbed(ev, ix.message)], components: [roleSelectRow(msgId, ev.roles)] });
        await ix.followUp(ep({ content: roleKey === 'Ausente' ? '✅ Ausente.' : `✅ **${roleKey}**.` }));
        return true;
      }
      if (ix.customId === `${PREFIX}:tpl:del`) {
        getDb().prepare('DELETE FROM evento_templates WHERE template_id = ?').run(ix.values[0]);
        await ix.update({ content: '✅ Plantilla eliminada.', components: [] });
        return true;
      }
      if (ix.customId === `${PREFIX}:tpl:load`) {
        const row = getDb().prepare('SELECT data_json FROM evento_templates WHERE template_id = ?').get(ix.values[0]);
        if (!row) {
          await ix.update({ content: 'No encontrada.', components: [] });
          return true;
        }
        const tpl = JSON.parse(row.data_json);
        tpl.guild_id = ix.guildId;
        tpl.creator = ix.member?.displayName || ix.user.username;
        tpl.event_timestamp = parseTimeUtc(tpl.time || '20:00');
        tpl.expired = false;
        pending.set(`${ix.guildId}:${ix.user.id}`, tpl);
        await ix.update({
          content: 'Plantilla cargada. Configura roles y publica:',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${PREFIX}:roles:open`).setLabel('Continuar').setStyle(ButtonStyle.Success),
            ),
          ],
        });
        return true;
      }
    }

    return false;
  },

  async onMessageCreate(message, ctx) {
    if (message.author.bot || !message.guild) return false;
    const key = `${message.author.id}:${message.channel.id}`;
    const wait = imageUploadWait.get(key);
    if (!wait || Date.now() > wait.expires) {
      if (wait) imageUploadWait.delete(key);
      return false;
    }
    const att = message.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (!att) return false;
    imageUploadWait.delete(key);
    const { getDb, log } = ctx;
    try {
      if (wait.pendingKey) {
        const ev = pending.get(wait.pendingKey);
        if (!ev) return false;
        await attachPendingImage(ev, att);
        await message.delete().catch(() => {});
        if (ev._wizard) {
          await editWizardMessage(message.client, ev._wizard, ep(buildFinalizePayload(ev)));
        }
        return true;
      }
      await applyImageToEventMessage(message.client, getDb, wait.eventMessageId, att);
      await message.delete().catch(() => {});
      const note = await message.channel.send(`✅ <@${message.author.id}> imagen del evento actualizada.`).catch(() => null);
      if (note) setTimeout(() => note.delete().catch(() => {}), 8000);
    } catch (e) {
      log.warn(`Evento imagen: ${e.message}`);
      await message.reply({ content: `❌ ${e.message}` }).catch(() => {});
    }
    return true;
  },
};
