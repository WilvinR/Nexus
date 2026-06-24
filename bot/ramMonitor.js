const { logSystem } = require('./adminRoutes');
const { collectSnapshot, formatSummary } = require('./memoryDiagnostics');

function startRamMonitor(client, getDb, log) {
  const thresholdMb = Math.max(64, parseInt(process.env.RAM_WARN_MB || '400', 10) || 400);
  const checkMs = Math.max(30_000, parseInt(process.env.RAM_CHECK_MS || '60000', 10) || 60_000);
  const warnMinMs = Math.max(
    checkMs,
    parseInt(process.env.RAM_WARN_MS || '300000', 10) || 300_000,
  );
  const jumpMb = Math.max(10, parseInt(process.env.RAM_WARN_JUMP_MB || '35', 10) || 35);
  const dbLogIntervalMs = Math.max(
    3600_000,
    parseInt(process.env.RAM_DB_LOG_MS || '21600000', 10) || 21_600_000,
  );
  let lastWarnAt = 0;
  let lastWarnRss = 0;
  let lastDbLogAt = 0;

  setInterval(() => {
    const snapshot = collectSnapshot(client, getDb);
    const { rssMb } = snapshot.memory;

    if (rssMb < thresholdMb) {
      lastWarnRss = rssMb;
      return;
    }

    const now = Date.now();
    const jumped = lastWarnRss > 0 && rssMb - lastWarnRss >= jumpMb;
    if (now - lastWarnAt < warnMinMs && !jumped) return;
    lastWarnAt = now;
    lastWarnRss = rssMb;

    const msg = `RAM elevada: ${formatSummary(snapshot)}`;
    log.warn(`[RAM] ${msg}`);

    if (now - lastDbLogAt >= dbLogIntervalMs) {
      lastDbLogAt = now;
      logSystem(getDb, 'warn', msg, {
        extra: {
          rssMb: snapshot.memory.rssMb,
          heapMb: snapshot.memory.heapMb,
          arrayBuffersMb: snapshot.memory.arrayBuffersMb,
          suspects: snapshot.suspects?.slice(0, 3)?.map((s) => s.label),
        },
      });
    }
  }, checkMs);

  log.info(
    `Monitor RAM: revisión cada ${checkMs / 1000}s, aviso cada ${warnMinMs / 1000}s o +${jumpMb} MB (umbral ${thresholdMb} MB)`,
  );
}

module.exports = { startRamMonitor, collectSnapshot };
