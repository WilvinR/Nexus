const ALBION = 'https://gameinfo.albiononline.com/api/gameinfo';

async function albionFetch(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 200) return { ok: true, data: await r.json() };
      if (r.status === 404) return { ok: false, notFound: true };
    } catch {
      await new Promise((x) => setTimeout(x, 500 * (i + 1)));
    }
  }
  return { ok: false };
}

const albionGuild = (id) => albionFetch(`${ALBION}/guilds/${id}`);
const albionAlliance = (id) => albionFetch(`${ALBION}/alliances/${id}`);
const albionPlayer = (id) => albionFetch(`${ALBION}/players/${id}`);

module.exports = { ALBION, albionFetch, albionGuild, albionAlliance, albionPlayer };
