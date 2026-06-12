const { logSystem } = require('./adminRoutes');
const { collectSnapshot, formatSummary } = require('./memoryDiagnostics');

function startRamMonitor(client, getDb, log) {
  const thresholdMb = Math.max(64, parseInt(process.env.RAM_WARN_MB || '400', 10) || 400);
  const intervalMs = Math.max(15_000, parseInt(process.env.RAM_CHECK_MS || '60000', 10) || 60_000);
  let lastWarnAt = 0;

  setInterval(() => {
    const snapshot = collectSnapshot(client, getDb);
    const { rssMb } = snapshot.memory;

    if (rssMb < thresholdMb) return;

    const now = Date.now();
    if (now - lastWarnAt < intervalMs) return;
    lastWarnAt = now;

    const msg = `RAM elevada: ${formatSummary(snapshot)}`;
    log.warn(`[RAM] ${msg}`);
    logSystem(getDb, 'warn', msg, {
      extra: { ...snapshot, thresholdMb },
    });
  }, intervalMs);

  log.info(`Monitor RAM cada ${intervalMs / 1000}s (umbral ${thresholdMb} MB) — con diagnóstico de causas`);
}

module.exports = { startRamMonitor, collectSnapshot };
