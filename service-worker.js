const CACHE_NAME = 'teleprompter-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/css/app.css',
  '/js/ui.js',
  '/js/stt.js',
  '/js/audio.js',
  '/js/ai.js',
  '/js/audio-worklet-processor.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then((res) => res || caches.match('/offline.html')))
  );
});
