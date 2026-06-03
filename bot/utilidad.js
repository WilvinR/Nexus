const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  Colors,
} = require('discord.js');

const PREFIX = 'util';

const CATEGORIES = {
  registro: {
    label: 'Registro Albion',
    emoji: '📋',
    commands: [
      { name: '/registrarse', desc: 'Vincula tu cuenta de Albion al Discord (nombre o ID).' },
      { name: '/registro_manual', desc: 'Registra manualmente a un miembro (Mod).' },
      { name: '/informacion_gremio', desc: 'Consulta datos de un gremio en Albion por nombre.' },
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
    ],
  },
  batallas: {
    label: 'Battle Report',
    emoji: '🛡️',
    commands: [
      { name: '/seguir_batalla', desc: 'Monitorea batallas de un gremio (canal + gremio_id).' },
      { name: '/seguir_batalla_alianza', desc: 'Monitorea batallas de toda la alianza.' },
      { name: '/detener_batalla', desc: 'Detiene el seguimiento de batallas.' },
    ],
  },
  mercado: {
    label: 'Mercado (Américas)',
    emoji: '💰',
    commands: [
      { name: '/precio', desc: 'Precio de venta de un ítem en el mercado del servidor Américas (West).' },
    ],
  },
  balance: {
    label: 'Balance',
    emoji: '🪙',
    commands: [
      { name: '/balance', desc: 'Consulta tu plata virtual acumulada.' },
      { name: '/cargar_balance', desc: 'Carga plata a usuarios (Mod).' },
      { name: '/auditoria_bal', desc: 'Auditoría de balances, pagos y cargas (Admin).' },
      { name: '/pagar', desc: 'Registra un pago y descuenta plata del balance (Mod).' },
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
      { name: '/crear_evento', desc: 'Crea un evento con roles e inscripción.' },
      { name: '/editar_evento', desc: 'Edita un evento activo.' },
      { name: '/eliminar_evento', desc: 'Elimina un evento.' },
      { name: '/plantillas', desc: 'Carga o elimina plantillas de eventos.' },
    ],
  },
  musica: {
    label: 'Música',
    emoji: '🎵',
    commands: [
      { name: '/play', desc: 'Reproduce música en tu canal de voz (URL o búsqueda).' },
      { name: '/skip', desc: 'Salta la canción actual.' },
      { name: '/cola', desc: 'Muestra la cola de reproducción.' },
      { name: '/stop', desc: 'Detiene la música y limpia la cola.' },
      { name: '/salir', desc: 'Desconecta el bot del canal de voz.' },
    ],
  },
  utilidad: {
    label: 'Utilidades y Logs',
    emoji: '🔧',
    commands: [
      { name: '/utc', desc: 'Hora UTC actual (referencia para eventos Albion).' },
      { name: '/sugerencia', desc: 'Envía una sugerencia al administrador del bot.' },
      { name: '/ayuda', desc: 'Menú de comandos de Nexus.' },
      { name: '/logs', desc: 'Configura el canal de logs del servidor.' },
      { name: '/pausar_logs', desc: 'Pausa o reanuda los logs.' },
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
    data: new SlashCommandBuilder().setName('utc').setDescription('Muestra la hora UTC actual'),
    async run(ix) {
      const now = new Date();
      const t = now.toISOString().slice(11, 19);
      await ix.reply(`# 🕐 ${t} UTC`);
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
            'Selecciona una categoría para ver comandos y descripciones.',
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

  async handleInteraction(ix, ctx) {
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
