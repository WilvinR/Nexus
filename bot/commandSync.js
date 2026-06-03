const { REST, Routes } = require('discord.js');
const { MODULES, isModuleEnabled } = require('./modules');

let providers = [];
let logsModule = null;

function init(modulos, logs) {
  providers = modulos;
  logsModule = logs;
}

function getClientId(client) {
  if (process.env.CLIENT_ID) return process.env.CLIENT_ID;
  if (client?.application?.id) return client.application.id;
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  try {
    return Buffer.from(token.split('.')[0], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function buildCommandsForGuild(getDb, guildId) {
  const enabled = new Set(MODULES.filter((m) => isModuleEnabled(getDb, guildId, m.id)).map((m) => m.id));
  const sources = [...providers];
  if (logsModule && enabled.has('logs')) sources.push(logsModule);

  return sources
    .filter((m) => enabled.has(m.id))
    .flatMap((m) => (m.commands || []).map((c) => c.data.toJSON()));
}

async function syncGuildCommands(client, getDb, log, guildId) {
  const clientId = getClientId(client);
  if (!clientId) return;
  const body = buildCommandsForGuild(getDb, guildId);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(clientId, String(guildId)), { body });
  log.info(`Comandos ${guildId}: ${body.length} slash`);
}

async function clearGlobalCommands(client, log) {
  const clientId = getClientId(client);
  if (!clientId) return;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  log.info('Comandos globales vacíos (solo por servidor)');
}

async function syncAllGuilds(client, getDb, log) {
  await clearGlobalCommands(client, log);

  const devGuild = process.env.GUILD_ID;
  const guilds = devGuild
    ? [devGuild]
    : [...client.guilds.cache.keys()];

  for (const gid of guilds) {
    try {
      await syncGuildCommands(client, getDb, log, gid);
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      log.warn(`Comandos ${gid}: ${e.message}`);
    }
  }
  log.info(`Comandos sincronizados en ${guilds.length} servidor(es)`);
}

module.exports = { init, syncGuildCommands, syncAllGuilds, buildCommandsForGuild };
