const CACHE_NAME = 'teleprompter-v3';
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
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Bypass cache completely for API calls and WebSockets
  if (url.pathname.startsWith('/.netlify/functions/') || url.hostname.includes('assemblyai') || url.hostname.includes('openrouter')) {
    return e.respondWith(fetch(e.request));
  }

  // Cache-First strategy for assets
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      // 1. Return from cache if we have it
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // 2. Otherwise fetch from network
      return fetch(e.request).catch(() => {
        // 3. Fallback to offline page for navigation requests if network fails
        if (e.request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
      });
    })
  );
});
