// 웹 파일을 앱(Capacitor)용 www 폴더로 복사합니다.
// 웹 버전(GitHub Pages)은 저장소 루트를 그대로 쓰고, 앱은 이 www 폴더를 씁니다.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const items = ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of items) cpSync(join(root, item), join(out, item), { recursive: true });
console.log('www 폴더 준비 완료:', items.join(', '));
