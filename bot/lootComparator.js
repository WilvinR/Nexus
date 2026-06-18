/**
 * Comparador loot pelea vs cofre — lógica compartida web + Discord.
 */
const LOOT_COMPARATOR_VERSION = 7;
const ITEMS_JSON =
  'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json';
const RENDER_BASE = 'https://render.albiononline.com/v1/item/';

const ES_TIER_SUFFIXES = [
  [' del legendario', 8],
  [' del anciano', 7],
  [' del gran maestro', 6],
  [' del maestro', 5],
  [' del experto', 4],
  [' del novicio', 3],
  [' del iniciado', 2],
  [' del aprendiz', 1],
];

let itemsCache = null;
let itemsCacheAt = 0;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

function parseLootDate(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  return new Date(year, month - 1, day, Number(m[4]), Number(m[5]), Number(m[6]));
}

function parseChestDate(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  return new Date(year, month - 1, day, Number(m[4]), Number(m[5]), Number(m[6]));
}

function unquoteField(s) {
  let v = String(s || '').trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v.trim();
}

function parseIsoDate(str) {
  const d = new Date(String(str || '').trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function splitCsvLine(line, delimiter) {
  return String(line || '').split(delimiter).map((c) => c.trim());
}

function parseCombatLootCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0], ';').map((h) => h.toLowerCase());
  const col = (name) => header.indexOf(name);
  const iDate = col('timestamp_utc');
  const iPlayer = col('looted_by__name');
  const iGuild = col('looted_by__guild');
  const iItemId = col('item_id');
  const iItemName = col('item_name');
  const iQty = col('quantity');
  if (iDate < 0 || iPlayer < 0 || iItemId < 0 || iItemName < 0 || iQty < 0) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], ';');
    if (cols.length < header.length) continue;
    const date = parseIsoDate(cols[iDate]);
    if (!date) continue;
    const rawItemId = cols[iItemId];
    const enchantMatch = rawItemId.match(/@(\d+)$/);
    rows.push({
      date,
      player: cols[iPlayer],
      guild: iGuild >= 0 ? cols[iGuild] || null : null,
      object: cols[iItemName],
      enchantment: enchantMatch ? Number(enchantMatch[1]) : 0,
      quality: 1,
      quantity: Number(cols[iQty]) || 0,
      rawItemId,
    });
  }
  return rows;
}

function parseLootCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t').map(unquoteField);
    if (cols.length < 6) continue;
    const date = parseLootDate(cols[0]);
    if (!date) continue;
    rows.push({
      date,
      player: cols[1],
      object: cols[2],
      enchantment: Number(cols[3]) || 0,
      quality: Number(cols[4]) || 1,
      quantity: Number(cols[5]) || 0,
    });
  }
  return rows;
}

function parseChestCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < 6) continue;
    const date = parseChestDate(cols[0]);
    if (!date) continue;
    rows.push({
      date,
      player: cols[1],
      object: cols[2],
      enchantment: Number(cols[3]) || 0,
      quality: Number(cols[4]) || 1,
      quantity: Number(cols[5]) || 0,
    });
  }
  return rows;
}

const CHEST_GRACE_BEFORE_MS = 30 * 60 * 1000;
const CHEST_GRACE_AFTER_MS = 6 * 60 * 60 * 1000;

function fileTimeSpan(rows) {
  if (!rows.length) return null;
  const times = rows.map((r) => r.date.getTime());
  return { from: Math.min(...times), to: Math.max(...times) };
}

function filterChestInWindow(chestRows, windowFrom, windowTo) {
  const from = windowFrom.getTime();
  const to = windowTo.getTime();
  return chestRows.filter((r) => {
    const t = r.date.getTime();
    return t >= from && t <= to;
  });
}

function buildChestDepositLookup(chestAgg) {
  const byName = chestAgg;
  const byItemId = new Map();
  for (const [, entry] of chestAgg) {
    if (!entry.resolvedItemId) continue;
    const idKey = `${entry.player}|${entry.resolvedItemId}|${entry.quality}`;
    const hit = byItemId.get(idKey);
    if (hit) hit.total += entry.total;
    else byItemId.set(idKey, { ...entry });
  }
  return { byName, byItemId };
}

function getDepositedAmount(entry, chestLookup) {
  const nameKey = itemKey(entry);
  let deposited = chestLookup.byName.get(nameKey)?.total || 0;
  if (deposited > 0) return deposited;
  if (entry.rawItemId) {
    const idKey = `${entry.player}|${entry.rawItemId}|${entry.quality}`;
    deposited = chestLookup.byItemId.get(idKey)?.total || 0;
  }
  return deposited;
}

async function enrichChestAgg(chestAgg) {
  for (const [, entry] of chestAgg) {
    entry.resolvedItemId =
      entry.rawItemId || (await resolveItemId(entry.object, entry.enchantment));
  }
  return chestAgg;
}

function itemKey(row) {
  return `${row.player}|${row.object}|${row.enchantment}|${row.quality}`;
}

function aggregatePositive(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.quantity <= 0) continue;
    const key = itemKey(row);
    const hit = map.get(key);
    if (hit) hit.total += row.quantity;
    else {
      map.set(key, {
        player: row.player,
        object: row.object,
        enchantment: row.enchantment,
        quality: row.quality,
        total: row.quantity,
        rawItemId: row.rawItemId || null,
      });
    }
  }
  return map;
}

function getItemTier(uniqueName) {
  const m = String(uniqueName).match(/T(\d+)/i);
  return m ? Number(m[1]) : null;
}

function buildItemId(uniqueName, tier, enchant) {
  const base = String(uniqueName).replace(/^T[1-8]_/i, '').split('@')[0];
  const id = `T${tier}_${base}`;
  return enchant > 0 ? `${id}@${enchant}` : id;
}

function tierFromSpanishName(objectName) {
  const n = norm(objectName);
  for (const [suffix, tier] of ES_TIER_SUFFIXES) {
    if (n.includes(norm(suffix))) return tier;
  }
  return null;
}

async function loadItems() {
  if (itemsCache && Date.now() - itemsCacheAt < 3_600_000) return itemsCache;
  const r = await fetch(ITEMS_JSON, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error('No se pudo cargar el catálogo de ítems de Albion.');
  itemsCache = await r.json();
  itemsCacheAt = Date.now();
  return itemsCache;
}

function scoreItemMatch(objectName, es, en, uid, tierHint) {
  const q = norm(objectName);
  if (!q) return 0;
  const nes = norm(es);
  const nen = norm(en);
  if (nes === q || nen === q) return 100;
  if (nes.includes(q) || q.includes(nes)) return 90;
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const inEs = words.filter((w) => nes.includes(w)).length;
  if (inEs < Math.max(1, Math.ceil(words.length * 0.7))) return 0;
  let score = 50 + inEs * 5;
  if (tierHint) {
    const itemTier = getItemTier(uid);
    if (itemTier === tierHint) score += 15;
    else if (itemTier) score -= 20;
  }
  return score;
}

async function resolveItemId(objectName, enchantment) {
  const items = await loadItems();
  const tierHint = tierFromSpanishName(objectName);
  let best = null;

  for (const item of items) {
    if (!item.LocalizedNames) continue;
    const baseUnique = item.UniqueName.replace(/@\d+$/, '');
    const es = item.LocalizedNames['ES-ES'] || '';
    const en = item.LocalizedNames['EN-US'] || '';
    const score = scoreItemMatch(objectName, es, en, baseUnique, tierHint);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { uniqueName: baseUnique, score, esName: es || en || baseUnique };
    }
  }

  if (!best) return null;
  const tier = tierHint || getItemTier(best.uniqueName) || 4;
  return buildItemId(best.uniqueName, tier, enchantment);
}

function itemImageUrl(itemId, quality = 1, size = 80) {
  const q = Math.max(1, Math.min(5, Number(quality) || 1));
  return `${RENDER_BASE}${encodeURIComponent(itemId)}.png?quality=${q}&size=${size}`;
}

async function enrichMissingItem(entry) {
  const itemId = entry.rawItemId || (await resolveItemId(entry.object, entry.enchantment));
  return {
    object: entry.object,
    enchantment: entry.enchantment,
    quality: entry.quality,
    looted: entry.looted,
    deposited: entry.deposited,
    missing: entry.missing,
    itemId,
    imageUrl: itemId ? itemImageUrl(itemId, entry.quality, 80) : null,
  };
}

function classifyFile(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return 'empty';
  const header = lines[0].toLowerCase();
  const sample = lines[1] || '';

  if (header.includes('timestamp_utc') && header.includes('item_id')) return 'combat';
  if (lines[0].includes(';') && header.includes('item_id') && header.includes('item_name')) return 'combat';
  if (sample.includes('\t') || header.includes('\t')) return 'ingame_tsv';
  if (header.includes('fecha') && header.includes('jugador') && header.includes('objeto')) {
    return 'chest_csv';
  }
  if (sample.split(',').length >= 6) return 'chest_csv';
  return 'unknown';
}

function parseChestRows(text, type) {
  if (type === 'chest_csv') return parseChestCsv(text);
  if (type === 'ingame_tsv') return parseLootCsv(text);
  return [];
}

function parseLootRows(text, type) {
  if (type === 'combat') return parseCombatLootCsv(text);
  if (type === 'ingame_tsv') return parseLootCsv(text);
  return [];
}

function parseLootFromSlot(text) {
  const combat = parseCombatLootCsv(text);
  if (combat.length) return { rows: combat, type: 'combat' };
  const ingame = parseLootCsv(text);
  if (ingame.length) return { rows: ingame, type: 'ingame_tsv' };
  return { rows: [], type: 'unknown' };
}

function parseChestFromSlot(text) {
  if (parseCombatLootCsv(text).length) return { rows: [], type: 'combat_in_chest_slot' };
  const tsv = parseLootCsv(text);
  if (tsv.length) return { rows: tsv, type: 'ingame_tsv' };
  const csv = parseChestCsv(text);
  if (csv.length) return { rows: csv, type: 'chest_csv' };
  return { rows: [], type: 'unknown' };
}

function sniffFileFormat(text) {
  const kind = classifyFile(text);
  if (kind === 'combat' || kind === 'ingame_tsv') return 'loot';
  if (kind === 'chest_csv') return 'chest';
  return 'unknown';
}

function swapFiles(a, b) {
  return [b, a];
}

/**
 * @param {string} lootCsv - casilla izquierda: loot de combate
 * @param {string} chestCsv - casilla derecha: cofre del gremio
 */
async function compareLootFiles(lootCsv, chestCsv) {
  let lootText = String(lootCsv || '');
  let chestText = String(chestCsv || '');
  let filesSwapped = false;

  const combatInLoot = parseCombatLootCsv(lootText);
  const combatInChest = parseCombatLootCsv(chestText);

  if (!combatInLoot.length && combatInChest.length) {
    [lootText, chestText] = swapFiles(lootText, chestText);
    filesSwapped = true;
  }

  const lootFinal = parseLootFromSlot(lootText);
  const chestFinal = parseChestFromSlot(chestText);

  if (!lootFinal.rows.length) {
    return {
      ok: false,
      error:
        'No se pudo leer el loot de combate. Usa el export UTC (punto y coma) o el log in-game (tabulaciones) en la casilla izquierda.',
    };
  }

  if (!chestFinal.rows.length) {
    return {
      ok: false,
      error:
        'No se pudo leer el cofre. Usa el export del banco del gremio (tabulaciones o CSV con comas) en la casilla derecha.',
    };
  }

  const lootRows = lootFinal.rows;
  const chestRows = chestFinal.rows;
  const lootType = lootFinal.type;

  const times = lootRows.map((r) => r.date.getTime());
  let windowFrom = new Date(Math.min(...times) - CHEST_GRACE_BEFORE_MS);
  let windowTo = new Date(Math.max(...times) + CHEST_GRACE_AFTER_MS);

  let chestInWindow = filterChestInWindow(chestRows, windowFrom, windowTo);
  let windowNote = null;

  if (!chestInWindow.length && chestRows.length > 0) {
    const lootSpan = fileTimeSpan(lootRows);
    const chestSpan = fileTimeSpan(chestRows);
    if (lootSpan && chestSpan) {
      const unionFrom = new Date(Math.min(lootSpan.from, chestSpan.from) - CHEST_GRACE_BEFORE_MS);
      const unionTo = new Date(Math.max(lootSpan.to, chestSpan.to) + CHEST_GRACE_AFTER_MS);
      const unionChest = filterChestInWindow(chestRows, unionFrom, unionTo);
      if (unionChest.length > 0) {
        windowFrom = unionFrom;
        windowTo = unionTo;
        chestInWindow = unionChest;
        windowNote =
          'Las fechas de los archivos no coincidían; se amplió la ventana para incluir el cofre de la pelea.';
      }
    }
  }

  const lootAgg = aggregatePositive(lootRows);
  const chestAgg = aggregatePositive(chestInWindow);
  await enrichChestAgg(chestAgg);
  const chestLookup = buildChestDepositLookup(chestAgg);

  const playerGuilds = new Map();
  for (const row of lootRows) {
    if (row.player && row.guild && !playerGuilds.has(row.player)) {
      playerGuilds.set(row.player, row.guild);
    }
  }

  const playerMap = new Map();

  for (const [, entry] of lootAgg) {
    if (!playerMap.has(entry.player)) {
      playerMap.set(entry.player, {
        name: entry.player,
        guild: playerGuilds.get(entry.player) || null,
        missing: [],
        ok: true,
      });
    }
    const deposited = getDepositedAmount(entry, chestLookup);
    const missing = entry.total - deposited;
    if (missing > 0) {
      const p = playerMap.get(entry.player);
      p.ok = false;
      p.missing.push({
        object: entry.object,
        enchantment: entry.enchantment,
        quality: entry.quality,
        looted: entry.total,
        deposited,
        missing,
        rawItemId: entry.rawItemId || null,
      });
    }
  }

  const players = [...playerMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  for (const p of players) {
    p.missing = await Promise.all(p.missing.map(enrichMissingItem));
    p.missing.sort((a, b) => b.missing - a.missing);
  }

  const pendingCount = players.filter((p) => !p.ok).length;
  const chestDepositsInWindow = chestInWindow.filter((r) => r.quantity > 0).length;

  let warning = null;
  if (!chestDepositsInWindow && chestRows.some((r) => r.quantity > 0)) {
    warning =
      'No hubo depósitos en el cofre durante la ventana de la pelea. Todo lo looteado aparece como pendiente.';
  } else if (!chestInWindow.length && chestRows.length > 0 && !windowNote) {
    warning =
      'El cofre no tiene movimientos en la ventana de la pelea. Verifica que ambos archivos sean de la misma fight.';
  } else if (lootType === 'combat' && lootRows.length < 15 && chestDepositsInWindow > 0) {
    warning =
      `El export de combate solo tiene ${lootRows.length} fila(s). Si la pelea tuvo más loot, exporta el log completo (UTC o in-game).`;
  }

  return {
    ok: true,
    window: {
      from: windowFrom.toISOString(),
      to: windowTo.toISOString(),
      fromLabel: windowFrom.toLocaleString('es-ES'),
      toLabel: windowTo.toLocaleString('es-ES'),
    },
    stats: {
      comparatorVersion: LOOT_COMPARATOR_VERSION,
      lootRows: lootRows.length,
      chestRows: chestRows.length,
      chestInWindow: chestInWindow.length,
      chestDepositsInWindow,
      players: players.length,
      pending: pendingCount,
      delivered: players.length - pendingCount,
      filesSwapped,
      windowNote,
      warning,
    },
    players: players.map((p) => ({
      name: p.name,
      guild: p.guild || null,
      status: p.ok ? 'ok' : 'pending',
      missing: p.missing,
    })),
  };
}

module.exports = {
  LOOT_COMPARATOR_VERSION,
  compareLootFiles,
  parseLootCsv,
  parseChestCsv,
  parseCombatLootCsv,
  classifyFile,
  itemImageUrl,
  resolveItemId,
};
