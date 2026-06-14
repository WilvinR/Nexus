const memberStatsCache = new Map();
const MEMBER_STATS_TTL_MS = 120_000;

function countFromCache(guild) {
  const total = guild.memberCount || 0;
  const cached = [...guild.members.cache.values()];
  const complete = cached.length >= total;
  return {
    total,
    bots: complete ? cached.filter((m) => m.user.bot).length : null,
    humans: complete ? cached.filter((m) => !m.user.bot).length : null,
    approximate: !complete,
  };
}

/** Estimación rápida sin fetch; puede quedar incompleta. */
function quickMemberStats(guild) {
  return countFromCache(guild);
}

async function resolveMemberStats(guild) {
  const key = guild.id;
  const hit = memberStatsCache.get(key);
  if (hit && Date.now() - hit.at < MEMBER_STATS_TTL_MS) return hit.data;

  const total = guild.memberCount || 0;
  if (guild.members.cache.size < total) {
    try {
      await guild.members.fetch();
    } catch {
      return countFromCache(guild);
    }
  }

  const data = countFromCache(guild);
  if (!data.approximate) {
    memberStatsCache.set(key, { at: Date.now(), data });
  }
  return data;
}

module.exports = { quickMemberStats, resolveMemberStats };
