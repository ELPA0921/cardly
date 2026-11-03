// 명함 사진 캐시 (IndexedDB)
// 값 형태: { blob: Blob, fileId: string|null }  — fileId는 Drive에 올라간 파일 ID
const DB_NAME = 'bc-db';
const STORE = 'images';
let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const getImage = key => run('readonly', s => s.get(key));
export const putImage = (key, value) => run('readwrite', s => s.put(value, key));
export const deleteImage = key => run('readwrite', s => s.delete(key));
export const clearImages = () => run('readwrite', s => s.clear());
