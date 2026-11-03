// 공유 텍스트, 클립보드, vCard(.vcf) 만들기
import { SHARE_KEYS, fieldLabel } from './fields.js';
import { isNative, shareNative } from './native.js';
import { contactDisplayName } from './contactRules.js';

const SHARE_LABELS = { company: '회사명' };

export function buildShareText(card) {
  return SHARE_KEYS.filter(k => card[k])
    .map(k => `${SHARE_LABELS[k] || fieldLabel(k)}: ${card[k]}`)
    .join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// 반환: 'shared' | 'copied' | 'cancel'
export async function shareCardText(card) {
  const text = buildShareText(card);
  if (isNative) return shareNative({ text });
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancel';
    }
  }
  await copyText(text);
  return 'copied';
}

const COMPOUND_SURNAMES = ['남궁', '황보', '제갈', '선우', '독고', '사공', '서문', '동방'];

export function splitName(name) {
  const n = (name || '').trim();
  if (!n) return { family: '', given: '' };
  if (/^[가-힣]+$/.test(n)) {
    const len = COMPOUND_SURNAMES.some(s => n.startsWith(s)) && n.length >= 3 ? 2 : 1;
    return { family: n.slice(0, len), given: n.slice(len) };
  }
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { family: '', given: n };
  return { family: parts.at(-1), given: parts.slice(0, -1).join(' ') };
}

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

// displayName: 주소록 이름 규칙으로 만든 이름 (예: "창조이엔지 홍길동 부장"). 이름과 다르면 성/이름으로 나누지 않고 통째로 넣음
export function buildVCard(card, displayName = card.name) {
  const shown = displayName || card.name || card.company || '이름 없음';
  const { family, given } = shown === card.name ? splitName(card.name) : { family: '', given: shown };
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(family)};${esc(given)};;;`, `FN:${esc(shown)}`];
  if (card.company || card.department) lines.push(`ORG:${esc(card.company)}${card.department ? ';' + esc(card.department) : ''}`);
  if (card.title) lines.push(`TITLE:${esc(card.title)}`);
  if (card.mobile) lines.push(`TEL;TYPE=CELL:${card.mobile}`);
  if (card.phone) lines.push(`TEL;TYPE=WORK,VOICE:${card.phone}`);
  if (card.fax) lines.push(`TEL;TYPE=WORK,FAX:${card.fax}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${card.email}`);
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${esc(card.address)};;;;`);
  if (card.website) lines.push(`URL:${/^https?:\/\//i.test(card.website) ? card.website : 'http://' + card.website}`);
  if (card.memo) lines.push(`NOTE:${esc(card.memo)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

// 앱에서는 내려받기 대신 공유 창으로 파일을 보냅니다 (저장, 카카오톡, Drive 등 선택)
export function downloadBlob(blob, filename) {
  if (isNative) return shareNative({ files: [{ name: filename, blob }] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = s => (s || '').replace(/[\\/:*?"<>|]/g, '').trim();

export function vcardFilename(cards, label) {
  if (label) return `${safeName(label)}.vcf`;
  if (cards.length === 1) return `${safeName(cards[0].name || cards[0].company) || '명함'}.vcf`;
  return `명함_${cards.length}명.vcf`;
}

// 명함 사진 보내기. photos: [{ blob, side: '앞면'|'뒷면' }], text: 함께 보낼 정보 (없으면 사진만)
// 반환: 'shared' | 'downloaded' | 'cancel'
export async function sharePhotos(card, photos, text = '') {
  const base = safeName(card.name || card.company) || '명함';
  const files = photos.map(p => new File([p.blob], `${base}_${p.side}.jpg`, { type: 'image/jpeg' }));
  if (isNative) return shareNative({ text, files: files.map(f => ({ name: f.name, blob: f })) });
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share(text ? { files, text } : { files });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancel';
    }
  }
  files.forEach(f => downloadBlob(f, f.name));
  return 'downloaded';
}

// 반환: 'shared' | 'downloaded' | 'cancel'
export async function shareVCard(cards, label) {
  const filename = vcardFilename(cards, label);
  const file = new File([cards.map(c => buildVCard(c, contactDisplayName(c))).join('')], filename, { type: 'text/vcard' });
  if (isNative) return shareNative({ files: [{ name: filename, blob: file }] });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancel';
    }
  }
  downloadBlob(file, filename);
  return 'downloaded';
}

