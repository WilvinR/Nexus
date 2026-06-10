const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  Colors,
} = require('discord.js');

const PREFIX = 'util';
const {
  UTC_TICK_MS,
  utcTimeString,
  setupUtcChannel,
  listUtcClocksInGuild,
  removeUtcChannelById,
  tickAllUtcClocks,
} = require('./utcClock');

const CATEGORIES = {
  registro: {
    label: 'Registro Albion',
    emoji: '📋',
    commands: [
      { name: '/registrarse', desc: 'Vincula tu cuenta de Albion al Discord (nombre o ID).' },
      { name: '/registro_manual', desc: 'Registra manualmente a un miembro (Mod).' },
      { name: '/informacion_gremio', desc: 'Info del gremio: founder, IDs, tag y top players.' },
      { name: '/configurar_registro', desc: 'Panel para configurar alianza, gremios y roles de registro.' },
    ],
  },
  killboard: {
    label: 'Killboard',
    emoji: '⚔️',
    commands: [
      { name: '/killboard seguir', desc: 'Monitorea kills y muertes de un gremio o jugador.' },
      { name: '/killboard detener', desc: 'Detiene el seguimiento de una entidad.' },
      { name: '/killboard config', desc: 'Muestra la configuración activa del killboard.' },
      { name: '/gucci-kills', desc: 'Activa feed global ≥2M fama (elige canal).' },
      { name: '/gucci-kills-detener', desc: 'Desactiva Gucci Kills.' },
    ],
  },
  batallas: {
    label: 'Battle Report',
    emoji: '🛡️',
    commands: [
      { name: '/seguir_batalla', desc: 'Monitorea batallas de un gremio (canal + gremio_id).' },
      { name: '/seguir_batalla_alianza', desc: 'Monitorea batallas de la alianza (ID alianza o gremio miembro).' },
      { name: '/detener_batalla', desc: 'Detiene el seguimiento de batallas.' },
    ],
  },
  mercado: {
    label: 'Mercado (Américas)',
    emoji: '🪙',
    commands: [
      {
        name: '/precio',
        desc: 'Precio de venta en el mercado Américas. Elige tier (T1–T8) y encantamiento (.0–.4).',
      },
    ],
  },
  logs: {
    label: 'Logs',
    emoji: '📜',
    commands: [
      { name: '/logs', desc: 'Configura el canal de logs del servidor (Mod).' },
      { name: '/pausar_logs', desc: 'Pausa o reanuda los logs (Mod).' },
    ],
  },
  moderacion: {
    label: 'Moderación',
    emoji: '🔨',
    commands: [
      { name: '/warning', desc: 'Envía una advertencia por DM a un usuario.' },
      { name: '/limpiar', desc: 'Elimina mensajes del canal (1–500).' },
      { name: '/autorol', desc: 'Panel de roles automáticos por reacción.' },
      { name: '/automute', desc: 'Silencia a todos en un canal de voz (excepto mods).' },
      { name: '/autounmute', desc: 'Quita el silencio masivo en un canal de voz.' },
      { name: '/infoserver', desc: 'Información del servidor Discord.' },
    ],
  },
  eventos: {
    label: 'Eventos',
    emoji: '📅',
    commands: [
      { name: '/crear_evento', desc: 'Asistente en un mensaje: voz → roles → color/imagen → publicar (Mod).' },
      { name: '/editar_evento', desc: 'Edita un evento activo (Mod).' },
      { name: '/eliminar_evento', desc: 'Elimina un evento (Mod).' },
      { name: '/plantillas', desc: 'Carga o elimina plantillas de eventos (Mod).' },
      { name: 'Dashboard web', desc: 'Crea, edita y elimina eventos desde el panel → Eventos → Configurar.' },
    ],
  },
  sanciones: {
    label: 'Sanciones',
    emoji: '⚖️',
    commands: [
      { name: '/infraccion', desc: 'Aplica un strike o multa a un miembro (Mod).' },
      { name: '/remover', desc: 'Quita strikes o multas a un miembro (Mod).' },
      { name: '/mis_infracciones', desc: 'Consulta tus strikes y multas.' },
      { name: '/infracciones', desc: 'Consulta las infracciones de un miembro (Mod).' },
      { name: '/config_canal', desc: 'Canal donde se publican las infracciones (Mod).' },
      { name: 'Dashboard web', desc: 'Gestiona sanciones y canal desde el panel → Sanciones → Configurar.' },
    ],
  },
  balance: {
    label: 'Balance',
    emoji: '💰',
    commands: [
      { name: '/balance', desc: 'Consulta tu plata virtual acumulada.' },
      { name: '/cargar_balance', desc: 'Carga plata a usuarios (Mod).' },
      { name: '/auditoria_bal', desc: 'Auditoría de balances, pagos y cargas (Admin).' },
      { name: '/pagar', desc: 'Registra un pago y descuenta plata del balance (Mod).' },
    ],
  },
  utilidad: {
    label: 'Utilidad',
    emoji: '🔧',
    commands: [
      { name: '/utc hora', desc: 'Muestra la hora UTC actual.' },
      {
        name: '/utc canal',
        desc: 'Crea un canal de voz con la hora UTC en el nombre (Mod). Se actualiza cada 10 min.',
      },
      { name: '/utc relojes', desc: 'Lista los canales reloj UTC activos en el servidor (Mod).' },
      { name: '/utc quitar', desc: 'Elimina un canal reloj UTC (Mod). Elige cuál si hay varios.' },
      { name: '/sugerencia', desc: 'Envía una sugerencia al desarrollador del bot.' },
      { name: '/ayuda', desc: 'Menú de comandos de Nexus.' },
    ],
  },
};

function categoryEmbed(key) {
  const cat = CATEGORIES[key];
  const embed = new EmbedBuilder()
    .setTitle(`${cat.emoji} ${cat.label}`)
    .setDescription('Comandos disponibles en Nexus:')
    .setColor(Colors.Blurple);
  for (const cmd of cat.commands) {
    embed.addFields({ name: cmd.name, value: cmd.desc, inline: false });
  }
  return embed;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('utc')
      .setDescription('Hora UTC y reloj en canal de voz')
      .addSubcommand((s) => s.setName('hora').setDescription('Muestra la hora UTC ahora'))
      .addSubcommand((s) =>
        s.setName('canal').setDescription('Crea un canal de voz con la hora UTC en el nombre'),
      )
      .addSubcommand((s) => s.setName('relojes').setDescription('Lista canales reloj UTC activos'))
      .addSubcommand((s) => s.setName('quitar').setDescription('Elimina un canal reloj UTC')),
    async run(ix, ctx) {
      const sub = ix.options.getSubcommand();
      if (sub === 'hora') {
        await ix.reply(`# 🕐 ${utcTimeString()} UTC`);
        return;
      }
      if (!ix.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await ix.reply({ content: '❌ Necesitas permiso de administrar el servidor.', ephemeral: true });
        return;
      }
      if (sub === 'canal') {
        await setupUtcChannel(ix, ctx);
        return;
      }
      const { getDb, log, client } = ctx;
      const clocks = await listUtcClocksInGuild(client, getDb, ix.guildId);

      if (sub === 'relojes') {
        if (!clocks.length) {
          await ix.reply({ content: 'ℹ️ No hay canales reloj UTC en este servidor.', ephemeral: true });
          return;
        }
        const lines = clocks.map(
          (c) => `• **${c.channelName}** \`${c.channelId}\`${c.tracked ? ' _(activo en bot)_' : ''}`,
        );
        await ix.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🕐 Relojes UTC activos')
              .setDescription(lines.join('\n'))
              .setColor(Colors.Blurple)
              .setFooter({ text: 'Usa /utc quitar para eliminar uno.' }),
          ],
          ephemeral: true,
        });
        return;
      }

      if (sub === 'quitar') {
        if (!clocks.length) {
          await ix.reply({ content: 'ℹ️ No hay canales reloj UTC en este servidor.', ephemeral: true });
          return;
        }
        if (clocks.length === 1) {
          await removeUtcChannelById(client, getDb, ix.guildId, clocks[0].channelId, log);
          await ix.reply({
            content: `✅ Reloj eliminado: **${clocks[0].channelName}**`,
            ephemeral: true,
          });
          return;
        }
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:utc-del`)
          .setPlaceholder('Elige el reloj a eliminar')
          .addOptions(
            clocks.slice(0, 25).map((c) => ({
              label: c.channelName.slice(0, 100),
              value: c.channelId,
              description: c.tracked ? 'Registrado en el bot' : 'Canal huérfano',
            })),
          );
        await ix.reply({
          content: 'Selecciona el canal reloj que quieres eliminar:',
          components: [new ActionRowBuilder().addComponents(menu)],
          ephemeral: true,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('sugerencia')
      .setDescription('Envía una sugerencia al administrador del bot')
      .addStringOption((o) => o.setName('mensaje').setDescription('Tu sugerencia').setRequired(true)),
    async run(ix, { log, getDb }) {
      const msg = ix.options.getString('mensaje');
      try {
        const { saveSuggestion, logSystem } = require('./adminRoutes');
        saveSuggestion(getDb, {
          userId: String(ix.user.id),
          username: ix.user.tag,
          guildId: String(ix.guildId),
          guildName: ix.guild.name,
          content: msg,
        });
        logSystem(getDb, 'info', `Sugerencia: ${ix.user.tag} en ${ix.guild.name}`, {
          guildId: ix.guildId,
          userId: ix.user.id,
        });
      } catch (e) {
        log.warn(`Sugerencia DB: ${e.message}`);
        return ix.reply({
          content: '❌ No se pudo guardar la sugerencia. Avísale al administrador del bot.',
          ephemeral: true,
        });
      }
      await ix.reply({ content: '✅ Sugerencia enviada. ¡Gracias!', ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('ayuda').setDescription('Menú con todos los comandos de Nexus'),
    async run(ix) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:help`)
        .setPlaceholder('Selecciona una categoría')
        .addOptions(
          Object.entries(CATEGORIES).map(([key, cat]) => ({
            label: cat.label,
            value: key,
            emoji: cat.emoji,
          })),
        );
      const embed = new EmbedBuilder()
        .setTitle('📚 Ayuda — Nexus Bot')
        .setDescription(
          'Bot de Albion Online para servidores **Américas (LATAM)**.\n' +
            'Selecciona una categoría abajo. Los admins también pueden usar el **Dashboard** web para configurar módulos.',
        )
        .setColor(Colors.Blurple);
      await ix.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    },
  },
];

module.exports = {
  id: 'utilidad',
  commands,

  onInit(client, { getDb, log }) {
    tickAllUtcClocks(client, getDb, log).catch((e) => log.warn(`UTC init: ${e.message}`));
    setInterval(() => {
      tickAllUtcClocks(client, getDb, log).catch((e) => log.warn(`UTC tick: ${e.message}`));
    }, UTC_TICK_MS);
    log.info(`Reloj UTC (voz): actualización cada ${UTC_TICK_MS / 60000} min`);
  },

  async handleInteraction(ix, ctx) {
    if (ix.isStringSelectMenu() && ix.customId === `${PREFIX}:utc-del`) {
      if (!ix.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await ix.reply({ content: '❌ Sin permiso.', ephemeral: true });
        return true;
      }
      const channelId = ix.values[0];
      const { getDb, log, client } = ctx;
      const clocks = await listUtcClocksInGuild(client, getDb, ix.guildId);
      const picked = clocks.find((c) => c.channelId === channelId);
      const ok = await removeUtcChannelById(client, getDb, ix.guildId, channelId, log);
      await ix.update({
        content: ok
          ? `✅ Reloj eliminado: **${picked?.channelName || channelId}**`
          : '❌ No se pudo eliminar ese reloj.',
        components: [],
      });
      return true;
    }

    if (ix.isStringSelectMenu() && ix.customId === `${PREFIX}:help`) {
      const key = ix.values[0];
      if (!CATEGORIES[key]) {
        await ix.reply({ content: 'Categoría no encontrada.', ephemeral: true });
        return true;
      }
      await ix.update({ embeds: [categoryEmbed(key)], components: ix.message.components });
      return true;
    }

    if (!ix.isChatInputCommand()) return false;
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!cmd) return false;
    await cmd.run(ix, ctx);
    return true;
  },
};
