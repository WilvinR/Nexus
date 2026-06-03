function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function logCommand(getDb, guildId, commandName) {
  const day = dayKey();
  const cmd = String(commandName || 'unknown').slice(0, 64);
  const gid = guildId ? String(guildId) : '_dm';
  getDb()
    .prepare(`
      INSERT INTO command_usage (day, guild_id, command_name, count) VALUES (?, ?, ?, 1)
      ON CONFLICT(day, guild_id, command_name) DO UPDATE SET count = count + 1
    `)
    .run(day, gid, cmd);
}

function recordDailySnapshot(getDb, client) {
  const day = dayKey();
  let users = 0;
  const guildCount = client.guilds?.cache?.size ?? 0;
  for (const g of client.guilds.cache.values()) users += g.memberCount || 0;
  const commandsToday = getDb()
    .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM command_usage WHERE day = ?')
    .get(day).n;
  getDb()
    .prepare(`
      INSERT INTO daily_snapshots (day, guild_count, user_count, commands_count, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET
        guild_count = excluded.guild_count,
        user_count = excluded.user_count,
        commands_count = excluded.commands_count,
        created_at = excluded.created_at
    `)
    .run(day, guildCount, users, commandsToday, Date.now());
}

function getChartData(getDb, days = 30) {
  const since = dayKey(Date.now() - days * 86400000);
  const growth = getDb()
    .prepare(
      `SELECT day, guild_count AS guilds, user_count AS users, commands_count AS commands
       FROM daily_snapshots WHERE day >= ? ORDER BY day ASC`,
    )
    .all(since);

  const cmdSince = dayKey(Date.now() - 7 * 86400000);
  const commandUsage = getDb()
    .prepare(
      `SELECT command_name AS command, SUM(count) AS total
       FROM command_usage WHERE day >= ?
       GROUP BY command_name ORDER BY total DESC LIMIT 20`,
    )
    .all(cmdSince);

  const activity = getDb()
    .prepare(
      `SELECT day, SUM(count) AS commands FROM command_usage WHERE day >= ? GROUP BY day ORDER BY day ASC`,
    )
    .all(since);

  return { growth, commandUsage, activity };
}

function getGlobalStats(getDb) {
  const kills = getDb().prepare('SELECT COUNT(*) AS n FROM kill_entities').get().n;
  const battles = getDb().prepare('SELECT COUNT(*) AS n FROM battle_tracking').get().n;
  const playersReg = getDb().prepare('SELECT COUNT(*) AS n FROM registro_users').get().n;
  const playersKill = getDb()
    .prepare("SELECT COUNT(*) AS n FROM kill_entities WHERE entity_type = 'player'")
    .get().n;
  const commands = getDb().prepare('SELECT COALESCE(SUM(count), 0) AS n FROM command_usage').get().n;
  const suggestions = getDb().prepare('SELECT COUNT(*) AS n FROM suggestions').get().n;
  return {
    kills,
    battles,
    playersMonitored: playersReg + playersKill,
    commandsExecuted: commands,
    suggestions,
  };
}

function ensureGuildMeta(getDb, guildId, fields = {}) {
  const id = String(guildId);
  const row = getDb().prepare('SELECT * FROM guild_meta WHERE guild_id = ?').get(id);
  if (!row) {
    getDb()
      .prepare(
        'INSERT INTO guild_meta (guild_id, premium, owner_id, owner_tag, joined_at) VALUES (?, 0, ?, ?, ?)',
      )
      .run(id, fields.ownerId || null, fields.ownerTag || null, fields.joinedAt || Date.now());
  } else if (fields.ownerId || fields.ownerTag) {
    getDb()
      .prepare('UPDATE guild_meta SET owner_id = COALESCE(?, owner_id), owner_tag = COALESCE(?, owner_tag) WHERE guild_id = ?')
      .run(fields.ownerId || null, fields.ownerTag || null, id);
  }
  return getDb().prepare('SELECT * FROM guild_meta WHERE guild_id = ?').get(id);
}

function startStatsScheduler(getDb, client, log) {
  const tick = () => {
    try {
      recordDailySnapshot(getDb, client);
    } catch (e) {
      log.warn(`Snapshot: ${e.message}`);
    }
  };
  tick();
  setInterval(tick, 6 * 60 * 60 * 1000);
}

module.exports = {
  dayKey,
  logCommand,
  recordDailySnapshot,
  getChartData,
  getGlobalStats,
  ensureGuildMeta,
  startStatsScheduler,
};
