/**
 * Thin API client + local persistence of the player identity.
 * The player key is a server-generated UUID kept in localStorage, which is how
 * progress survives a page reload without accounts or cookies.
 */
const API_BASE = '/api';
const KEY_STORAGE = 'photo-hunter.playerKey';
const NICK_STORAGE = 'photo-hunter.nickname';
const MUTE_STORAGE = 'photo-hunter.muted';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (networkError) {
    throw new ApiError(0, 'NETWORK', '連不上伺服器，請確認 API 正在執行。');
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error, payload?.message || `HTTP ${response.status}`);
  }
  return payload;
}

export const api = {
  health: () => request('GET', '/health'),
  createPlayer: (nickname) => request('POST', '/players', { nickname }),
  getPlayer: (key) => request('GET', `/players/${encodeURIComponent(key)}`),
  renamePlayer: (key, nickname) => request('PATCH', `/players/${encodeURIComponent(key)}`, { nickname }),
  resetPlayer: (key) => request('POST', `/players/${encodeURIComponent(key)}/reset`, {}),
  listLevels: (playerKey) => request('GET', `/levels${playerKey ? `?player=${encodeURIComponent(playerKey)}` : ''}`),
  getLevel: (id, playerKey) => request('GET', `/levels/${id}${playerKey ? `?player=${encodeURIComponent(playerKey)}` : ''}`),
  startLevel: (key, id, body = {}) => request('POST', `/players/${encodeURIComponent(key)}/levels/${id}/start`, body),
  found: (key, id, body) => request('POST', `/players/${encodeURIComponent(key)}/levels/${id}/found`, body),
  miss: (key, id, body) => request('POST', `/players/${encodeURIComponent(key)}/levels/${id}/miss`, body),
  hint: (key, id, body) => request('POST', `/players/${encodeURIComponent(key)}/levels/${id}/hint`, body),
  leaderboard: (limit = 20) => request('GET', `/leaderboard?limit=${limit}`),
  myRank: (key) => request('GET', `/players/${encodeURIComponent(key)}/rank`),
};

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode - the game still works, progress just will not persist */
  }
}

export const storage = {
  get playerKey() {
    return read(KEY_STORAGE);
  },
  set playerKey(value) {
    write(KEY_STORAGE, value);
  },
  get nickname() {
    return read(NICK_STORAGE);
  },
  set nickname(value) {
    write(NICK_STORAGE, value);
  },
  get muted() {
    return read(MUTE_STORAGE) === '1';
  },
  set muted(value) {
    write(MUTE_STORAGE, value ? '1' : '0');
  },
};
