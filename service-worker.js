const CACHE_NAME = 'teleprompter-v18';

// Phase 5: Hard Cache Busting
// We use a Network-First strategy for CSS/JS to ensure the user 
// always sees the latest design updates during this audit phase.

const PRE_CACHE = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 1. Bypass for APIs and Non-HTTP
  if (
    !url.protocol.startsWith('http') ||
    url.pathname.startsWith('/.netlify/functions/') || 
    url.hostname.includes('assemblyai') || 
    url.hostname.includes('openrouter.ai') ||
    e.request.method !== 'GET'
  ) {
    return e.respondWith(fetch(e.request));
  }

  // 2. Network-First Strategy for CSS and JS (Ensures latest design)
  if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    return e.respondWith(
      fetch(e.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }

  // 3. Stale-While-Revalidate for everything else
  e.respondWith(
    caches.match(e.request).then((res) => {
      const fetchPromise = fetch(e.request).then((networkRes) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkRes.clone()));
        return networkRes;
      });
      return res || fetchPromise;
    })
  );
});
