/* Configuración por módulo (modales) — requiere api() y escapeHtml del dashboard */
const CONFIG_MODULES = new Set(['registro', 'kill', 'battle', 'logs', 'utilidad', 'sanciones', 'eventos']);

let modalGuildId = null;
  let channelsCache = [];
  let rolesCache = [];
  let categoriesCache = [];
  let voiceChannelsCache = [];

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

  async function ensureCategories() {
    const gid = getGuildId();
    if (!gid) return [];
    if (categoriesCache.length) return categoriesCache;
    const r = await api(`/api/guilds/${gid}/categories`);
    if (r.ok) {
      const d = await r.json();
      categoriesCache = d.categories || [];
    }
    return categoriesCache;
  }

  function categorySelect(id, value, label = 'Categoría') {
    const opts = categoriesCache
      .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === value ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');
    return `<label class="form-label">${label}<select class="form-input" id="${id}"><option value="">— Sin categoría —</option>${opts}</select></label>`;
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
    categoriesCache = [];
    voiceChannelsCache = [];
    if (!modalGuildId) return;
    if (moduleId === 'registro') return openRegistro();
    if (moduleId === 'kill') return openKill();
    if (moduleId === 'battle') return openBattle();
    if (moduleId === 'logs') return openLogs();
    if (moduleId === 'utilidad') return openUtilidad();
    if (moduleId === 'sanciones') return openSanciones();
    if (moduleId === 'eventos') return openEventos();
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

  async function openUtilidad() {
    await ensureCategories();
    const r = await api(`/api/guilds/${modalGuildId}/utc`);
    if (!r.ok) return alert('No se pudo cargar la configuración UTC');
    const cfg = await r.json();
    const mins = cfg.renameMinutes || 10;
    const active = cfg.channelId
      ? `<p class="modal-meta">Reloj activo — ID canal: <code>${escapeHtml(cfg.channelId)}</code></p>`
      : '<p class="modal-meta">No hay reloj UTC activo.</p>';
    openModal(
      'Reloj UTC',
      `<div class="modal-section">
        ${active}
        <p class="modal-meta">Crea un <strong>canal de voz</strong> cuyo nombre muestra la hora UTC. Se renombra cada ${mins} min (límite de Discord).</p>
        ${categorySelect('utc-cat', '', 'Categoría (opcional)')}
        <div class="form-actions">
          <button type="button" class="btn btn-accent" data-act="save">Crear canal reloj</button>
          <button type="button" class="btn btn-danger" data-act="clear">Quitar reloj</button>
        </div>
      </div>`,
    );
    body.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const cat = document.getElementById('utc-cat').value || null;
      const res = await api(`/api/guilds/${modalGuildId}/utc`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: true, categoryId: cat }),
      });
      if (res.ok) {
        alert('Canal de voz reloj UTC creado.');
        closeModal();
      } else alert((await res.json().catch(() => ({}))).error || 'Error');
    });
    body.querySelector('[data-act="clear"]').addEventListener('click', async () => {
      const res = await api(`/api/guilds/${modalGuildId}/utc`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: false }),
      });
      if (res.ok) {
        alert('Canal reloj UTC eliminado.');
        closeModal();
      } else alert((await res.json().catch(() => ({}))).error || 'Error');
    });
  }

  async function ensureVoiceChannels() {
    const gid = getGuildId();
    if (!gid) return [];
    if (voiceChannelsCache.length) return voiceChannelsCache;
    const r = await api(`/api/guilds/${gid}/voice-channels`);
    if (r.ok) {
      const d = await r.json();
      voiceChannelsCache = d.channels || [];
    }
    return voiceChannelsCache;
  }

  function voiceChannelSelect(id, value, label = 'Canal de voz') {
    const opts = voiceChannelsCache
      .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === value ? 'selected' : ''}>🔊 ${escapeHtml(c.name)}</option>`)
      .join('');
    return `<label class="form-label">${label}<select class="form-input" id="${id}"><option value="">— Sin canal de voz —</option>${opts}</select></label>`;
  }

  async function searchMembers(query) {
    const q = encodeURIComponent(query || '');
    const r = await api(`/api/guilds/${modalGuildId}/members?q=${q}`);
    if (!r.ok) return [];
    const d = await r.json();
    return d.members || [];
  }

  function memberAutocompleteHtml() {
    return `<div class="member-autocomplete">
      <label class="form-label">Miembro
        <input class="form-input" id="sanc-user-q" type="text" autocomplete="off" spellcheck="false" placeholder="Escribe nombre o apodo del servidor…">
        <input type="hidden" id="sanc-user-id">
      </label>
      <ul class="member-suggestions hidden" id="sanc-user-suggestions" role="listbox"></ul>
      <p class="modal-meta member-picked" id="sanc-user-picked"></p>
    </div>`;
  }

  function bindMemberAutocomplete() {
    const input = document.getElementById('sanc-user-q');
    const list = document.getElementById('sanc-user-suggestions');
    const hiddenId = document.getElementById('sanc-user-id');
    const picked = document.getElementById('sanc-user-picked');
    if (!input || !list) return;

    let timer = null;

    async function renderSuggestions(q) {
      const found = await searchMembers(q);
      if (!found.length) {
        list.innerHTML = '<li class="member-suggestion empty">Sin coincidencias en el servidor</li>';
      } else {
        list.innerHTML = found
          .map(
            (m) => {
              const label = m.displayName || m.globalName || m.username;
              return `<li class="member-suggestion" role="option" data-id="${escapeHtml(m.id)}" data-label="${escapeHtml(label)}">
                <span class="member-suggestion-name">${escapeHtml(label)}</span>
                <span class="member-suggestion-meta">${escapeHtml(m.username)}</span>
              </li>`;
            },
          )
          .join('');
      }
      list.classList.remove('hidden');
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      hiddenId.value = '';
      picked.textContent = '';
      const q = input.value.trim();
      if (q.length < 2) {
        list.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      timer = setTimeout(() => renderSuggestions(q), 280);
    });

    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (q.length >= 2 && list.innerHTML) list.classList.remove('hidden');
    });

    list.addEventListener('click', (ev) => {
      const li = ev.target.closest('.member-suggestion[data-id]');
      if (!li) return;
      hiddenId.value = li.dataset.id;
      input.value = li.dataset.label;
      picked.textContent = `✓ ${li.dataset.label}`;
      list.classList.add('hidden');
    });

    list.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
    });

    input.addEventListener('blur', () => {
      setTimeout(() => list.classList.add('hidden'), 180);
    });
  }

  async function openSanciones() {
    await ensureChannels();
    const r = await api(`/api/guilds/${modalGuildId}/sanciones`);
    if (!r.ok) return alert('No se pudo cargar sanciones');
    const data = await r.json();
    const maxS = data.maxStrikes || 3;

    const rows =
      (data.records || []).length > 0
        ? (data.records || [])
            .map(
              (u) => `<tr data-uid="${escapeHtml(u.userId)}">
          <td>${escapeHtml(u.username)}</td>
          <td><input type="number" class="form-input sanc-strikes" min="0" max="${maxS}" value="${u.strikes}" style="width:4rem"></td>
          <td><input type="number" class="form-input sanc-multas" min="0" value="${u.multas}" style="width:6rem"></td>
          <td>
            <button type="button" class="btn btn-sm btn-accent" data-act="save-user">Guardar</button>
            <button type="button" class="btn btn-sm btn-danger" data-act="reset-user">Limpiar</button>
          </td>
        </tr>`,
            )
            .join('')
        : '<tr><td colspan="4" class="modal-meta">Nadie con strikes o multas activas.</td></tr>';

    const logRows =
      (data.log || []).length > 0
        ? (data.log || [])
            .slice(0, 15)
            .map((e) => {
              const when = new Date(e.createdAt).toLocaleString('es');
              const act = e.action === 'apply' ? '➕' : '➖';
              const tipo = e.tipo === 'strike' ? 'Strike' : 'Multa';
              const reason = e.reason ? ` — ${escapeHtml(e.reason)}` : '';
              return `<li class="sanc-log-item">${act} <strong>${escapeHtml(e.username)}</strong>: ${tipo} ${e.amount}${reason} <span class="modal-meta">(${when})</span></li>`;
            })
            .join('')
        : '<li class="modal-meta">Sin movimientos recientes.</li>';

    openModal(
      'Sanciones',
      `<div class="modal-section">
        <p class="modal-meta">Canal donde el bot publica strikes y multas. Máximo ${maxS} strikes por miembro.</p>
        ${channelSelect('sanc-ch', data.channelId, 'Canal de infracciones')}
        <div class="form-actions">
          <button type="button" class="btn btn-accent" data-act="save-channel">Guardar canal</button>
        </div>
      </div>
      <div class="modal-section">
        <h3>Nueva sanción</h3>
        <div class="sanc-new-form">
          ${memberAutocompleteHtml()}
          <p class="modal-meta">Escribe al menos 2 letras; verás miembros del servidor que coincidan.</p>
          <label class="form-label">Tipo
            <select class="form-input" id="sanc-tipo">
              <option value="strike">Strike</option>
              <option value="multa">Multa</option>
            </select>
          </label>
          <label class="form-label">Cantidad<input type="number" class="form-input" id="sanc-cantidad" min="1" value="1"></label>
          <label class="form-label">Razón<input class="form-input" id="sanc-razon" placeholder="Motivo de la infracción"></label>
          <div class="form-actions">
            <button type="button" class="btn btn-accent" data-act="apply-sanc">Aplicar sanción</button>
          </div>
        </div>
      </div>
      <div class="modal-section">
        <h3>Miembros sancionados</h3>
        <label class="form-label">Razón para ajustes manuales<input class="form-input" id="sanc-edit-reason" placeholder="Usada al editar strikes/multas en la tabla"></label>
        <div class="sanciones-table-wrap">
          <table class="sanciones-table">
            <thead><tr><th>Miembro</th><th>Strikes</th><th>Multas</th><th></th></tr></thead>
            <tbody id="sanc-rows">${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="modal-section">
        <h3>Actividad reciente</h3>
        <ul class="sanc-log-list">${logRows}</ul>
      </div>`,
    );

    bindMemberAutocomplete();

    body.querySelector('[data-act="save-channel"]').addEventListener('click', async () => {
      const ch = document.getElementById('sanc-ch').value;
      if (!ch) return alert('Elige un canal de texto.');
      const res = await api(`/api/guilds/${modalGuildId}/sanciones`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: ch }),
      });
      if (res.ok) alert('Canal de sanciones guardado.');
      else alert((await res.json().catch(() => ({}))).error || 'Error');
    });

    body.querySelector('[data-act="apply-sanc"]').addEventListener('click', async () => {
      const userId = document.getElementById('sanc-user-id')?.value;
      const userLabel = document.getElementById('sanc-user-q')?.value.trim();
      const tipo = document.getElementById('sanc-tipo').value;
      const cantidad = Number(document.getElementById('sanc-cantidad').value);
      const razon = document.getElementById('sanc-razon').value.trim();
      if (!userId) return alert(userLabel ? 'Elige un miembro de la lista de sugerencias.' : 'Busca y selecciona un miembro.');
      if (!razon) return alert('Escribe la razón.');
      if (!Number.isFinite(cantidad) || cantidad <= 0) return alert('Cantidad inválida.');
      const res = await api(`/api/guilds/${modalGuildId}/sanciones/aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, tipo, cantidad, razon }),
      });
      if (res.ok) {
        alert('Sanción aplicada y publicada en Discord.');
        openSanciones();
      } else alert((await res.json().catch(() => ({}))).error || 'Error');
    });

    body.querySelector('#sanc-rows').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const tr = btn.closest('tr[data-uid]');
      if (!tr) return;
      const uid = tr.dataset.uid;
      const reason = document.getElementById('sanc-edit-reason')?.value.trim() || 'Ajuste desde el dashboard';
      if (btn.dataset.act === 'save-user') {
        const strikes = Number(tr.querySelector('.sanc-strikes').value);
        const multas = Number(tr.querySelector('.sanc-multas').value);
        const res = await api(`/api/guilds/${modalGuildId}/sanciones/users/${uid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strikes, multas, reason }),
        });
        if (res.ok) {
          alert('Registro actualizado y notificado en Discord.');
          openSanciones();
        } else alert((await res.json().catch(() => ({}))).error || 'Error');
      }
      if (btn.dataset.act === 'reset-user') {
        if (!confirm('¿Limpiar strikes y multas de este miembro? Se publicará en Discord.')) return;
        const res = await api(`/api/guilds/${modalGuildId}/sanciones/users/${uid}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          alert('Registro limpiado.');
          openSanciones();
        } else alert((await res.json().catch(() => ({}))).error || 'Error');
      }
    });
  }

  async function openEventos() {
    await ensureChannels();
    await ensureVoiceChannels();
    const r = await api(`/api/guilds/${modalGuildId}/eventos`);
    const data = r.ok ? await r.json() : { events: [] };

    const eventList =
      (data.events || []).length > 0
        ? (data.events || [])
            .map(
              (e) =>
                `<li class="sanc-log-item"><strong>${escapeHtml(e.name)}</strong> — ${escapeHtml(e.time || '')} UTC · ${escapeHtml(e.location || '')}</li>`,
            )
            .join('')
        : '<li class="modal-meta">No hay eventos activos.</li>';

    openModal(
      'Eventos',
      `<div class="modal-section">
        <p class="modal-meta">Crea un evento igual que con <code>/crear_evento</code>. La hora es en UTC (ej. 20:00).</p>
        ${channelSelect('evt-ch', '', 'Canal de publicación')}
        <label class="form-label">Nombre<input class="form-input" id="evt-name" required></label>
        <label class="form-label">Descripción<textarea class="form-input" id="evt-desc" rows="2"></textarea></label>
        <label class="form-label">Hora UTC<input class="form-input" id="evt-time" placeholder="20:00" required></label>
        <label class="form-label">Lugar<input class="form-input" id="evt-loc" placeholder="Black Zone..." required></label>
        ${voiceChannelSelect('evt-voice', '', 'Canal de voz (opcional)')}
        <label class="form-label">Color del embed<input class="form-input" id="evt-color" type="color" value="#5865f2"></label>
        <label class="form-label">Roles del evento
          <textarea class="form-input" id="evt-roles" rows="3" placeholder="Tanque:🛡️:4, Healer:🌿:3, DPS:⚔️:6"></textarea>
        </label>
        <p class="modal-meta">Formato roles: <code>Nombre:emoji:cantidad</code> separados por coma. Se añade Ausente automáticamente.</p>
        <div class="form-actions">
          <button type="button" class="btn btn-accent" data-act="create-evt">Publicar evento</button>
        </div>
      </div>
      <div class="modal-section">
        <h3>Eventos activos</h3>
        <ul class="sanc-log-list">${eventList}</ul>
      </div>`,
    );

    body.querySelector('[data-act="create-evt"]').addEventListener('click', async () => {
      const channelId = document.getElementById('evt-ch').value;
      const name = document.getElementById('evt-name').value.trim();
      const description = document.getElementById('evt-desc').value.trim();
      const time = document.getElementById('evt-time').value.trim();
      const location = document.getElementById('evt-loc').value.trim();
      const voiceChannelId = document.getElementById('evt-voice').value || null;
      const embedColor = document.getElementById('evt-color').value;
      const rolesText = document.getElementById('evt-roles').value.trim();
      if (!channelId) return alert('Elige el canal donde se publicará.');
      if (!name || !time || !location) return alert('Nombre, hora y lugar son obligatorios.');
      if (!rolesText) return alert('Define al menos un rol (ej. Tanque:🛡️:4).');
      const res = await api(`/api/guilds/${modalGuildId}/eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          name,
          description,
          time,
          location,
          voiceChannelId,
          embedColor,
          rolesText,
        }),
      });
      if (res.ok) {
        alert('Evento publicado en Discord.');
        openEventos();
      } else alert((await res.json().catch(() => ({}))).error || 'Error');
    });
  }

  return { CONFIG_MODULES, closeModal };
}
