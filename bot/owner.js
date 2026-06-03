/** IDs de Discord con acceso de dueño del bot (BOT_OWNER_ID en Discloud). */
function getBotOwnerIds() {
  const raw = process.env.BOT_OWNER_ID || process.env.BOT_OWNER_IDS || '';
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isBotOwner(userId) {
  if (!userId) return false;
  const ids = getBotOwnerIds();
  if (!ids.length) return false;
  const uid = String(userId).trim();
  return ids.some((id) => id === uid);
}

module.exports = { getBotOwnerIds, isBotOwner };
