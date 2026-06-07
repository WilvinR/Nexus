const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { buildKillNotificationImages } = require('./killImages');

const API = 'https://gameinfo.albiononline.com/api/gameinfo';
const PREFIX = 'kill';
const GUCCI_MIN_FAME = parseInt(process.env.GUCCI_MIN_FAME || '2000000', 10) || 2_000_000;
const GUCCI_CHECK_MS = parseInt(process.env.GUCCI_CHECK_MS || '60000', 10) || 60_000;
const GUCCI_NOTIFY_DELAY_MS = (parseFloat(process.env.GUCCI_NOTIFICATION_DELAY || '8') || 8) * 1000;
const GUCCI_GLOBAL_ENTITY = {
  name: 'Gucci Kills',
  entity_type: 'global',
  type: 'global',
  albion_entity_id: '_',
};
const pending = new Map();
const recentEvents = new Map();
let gucciNotifyChain = Promise.resolve();

const notificationRetries = Math.max(1, parseInt(process.env.KILL_NOTIFICATION_RETRIES || '3', 10) || 3);
const notificationRetryDelay = parseFloat(process.env.KILL_NOTIFICATION_RETRY_DELAY || '2') || 2;
const notificationDelay = parseFloat(process.env.KILL_NOTIFICATION_DELAY || '40') || 40;
const maxNotificationsPerEntity = parseInt(process.env.KILL_MAX_NOTIFICATIONS_PER_ENTITY || '20', 10);
const maxNotificationsPerCycle = parseInt(process.env.KILL_MAX_NOTIFICATIONS_PER_CYCLE || '80', 10);
const memberCheckConcurrency = 12;

let notificationLock = Promise.resolve();
let currentCycleNotifications = 0;
let limitReached = false;

class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  async run(fn) {
    while (this.active >= this.max) {
      await new Promise((r) => this.queue.push(r));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.queue.length) this.queue.shift()();
    }
  }
}

const memberSemaphore = new Semaphore(memberCheckConcurrency);

async function apiGet(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 200) return { ok: true, data: await r.json() };
      if (r.status === 404) return { ok: false, notFound: true };
    } catch {
      await new Promise((x) => setTimeout(x, 500 * (i + 1)));
    }
  }
  return { ok: false };
}

function gid(id) {
  return String(id);
}

function entityConfig(row) {
  return {
    name: row.name,
    albion_entity_id: row.albion_entity_id,
    type: row.entity_type,
    kill_channel_id: row.kill_channel_id,
    death_channel_id: row.death_channel_id,
  };
}

function getEntities(getDb, guildId) {
  return getDb()
    .prepare('SELECT * FROM kill_entities WHERE discord_guild_id = ? ORDER BY id ASC')
    .all(gid(guildId));
}

function getEntity(getDb, id) {
  return getDb().prepare('SELECT * FROM kill_entities WHERE id = ?').get(id);
}

function parseDeathIds(row) {
  try {
    return JSON.parse(row.last_death_event_ids || '{}');
  } catch {
    return {};
  }
}

function isOurKill(event, entity) {
  const killer = event.Killer || {};
  const id = String(entity.albion_entity_id);
  if (entity.entity_type === 'guild') return String(killer.GuildId) === id;
  return String(killer.Id) === id;
}

function isOurDeath(event, entity) {
  const victim = event.Victim || {};
  const id = String(entity.albion_entity_id);
  if (entity.entity_type === 'guild') return String(victim.GuildId) === id;
  return String(victim.Id) === id;
}

async function sendKillNotification(channel, event, entity, log, bypassDedupe = false) {
  const eventId = event.EventId != null ? String(event.EventId) : null;
  const cfg = entityConfig(entity);

  for (let attempt = 0; attempt < notificationRetries; attempt++) {
    try {
      const built = await buildKillNotificationImages(event, cfg);
      if (built.skip) return false;
      const eventKind = built.isKill ? 'kill' : 'death';

      if (!bypassDedupe && eventId) {
        const dedupe = `${entity.entity_type}:${entity.albion_entity_id}:${eventKind}:${eventId}`;
        if (recentEvents.has(dedupe)) return true;
      }

      if (maxNotificationsPerCycle > 0 && currentCycleNotifications >= maxNotificationsPerCycle) {
        limitReached = true;
        log.warn('[kill] Límite global de notificaciones alcanzado');
        return null;
      }

      const embedColor = built.isKill ? 0x57f287 : 0xed4245;
      const embedMain = new EmbedBuilder()
        .setColor(embedColor)
        .setTimestamp(built.eventTime)
        .setImage('attachment://kill_equip.png');
      if (built.eventId) {
        embedMain.setURL(`https://albiononline.com/en/killboard/kill/${built.eventId}`);
      }

      const files = [new AttachmentBuilder(built.mainBuffer, { name: 'kill_equip.png' })];
      const embeds = [embedMain];

      if (built.statsBuffer) {
        files.push(new AttachmentBuilder(built.statsBuffer, { name: 'combat_stats.png' }));
        embeds.push(
          new EmbedBuilder()
            .setColor(embedColor)
            .setTimestamp(built.eventTime)
            .setImage('attachment://combat_stats.png'),
        );
      }

      await new Promise((resolve, reject) => {
        notificationLock = notificationLock.then(async () => {
          try {
            await channel.send({ content: built.content, embeds, files });
            if (!bypassDedupe && eventId) {
              const dedupe = `${entity.entity_type}:${entity.albion_entity_id}:${eventKind}:${eventId}`;
              recentEvents.set(dedupe, Date.now());
            }
            currentCycleNotifications++;
            if (notificationDelay > 0) {
              await new Promise((r) => setTimeout(r, notificationDelay * 1000));
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
      return true;
    } catch (e) {
      log.warn(`[kill] Reintento ${attempt + 1}/${notificationRetries}: ${e.message}`);
      if (attempt + 1 < notificationRetries && notificationRetryDelay > 0) {
        await new Promise((r) => setTimeout(r, notificationRetryDelay * 1000));
      } else {
        return false;
      }
    }
  }
  return false;
}

function newEvents(list, lastId, filterFn) {
  if (!list?.length) return { init: null, events: [] };
  const top = String(list[0].EventId);
  if (!lastId) return { init: top, events: [] };
  const out = [];
  for (const ev of list) {
    const eid = String(ev.EventId);
    if (eid === String(lastId)) break;
    if (!filterFn || filterFn(ev)) out.push(ev);
  }
  out.reverse();
  return { init: null, events: out };
}

async function checkEntityKills(getDb, entity, client, log) {
  const ch = client.channels.cache.get(entity.kill_channel_id);
  if (!ch?.isTextBased()) {
    log.warn(`[kill] Canal kills no encontrado: ${entity.name}`);
    return 0;
  }

  const url =
    entity.entity_type === 'guild'
      ? `${API}/events?guildId=${entity.albion_entity_id}&limit=50`
      : `${API}/players/${entity.albion_entity_id}/kills?limit=50`;

  const res = await apiGet(url);
  if (!res.ok || !Array.isArray(res.data)) return 0;

  const filter =
    entity.entity_type === 'guild'
      ? (ev) => String(ev.Killer?.GuildId) === String(entity.albion_entity_id)
      : null;

  const { init, events } = newEvents(res.data, entity.last_kill_event_id, filter);

  if (init) {
    getDb().prepare('UPDATE kill_entities SET last_kill_event_id = ? WHERE id = ?').run(init, entity.id);
    return 0;
  }

  let sent = 0;
  let last = entity.last_kill_event_id;
  let processed = 0;

  for (const ev of events) {
    if (limitReached) break;
    if (maxNotificationsPerEntity > 0 && processed >= maxNotificationsPerEntity) break;
    if (!isOurKill(ev, entity)) continue;

    const result = await sendKillNotification(ch, ev, entity, log);
    if (result === null) break;
    if (result === true) {
      sent++;
      processed++;
      last = String(ev.EventId);
    } else if (result === false) {
      /* error, continuar */
    }
  }

  if (last !== entity.last_kill_event_id) {
    getDb().prepare('UPDATE kill_entities SET last_kill_event_id = ? WHERE id = ?').run(last, entity.id);
  } else if (!limitReached && res.data[0]?.EventId && events.length === 0) {
    /* sin cambios */
  }

  return sent;
}

async function checkMemberDeaths(sessionEntity, playerId, deathIds, client, log) {
  return memberSemaphore.run(async () => {
    const entity = sessionEntity;
    const ch = client.channels.cache.get(entity.death_channel_id);
    if (!ch?.isTextBased()) return { sent: 0, updates: {} };

    const res = await apiGet(`${API}/players/${playerId}/deaths?limit=50`);
    if (!res.ok || !Array.isArray(res.data)) return { sent: 0, updates: {} };

    const last = deathIds[playerId] || null;
    const { init, events } = newEvents(res.data, last);

    if (init) return { sent: 0, updates: { [playerId]: init } };

    let sent = 0;
    let lastId = last;
    let processed = 0;

    for (const ev of events) {
      if (limitReached) break;
      if (maxNotificationsPerEntity > 0 && processed >= maxNotificationsPerEntity) break;

      const result = await sendKillNotification(ch, ev, entity, log);
      if (result === null) break;
      if (result === true) {
        sent++;
        processed++;
        lastId = String(ev.EventId);
      }
    }

    if (lastId && lastId !== last) {
      return { sent, updates: { [playerId]: lastId } };
    }
    if (!limitReached && res.data[0]?.EventId && !events.length) {
      return { sent: 0, updates: { [playerId]: String(res.data[0].EventId) } };
    }
    return { sent, updates: {} };
  });
}

async function checkEntityDeaths(getDb, entity, client, log) {
  if (entity.entity_type === 'player') {
    const ch = client.channels.cache.get(entity.death_channel_id);
    if (!ch?.isTextBased()) return 0;

    const res = await apiGet(`${API}/players/${entity.albion_entity_id}/deaths?limit=50`);
    if (!res.ok || !Array.isArray(res.data)) return 0;

    const { init, events } = newEvents(res.data, entity.last_death_event_id);
    if (init) {
      getDb()
        .prepare('UPDATE kill_entities SET last_death_event_id = ? WHERE id = ?')
        .run(init, entity.id);
      return 0;
    }

    let sent = 0;
    let last = entity.last_death_event_id;
    let processed = 0;

    for (const ev of events) {
      if (limitReached) break;
      if (maxNotificationsPerEntity > 0 && processed >= maxNotificationsPerEntity) break;
      if (!isOurDeath(ev, entity)) continue;

      const result = await sendKillNotification(ch, ev, entity, log);
      if (result === null) break;
      if (result === true) {
        sent++;
        processed++;
        last = String(ev.EventId);
      }
    }

    if (last !== entity.last_death_event_id) {
      getDb().prepare('UPDATE kill_entities SET last_death_event_id = ? WHERE id = ?').run(last, entity.id);
    }
    return sent;
  }

  const members = await apiGet(`${API}/guilds/${entity.albion_entity_id}/members`);
  if (!members.ok || !Array.isArray(members.data)) return 0;

  let deathIds = parseDeathIds(entity);
  let totalSent = 0;
  const validMembers = members.data.filter((m) => m.Id);

  const results = await Promise.all(
    validMembers.map((m) => checkMemberDeaths(entity, String(m.Id), deathIds, client, log)),
  );

  for (const r of results) {
    totalSent += r.sent;
    Object.assign(deathIds, r.updates);
  }

  getDb()
    .prepare('UPDATE kill_entities SET last_death_event_ids = ? WHERE id = ?')
    .run(JSON.stringify(deathIds), entity.id);

  return totalSent;
}

async function runMonitor(getDb, client, log) {
  const sep = '─'.repeat(55);
  log.info(`\n${sep}\n  🔄  CICLO KILLBOARD INICIADO\n${sep}`);

  currentCycleNotifications = 0;
  limitReached = false;

  const now = Date.now();
  for (const [k, t] of recentEvents) {
    if (now - t > 3_600_000) recentEvents.delete(k);
  }

  const rows = getDb().prepare('SELECT * FROM kill_entities').all();
  for (const entity of rows) {
    if (limitReached) {
      log.warn('[kill] Límite global — deteniendo ciclo');
      break;
    }
    try {
      const kills = await checkEntityKills(getDb, entity, client, log);
      const deaths = await checkEntityDeaths(getDb, entity, client, log);
      log.info(`[kill] ${entity.name}: ${kills} kill(s), ${deaths} muerte(s) nuevas`);
    } catch (e) {
      log.warn(`Kill monitor ${entity.name}: ${e.message}`);
    }
  }

  log.info(`\n  ✅  CICLO KILLBOARD COMPLETADO\n${sep}`);
}

function isGucciEvent(ev) {
  if (ev.Type !== 'KILL') return false;
  if (ev.KillArea && ev.KillArea !== 'OPEN_WORLD') return false;
  return (ev.TotalVictimKillFame || 0) >= GUCCI_MIN_FAME;
}

function loadGucciFeedState(getDb) {
  const row = getDb().prepare('SELECT * FROM gucci_feed_state WHERE id = 1').get();
  let sentIds = [];
  try {
    sentIds = JSON.parse(row?.sent_event_ids || '[]');
  } catch {
    sentIds = [];
  }
  return {
    lastEventId: row?.last_event_id ? String(row.last_event_id) : null,
    sentIds: sentIds.map(String),
  };
}

function saveGucciFeedState(getDb, lastEventId, sentIds) {
  getDb()
    .prepare(`
      INSERT INTO gucci_feed_state (id, last_event_id, sent_event_ids, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_event_id = excluded.last_event_id,
        sent_event_ids = excluded.sent_event_ids,
        updated_at = excluded.updated_at
    `)
    .run(String(lastEventId || ''), JSON.stringify(sentIds.slice(-200)), Date.now());
}

function upsertGucciConfig(getDb, guildId, channelId) {
  getDb()
    .prepare(`
      INSERT INTO gucci_kills_config (discord_guild_id, channel_id, enabled)
      VALUES (?, ?, 1)
      ON CONFLICT(discord_guild_id) DO UPDATE SET channel_id = excluded.channel_id, enabled = 1
    `)
    .run(gid(guildId), String(channelId));
}

function collectNewGucciEvents(events, lastEventId, sentSet) {
  if (!events?.length) return { seed: null, events: [] };
  const top = String(events[0].EventId);
  if (!lastEventId) return { seed: top, events: [] };

  const out = [];
  for (const ev of events) {
    const eid = String(ev.EventId);
    if (eid === lastEventId) break;
    if (sentSet.has(eid)) continue;
    if (isGucciEvent(ev)) out.push(ev);
  }
  out.reverse();
  return { seed: null, events: out };
}

async function sendGucciKill(channel, event, log) {
  const built = await buildKillNotificationImages(event, GUCCI_GLOBAL_ENTITY);
  if (built.skip) return false;

  const embedColor = 0x57f287;
  const embedMain = new EmbedBuilder()
    .setColor(embedColor)
    .setTimestamp(built.eventTime)
    .setImage('attachment://kill_equip.png');
  if (built.eventId) {
    embedMain.setURL(`https://albiononline.com/en/killboard/kill/${built.eventId}`);
  }

  const files = [new AttachmentBuilder(built.mainBuffer, { name: 'kill_equip.png' })];
  const embeds = [embedMain];
  if (built.statsBuffer) {
    files.push(new AttachmentBuilder(built.statsBuffer, { name: 'combat_stats.png' }));
    embeds.push(
      new EmbedBuilder()
        .setColor(embedColor)
        .setTimestamp(built.eventTime)
        .setImage('attachment://combat_stats.png'),
    );
  }

  await channel.send({ content: built.content, embeds, files });
  return true;
}

async function broadcastGucciKill(getDb, client, event, log) {
  const rows = getDb().prepare('SELECT * FROM gucci_kills_config WHERE enabled = 1').all();
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.discord_guild_id);
    if (!guild) continue;
    const channel = guild.channels.cache.get(row.channel_id);
    if (!channel?.isTextBased()) continue;

    gucciNotifyChain = gucciNotifyChain.then(async () => {
      try {
        await sendGucciKill(channel, event, log);
        if (GUCCI_NOTIFY_DELAY_MS > 0) await new Promise((r) => setTimeout(r, GUCCI_NOTIFY_DELAY_MS));
      } catch (e) {
        log.warn(`[gucci-kills] ${row.discord_guild_id}: ${e.message}`);
      }
    });
  }
  await gucciNotifyChain;
}

async function runGucciMonitor(getDb, client, log) {
  const active = getDb().prepare('SELECT 1 FROM gucci_kills_config WHERE enabled = 1 LIMIT 1').get();
  if (!active) return;

  const res = await apiGet(`${API}/events?limit=50&offset=0`);
  if (!res.ok || !Array.isArray(res.data) || !res.data.length) return;

  const state = loadGucciFeedState(getDb);
  const sentSet = new Set(state.sentIds);
  const { seed, events: newEvents } = collectNewGucciEvents(res.data, state.lastEventId, sentSet);

  if (seed) {
    saveGucciFeedState(getDb, seed, state.sentIds);
    log.info('[gucci-kills] Feed inicializado (sin historial)');
    return;
  }

  const topId = String(res.data[0].EventId);
  if (!newEvents.length) {
    if (topId !== state.lastEventId) saveGucciFeedState(getDb, topId, state.sentIds);
    return;
  }

  const sentIds = [...state.sentIds];
  for (const ev of newEvents) {
    const eid = String(ev.EventId);
    if (sentSet.has(eid)) continue;
    sentSet.add(eid);
    sentIds.push(eid);
    log.info(
      `[gucci-kills] ${ev.Killer?.Name || '?'} → ${ev.Victim?.Name || '?'} (${Math.round((ev.TotalVictimKillFame || 0) / 1e6)}M)`,
    );
    await broadcastGucciKill(getDb, client, ev, log);
  }

  saveGucciFeedState(getDb, topId, sentIds);
}

const gucciKillsCmd = new SlashCommandBuilder()
  .setName('gucci-kills')
  .setDescription('Activa feed global de kills ≥2M fama (open world)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) =>
    o
      .setName('canal')
      .setDescription('Canal de notificaciones')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  );

const gucciKillsDetenerCmd = new SlashCommandBuilder()
  .setName('gucci-kills-detener')
  .setDescription('Desactiva el feed Gucci Kills')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const killboard = new SlashCommandBuilder()
  .setName('killboard')
  .setDescription('Killboard de Albion Online')
  .addSubcommand((s) =>
    s
      .setName('seguir')
      .setDescription('Monitorea kills y muertes de un gremio o jugador')
      .addStringOption((o) =>
        o
          .setName('tipo')
          .setDescription('Gremio o jugador')
          .setRequired(true)
          .addChoices({ name: 'Gremio', value: 'gremio' }, { name: 'Jugador', value: 'jugador' }),
      )
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre').setRequired(true))
      .addStringOption((o) => o.setName('id').setDescription('ID Albion').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('detener').setDescription('Detiene el seguimiento'))
  .addSubcommand((s) => s.setName('config').setDescription('Muestra la configuración actual'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function cmdSeguir(ix, { getDb }) {
  await ix.deferReply({ flags: MessageFlags.Ephemeral });

  const tipo = ix.options.getString('tipo');
  const nombre = ix.options.getString('nombre');
  const albionId = ix.options.getString('id').trim();
  const entityType = tipo === 'gremio' ? 'guild' : 'player';

  const exists = getDb()
    .prepare(
      'SELECT 1 FROM kill_entities WHERE discord_guild_id = ? AND albion_entity_id = ? AND entity_type = ?',
    )
    .get(gid(ix.guildId), albionId, entityType);
  if (exists) {
    return ix.editReply({ content: '❌ Esa entidad ya está en seguimiento.' });
  }

  const check = await apiGet(
    entityType === 'guild' ? `${API}/guilds/${albionId}` : `${API}/players/${albionId}`,
  );
  if (!check.ok) {
    return ix.editReply({ content: '❌ ID inválido en la API de Albion.' });
  }

  const key = `${ix.guildId}:${ix.user.id}`;
  pending.set(key, { entityType, nombre, albionId, killChannelId: null, deathChannelId: null });

  const killSel = new ChannelSelectMenuBuilder()
    .setCustomId(`${PREFIX}:ch:kills:${ix.user.id}`)
    .setPlaceholder('Canal para KILLS')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1)
    .setMinValues(1);

  const deathSel = new ChannelSelectMenuBuilder()
    .setCustomId(`${PREFIX}:ch:deaths:${ix.user.id}`)
    .setPlaceholder('Canal para MUERTES')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1)
    .setMinValues(1);

  const confirm = new ButtonBuilder()
    .setCustomId(`${PREFIX}:confirm:${ix.user.id}`)
    .setLabel('Confirmar Configuración')
    .setStyle(ButtonStyle.Success);

  await ix.editReply({
    content: `Selecciona los canales y confirma para **${nombre}** (\`${albionId}\`):`,
    components: [
      new ActionRowBuilder().addComponents(killSel),
      new ActionRowBuilder().addComponents(deathSel),
      new ActionRowBuilder().addComponents(confirm),
    ],
  });
}

async function cmdDetener(ix, { getDb }) {
  const list = getEntities(getDb, ix.guildId);
  if (!list.length) {
    return ix.reply({ content: '❌ No hay entidades en seguimiento.', ephemeral: true });
  }
  if (list.length === 1) {
    getDb().prepare('DELETE FROM kill_entities WHERE id = ?').run(list[0].id);
    return ix.reply({
      content: `✅ Se ha detenido el seguimiento de: **${list[0].name}**`,
      ephemeral: true,
    });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:stop`)
    .setPlaceholder('Selecciona la entidad a detener')
    .addOptions(
      list.map((e) => ({
        label: `${e.name}`.slice(0, 100),
        description: `${e.entity_type} · ${e.albion_entity_id}`.slice(0, 100),
        value: String(e.id),
      })),
    );
  await ix.reply({
    content: 'Selecciona qué dejar de monitorear:',
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  });
}

async function cmdConfig(ix, { getDb }) {
  const list = getEntities(getDb, ix.guildId);
  if (!list.length) {
    return ix.reply({ content: '❌ No hay entidades configuradas.', ephemeral: true });
  }
  const embed = new EmbedBuilder()
    .setTitle('📊 Configuración de Seguimiento')
    .setColor(0x5865f2);
  for (const e of list) {
    const killCh = ix.guild.channels.cache.get(e.kill_channel_id);
    const deathCh = ix.guild.channels.cache.get(e.death_channel_id);
    embed.addFields({
      name: `${e.entity_type === 'guild' ? '🏰' : '🧑'} ${e.name}`,
      value:
        `ID: \`${e.albion_entity_id}\`\n` +
        `Canal Kills: ${killCh || 'Canal no encontrado'}\n` +
        `Canal Muertes: ${deathCh || 'Canal no encontrado'}`,
      inline: false,
    });
  }
  await ix.reply({ embeds: [embed], ephemeral: false });
}

module.exports = {
  id: 'kill',
  GUCCI_MIN_FAME,
  commands: [{ data: killboard }, { data: gucciKillsCmd }, { data: gucciKillsDetenerCmd }],

  onGuildRemove(guildId, { getDb }) {
    getDb().prepare('DELETE FROM kill_entities WHERE discord_guild_id = ?').run(gid(guildId));
    getDb().prepare('DELETE FROM gucci_kills_config WHERE discord_guild_id = ?').run(gid(guildId));
  },

  onInit(client, { getDb, log }) {
    setInterval(() => runMonitor(getDb, client, log), 2 * 60 * 1000);
    setInterval(() => runGucciMonitor(getDb, client, log), GUCCI_CHECK_MS);
    log.info('Killboard monitor cada 2 min (imágenes PIL → canvas)');
    log.info(`Gucci Kills cada ${GUCCI_CHECK_MS / 1000}s (≥${GUCCI_MIN_FAME / 1e6}M fama)`);
  },

  async handleInteraction(ix, ctx) {
    const { getDb, log } = ctx;

    if (ix.isChatInputCommand() && ix.commandName === 'gucci-kills') {
      const canal = ix.options.getChannel('canal');
      upsertGucciConfig(getDb, ix.guildId, canal.id);
      await ix.reply({
        content:
          `✅ **Gucci Kills** activo en ${canal}\n` +
          `Umbral: **≥ ${(GUCCI_MIN_FAME / 1e6).toFixed(0)}M** fama · open world · Americas`,
        ephemeral: false,
      });
      return true;
    }

    if (ix.isChatInputCommand() && ix.commandName === 'gucci-kills-detener') {
      const row = getDb()
        .prepare('SELECT 1 FROM gucci_kills_config WHERE discord_guild_id = ?')
        .get(gid(ix.guildId));
      if (!row) {
        await ix.reply({ content: '❌ Gucci Kills no está activo.', ephemeral: true });
        return true;
      }
      getDb().prepare('DELETE FROM gucci_kills_config WHERE discord_guild_id = ?').run(gid(ix.guildId));
      await ix.reply({ content: '✅ Gucci Kills desactivado.', ephemeral: true });
      return true;
    }

    if (ix.isChatInputCommand() && ix.commandName === 'killboard') {
      const sub = ix.options.getSubcommand();
      if (sub === 'seguir') {
        await cmdSeguir(ix, ctx);
        return true;
      }
      if (sub === 'detener') {
        await cmdDetener(ix, ctx);
        return true;
      }
      if (sub === 'config') {
        await cmdConfig(ix, ctx);
        return true;
      }
    }

    if (ix.isChannelSelectMenu() && ix.customId.startsWith(`${PREFIX}:ch:`)) {
      const key = `${ix.guildId}:${ix.customId.split(':')[3]}`;
      if (ix.user.id !== ix.customId.split(':')[3]) {
        await ix.reply({ content: 'No es tu panel.', ephemeral: true });
        return true;
      }
      const data = pending.get(key);
      if (!data) {
        await ix.reply({ content: 'Sesión expirada.', ephemeral: true });
        return true;
      }
      const ch = ix.channels.first();
      if (ix.customId.includes(':kills:')) data.killChannelId = ch.id;
      else data.deathChannelId = ch.id;
      pending.set(key, data);
      const label = ix.customId.includes(':kills:') ? 'kills' : 'muertes';
      await ix.reply({ content: `✅ Canal de ${label}: ${ch}`, ephemeral: true });
      return true;
    }

    if (ix.isButton() && ix.customId.startsWith(`${PREFIX}:confirm:`)) {
      const uid = ix.customId.split(':')[2];
      if (ix.user.id !== uid) {
        await ix.reply({ content: 'No es tu panel.', ephemeral: true });
        return true;
      }
      const key = `${ix.guildId}:${uid}`;
      const data = pending.get(key);
      pending.delete(key);
      if (!data?.killChannelId || !data?.deathChannelId) {
        await ix.reply({ content: '❌ Debes seleccionar ambos canales antes de confirmar.', ephemeral: true });
        return true;
      }
      getDb()
        .prepare(`
          INSERT INTO kill_entities (
            discord_guild_id, entity_type, name, albion_entity_id,
            kill_channel_id, death_channel_id, last_death_event_ids
          ) VALUES (?, ?, ?, ?, ?, ?, '{}')
        `)
        .run(
          gid(ix.guildId),
          data.entityType,
          data.nombre,
          data.albionId,
          String(data.killChannelId),
          String(data.deathChannelId),
        );
      const killCh = ix.guild.channels.cache.get(data.killChannelId);
      const deathCh = ix.guild.channels.cache.get(data.deathChannelId);
      await ix.update({
        content:
          `✅ Seguimiento configurado para **${data.nombre}**\n` +
          `Kills: ${killCh}\nMuertes: ${deathCh}`,
        components: [],
      });
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId === `${PREFIX}:stop`) {
      const row = getEntity(getDb, Number(ix.values[0]));
      if (!row) {
        await ix.update({ content: 'No encontrado.', components: [] });
        return true;
      }
      getDb().prepare('DELETE FROM kill_entities WHERE id = ?').run(row.id);
      await ix.update({ content: `✅ Se ha detenido el seguimiento de **${row.name}**`, components: [] });
      return true;
    }

    return false;
  },
};
