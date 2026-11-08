// Talking to the backend. Same origin only: the Vite proxy (or FastAPI itself) serves both.

const BASE = '/api/v1';
const OFFLINE = 'The save server is not running. You can keep playing, but nothing can be saved or loaded until it starts.';

export class ApiError extends Error {
  // retryable: the server could not be reached or failed, or the player is signed out; anything else means the request itself was refused
  constructor(message, retryable, status = 0) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

// Sent on the window when the session runs out or is ended elsewhere, so the login page can come back over the game.
// Other /auth routes answer 401 for a wrong password, which does not mean the session is gone.
export const SIGNED_OUT = 'siteguard:signed-out';

const REFUSED = { 404: 'That no longer exists.', 413: 'That is too large to save.', 422: 'The server refused that as invalid.' };

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(OFFLINE, true);
  }
  if (res.status >= 500) throw new ApiError(OFFLINE, true); // the dev proxy answers with a 5xx when the backend is down
  if (!res.ok) {
    if (res.status === 401 && (path === '/auth/me' || !path.startsWith('/auth/'))) globalThis.dispatchEvent?.(new Event(SIGNED_OUT));
    // the server's own words for a sign-in refusal or a lockout; it never echoes input back, so they are safe to show
    const detail = await res.json().then((b) => b?.detail, () => null);
    const message = REFUSED[res.status] || (typeof detail === 'string' && detail) || `The server refused that (${res.status}).`;
    throw new ApiError(message, res.status === 401, res.status); // signed out: a run waits in this browser until someone signs in
  }
  if (res.status === 204) return null;
  // the connection can still drop while the answer arrives, and then nobody knows whether the request worked
  try { return await res.json(); } catch { throw new ApiError(OFFLINE, true); }
}

const resource = (path) => ({
  list: () => request('GET', path),
  get: (id) => request('GET', `${path}/${id}`),
  create: (body) => request('POST', path, body),
  remove: (id) => request('DELETE', `${path}/${id}`),
});

export const createApi = () => ({
  laydowns: { ...resource('/laydowns'), replace: (id, body) => request('PUT', `/laydowns/${id}`, body) },
  figureSets: resource('/figure-sets'),
  packs: { list: () => request('GET', '/packs'), downloads: () => request('GET', '/packs/downloads'), buildStatus: () => request('GET', '/packs/build'), build: (body) => request('POST', '/packs/build', body) },
  runs: { ...resource('/runs'), page: (limit, offset) => request('GET', `/runs?limit=${limit}&offset=${offset}`) },
  units: { ...resource('/units'), replace: (id, body) => request('PUT', `/units/${id}`, body) },
  auth: {
    health: () => request('GET', '/health'),
    me: () => request('GET', '/auth/me'),
    register: (body) => request('POST', '/auth/register', body),
    signIn: (body) => request('POST', '/auth/sign-in', body),
    signOut: () => request('POST', '/auth/sign-out', {}),
    reset: (body) => request('POST', '/auth/reset', body),
    updateProfile: (body) => request('PUT', '/auth/me', body),
    changePassword: (body) => request('POST', '/auth/password', body),
    newRecoveryCode: (body) => request('POST', '/auth/recovery-code', body),
    deleteAccount: (body) => request('POST', '/auth/delete-account', body),
  },
});
