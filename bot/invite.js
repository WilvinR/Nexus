/** URL de invitación OAuth del bot (Discord). */
const FALLBACK_CLIENT_ID = '1348090006547337318';
const DEFAULT_PERMISSIONS = '268568576';

function getClientId() {
  if (process.env.CLIENT_ID) return String(process.env.CLIENT_ID).trim();
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  try {
    return Buffer.from(token.split('.')[0], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function buildInviteUrl() {
  const custom = process.env.DISCORD_INVITE_URL?.trim();
  if (custom && custom.includes('client_id=')) return custom;

  const clientId = getClientId() || FALLBACK_CLIENT_ID;
  const perms = process.env.DISCORD_INVITE_PERMISSIONS || DEFAULT_PERMISSIONS;
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: perms,
    scope: 'bot applications.commands',
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

function isValidInviteUrl(url) {
  return typeof url === 'string' && url.includes('client_id=') && /scope=.*bot/.test(url);
}

module.exports = { buildInviteUrl, getClientId, isValidInviteUrl, FALLBACK_CLIENT_ID };
