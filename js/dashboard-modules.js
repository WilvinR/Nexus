/* Configuración por módulo (modales) — requiere api() y escapeHtml del dashboard */
const CONFIG_MODULES = new Set(['registro', 'kill', 'battle', 'logs']);

let modalGuildId = null;
let channelsCache = [];
let rolesCache = [];

function initModuleModals(deps) {
  const { api, escapeHtml, getGuildId } = deps;
  const backdrop = document.getElementById('modal-backdrop');
  const body = document.getElementById('modal-body');
  const titleEl = document.getElementById('modal-title');

  document.getElementById('modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  function closeModal() {
    backdrop.classList.add('hidden');
    body.innerHTML = '';
    modalGuildId = null;
  }

  function openModal(title, html) {
    titleEl.textContent = title;
    body.innerHTML = html;
    backdrop.classList.remove('hidden');
  }

  async function ensureChannels() {
    const gid = getGuildId();
    if (!gid) return [];
    if (channelsCache.length) return channelsCache;
    const r = await api(`/api/guilds/${gid}/channels`);
    if (r.ok) {
      const d = await r.json();
      channelsCache = d.channels || [];
    }
    return channelsCache;
  }

  async function ensureRoles() {
    const gid = getGuildId();
    if (!gid) return [];
    if (rolesCache.length) return rolesCache;
    const r = await api(`/api/guilds/${gid}/roles`);
    if (r.ok) {
      const d = await r.json();
      rolesCache = d.roles || [];
    }
    return rolesCache;
  }

  function channelSelect(id, value, label = 'Canal') {
    const opts = channelsCache
      .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === value ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
      .join('');
    return `<label class="form-label">${label}<select class="form-input" id="${id}"><option value="">— Elegir —</option>${opts}</select></label>`;
  }

  function roleSelect(id, value) {
    const opts = rolesCache
      .map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === value ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)
      .join('');
    return `<label class="form-label">Rol de Discord<select class="form-input" id="${id}"><option value="">— Elegir —</option>${opts}</select></label>`;
  }

  function capsule(name, rowId) {
    return `<div class="capsule">
      <span class="capsule-name">${escapeHtml(name)}</span>
      <button type="button" class="icon-btn" data-act="edit" data-id="${rowId}" title="Editar">✏️</button>
      <button type="button" class="icon-btn" data-act="del" data-id="${rowId}" title="Eliminar">❌</button>
    </div>`;
  }

  function formActions(showDelete) {
    return `<div class="form-actions">
      <button type="button" class="btn btn-accent" data-act="save">Guardar</button>
      <button type="button" class="btn" data-act="cancel">Cancelar</button>
      ${showDelete ? '<button type="button" class="btn btn-danger" data-act="delete">Eliminar</button>' : ''}
    </div>`;
  }

  window.openModuleConfig = async (moduleId) => {
    modalGuildId = getGuildId();
    channelsCache = [];
    rolesCache = [];
    if (!modalGuildId) return;
    if (moduleId === 'registro') return openRegistro();
    if (moduleId === 'kill') return openKill();
    if (moduleId === 'battle') return openBattle();
    if (moduleId === 'logs') return openLogs();
  };

  async function openRegistro() {
    const r = await api(`/api/guilds/${modalGuildId}/registro`);
    if (!r.ok) return alert('No se pudo cargar registro');
    const d = await r.json();
    await ensureRoles();

    function renderMain() {
      let html = '<div class="modal-section"><h3>Gremio principal</h3>';
      if (d.principal) {
        const n = `${d.principal.nickname_tag} ${d.principal.albion_guild_name || d.principal.albion_guild_id}`;
        html += capsule(n, d.principal.id);
      } else {
        html += '<button type="button" class="btn btn-accent btn-sm" data-reg="add-principal">+ Añadir Gremio Principal</button>';
      }
      html += '</div><div class="modal-section"><h3>Alianza</h3>';
      if (d.alliance) {
        html += `<p class="modal-meta">Alianza: <strong>${escapeHtml(d.alliance.albion_alliance_name || d.alliance.albion_alliance_id)}</strong></p>`;
      }
      for (const g of d.allianceGuilds || []) {
        const n = `${g.nickname_tag} ${g.albion_guild_name || g.albion_guild_id}`;
        html += capsule(n, g.id);
      }
      html += '<button type="button" class="btn btn-accent btn-sm" data-reg="add-alliance">+ Añadir Gremio a la Alianza</button></div>';
      html += '<div id="registro-form-slot"></div>';
      openModal('Registro', html);
      bindRegistroMain(d);
    }

    function guildForm(mode, row) {
      const isEdit = !!row;
      return `<div class="sub-form">
        <h4>${isEdit ? 'Editar gremio' : mode === 'principal' ? 'Gremio principal' : 'Gremio de alianza'}</h4>
        <label class="form-label">Nombre del gremio<input class="form-input" id="rf-name" value="${escapeHtml(row?.albion_guild_name || '')}"></label>
        <label class="form-label">ID del gremio en Albion<input class="form-input" id="rf-id" value="${escapeHtml(row?.albion_guild_id || '')}"></label>
        ${roleSelect('rf-role', row?.role_id || '')}
        <label class="form-label">Tag (ej. [LCDS])<input class="form-input" id="rf-tag" value="${escapeHtml(row?.nickname_tag || '')}"></label>
        ${formActions(isEdit)}
      </div>`;
    }

    function bindRegistroMain(data) {
      const slot = document.getElementById('registro-form-slot');
      body.querySelector('[data-reg="add-principal"]')?.addEventListener('click', () => {
        slot.innerHTML = guildForm('principal');
        bindGuildForm('principal', null, data, renderMain);
      });
      body.querySelector('[data-reg="add-alliance"]')?.addEventListener('click', async () => {
        if (!data.alliance) {
          const aid = prompt('ID de la alianza en Albion (si el gremio ya está en una alianza, se detectará al guardar):');
          if (aid) {
            await api(`/api/guilds/${modalGuildId}/registro/alliance`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ albionAllianceId: aid.trim() }),
            });
            const r2 = await api(`/api/guilds/${modalGuildId}/registro`);
            if (r2.ok) Object.assign(data, await r2.json());
          }
        }
        slot.innerHTML = guildForm('alliance');
        bindGuildForm('alliance', null, data, renderMain);
      });
      body.querySelectorAll('[data-act="edit"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.id);
          const row =
            data.principal?.id === id
              ? data.principal
              : (data.allianceGuilds || []).find((g) => g.id === id);
          if (!row) return;
          const mode = row.registro_mode === 'alliance' ? 'alliance' : 'principal';
          slot.innerHTML = guildForm(mode, row);
          bindGuildForm(mode, row, data, renderMain);
        });
      });
      body.querySelectorAll('[data-act="del"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar este gremio de la configuración?')) return;
          await api(`/api/guilds/${modalGuildId}/registro/guilds/${btn.dataset.id}`, { method: 'DELETE' });
          const r2 = await api(`/api/guilds/${modalGuildId}/registro`);
          if (r2.ok) Object.assign(data, await r2.json());
          renderMain();
        });
      });
    }

    function bindGuildForm(mode, row, data, refresh) {
      const slot = document.getElementById('registro-form-slot');
      slot.querySelector('[data-act="cancel"]').addEventListener('click', () => {
        slot.innerHTML = '';
      });
      slot.querySelector('[data-act="save"]')?.addEventListener('click', async () => {
        const payload = {
          guildName: document.getElementById('rf-name').value.trim(),
          albionGuildId: document.getElementById('rf-id').value.trim(),
          nicknameTag: document.getElementById('rf-tag').value.trim(),
          roleId: document.getElementById('rf-role').value,
        };
        let res;
        if (row) {
          res = await api(`/api/guilds/${modalGuildId}/registro/guilds/${row.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else if (mode === 'principal') {
          res = await api(`/api/guilds/${modalGuildId}/registro/principal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await api(`/api/guilds/${modalGuildId}/registro/alliance-guild`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Error al guardar');
          return;
        }
        const r2 = await api(`/api/guilds/${modalGuildId}/registro`);
        if (r2.ok) Object.assign(data, await r2.json());
        refresh();
      });
      slot.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        if (!row || !confirm('¿Eliminar?')) return;
        await api(`/api/guilds/${modalGuildId}/registro/guilds/${row.id}`, { method: 'DELETE' });
        const r2 = await api(`/api/guilds/${modalGuildId}/registro`);
        if (r2.ok) Object.assign(data, await r2.json());
        refresh();
      });
    }

    renderMain();
  }

  async function openKill() {
    await ensureChannels();
    const r = await api(`/api/guilds/${modalGuildId}/kill/entities`);
    if (!r.ok) return alert('Error killboard');
    const { entities } = await r.json();

    function render() {
      let html = '<div class="modal-section"><h3>Gremios en seguimiento</h3>';
      for (const e of entities) {
        html += capsule(`${e.name} (${e.entityType})`, e.id);
      }
      html += '<button type="button" class="btn btn-accent btn-sm" data-kill="add">+ Añadir Gremio al Seguimiento</button>';
      html += '<div id="kill-form-slot"></div></div>';
      openModal('Killboard', html);
      body.querySelector('[data-kill="add"]')?.addEventListener('click', () => showKillForm(null, render));
      body.querySelectorAll('[data-act="edit"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const e = entities.find((x) => String(x.id) === btn.dataset.id);
          if (e) showKillForm(e, render);
        });
      });
      body.querySelectorAll('[data-act="del"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Dejar de monitorear?')) return;
          await api(`/api/guilds/${modalGuildId}/kill/entities/${btn.dataset.id}`, { method: 'DELETE' });
          const r2 = await api(`/api/guilds/${modalGuildId}/kill/entities`);
          if (r2.ok) entities.length = 0, entities.push(...(await r2.json()).entities);
          render();
        });
      });
    }

    function showKillForm(row, refresh) {
      const slot = document.getElementById('kill-form-slot');
      slot.innerHTML = `<div class="sub-form">
        <h4>${row ? 'Editar' : 'Añadir'} seguimiento</h4>
        <label class="form-label">Nombre<input class="form-input" id="kf-name" value="${escapeHtml(row?.name || '')}"></label>
        <label class="form-label">ID Albion<input class="form-input" id="kf-id" value="${escapeHtml(row?.albionEntityId || '')}"></label>
        ${channelSelect('kf-ch', row?.killChannelId, 'Canal de kills')}
        ${formActions(!!row)}
      </div>`;
      slot.querySelector('[data-act="cancel"]').onclick = () => {
        slot.innerHTML = '';
      };
      slot.querySelector('[data-act="save"]').onclick = async () => {
        const payload = {
          name: document.getElementById('kf-name').value.trim(),
          albionEntityId: document.getElementById('kf-id').value.trim(),
          killChannelId: document.getElementById('kf-ch').value,
          entityType: 'guild',
        };
        const res = row
          ? await api(`/api/guilds/${modalGuildId}/kill/entities/${row.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await api(`/api/guilds/${modalGuildId}/kill/entities`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
        if (!res.ok) {
          alert((await res.json().catch(() => ({}))).error || 'Error');
          return;
        }
        const r2 = await api(`/api/guilds/${modalGuildId}/kill/entities`);
        if (r2.ok) {
          const d = await r2.json();
          entities.length = 0;
          entities.push(...d.entities);
        }
        refresh();
      };
      slot.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        await api(`/api/guilds/${modalGuildId}/kill/entities/${row.id}`, { method: 'DELETE' });
        const r2 = await api(`/api/guilds/${modalGuildId}/kill/entities`);
        if (r2.ok) {
          entities.length = 0;
          entities.push(...(await r2.json()).entities);
        }
        refresh();
      });
    }

    render();
  }

  async function openBattle() {
    await ensureChannels();
    const r = await api(`/api/guilds/${modalGuildId}/battle/tracking`);
    if (!r.ok) return alert('Error battle');
    const { tracks } = await r.json();

    function render() {
      let html = '<div class="modal-section"><h3>Seguimiento de batallas</h3>';
      for (const t of tracks) {
        const label = `${t.trackType === 'alliance' ? '🌐' : '🏰'} ${t.label || t.albionGuildId}`;
        html += capsule(label, t.id);
      }
      html += '<button type="button" class="btn btn-accent btn-sm" data-bat="add">+ Añadir Seguimiento de Batalla</button>';
      html += '<div id="bat-form-slot"></div></div>';
      openModal('Battle Report', html);
      body.querySelector('[data-bat="add"]')?.addEventListener('click', () => showBatForm(null, render));
      body.querySelectorAll('[data-act="edit"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const t = tracks.find((x) => String(x.id) === btn.dataset.id);
          if (t) showBatForm(t, render);
        });
      });
      body.querySelectorAll('[data-act="del"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await api(`/api/guilds/${modalGuildId}/battle/tracking/${btn.dataset.id}`, { method: 'DELETE' });
          const r2 = await api(`/api/guilds/${modalGuildId}/battle/tracking`);
          if (r2.ok) tracks.length = 0, tracks.push(...(await r2.json()).tracks);
          render();
        });
      });
    }

    function showBatForm(row, refresh) {
      const slot = document.getElementById('bat-form-slot');
      slot.innerHTML = `<div class="sub-form">
        <h4>${row ? 'Editar' : 'Añadir'} seguimiento</h4>
        <label class="form-label">Tipo
          <select class="form-input" id="bf-type">
            <option value="guild">Gremio</option>
            <option value="alliance">Alianza</option>
          </select>
        </label>
        <label class="form-label">Nombre (opcional)<input class="form-input" id="bf-name"></label>
        <label class="form-label">ID Albion (gremio)<input class="form-input" id="bf-id" value="${escapeHtml(row?.albionGuildId || '')}"></label>
        ${channelSelect('bf-ch', row?.channelId, 'Canal de reportes')}
        <div class="form-actions">
          <button type="button" class="btn btn-accent" data-act="save">Guardar</button>
          <button type="button" class="btn" data-act="cancel">Cancelar</button>
        </div>
      </div>`;
      if (row?.trackType) document.getElementById('bf-type').value = row.trackType;
      slot.querySelector('[data-act="cancel"]').onclick = () => {
        slot.innerHTML = '';
      };
      slot.querySelector('[data-act="save"]').onclick = async () => {
        const payload = {
          albionGuildId: document.getElementById('bf-id').value.trim(),
          channelId: document.getElementById('bf-ch').value,
          trackType: document.getElementById('bf-type').value,
        };
        const res = row
          ? await api(`/api/guilds/${modalGuildId}/battle/tracking/${row.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channelId: payload.channelId, albionGuildId: payload.albionGuildId }),
            })
          : await api(`/api/guilds/${modalGuildId}/battle/tracking`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
        if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Error');
        else {
          const r2 = await api(`/api/guilds/${modalGuildId}/battle/tracking`);
          if (r2.ok) {
            tracks.length = 0;
            tracks.push(...(await r2.json()).tracks);
          }
          refresh();
        }
      };
    }

    render();
  }

  async function openLogs() {
    await ensureChannels();
    const r = await api(`/api/guilds/${modalGuildId}/logs`);
    if (!r.ok) return alert('Error logs');
    const cfg = await r.json();
    openModal(
      'Logs',
      `<div class="modal-section">
        ${channelSelect('log-ch', cfg.channelId, 'Canal de logs')}
        <div class="form-actions">
          <button type="button" class="btn btn-accent" data-act="save">Guardar</button>
        </div>
      </div>`,
    );
    body.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const ch = document.getElementById('log-ch').value;
      const res = await api(`/api/guilds/${modalGuildId}/logs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: ch || null }),
      });
      if (res.ok) {
        alert('Canal de logs guardado.');
        closeModal();
      } else alert((await res.json().catch(() => ({}))).error || 'Error');
    });
  }

  return { CONFIG_MODULES, closeModal };
}
