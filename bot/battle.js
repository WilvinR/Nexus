const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { buildGuildBattleImage, buildAllianceBattleImage } = require('./battleImages');

const API = 'https://gameinfo.albiononline.com/api/gameinfo';
const PREFIX = 'battle';
const MIN_PLAYERS = 10;
const CHECK_COOLDOWN_MS = 5 * 60 * 1000;
const API_GAP_MS = 2000;

let lastApiCall = 0;
let cycleIndex = 0;

function blog(log, level, msg) {
  if (!log) return;
  const fn = level === 'warn' ? log.warn : level === 'error' ? log.error : log.info;
  fn(`[battle] ${msg}`);
}

function gid(id) {
  return String(id);
}

function parseSent(row) {
  try {
    return JSON.parse(row.sent_battles || '[]');
  } catch {
    return [];
  }
}

function getAll(getDb, discordGuildId) {
  return getDb()
    .prepare('SELECT * FROM battle_tracking WHERE discord_guild_id = ? ORDER BY id ASC')
    .all(gid(discordGuildId));
}

async function apiWait() {
  const now = Date.now();
  const wait = API_GAP_MS - (now - lastApiCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastApiCall = Date.now();
}

async function apiGet(url, log) {
  await apiWait();
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.status === 200) return { ok: true, data: await r.json() };
      if (r.status === 404) return { ok: false, notFound: true, status: 404 };
      blog(log, 'warn', `API HTTP ${r.status}: ${url}`);
    } catch (e) {
      blog(log, 'warn', `API intento ${i + 1}/3 falló: ${e.message}`);
      await new Promise((x) => setTimeout(x, 500 * (i + 1)));
    }
  }
  blog(log, 'warn', `API sin respuesta: ${url}`);
  return { ok: false };
}

async function fetchBattlesForTrack({ guildId, allianceId }, log) {
  const base = `${API}/battles?range=month&offset=0&limit=4&sort=recent`;
  const url = allianceId
    ? `${base}&allianceId=${encodeURIComponent(allianceId)}`
    : `${base}&guildId=${encodeURIComponent(guildId)}`;
  const mode = allianceId ? `alianza ${allianceId.slice(0, 8)}…` : `gremio ${guildId.slice(0, 8)}…`;
  const res = await apiGet(url, log);
  const list = res.ok && Array.isArray(res.data) ? res.data : [];
  blog(log, 'info', `API batallas (${mode}): ${list.length} recientes [${list.map((b) => b.id).join(', ') || '—'}]`);
  return list;
}

/** Resuelve gremio + alianza actual desde la API (solo UUID de gremio). */
async function resolveGuildBattleInput(albionGuildId) {
  const id = String(albionGuildId || '').trim();
  if (!id) return { error: 'ID de gremio requerido' };

  const check = await apiGet(`${API}/guilds/${id}`, null);
  if (!check.ok) return { error: 'Gremio no encontrado en Albion' };

  const allianceId = check.data?.AllianceId ? String(check.data.AllianceId) : null;
  const allianceTag =
    check.data?.AllianceTag ||
    (allianceId ? `Alianza_${allianceId.slice(0, 8)}` : null);

  return {
    albionGuildId: id,
    guildName: check.data?.Name || id,
    allianceId,
    allianceTag,
    label: check.data?.Name || id,
  };
}

async function resolveTrackContext(row) {
  const resolved = await resolveGuildBattleInput(row.albion_guild_id);
  if (resolved.error) {
    const allianceId = row.alliance_id ? String(row.alliance_id) : null;
    return {
      albionGuildId: row.albion_guild_id,
      guildName: row.albion_guild_id,
      allianceId,
      allianceTag: row.alliance_tag || (allianceId ? 'Alianza' : null),
    };
  }
  return resolved;
}

async function seedBattles(getDb, rowId, track, log) {
  const battles = await fetchBattlesForTrack(
    { guildId: track.albionGuildId, allianceId: track.allianceId },
    log,
  );
  const ids = battles.map((b) => String(b.id));
  getDb()
    .prepare('UPDATE battle_tracking SET sent_battles = ? WHERE id = ?')
    .run(JSON.stringify(ids), rowId);
  blog(log, 'info', `Seed fila ${rowId}: ${ids.length} batallas marcadas como vistas`);
}

function releaseBattleImage(built) {
  if (built) built.buffer = null;
}

async function sendGuildBattle(channel, battle, albionGuildId, log) {
  let built;
  try {
    built = buildGuildBattleImage(battle, albionGuildId);
    const embed = new EmbedBuilder()
      .setTitle(built.title)
      .setColor(0x1f2937)
      .setTimestamp(built.battleTime)
      .setImage('attachment://battle.png')
      .setFooter({ text: `Battle Report • ${built.battleTime.toLocaleString('es-ES')}` });
    await channel.send({
      embeds: [embed],
      files: [new AttachmentBuilder(built.buffer, { name: 'battle.png' })],
    });
    blog(log, 'info', `Reporte gremio enviado: batalla ${battle.id} → #${channel.name}`);
  } finally {
    releaseBattleImage(built);
  }
}

async function sendAllianceBattle(channel, battle, allianceId, allianceTag, log) {
  let built;
  try {
    built = buildAllianceBattleImage(battle, allianceId, allianceTag);
    const embed = new EmbedBuilder()
      .setTitle(built.title)
      .setColor(0x1f2937)
      .setTimestamp(built.battleTime)
      .setImage('attachment://alliance_battle.png')
      .setFooter({ text: `Battle Report • ${built.battleTime.toLocaleString('es-ES')}` });
    await channel.send({
      embeds: [embed],
      files: [new AttachmentBuilder(built.buffer, { name: 'alliance_battle.png' })],
    });
    blog(log, 'info', `Reporte alianza enviado: batalla ${battle.id} → #${channel.name}`);
  } finally {
    releaseBattleImage(built);
  }
}

function countGuildPlayers(battle, guildId) {
  return Object.values(battle.players || {}).filter((p) => p.guildId === guildId).length;
}

function countAlliancePlayers(battle, allianceId) {
  const guilds = battle.guilds || {};
  return Object.values(battle.players || {}).filter((p) => {
    const g = guilds[p.guildId];
    const aid = g?.allianceId || p.allianceId;
    return aid === allianceId;
  }).length;
}

async function processRow(getDb, row, client, log) {
  const tag = row.alliance_tag || row.albion_guild_id.slice(0, 12);
  blog(log, 'info', `Chequeo fila ${row.id} (Discord ${row.discord_guild_id}, ${tag})`);

  const guild = client.guilds.cache.get(row.discord_guild_id);
  if (!guild) {
    blog(log, 'warn', `Fila ${row.id}: servidor Discord no encontrado (${row.discord_guild_id})`);
    return;
  }
  const channel = guild.channels.cache.get(row.channel_id);
  if (!channel?.isTextBased()) {
    blog(log, 'warn', `Fila ${row.id}: canal inválido o sin permiso (${row.channel_id})`);
    return;
  }

  const track = await resolveTrackContext(row);
  const scope = track.allianceId
    ? `alianza ${track.allianceTag || track.allianceId.slice(0, 8)}`
    : `gremio ${track.guildName}`;
  blog(log, 'info', `Fila ${row.id}: monitoreando ${scope}`);

  if (track.allianceId && track.allianceId !== row.alliance_id) {
    getDb()
      .prepare('UPDATE battle_tracking SET alliance_id = ?, alliance_tag = ? WHERE id = ?')
      .run(track.allianceId, track.allianceTag || null, row.id);
    blog(log, 'info', `Fila ${row.id}: alianza actualizada → ${track.allianceTag}`);
  }

  const battles = await fetchBattlesForTrack(
    { guildId: track.albionGuildId, allianceId: track.allianceId },
    log,
  );
  if (!battles.length) {
    blog(log, 'info', `Fila ${row.id}: sin batallas recientes en API`);
    getDb()
      .prepare('UPDATE battle_tracking SET last_check = ? WHERE id = ?')
      .run(Date.now(), row.id);
    return;
  }

  let sent = parseSent(row);
  const sentSet = new Set(sent);
  const newBattles = [];
  const skipped = [];

  for (const b of battles) {
    const bid = String(b.id);
    if (sentSet.has(bid)) continue;
    const count = track.allianceId
      ? countAlliancePlayers(b, track.allianceId)
      : countGuildPlayers(b, track.albionGuildId);
    sentSet.add(bid);
    if (count >= MIN_PLAYERS) {
      newBattles.push({ battle: b, count });
    } else {
      skipped.push({ id: bid, count });
    }
  }

  if (skipped.length) {
    blog(
      log,
      'info',
      `Fila ${row.id}: ${skipped.length} batalla(s) bajo umbral (<${MIN_PLAYERS}): ${skipped.map((s) => `${s.id}(${s.count})`).join(', ')}`,
    );
  }

  sent = [...sentSet].slice(-50);
  getDb()
    .prepare('UPDATE battle_tracking SET sent_battles = ?, last_check = ? WHERE id = ?')
    .run(JSON.stringify(sent), Date.now(), row.id);

  if (!newBattles.length) {
    blog(log, 'info', `Fila ${row.id}: ciclo OK, 0 reportes nuevos`);
    return;
  }

  blog(log, 'info', `Fila ${row.id}: publicando ${newBattles.length} batalla(s) nueva(s)`);

  for (const { battle: b, count } of newBattles.reverse()) {
    try {
      if (track.allianceId) {
        await sendAllianceBattle(
          channel,
          b,
          track.allianceId,
          track.allianceTag || 'Alianza',
          log,
        );
      } else {
        await sendGuildBattle(channel, b, track.albionGuildId, log);
      }
      blog(log, 'info', `Fila ${row.id}: batalla ${b.id} publicada (${count} jugadores)`);
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      blog(log, 'warn', `Fila ${row.id}: error al publicar batalla ${b.id}: ${e.message}`);
    }
  }
}

async function runMonitor(getDb, client, log) {
  const rows = getDb().prepare('SELECT * FROM battle_tracking ORDER BY id ASC').all();
  if (!rows.length) return;

  const now = Date.now();
  const eligible = rows.filter((r) => now - (r.last_check || 0) >= CHECK_COOLDOWN_MS);
  if (!eligible.length) {
    const next = rows.reduce((best, r) => {
      const wait = CHECK_COOLDOWN_MS - (now - (r.last_check || 0));
      return wait < best.wait ? { id: r.id, wait } : best;
    }, { id: null, wait: Infinity });
    blog(
      log,
      'info',
      `Ciclo: ${rows.length} seguimiento(s), 0 elegibles (próximo fila ${next.id} en ~${Math.ceil(next.wait / 1000)}s)`,
    );
    return;
  }

  const row = eligible[cycleIndex % eligible.length];
  const slot = (cycleIndex % eligible.length) + 1;
  cycleIndex++;
  blog(
    log,
    'info',
    `Ciclo #${cycleIndex}: fila ${row.id} (${slot}/${eligible.length} elegibles, ${rows.length} total)`,
  );
  try {
    await processRow(getDb, row, client, log);
  } catch (e) {
    blog(log, 'warn', `Ciclo fila ${row.id} error: ${e.message}`);
    if (e.stack) blog(log, 'warn', e.stack);
  }
}

function trackLabel(row) {
  return row.alliance_tag || row.albion_guild_id;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('seguir_batalla')
      .setDescription('Monitorea batallas de tu gremio (y su alianza si aplica)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((o) =>
        o
          .setName('canal')
          .setDescription('Canal de notificaciones')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('gremio_id').setDescription('ID de tu gremio en Albion').setRequired(true),
      ),
    async run(ix, { getDb, log }) {
      const canal = ix.options.getChannel('canal');
      const gremioId = ix.options.getString('gremio_id').trim();
      if (gremioId.length < 10) {
        return ix.reply({ content: '❌ ID de gremio inválido.', ephemeral: true });
      }

      const resolved = await resolveGuildBattleInput(gremioId);
      if (resolved.error) {
        return ix.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      }

      const dup = getDb()
        .prepare(
          'SELECT 1 FROM battle_tracking WHERE discord_guild_id = ? AND albion_guild_id = ?',
        )
        .get(gid(ix.guildId), resolved.albionGuildId);
      if (dup) {
        return ix.reply({ content: '❌ Ese gremio ya está en seguimiento.', ephemeral: true });
      }

      const r = getDb()
        .prepare(`
          INSERT INTO battle_tracking (
            discord_guild_id, track_type, channel_id, albion_guild_id, alliance_id, alliance_tag, sent_battles
          ) VALUES (?, 'guild', ?, ?, ?, ?, '[]')
        `)
        .run(
          gid(ix.guildId),
          String(canal.id),
          resolved.albionGuildId,
          resolved.allianceId,
          resolved.allianceTag,
        );

      await seedBattles(getDb, r.lastInsertRowid, resolved, log);
      blog(
        log,
        'info',
        `Seguimiento creado fila ${r.lastInsertRowid}: ${resolved.guildName}${resolved.allianceTag ? ` / ${resolved.allianceTag}` : ''} → ${canal.id}`,
      );

      const allianceNote = resolved.allianceId
        ? `\nSe monitorea el gremio y la alianza **${resolved.allianceTag}**.`
        : '\nSe monitorea solo el gremio (sin alianza).';

      await ix.reply({
        content:
          `✅ Seguimiento activo para **${resolved.guildName}**${allianceNote}\n` +
          `Canal: ${canal}`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('detener_batalla')
      .setDescription('Detiene el seguimiento de batallas')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async run(ix, { getDb }) {
      const list = getAll(getDb, ix.guildId);
      if (!list.length) {
        return ix.reply({ content: '❌ No hay seguimiento de batallas activo.', ephemeral: true });
      }
      if (list.length === 1) {
        getDb().prepare('DELETE FROM battle_tracking WHERE id = ?').run(list[0].id);
        return ix.reply({ content: `✅ Detenido: ${trackLabel(list[0])}`, ephemeral: true });
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:stop`)
        .setPlaceholder('Qué detener')
        .addOptions(
          list.map((e) => ({
            label: trackLabel(e).slice(0, 100),
            value: String(e.id),
          })),
        );
      await ix.reply({
        content: 'Selecciona qué dejar de monitorear:',
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    },
  },
];

module.exports = {
  id: 'battle',
  commands,
  resolveGuildBattleInput,
  seedBattles,

  onGuildRemove(guildId, { getDb }) {
    getDb().prepare('DELETE FROM battle_tracking WHERE discord_guild_id = ?').run(gid(guildId));
  },

  onInit(client, { getDb, log }) {
    const total = getDb().prepare('SELECT COUNT(*) AS n FROM battle_tracking').get()?.n || 0;
    setInterval(() => runMonitor(getDb, client, log), 60 * 1000);
    blog(log, 'info', `Monitor activo cada 60s (${total} seguimiento(s) registrados)`);
  },

  async handleInteraction(ix, ctx) {
    if (ix.isStringSelectMenu() && ix.customId === `${PREFIX}:stop`) {
      const row = ctx
        .getDb()
        .prepare('SELECT * FROM battle_tracking WHERE id = ? AND discord_guild_id = ?')
        .get(Number(ix.values[0]), gid(ix.guildId));
      if (!row) {
        await ix.update({ content: 'No encontrado.', components: [] });
        return true;
      }
      ctx.getDb().prepare('DELETE FROM battle_tracking WHERE id = ?').run(row.id);
      await ix.update({ content: '✅ Seguimiento detenido.', components: [] });
      return true;
    }

    if (!ix.isChatInputCommand()) return false;
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!cmd) return false;
    await cmd.run(ix, ctx);
    return true;
  },
};
