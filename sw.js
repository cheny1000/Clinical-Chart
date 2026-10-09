/* ============================================================
   sw.js — Service Worker for the Clinical Pharmacy Ward app
   ============================================================
   Strategy:
   - Network-first for navigations (HTML) and JS/CSS, falling back
     to cache when offline. This keeps the app live-updated when
     online and fully usable offline.
   - Cache-first for images and fonts (rarely change).
   - The Supabase CDN library and Google Fonts are also cached
     so the app works without a connection once loaded at least
     once.
   ============================================================ */

const CACHE_VERSION = 'pharma-ward-v40';
const PRECACHE_URLS = [
  './',
  './index.html',
  './css/styles.css',
  './js/medications.js',
  './js/ward.js',
  './js/storage.js',
  './js/supabase-config.js',
  './js/supabase-client.js',
  './js/supabase-sync.js',
  './js/auth.js',
  './js/remote-adapter.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json',
  './img/login-icon.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/icon-192-maskable.png',
  './img/icon-512-maskable.png',
  './img/favicon-32.png',
  './img/apple-touch-icon-180.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js'
];

// ---------- Install: pre-cache the shell ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Use addAll with tolerance — if one URL fails (e.g. CDN), the
      // install should still succeed so the SW can activate.
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] precache miss:', url, err.message);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// ---------- Activate: clear old caches ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Skip non-GET (Supabase mutations, etc.) — let them hit network.
  if (req.method !== 'GET') return;

  // Skip cross-origin requests we don't want to cache (Supabase API).
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isSupabaseCDN = url.origin === 'https://cdn.jsdelivr.net';
  const isGoogleFonts = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';

  // Network-first for navigations (HTML) — always try to get the
  // freshest version, fall back to cache only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for images (same-origin or icons).
  if (isSameOrigin && (req.destination === 'image' || url.pathname.startsWith('/img/'))) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Network-first for everything else (JS, CSS, fonts, CDN).
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful responses from same-origin or our CDN/font sources.
        if (res && res.status === 200 && (isSameOrigin || isSupabaseCDN || isGoogleFonts)) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
