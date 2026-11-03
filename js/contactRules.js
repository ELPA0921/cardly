// 주소록에 저장할 때의 규칙 (사용자가 설정 → 주소록에서 고름)
// 규칙은 계정 공통 설정(prefs)에 저장되어 내 모든 기기에 같이 적용됩니다.
import * as store from './store.js';

export const NAME_PARTS = [
  { key: 'company', label: '회사명' },
  { key: 'department', label: '부서' },
  { key: 'name', label: '이름' },
  { key: 'title', label: '직책' },
];
export const partLabel = key => NAME_PARTS.find(p => p.key === key)?.label || key;

export const NAME_PRESETS = [
  ['name'],
  ['name', 'title'],
  ['company', 'name'],
  ['company', 'name', 'title'],
  ['company', 'department', 'name', 'title'],
];

export function getNameFormat() {
  const v = store.getPref('contactNameFormat');
  const parts = Array.isArray(v) ? v.filter(k => NAME_PARTS.some(p => p.key === k)) : [];
  return parts.length ? parts : ['name'];
}
export const setNameFormat = parts => store.setPref('contactNameFormat', parts);

// 회사명에서 (주)·주식회사 같은 법인 표기 빼기 (기본: 뺌)
export const getStripCorp = () => store.getPref('contactStripCorp') !== false;
export const setStripCorp = on => store.setPref('contactStripCorp', !!on);

// 명함 대표 사진을 연락처 사진으로 (기본: 넣음)
export const getUsePhoto = () => store.getPref('contactPhoto') !== false;
export const setUsePhoto = on => store.setPref('contactPhoto', !!on);

const CORP_RE = /\(주\)|㈜|주식회사|\(유\)|유한회사|유한책임회사|\(사\)|사단법인|\(재\)|재단법인|,?\s*\b(co\.?,?\s*ltd\.?|inc\.?|corp\.?|llc)\s*$/gi;

export function shortCompany(company) {
  return String(company || '').replace(CORP_RE, ' ').replace(/\s+/g, ' ').trim();
}

// 규칙대로 만든 주소록 이름. 비어 있는 항목은 건너뛰고, 모두 비면 이름 → 회사명 순으로 대신 씀
export function contactDisplayName(card, parts = getNameFormat(), stripCorp = getStripCorp()) {
  const value = k => {
    const v = (card[k] || '').trim();
    return k === 'company' && stripCorp ? shortCompany(v) : v;
  };
  return parts.map(value).filter(Boolean).join(' ') || (card.name || '').trim() || value('company');
}
