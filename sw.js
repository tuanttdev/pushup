// Service worker: lưu app + mô hình vào máy để dùng offline.
const CACHE = 'pushup-v4';
const LOCAL = [
  './', './index.html', './app.js', './counter.js', './manifest.webmanifest',
  './vendor/vision_bundle.mjs', './vendor/wasm/vision_wasm_internal.js', './vendor/wasm/vision_wasm_internal.wasm',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(LOCAL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Chặn gói thống kê sử dụng mà thư viện MediaPipe tự gửi về Google
  if (url.hostname === 'odml.pa.googleapis.com') { e.respondWith(new Response(null, { status: 204 })); return; }
  if (req.method !== 'GET') return;
  const isModel = url.hostname === 'storage.googleapis.com' && url.pathname.endsWith('.task');
  const isLocal = url.origin === location.origin;
  if (!isModel && !isLocal) return;

  // File lớn (mô hình, wasm): lấy từ cache trước
  if (isModel || url.pathname.endsWith('.wasm')) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }
  // File nhỏ của app: dùng cache ngay, đồng thời cập nhật ngầm từ mạng
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
