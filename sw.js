// 오프라인에서도 앱 화면이 열리도록 앱 파일을 캐시합니다 (네트워크 우선).
const CACHE = 'bc-shell-v20';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/logo.png', 'icons/wordmark.png', 'icons/favicon.png',
  'js/app.js', 'js/store.js', 'js/sync.js', 'js/drive.js', 'js/idb.js', 'js/ocr.js',
  'js/parser.js', 'js/share.js', 'js/fields.js', 'js/icons.js', 'js/config.js', 'js/scan.js', 'js/native.js', 'js/contactRules.js', 'js/hanja.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});
