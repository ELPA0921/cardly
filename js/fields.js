// 명함 항목 정의 (편집 화면, 공유 텍스트, vCard에서 공통으로 사용)
export const FIELDS = [
  { key: 'name', label: '이름', icon: 'user', placeholder: '홍길동' },
  { key: 'company', label: '회사명', icon: 'building', placeholder: '창조이엔지' },
  { key: 'department', label: '부서', icon: 'folder', placeholder: '영업팀' },
  { key: 'title', label: '직책', icon: 'tag', placeholder: '부장' },
  { key: 'mobile', label: '휴대폰', icon: 'phone', type: 'tel', placeholder: '01012345678' },
  { key: 'phone', label: '전화', icon: 'phone', type: 'tel', placeholder: '021234567' },
  { key: 'fax', label: '팩스', icon: 'printer', type: 'tel', placeholder: '021234568' },
  { key: 'email', label: '이메일', icon: 'mail', type: 'email', placeholder: 'name@company.com' },
  { key: 'address', label: '주소', icon: 'mapPin', placeholder: '서울특별시 ...' },
  { key: 'website', label: '홈페이지', icon: 'globe', type: 'url', placeholder: 'www.company.com' },
  { key: 'memo', label: '메모', icon: 'edit', multiline: true, placeholder: '만난 곳, 특이사항 등' },
];

export const FIELD_KEYS = FIELDS.map(f => f.key);
export const fieldLabel = key => FIELDS.find(f => f.key === key)?.label || key;

// 공유 텍스트에 들어갈 항목 (메모 제외)
export const SHARE_KEYS = FIELD_KEYS.filter(k => k !== 'memo');
