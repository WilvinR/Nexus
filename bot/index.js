const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActivityType,
  REST,
  Routes,
} = require('discord.js');

const logs = require('./logs');
const api = require('./api');
const kill = require('./kill');
const moderacion = require('./moderacion');
const eventos = require('./eventos');
const musica = require('./musica');
const battle = require('./battle');
const bal = require('./bal');
const utilidad = require('./utilidad');
const mercado = require('./mercado');
const { moduleForInteraction, isModuleEnabled } = require('./modules');
const modulos = [require('./registro'), kill, moderacion, eventos, musica, battle, bal, utilidad, mercado];

// ——— .env ———
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

if (!process.env.DISCORD_TOKEN) {
  console.error('[Nexus] Falta DISCORD_TOKEN en .env');
  process.exit(1);
}

const log = {
  info: (...a) => console.log('[Nexus]', ...a),
  warn: (...a) => console.warn('[Nexus]', ...a),
  error: (...a) => console.error('[Nexus]', ...a),
};

function getClientId() {
  if (process.env.CLIENT_ID) return process.env.CLIENT_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  try {
    return Buffer.from(token.split('.')[0], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

let db;

function getDb() {
  if (db) return db;
  db = new Database(path.join(__dirname, 'nexus.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_modules (
      guild_id TEXT NOT NULL, module_id TEXT NOT NULL, enabled INTEGER DEFAULT 1,
      PRIMARY KEY (guild_id, module_id)
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      username TEXT,
      avatar TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registro_alliances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, discord_guild_id TEXT NOT NULL,
      albion_alliance_id TEXT NOT NULL, albion_alliance_name TEXT, albion_alliance_tag TEXT,
      UNIQUE (discord_guild_id, albion_alliance_id)
    );
    CREATE TABLE IF NOT EXISTS registro_guilds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, discord_guild_id TEXT NOT NULL,
      albion_guild_id TEXT NOT NULL, albion_guild_name TEXT, nickname_tag TEXT NOT NULL,
      role_id TEXT, alliance_id INTEGER, registro_mode TEXT DEFAULT 'guild',
      UNIQUE (discord_guild_id, albion_guild_id)
    );
    CREATE TABLE IF NOT EXISTS registro_users (
      discord_user_id TEXT NOT NULL, discord_guild_id TEXT NOT NULL,
      albion_player_id TEXT NOT NULL, albion_player_name TEXT, registro_guild_id INTEGER NOT NULL,
      PRIMARY KEY (discord_user_id, discord_guild_id)
    );
    CREATE TABLE IF NOT EXISTS logs_config (
      guild_id TEXT PRIMARY KEY, logs_channel_id TEXT, logs_paused INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kill_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_guild_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      albion_entity_id TEXT NOT NULL,
      kill_channel_id TEXT NOT NULL,
      death_channel_id TEXT NOT NULL,
      last_kill_event_id TEXT,
      last_death_event_id TEXT,
      last_death_event_ids TEXT DEFAULT '{}',
      UNIQUE (discord_guild_id, albion_entity_id, entity_type)
    );
    CREATE TABLE IF NOT EXISTS autorol_configs (
      message_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      config_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eventos (
      message_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evento_templates (
      template_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      creator_id TEXT,
      template_name TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at REAL
    );
    CREATE TABLE IF NOT EXISTS battle_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_guild_id TEXT NOT NULL,
      track_type TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      albion_guild_id TEXT NOT NULL,
      alliance_id TEXT,
      alliance_tag TEXT,
      sent_battles TEXT DEFAULT '[]',
      last_check REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bal_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      balance INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS bal_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      admin_id TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const registroCols = db.prepare('PRAGMA table_info(registro_guilds)').all();
  if (registroCols.length && !registroCols.some((c) => c.name === 'registro_mode')) {
    db.exec(`ALTER TABLE registro_guilds ADD COLUMN registro_mode TEXT DEFAULT 'guild'`);
    log.info('Migración: columna registro_mode en registro_guilds');
  }
  return db;
}

const ctx = () => ({ getDb, log });

function purgeGuild(guildId) {
  const id = String(guildId);
  const d = getDb();
  d.prepare('DELETE FROM guild_modules WHERE guild_id = ?').run(id);
  d.prepare('DELETE FROM registro_alliances WHERE discord_guild_id = ?').run(id);
  d.prepare('DELETE FROM registro_guilds WHERE discord_guild_id = ?').run(id);
  d.prepare('DELETE FROM registro_users WHERE discord_guild_id = ?').run(id);
  d.prepare('DELETE FROM logs_config WHERE guild_id = ?').run(id);
  d.prepare('DELETE FROM kill_entities WHERE discord_guild_id = ?').run(id);
  for (const m of modulos) if (m.onGuildRemove) m.onGuildRemove(guildId, ctx());
  if (logs.onGuildRemove) logs.onGuildRemove(guildId, ctx());
}

async function registerCommands() {
  const all = [...modulos, logs];
  const body = all.flatMap((m) => (m.commands || []).map((c) => c.data.toJSON()));
  const clientId = getClientId();
  if (!clientId) return log.warn('Sin CLIENT_ID (ni token válido para derivarlo)');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(clientId, process.env.GUILD_ID)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body });
  log.info('Comandos OK');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember, Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once(Events.ClientReady, (c) => {
  log.info(`Conectado: ${c.user.tag}`);
  c.user.setActivity('Albion Online', { type: ActivityType.Watching });
  setImmediate(() => {
    try {
      getDb();
      const c = ctx();
      if (logs.onInit) logs.onInit(client, c);
      for (const m of modulos) if (m.onInit) m.onInit(client, c);
      api.start(client, log, getDb);
    } catch (e) {
      log.error(e);
    }
    registerCommands().catch((e) => log.error('Comandos:', e));
  });
});

client.on(Events.InteractionCreate, async (ix) => {
  try {
    if (!ix.guildId) return;
    const c = ctx();
    const modId = moduleForInteraction(ix);
    if (modId && !isModuleEnabled(getDb, ix.guildId, modId)) {
      await ix.reply({
        content: `❌ El módulo **${modId}** está desactivado en este servidor.`,
        ephemeral: true,
      });
      return;
    }
    if (await logs.handleInteraction(ix, c)) return;
    for (const m of modulos) {
      if (m.handleInteraction && (await m.handleInteraction(ix, c))) return;
    }
    if (ix.isChatInputCommand()) {
      await ix.reply({ content: 'Comando no disponible.', ephemeral: true });
    }
  } catch (e) {
    log.error(e.stack || e);
    const msg = { content: 'Error.', ephemeral: true };
    if (ix.replied || ix.deferred) await ix.followUp(msg).catch(() => {});
    else await ix.reply(msg).catch(() => {});
  }
});

client.on(Events.GuildDelete, (g) => purgeGuild(g.id));
client.on(Events.Error, (e) => log.error(String(e)));
process.on('unhandledRejection', (e) => log.error(String(e)));

log.info('Iniciando...');
client.login(process.env.DISCORD_TOKEN).catch((e) => {
  log.error(e);
  process.exit(1);
});
