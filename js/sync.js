// 로컬 데이터 ↔ Google Drive 동기화
import * as store from './store.js';
import * as drive from './drive.js';
import * as idb from './idb.js';

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

export function refreshStatus() {
  const meta = store.getSyncMeta();
  if (drive.hasValidToken()) {
    if (status.state === 'local' || status.state === 'auth') setStatus('synced');
  } else {
    setStatus(meta.email ? 'auth' : 'local');
  }
}

export function scheduleSync(delay = 1500) {
  if (!drive.hasValidToken()) return refreshStatus();
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
    for (const c of store.allCards()) if (c.imageFileId) c.imageFileId = null;
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
  if (!drive.hasValidToken()) return refreshStatus();
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
      if (c.deleted) {
        if (c.imageFileId) {
          await drive.trashFile(c.imageFileId);
          store.patchCard(c.id, { imageFileId: null }, 'sync');
        }
        continue;
      }
      if (c.hasImage && !c.imageFileId) {
        const cached = await idb.getImage(c.id);
        if (cached?.blob) {
          const imageId = await drive.createFile(folderId, `card_${c.id}.jpg`, cached.blob, 'image/jpeg');
          await idb.putImage(c.id, { blob: cached.blob, fileId: imageId });
          store.patchCard(c.id, { imageFileId: imageId }, 'sync');
        }
      }
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
export async function loadCardImage(card) {
  if (!card?.hasImage) return null;
  const cached = await idb.getImage(card.id);
  if (cached?.blob && (!card.imageFileId || !cached.fileId || cached.fileId === card.imageFileId)) return cached.blob;
  if (card.imageFileId && drive.hasValidToken()) {
    const blob = await drive.download(card.imageFileId);
    await idb.putImage(card.id, { blob, fileId: card.imageFileId });
    return blob;
  }
  return cached?.blob || null;
}
