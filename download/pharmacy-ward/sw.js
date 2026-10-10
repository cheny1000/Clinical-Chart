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

const CACHE_VERSION = 'pharma-ward-v49';
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
  './js/chart-image.js',
  './js/chart-bridge.js',
  './js/pills-form.js',
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
  // For same-origin JS files specifically, we bypass cache entirely
  // (no fallback) so code changes ALWAYS take effect — this avoids
  // the situation where a user is stuck on an old cached version of
  // app.js after a deployment. JS files are small and the app already
  // uses ?v=Date.now() cache-busting in index.html.
  const isSameOriginJS = isSameOrigin && req.destination === 'script';
  if (isSameOriginJS) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        // For JS, no cache fallback — better to fail loudly than
        // serve stale code that confuses the user.
        .catch(() => new Response('/* network error — JS unavailable */', {
          status: 503,
          headers: { 'Content-Type': 'application/javascript' }
        }))
    );
    return;
  }

  // All other resources (CSS, fonts, CDN) — network-first with cache fallback.
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
