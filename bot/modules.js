const MODULES = [
  { id: 'registro', name: 'Registro', desc: 'Registro Albion, gremios y alianzas' },
  { id: 'kill', name: 'Killboard', desc: 'Kills y muertes en tiempo real' },
  { id: 'battle', name: 'Battle Report', desc: 'Seguimiento de batallas' },
  { id: 'mercado', name: 'Mercado', desc: 'Precios /precio' },
  { id: 'logs', name: 'Logs', desc: 'Canal de logs del servidor' },
  { id: 'moderacion', name: 'Moderación', desc: 'Warn, limpiar, autorol, etc.' },
  { id: 'eventos', name: 'Eventos', desc: 'Eventos e inscripciones' },
  { id: 'musica', name: 'Música', desc: 'Reproductor en voz' },
  { id: 'bal', name: 'Bal', desc: 'Balance virtual del gremio' },
  { id: 'utilidad', name: 'Utilidad', desc: 'UTC, ayuda, sugerencias' },
];

const COMMAND_TO_MODULE = {
  registrarse: 'registro',
  registro_manual: 'registro',
  configurar_registro: 'registro',
  informacion_gremio: 'registro',
  killboard: 'kill',
  precio: 'mercado',
  utc: 'utilidad',
  sugerencia: 'utilidad',
  ayuda: 'utilidad',
  balance: 'bal',
  cargar_balance: 'bal',
  auditoria_bal: 'bal',
  pagar: 'bal',
  seguir_batalla: 'battle',
  seguir_batalla_alianza: 'battle',
  detener_batalla: 'battle',
  play: 'musica',
  skip: 'musica',
  cola: 'musica',
  stop: 'musica',
  salir: 'musica',
  crear_evento: 'eventos',
  editar_evento: 'eventos',
  eliminar_evento: 'eventos',
  plantillas: 'eventos',
  warning: 'moderacion',
  limpiar: 'moderacion',
  autorol: 'moderacion',
  automute: 'moderacion',
  autounmute: 'moderacion',
  infoserver: 'moderacion',
  logs: 'logs',
  pausar_logs: 'logs',
};

function prefixModule(customId) {
  if (!customId) return null;
  const p = customId.split(':')[0];
  const map = {
    registro: 'registro',
    kill: 'kill',
    mercado: 'mercado',
    bal: 'bal',
    battle: 'battle',
    eventos: 'eventos',
    mod: 'moderacion',
    logs: 'logs',
  };
  return map[p] || null;
}

function moduleForInteraction(ix) {
  if (ix.isChatInputCommand()) return COMMAND_TO_MODULE[ix.commandName] || null;
  return prefixModule(ix.customId);
}

function isModuleEnabled(getDb, guildId, moduleId) {
  const row = getDb()
    .prepare('SELECT enabled FROM guild_modules WHERE guild_id = ? AND module_id = ?')
    .get(String(guildId), moduleId);
  if (!row) return true;
  return row.enabled === 1;
}

function setModuleEnabled(getDb, guildId, moduleId, enabled) {
  getDb()
    .prepare(`
      INSERT INTO guild_modules (guild_id, module_id, enabled)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id, module_id) DO UPDATE SET enabled = excluded.enabled
    `)
    .run(String(guildId), moduleId, enabled ? 1 : 0);
}

function getGuildModuleStates(getDb, guildId) {
  const rows = getDb()
    .prepare('SELECT module_id, enabled FROM guild_modules WHERE guild_id = ?')
    .all(String(guildId));
  const map = Object.fromEntries(rows.map((r) => [r.module_id, r.enabled === 1]));
  return MODULES.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.desc,
    enabled: map[m.id] !== undefined ? map[m.id] : true,
  }));
}

module.exports = {
  MODULES,
  moduleForInteraction,
  isModuleEnabled,
  setModuleEnabled,
  getGuildModuleStates,
};
