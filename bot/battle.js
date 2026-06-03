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

async function apiGet(url) {
  await apiWait();
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.status === 200) return { ok: true, data: await r.json() };
      if (r.status === 404) return { ok: false, notFound: true };
    } catch {
      await new Promise((x) => setTimeout(x, 500 * (i + 1)));
    }
  }
  return { ok: false };
}

async function fetchBattles(guildId) {
  const url = `${API}/battles?range=month&offset=0&limit=4&sort=recent&guildId=${guildId}`;
  const res = await apiGet(url);
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

async function seedBattles(getDb, rowId, guildId) {
  const battles = await fetchBattles(guildId);
  const ids = battles.map((b) => String(b.id));
  getDb()
    .prepare('UPDATE battle_tracking SET sent_battles = ? WHERE id = ?')
    .run(JSON.stringify(ids), rowId);
}

async function sendGuildBattle(channel, battle, albionGuildId, log) {
  const built = buildGuildBattleImage(battle, albionGuildId);
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
}

async function sendAllianceBattle(channel, battle, allianceId, allianceTag, log) {
  const built = buildAllianceBattleImage(battle, allianceId, allianceTag);
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
}

function countGuildPlayers(battle, guildId) {
  return Object.values(battle.players || {}).filter((p) => p.guildId === guildId).length;
}

function countAlliancePlayers(battle, allianceId) {
  const guilds = battle.guilds || {};
  return Object.values(battle.players || {}).filter((p) => {
    const g = guilds[p.guildId];
    return g?.allianceId === allianceId;
  }).length;
}

async function processRow(getDb, row, client, log) {
  const guild = client.guilds.cache.get(row.discord_guild_id);
  if (!guild) return;
  const channel = guild.channels.cache.get(row.channel_id);
  if (!channel?.isTextBased()) return;

  const sampleGuildId = row.albion_guild_id;
  const battles = await fetchBattles(sampleGuildId);
  if (!battles.length) return;

  let sent = parseSent(row);
  const sentSet = new Set(sent);
  const newBattles = [];

  for (const b of battles) {
    const bid = String(b.id);
    if (sentSet.has(bid)) continue;
    const count =
      row.track_type === 'alliance'
        ? countAlliancePlayers(b, row.alliance_id)
        : countGuildPlayers(b, row.albion_guild_id);
    sentSet.add(bid);
    if (count >= MIN_PLAYERS) newBattles.push(b);
  }

  sent = [...sentSet].slice(-50);
  getDb()
    .prepare('UPDATE battle_tracking SET sent_battles = ?, last_check = ? WHERE id = ?')
    .run(JSON.stringify(sent), Date.now(), row.id);

  for (const b of newBattles.reverse()) {
    try {
      if (row.track_type === 'alliance') {
        await sendAllianceBattle(channel, b, row.alliance_id, row.alliance_tag || 'Alianza', log);
      } else {
        await sendGuildBattle(channel, b, row.albion_guild_id, log);
      }
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      log.warn(`Battle notify: ${e.message}`);
    }
  }
}

async function runMonitor(getDb, client, log) {
  const rows = getDb().prepare('SELECT * FROM battle_tracking ORDER BY id ASC').all();
  if (!rows.length) return;

  const now = Date.now();
  const eligible = rows.filter((r) => now - (r.last_check || 0) >= CHECK_COOLDOWN_MS);
  if (!eligible.length) return;

  const row = eligible[cycleIndex % eligible.length];
  cycleIndex++;
  try {
    await processRow(getDb, row, client, log);
  } catch (e) {
    log.warn(`Battle monitor ${row.id}: ${e.message}`);
  }
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('seguir_batalla')
      .setDescription('Monitorea batallas de un gremio de Albion')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal de notificaciones').addChannelTypes(ChannelType.GuildText).setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('gremio_id').setDescription('ID del gremio en Albion').setRequired(true),
      ),
    async run(ix, { getDb, log }) {
      const canal = ix.options.getChannel('canal');
      const gremioId = ix.options.getString('gremio_id').trim();
      if (gremioId.length < 10) {
        return ix.reply({ content: '❌ ID de gremio inválido.', ephemeral: true });
      }

      const check = await apiGet(`${API}/guilds/${gremioId}`);
      if (!check.ok) {
        return ix.reply({ content: '❌ Gremio no encontrado en la API.', ephemeral: true });
      }

      const dup = getDb()
        .prepare(
          'SELECT 1 FROM battle_tracking WHERE discord_guild_id = ? AND track_type = ? AND albion_guild_id = ?',
        )
        .get(gid(ix.guildId), 'guild', gremioId);
      if (dup) {
        return ix.reply({ content: '❌ Ese gremio ya está en seguimiento.', ephemeral: true });
      }

      const info = await apiGet(`${API}/battles?range=week&offset=0&limit=1&sort=totalfame&guildId=${gremioId}`);
      const r = getDb()
        .prepare(`
          INSERT INTO battle_tracking (discord_guild_id, track_type, channel_id, albion_guild_id, sent_battles)
          VALUES (?, 'guild', ?, ?, '[]')
        `)
        .run(gid(ix.guildId), String(canal.id), gremioId);

      await seedBattles(getDb, r.lastInsertRowid, gremioId);

      const guildName = check.data?.Name || gremioId;
      await ix.reply({
        content:
          `✅ Seguimiento de batallas activo para **${guildName}**\n` +
          `Canal: ${canal}` +
          (info.ok && info.data?.length ? '' : '\n⚠️ Sin batallas recientes en la API.'),
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('seguir_batalla_alianza')
      .setDescription('Monitorea batallas de una alianza (ID de cualquier gremio miembro)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal de notificaciones').addChannelTypes(ChannelType.GuildText).setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('gremio_id').setDescription('ID de un gremio de la alianza').setRequired(true),
      ),
    async run(ix, { getDb, log }) {
      const canal = ix.options.getChannel('canal');
      const gremioId = ix.options.getString('gremio_id').trim();
      if (gremioId.length < 10) {
        return ix.reply({ content: '❌ ID inválido.', ephemeral: true });
      }

      const check = await apiGet(`${API}/guilds/${gremioId}`);
      if (!check.ok || !check.data) {
        return ix.reply({ content: '❌ Gremio no encontrado.', ephemeral: true });
      }

      const allianceId = check.data.AllianceId;
      if (!allianceId) {
        return ix.reply({ content: '❌ Ese gremio no pertenece a ninguna alianza.', ephemeral: true });
      }

      const allianceTag = check.data.AllianceTag || `Alianza_${String(allianceId).slice(0, 8)}`;

      const dup = getDb()
        .prepare(
          'SELECT 1 FROM battle_tracking WHERE discord_guild_id = ? AND track_type = ? AND alliance_id = ?',
        )
        .get(gid(ix.guildId), 'alliance', String(allianceId));
      if (dup) {
        return ix.reply({ content: '❌ Esa alianza ya está en seguimiento.', ephemeral: true });
      }

      const r = getDb()
        .prepare(`
          INSERT INTO battle_tracking (
            discord_guild_id, track_type, channel_id, albion_guild_id, alliance_id, alliance_tag, sent_battles
          ) VALUES (?, 'alliance', ?, ?, ?, ?, '[]')
        `)
        .run(gid(ix.guildId), String(canal.id), gremioId, String(allianceId), allianceTag);

      await seedBattles(getDb, r.lastInsertRowid, gremioId);

      await ix.reply({
        content:
          `✅ Seguimiento de alianza **${allianceTag}** activo\n` +
          `Gremio referencia: **${check.data.Name}**\n` +
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
        const label =
          list[0].track_type === 'alliance'
            ? `alianza ${list[0].alliance_tag}`
            : `gremio ${list[0].albion_guild_id}`;
        return ix.reply({ content: `✅ Detenido: ${label}`, ephemeral: true });
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:stop`)
        .setPlaceholder('Qué detener')
        .addOptions(
          list.map((e) => ({
            label:
              e.track_type === 'alliance'
                ? `Alianza ${e.alliance_tag || e.alliance_id}`.slice(0, 100)
                : `Gremio ${e.albion_guild_id}`.slice(0, 100),
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

  onGuildRemove(guildId, { getDb }) {
    getDb().prepare('DELETE FROM battle_tracking WHERE discord_guild_id = ?').run(gid(guildId));
  },

  onInit(client, { getDb, log }) {
    setInterval(() => runMonitor(getDb, client, log), 60 * 1000);
    log.info('Battle monitor cada 1 min');
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
