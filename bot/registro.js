const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
} = require('discord.js');

const ALBION = 'https://gameinfo.albiononline.com/api/gameinfo';
const PANEL = 'registro:panel';
const pendingPick = new Map();
const pendingGuildInfo = new Map();
const GUILD_INFO_TTL = 120_000;
const pendingRegistroAdd = new Map();
const REGISTRO_ADD_TTL = 300_000;
const pendingAlliancePick = new Map();
const ALLIANCE_PICK_TTL = 300_000;

async function albionFetch(url) {
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

const albionSearch = (q) => albionFetch(`${ALBION}/search?q=${encodeURIComponent(q)}`);
const albionPlayer = (id) => albionFetch(`${ALBION}/players/${id}`);
const albionGuild = (id) => albionFetch(`${ALBION}/guilds/${id}`);
const albionAlliance = (id) => albionFetch(`${ALBION}/alliances/${id}`);

function fmtFame(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '0';
  if (x >= 1e12) return `${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return x.toLocaleString('en-US');
}

function fmtFounded(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function allianceLabel(guild) {
  let tag = guild.AllianceTag || '';
  let name = guild.AllianceName || '';
  if (guild.AllianceId && (!name || !tag)) {
    const res = await albionAlliance(guild.AllianceId);
    if (res.ok && res.data) {
      name = res.data.AllianceName || name;
      tag = res.data.AllianceTag || tag;
    }
  }
  if (!guild.AllianceId && !tag && !name) return 'Sin alianza';
  if (tag && name) return `[${tag}] ${name}`;
  if (tag) return `[${tag}]`;
  if (name) return name;
  return '—';
}

function buildGuildInfoEmbed(guild, allianceText) {
  const kill = guild.killFame ?? guild.KillFame ?? 0;
  const death = guild.DeathFame ?? 0;
  const kd = death > 0 && kill > 0 ? (kill / death).toFixed(2) : '—';

  return new EmbedBuilder()
    .setTitle(`🏰 ${guild.Name}`)
    .setColor(0x6b8e23)
    .setDescription(`**ID del gremio** (para registro / killboard)\n\`\`\`\n${guild.Id}\n\`\`\``)
    .addFields(
      { name: 'Alianza', value: allianceText, inline: true },
      { name: 'Miembros', value: String(guild.MemberCount ?? '—'), inline: true },
      { name: 'Fundador', value: guild.FounderName || '—', inline: true },
      { name: 'Fundado', value: fmtFounded(guild.Founded), inline: true },
      { name: 'Kill Fame', value: fmtFame(kill), inline: true },
      { name: 'Death Fame', value: fmtFame(death), inline: true },
      { name: 'Ratio K/D (fame)', value: kd, inline: true },
      {
        name: 'Ataques / Defensas',
        value: `${guild.AttacksWon != null ? guild.AttacksWon : '—'} / ${guild.DefensesWon != null ? guild.DefensesWon : '—'}`,
        inline: true,
      },
    )
    .setFooter({ text: 'Albion Game Info · Américas' })
    .setTimestamp();
}

async function replyGuildInfo(ix, guildId) {
  const res = await albionGuild(guildId);
  if (!res.ok) {
    return ix.editReply({ content: 'No se pudo cargar el gremio en la API de Albion.', embeds: [], components: [] });
  }
  const allianceText = await allianceLabel(res.data);
  const embed = buildGuildInfoEmbed(res.data, allianceText);
  return ix.editReply({ content: null, embeds: [embed], components: [] });
}

function gid(discordGuildId) {
  return String(discordGuildId);
}

function getAlliances(getDb, discordGuildId) {
  return getDb()
    .prepare(
      'SELECT id, albion_alliance_id, albion_alliance_name, albion_alliance_tag FROM registro_alliances WHERE discord_guild_id = ? ORDER BY id ASC',
    )
    .all(gid(discordGuildId));
}

function getGuilds(getDb, discordGuildId) {
  return getDb()
    .prepare(`
      SELECT g.id, g.albion_guild_id, g.albion_guild_name, g.nickname_tag, g.role_id, g.alliance_id,
             g.registro_mode, a.albion_alliance_id, a.albion_alliance_name, a.albion_alliance_tag
      FROM registro_guilds g
      LEFT JOIN registro_alliances a ON g.alliance_id = a.id
      WHERE g.discord_guild_id = ?
      ORDER BY g.id ASC
    `)
    .all(gid(discordGuildId));
}

function getGuildByAlbionId(getDb, discordGuildId, albionGuildId) {
  return getDb()
    .prepare(`
      SELECT g.id, g.albion_guild_id, g.albion_guild_name, g.nickname_tag, g.role_id, g.alliance_id,
             g.registro_mode, a.albion_alliance_id, a.albion_alliance_name
      FROM registro_guilds g
      LEFT JOIN registro_alliances a ON g.alliance_id = a.id
      WHERE g.discord_guild_id = ? AND g.albion_guild_id = ?
    `)
    .get(gid(discordGuildId), String(albionGuildId));
}

function getAllianceRow(getDb, discordGuildId, allianceRowId) {
  return getDb()
    .prepare('SELECT * FROM registro_alliances WHERE id = ? AND discord_guild_id = ?')
    .get(allianceRowId, gid(discordGuildId));
}

/** Resuelve gremio dentro de la alianza por nombre o ID. */
async function resolveGuildInAlliance(allianceAlbionId, { name, id }) {
  const aRes = await albionAlliance(allianceAlbionId);
  if (!aRes.ok) return { error: 'No se pudo cargar la alianza desde Albion.' };

  const guildList = aRes.data?.Guilds || [];
  const inAlliance = new Set(guildList.map((g) => g.Id));

  if (id?.trim()) {
    const gidVal = id.trim();
    if (!inAlliance.has(gidVal)) {
      return { error: 'Ese ID de gremio no pertenece a la alianza configurada.' };
    }
    const gRes = await albionGuild(gidVal);
    return { id: gidVal, name: gRes.data?.Name || gidVal };
  }

  if (name?.trim()) {
    const q = name.trim().toLowerCase();
    const m =
      guildList.find((g) => g.Name?.toLowerCase() === q) ||
      guildList.find((g) => g.Name?.toLowerCase().includes(q));
    if (!m) return { error: `No encontré **${name.trim()}** en esta alianza.` };
    return { id: m.Id, name: m.Name };
  }

  return { error: 'Indica **nombre del gremio** o **ID del gremio** (al menos uno).' };
}

function findGuildRowForPlayer(getDb, discordGuildId, player) {
  const pGuild = playerGuildId(player);
  const pAlliance = playerAllianceId(player);

  const normal = pGuild
    ? getDb()
        .prepare(`
          SELECT g.*, a.albion_alliance_id, a.albion_alliance_name
          FROM registro_guilds g
          LEFT JOIN registro_alliances a ON g.alliance_id = a.id
          WHERE g.discord_guild_id = ? AND g.albion_guild_id = ?
            AND (g.registro_mode IS NULL OR g.registro_mode = 'guild')
        `)
        .get(gid(discordGuildId), pGuild)
    : null;

  if (normal) {
    if (normal.albion_alliance_id && pAlliance && pAlliance !== normal.albion_alliance_id) return null;
    return normal;
  }

  if (!pAlliance) return null;

  const allianceRows = getDb()
    .prepare(`
      SELECT g.*, a.albion_alliance_id, a.albion_alliance_name
      FROM registro_guilds g
      INNER JOIN registro_alliances a ON g.alliance_id = a.id
      WHERE g.discord_guild_id = ? AND g.registro_mode = 'alliance'
        AND a.albion_alliance_id = ?
    `)
    .all(gid(discordGuildId), pAlliance);

  if (!allianceRows.length) return null;
  return allianceRows.find((r) => r.albion_guild_id === pGuild) || allianceRows[0];
}

function openGremioAlianzaModal(ix, allianceRow) {
  const key = `${ix.user.id}:${ix.channelId}`;
  if (pendingAlliancePick.has(key)) clearTimeout(pendingAlliancePick.get(key).timer);
  const timer = setTimeout(() => pendingAlliancePick.delete(key), ALLIANCE_PICK_TTL);
  pendingAlliancePick.set(key, { ownerId: ix.user.id, allianceRowId: allianceRow.id, timer });

  const modal = new ModalBuilder()
    .setCustomId('registro:modal:gremio-alianza')
    .setTitle('Gremio alianza')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('nombre')
          .setLabel('Nombre del gremio (opcional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('gid')
          .setLabel('ID del gremio Albion (opcional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tag')
          .setLabel('Tag nick (ej: [TAG])')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('[TAG]'),
      ),
    );
  return ix.showModal(modal);
}

function playerGuildId(p) {
  return String(p.GuildId || p.guildId || '');
}

function playerAllianceId(p) {
  return String(p.AllianceId || p.allianceId || '');
}

function purgeRegistro(getDb, discordGuildId) {
  const id = gid(discordGuildId);
  getDb().prepare('DELETE FROM registro_users WHERE discord_guild_id = ?').run(id);
  getDb().prepare('DELETE FROM registro_guilds WHERE discord_guild_id = ?').run(id);
  getDb().prepare('DELETE FROM registro_alliances WHERE discord_guild_id = ?').run(id);
}

/** Tras un select menu: el spread de Interaction no copia `guild` (getters del prototipo). */
function registerCtxFromSelect(selectIx, member) {
  return {
    guild: selectIx.guild,
    guildId: selectIx.guildId,
    editReply: (opts) => selectIx.followUp(opts),
  };
}

function canManageRoles(guild, roleId) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'El bot no puede gestionar roles.';
  const role = guild.roles.cache.get(roleId);
  if (!role) return 'Rol no encontrado.';
  if (role.position >= me.roles.highest.position) return `El rol ${role.name} está por encima del bot.`;
  return null;
}

async function finishRegister(ix, member, player, guildRow, getDb) {
  const guild = ix.guild;
  const err = canManageRoles(guild, guildRow.role_id);
  if (err) {
    await ix.editReply({ content: `❌ ${err}` });
    return;
  }

  const role = guild.roles.cache.get(guildRow.role_id);
  try {
    if (role && !member.roles.cache.has(role.id)) await member.roles.add(role);
    const nick = `${guildRow.nickname_tag} ${player.Name}`.trim();
    if (nick.length <= 32) await member.setNickname(nick).catch(() => {});
  } catch {
    await ix.editReply({ content: '❌ No pude asignar rol o nick (permisos).' });
    return;
  }

  getDb()
    .prepare(`
      INSERT INTO registro_users (discord_user_id, discord_guild_id, albion_player_id, albion_player_name, registro_guild_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(discord_user_id, discord_guild_id) DO UPDATE SET
        albion_player_id = excluded.albion_player_id,
        albion_player_name = excluded.albion_player_name,
        registro_guild_id = excluded.registro_guild_id
    `)
    .run(gid(guild.id), String(member.id), String(player.Id), player.Name, guildRow.id);

  const gremioCfg = guildRow.albion_guild_name || guildRow.nickname_tag;
  const isAlliance = guildRow.registro_mode === 'alliance';
  const lines = [
    `🎉 ¡Bienvenido a **${gremioCfg}**, **${player.Name}**!`,
    '',
    '👤 **Nombre en Albion**',
    player.Name,
    '',
  ];
  if (isAlliance) {
    lines.push(
      '🌐 **Alianza**',
      player.AllianceName || guildRow.albion_alliance_name || '—',
      '',
      '🏰 **Gremio**',
      player.GuildName || gremioCfg,
    );
  } else {
    lines.push('🏰 **Gremio**', player.GuildName || gremioCfg);
  }

  const embed = new EmbedBuilder().setColor(0x57f287).setDescription(lines.join('\n'));
  await ix.editReply({ content: null, embeds: [embed] });
}

async function tryRegister(ix, member, player, getDb) {
  const pAlliance = playerAllianceId(player);
  const guildRow = findGuildRowForPlayer(getDb, ix.guildId, player);

  if (!guildRow) {
    const agId = playerGuildId(player);
    if (!agId && !pAlliance) {
      await ix.editReply({ content: '❌ El jugador no tiene gremio en Albion.' });
      return;
    }
    await ix.editReply({
      content:
        '❌ No hay configuración de registro para este jugador.\n' +
        'Gremio normal: debe estar en el gremio exacto. Gremio alianza: debe estar en la alianza configurada.',
    });
    return;
  }

  if (guildRow.registro_mode === 'alliance') {
    if (!pAlliance || pAlliance !== guildRow.albion_alliance_id) {
      await ix.editReply({
        content:
          `❌ Debes estar en la alianza **${guildRow.albion_alliance_name || guildRow.albion_alliance_id}**.\n` +
          `Tu alianza actual: ${player.AllianceName || pAlliance || 'ninguna'}`,
      });
      return;
    }
  } else {
    const agId = playerGuildId(player);
    if (!agId || guildRow.albion_guild_id !== agId) {
      await ix.editReply({
        content: `❌ Debes estar en el gremio **${guildRow.albion_guild_name || guildRow.nickname_tag}** en Albion.`,
      });
      return;
    }
  }

  await finishRegister(ix, member, player, guildRow, getDb);
}

async function resolvePlayer(ix, { nombre, id }, getDb) {
  await ix.deferReply();

  if (id) {
    const res = await albionPlayer(id);
    if (!res.ok || !res.data) return ix.editReply('❌ Jugador no encontrado por ID.');
    return tryRegister(ix, ix.member, res.data, getDb);
  }

  const res = await albionSearch(nombre);
  const players = (res.data?.players || []).filter((p) =>
    p.Name?.toLowerCase().startsWith(nombre.toLowerCase()),
  );

  if (!players.length) return ix.editReply(`❌ Sin resultados para **${nombre}**.`);
  if (players.length === 1) return tryRegister(ix, ix.member, players[0], getDb);

  const key = `${ix.guildId}:${ix.user.id}`;
  pendingPick.set(key, { players, memberId: ix.user.id });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`registro:pick:${ix.user.id}`)
    .setPlaceholder('Elige tu personaje')
    .addOptions(
      players.slice(0, 25).map((p, i) => ({
        label: p.Name.slice(0, 100),
        description: `${p.GuildName || 'Sin gremio'}`.slice(0, 100),
        value: String(i),
      })),
    );

  await ix.editReply({
    content: 'Varios jugadores encontrados:',
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function registerFlow(ix, targetMember, { nombre, id }, getDb) {
  await ix.deferReply();

  if (id) {
    const res = await albionPlayer(id);
    if (!res.ok || !res.data) return ix.editReply('❌ Jugador no encontrado.');
    return tryRegister(ix, targetMember, res.data, getDb);
  }

  const res = await albionSearch(nombre);
  const players = (res.data?.players || []).filter((p) =>
    p.Name?.toLowerCase().startsWith(nombre.toLowerCase()),
  );
  if (!players.length) return ix.editReply('❌ Sin resultados.');
  if (players.length === 1) return tryRegister(ix, targetMember, players[0], getDb);

  const key = `manual:${ix.guildId}:${ix.user.id}`;
  pendingPick.set(key, { players, memberId: targetMember.id });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`registro:pickmanual:${ix.user.id}:${targetMember.id}`)
    .setPlaceholder('Elige el personaje')
    .addOptions(
      players.slice(0, 25).map((p, i) => ({
        label: p.Name.slice(0, 100),
        value: String(i),
      })),
    );

  await ix.editReply({
    content: `Selecciona cuenta para ${targetMember}:`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

function panelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PANEL}:alianza`).setLabel('Alianza').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PANEL}:gremio-alianza`)
        .setLabel('Gremio alianza')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PANEL}:anadir`).setLabel('Añadir gremio').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PANEL}:listar`).setLabel('Listar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PANEL}:editar`).setLabel('Editar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PANEL}:quitar`).setLabel('Quitar').setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function showList(ix, getDb) {
  const list = getGuilds(getDb, ix.guildId);
  if (!list.length) {
    return ix.reply({ content: 'No hay gremios configurados.', ephemeral: true });
  }
  const embed = new EmbedBuilder().setTitle('Gremios configurados').setColor(0x5865f2);
  for (const g of list) {
    const role = ix.guild.roles.cache.get(g.role_id);
    const count = getDb()
      .prepare('SELECT COUNT(*) AS n FROM registro_users WHERE registro_guild_id = ?')
      .get(g.id).n;
    const tipo = g.registro_mode === 'alliance' ? '🌐 Gremio alianza' : '🏰 Gremio normal';
    embed.addFields({
      name: `${tipo} · \`${g.nickname_tag}\` ${g.albion_guild_name || '—'}`,
      value:
        `ID Albion: \`${g.albion_guild_id}\`\n` +
        `Rol: ${role || 'no encontrado'}\n` +
        `Alianza: ${g.albion_alliance_name || '—'}\n` +
        `Registrados: **${count}**`,
      inline: false,
    });
  }
  await ix.reply({ embeds: [embed], components: panelButtons(), ephemeral: true });
}

async function startMonitor(client, getDb, log) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const users = getDb()
          .prepare(`
            SELECT u.discord_user_id, u.albion_player_id, u.albion_player_name,
                   g.albion_guild_id, g.albion_guild_name, g.nickname_tag, g.role_id,
                   g.registro_mode, a.albion_alliance_id, a.albion_alliance_name
            FROM registro_users u
            JOIN registro_guilds g ON u.registro_guild_id = g.id
            LEFT JOIN registro_alliances a ON g.alliance_id = a.id
            WHERE u.discord_guild_id = ?
          `)
          .all(gid(guild.id));

        for (const u of users) {
          const member = await guild.members.fetch(u.discord_user_id).catch(() => null);
          if (!member) {
            getDb()
              .prepare('DELETE FROM registro_users WHERE discord_user_id = ? AND discord_guild_id = ?')
              .run(u.discord_user_id, gid(guild.id));
            continue;
          }

          const res = await albionPlayer(u.albion_player_id);
          if (!res.ok || !res.data) continue;

          const p = res.data;
          const currentGuild = playerGuildId(p);

          if (p.Name !== u.albion_player_name) {
            getDb()
              .prepare('UPDATE registro_users SET albion_player_name = ? WHERE discord_user_id = ? AND discord_guild_id = ?')
              .run(p.Name, u.discord_user_id, gid(guild.id));
            const nick = `${u.nickname_tag} ${p.Name}`.trim();
            if (nick.length <= 32) await member.setNickname(nick).catch(() => {});
          }

          const pAlliance = playerAllianceId(p);
          let unregister = false;
          let reason = '';

          if (u.registro_mode === 'alliance') {
            if (!pAlliance || pAlliance !== u.albion_alliance_id) {
              unregister = true;
              reason = `salió de la alianza ${u.albion_alliance_name || ''}`.trim();
            }
          } else if (currentGuild !== u.albion_guild_id) {
            unregister = true;
            reason = `salió del gremio ${u.albion_guild_name}`;
          }

          if (unregister) {
            const role = guild.roles.cache.get(u.role_id);
            if (role?.editable) await member.roles.remove(role).catch(() => {});
            await member.setNickname(null).catch(() => {});
            getDb()
              .prepare('DELETE FROM registro_users WHERE discord_user_id = ? AND discord_guild_id = ?')
              .run(u.discord_user_id, gid(guild.id));
            log.info(`Registro: ${p.Name} ${reason}`);
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (e) {
        log.warn(`Monitor ${guild.id}: ${e.message}`);
      }
    }
  }, 10 * 60 * 1000);
  log.info('Monitor registro cada 10 min');
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('registrarse')
      .setDescription('Vincula tu cuenta de Albion')
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre en Albion').setRequired(false))
      .addStringOption((o) => o.setName('id').setDescription('ID de jugador Albion').setRequired(false)),
    async run(ix, { getDb }) {
      const nombre = ix.options.getString('nombre');
      const id = ix.options.getString('id');
      if (!nombre && !id) return ix.reply({ content: 'Indica **nombre** o **id**.', ephemeral: true });
      if (!getGuilds(getDb, ix.guildId).length) {
        return ix.reply({ content: 'No hay gremios configurados.', ephemeral: true });
      }
      return resolvePlayer(ix, { nombre, id }, getDb);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('registro_manual')
      .setDescription('Registra a otro miembro (Mod)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('usuario').setDescription('Miembro de Discord').setRequired(true))
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre en Albion').setRequired(false))
      .addStringOption((o) => o.setName('id').setDescription('ID de jugador Albion').setRequired(false)),
    async run(ix, { getDb }) {
      const usuario = ix.options.getUser('usuario');
      const nombre = ix.options.getString('nombre');
      const id = ix.options.getString('id');
      if (!nombre && !id) return ix.reply({ content: 'Indica **nombre** o **id**.', ephemeral: true });
      if (!getGuilds(getDb, ix.guildId).length) {
        return ix.reply({ content: 'No hay gremios configurados.', ephemeral: true });
      }
      const member = await ix.guild.members.fetch(usuario.id).catch(() => null);
      if (!member) return ix.reply({ content: 'Miembro no encontrado.', ephemeral: true });
      return registerFlow(ix, member, { nombre, id }, getDb);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('informacion_gremio')
      .setDescription('Información detallada de un gremio de Albion')
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre del gremio').setRequired(true)),
    async run(ix) {
      await ix.deferReply();
      const query = ix.options.getString('nombre');
      const res = await albionSearch(query);
      if (!res.ok) return ix.editReply('Error al consultar la API de Albion.');
      const list = (res.data?.guilds || []).slice(0, 5);
      if (!list.length) return ix.editReply(`Sin gremios para **${query}**.`);

      if (list.length === 1) return replyGuildInfo(ix, list[0].Id);

      const pick = new EmbedBuilder()
        .setTitle('Varios gremios encontrados')
        .setDescription('Elige cuál quieres ver en detalle.')
        .setColor(0x6b8e23);

      const select = new StringSelectMenuBuilder()
        .setCustomId('registro:guildinfo')
        .setPlaceholder('Selecciona un gremio…')
        .addOptions(
          list.map((g) => ({
            label: g.Name.slice(0, 100),
            description: `ID: ${g.Id}`.slice(0, 100),
            value: g.Id,
          })),
        );

      await ix.editReply({ embeds: [pick], components: [new ActionRowBuilder().addComponents(select)] });

      const key = `${ix.user.id}:${ix.channelId}`;
      if (pendingGuildInfo.has(key)) clearTimeout(pendingGuildInfo.get(key).timer);
      const timer = setTimeout(() => pendingGuildInfo.delete(key), GUILD_INFO_TTL);
      pendingGuildInfo.set(key, { ownerId: ix.user.id, timer });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('configurar_registro')
      .setDescription('Panel de administración del registro')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async run(ix) {
      const embed = new EmbedBuilder()
        .setTitle('Configuración — Registro')
        .setDescription(
          '**Alianza** — guardar ID de alianza\n' +
            '**Gremio alianza** — nombre o ID del gremio + tag + rol (monitorea la alianza)\n' +
            '**Añadir gremio** — gremio fijo por ID (monitorea el gremio)\n' +
            '**Listar · Editar · Quitar**',
        )
        .setColor(0x5865f2);
      await ix.reply({ embeds: [embed], components: panelButtons(), ephemeral: true });
    },
  },
];

module.exports = {
  id: 'registro',
  commands,
  onGuildRemove(guildId, { getDb }) {
    purgeRegistro(getDb, guildId);
  },
  onInit(client, ctx) {
    startMonitor(client, ctx.getDb, ctx.log);
  },
  async handleInteraction(ix, ctx) {
    const { getDb } = ctx;
    const names = ['registrarse', 'registro_manual', 'informacion_gremio', 'configurar_registro'];
    if (ix.isChatInputCommand() && names.includes(ix.commandName)) {
      await commands.find((x) => x.data.name === ix.commandName).run(ix, ctx);
      return true;
    }

    if (ix.isStringSelectMenu()) {
      if (ix.customId === 'registro:guildinfo') {
        const key = `${ix.user.id}:${ix.channelId}`;
        const state = pendingGuildInfo.get(key);
        if (!state || ix.user.id !== state.ownerId) {
          await ix.reply({ content: 'Esta selección ya no está disponible.', ephemeral: true });
          return true;
        }
        clearTimeout(state.timer);
        pendingGuildInfo.delete(key);
        await ix.deferUpdate();
        await replyGuildInfo(ix, ix.values[0]);
        return true;
      }
      if (ix.customId.startsWith('registro:pick:')) {
        const key = `${ix.guildId}:${ix.customId.split(':')[2]}`;
        const data = pendingPick.get(key);
        pendingPick.delete(key);
        if (!data || ix.user.id !== data.memberId) {
          await ix.reply({ content: 'Selección inválida.', ephemeral: true });
          return true;
        }
        await ix.deferUpdate();
        const player = data.players[Number(ix.values[0])];
        await tryRegister(registerCtxFromSelect(ix, ix.member), ix.member, player, getDb);
        return true;
      }
      if (ix.customId.startsWith('registro:pickmanual:')) {
        const parts = ix.customId.split(':');
        const targetId = parts[3];
        const key = `manual:${ix.guildId}:${parts[2]}`;
        const data = pendingPick.get(key);
        pendingPick.delete(key);
        if (!data || ix.user.id !== parts[2]) {
          await ix.reply({ content: 'Selección inválida.', ephemeral: true });
          return true;
        }
        const member = await ix.guild.members.fetch(targetId).catch(() => null);
        if (!member) {
          await ix.reply({ content: 'Miembro no encontrado.', ephemeral: true });
          return true;
        }
        await ix.deferUpdate();
        const player = data.players[Number(ix.values[0])];
        await tryRegister(registerCtxFromSelect(ix, member), member, player, getDb);
        return true;
      }
      if (ix.customId === 'registro:select:alianza-pick') {
        const alliances = getAlliances(getDb, ix.guildId);
        const row = alliances.find((a) => String(a.id) === ix.values[0]);
        if (!row) {
          await ix.reply({ content: 'Alianza no encontrada.', ephemeral: true });
          return true;
        }
        await openGremioAlianzaModal(ix, row);
        return true;
      }
      if (ix.customId === 'registro:select:editar') {
        const row = getGuilds(getDb, ix.guildId).find((g) => String(g.id) === ix.values[0]);
        if (!row) return ix.reply({ content: 'Gremio no encontrado.', ephemeral: true }), true;
        const role = ix.guild.roles.cache.get(row.role_id);
        const roleMenu = new RoleSelectMenuBuilder()
          .setCustomId(`registro:role:editar:${row.id}`)
          .setPlaceholder('Selecciona el rol de registro')
          .setMinValues(1)
          .setMaxValues(1);
        const tagBtn = new ButtonBuilder()
          .setCustomId(`registro:panel:tag:${row.id}`)
          .setLabel('Cambiar tag')
          .setStyle(ButtonStyle.Secondary);
        await ix.reply({
          content:
            `**${row.albion_guild_name || row.albion_guild_id}** · tag \`${row.nickname_tag}\`\n` +
            `Rol actual: ${role || 'no encontrado'}\n\n` +
            'Elige el **rol** en el menú (puedes buscar y seleccionar como siempre en Discord).',
          components: [
            new ActionRowBuilder().addComponents(roleMenu),
            new ActionRowBuilder().addComponents(tagBtn),
          ],
          ephemeral: true,
        });
        return true;
      }
      if (ix.customId === 'registro:select:quitar') {
        const id = Number(ix.values[0]);
        getDb().prepare('DELETE FROM registro_users WHERE registro_guild_id = ?').run(id);
        getDb().prepare('DELETE FROM registro_guilds WHERE id = ? AND discord_guild_id = ?').run(id, gid(ix.guildId));
        await ix.update({ content: '✅ Gremio eliminado de la configuración.', components: [], embeds: [] });
        return true;
      }
    }

    if (ix.isRoleSelectMenu()) {
      if (ix.customId.startsWith('registro:role:editar:')) {
        const rowId = Number(ix.customId.split(':')[3]);
        const roleId = ix.values[0];
        const err = canManageRoles(ix.guild, roleId);
        if (err) {
          await ix.reply({ content: `❌ ${err}`, ephemeral: true });
          return true;
        }
        getDb().prepare('UPDATE registro_guilds SET role_id = ? WHERE id = ?').run(roleId, rowId);
        const role = ix.guild.roles.cache.get(roleId);
        await ix.update({
          content: `✅ Rol actualizado a **${role?.name || roleId}**.`,
          components: [],
        });
        return true;
      }
      if (ix.customId === 'registro:role:anadir') {
        const key = `${ix.user.id}:${ix.guildId}`;
        const state = pendingRegistroAdd.get(key);
        if (!state || ix.user.id !== state.ownerId) {
          await ix.reply({ content: 'Esta configuración expiró. Pulsa **Añadir gremio** de nuevo.', ephemeral: true });
          return true;
        }
        clearTimeout(state.timer);
        pendingRegistroAdd.delete(key);
        const roleId = ix.values[0];
        if (!state.tag) {
          await ix.reply({ content: 'Falta el tag. Usa **Gremio alianza** o **Añadir gremio** de nuevo.', ephemeral: true });
          return true;
        }
        const err = canManageRoles(ix.guild, roleId);
        if (err) {
          await ix.reply({ content: `❌ ${err}`, ephemeral: true });
          return true;
        }
        const mode = state.registroMode || 'guild';
        getDb()
          .prepare(`
            INSERT INTO registro_guilds (discord_guild_id, albion_guild_id, albion_guild_name, nickname_tag, role_id, alliance_id, registro_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(discord_guild_id, albion_guild_id) DO UPDATE SET
              nickname_tag = excluded.nickname_tag, role_id = excluded.role_id, alliance_id = excluded.alliance_id,
              albion_guild_name = excluded.albion_guild_name, registro_mode = excluded.registro_mode
          `)
          .run(
            gid(ix.guildId),
            state.gAlbion,
            state.gName,
            state.tag,
            roleId,
            state.allianceRowId,
            mode,
          );
        const role = ix.guild.roles.cache.get(roleId);
        const tipo = mode === 'alliance' ? ' (monitoreo por alianza)' : '';
        await ix.update({
          content: `✅ Gremio **${state.gName}** añadido${tipo}.\nTag: \`${state.tag}\` · Rol: **${role?.name || roleId}**`,
          components: [],
        });
        return true;
      }
    }

    if (ix.isButton() && ix.customId?.startsWith(PANEL)) {
      const parts = ix.customId.split(':');
      const action = parts[2];
      if (action === 'tag') {
        const rowId = Number(parts[3]);
        const row = getGuilds(getDb, ix.guildId).find((g) => g.id === rowId);
        if (!row) {
          await ix.reply({ content: 'Gremio no encontrado.', ephemeral: true });
          return true;
        }
        const modal = new ModalBuilder()
          .setCustomId(`registro:modal:editar-tag:${rowId}`)
          .setTitle('Cambiar tag del gremio')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('tag')
                .setLabel('Tag nick (ej: [TAG])')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(row.nickname_tag),
            ),
          );
        await ix.showModal(modal);
        return true;
      }
      if (action === 'listar') {
        await showList(ix, getDb);
        return true;
      }
      if (action === 'gremio-alianza') {
        const alliances = getAlliances(getDb, ix.guildId);
        if (!alliances.length) {
          await ix.reply({
            content: '❌ Primero guarda la alianza con el botón **Alianza** (ID de Albion).',
            ephemeral: true,
          });
          return true;
        }
        if (alliances.length === 1) {
          await openGremioAlianzaModal(ix, alliances[0]);
          return true;
        }
        const menu = new StringSelectMenuBuilder()
          .setCustomId('registro:select:alianza-pick')
          .setPlaceholder('Selecciona la alianza…')
          .addOptions(
            alliances.slice(0, 25).map((a) => ({
              label: (a.albion_alliance_name || a.albion_alliance_id).slice(0, 100),
              description: (a.albion_alliance_tag ? `[${a.albion_alliance_tag}]` : a.albion_alliance_id).slice(
                0,
                100,
              ),
              value: String(a.id),
            })),
          );
        await ix.reply({
          content: '**Gremio alianza** — elige la alianza, luego completa el formulario:',
          components: [new ActionRowBuilder().addComponents(menu)],
          ephemeral: true,
        });
        return true;
      }
      if (action === 'alianza') {
        const modal = new ModalBuilder()
          .setCustomId('registro:modal:alianza')
          .setTitle('Configurar alianza')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID de alianza Albion')
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
            ),
          );
        await ix.showModal(modal);
        return true;
      }
      if (action === 'anadir') {
        const modal = new ModalBuilder()
          .setCustomId('registro:modal:anadir')
          .setTitle('Añadir gremio — paso 1')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('gid').setLabel('ID gremio Albion').setStyle(TextInputStyle.Short).setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('tag').setLabel('Tag nick (ej: [TAG])').setStyle(TextInputStyle.Short).setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('ali')
                .setLabel('ID alianza (opcional, debe existir)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false),
            ),
          );
        await ix.showModal(modal);
        return true;
      }
      if (action === 'editar') {
        const list = getGuilds(getDb, ix.guildId);
        if (!list.length) {
          await ix.reply({ content: 'No hay gremios.', ephemeral: true });
          return true;
        }
        const menu = new StringSelectMenuBuilder()
          .setCustomId('registro:select:editar')
          .setPlaceholder('Gremio a editar')
          .addOptions(list.map((g) => ({ label: `${g.nickname_tag} ${g.albion_guild_name || g.albion_guild_id}`.slice(0, 100), value: String(g.id) })));
        await ix.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        return true;
      }
      if (action === 'quitar') {
        const list = getGuilds(getDb, ix.guildId);
        if (!list.length) {
          await ix.reply({ content: 'No hay gremios.', ephemeral: true });
          return true;
        }
        const menu = new StringSelectMenuBuilder()
          .setCustomId('registro:select:quitar')
          .setPlaceholder('Gremio a quitar')
          .addOptions(list.map((g) => ({ label: g.albion_guild_name || g.albion_guild_id, value: String(g.id) })));
        await ix.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        return true;
      }
    }

    if (ix.isModalSubmit()) {
      if (ix.customId === 'registro:modal:alianza') {
        const allianceId = ix.fields.getTextInputValue('id').trim();
        const res = await albionFetch(`${ALBION}/alliances/${allianceId}`);
        const name = res.data?.Name || res.data?.AllianceName || 'Alianza';
        const tag = res.data?.Tag || res.data?.AllianceTag || '';
        getDb()
          .prepare(`
            INSERT INTO registro_alliances (discord_guild_id, albion_alliance_id, albion_alliance_name, albion_alliance_tag)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(discord_guild_id, albion_alliance_id) DO UPDATE SET
              albion_alliance_name = excluded.albion_alliance_name,
              albion_alliance_tag = excluded.albion_alliance_tag
          `)
          .run(gid(ix.guildId), allianceId, name, tag);
        await ix.reply({ content: `✅ Alianza **${name}** (\`${allianceId}\`) guardada.`, ephemeral: true });
        return true;
      }
      if (ix.customId === 'registro:modal:gremio-alianza') {
        const key = `${ix.user.id}:${ix.channelId}`;
        const pick = pendingAlliancePick.get(key);
        if (!pick || ix.user.id !== pick.ownerId) {
          await ix.reply({ content: 'Sesión expirada. Usa **Gremio alianza** de nuevo.', ephemeral: true });
          return true;
        }
        clearTimeout(pick.timer);
        pendingAlliancePick.delete(key);

        const allianceRow = getAllianceRow(getDb, ix.guildId, pick.allianceRowId);
        if (!allianceRow) {
          await ix.reply({ content: 'Alianza no encontrada en la configuración.', ephemeral: true });
          return true;
        }

        const nombre = ix.fields.getTextInputValue('nombre')?.trim() || '';
        const gidField = ix.fields.getTextInputValue('gid')?.trim() || '';
        const tag = ix.fields.getTextInputValue('tag').trim();

        if (!nombre && !gidField) {
          await ix.reply({
            content: '❌ Indica al menos uno: **nombre del gremio** o **ID del gremio**.',
            ephemeral: true,
          });
          return true;
        }

        const resolved = await resolveGuildInAlliance(allianceRow.albion_alliance_id, {
          name: nombre,
          id: gidField,
        });
        if (resolved.error) {
          await ix.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
          return true;
        }

        if (pendingRegistroAdd.has(key)) clearTimeout(pendingRegistroAdd.get(key).timer);
        const timer = setTimeout(() => pendingRegistroAdd.delete(key), REGISTRO_ADD_TTL);
        pendingRegistroAdd.set(key, {
          ownerId: ix.user.id,
          gAlbion: resolved.id,
          gName: resolved.name,
          tag,
          allianceRowId: allianceRow.id,
          registroMode: 'alliance',
          timer,
        });

        const roleMenu = new RoleSelectMenuBuilder()
          .setCustomId('registro:role:anadir')
          .setPlaceholder('Selecciona el rol de registro')
          .setMinValues(1)
          .setMaxValues(1);
        await ix.reply({
          content:
            `**Gremio alianza** — **${resolved.name}**\n` +
            `Tag: \`${tag}\` · Monitoreo: **permanecer en la alianza**\n` +
            'Selecciona el **rol de Discord**:',
          components: [new ActionRowBuilder().addComponents(roleMenu)],
          ephemeral: true,
        });
        return true;
      }
      if (ix.customId === 'registro:modal:anadir') {
        const gAlbion = ix.fields.getTextInputValue('gid').trim();
        const tag = ix.fields.getTextInputValue('tag').trim();
        const aliOpt = ix.fields.getTextInputValue('ali')?.trim();
        const gRes = await albionGuild(gAlbion);
        const gName = gRes.data?.Name || gAlbion;
        let allianceRowId = null;
        if (aliOpt) {
          const a = getDb()
            .prepare('SELECT id FROM registro_alliances WHERE discord_guild_id = ? AND albion_alliance_id = ?')
            .get(gid(ix.guildId), aliOpt);
          if (!a) {
            await ix.reply({ content: '❌ Alianza no configurada. Usa **Alianza** primero.', ephemeral: true });
            return true;
          }
          allianceRowId = a.id;
        }
        const key = `${ix.user.id}:${ix.guildId}`;
        if (pendingRegistroAdd.has(key)) clearTimeout(pendingRegistroAdd.get(key).timer);
        const timer = setTimeout(() => pendingRegistroAdd.delete(key), REGISTRO_ADD_TTL);
        pendingRegistroAdd.set(key, {
          ownerId: ix.user.id,
          gAlbion,
          gName,
          tag,
          allianceRowId,
          registroMode: 'guild',
          timer,
        });
        const roleMenu = new RoleSelectMenuBuilder()
          .setCustomId('registro:role:anadir')
          .setPlaceholder('Selecciona el rol de registro')
          .setMinValues(1)
          .setMaxValues(1);
        await ix.reply({
          content:
            `**Paso 2** — Gremio **${gName}** · tag \`${tag}\`\n` +
            'Monitoreo: **permanecer en este gremio**.\n' +
            'Selecciona el **rol de Discord**:',
          components: [new ActionRowBuilder().addComponents(roleMenu)],
          ephemeral: true,
        });
        return true;
      }
      if (ix.customId.startsWith('registro:modal:editar-tag:')) {
        const rowId = Number(ix.customId.split(':')[3]);
        const tag = ix.fields.getTextInputValue('tag').trim();
        if (tag) getDb().prepare('UPDATE registro_guilds SET nickname_tag = ? WHERE id = ?').run(tag, rowId);
        await ix.reply({ content: tag ? `✅ Tag actualizado a \`${tag}\`.` : 'Sin cambios.', ephemeral: true });
        return true;
      }
    }

    return false;
  },
};
