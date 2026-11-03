// 안드로이드 앱(Capacitor)으로 실행 중일 때만 쓰는 네이티브 기능 연결
// 웹(브라우저)에서는 isNative가 false이고, 나머지 값은 null입니다.
const Cap = window.Capacitor;
export const isNative = !!Cap?.isNativePlatform?.();

const plugin = name => (isNative ? Cap.Plugins?.[name] || Cap.registerPlugin(name) : null);
export const Native = plugin('CardlyNative'); // 문서 스캐너, 글자 인식, Google 권한, 주소록
export const App = plugin('App'); // 뒤로가기 버튼, 앱 종료
const Share = plugin('Share');
const Filesystem = plugin('Filesystem');

export const blobToBase64 = blob =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export const base64ToBlob = (b64, type = 'image/jpeg') => fetch(`data:${type};base64,${b64}`).then(r => r.blob());

const isCancel = e => /cancel/i.test(e?.message || e?.errorMessage || '');

// 반환: 'shared' | 'cancel'
export async function shareNative({ text, files = [] }) {
  const uris = [];
  for (const f of files) {
    const res = await Filesystem.writeFile({ path: f.name, data: await blobToBase64(f.blob), directory: 'CACHE' });
    uris.push(res.uri);
  }
  try {
    await Share.share({ text: text || undefined, files: uris.length ? uris : undefined, dialogTitle: '공유' });
    return 'shared';
  } catch (e) {
    if (isCancel(e)) return 'cancel';
    throw e;
  }
}
