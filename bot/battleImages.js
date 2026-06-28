const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

const FONT_FAMILY = 'BattleFont';
for (const p of [
  path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf'),
  'C:\\Windows\\Fonts\\arialbd.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
]) {
  try {
    if (fs.existsSync(p)) {
      registerFont(p, { family: FONT_FAMILY });
      break;
    }
  } catch {
    /* */
  }
}

function font(size) {
  return `${size}px ${FONT_FAMILY}`;
}

function fmtNum(n) {
  const x = Number(n) || 0;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}m`;
  if (x >= 1_000) return `${(x / 1_000).toFixed(1)}k`;
  return String(x);
}

function drawBg(ctx, w, h) {
  for (let y = 0; y < h; y++) {
    const r = Math.floor(25 + (y / h) * 15);
    const g = Math.floor(45 + (y / h) * 20);
    const b = Math.floor(85 + (y / h) * 25);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.strokeStyle = '#00BFFF';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);
}

function drawHeaders(ctx, headers, xs, y) {
  ctx.font = font(18);
  ctx.fillStyle = '#9ca3af';
  ctx.textBaseline = 'top';
  headers.forEach((h, i) => ctx.fillText(h, xs[i], y));
}

function destroyCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    /* ignore */
  }
}

function buildGuildBattleImage(battle, monitoredGuildId) {
  const guilds = {};
  const monitoredPlayers = [];
  let totalPlayers = 0;

  const players = battle.players || {};
  for (const p of Object.values(players)) {
    const guildId = p.guildId;
    const guildName = p.guildName || 'Unknown';
    if (!guildId) continue;
    if (!guilds[guildName]) guilds[guildName] = { players: 0, kills: 0, deaths: 0, fame: 0 };
    guilds[guildName].players++;
    guilds[guildName].kills += p.kills || 0;
    guilds[guildName].deaths += p.deaths || 0;
    guilds[guildName].fame += p.killFame || 0;
    totalPlayers++;
    if (guildId === monitoredGuildId) {
      monitoredPlayers.push({ name: p.name || '?', kills: p.kills || 0, killFame: p.killFame || 0 });
    }
  }

  const monitoredGuildName =
    Object.values(battle.guilds || {}).find((g) => g.id === monitoredGuildId)?.name || 'Unknown';
  const sorted = Object.entries(guilds).sort((a, b) => b[1].kills - a[1].kills);
  const topKillers = monitoredPlayers
    .filter((p) => p.kills > 0)
    .sort((a, b) => b.kills - a.kills || b.killFame - a.killFame)
    .slice(0, 3);

  const WIDTH = 900;
  const HEIGHT = 200 + sorted.length * 40 + (topKillers.length ? topKillers.length * 40 + 60 : 0);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  drawBg(ctx, WIDTH, HEIGHT);

  const xs = [40, 320, 445, 528, 670];
  drawHeaders(ctx, ['GUILD NAME', 'PLAYERS', 'KILLS', 'DEATHS', 'FAME'], xs, 30);

  ctx.font = font(18);
  let y = 80;
  for (const [name, st] of sorted) {
    ctx.fillStyle = name === monitoredGuildName ? '#FFD700' : '#ffffff';
    ctx.fillText(name.slice(0, 25), 40, y);
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(String(st.players).padStart(3, ' '), 350, y);
    ctx.fillStyle = '#2E7D32';
    ctx.fillText(String(st.kills).padStart(3, ' '), 450, y);
    ctx.fillStyle = '#FF0000';
    ctx.fillText(String(st.deaths).padStart(3, ' '), 550, y);
    ctx.fillStyle = '#FFA726';
    ctx.fillText(fmtNum(st.fame).padStart(8, ' '), 650, y);
    y += 40;
  }

  if (topKillers.length) {
    ctx.strokeStyle = '#6b7280';
    ctx.beginPath();
    ctx.moveTo(40, y + 20);
    ctx.lineTo(WIDTH - 40, y + 20);
    ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(`Jugadores Top del gremio ${monitoredGuildName}:`, 40, y + 40);
    let py = y + 80;
    topKillers.forEach((p, i) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${i + 1}. ${p.name}: ${p.kills} kills (${fmtNum(p.killFame)} fame)`, 60, py);
      py += 40;
    });
  }

  const names = sorted.slice(0, 2).map(([n]) => n);
  const title =
    sorted.length > 2 ? `${names.join(' vs ')} + ${sorted.length - 2} más` : names.join(' vs ');

  const battleTime = new Date(String(battle.endTime).replace('Z', '+00:00'));
  const buffer = canvas.toBuffer('image/png');
  destroyCanvas(canvas);
  return { buffer, title: `${title} - ${totalPlayers} Players`, battleTime };
}

function buildAllianceBattleImage(battle, monitoredAllianceId, allianceTag) {
  const allianceTags = {};

  for (const [, gd] of Object.entries(battle.guilds || {})) {
    const aid = gd.allianceId;
    if (!aid) continue;
    const tag = gd.alliance || gd.allianceTag || gd.allianceName || '';
    if (tag && !allianceTags[aid]) allianceTags[aid] = tag;
  }

  const grouped = {};
  const monitoredPlayers = [];
  let totalPlayers = 0;

  for (const p of Object.values(battle.players || {})) {
    const guildId = p.guildId;
    const guildName = p.guildName || 'Unknown';
    if (!guildId) continue;

    const gMeta = (battle.guilds || {})[guildId];
    const aid = gMeta?.allianceId || p.allianceId || null;
    let groupKey;
    let displayName;
    let groupAllianceId = null;

    if (aid) {
      groupKey = `a_${aid}`;
      const tag = allianceTags[aid] || p.allianceName || gMeta?.alliance || gMeta?.allianceTag || '';
      displayName = tag || guildName;
      groupAllianceId = aid;
    } else {
      groupKey = `g_${guildId}`;
      displayName = guildName;
    }

    if (!grouped[groupKey]) {
      grouped[groupKey] = { players: 0, kills: 0, deaths: 0, fame: 0, displayName, allianceId: groupAllianceId };
    }
    grouped[groupKey].players++;
    grouped[groupKey].kills += p.kills || 0;
    grouped[groupKey].deaths += p.deaths || 0;
    grouped[groupKey].fame += p.killFame || 0;
    totalPlayers++;

    if (aid === monitoredAllianceId) {
      monitoredPlayers.push({
        name: p.name || '?',
        guild: guildName,
        kills: p.kills || 0,
        killFame: p.killFame || 0,
      });
    }
  }

  if (grouped[`a_${monitoredAllianceId}`]) {
    grouped[`a_${monitoredAllianceId}`].displayName = allianceTag;
  }

  const sorted = Object.entries(grouped).sort((a, b) => b[1].kills - a[1].kills);
  const topKillers = monitoredPlayers
    .filter((p) => p.kills > 0)
    .sort((a, b) => b.kills - a.kills || b.killFame - a.killFame)
    .slice(0, 3);

  const WIDTH = 900;
  const HEIGHT = 200 + sorted.length * 40 + (topKillers.length ? topKillers.length * 40 + 60 : 0);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  drawBg(ctx, WIDTH, HEIGHT);

  const xs = [40, 320, 445, 528, 670];
  drawHeaders(ctx, ['ALIANZA/GREMIO', 'PLAYERS', 'KILLS', 'DEATHS', 'FAME'], xs, 30);

  ctx.font = font(18);
  let y = 80;
  for (const [, st] of sorted) {
    ctx.fillStyle = st.allianceId === monitoredAllianceId ? '#FFD700' : '#ffffff';
    ctx.fillText(st.displayName.slice(0, 25), 40, y);
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(String(st.players).padStart(3, ' '), 350, y);
    ctx.fillStyle = '#2E7D32';
    ctx.fillText(String(st.kills).padStart(3, ' '), 450, y);
    ctx.fillStyle = '#FF0000';
    ctx.fillText(String(st.deaths).padStart(3, ' '), 550, y);
    ctx.fillStyle = '#FFA726';
    ctx.fillText(fmtNum(st.fame).padStart(8, ' '), 650, y);
    y += 40;
  }

  if (topKillers.length) {
    ctx.strokeStyle = '#6b7280';
    ctx.beginPath();
    ctx.moveTo(40, y + 20);
    ctx.lineTo(WIDTH - 40, y + 20);
    ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(`Jugadores Top de la alianza ${allianceTag}:`, 40, y + 40);
    let py = y + 80;
    topKillers.forEach((p, i) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${i + 1}. ${p.name} (${p.guild}): ${p.kills} kills (${fmtNum(p.killFame)} fame)`, 60, py);
      py += 40;
    });
  }

  const names = sorted.slice(0, 2).map(([, s]) => s.displayName);
  const title =
    sorted.length > 2 ? `${names.join(' vs ')} + ${sorted.length - 2} más` : names.join(' vs ');
  const battleTime = new Date(String(battle.endTime).replace('Z', '+00:00'));
  const buffer = canvas.toBuffer('image/png');
  destroyCanvas(canvas);
  return { buffer, title: `${title} - ${totalPlayers} Players`, battleTime };
}

module.exports = { buildGuildBattleImage, buildAllianceBattleImage };
