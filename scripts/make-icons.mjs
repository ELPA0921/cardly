// 로고 원본(design/logo-source.webp)에서 앱/웹 아이콘, 워드마크, 시작 화면을 만듭니다.
// 실행: node scripts/make-icons.mjs
import sharp from 'sharp';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'design', 'logo-source.webp');
const ICON_BOX = { left: 295, top: 149, width: 665, height: 666 }; // 큰 아이콘 영역
const WORD_BOX = { left: 478, top: 924, width: 617, height: 217 }; // '카들리' 글자 영역
const RADIUS = 0.256; // 아이콘 둥근 모서리 비율

const { data, info } = await sharp(SRC).extract(ICON_BOX).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };

// 배경 그라데이션을 평면(c = a + b·x + c·y)으로 추정: 테두리 안쪽 띠에서 표본 추출 (모서리 제외)
function fitGradient() {
  const rows = [];
  const inset = Math.round(W * 0.035);
  for (let t = 0.3; t <= 0.7; t += 0.02) {
    for (const [x, y] of [[t * W, inset], [t * W, H - 1 - inset], [inset, t * H], [W - 1 - inset, t * H]]) {
      const p = px(Math.round(x), Math.round(y));
      if (p[0] > 200 && p[1] > 200 && p[2] > 200) continue; // 흰 글자/로고 부분은 제외
      rows.push([x / W, y / H, p]);
    }
  }
  // 최소제곱 (3x3 정규방정식)
  const coef = [0, 1, 2].map(ch => {
    let s = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
    for (const [x, y, p] of rows) {
      const v = [1, x, y];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) s[i][j] += v[i] * v[j]; s[i][3] += v[i] * p[ch]; }
    }
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) if (r !== c) { const f = s[r][c] / s[c][c]; for (let k = c; k < 4; k++) s[r][k] -= f * s[c][k]; }
    }
    return [0, 1, 2].map(i => s[i][3] / s[i][i]);
  });
  return (x, y) => coef.map(([a, b, c]) => Math.max(0, Math.min(255, Math.round(a + b * x + c * y))));
}
const grad = fitGradient();
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
console.log('그라데이션: 좌상', hex(grad(0, 0)), '우상', hex(grad(1, 0)), '좌하', hex(grad(0, 1)), '우하', hex(grad(1, 1)));

const roundedMask = (size, r = RADIUS) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * r}" fill="#fff"/></svg>`);
const circleMask = size =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

// 둥근 사각형 아이콘 (모서리 투명)
async function roundedIcon(size) {
  return sharp(SRC).extract(ICON_BOX).resize(size, size)
    .composite([{ input: roundedMask(size), blend: 'dest-in' }]).png().toBuffer();
}

// 아이콘을 scale 비율로 가운데 두고, 바깥은 아이콘 가장자리 색을 그대로 이어서 채운 정사각형
// (안드로이드 적응형/마스커블용 — 런처가 어떤 모양으로 잘라도 이음새가 보이지 않게)
async function fullBleed(size, scale) {
  const inner = Math.round(size * scale), off = Math.round((size - inner) / 2);
  const { data: s } = await sharp(SRC).extract(ICON_BOX).resize(inner, inner).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const d = inner * 0.03, r = inner * RADIUS - d; // 가장자리(흰 테두리 섞인 부분)보다 조금 안쪽 둥근 사각형
  const lo = d + r, hi = inner - d - r;
  const bg = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let u = x - off, v = y - off;
    const cx = Math.max(lo, Math.min(hi, u)), cy = Math.max(lo, Math.min(hi, v));
    const dx = u - cx, dy = v - cy, dist = Math.hypot(dx, dy);
    if (dist > r) { u = cx + (dx / dist) * r; v = cy + (dy / dist) * r; }
    const si = (Math.min(inner - 1, Math.max(0, Math.round(v))) * inner + Math.min(inner - 1, Math.max(0, Math.round(u)))) * 3;
    bg[(y * size + x) * 3] = s[si]; bg[(y * size + x) * 3 + 1] = s[si + 1]; bg[(y * size + x) * 3 + 2] = s[si + 2];
  }
  // 아이콘은 테두리를 살짝 안쪽으로 부드럽게 잘라 올림
  const feather = Math.max(1, inner * 0.012);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><defs><filter id="f"><feGaussianBlur stdDeviation="${feather}"/></filter></defs><rect x="${d}" y="${d}" width="${inner - 2 * d}" height="${inner - 2 * d}" rx="${r}" fill="#fff" filter="url(#f)"/></svg>`);
  const icon = await sharp(SRC).extract(ICON_BOX).resize(inner, inner).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp(bg, { raw: { width: size, height: size, channels: 3 } })
    .composite([{ input: icon, left: off, top: off }])
    .png().toBuffer();
}

const out = (...p) => { const f = join(root, ...p); mkdirSync(dirname(f), { recursive: true }); return f; };

// ---- 웹 ----
await sharp(await roundedIcon(512)).toFile(out('icons', 'logo.png'));
await sharp(await roundedIcon(512)).toFile(out('icons', 'icon-512.png'));
await sharp(await roundedIcon(192)).toFile(out('icons', 'icon-192.png'));
await sharp(await roundedIcon(64)).toFile(out('icons', 'favicon.png'));
await sharp(await fullBleed(512, 0.8)).toFile(out('icons', 'icon-maskable-512.png'));

// 워드마크: 흰 바탕의 남색 글자 → 글자 모양만 남긴 마스크(흰색+투명도). CSS mask로 라이트/다크 색을 입힘
{
  const { data: w, info: wi } = await sharp(SRC).extract(WORD_BOX).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(wi.width * wi.height * 4);
  for (let i = 0, j = 0; i < w.length; i += 3, j += 4) {
    const lum = 0.299 * w[i] + 0.587 * w[i + 1] + 0.114 * w[i + 2];
    const a = Math.max(0, Math.min(255, Math.round(((250 - lum) / (250 - 25)) * 255)));
    rgba[j] = rgba[j + 1] = rgba[j + 2] = 255;
    rgba[j + 3] = a;
  }
  await sharp(rgba, { raw: { width: wi.width, height: wi.height, channels: 4 } }).trim({ threshold: 1 }).png().toFile(out('icons', 'wordmark.png'));
}

// ---- 안드로이드 ----
const RES = join(root, 'android', 'app', 'src', 'main', 'res');
if (existsSync(RES)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const legacy = Math.round(48 * k), layer = Math.round(108 * k);
    const square = await fullBleed(legacy, 0.98);
    await sharp(square).composite([{ input: roundedMask(legacy, 0.22), blend: 'dest-in' }]).png().toFile(out('android', 'app', 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher.png'));
    await sharp(await fullBleed(legacy, 1)).composite([{ input: circleMask(legacy), blend: 'dest-in' }]).png().toFile(out('android', 'app', 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher_round.png'));
    // 적응형 아이콘: 배경 레이어에 전체 디자인(가운데 72dp 안에 아이콘), 전경은 비움
    await sharp(await fullBleed(layer, 0.72)).toFile(out('android', 'app', 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher_background.png'));
    await sharp({ create: { width: layer, height: layer, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png()
      .toFile(out('android', 'app', 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher_foreground.png'));
  }
  // 시작 화면 (밝은 배경 + 가운데 아이콘)
  const logo = await roundedIcon(512);
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const f of walk(RES).filter(f => f.endsWith('splash.png'))) {
    const meta = await sharp(f).metadata();
    const s = Math.round(Math.min(meta.width, meta.height) * 0.3);
    await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: '#f5f8fc' } })
      .composite([{ input: await sharp(logo).resize(s, s).toBuffer(), gravity: 'center' }])
      .png().toFile(f + '.tmp');
    (await import('node:fs')).renameSync(f + '.tmp', f);
  }
}
console.log('아이콘 생성 완료');
