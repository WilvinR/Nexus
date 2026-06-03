const { createCanvas, loadImage } = require('canvas');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} = require('discord.js');

const API_WEST = 'https://west.albion-online-data.com/api/v2';
const ITEMS_JSON =
  'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json';
const ITEM_IMAGE = 'https://render.albiononline.com/v1/item/';
/** Verde claro para embeds de precios */
const EMBED_GREEN = 0x7dce82;
const SERVER_LABEL = 'Américas (West) 🌎';

/** Todas las ciudades + mercado negro (como el bot original). */
const LOCATIONS = [
  'Caerleon',
  'Bridgewatch',
  'Fort Sterling',
  'Lymhurst',
  'Martlock',
  'Thetford',
  'Brecilien',
  'Black Market',
];

const QUALITIES = [1, 2, 3, 4, 5];

const QUALITY_NAMES = {
  1: 'Normal',
  2: 'Bueno',
  3: 'Notable',
  4: 'Sobresaliente',
  5: 'Obra Maestra',
};

const PICK_TTL_MS = 180_000;
const pending = new Map();

let itemsCache = null;
let itemsCacheAt = 0;

function fmt(n) {
  if (!n || n <= 0) return '—';
  return n.toLocaleString('en-US');
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return '—';
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const rm = mins % 60;
  if (h < 24) return rm ? `${h}h ${rm}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function itemImageUrl(itemId, size = 80) {
  return `${ITEM_IMAGE}${itemId}.png?size=${size}`;
}

const STRIP_ICON = 64;
const STRIP_PAD = 10;
const STRIP_NUM_H = 24;

/** Una sola imagen en fila con íconos pequeños numerados (como Albion Online Tools). */
async function buildSuggestionStrip(matches, tier, enchant) {
  const n = matches.length;
  const cell = STRIP_ICON + STRIP_PAD;
  const w = STRIP_PAD + n * cell;
  const h = STRIP_PAD + STRIP_ICON + STRIP_NUM_H + STRIP_PAD;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, w, h);

  const imgs = await Promise.all(
    matches.map(async (m) => {
      const id = buildItemId(m.uniqueName, tier, enchant);
      try {
        return await loadImage(itemImageUrl(id, 64));
      } catch {
        return null;
      }
    }),
  );

  for (let i = 0; i < n; i++) {
    const x = STRIP_PAD + i * cell;
    const y = STRIP_PAD;
    if (imgs[i]) {
      ctx.drawImage(imgs[i], x, y, STRIP_ICON, STRIP_ICON);
    } else {
      ctx.fillStyle = '#404249';
      ctx.fillRect(x, y, STRIP_ICON, STRIP_ICON);
    }
    ctx.fillStyle = '#6eb5ff';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1), x + STRIP_ICON / 2, y + STRIP_ICON + 4);
  }

  return canvas.toBuffer('image/png');
}

function getItemTier(uniqueName) {
  const m = String(uniqueName).match(/T(\d+)/i);
  return m ? `T${m[1]}` : null;
}

function isTradableItem(uniqueName, item) {
  /** ROYAL no se excluye: Chaqueta real, capas reales, etc. sí están en el mercado. */
  const nonTradable = [
    'NONTRADABLE',
    '_QUEST',
    'QUESTITEM',
    'EVENT',
    'TUTORIAL',
    'ARENA',
    'TEST',
    'REWARD',
  ];
  const uid = uniqueName.toUpperCase();
  if (nonTradable.some((x) => uid.includes(x))) return false;
  const shop = String(item.ShopCategory || '').toLowerCase();
  const sub = String(item.ShopSubCategory || '').toLowerCase();
  if (shop === 'quest' || shop.includes('nontradable') || sub.includes('nontradable')) {
    return false;
  }
  return true;
}

function parseQuery(query) {
  const parts = query.trim().toLowerCase().split(/\s+/);
  let tier = null;
  let enchant = 0;
  const nameParts = [];

  for (const part of parts) {
    const m = part.match(/^t([2-8])(?:\.([0-3]))?$/);
    if (m) {
      tier = parseInt(m[1], 10);
      if (m[2] != null) enchant = parseInt(m[2], 10);
    } else {
      nameParts.push(part);
    }
  }

  return { itemName: nameParts.join(' '), tier, enchant };
}

function parseItemId(input) {
  const m = input
    .trim()
    .toUpperCase()
    .match(/^(T([2-8])_[A-Z0-9_]+)(?:@([0-3]))?$/i);
  if (!m) return null;
  const enchant = m[3] != null ? parseInt(m[3], 10) : 0;
  return {
    itemId: m[1] + (m[3] != null ? `@${m[3]}` : ''),
    tier: parseInt(m[2], 10),
    enchant,
  };
}

function buildItemId(uniqueName, tier, enchant) {
  const base = uniqueName.replace(/^T[2-8]_/i, '').split('@')[0];
  const id = `T${tier}_${base}`;
  return enchant > 0 ? `${id}@${enchant}` : id;
}

async function loadItems() {
  if (itemsCache && Date.now() - itemsCacheAt < 3_600_000) return itemsCache;
  const r = await fetch(ITEMS_JSON, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error('No se pudo cargar la lista de ítems de Albion.');
  itemsCache = await r.json();
  itemsCacheAt = Date.now();
  return itemsCache;
}

function norm(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function scoreMatch(itemName, es, en, uid) {
  const q = norm(itemName);
  if (!q) return 0;
  const nes = norm(es);
  const nen = norm(en);
  const nuid = norm(uid);

  if (nes === q || nen === q || nuid === q) return 100;
  if (nes.includes(q) || nen.includes(q)) return 85;
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;

  const inEs = words.filter((w) => nes.includes(w)).length;
  const inEn = words.filter((w) => nen.includes(w)).length;
  const inUid = words.filter((w) => nuid.includes(w)).length;
  const best = Math.max(inEs, inEn, inUid);
  if (best < words.length) return 0;

  let score = 60 + best * 5;
  if (nes.includes(q.split(' ').slice(0, 2).join(' '))) score += 10;
  return score;
}

async function searchItems(itemName, tierNum) {
  const items = await loadItems();
  const tierStr = `T${tierNum}`;
  const seen = new Set();
  const matches = [];

  for (const item of items) {
    if (!item.LocalizedNames) continue;
    const baseUnique = item.UniqueName.replace(/@\d+$/, '');
    if (seen.has(baseUnique)) continue;

    const uid = baseUnique.toLowerCase();
    if (!isTradableItem(uid, item)) continue;

    const itemTier = getItemTier(baseUnique);
    if (itemTier !== tierStr) continue;

    const es = item.LocalizedNames['ES-ES'] || '';
    const en = item.LocalizedNames['EN-US'] || '';
    const score = scoreMatch(itemName, es, en, uid);
    if (score <= 0) continue;

    seen.add(baseUnique);
    const esName = es || en || baseUnique;
    matches.push({
      label: `${esName} ${tierStr}`,
      spanishName: esName,
      uniqueName: baseUnique,
      score,
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 10);
}

async function fetchPrices(itemId) {
  const locParam = LOCATIONS.join(',');
  const qualParam = QUALITIES.join(',');
  const url = `${API_WEST}/stats/prices/${encodeURIComponent(itemId)}.json?locations=${locParam}&qualities=${qualParam}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`API mercado respondió ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

function groupOrders(rows) {
  const sell = {};
  const buy = {};

  for (const row of rows) {
    const { city, quality } = row;
    if (row.sell_price_min > 0) {
      if (!sell[city]) sell[city] = {};
      if (!sell[city][quality] || row.sell_price_min < sell[city][quality].price) {
        sell[city][quality] = {
          price: row.sell_price_min,
          date: row.sell_price_min_date,
        };
      }
    }
    if (row.buy_price_max > 0) {
      if (!buy[city]) buy[city] = {};
      if (!buy[city][quality] || row.buy_price_max > buy[city][quality].price) {
        buy[city][quality] = {
          price: row.buy_price_max,
          date: row.buy_price_max_date,
        };
      }
    }
  }

  return { sell, buy };
}

const CITY_ORDER = [
  'Thetford',
  'Bridgewatch',
  'Lymhurst',
  'Martlock',
  'Fort Sterling',
  'Caerleon',
  'Brecilien',
  'Black Market',
];

function ordersToRows(orders) {
  const rows = [];
  const cities = [
    ...CITY_ORDER.filter((c) => orders[c]),
    ...Object.keys(orders)
      .filter((c) => !CITY_ORDER.includes(c))
      .sort(),
  ];
  for (const city of cities) {
    for (const q of QUALITIES) {
      const o = orders[city]?.[q];
      if (o) rows.push({ city, quality: q, price: o.price, date: o.date });
    }
  }
  return rows;
}

/**
 * Tres columnas en texto normal (campos inline de Discord, como el otro bot).
 * Cada fila es una línea dentro de su columna — no se parte en dos.
 */
function buildOrderFields(rows, mode) {
  if (!rows.length) return [];

  const best =
    mode === 'sell'
      ? Math.min(...rows.map((r) => r.price))
      : Math.max(...rows.map((r) => r.price));

  const cities = [];
  const prices = [];
  const times = [];

  for (const r of rows) {
    const city = `${r.city} (${QUALITY_NAMES[r.quality]})`;
    cities.push(r.price === best ? `▶ ${city}` : city);
    prices.push(fmt(r.price));
    times.push(timeAgo(r.date));
  }

  const col = (lines) => {
    const text = lines.join('\n');
    return text.length > 1024 ? `${text.slice(0, 1021)}…` : text || '—';
  };

  return [
    { name: 'Ciudad (Calidad)', value: col(cities), inline: true },
    { name: 'Precio', value: col(prices), inline: true },
    { name: 'Última actualización', value: col(times), inline: true },
  ];
}

function buildPriceEmbeds(spanishName, itemId, tierLabel, sellRows, buyRows) {
  const embeds = [];
  const footer = { text: 'Albion Online Data Project · west.albion-online-data.com' };

  const addSection = (embed, title, rows, mode) => {
    embed.addFields({ name: '\u200b', value: `**${title}**`, inline: false });
    embed.addFields(...buildOrderFields(rows, mode));
  };

  const main = new EmbedBuilder()
    .setTitle(`${spanishName} / ${SERVER_LABEL}`)
    .setDescription(`${itemId} · ${tierLabel}`)
    .setColor(EMBED_GREEN)
    .setThumbnail(itemImageUrl(itemId))
    .setFooter(footer)
    .setTimestamp();

  if (sellRows.length) addSection(main, 'Órdenes de venta :', sellRows, 'sell');
  if (buyRows.length) addSection(main, 'Órdenes de compra :', buyRows, 'buy');

  embeds.push(main);
  return embeds;
}

async function sendPrices(ix, { itemId, spanishName, tier, enchant }) {
  let rows;
  try {
    rows = await fetchPrices(itemId);
  } catch (e) {
    const err = `❌ ${e.message}`;
    if (ix.deferred || ix.replied) await ix.editReply({ content: err, embeds: [], components: [] });
    else await ix.reply({ content: err, ephemeral: true });
    return;
  }

  const { sell, buy } = groupOrders(rows);
  const sellRows = ordersToRows(sell);
  const buyRows = ordersToRows(buy);

  if (!sellRows.length && !buyRows.length) {
    const msg =
      `❌ Sin datos de mercado para ${spanishName} (${itemId}) en Américas.\n` +
      'Los precios dependen de datos subidos por jugadores.';
    if (ix.deferred || ix.replied) await ix.editReply({ content: msg, embeds: [], components: [] });
    else await ix.reply({ content: msg, ephemeral: true });
    return;
  }

  const tierLabel = `T${tier}${enchant > 0 ? `.${enchant}` : ''}`;
  const embeds = buildPriceEmbeds(spanishName, itemId, tierLabel, sellRows, buyRows);
  const payload = { content: null, embeds, components: [] };

  if (ix.deferred || ix.replied) await ix.editReply(payload);
  else await ix.reply(payload);
}

function pickKey(userId, channelId) {
  return `${userId}:${channelId}`;
}

async function showSuggestions(ix, matches, tier, enchant) {
  const strip = await buildSuggestionStrip(matches, tier, enchant);
  const file = new AttachmentBuilder(strip, { name: 'sugerencias.png' });

  const embed = new EmbedBuilder()
    .setColor(EMBED_GREEN)
    .setTitle('Elige un ítem :')
    .setImage('attachment://sugerencias.png');

  const select = new StringSelectMenuBuilder()
    .setCustomId('mercado:select')
    .setPlaceholder('Selecciona un ítem :')
    .addOptions(
      matches.map((m, i) => ({
        label: `${i + 1}. ${m.spanishName}`.slice(0, 100),
        description: `T${tier} · ${m.uniqueName}`.slice(0, 100),
        value: String(i),
      })),
    );

  const row = new ActionRowBuilder().addComponents(select);

  await ix.editReply({ embeds: [embed], files: [file], components: [row] });

  const key = pickKey(ix.user.id, ix.channelId);
  if (pending.has(key)) clearTimeout(pending.get(key).timer);
  const timer = setTimeout(() => pending.delete(key), PICK_TTL_MS);
  pending.set(key, { matches, tier, enchant, timer, ownerId: ix.user.id });
}

async function resolveAndPrice(ix, match, tier, enchant) {
  const itemId = buildItemId(match.uniqueName, tier, enchant);
  await sendPrices(ix, {
    itemId,
    spanishName: match.spanishName,
    tier,
    enchant,
  });
}

async function runPrecio(ix) {
  await ix.deferReply();

  const rawItem = ix.options.getString('item');
  const tierOpt = ix.options.getInteger('tier');
  const encOpt = ix.options.getInteger('encantamiento');

  const direct = parseItemId(rawItem.trim());
  if (direct) {
    return sendPrices(ix, {
      itemId: direct.itemId,
      spanishName: direct.itemId,
      tier: direct.tier,
      enchant: direct.enchant,
    });
  }

  const parsed = parseQuery(rawItem);
  const tier = tierOpt ?? parsed.tier;
  const enchant = encOpt ?? parsed.enchant ?? 0;

  if (!tier) {
    return ix.editReply(
      '❌ Indica el tier en la búsqueda (ej: t6.2 Chaqueta real) o en la opción tier.',
    );
  }

  if (!parsed.itemName.trim()) {
    return ix.editReply('❌ Escribe el nombre del ítem (ej: t6.2 Chaqueta real).');
  }

  let matches;
  try {
    matches = await searchItems(parsed.itemName, tier);
  } catch (e) {
    return ix.editReply(`❌ ${e.message}`);
  }

  if (!matches.length) {
    return ix.editReply(
      `❌ No se encontró "${parsed.itemName}" en T${tier}. Prueba otro nombre o ID (T6_BAG@2).`,
    );
  }

  if (matches.length === 1) {
    return resolveAndPrice(ix, matches[0], tier, enchant);
  }

  return showSuggestions(ix, matches, tier, enchant);
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('precio')
      .setDescription('Precios de mercado Américas — todas las ciudades y calidades')
      .addStringOption((o) =>
        o
          .setName('item')
          .setDescription('Ej: t6.2 Chaqueta real, o ID T6_ARMOR@2')
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('tier')
          .setDescription('Tier T2–T8 (si no lo pones en el nombre, ej. t6.2)')
          .setMinValue(2)
          .setMaxValue(8),
      )
      .addIntegerOption((o) =>
        o
          .setName('encantamiento')
          .setDescription('0 = base, 1 = .1, 2 = .2, 3 = .3')
          .setMinValue(0)
          .setMaxValue(3),
      ),
    run: runPrecio,
  },
];

module.exports = {
  id: 'mercado',
  commands,

  async handleInteraction(ix) {
    if (ix.isStringSelectMenu() && ix.customId === 'mercado:select') {
      const key = pickKey(ix.user.id, ix.channelId);
      const state = pending.get(key);
      if (!state || ix.user.id !== state.ownerId) {
        await ix.reply({ content: 'Esta selección ya no está disponible.', ephemeral: true });
        return true;
      }

      const idx = parseInt(ix.values[0], 10);
      const match = state.matches[idx];
      if (!match) {
        await ix.reply({ content: 'Selección inválida.', ephemeral: true });
        return true;
      }

      clearTimeout(state.timer);
      pending.delete(key);

      await ix.deferUpdate();
      await sendPrices(ix, {
        itemId: buildItemId(match.uniqueName, state.tier, state.enchant),
        spanishName: match.spanishName,
        tier: state.tier,
        enchant: state.enchant,
      });
      return true;
    }

    if (!ix.isChatInputCommand()) return false;
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!cmd) return false;
    await cmd.run(ix);
    return true;
  },
};
