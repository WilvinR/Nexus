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
} = require('discord.js');
const { randomUUID } = require('crypto');

const PREFIX = 'evt';
const pending = new Map();
const cache = new Map();
const timers = new Map();

function gid(id) {
  return String(id);
}

function toSerifBold(text) {
  const n = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = '𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗';
  return String(text)
    .split('')
    .map((c) => {
      const i = n.indexOf(c);
      return i >= 0 ? b[i] : c;
    })
    .join('');
}

function toBoldSans(text) {
  const n = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵';
  return String(text)
    .split('')
    .map((c) => {
      const i = n.indexOf(c);
      return i >= 0 ? b[i] : c;
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
    out += `**★-${toBoldSans(data.name || key)}** ${data.emoji} (${assigned}/${req})\n`;
    if (data.users?.length) out += `${data.users.join('\n')}\n`;
  }
  const aus = roles.Ausente;
  if (aus?.users?.length) {
    out += `\n**★-${toBoldSans('Ausente')}** ${aus.emoji} (${aus.users.length}/0)\n${aus.users.join('\n')}\n`;
  }
  return out.trim() || 'No roles asignados.';
}

function buildEmbed(ev) {
  const color = ev.embed_color || 0x5865f2;
  const desc = (ev.description || '').trim();
  const embed = new EmbedBuilder()
    .setTitle(toSerifBold((ev.name || 'Evento').charAt(0).toUpperCase() + (ev.name || '').slice(1)))
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
  if (ev.creator) embed.setFooter({ text: `Evento organizado por ${ev.creator}` });
  return embed;
}

function roleSelectRow(messageId, roles) {
  const options = Object.entries(roles).map(([key, data]) => ({
    label: (data.name || key).slice(0, 100),
    value: key,
    emoji: data.emoji?.length <= 2 ? data.emoji : undefined,
    description: key === 'Ausente' ? 'Marcarme ausente' : `${(data.users || []).length}/${data.required || 0}`,
  }));
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
      await msg.edit({ embeds: [buildEmbed(ev)], components: [roleSelectRow(id, ev.roles)] });
    } catch {
      deleteEvent(getDb, id);
      clearInterval(iv);
      timers.delete(id);
    }
  }, 60_000);
  timers.set(id, iv);
}

async function publishEvent(ix, getDb, client, ev, channel) {
  const msg = await channel.send({
    embeds: [buildEmbed(ev)],
    components: [roleSelectRow('pending', ev.roles)],
  });
  ev.message_id = msg.id;
  ev.channel_id = channel.id;
  saveEvent(getDb, msg.id, ev);
  await msg.edit({ components: [roleSelectRow(msg.id, ev.roles)] });
  await channel.send({ content: '@everyone Nuevo evento creado!' });
  startTimer(client, getDb, msg.id);
  return msg;
}

async function askRolesModal(ix) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:roles`)
    .setTitle('Roles del evento')
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
      if (!list.length) return ix.reply({ content: '❌ No hay eventos activos.', ephemeral: true });
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:pick:edit`)
        .setPlaceholder('Evento a editar')
        .addOptions(list.slice(0, 25).map((e) => ({ label: e.name.slice(0, 100), value: e.messageId })));
      await ix.reply({ content: 'Selecciona evento:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('eliminar_evento')
      .setDescription('Eliminar un evento')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
    async run(ix) {
      const list = listGuildEvents(ix.guildId);
      if (!list.length) return ix.reply({ content: '❌ No hay eventos.', ephemeral: true });
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:pick:delete`)
        .setPlaceholder('Evento a eliminar')
        .addOptions(list.slice(0, 25).map((e) => ({ label: e.name.slice(0, 100), value: e.messageId })));
      await ix.reply({ content: 'Selecciona evento:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
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
      await ix.reply({ content: 'Plantillas:', components: [row], ephemeral: true });
    },
  },
];

module.exports = {
  id: 'eventos',
  commands,

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
      const time = ix.fields.getTextInputValue('time');
      let ts;
      try {
        ts = parseTimeUtc(time);
      } catch {
        await ix.reply({ content: '❌ Hora inválida. Usa HH:MM', ephemeral: true });
        return true;
      }
      pending.set(`${ix.guildId}:${ix.user.id}`, {
        name: ix.fields.getTextInputValue('name'),
        description: ix.fields.getTextInputValue('desc'),
        time,
        location: ix.fields.getTextInputValue('location'),
        guild_id: ix.guildId,
        voice_channel_id: null,
        roles: { Ausente: { emoji: '❌', users: [], required: 0, name: 'Ausente' } },
        embed_color: null,
        creator: ix.member?.displayName || ix.user.username,
        event_timestamp: ts,
      });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:voice:yes`).setLabel('Canal de voz').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:voice:no`).setLabel('Sin canal').setStyle(ButtonStyle.Secondary),
      );
      await ix.reply({ content: '¿Canal de voz?', components: [row], ephemeral: true });
      return true;
    }

    if (ix.isModalSubmit() && ix.customId === `${PREFIX}:roles`) {
      const ev = pending.get(`${ix.guildId}:${ix.user.id}`);
      if (!ev) {
        await ix.reply({ content: 'Sesión expirada.', ephemeral: true });
        return true;
      }
      ev.roles = parseRoles(ix.fields.getTextInputValue('roles'));
      pending.delete(`${ix.guildId}:${ix.user.id}`);
      await ix.deferReply({ ephemeral: true });
      try {
        const msg = await publishEvent(ix, getDb, ix.client, ev, ix.channel);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:tpl:save:${msg.id}`).setLabel('Guardar plantilla').setStyle(ButtonStyle.Success),
        );
        await ix.editReply({ content: '✅ Evento creado.', components: [row] });
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
        await ix.reply({ content: 'Evento no encontrado.', ephemeral: true });
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
      await ix.reply({ content: '✅ Plantilla guardada.', ephemeral: true });
      return true;
    }

    if (ix.isModalSubmit() && ix.customId.startsWith(`${PREFIX}:edit:`)) {
      const [, , field, msgId] = ix.customId.split(':');
      const val = ix.fields.getTextInputValue('val');
      const ev = cache.get(gid(msgId));
      if (!ev) {
        await ix.reply({ content: 'Evento no encontrado.', ephemeral: true });
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
        await msg.edit({ embeds: [buildEmbed(ev)], components: [roleSelectRow(msgId, ev.roles)] });
      } catch {
        /* */
      }
      await ix.reply({ content: '✅ Actualizado.', ephemeral: true });
      return true;
    }

    if (ix.isButton()) {
      if (ix.customId === `${PREFIX}:voice:yes`) {
        const sel = new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}:voice:pick`)
          .addChannelTypes(ChannelType.GuildVoice)
          .setMaxValues(1);
        await ix.update({ content: 'Selecciona canal de voz:', components: [new ActionRowBuilder().addComponents(sel)] });
        return true;
      }
      if (ix.customId === `${PREFIX}:voice:no`) {
        await ix.update({
          content: 'Pulsa el botón para configurar roles.',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${PREFIX}:roles:open`).setLabel('Configurar roles').setStyle(ButtonStyle.Success),
            ),
          ],
        });
        return true;
      }
      if (ix.customId === `${PREFIX}:roles:open`) {
        await askRolesModal(ix);
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
          await ix.reply({ content: '❌ Sin plantillas.', ephemeral: true });
          return true;
        }
        const action = ix.customId.endsWith('load') ? 'load' : 'del';
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:tpl:${action}`)
          .setPlaceholder('Plantilla')
          .addOptions(rows.slice(0, 25).map((r) => ({ label: r.template_name, value: r.template_id })));
        await ix.reply({ content: 'Selecciona:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
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
      const ev = pending.get(`${ix.guildId}:${ix.user.id}`);
      if (ev) ev.voice_channel_id = ix.channels.first().id;
      await ix.update({
        content: 'Canal de voz guardado. Configura roles:',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}:roles:open`).setLabel('Configurar roles').setStyle(ButtonStyle.Success),
          ),
        ],
      });
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
          await ix.reply({ content: '❌ Evento cerrado.', ephemeral: true });
          return true;
        }
        const roleKey = ix.values[0];
        const display = ix.member?.displayName || ix.user.username;
        for (const d of Object.values(ev.roles)) {
          if (d.users) d.users = d.users.filter((u) => u !== display);
        }
        const rd = ev.roles[roleKey];
        if (roleKey !== 'Ausente' && rd.required > 0 && rd.users.length >= rd.required) {
          await ix.reply({ content: `❌ Rol **${roleKey}** completo.`, ephemeral: true });
          return true;
        }
        rd.users.push(display);
        saveEvent(getDb, msgId, ev);
        await ix.update({ embeds: [buildEmbed(ev)], components: [roleSelectRow(msgId, ev.roles)] });
        await ix.followUp({ content: roleKey === 'Ausente' ? '✅ Ausente.' : `✅ **${roleKey}**.`, ephemeral: true });
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
          content: 'Plantilla cargada. Pulsa continuar.',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${PREFIX}:roles:open`).setLabel('Continuar → roles').setStyle(ButtonStyle.Success),
            ),
          ],
        });
        return true;
      }
    }

    return false;
  },
};
