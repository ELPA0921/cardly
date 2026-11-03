// Google 로그인(Google Identity Services) + Google Drive API v3
// 권한 범위는 drive.file — 이 앱이 만든 파일/폴더에만 접근합니다.
// 앱(안드로이드)에서는 GIS 대신 네이티브 Google 권한 요청을 씁니다.
import { isNative, Native } from './native.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'bc.token';
export const DATA_FILE_NAME = 'business-cards.json';

export class AuthError extends Error {}

let tokenClient = null;
let tokenClientId = null;
let token = loadToken();

function loadToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    if (t && t.expiry > Date.now()) return t;
  } catch {}
  return null;
}

function clearToken() {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
}

export const hasValidToken = () => !!token && token.expiry > Date.now() + 30_000;

const scriptPromises = {};
export function loadScript(src) {
  scriptPromises[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => {
      delete scriptPromises[src];
      reject(new Error('스크립트를 불러오지 못했습니다: ' + src));
    };
    document.head.appendChild(s);
  });
  return scriptPromises[src];
}

function saveToken(accessToken, expiresInSec = 3600) {
  token = { access_token: accessToken, expiry: Date.now() + expiresInSec * 1000 - 60_000 };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  return token;
}

// 앱: 안드로이드 Google 계정으로 Drive 권한을 받습니다. 이미 허용했으면 화면 없이 새 토큰을 줍니다.
async function nativeAuthorize(interactive) {
  const res = await Native.authorize({ scopes: [SCOPE], interactive });
  if (!res?.accessToken) throw new Error('Google 권한을 받지 못했습니다.');
  return saveToken(res.accessToken, 50 * 60);
}

// 앱에서 토큰이 만료되면 사용자에게 묻지 않고 다시 받아옵니다. (웹에서는 항상 false)
export async function refreshSilently() {
  if (!isNative) return false;
  try {
    await nativeAuthorize(false);
    return true;
  } catch {
    return false;
  }
}

// 로그인 버튼을 누를 때 팝업이 차단되지 않도록 미리 불러둡니다.
export async function prepare(clientId) {
  if (isNative) return;
  if (!clientId) throw new Error('Google OAuth 클라이언트 ID가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
  await loadScript(GIS_SRC);
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
    tokenClientId = clientId;
  }
}

export async function signIn(clientId, { hint } = {}) {
  if (isNative) return nativeAuthorize(true);
  await prepare(clientId);
  return new Promise((resolve, reject) => {
    tokenClient.callback = resp => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      resolve(saveToken(resp.access_token, Number(resp.expires_in) || 3600));
    };
    tokenClient.error_callback = err =>
      reject(new Error(err?.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : err?.message || '로그인에 실패했습니다.'));
    tokenClient.requestAccessToken({ prompt: '', login_hint: hint || undefined });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) {
    try { google.accounts.oauth2.revoke(token.access_token, () => {}); } catch {}
  }
  clearToken();
}

async function gfetch(url, opts = {}, retried = false) {
  if (!hasValidToken() && !(await refreshSilently())) throw new AuthError('Google 로그인이 필요합니다.');
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token.access_token },
  });
  if (res.status === 401) {
    clearToken();
    if (!retried && (await refreshSilently())) return gfetch(url, opts, true);
    throw new AuthError('Google 로그인이 만료되었습니다.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Google Drive 오류 (${res.status}) ${text.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function getUser() {
  const res = await gfetch(`${API}/about?fields=user(displayName,emailAddress)`);
  return (await res.json()).user;
}

async function findOne(query) {
  const params = new URLSearchParams({ q: query, fields: 'files(id,name,modifiedTime)', spaces: 'drive', pageSize: '10', orderBy: 'modifiedTime desc' });
  const res = await gfetch(`${API}/files?${params}`);
  return (await res.json()).files?.[0] || null;
}

export async function ensureFolder(name) {
  const found = await findOne(`name='${q(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  if (found) return found.id;
  const res = await gfetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (await res.json()).id;
}

export async function folderExists(folderId) {
  try {
    const res = await gfetch(`${API}/files/${folderId}?fields=id,trashed`);
    return !(await res.json()).trashed;
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

export const findDataFile = folderId =>
  findOne(`name='${DATA_FILE_NAME}' and '${folderId}' in parents and trashed=false`);

export async function readJson(fileId) {
  const res = await gfetch(`${API}/files/${fileId}?alt=media`);
  return res.json();
}

export async function createFile(folderId, name, blob, mimeType) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId], mimeType })], { type: 'application/json' }));
  form.append('file', blob);
  const res = await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form });
  return (await res.json()).id;
}

export async function updateFile(fileId, blob) {
  await gfetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
}

export async function download(fileId) {
  const res = await gfetch(`${API}/files/${fileId}?alt=media`);
  return res.blob();
}

// 완전 삭제 대신 휴지통으로 이동 (Drive에서 복구 가능)
export async function trashFile(fileId) {
  try {
    await gfetch(`${API}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  } catch (e) {
    if (e.status !== 404) throw e;
  }
}
