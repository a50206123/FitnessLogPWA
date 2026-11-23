// 每次修改前端檔案都要把版本號加一
const CACHE = 'fitness-v3';

// 需要預先快取的應用程式外殼（App Shell）資源
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './history.js',
  './equipment.js',
  './share.js',
  './logic.js',
  './store.js',
  './demo-data.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 安裝階段：預先快取應用程式外殼
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

// 啟用階段：刪除舊版本快取並接管現有頁面
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// 接收頁面訊息：支援立即啟用新版 Service Worker
self.addEventListener('message', (event) => {
  if (
    event.data === 'SKIP_WAITING' ||
    (event.data && event.data.type === 'SKIP_WAITING')
  ) {
    self.skipWaiting();
  }
});

// 攔截請求：同源與 Firebase CDN 使用快取策略，其餘（如 googleapis/firestore）不攔截
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isSameOrigin = url.origin === self.location.origin;
  const isFirebaseCdn =
    url.origin === 'https://www.gstatic.com' &&
    url.pathname.startsWith('/firebasejs/');

  if (!isSameOrigin && !isFirebaseCdn) {
    // googleapis / firestore 等其他外部請求不攔截
    return;
  }

  // 同源 GET（cache-first 並背景更新）與 gstatic firebasejs（stale-while-revalidate）
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);

      const networkPromise = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }

      const networkResponse = await networkPromise;
      if (networkResponse) {
        return networkResponse;
      }

      // 離線導覽時回退至首頁快取
      if (isSameOrigin && request.mode === 'navigate') {
        return (await cache.match('./index.html')) || (await cache.match('./'));
      }

      return Response.error();
    })
  );
});
