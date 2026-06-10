const { logSystem } = require('./adminRoutes');

function startRamMonitor(client, getDb, log) {
  const thresholdMb = Math.max(64, parseInt(process.env.RAM_WARN_MB || '400', 10) || 400);
  const intervalMs = Math.max(15_000, parseInt(process.env.RAM_CHECK_MS || '60000', 10) || 60_000);
  let lastWarnAt = 0;

  setInterval(() => {
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (rssMb < thresholdMb) return;

    const now = Date.now();
    if (now - lastWarnAt < intervalMs) return;
    lastWarnAt = now;

    const guildCount = client.guilds?.cache?.size ?? 0;
    const msg = `RAM elevada: ${rssMb} MB (umbral ${thresholdMb} MB) · ${guildCount} servidor(es)`;
    log.warn(`[RAM] ${msg}`);
    logSystem(getDb, 'warn', msg, {
      extra: { ramMb: rssMb, thresholdMb, guildCount, heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) },
    });
  }, intervalMs);

  log.info(`Monitor RAM cada ${intervalMs / 1000}s (umbral ${thresholdMb} MB)`);
}

module.exports = { startRamMonitor };
