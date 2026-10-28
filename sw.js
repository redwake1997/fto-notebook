// FTO Notebook service worker: keeps the app itself available offline.
// It caches only the app's own files. It never sees or stores notes or the guide,
// which live in the browser's local storage on this device.
const VERSION = 'fto-notebook-v1.0.0';
const FILES = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/textcheck.js',
  'js/scoring.js',
  'js/narrative.js',
  'js/handoff.js',
  'lib/qrcode.js',
  'lib/jsQR.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates arrive), falling back to the cached copy when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
