/** Token de sesión del dashboard — localStorage + sessionStorage (móvil / cambio de vista) */
const TOKEN_KEY = 'nexus_session';

function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }
}

function setToken(token) {
  if (!token) return;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function loginBackUrl() {
  return `${location.origin}${location.pathname}`;
}

function applyTokenFromUrl(onError) {
  const p = new URLSearchParams(location.search);
  const t = p.get('token');
  const authError = p.get('auth_error');

  if (t) {
    setToken(t);
    history.replaceState({}, '', location.pathname);
    return 'token';
  }

  if (authError) {
    history.replaceState({}, '', location.pathname);
    const msg =
      authError === 'discord'
        ? 'Discord no pudo completar el inicio de sesión. Pulsa el botón e inténtalo de nuevo (no uses atrás del navegador).'
        : 'Sesión expirada. Vuelve a iniciar sesión.';
    if (typeof onError === 'function') onError(msg);
    return 'error';
  }

  return null;
}

function startLogin(apiBase) {
  const back = loginBackUrl();
  window.location.href = `${apiBase.replace(/\/$/, '')}/api/auth/login?redirect=${encodeURIComponent(back)}`;
}

window.NexusAuth = {
  TOKEN_KEY,
  getToken,
  setToken,
  clearToken,
  authHeaders,
  loginBackUrl,
  applyTokenFromUrl,
  startLogin,
};
