// 이미지 처리 + OCR 엔진
//  - tesseract: 기기 안에서 처리 (무료, 오프라인 가능, 정확도 보통)
//  - vision:    Google Cloud Vision API (정확도 높음, API 키 필요)
import { loadScript } from './drive.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

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

const canvasToBlob = (canvas, type = 'image/jpeg', quality = 0.88) =>
  new Promise(resolve => canvas.toBlob(resolve, type, quality));

// 사진을 적당한 크기의 JPEG로 변환 (회전 포함). 브라우저가 EXIF 방향을 자동 반영합니다.
export async function normalizeImage(blob, { maxSize = 1600, rotate = 0 } = {}) {
  const img = await loadImage(blob);
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const turn = ((rotate % 360) + 360) % 360;
  const canvas = document.createElement('canvas');
  canvas.width = turn % 180 ? h : w;
  canvas.height = turn % 180 ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvasToBlob(canvas);
}

// Tesseract용 전처리: 크기 맞춤 + 흑백 + 대비 늘리기
async function prepareForTesseract(blob) {
  const img = await loadImage(blob);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(2.5, Math.max(1, 2000 / long));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = y;
    hist[y | 0]++;
  }
  const total = px.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  acc = 0;
  for (; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

let tesseractWorker = null;
let progressHandler = null;

const TESS_STATUS = {
  'loading tesseract core': 'OCR 엔진 불러오는 중',
  'initializing tesseract': 'OCR 엔진 준비 중',
  'loading language traineddata': '한국어 인식 데이터 불러오는 중 (처음 한 번)',
  'initializing api': 'OCR 엔진 준비 중',
  'recognizing text': '글자 인식 중',
};

async function getTesseractWorker() {
  if (!tesseractWorker) {
    tesseractWorker = (async () => {
      await loadScript(TESSERACT_SRC);
      const worker = await Tesseract.createWorker(['kor', 'eng'], 1, {
        logger: m => progressHandler?.(m.progress || 0, TESS_STATUS[m.status] || m.status),
      });
      // PSM 11(흩어진 글자): 명함처럼 글자가 띄엄띄엄 배치된 이미지에서 훨씬 정확합니다.
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      return worker;
    })();
    tesseractWorker.catch(() => (tesseractWorker = null));
  }
  return tesseractWorker;
}

async function recognizeTesseract(blob, onProgress) {
  progressHandler = onProgress;
  onProgress?.(0, 'OCR 엔진 불러오는 중');
  const worker = await getTesseractWorker();
  const canvas = await prepareForTesseract(blob);
  const { data } = await worker.recognize(canvas);
  progressHandler = null;
  const lines = (data.lines || []).map(l => {
    const hs = (l.words || []).map(w => w.bbox.y1 - w.bbox.y0).filter(h => h > 0);
    const height = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : l.bbox.y1 - l.bbox.y0;
    return { text: l.text.trim(), height };
  });
  return { text: data.text || '', lines: lines.filter(l => l.text) };
}

const blobToBase64 = blob =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function recognizeVision(blob, apiKey, onProgress) {
  onProgress?.(0.2, 'Google Vision으로 인식 중');
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: await blobToBase64(blob) },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['ko', 'en'] },
      }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error || json.responses?.[0]?.error) {
    const msg = json.error?.message || json.responses?.[0]?.error?.message || res.statusText;
    throw new Error('Google Vision 오류: ' + msg);
  }
  onProgress?.(1, '인식 완료');
  const full = json.responses?.[0]?.fullTextAnnotation;
  if (!full) return { text: '', lines: [] };
  return { text: full.text || '', lines: visionLines(full) };
}

// Vision 응답을 줄 단위로 재구성 (글자 크기 = 단어 상자 높이)
function visionLines(full) {
  const lines = [];
  let cur = { text: '', heights: [] };
  const flush = () => {
    const text = cur.text.trim();
    if (text) {
      const height = cur.heights.reduce((a, b) => a + b, 0) / cur.heights.length;
      lines.push({ text, height });
    }
    cur = { text: '', heights: [] };
  };
  const boxHeight = box => {
    const ys = (box?.vertices || []).map(v => v.y || 0);
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  };
  for (const page of full.pages || [])
    for (const block of page.blocks || [])
      for (const para of block.paragraphs || []) {
        for (const word of para.words || []) {
          cur.heights.push(boxHeight(word.boundingBox));
          for (const sym of word.symbols || []) {
            cur.text += sym.text;
            const br = sym.property?.detectedBreak?.type;
            if (br === 'SPACE' || br === 'SURE_SPACE') cur.text += ' ';
            else if (br === 'EOL_SURE_SPACE' || br === 'LINE_BREAK') flush();
          }
        }
        flush();
      }
  return lines;
}

export async function recognize(blob, { engine = 'tesseract', apiKey = '', onProgress } = {}) {
  if (engine === 'vision' && apiKey) return { ...(await recognizeVision(blob, apiKey, onProgress)), engine: 'vision' };
  return { ...(await recognizeTesseract(blob, onProgress)), engine: 'tesseract' };
}
