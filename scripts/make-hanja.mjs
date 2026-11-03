// 한자 → 한글 음 표(js/hanja.js)를 만듭니다. 명함의 한자 이름·직책(金東植 代表)을 한글로 읽는 데 씁니다.
// 원본: Unicode Unihan 데이터베이스의 kHangul 항목 (https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip)
// 실행: Unihan.zip 을 받아 압축을 풀고
//   node scripts/make-hanja.mjs <Unihan_Readings.txt 경로>
// 범위: KS X 1001 한자(출처 0) + 인명용 한자(출처 N). 음이 여럿이면 교육용(E) → KS X 1001(0) → 첫 번째 음 순으로 고름.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) throw new Error('사용법: node scripts/make-hanja.mjs <Unihan_Readings.txt>');

const byReading = new Map();
let count = 0;
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const m = line.match(/^U\+([0-9A-F]+)\tkHangul\t(.+)$/);
  if (!m) continue;
  const readings = m[2].trim().split(' ').map(r => {
    const [hangul, sources = ''] = r.split(':');
    return { hangul, sources };
  });
  if (!readings.some(r => /[0N]/.test(r.sources))) continue;
  const pick = readings.find(r => r.sources.includes('E')) || readings.find(r => r.sources.includes('0')) || readings[0];
  const ch = String.fromCodePoint(parseInt(m[1], 16));
  if (!byReading.has(pick.hangul)) byReading.set(pick.hangul, '');
  byReading.set(pick.hangul, byReading.get(pick.hangul) + ch);
  count++;
}

const data = [...byReading].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([r, chars]) => r + chars).join('');
writeFileSync(
  join(root, 'js', 'hanja.js'),
  `// 한자 → 한글 음 표 (자동 생성: scripts/make-hanja.mjs, 원본 Unicode Unihan kHangul). 직접 고치지 마세요.
// 형식: 한글 음 한 글자 뒤에 그 음으로 읽는 한자들이 이어짐. 한자 ${count}자.
const DATA = '${data}';

let table = null;
export function hanjaReading(ch) {
  if (!table) {
    table = new Map();
    let reading = '';
    for (const c of DATA) {
      if (/[가-힣]/.test(c)) reading = c;
      else table.set(c, reading);
    }
  }
  return table.get(ch) || '';
}
`,
);
console.log(`js/hanja.js 생성: 한자 ${count}자, 음 ${byReading.size}개`);
