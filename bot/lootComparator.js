/**
 * Comparador loot pelea vs cofre — lógica compartida web + Discord.
 */
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
  const itemId = await resolveItemId(entry.object, entry.enchantment);
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

/**
 * @param {string} lootCsv - log loot (TSV, MM/DD/YYYY)
 * @param {string} chestCsv - log cofre (CSV, DD/MM/YYYY)
 */
async function compareLootFiles(lootCsv, chestCsv) {
  const lootRows = parseLootCsv(lootCsv);
  const chestRows = parseChestCsv(chestCsv);

  if (!lootRows.length) {
    return { ok: false, error: 'El archivo de loot está vacío o no se pudo leer.' };
  }

  const times = lootRows.map((r) => r.date.getTime());
  const windowFrom = new Date(Math.min(...times));
  const windowTo = new Date(Math.max(...times));

  const chestInWindow = chestRows.filter((r) => {
    const t = r.date.getTime();
    return t >= windowFrom.getTime() && t <= windowTo.getTime();
  });

  const lootAgg = aggregatePositive(lootRows);
  const chestAgg = aggregatePositive(chestInWindow);

  const playerMap = new Map();

  for (const [, entry] of lootAgg) {
    if (!playerMap.has(entry.player)) {
      playerMap.set(entry.player, { name: entry.player, missing: [], ok: true });
    }
    const chestKey = itemKey(entry);
    const deposited = chestAgg.get(chestKey)?.total || 0;
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
      });
    }
  }

  const players = [...playerMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  for (const p of players) {
    p.missing = await Promise.all(p.missing.map(enrichMissingItem));
    p.missing.sort((a, b) => b.missing - a.missing);
  }

  const pendingCount = players.filter((p) => !p.ok).length;

  return {
    ok: true,
    window: {
      from: windowFrom.toISOString(),
      to: windowTo.toISOString(),
      fromLabel: windowFrom.toLocaleString('es-ES'),
      toLabel: windowTo.toLocaleString('es-ES'),
    },
    stats: {
      lootRows: lootRows.length,
      chestRows: chestRows.length,
      chestInWindow: chestInWindow.length,
      players: players.length,
      pending: pendingCount,
      delivered: players.length - pendingCount,
    },
    players: players.map((p) => ({
      name: p.name,
      status: p.ok ? 'ok' : 'pending',
      missing: p.missing,
    })),
  };
}

module.exports = {
  compareLootFiles,
  parseLootCsv,
  parseChestCsv,
  itemImageUrl,
  resolveItemId,
};
