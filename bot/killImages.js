const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const FONT_FAMILY = 'KillboardFont';
let fontPath = null;

const FONT_CANDIDATES = [
  path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf'),
  path.join(__dirname, 'fonts', 'DejaVuSans.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\arialbd.ttf',
];

for (const p of FONT_CANDIDATES) {
  try {
    if (fs.existsSync(p)) {
      registerFont(p, { family: FONT_FAMILY });
      fontPath = p;
      break;
    }
  } catch {
    /* siguiente */
  }
}

function font(size, bold = false) {
  const fam = fontPath ? FONT_FAMILY : 'Arial';
  return bold ? `bold ${size}px ${fam}` : `${size}px ${fam}`;
}

const IMAGE_CACHE = new Map();
const IMAGE_CACHE_MAX = 600;
const IMAGE_FETCH_CONCURRENCY = Math.max(2, parseInt(process.env.KILL_IMAGE_CONCURRENCY || '4', 10) || 4);
const IMAGE_FETCH_RETRIES = Math.max(1, parseInt(process.env.KILL_IMAGE_RETRIES || '3', 10) || 3);
const IMAGE_FETCH_TIMEOUT_MS = Math.max(8000, parseInt(process.env.KILL_IMAGE_TIMEOUT_MS || '18000', 10) || 18000);

function itemCacheKey(item) {
  const quality = Math.max(1, Math.min(5, item?.Quality || 1));
  return `${item.Type}|${quality}`;
}

function cacheGetItem(key) {
  if (!IMAGE_CACHE.has(key)) return undefined;
  const img = IMAGE_CACHE.get(key);
  IMAGE_CACHE.delete(key);
  IMAGE_CACHE.set(key, img);
  return img;
}

function cacheSetItem(key, img) {
  if (!img) return;
  if (IMAGE_CACHE.size >= IMAGE_CACHE_MAX) {
    const oldest = IMAGE_CACHE.keys().next().value;
    IMAGE_CACHE.delete(oldest);
  }
  IMAGE_CACHE.set(key, img);
}

function destroyCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    /* ignore */
  }
}

/** Vacía iconos de ítems decodificados en RAM (principal consumidor tras muchas kills). */
function clearItemImageCache() {
  IMAGE_CACHE.clear();
}

/** Libera PNG y caché de iconos tras enviar a Discord. */
function releaseKillBuffers(built) {
  if (built && !built.skip) {
    built.mainBuffer = null;
    built.statsBuffer = null;
  }
  clearItemImageCache();
}

async function mapWithConcurrency(items, fn, concurrency) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function fetchItemImageBuffer(item) {
  const quality = Math.max(1, Math.min(5, item.Quality || 1));
  const url = `https://render.albiononline.com/v1/item/${item.Type}?quality=${quality}&size=217`;
  const r = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function loadItemImage(item) {
  if (!item?.Type) return null;
  const key = itemCacheKey(item);
  const cached = cacheGetItem(key);
  if (cached !== undefined) return cached;

  for (let attempt = 0; attempt < IMAGE_FETCH_RETRIES; attempt++) {
    try {
      const buf = await fetchItemImageBuffer(item);
      const img = await loadImage(buf);
      cacheSetItem(key, img);
      return img;
    } catch {
      if (attempt + 1 < IMAGE_FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  return null;
}

function collectEquipmentItems(equipment) {
  const eq = equipment && typeof equipment === 'object' ? equipment : {};
  return Object.values(eq).filter((it) => it && it.Type);
}

async function preloadItemImages(items) {
  const unique = new Map();
  for (const item of items) {
    if (!item?.Type) continue;
    const key = itemCacheKey(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  const list = [...unique.values()];
  await mapWithConcurrency(list, (item) => loadItemImage(item), IMAGE_FETCH_CONCURRENCY);
}

function getCachedItemImage(item) {
  if (!item?.Type) return null;
  const img = cacheGetItem(itemCacheKey(item));
  return img || null;
}

async function getItemPrice(itemId) {
  if (!itemId) return 0;
  try {
    const url = `https://www.albion-online-data.com/api/v2/stats/prices/${itemId}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (r.status !== 200) return 0;
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return 0;
    const valid = data.map((i) => i.sell_price_min || 0).filter((p) => p > 0);
    return valid.length ? Math.min(...valid) : 0;
  } catch {
    return 0;
  }
}

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function getParticipantStats(killData, playerId, playerName) {
  const participants = killData.Participants || [];
  const pid = playerId != null ? String(playerId) : null;
  const pname = playerName != null ? String(playerName) : null;

  for (const p of participants) {
    if (String(p.Id || '') === pid) {
      return { damage: p.DamageDone || 0, healing: p.SupportHealingDone || 0 };
    }
  }
  if (pname) {
    for (const p of participants) {
      if (String(p.Name || '').toLowerCase() === pname.toLowerCase()) {
        return { damage: p.DamageDone || 0, healing: p.SupportHealingDone || 0 };
      }
    }
  }
  const killer = killData.Killer || {};
  const victim = killData.Victim || {};
  if (String(killer.Id) === pid || (pname && String(killer.Name || '').toLowerCase() === pname.toLowerCase())) {
    const dmg = killer.DamageDone || 0;
    const heal = killer.SupportHealingDone || 0;
    if (dmg > 0 || heal > 0) return { damage: dmg, healing: heal };
  }
  if (String(victim.Id) === pid || (pname && String(victim.Name || '').toLowerCase() === pname.toLowerCase())) {
    const dmg = victim.DamageDone || 0;
    const heal = victim.SupportHealingDone || 0;
    if (dmg > 0 || heal > 0) return { damage: dmg, healing: heal };
  }
  return { damage: 0, healing: 0 };
}

function getAlliedParticipants(killData) {
  const participants = killData.Participants || [];
  return participants.map((p) => {
    const mh = (p.Equipment || {}).MainHand || {};
    const weaponType = mh.Type || '';
    return {
      name: p.Name || 'Unknown',
      damage: p.DamageDone || 0,
      healing: p.SupportHealingDone || 0,
      ip: p.AverageItemPower || 0,
      weapon: weaponType ? { Type: weaponType, Quality: mh.Quality || 1 } : null,
    };
  });
}

function drawCentered(ctx, cx, y, text, fontStr, color) {
  ctx.font = fontStr;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y);
  ctx.textAlign = 'left';
}

function parseTimestamp(ts) {
  if (!ts) return new Date();
  try {
    let s = String(ts).replace('Z', '+00:00');
    if (s.includes('.')) s = `${s.split('.')[0]}+00:00`;
    return new Date(s);
  } catch {
    return new Date();
  }
}

function pasteItem(ctx, x, y, item, size) {
  if (!item) return;
  const type = item.Type || '';
  if (!type || type.toUpperCase().includes('TRASH')) return;
  const img = getCachedItemImage(item);
  if (!img) return;
  ctx.drawImage(img, x, y, size, size);
}

function pasteItemGhost(ctx, x, y, item, size) {
  if (!item) return;
  const img = getCachedItemImage(item);
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

function drawEquipmentGrid(ctx, startX, startY, equipment, isKiller, spacing, itemSize) {
  const positions = {
    Bag: [0, 0],
    Head: [1, 0],
    Cape: [2, 0],
    MainHand: [0, 1],
    Armor: [1, 1],
    OffHand: [2, 1],
    Shoes: [1, 2],
    Potion: [2, 2],
    Mount: [1, 3],
  };
  if (!isKiller) positions.Food = [0, 2];

  const eq = equipment && typeof equipment === 'object' ? equipment : {};
  const mainHand = eq.MainHand;
  const offHand = eq.OffHand;
  const is2h = mainHand?.Type && (!offHand || !offHand.Type);

  for (const [slot, [col, row]] of Object.entries(positions)) {
    const x = startX + col * spacing;
    const y = startY + row * spacing;
    if (slot === 'OffHand' && is2h) {
      pasteItemGhost(ctx, x, y, mainHand, itemSize);
    } else {
      pasteItem(ctx, x, y, eq[slot], itemSize);
    }
  }
}

function drawInvItem(ctx, x, y, item, size) {
  const img = getCachedItemImage(item);
  if (img) ctx.drawImage(img, x, y, size, size);
}

async function getInvItemPrice(item) {
  try {
    const price = await getItemPrice(item.Type || '');
    const count = item.Count != null ? Number(item.Count) : 1;
    return price * count;
  } catch {
    return 0;
  }
}

/**
 * Genera imágenes igual al Kills.py original.
 * @returns {{ skip: true } | { skip: false, isKill, content, mainBuffer, statsBuffer, eventId, eventTime }}
 */
async function buildKillNotificationImages(killData, entityConfig) {
  const killer = killData.Killer || {};
  const victim = killData.Victim || {};
  const killerId = killer.Id != null ? String(killer.Id) : null;
  const victimId = victim.Id != null ? String(victim.Id) : null;
  const killerGuildId = killer.GuildId != null ? String(killer.GuildId) : null;
  const victimGuildId = victim.GuildId != null ? String(victim.GuildId) : null;
  const entityId = String(entityConfig.albion_entity_id);
  const entityType = entityConfig.type || entityConfig.entity_type;

  let isKill;
  if (entityType === 'global') {
    isKill = true;
  } else {
    const isOurKill =
      (entityType === 'guild' && killerGuildId === entityId) ||
      (entityType === 'player' && killerId === entityId);
    const isOurDeath =
      (entityType === 'guild' && victimGuildId === entityId) ||
      (entityType === 'player' && victimId === entityId);
    if (!isOurKill && !isOurDeath) return { skip: true };
    isKill = isOurKill;
  }

  const WIDTH = 1250;
  let HEIGHT = 900;
  const BG = '#D4B896';
  const TEXT = '#000000';
  const BAR_BG = '#B4A082';
  const DAMAGE_BAR = '#DC503C';
  const HEAL_BAR = '#3C963C';
  const LINE = '#8C785A';

  const EQUIP_ITEM_SIZE = 150;
  const EQUIP_SPACING = 155;
  const MARGIN_X = 50;
  const MARGIN_TOP = 140;
  const INV_ITEM_SIZE = 120;
  const INV_ITEMS_PER_ROW = 8;
  const INV_SPACING = Math.floor((WIDTH - 2 * MARGIN_X) / INV_ITEMS_PER_ROW);
  const LEFT_PANEL_X = MARGIN_X;
  const RIGHT_GRID_WIDTH = 3 * EQUIP_SPACING;
  const RIGHT_PANEL_X = WIDTH - MARGIN_X - RIGHT_GRID_WIDTH;
  const CENTER_X = WIDTH / 2;
  const EQUIP_AREA_HEIGHT = 4 * EQUIP_SPACING + 50;

  const inventory = (victim.Inventory || []).filter((it) => it && it.Type);
  const invRows = inventory.length
    ? Math.ceil(inventory.length / INV_ITEMS_PER_ROW)
    : 0;
  let invHeight = 0;
  if (invRows > 0) invHeight = 60 + invRows * INV_SPACING + 40;
  const totalHeight = MARGIN_TOP + EQUIP_AREA_HEIGHT + 80 + invHeight + 60;
  HEIGHT = Math.max(totalHeight, HEIGHT);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const fontTitle = font(64, true);
  const fontName = font(32);
  const fontInfo = font(20);
  const fontSmall = font(14);
  const fontInvTitle = font(18);
  const fontCenterLabel = font(36);
  const fontCenterValue = font(46);
  const fontTs = font(20);

  const killerName = killer.Name || 'Unknown';
  const killerGuild = killer.GuildName || '';
  const killerAlliance = killer.AllianceName || '';
  const killerIp = killer.AverageItemPower || 0;
  const victimName = victim.Name || 'Unknown';
  const victimGuild = victim.GuildName || '';
  const victimAlliance = victim.AllianceName || '';
  const victimIp = victim.AverageItemPower || 0;

  const killerGuildDisplay = killerAlliance
    ? `[${killerAlliance}] ${killerGuild}`
    : killerGuild || 'Sin Gremio';
  const victimGuildDisplay = victimAlliance
    ? `[${victimAlliance}] ${victimGuild}`
    : victimGuild || 'Sin Gremio';

  const alliedParticipants = getAlliedParticipants(killData);

  const equipment = victim.Equipment || {};
  const imageItems = [
    ...collectEquipmentItems(killer.Equipment),
    ...collectEquipmentItems(victim.Equipment),
    ...inventory,
    ...alliedParticipants.filter((p) => p.weapon?.Type).map((p) => p.weapon),
  ];
  const priceTasks = Object.values(equipment)
    .filter((it) => it && it.Type)
    .map((it) => getItemPrice(it.Type));

  await preloadItemImages(imageItems);
  const prices = priceTasks.length ? await Promise.all(priceTasks) : [];
  const totalEquipmentValue = prices.reduce((s, p) => s + (p > 0 ? p : 0), 0);
  const fame = killData.TotalVictimKillFame || 0;

  const ts = killData.TimeStamp;
  const tsDate = parseTimestamp(ts);
  const timestampDisplay = tsDate.toISOString().replace('T', ' ').slice(0, 19);

  let clusterRaw = killData.Cluster || killData.Location || '';
  let zona = 'Desconocido';
  if (clusterRaw && typeof clusterRaw === 'object') {
    zona = clusterRaw.Name || clusterRaw.name || String(clusterRaw);
  } else if (clusterRaw) {
    zona = String(clusterRaw);
  }

  const titleText = isKill ? 'KILL' : 'DEATH';
  const titleColor = isKill ? '#1EA01E' : '#C81E1E';
  drawCentered(ctx, CENTER_X, 10, titleText, fontTitle, titleColor);

  if (zona && zona !== 'Desconocido') {
    drawCentered(ctx, CENTER_X, 80, zona, fontName, TEXT);
  }

  const infoY = MARGIN_TOP - 10;
  const killerGridCx = LEFT_PANEL_X + Math.floor(1.5 * EQUIP_SPACING);
  const victimGridCx = RIGHT_PANEL_X + Math.floor(1.5 * EQUIP_SPACING);

  drawCentered(ctx, killerGridCx, infoY, killerName, fontName, TEXT);
  drawCentered(ctx, killerGridCx, infoY + 36, killerGuildDisplay, fontInfo, TEXT);
  drawCentered(ctx, killerGridCx, infoY + 58, `IP: ${Math.round(killerIp)}`, fontInfo, TEXT);

  drawCentered(ctx, victimGridCx, infoY, victimName, fontName, TEXT);
  drawCentered(ctx, victimGridCx, infoY + 36, victimGuildDisplay, fontInfo, TEXT);
  drawCentered(ctx, victimGridCx, infoY + 58, `IP: ${Math.round(victimIp)}`, fontInfo, TEXT);

  const equipYPreview = MARGIN_TOP + 100;
  drawCentered(ctx, CENTER_X, equipYPreview, 'FAMA', fontCenterLabel, '#C81E1E');
  drawCentered(ctx, CENTER_X, equipYPreview + 40, formatNumber(fame), fontCenterValue, TEXT);

  const silverLabelY = equipYPreview + 2 * EQUIP_SPACING;
  drawCentered(ctx, CENTER_X, silverLabelY, 'Silver', fontCenterLabel, TEXT);
  drawCentered(
    ctx,
    CENTER_X,
    silverLabelY + 40,
    formatNumber(totalEquipmentValue),
    fontCenterValue,
    TEXT,
  );

  const invStartPreview = equipYPreview + 4 * EQUIP_SPACING + 40;
  drawCentered(ctx, CENTER_X, invStartPreview - 60, timestampDisplay, fontTs, TEXT);

  const equipY = infoY + 100;
  drawEquipmentGrid(ctx, LEFT_PANEL_X, equipY, killer.Equipment, true, EQUIP_SPACING, EQUIP_ITEM_SIZE);
  drawEquipmentGrid(ctx, RIGHT_PANEL_X, equipY, victim.Equipment, false, EQUIP_SPACING, EQUIP_ITEM_SIZE);

  const invStartY = equipY + 4 * EQUIP_SPACING + 40;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, invStartY - 15);
  ctx.lineTo(WIDTH - MARGIN_X, invStartY - 15);
  ctx.stroke();

  let invValue = 0;
  if (inventory.length) {
    ctx.font = fontInvTitle;
    ctx.fillStyle = TEXT;
    ctx.textBaseline = 'top';
    ctx.fillText('Inventario:', MARGIN_X, invStartY);

    const invX = MARGIN_X;
    const invY = invStartY + 30;
    const numRows = Math.ceil(inventory.length / INV_ITEMS_PER_ROW);
    ctx.lineWidth = 1;
    for (let rowLine = 1; rowLine <= numRows; rowLine++) {
      const lineY = invY + rowLine * INV_SPACING - 2;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, lineY);
      ctx.lineTo(WIDTH - MARGIN_X, lineY);
      ctx.stroke();
    }

    for (let idx = 0; idx < inventory.length; idx++) {
      const item = inventory[idx];
      const col = idx % INV_ITEMS_PER_ROW;
      const row = Math.floor(idx / INV_ITEMS_PER_ROW);
      drawInvItem(ctx, invX + col * INV_SPACING, invY + row * INV_SPACING, item, INV_ITEM_SIZE);
    }

    const invResults = await mapWithConcurrency(
      inventory,
      (item) => getInvItemPrice(item),
      IMAGE_FETCH_CONCURRENCY,
    );
    invValue = invResults.reduce((s, v) => s + v, 0);

    const lastInvY =
      invY + Math.ceil(inventory.length / INV_ITEMS_PER_ROW) * INV_SPACING + 10;
    ctx.font = fontCenterLabel;
    ctx.fillText(
      `Valor Inventario: ${formatNumber(invValue)}  |  Total Loot: ${formatNumber(totalEquipmentValue + invValue)}`,
      MARGIN_X,
      lastInvY,
    );
  }

  const mainBuffer = canvas.toBuffer('image/png');
  destroyCanvas(canvas);

  let statsBuffer = null;
  if (alliedParticipants.length > 0) {
    const statsTitleHeight = 60;
    const rowHeight = 90;
    const statsHeight = statsTitleHeight + alliedParticipants.length * rowHeight + 40;
    const statsWidth = 800;
    const statsCanvas = createCanvas(statsWidth, statsHeight);
    const sctx = statsCanvas.getContext('2d');
    sctx.fillStyle = BG;
    sctx.fillRect(0, 0, statsWidth, statsHeight);

    const fontStatsTitle = font(24);
    const fontStatsName = font(18);
    const fontStatsNum = font(16);

    sctx.font = fontStatsTitle;
    sctx.fillStyle = TEXT;
    sctx.textBaseline = 'top';
    sctx.fillText('⚔️ Combat Stats', 20, 15);

    const sorted = [...alliedParticipants].sort((a, b) => b.damage - a.damage);
    let totalDamage = sorted.reduce((s, p) => s + p.damage, 0) || 1;
    let totalHealing = sorted.reduce((s, p) => s + p.healing, 0) || 1;

    const WEAPON_ICON_SIZE = 60;
    const NAME_X = 20 + WEAPON_ICON_SIZE + 10;
    const BAR_X = NAME_X;
    const barMaxWidth = 380;
    let rowY = statsTitleHeight;

    for (const p of sorted) {
      if (p.weapon?.Type) {
        const wImg = getCachedItemImage(p.weapon);
        if (wImg) {
          const iconY = rowY + (rowHeight - WEAPON_ICON_SIZE) / 2;
          sctx.drawImage(wImg, 20, iconY, WEAPON_ICON_SIZE, WEAPON_ICON_SIZE);
        }
      }

      sctx.font = fontStatsName;
      sctx.fillStyle = TEXT;
      sctx.fillText(p.name, NAME_X, rowY + 5);

      const dmgBarW = Math.floor((p.damage / totalDamage) * barMaxWidth);
      sctx.fillStyle = BAR_BG;
      sctx.fillRect(BAR_X, rowY + 28, barMaxWidth, 16);
      if (dmgBarW > 0) {
        sctx.fillStyle = DAMAGE_BAR;
        sctx.fillRect(BAR_X, rowY + 28, dmgBarW, 16);
      }
      const dmgPct = ((p.damage / totalDamage) * 100).toFixed(0);
      sctx.font = fontStatsNum;
      sctx.fillStyle = TEXT;
      sctx.fillText(`${formatNumber(p.damage)} (${dmgPct}%)`, BAR_X + barMaxWidth + 12, rowY + 27);

      if (p.healing > 0) {
        const healBarW = Math.floor((p.healing / totalHealing) * barMaxWidth);
        sctx.fillStyle = BAR_BG;
        sctx.fillRect(BAR_X, rowY + 52, barMaxWidth, 16);
        if (healBarW > 0) {
          sctx.fillStyle = HEAL_BAR;
          sctx.fillRect(BAR_X, rowY + 52, healBarW, 16);
        }
        sctx.fillStyle = HEAL_BAR;
        sctx.fillText(formatNumber(p.healing), BAR_X + barMaxWidth + 12, rowY + 51);
      }

      rowY += rowHeight;
    }

    statsBuffer = statsCanvas.toBuffer('image/png');
    destroyCanvas(statsCanvas);
  }

  const content = isKill
    ? `[${killer.GuildName || ''}] ${killer.Name} killed ${victim.Name}`
    : `[${victim.GuildName || ''}] ${victim.Name} muerto por ${killer.Name}`;

  return {
    skip: false,
    isKill,
    content,
    mainBuffer,
    statsBuffer,
    eventId: killData.EventId,
    eventTime: tsDate,
  };
}

function getMemoryStats() {
  return { imageCache: IMAGE_CACHE.size, imageCacheMax: IMAGE_CACHE_MAX };
}

module.exports = {
  buildKillNotificationImages,
  releaseKillBuffers,
  clearItemImageCache,
  formatNumber,
  getItemPrice,
  getMemoryStats,
};
