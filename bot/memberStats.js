const memberStatsCache = new Map();
const MEMBER_STATS_TTL_MS = 120_000;

function quickMemberStats(guild) {
  const total = guild.memberCount || 0;
  const cached = [...guild.members.cache.values()];
  const bots = cached.filter((m) => m.user.bot).length;
  const complete = cached.length >= total;
  return {
    total,
    bots,
    humans: complete ? cached.filter((m) => !m.user.bot).length : Math.max(0, total - bots),
    approximate: !complete,
  };
}

async function resolveMemberStats(guild) {
  const key = guild.id;
  const hit = memberStatsCache.get(key);
  if (hit && Date.now() - hit.at < MEMBER_STATS_TTL_MS) return hit.data;

  if (guild.members.cache.size < guild.memberCount) {
    guild.members.fetch().catch(() => {});
  }

  const data = quickMemberStats(guild);
  memberStatsCache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { quickMemberStats, resolveMemberStats };
