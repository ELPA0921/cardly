// 명함 테두리 찾기 + 원근 보정(반듯하게 펴기)
// 외부 라이브러리 없이 동작하도록 단순한 방법을 씁니다:
//  1) 사진 가장자리의 색을 배경색으로 보고, 배경과 다른 영역을 찾음 (Otsu 임계값)
//  2) 가장 큰 덩어리를 명함으로 보고 네 모서리를 고름
//  3) 사용자가 모서리를 조정한 뒤, 사각형을 직사각형으로 펴서 잘라냄

const DETECT_SIZE = 360;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다.'));
    };
    img.src = url;
  });
}

function otsu(values, bins = 256, max = 1) {
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v / max) * (bins - 1)))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return ((threshold + 0.5) / (bins - 1)) * max;
}

// 이미지 안에서 명함으로 보이는 사각형의 네 모서리 [좌상, 우상, 우하, 좌하] (원본 픽셀 좌표)
export async function detectCard(blob) {
  const img = await loadImage(blob);
  const W = img.naturalWidth, H = img.naturalHeight;
  const scale = Math.min(1, DETECT_SIZE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'blur(1.5px)';
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  // 가장자리 띠의 색 = 배경색 (중앙값)
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const rs = [], gs = [], bs = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 4;
      rs.push(px[i]);
      gs.push(px[i + 1]);
      bs.push(px[i + 2]);
    }
  const med = a => a.sort((p, q) => p - q)[a.length >> 1];
  const bg = [med(rs), med(gs), med(bs)];

  const dist = new Float32Array(w * h);
  for (let i = 0, j = 0; i < dist.length; i++, j += 4) {
    dist[i] = Math.hypot(px[j] - bg[0], px[j + 1] - bg[1], px[j + 2] - bg[2]);
  }
  const t = Math.max(25, otsu(dist, 256, 442));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = dist[i] > t ? 1 : 0;

  // 가장 큰 연결 영역
  const label = new Int32Array(w * h);
  let bestId = 0, bestSize = 0, id = 0;
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    id++;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !label[p - 1]) (label[p - 1] = id), stack.push(p - 1);
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) (label[p + 1] = id), stack.push(p + 1);
      if (y > 0 && mask[p - w] && !label[p - w]) (label[p - w] = id), stack.push(p - w);
      if (y < h - 1 && mask[p + w] && !label[p + w]) (label[p + w] = id), stack.push(p + w);
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
  }

  const fallback = () => {
    const m = 0.06;
    return { width: W, height: H, found: false, corners: [
      { x: W * m, y: H * m }, { x: W * (1 - m), y: H * m }, { x: W * (1 - m), y: H * (1 - m) }, { x: W * m, y: H * (1 - m) },
    ] };
  };
  if (!bestId || bestSize < w * h * 0.12) return fallback();

  // 네 모서리: x+y 최소/최대, x-y 최대/최소
  let tl, tr, br, bl;
  let minS = Infinity, maxS = -Infinity, maxD = -Infinity, minD = Infinity;
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== bestId) continue;
    const x = p % w, y = (p / w) | 0;
    const s = x + y, d = x - y;
    if (s < minS) (minS = s), (tl = { x, y });
    if (s > maxS) (maxS = s), (br = { x, y });
    if (d > maxD) (maxD = d), (tr = { x, y });
    if (d < minD) (minD = d), (bl = { x, y });
  }
  const quad = [tl, tr, br, bl].map(p => ({ x: (p.x + 0.5) / scale, y: (p.y + 0.5) / scale }));
  const area = Math.abs(quad.reduce((a, p, i) => {
    const q = quad[(i + 1) % 4];
    return a + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
  if (area < W * H * 0.12 || area > W * H * 0.985) return fallback();
  return { width: W, height: H, found: true, corners: quad };
}

// 4점 → 4점 원근 변환 행렬 (dst 좌표 → src 좌표)
function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i], { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // 가우스 소거
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]).concat(1);
}

const canvasToBlob = (canvas, quality = 0.9) => new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));

// 사각형 영역을 반듯한 직사각형 이미지로 펴서 JPEG로 돌려줍니다.
export async function warpCard(blob, corners, { maxSize = 1600 } = {}) {
  const img = await loadImage(blob);
  const [tl, tr, br, bl] = corners;
  const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let outW = Math.max(len(tl, tr), len(bl, br));
  let outH = Math.max(len(tl, bl), len(tr, br));
  const k = Math.min(1, maxSize / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * k));
  outH = Math.max(1, Math.round(outH * k));

  const src = document.createElement('canvas');
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const S = sctx.getImageData(0, 0, src.width, src.height);
  const sp = S.data, SW = S.width, SH = S.height;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  const O = octx.createImageData(outW, outH);
  const op = O.data;
  const m = homography(
    [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }],
    corners,
  );
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const z = m[6] * X + m[7] * Y + 1;
      let u = (m[0] * X + m[1] * Y + m[2]) / z - 0.5;
      let v = (m[3] * X + m[4] * Y + m[5]) / z - 0.5;
      u = Math.max(0, Math.min(SW - 1.001, u));
      v = Math.max(0, Math.min(SH - 1.001, v));
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sp[i00 + c] + (sp[i10 + c] - sp[i00 + c]) * fx;
        const bot = sp[i01 + c] + (sp[i11 + c] - sp[i01 + c]) * fx;
        op[o + c] = top + (bot - top) * fy;
      }
      op[o + 3] = 255;
    }
  }
  octx.putImageData(O, 0, 0);
  return canvasToBlob(out);
}
