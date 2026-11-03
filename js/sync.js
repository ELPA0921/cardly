// 로컬 데이터 ↔ Google Drive 동기화
import * as store from './store.js';
import * as drive from './drive.js';
import * as idb from './idb.js';
import { isNative } from './native.js';

// state: local(미연결) | auth(재연결 필요) | syncing | synced | offline | error
let status = { state: 'local', message: '', lastSync: store.getSyncMeta().lastSync || 0 };
const listeners = new Set();
let running = false;
let again = false;
let timer = null;

export const getStatus = () => status;
export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(state, message = '') {
  status = { ...status, state, message };
  if (state === 'synced') status.lastSync = Date.now();
  listeners.forEach(fn => fn(status));
}

// 앱은 토큰이 만료돼도 화면 없이 다시 받을 수 있으므로, 한 번 연결했으면 연결된 것으로 봅니다.
const connected = () => drive.hasValidToken() || (isNative && !!store.getSyncMeta().email);

export function refreshStatus() {
  const meta = store.getSyncMeta();
  if (connected()) {
    if (status.state === 'local' || status.state === 'auth') setStatus('synced');
  } else {
    setStatus(meta.email ? 'auth' : 'local');
  }
}

export function scheduleSync(delay = 1500) {
  if (!connected()) return refreshStatus();
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function connect() {
  const settings = store.getSettings();
  const meta = store.getSyncMeta();
  await drive.signIn(settings.googleClientId, { hint: meta.email });
  const user = await drive.getUser();
  if (meta.email && meta.email !== user.emailAddress) {
    // 다른 계정으로 연결 → 폴더 정보 초기화, 이전 계정의 이미지 ID는 사용할 수 없음
    store.clearSyncMeta();
    for (const c of store.allCards()) {
      const photos = store.photosOf(c);
      if (photos.some(p => p.fileId)) store.patchCard(c.id, { photos: photos.map(p => ({ ...p, fileId: null })) }, 'sync');
    }
  }
  store.setSyncMeta({ email: user.emailAddress, displayName: user.displayName });
  await syncNow();
  return user;
}

export function disconnect() {
  drive.signOut();
  store.clearSyncMeta();
  setStatus('local');
}

export async function syncNow() {
  clearTimeout(timer);
  if (running) {
    again = true;
    return;
  }
  if (!connected()) return refreshStatus();
  if (!navigator.onLine) return setStatus('offline', '오프라인 상태입니다.');

  running = true;
  setStatus('syncing');
  try {
    const settings = store.getSettings();
    let meta = store.getSyncMeta();

    let folderId = meta.folderId;
    if (!folderId || !(await drive.folderExists(folderId))) {
      folderId = await drive.ensureFolder(settings.driveFolderName);
      store.setSyncMeta({ folderId, dataFileId: null });
      meta = store.getSyncMeta();
    }

    let fileId = meta.dataFileId || (await drive.findDataFile(folderId))?.id || null;
    if (fileId) {
      try {
        store.merge(await drive.readJson(fileId));
      } catch (e) {
        if (e.status !== 404) throw e;
        fileId = null;
      }
    }

    // 사진 업로드 / 삭제된 명함의 사진 정리
    for (const c of [...store.allCards()]) {
      const photos = store.photosOf(c);
      if (c.deleted) {
        const uploaded = photos.filter(p => p.fileId);
        if (uploaded.length) {
          for (const p of uploaded) await drive.trashFile(p.fileId);
          store.patchCard(c.id, { photos: [] }, 'sync');
        }
        continue;
      }
      if (!photos.some(p => !p.fileId)) continue;
      const next = [];
      for (const p of photos) {
        const cached = !p.fileId && (await idb.getImage(p.id));
        if (!cached?.blob) {
          next.push(p);
          continue;
        }
        const fileId = await drive.createFile(folderId, `card_${p.id}.jpg`, cached.blob, 'image/jpeg');
        await idb.putImage(p.id, { blob: cached.blob, fileId });
        next.push({ ...p, fileId });
      }
      store.patchCard(c.id, { photos: next }, 'sync');
    }
    for (const id of store.pendingDeletes()) {
      await drive.trashFile(id);
      store.removePendingDelete(id);
    }

    const json = new Blob([JSON.stringify(store.snapshot())], { type: 'application/json' });
    if (fileId) await drive.updateFile(fileId, json);
    else fileId = await drive.createFile(folderId, drive.DATA_FILE_NAME, json, 'application/json');

    store.setSyncMeta({ folderId, dataFileId: fileId, lastSync: Date.now() });
    setStatus('synced');
  } catch (e) {
    console.error('[sync]', e);
    if (e instanceof drive.AuthError) setStatus('auth', e.message);
    else setStatus('error', e.message);
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(300);
    }
  }
}

// 명함 사진 가져오기: 로컬 캐시 → 없으면 Drive에서 내려받아 캐시
export async function loadPhoto(photo) {
  if (!photo) return null;
  const cached = await idb.getImage(photo.id);
  if (cached?.blob && (!photo.fileId || !cached.fileId || cached.fileId === photo.fileId)) return cached.blob;
  if (photo.fileId && connected()) {
    const blob = await drive.download(photo.fileId);
    await idb.putImage(photo.id, { blob, fileId: photo.fileId });
    return blob;
  }
  return cached?.blob || null;
}
