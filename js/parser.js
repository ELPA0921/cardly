// OCR 텍스트 → 명함 항목(이름, 회사, 직책, 번호 등) 추출
// 정답을 보장할 수는 없으므로 편집 화면에서 사용자가 쉽게 고칠 수 있게 하는 것이 전제입니다.
// 입력: { text, lines: [{ text, height }] }  (height가 있으면 글자 크기를 이름/회사 판단에 활용)
import { hanjaReading } from './hanja.js';

const TITLES_KO = [
  '대표이사', '대표변호사', '대표', '회장', '부회장', '사장', '부사장', '전무이사', '전무', '상무이사', '상무',
  '이사', '감사', '고문', '자문위원', '부장', '차장', '과장', '대리', '주임', '사원', '계장', '팀장', '파트장',
  '실장', '본부장', '센터장', '소장', '현장소장', '지점장', '공장장', '원장', '국장', '처장', '단장', '그룹장',
  '부문장', '사업부장', '총괄', '책임연구원', '선임연구원', '수석연구원', '주임연구원', '연구원', '책임', '선임',
  '수석', '전임', '매니저', '프로', '위원', '교수', '부교수', '조교수', '박사', '변호사', '변리사', '세무사',
  '회계사', '노무사', '법무사', '건축사', '기술사', '감리원', '디자이너', '엔지니어', '컨설턴트', '대표원장', '이사장',
].sort((a, b) => b.length - a.length);
const TITLES_EN = new Set(['ceo', 'cto', 'cfo', 'coo', 'cio', 'cmo', 'pm', 'pl', 'vp', 'svp', 'evp']);
const EN_TITLE_RE =
  /\b(CEO|CTO|CFO|COO|CIO|CMO|(?:Executive |Senior )?Vice President|President|(?:Senior |General |Assistant |Deputy |Project |Sales |Marketing |Account )?(?:Manager|Director|Engineer|Researcher|Consultant|Designer|Architect)|Partner|Principal|Co-?Founder|Founder|Chairman|Team Lead(?:er)?|Head of [A-Za-z ]+|Specialist|Representative|Professor|Attorney|Lawyer)\b/i;

const DEPT_RE = /(팀|부|본부|실|센터|사업부|사업본부|사업단|부문|연구소|연구실|지사|지점|사무소|공장|과|그룹|Team|Dept\.?|Department|Division)$/i;

const KO_COMPANY_STRONG = /\(주\)|㈜|주식회사|\(유\)|유한회사|유한책임회사|\(사\)|사단법인|\(재\)|재단법인|합자회사|합명회사|법무법인|회계법인|세무법인|특허법인|협동조합/;
const EN_COMPANY_STRONG = /\b(co\.?,?\s*ltd|corp(oration)?|inc|llc|limited|company|gmbh|holdings)\b/i;
const COMPANY_WEAK =
  /(엔지니어링|이엔지|건설|건축|산업|전자|전기|통신|기술|테크|솔루션|시스템|컨설팅|설계|디자인|물산|상사|제약|화학|중공업|에너지|코리아|^한국[가-힣]{2,}|은행|증권|보험|캐피탈|투자|자산운용|병원|의원|약국|재단|협회|공사|공단|학교|대학교|연구원|연구소|미디어|엔터|홀딩스|그룹|네트웍스|네트워크|소프트|랩스|플랫폼|인터내셔널|글로벌|무역|유통|물류|개발|종합|토건|환경|플랜트|\bENG\b|E&C|\bKorea\b|\bGroup\b|\bSystems?\b|\bSolutions?\b|\bTechnolog(?:y|ies)\b|\bTech\b|\bEngineering\b|\bConstruction\b|\bConsulting\b|\bNetworks?\b|\bSoftware\b|\bLabs?\b|\bGlobal\b|\bInternational\b)/i;

const TOP_SURNAMES = new Set('김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염'.split(''));
const SURNAMES = new Set([
  ...TOP_SURNAMES,
  ...'여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형계피두감음빈동온호범좌팽승간상시갈단견당화창옹순빙종풍'.split(''),
]);
const COMPOUND_SURNAMES = ['남궁', '황보', '제갈', '선우', '독고', '사공', '서문', '동방'];
const NAME_STOPWORDS = new Set([
  '주소', '전화', '팩스', '휴대폰', '핸드폰', '이메일', '메일', '홈페이지', '대표', '본사', '지사', '공장', '연구소',
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남',
  '경북', '경남', '제주', '주식회사', '유한회사', '사무소', '영업', '기획', '관리', '개발', '기술', '마케팅', '총무',
  '인사', '재무', '회계', '구매', '생산', '품질', '설계', '시공', '디자인', '전략', '경영', '지원', '고객', '서비스',
  '사업', '연구', '담당', '직통', '대표번호', '고객센터', '한국', '대한민국', '코리아', '본부', '지점', '센터', '우편',
]);
const FREE_MAIL = new Set(['gmail', 'naver', 'daum', 'hanmail', 'kakao', 'hotmail', 'outlook', 'yahoo', 'nate', 'icloud', 'me', 'live']);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\(?0\d{1,3}\)?[\s.\-)]{0,3}\d{3,4}[\s.\-]{0,3}\d{4}|1[5-8]\d{2}[\s.\-]\d{4})(?!\d)/g;
const WEB_RE =
  /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:co\.kr|or\.kr|go\.kr|ac\.kr|re\.kr|ne\.kr|com|net|org|kr|io|biz|info|co|me|ai|jp|cn)(?:\/[^\s]*)?(?![a-z0-9])/i;
const LABEL_RE =
  /(?:^|(?<=[\s|/·,]))(?:tel|tei|phone|mobile|mob|cell|fax|e-?mail|web|homepage|website|url|[hcm][.,·ㆍ・•∙-]?p|direct|office|전화|휴대폰|핸드폰|휴대전화|팩스|이메일|메일|홈페이지|직통|대표번호|[TMFEDWHPCO])[\s.:)\]]*(?=\s|$|[|/·,])/gi;
const PROVINCE_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;
const ADDRESS_LABEL_RE = /^(주소|address|add|addr|a)\s*[.:)\]]?\s*/i;
const HANGUL_RE = /[가-힣]/;
const HANJA_RE = /[㐀-䶿一-鿿豈-﫿]/;
const HANJA_WORD_RE = /[㐀-䶿一-鿿豈-﫿]+/g;
// 金으로 시작해도 성씨(김)가 아닌 낱말
const GEUM_WORDS = /^금(융|속|고|형|은|광|강|액|리)/;

const onlyHangul = s => /^[가-힣]+$/.test(s);
const digits = s => s.replace(/\D/g, '');

// 전화번호의 숫자만 (+82 국가번호는 0으로 바꿈)
export function phoneDigits(raw) {
  const s = String(raw || '').trim();
  let d = digits(s);
  if ((s.startsWith('+82') && d.length >= 9) || (d.startsWith('82') && d.length >= 11)) d = '0' + d.slice(2).replace(/^0/, '');
  return d;
}

// 숫자만으로 국내 전화번호 하이픈 규칙에 맞춰 표시 (입력 중인 번호도 단계별로 맞춤)
//  02-123-4567 / 02-1234-5678, 031-123-4567, 010-1234-5678, 070-1234-5678, 0505-123-4567, 1588-1234
export function hyphenatePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (/^1[5-9]/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4, 8)}${d.slice(8)}`;
  if (!d.startsWith('0')) return d;
  const areaLen = d.startsWith('02') ? 2 : /^050/.test(d) ? 4 : 3;
  const area = d.slice(0, areaLen);
  const rest = d.slice(areaLen);
  if (!rest) return area;
  if (rest.length <= 4) return `${area}-${rest}`;
  if (rest.length === 7) return `${area}-${rest.slice(0, 3)}-${rest.slice(3)}`;
  return `${area}-${rest.slice(0, 4)}-${rest.slice(4)}`;
}

// 저장용: 특수문자는 버리고 하이픈 규칙으로 다시 맞춤
export const formatPhone = raw => hyphenatePhone(phoneDigits(raw));

// 번호 종류 라벨. OCR이 점·띄어쓰기를 다르게 읽는 경우도 포함 (H.P / H. P / H,P / T E L / TEI / FAX.: 등)
const PHONE_LABELS = [
  ['fax', String.raw`f\s?a\s?x|f\s?x|f|팩\s?스|팩`],
  ['mobile', String.raw`mobile\s?phone|cell\s?phone|hand\s?phone|[hcm]\s?[.,/·ㆍ・•∙-]?\s?p|mobile|mob|cell|m|휴\s?대\s?폰|핸\s?드\s?폰|휴대전화|모바일|휴대`],
  ['phone', String.raw`t\s?e\s?[li1]|telephone|phone|office|direct|dir|t|o|d|전\s?화|사무실|직통|대표전화|대표번호|대표`],
].map(([kind, label]) => ({
  kind,
  before: new RegExp(`(?:^|[^a-z])(?:${label})[\\s.:)\\]]*$`, 'i'),
  after: new RegExp(`^[\\s(\\[]*(?:${label})(?![a-z])[\\s.:)\\]]*`, 'i'),
  start: new RegExp(`^(${label})(?![a-z])([\\s.:)\\]|/·,]*)`, 'i'),
}));

// 번호 앞의 라벨: "TEL: 02-..."
function phoneKind(before) {
  const b = before.slice(-16);
  return PHONE_LABELS.find(p => p.before.test(b))?.kind || null;
}

// 번호 뒤의 라벨: "02-1234-5678 (TEL)". 괄호로 감쌌거나 줄 끝에 있을 때만 (다음 번호의 라벨과 헷갈리지 않게)
function phoneKindAfter(after) {
  for (const p of PHONE_LABELS) {
    const m = after.match(p.after);
    if (m && (/^\s*[(\[]/.test(after) || !/\d/.test(after.slice(m[0].length)))) return p.kind;
  }
  return null;
}

// "TEL:" "FAX:" "H.P:" 처럼 라벨만 있는 줄 → 라벨 종류 목록. 라벨 열과 번호 열이 따로 인식된 명함용
function labelOnlyKinds(text) {
  const kinds = [];
  let rest = text.trim();
  if (koTitleOf(rest.replace(/[\s.:)\]]+$/, ''))) return null; // "대표"만 있는 줄은 직책
  while (rest) {
    let hit = null;
    for (const p of PHONE_LABELS) {
      const m = rest.match(p.start);
      if (m) {
        hit = { kind: p.kind, m };
        break;
      }
    }
    if (!hit) return null;
    // 한 글자 라벨(T, F, M...)은 "T." "F:" 처럼 문장부호가 붙었을 때만 (흩어진 글자 오인식 방지)
    if (hit.m[1].replace(/[\s.,/·]/g, '').length < 2 && !/[.:]/.test(hit.m[2])) return null;
    kinds.push(hit.kind);
    rest = rest.slice(hit.m[0].length);
  }
  return kinds.length ? kinds : null;
}

// OCR 줄 위치 { left, top, right, bottom } (없으면 null)
function boxOf(l) {
  const { left, top, right, bottom } = l;
  return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top ? { left, top, right, bottom } : null;
}

// 위치 정보가 있으면 라벨만 있는 줄("TEL:")을 같은 높이에서 가장 가까운 오른쪽 번호 줄 앞에 붙입니다.
// ML Kit 등은 라벨 열과 번호 열을 서로 다른 덩어리로 인식해서 순서만으로는 짝을 잃기 쉽습니다.
function attachSideLabels(lines) {
  const claimed = new Set();
  for (const label of lines) {
    // "TEL / FAX" 처럼 라벨이 여럿인 줄은 순서대로 짝짓는 쪽(pendingKinds)에 맡김
    if (!label.box || labelOnlyKinds(label.text)?.length !== 1) continue;
    const a = label.box;
    const mid = (a.top + a.bottom) / 2;
    let best = null;
    for (const l of lines) {
      if (l === label || !l.box || claimed.has(l) || !l.text.match(PHONE_RE)) continue;
      const b = l.box;
      if (b.left < a.right - (a.right - a.left) * 0.3) continue; // 오른쪽에 있어야 함
      if (Math.abs((b.top + b.bottom) / 2 - mid) > Math.max(a.bottom - a.top, b.bottom - b.top) * 0.6) continue; // 같은 높이
      const gap = b.left - a.right;
      if (!best || gap < best.gap) best = { l, gap };
    }
    if (!best) continue;
    best.l.text = label.text + ' ' + best.l.text;
    claimed.add(best.l);
    label.text = '';
    label.used = true;
  }
}

function cleanLine(text) {
  return String(text || '')
    .replace(/[​﻿]/g, '')
    .replace(/[“”"`'‘’]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|_\-–—:;,.·•]+|[\s|_\-–—:;,·•]+$/g, '')
    .trim();
}

// "홍 길 동" / "金 道 吉" 처럼 한 글자씩 띄어 인식된 한글·한자를 붙입니다.
// 직책과 이름이 한 줄에 띄어 있으면 나눠 붙임: "대 리 서 민 호" / "대리서 민 호"(직책에 성이 붙어 인식) → "대리 서민호"
function joinSpacedHangul(text) {
  const single = t => t.length === 1 && (HANGUL_RE.test(t) || HANJA_RE.test(t));
  const tokens = text.split(' ');
  const out = [];
  for (let i = 0; i < tokens.length; ) {
    let j = i;
    while (j < tokens.length && single(tokens[j])) j++;
    if (j === i) {
      const tok = tokens[i];
      while (j + 1 < tokens.length && single(tokens[j + 1])) j++;
      const glued = j - i >= 1 && j - i <= 3 && !TITLES_KO.includes(tok) &&
        TITLES_KO.find(t => tok.length === t.length + 1 && tok.startsWith(t) && SURNAMES.has(tok.at(-1)));
      if (glued) {
        out.push(glued, tok.at(-1) + tokens.slice(i + 1, j + 1).join(''));
        i = j + 1;
      } else out.push(tokens[i++]);
      continue;
    }
    const run = tokens.slice(i, j);
    const joined = run.join('');
    i = j;
    const title = run.length > 4 &&
      TITLES_KO.find(t => (joined.startsWith(t) || joined.endsWith(t)) && joined.length - t.length >= 2 && joined.length - t.length <= 4);
    if (run.length >= 2 && run.length <= 4) out.push(joined);
    else if (title) out.push(...(joined.startsWith(title) ? [title, joined.slice(title.length)] : [joined.slice(0, -title.length), title]));
    else out.push(...run);
  }
  return out.join(' ');
}

// 두음법칙: 낱말 첫 글자의 ㄹ·ㄴ 바꿈 (李 리→이, 林 림→임, 盧 로→노, 女 녀→여)
function initialSound(syl) {
  const code = syl.charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code < 11172)) return syl;
  const cho = Math.floor(code / 588);
  const iotized = [2, 6, 7, 12, 17, 20].includes(Math.floor((code % 588) / 28)); // ㅑㅕㅖㅛㅠㅣ
  const next = cho === 5 ? (iotized ? 11 : 2) : cho === 2 && iotized ? 11 : cho; // ㄹ→ㅇ/ㄴ, ㄴ→ㅇ
  return String.fromCharCode(0xac00 + next * 588 + (code % 588));
}

// 한자를 한글 음으로: 代表 → 대표, 金東植 → 김동식 (이름 첫 글자 金은 성씨 '김'으로). 표에 없는 글자는 그대로 둠
function hanjaToHangul(text) {
  if (!HANJA_RE.test(text)) return text;
  return text.replace(HANJA_WORD_RE, word => {
    const chars = [...word];
    const read = chars.map(c => hanjaReading(c) || c);
    read[0] = initialSound(read[0]);
    const hangul = read.join('');
    if (chars[0] === '金' && chars.length >= 2 && chars.length <= 4 && !GEUM_WORDS.test(hangul)) return '김' + hangul.slice(1);
    return hangul;
  });
}

const isLeftoverJunk = text => {
  const rest = text.replace(LABEL_RE, ' ').replace(/[|/·,:;()[\]\-–.]+/g, ' ').trim();
  return rest.replace(/\s/g, '').length < 2 || !/[A-Za-z가-힣0-9]/.test(rest);
};

function koTitleOf(tok) {
  if (TITLES_EN.has(tok.toLowerCase())) return tok;
  if (!onlyHangul(tok)) return null;
  for (const t of TITLES_KO) {
    if (tok === t) return tok;
    if (tok.endsWith(t) && tok.length - t.length <= 4 && t.length >= 2) return tok;
  }
  return null;
}

function isDept(tok) {
  if (!HANGUL_RE.test(tok) && !/^(team|dept\.?|department|division)$/i.test(tok)) return false;
  if (!DEPT_RE.test(tok) || tok.length < 2) return false;
  if (NAME_STOPWORDS.has(tok) && tok !== '본부') return false;
  // "김영실" 같은 이름과 "기획실" 같은 부서를 구분하기 위한 단순 규칙
  if (tok.length === 3 && /[부실과]$/.test(tok) && TOP_SURNAMES.has(tok[0])) return false;
  return true;
}

function nameScore(tok, line, ctx) {
  if (!onlyHangul(tok) || tok.length < 2 || tok.length > 4) return -1;
  if (NAME_STOPWORDS.has(tok) || koTitleOf(tok) || isDept(tok)) return -1;
  if (COMPANY_WEAK.test(tok) || KO_COMPANY_STRONG.test(tok)) return -1;
  let score = 0;
  const compound = COMPOUND_SURNAMES.some(s => tok.startsWith(s)) && tok.length >= 3;
  if (compound) score += 3;
  else if (TOP_SURNAMES.has(tok[0])) score += 3;
  else if (SURNAMES.has(tok[0])) score += 1;
  else score -= 2;
  if (tok.length === 3) score += 1;
  if (tok.length === 4 && !compound) score -= 1; // 네 글자는 복성(남궁·황보…)이 아니면 대개 이름이 아님 (서보모터)
  if (line.tokens.length <= 3) score += 1;
  if (line.tokens.length === 1) score += 1;
  if (line.tokens.some(t => koTitleOf(t))) score += 2;
  if (ctx.median && line.height) score += Math.max(-1, Math.min(2, (line.height / ctx.median - 1) * 2.5));
  return score;
}

export function parseCard(input) {
  const result = {
    name: '', company: '', department: '', title: '', mobile: '', phone: '', fax: '',
    email: '', address: '', website: '', memo: '',
  };
  const source = input?.lines?.length ? input.lines : String(input?.text || '').split(/\r?\n/).map(text => ({ text }));
  const lines = source
    .map((l, idx) => ({ text: hanjaToHangul(joinSpacedHangul(cleanLine(l.text))), height: l.height || 0, box: boxOf(l), idx, used: false }))
    .filter(l => l.text.length > 0);
  attachSideLabels(lines);

  const heights = lines.map(l => l.height).filter(h => h > 0).sort((a, b) => a - b);
  const ctx = { median: heights.length ? heights[Math.floor(heights.length / 2)] : 0 };
  const extraNumbers = [];

  // 1) 이메일
  for (const l of lines) {
    // "name @ abc kr" 처럼 OCR이 점을 공백으로 읽은 경우도 보정
    const t = l.text.replace(/\s*@\s*/g, '@').replace(/(@[A-Za-z0-9.-]+)[\s,]+(co\.kr|com|net|org|kr)\b/gi, '$1.$2');
    const found = t.match(EMAIL_RE);
    if (!found) continue;
    if (!result.email) result.email = found[0].toLowerCase();
    l.text = t.replace(EMAIL_RE, ' ').trim();
    l.contact = true;
  }

  // 2) 전화번호 (라벨 TEL/FAX/H.P 등으로 구분, 없으면 010 → 휴대폰)
  //  strength 2: 라벨대로 / 1: TEL 라벨이지만 010 번호라 휴대폰으로 / 0: 라벨 없음
  const numbers = [];
  const pendingKinds = []; // 라벨만 있던 줄의 라벨 순서 (번호가 다른 줄로 인식된 경우)
  for (const l of lines) {
    let t = l.text
      .replace(/[‐‑‒–—―−－ー]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/\+\s?82[\s.\-)]*\(?0?\)?\s*/g, '0')
      .replace(/(?<=\d[\s.\-]?)[Oo](?=[\d\s.\-])/g, '0')
      .replace(/(?<=\d[\s.\-]?)[lI|](?=\d)/g, '1')
      // 글자 간격을 넓혀 인쇄한 번호: "555-1 2 0 3" → "555-1203"
      .replace(/(?<!\d)\d(?: \d){2,}(?!\d)/g, m => m.replace(/ /g, ''))
      .replace(/(?<=-\s?)\d(?:\s?\d){3}(?!\s?\d)/g, m => m.replace(/\s/g, ''));
    const matches = [...t.matchAll(PHONE_RE)];
    if (!matches.length) {
      const kinds = labelOnlyKinds(l.text);
      if (kinds) {
        pendingKinds.push(...kinds);
        l.used = true;
      }
      continue;
    }
    let prevEnd = 0;
    matches.forEach((m, i) => {
      const d = digits(m[0]);
      const valid = /^1[5-8]\d{6}$/.test(d) || (/^0\d+$/.test(d) && d.length >= 9 && d.length <= 12);
      if (!valid) return;
      const end = m.index + m[0].length;
      let kind =
        phoneKind(t.slice(prevEnd, m.index)) || phoneKindAfter(t.slice(end, matches[i + 1]?.index ?? t.length)) || pendingKinds.shift();
      prevEnd = end;
      const isMobile = /^01[016789]/.test(d);
      let strength = kind ? 2 : 0;
      if (!kind) kind = isMobile ? 'mobile' : 'phone';
      else if (kind === 'phone' && isMobile) [kind, strength] = ['mobile', 1];
      numbers.push({ number: formatPhone(m[0]), kind, strength });
    });
    t = t.replace(PHONE_RE, ' ');
    l.text = cleanLine(t);
    l.contact = true;
  }
  // 라벨이 확실한 번호부터 자리를 채움 (H.P 번호가 TEL 010 번호보다 휴대폰 칸 우선)
  for (const { number, kind, strength } of [...numbers].sort((a, b) => b.strength - a.strength)) {
    if (!result[kind]) result[kind] = number;
    else if (result[kind] === number || [result.mobile, result.phone, result.fax].includes(number)) continue;
    else if (strength === 1 && !result.phone) result.phone = number;
    else extraNumbers.push(number);
  }

  // 3) 홈페이지
  for (const l of lines) {
    const m = l.text.match(WEB_RE);
    if (!m || /^\d/.test(m[0])) continue;
    const better = !result.website || (/www|http/i.test(m[0]) && !/www|http/i.test(result.website));
    if (better) result.website = m[0].replace(/[.,;]+$/, '');
    l.text = cleanLine(l.text.replace(m[0], ' '));
    l.contact = true;
  }

  for (const l of lines) {
    if (l.contact) {
      l.text = cleanLine(l.text.replace(LABEL_RE, ' '));
      if (isLeftoverJunk(l.text)) l.used = true;
    }
  }

  // 4) 주소
  const addrScore = text => {
    const t = text.replace(ADDRESS_LABEL_RE, '');
    let s = 0;
    if (ADDRESS_LABEL_RE.test(text) && /[가-힣\d]/.test(t)) s += 3;
    if (PROVINCE_RE.test(t)) s += 3;
    if (/[가-힣]+(시|군|구)(\s|$)/.test(t)) s += 2;
    if (/[가-힣\d]+(로|길)\s*\d+/.test(t)) s += 2;
    if (/\d+\s*(층|호|번지)/.test(t)) s += 1;
    if (/[가-힣]+(동|읍|면|리)\s*\d/.test(t)) s += 1;
    if (/\d+.*\b(seoul|gyeonggi|busan|incheon|korea)\b/i.test(t) || /-(gu|si|ro|gil)\b/i.test(t)) s += 3;
    if (HANGUL_RE.test(t)) s += 1;
    return s;
  };
  let addrLine = null;
  let best = 3;
  for (const l of lines) {
    if (l.used) continue;
    const s = addrScore(l.text);
    if (s > best) {
      best = s;
      addrLine = l;
    }
  }
  if (addrLine) {
    let address = addrLine.text.replace(ADDRESS_LABEL_RE, '');
    addrLine.used = true;
    const pos = lines.indexOf(addrLine);
    // 이어지는 줄(도로명 주소, 건물·호수)은 두 줄까지 붙임
    for (let k = pos + 1; k <= pos + 2; k++) {
      const next = lines[k];
      if (!next || next.used || next.contact || KO_COMPANY_STRONG.test(next.text)) break; // 번호를 뺀 "(직통)" 같은 줄은 제외
      if (!/(\d+\s*층|\d+\s*호|빌딩|타워|센터|센타|플라자|오피스|B\/D|\(우\)|^\(.*\)$|\b\d{5}\b|[가-힣\d]+(로|길)\s*\d)/.test(next.text)) break;
      address += ' ' + next.text;
      next.used = true;
    }
    const prev = lines[pos - 1];
    if (prev && !prev.used && /^(\(우\)|우\)|우편번호)?\s*\(?\d{5}\)?$/.test(prev.text)) {
      address = prev.text + ' ' + address;
      prev.used = true;
    }
    result.address = address.replace(/(\d)\s*[증흥](?=[\s,)]|$)/g, '$1층').trim();
  }

  // 5) 회사명
  const domainOf = s => (s.split('@')[1] || s).replace(/^(https?:\/\/)?(www\.)?/i, '').split('.')[0].toLowerCase();
  const domains = [result.email && domainOf(result.email), result.website && domainOf(result.website)].filter(
    d => d && d.length >= 3 && !FREE_MAIL.has(d),
  );
  for (const l of lines) l.tokens = l.text.split(/[\s|/·,]+/).map(t => t.replace(/[()[\]]/g, '')).filter(Boolean);

  let companyLine = null;
  best = 1;
  for (const l of lines) {
    if (l.used) continue;
    let s = 0;
    if (KO_COMPANY_STRONG.test(l.text) || EN_COMPANY_STRONG.test(l.text)) s += 5;
    if (COMPANY_WEAK.test(l.text)) s += 3;
    const compact = l.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (domains.some(d => compact.includes(d))) s += 3;
    if (l.tokens.some(t => koTitleOf(t)) || EN_TITLE_RE.test(l.text)) s -= 3;
    if (l.tokens.every(t => isDept(t))) s -= 3;
    if (ctx.median && l.height) s += Math.max(0, Math.min(1.5, l.height / ctx.median - 1));
    if (s > best) {
      best = s;
      companyLine = l;
    }
  }
  if (companyLine) {
    result.company = companyLine.text;
    companyLine.used = true;
  }

  // 6) 이름 / 직책 / 부서
  let nameBest = { score: 2.5, tok: '', line: null };
  const titleTokens = [];
  const deptTokens = [];
  for (const l of lines) {
    if (l.used) continue;
    for (const tok of l.tokens) {
      if (koTitleOf(tok)) titleTokens.push({ tok, line: l });
      else if (isDept(tok)) deptTokens.push({ tok, line: l });
      else {
        const s = nameScore(tok, l, ctx);
        if (s > nameBest.score) nameBest = { score: s, tok, line: l };
      }
    }
  }
  if (nameBest.line) result.name = nameBest.tok;

  // 직책: 이름과 같은 줄 우선, 없으면 처음 나온 줄
  const titleLine = (nameBest.line && titleTokens.some(t => t.line === nameBest.line) && nameBest.line) || titleTokens[0]?.line;
  if (titleLine) result.title = titleTokens.filter(t => t.line === titleLine).map(t => t.tok).join(' ');
  else {
    const enLine = lines.find(l => !l.used && !HANGUL_RE.test(l.text) && EN_TITLE_RE.test(l.text));
    if (enLine) result.title = enLine.text.match(EN_TITLE_RE)[0];
  }

  if (deptTokens.length) {
    const deptLine = (titleLine && deptTokens.some(t => t.line === titleLine) && titleLine) || deptTokens[0].line;
    result.department = deptTokens.filter(t => t.line === deptLine).map(t => t.tok).join(' ');
  }

  // 한글 이름이 없으면 영문 이름 시도 (예: "Gil-dong Hong")
  if (!result.name) {
    const en = lines.find(
      l => !l.used && /^[A-Z][a-zA-Z-]+(?: [A-Z][a-zA-Z-]+){1,2}$/.test(l.text) &&
        !EN_TITLE_RE.test(l.text) && !COMPANY_WEAK.test(l.text) && !EN_COMPANY_STRONG.test(l.text),
    );
    if (en) result.name = en.text;
  }

  if (extraNumbers.length) result.memo = '기타 번호: ' + [...new Set(extraNumbers)].join(', ');
  return result;
}

// 한글 초성 추출 (검색용)
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function chosung(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch;
  }
  return out;
}
