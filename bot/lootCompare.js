const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { compareLootFiles } = require('./lootComparator');

const ICON = 56;
const PAD = 8;
const QTY_H = 20;

async function fetchTextAttachment(attachment) {
  const r = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`No se pudo descargar ${attachment.name}`);
  return r.text();
}

async function buildPlayerStrip(items) {
  const n = Math.min(items.length, 12);
  if (!n) return null;
  const cell = ICON + PAD;
  const w = PAD + n * cell;
  const h = PAD + ICON + QTY_H + PAD;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, w, h);

  const imgs = await Promise.all(
    items.slice(0, n).map(async (it) => {
      if (!it.imageUrl) return null;
      try {
        return await loadImage(it.imageUrl);
      } catch {
        return null;
      }
    }),
  );

  for (let i = 0; i < n; i++) {
    const x = PAD + i * cell;
    const y = PAD;
    if (imgs[i]) ctx.drawImage(imgs[i], x, y, ICON, ICON);
    else {
      ctx.fillStyle = '#404249';
      ctx.fillRect(x, y, ICON, ICON);
    }
    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`×${items[i].missing}`, x + ICON / 2, y + ICON + 16);
  }

  return canvas.toBuffer('image/png');
}

function formatPlayerLabel(p) {
  return p.guild ? `${p.name} · ${p.guild}` : p.name;
}

async function runCompare(ix, lootText, chestText) {
  const result = await compareLootFiles(lootText, chestText);
  if (!result.ok) {
    await ix.editReply({ content: `❌ ${result.error}` });
    return;
  }

  const { stats, players } = result;
  const summary = new EmbedBuilder()
    .setColor(stats.pending ? 0xe74c3c : 0x2ecc71)
    .setTitle('📋 Comparador de loot')
    .setDescription(
      `Jugadores: **${stats.players}** · Pendientes: **${stats.pending}** · ✅ Entregado: **${stats.delivered}**`,
    );

  const embeds = [summary];
  const files = [];

  if (!stats.pending) {
    summary.addFields({ name: 'Resultado', value: '✅ Todos los jugadores entregaron su loot al cofre.' });
    await ix.editReply({ embeds, files });
    return;
  }

  const pending = players.filter((p) => p.status === 'pending');
  for (const p of pending.slice(0, 8)) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`⚠️ ${formatPlayerLabel(p)}`)
      .setDescription(`${p.missing.length} ítem(s) sin depositar en el cofre.`);
    embeds.push(embed);

    const buf = await buildPlayerStrip(p.missing);
    if (buf) {
      const safe = p.name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 20);
      const name = `loot-${safe}.png`;
      files.push(new AttachmentBuilder(buf, { name }));
      embed.setImage(`attachment://${name}`);
    }
  }

  const okPlayers = players.filter((p) => p.status === 'ok');
  if (okPlayers.length) {
    summary.addFields({
      name: '✅ Todo entregado',
      value: okPlayers.map((p) => formatPlayerLabel(p)).join(', ').slice(0, 1024),
    });
  }

  if (pending.length > 8) {
    summary.addFields({
      name: 'Nota',
      value: `Solo se muestran 8 jugadores con faltantes. Usa el dashboard para el reporte completo.`,
    });
  }

  await ix.editReply({ embeds: embeds.slice(0, 10), files: files.slice(0, 10) });
}

const compararLootCmd = new SlashCommandBuilder()
  .setName('comparar-loot')
  .setDescription('Compara loot de pelea vs movimientos del cofre (2 CSV)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addAttachmentOption((o) =>
    o.setName('loot').setDescription('Log de loot (tabulado, comillas)').setRequired(true),
  )
  .addAttachmentOption((o) =>
    o.setName('cofre').setDescription('Log del cofre (CSV, comas)').setRequired(true),
  );

async function run(ix) {
  const lootAtt = ix.options.getAttachment('loot');
  const chestAtt = ix.options.getAttachment('cofre');
  if (!lootAtt?.url || !chestAtt?.url) {
    await ix.reply({ content: '❌ Adjunta ambos archivos.', ephemeral: true });
    return;
  }
  await ix.deferReply();
  try {
    const [lootText, chestText] = await Promise.all([
      fetchTextAttachment(lootAtt),
      fetchTextAttachment(chestAtt),
    ]);
    await runCompare(ix, lootText, chestText);
  } catch (e) {
    await ix.editReply({ content: `❌ ${e.message || 'Error al comparar.'}` });
  }
}

module.exports = {
  id: 'loot',
  commands: [{ data: compararLootCmd, run }],

  async handleInteraction(ix) {
    if (!ix.isChatInputCommand() || ix.commandName !== 'comparar-loot') return false;
    await run(ix);
    return true;
  },
};
