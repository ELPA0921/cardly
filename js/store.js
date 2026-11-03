// 로컬 데이터 저장소 (localStorage) + Google Drive 데이터와의 병합
import { DEFAULT_CONFIG } from './config.js';
import { FIELD_KEYS } from './fields.js';
import { isNative } from './native.js';
import { cleanPhone } from './parser.js';

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
  const out = { version: 1, cards: [], groups: [], prefs: {}, updatedAt: 0 };
  if (d && typeof d === 'object') {
    out.cards = Array.isArray(d.cards) ? d.cards.filter(c => c && c.id) : [];
    // 예전에 하이픈/괄호를 넣어 저장한 번호도 숫자만 남김 (읽을 때마다 정리 → Drive에도 다음 저장 때 반영)
    for (const c of out.cards) for (const k of ['mobile', 'phone', 'fax']) if (c[k] && /\D/.test(c[k])) c[k] = cleanPhone(c[k]);
    out.groups = Array.isArray(d.groups) ? d.groups.filter(g => g && g.id) : [];
    out.prefs = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
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
// photos: [{ id, fileId }] — 최대 2장(앞면, 뒷면), mainPhoto: 대표 사진 순번
// isMine: 내 명함 (목록/그룹/내보내기에서는 제외)
export function emptyCard() {
  const card = { groupIds: [], favorite: false, photos: [], mainPhoto: 0, ocrText: '' };
  FIELD_KEYS.forEach(k => (card[k] = ''));
  return card;
}

// 명함 사진 목록 (예전 형식 hasImage/imageFileId도 읽음)
export function photosOf(card) {
  if (Array.isArray(card?.photos)) return card.photos;
  if (card?.hasImage || card?.imageFileId) return [{ id: card.id, fileId: card.imageFileId || null }];
  return [];
}
export function mainPhotoIndex(card) {
  const n = photosOf(card).length;
  return n ? Math.min(card.mainPhoto || 0, n - 1) : 0;
}

export const cards = () => data.cards.filter(c => !c.deleted && !c.isMine);
export const allCards = () => data.cards;
export const getCard = id => data.cards.find(c => c.id === id && !c.deleted) || null;
export const getMyCard = () =>
  data.cards.filter(c => !c.deleted && c.isMine).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;

function applyPatch(card, patch) {
  Object.assign(card, patch, { updatedAt: Date.now() });
  if ('photos' in patch) {
    delete card.hasImage;
    delete card.imageFileId;
  }
}

export function saveCard(input) {
  const now = Date.now();
  let card = data.cards.find(c => c.id === input.id);
  if (card && !card.deleted) {
    applyPatch(card, input);
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
  applyPatch(card, patch);
  commit(source);
}

// 삭제는 다른 기기와 동기화할 수 있도록 흔적(tombstone)만 남깁니다.
export function deleteCard(id) {
  const i = data.cards.findIndex(c => c.id === id);
  if (i < 0) return;
  const photos = photosOf(data.cards[i]).filter(p => p.fileId);
  data.cards[i] = { id, deleted: true, photos, updatedAt: Date.now() };
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
  for (const [k, v] of Object.entries(r.prefs)) {
    const cur = data.prefs[k];
    if (!cur || (v?.updatedAt || 0) > (cur.updatedAt || 0)) {
      data.prefs[k] = v;
      changed = true;
    }
  }
  if (changed) commit(source);
  return changed;
}

export const snapshot = () => JSON.parse(JSON.stringify(data));

export function resetAll() {
  data = normalize(null);
  commit();
}

// ---------- 계정 공통 설정 (Drive 데이터에 함께 저장되어 내 모든 기기에 적용) ----------
export const getPref = key => data.prefs[key]?.value ?? '';
export function setPref(key, value) {
  data.prefs[key] = { value, updatedAt: Date.now() };
  commit();
}

// ---------- 설정 ----------
export function getSettings() {
  const s = readJson(SETTINGS_KEY, {});
  const visionApiKey = getPref('visionApiKey') || s.visionApiKey || DEFAULT_CONFIG.visionApiKey;
  return {
    ...s,
    // 기본 OCR: 앱이면 ML Kit, 웹이면 Vision 키가 있을 때 Vision (설정에서 직접 고른 값이 우선)
    ocrEngine: (s.ocrEngine === 'mlkit' && !isNative ? '' : s.ocrEngine) || (isNative ? 'mlkit' : visionApiKey ? 'vision' : 'tesseract'),
    googleClientId: s.googleClientId || DEFAULT_CONFIG.googleClientId,
    visionApiKey,
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
