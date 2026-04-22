const CACHE_NAME = 'teleprompter-v14';
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
  '/js/camera.js',
  '/js/audio-worklet-processor.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Bypass cache completely for API calls and WebSockets
  if (url.pathname.startsWith('/.netlify/functions/') || url.hostname.includes('assemblyai') || url.hostname.includes('openrouter')) {
    return e.respondWith(fetch(e.request));
  }

  // Network-First for JS and CSS — always get fresh code
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    return e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }

  // Cache-First for everything else (images, fonts, HTML)
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(e.request).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
      });
    })
  );
});
