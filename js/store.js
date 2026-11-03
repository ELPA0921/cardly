// 로컬 데이터 저장소 (localStorage) + Google Drive 데이터와의 병합
import { DEFAULT_CONFIG } from './config.js';
import { FIELD_KEYS } from './fields.js';

const DATA_KEY = 'bc.data.v1';
const SETTINGS_KEY = 'bc.settings.v1';
const SYNC_KEY = 'bc.sync.v1';
const PENDING_KEY = 'bc.pendingDeletes.v1';
const UI_KEY = 'bc.ui.v1';

export const GROUP_COLORS = ['#2459e0', '#1f9d5c', '#d97706', '#d63c3c', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

function normalize(d) {
  const out = { version: 1, cards: [], groups: [], updatedAt: 0 };
  if (d && typeof d === 'object') {
    out.cards = Array.isArray(d.cards) ? d.cards.filter(c => c && c.id) : [];
    out.groups = Array.isArray(d.groups) ? d.groups.filter(g => g && g.id) : [];
    out.updatedAt = d.updatedAt || 0;
  }
  return out;
}

let data = normalize(readJson(DATA_KEY, null));
const listeners = new Set();

function commit(source = 'local') {
  data.updatedAt = Date.now();
  writeJson(DATA_KEY, data);
  listeners.forEach(fn => fn(source));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- 명함 ----------
export function emptyCard() {
  const card = { groupIds: [], favorite: false, hasImage: false, imageFileId: null, ocrText: '' };
  FIELD_KEYS.forEach(k => (card[k] = ''));
  return card;
}

export const cards = () => data.cards.filter(c => !c.deleted);
export const allCards = () => data.cards;
export const getCard = id => data.cards.find(c => c.id === id && !c.deleted) || null;

export function saveCard(input) {
  const now = Date.now();
  let card = data.cards.find(c => c.id === input.id);
  if (card && !card.deleted) {
    Object.assign(card, input, { updatedAt: now });
  } else {
    card = { ...emptyCard(), ...input, id: input.id || uid(), createdAt: now, updatedAt: now };
    delete card.deleted;
    data.cards = data.cards.filter(c => c.id !== card.id);
    data.cards.push(card);
  }
  commit();
  return card;
}

export function patchCard(id, patch, source = 'local') {
  const card = data.cards.find(c => c.id === id);
  if (!card) return;
  Object.assign(card, patch, { updatedAt: Date.now() });
  commit(source);
}

// 삭제는 다른 기기와 동기화할 수 있도록 흔적(tombstone)만 남깁니다.
export function deleteCard(id) {
  const i = data.cards.findIndex(c => c.id === id);
  if (i < 0) return;
  const c = data.cards[i];
  data.cards[i] = { id, deleted: true, imageFileId: c.imageFileId || null, updatedAt: Date.now() };
  commit();
}

// ---------- 그룹 ----------
export const groups = () =>
  data.groups.filter(g => !g.deleted).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
export const getGroup = id => data.groups.find(g => g.id === id && !g.deleted) || null;

export function addGroup(name) {
  const now = Date.now();
  const color = GROUP_COLORS[groups().length % GROUP_COLORS.length];
  const group = { id: uid(), name: name.trim(), color, createdAt: now, updatedAt: now };
  data.groups.push(group);
  commit();
  return group;
}

export function updateGroup(id, patch) {
  const g = data.groups.find(x => x.id === id);
  if (!g) return;
  Object.assign(g, patch, { updatedAt: Date.now() });
  commit();
}

export function deleteGroup(id) {
  const now = Date.now();
  const i = data.groups.findIndex(g => g.id === id);
  if (i < 0) return;
  data.groups[i] = { id, deleted: true, updatedAt: now };
  // 명함은 그대로 두고 그룹 지정만 해제
  for (const c of data.cards) {
    if (!c.deleted && c.groupIds?.includes(id)) {
      c.groupIds = c.groupIds.filter(x => x !== id);
      c.updatedAt = now;
    }
  }
  commit();
}

// ---------- 동기화 ----------
// 항목별(id) 최신 수정 시각이 이기는 방식으로 병합
export function merge(remote, source = 'sync') {
  if (!remote) return false;
  const r = normalize(remote);
  let changed = false;
  const mergeList = (localList, remoteList) => {
    const map = new Map(localList.map(x => [x.id, x]));
    for (const item of remoteList) {
      const cur = map.get(item.id);
      if (!cur || (item.updatedAt || 0) > (cur.updatedAt || 0)) {
        map.set(item.id, item);
        changed = true;
      }
    }
    return [...map.values()];
  };
  data.cards = mergeList(data.cards, r.cards);
  data.groups = mergeList(data.groups, r.groups);
  if (changed) commit(source);
  return changed;
}

export const snapshot = () => JSON.parse(JSON.stringify(data));

export function resetAll() {
  data = normalize(null);
  commit();
}

// ---------- 설정 ----------
export function getSettings() {
  const s = readJson(SETTINGS_KEY, {});
  return {
    ocrEngine: 'tesseract',
    ...s,
    googleClientId: s.googleClientId || DEFAULT_CONFIG.googleClientId,
    visionApiKey: s.visionApiKey || DEFAULT_CONFIG.visionApiKey,
    driveFolderName: DEFAULT_CONFIG.driveFolderName,
  };
}
export const setSettings = patch => writeJson(SETTINGS_KEY, { ...readJson(SETTINGS_KEY, {}), ...patch });

export const getSyncMeta = () => readJson(SYNC_KEY, {});
export const setSyncMeta = patch => writeJson(SYNC_KEY, { ...getSyncMeta(), ...patch });
export const clearSyncMeta = () => localStorage.removeItem(SYNC_KEY);

// 교체/삭제되어 Drive에서 지워야 하는 이미지 파일 ID
export const pendingDeletes = () => readJson(PENDING_KEY, []);
export function addPendingDelete(fileId) {
  if (fileId) writeJson(PENDING_KEY, [...new Set([...pendingDeletes(), fileId])]);
}
export const removePendingDelete = fileId => writeJson(PENDING_KEY, pendingDeletes().filter(x => x !== fileId));

export const getUiPrefs = () => readJson(UI_KEY, {});
export const setUiPrefs = patch => writeJson(UI_KEY, { ...getUiPrefs(), ...patch });
