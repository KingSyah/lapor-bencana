/* ═══════════════════════════════════════════
   LAPOR BENCANA — Service Worker (sw.js)
   Cache First, fallback to Network
   ═══════════════════════════════════════════ */

const CACHE_NAME = 'lapor-bencana-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/manifest.json',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
];

// ── INSTALL ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.info('[SW] Caching assets:', ASSETS.length, 'files');
      return cache.addAll(ASSETS);
    })
  );
  // Aktif langsung, tidak tunggu tab lama ditutup
  self.skipWaiting();
});

// ── ACTIVATE ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.info('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    })
  );
  // Ambil kontrol semua tab yang terbuka
  self.clients.claim();
});

// ── FETCH ──
self.addEventListener('fetch', (event) => {
  // Hanya handle GET request
  if (event.request.method !== 'GET') return;

  // Skip cross-origin request (CDN, Telegram API, Supabase, dsb)
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Cache First — kembalikan dari cache jika ada
      if (cachedResponse) {
        // Refresh cache di background (stale-while-revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // Tidak ada di cache — ambil dari network
      return fetch(event.request).then((networkResponse) => {
        // Simpan response baru ke cache untuk next time
        if (networkResponse && networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline & tidak ada di cache — fallback
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
