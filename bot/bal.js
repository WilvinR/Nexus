const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  Events,
  Colors,
} = require('discord.js');

const PREFIX = 'bal';
const COIN = '🪙';

function gid(id) {
  return String(id);
}

function parseAmount(raw) {
  if (!raw) return 0;
  const s = String(raw).trim().toLowerCase().replace(/,/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/);
  if (!m) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  }
  const mult = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
  return Math.floor(parseFloat(m[1]) * (mult[m[2]] || 1));
}

function fmtAmount(n) {
  return `${(Number(n) || 0).toLocaleString('en-US')}`;
}

function getBalance(getDb, guildId, userId) {
  const row = getDb()
    .prepare('SELECT balance FROM bal_users WHERE guild_id = ? AND user_id = ?')
    .get(gid(guildId), gid(userId));
  return row?.balance || 0;
}

function addBalance(getDb, guildId, userId, amount, adminId, type) {
  getDb()
    .prepare(`
      INSERT INTO bal_users (guild_id, user_id, balance) VALUES (?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET balance = balance + excluded.balance
    `)
    .run(gid(guildId), gid(userId), amount);
  logTx(getDb, guildId, userId, amount, adminId, type);
}

function deductBalance(getDb, guildId, userId, amount, adminId) {
  const cur = getBalance(getDb, guildId, userId);
  if (cur < amount) return false;
  getDb()
    .prepare('UPDATE bal_users SET balance = balance - ? WHERE guild_id = ? AND user_id = ?')
    .run(amount, gid(guildId), gid(userId));
  logTx(getDb, guildId, userId, -amount, adminId, 'payment');
  return true;
}

function logTx(getDb, guildId, userId, amount, adminId, type) {
  getDb()
    .prepare(`
      INSERT INTO bal_history (guild_id, user_id, amount, admin_id, transaction_type, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `)
    .run(gid(guildId), gid(userId), amount, gid(adminId), type);
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('balance').setDescription('Consulta tu balance virtual de plata'),
    async run(ix, { getDb }) {
      const bal = getBalance(getDb, ix.guildId, ix.user.id);
      const embed = new EmbedBuilder()
        .setTitle(`Balance de ${ix.member?.displayName || ix.user.username}`)
        .setColor(Colors.Gold)
        .addFields({ name: `Balance acumulado ${COIN}`, value: fmtAmount(bal) });
      await ix.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('cargar_balance')
      .setDescription('Carga plata virtual a usuarios seleccionados')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption((o) => o.setName('cantidad').setDescription('Ej: 1000, 2k, 1.5m').setRequired(true)),
    async run(ix, { getDb }) {
      const amount = parseAmount(ix.options.getString('cantidad'));
      if (amount <= 0) {
        return ix.reply({ content: '❌ Cantidad inválida.', ephemeral: true });
      }

      const menu = new UserSelectMenuBuilder()
        .setCustomId(`${PREFIX}:load:${amount}:${ix.user.id}`)
        .setPlaceholder('Selecciona usuarios')
        .setMinValues(1)
        .setMaxValues(25);

      await ix.reply({
        content: `Selecciona usuarios para cargar **${fmtAmount(amount)}** ${COIN}:`,
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('auditoria_bal')
      .setDescription('Auditoría de balances, pagos y cargas')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async run(ix) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:aud:pending:0`).setLabel('Balance pendiente').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:aud:payments:0`).setLabel('Historia pagos').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:aud:deposits:0`).setLabel('Balance cargado').setStyle(ButtonStyle.Success),
      );

      const embed = new EmbedBuilder()
        .setTitle('📊 Auditoría de Balance')
        .setDescription('Selecciona qué información ver:')
        .setColor(Colors.Blue);

      await ix.reply({ embeds: [embed], components: [row], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('pagar')
      .setDescription('Registra un pago y descuenta plata del balance del usuario')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addStringOption((o) => o.setName('cantidad').setDescription('Ej: 1000, 2k').setRequired(true)),
    async run(ix, { getDb }) {
      const user = ix.options.getUser('usuario');
      const amount = parseAmount(ix.options.getString('cantidad'));
      if (amount <= 0) {
        return ix.reply({ content: '❌ Cantidad inválida.', ephemeral: true });
      }

      const bal = getBalance(getDb, ix.guildId, user.id);
      if (bal < amount) {
        return ix.reply({
          content: `❌ ${user} solo tiene **${fmtAmount(bal)}** ${COIN}.`,
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('💸 Pago pendiente')
        .setColor(Colors.Green)
        .addFields(
          { name: 'Usuario', value: `${user}`, inline: true },
          { name: 'Cantidad', value: `${fmtAmount(amount)} ${COIN}`, inline: true },
          { name: 'Balance actual', value: `${fmtAmount(bal)} ${COIN}`, inline: true },
        )
        .setFooter({ text: `Solicitado por ${ix.user.username}` });

      const btn = new ButtonBuilder()
        .setCustomId(`${PREFIX}:pay:${user.id}:${amount}:${ix.user.id}`)
        .setLabel('Confirmar pago')
        .setStyle(ButtonStyle.Success);

      await ix.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(btn)],
      });
    },
  },
];

function buildAuditoriaEmbed(getDb, guildId, kind, page) {
  const perPage = kind === 'pending' ? 15 : 10;
  const gidStr = gid(guildId);

  if (kind === 'pending') {
    const rows = getDb()
      .prepare('SELECT user_id, balance FROM bal_users WHERE guild_id = ? AND balance > 0 ORDER BY balance DESC')
      .all(gidStr);
    const total = rows.reduce((s, r) => s + r.balance, 0);
    const slice = rows.slice(page * perPage, page * perPage + perPage);
    const embed = new EmbedBuilder()
      .setTitle(`💰 Balance pendiente`)
      .setDescription(`**Total:** ${fmtAmount(total)} ${COIN}`)
      .setColor(Colors.Gold);
    if (slice.length) {
      embed.addFields({
        name: 'Usuarios',
        value: slice.map((r, i) => `${page * perPage + i + 1}. <@${r.user_id}> — ${fmtAmount(r.balance)} ${COIN}`).join('\n'),
      });
    }
    embed.setFooter({ text: `Página ${page + 1}/${Math.max(1, Math.ceil(rows.length / perPage))}` });
    return { embed, totalPages: Math.max(1, Math.ceil(rows.length / perPage)) };
  }

  const type = kind === 'payments' ? 'payment' : 'deposit';
  const rows = getDb()
    .prepare(`
      SELECT user_id, amount, admin_id, created_at FROM bal_history
      WHERE guild_id = ? AND transaction_type = ?
      AND datetime(created_at) >= datetime('now', '-7 days')
      ORDER BY created_at DESC
    `)
    .all(gidStr, type);

  const slice = rows.slice(page * perPage, page * perPage + perPage);
  const embed = new EmbedBuilder()
    .setTitle(kind === 'payments' ? '📋 Historia de pagos (7 días)' : '💳 Balance cargado (7 días)')
    .setColor(kind === 'payments' ? Colors.Green : Colors.Blue);

  for (const r of slice) {
    embed.addFields({
      name: `${fmtAmount(Math.abs(r.amount))} ${COIN}`,
      value: `👤 <@${r.user_id}>\n👮 <@${r.admin_id}>\n📅 ${r.created_at}`,
      inline: true,
    });
  }
  if (!slice.length) embed.setDescription('Sin registros.');
  embed.setFooter({ text: `Página ${page + 1}/${Math.max(1, Math.ceil(rows.length / perPage))}` });
  return { embed, totalPages: Math.max(1, Math.ceil(rows.length / perPage)) };
}

function auditoriaButtons(kind, page, totalPages) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:aud:menu:0`).setLabel('Menú').setStyle(ButtonStyle.Secondary),
  );
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:aud:${kind}:${page - 1}`).setLabel('◀').setStyle(ButtonStyle.Primary),
    );
  }
  if (page < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:aud:${kind}:${page + 1}`).setLabel('▶').setStyle(ButtonStyle.Primary),
    );
  }
  return [row];
}

module.exports = {
  id: 'bal',
  commands,

  onGuildRemove(guildId, { getDb }) {
    const id = gid(guildId);
    getDb().prepare('DELETE FROM bal_users WHERE guild_id = ?').run(id);
    getDb().prepare('DELETE FROM bal_history WHERE guild_id = ?').run(id);
  },

  onInit(client, { getDb, log }) {
    client.on(Events.GuildMemberRemove, (member) => {
      const id = gid(member.guild.id);
      getDb().prepare('DELETE FROM bal_users WHERE guild_id = ? AND user_id = ?').run(id, gid(member.id));
      logTx(getDb, member.guild.id, member.id, 0, '0', 'user_left');
    });
    log.info('Módulo bal listo');
  },

  async handleInteraction(ix, ctx) {
    const { getDb } = ctx;

    if (ix.isUserSelectMenu() && ix.customId.startsWith(`${PREFIX}:load:`)) {
      const [, , amountStr, requesterId] = ix.customId.split(':');
      if (ix.user.id !== requesterId) {
        await ix.reply({ content: 'No es tu panel.', ephemeral: true });
        return true;
      }
      const amount = parseInt(amountStr, 10);
      for (const uid of ix.values) {
        addBalance(getDb, ix.guildId, uid, amount, ix.user.id, 'deposit');
      }
      await ix.update({
        content: `✅ Cargado **${fmtAmount(amount)}** ${COIN} a ${ix.values.map((u) => `<@${u}>`).join(', ')}`,
        components: [],
      });
      return true;
    }

    if (ix.isButton() && ix.customId.startsWith(`${PREFIX}:pay:`)) {
      if (!ix.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        await ix.reply({ content: '❌ Solo moderadores.', ephemeral: true });
        return true;
      }
      const [, , userId, amountStr] = ix.customId.split(':');
      const amount = parseInt(amountStr, 10);
      const ok = deductBalance(getDb, ix.guildId, userId, amount, ix.user.id);
      if (!ok) {
        await ix.reply({ content: '❌ Balance insuficiente.', ephemeral: true });
        return true;
      }
      await ix.update({
        content: `✅ Pago completado: **${fmtAmount(amount)}** ${COIN} a <@${userId}> — por ${ix.user}`,
        embeds: [],
        components: [],
      });
      return true;
    }

    if (ix.isButton() && ix.customId.startsWith(`${PREFIX}:aud:`)) {
      const parts = ix.customId.split(':');
      const kind = parts[2];
      const page = parseInt(parts[3], 10) || 0;

      if (kind === 'menu') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:aud:pending:0`).setLabel('Balance pendiente').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:aud:payments:0`).setLabel('Historia pagos').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:aud:deposits:0`).setLabel('Balance cargado').setStyle(ButtonStyle.Success),
        );
        await ix.update({
          embeds: [new EmbedBuilder().setTitle('📊 Auditoría').setDescription('Selecciona:').setColor(Colors.Blue)],
          components: [row],
        });
        return true;
      }

      const { embed, totalPages } = buildAuditoriaEmbed(getDb, ix.guildId, kind, page);
      await ix.update({ embeds: [embed], components: auditoriaButtons(kind, page, totalPages) });
      return true;
    }

    if (!ix.isChatInputCommand()) return false;
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!cmd) return false;
    await cmd.run(ix, ctx);
    return true;
  },
};
