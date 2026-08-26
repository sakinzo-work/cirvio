/* ============================================================
   CIRVIO — service worker
   App-shell precache + runtime caching so the site installs as a
   PWA and keeps working (mostly) offline.
============================================================ */
const CIRVIO_CACHE = 'cirvio-cache-v2';

const APP_SHELL = [
    './',
    'index.html',
    'explore.html',
    'product.html',
    'sell.html',
    'profile.html',
    'status.html',
    'offline.html',
    'styles.css',
    'common.js',
    'manifest.json',
    'cirvio-logo-header.png',
    'cirvio-logo-footer.png',
    'icon-72.png',
    'icon-96.png',
    'icon-128.png',
    'icon-144.png',
    'icon-152.png',
    'icon-192.png',
    'icon-384.png',
    'icon-512.png',
    'icon-maskable-192.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
    'favicon.ico'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CIRVIO_CACHE)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CIRVIO_CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    /* page navigations: network-first, fall back to cache, then offline page */
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CIRVIO_CACHE).then((c) => c.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req).then((r) => r || caches.match('offline.html')))
        );
        return;
    }

    /* same-origin static assets: cache-first, refresh in background */
    if (url.origin === location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                const fetchPromise = fetch(req).then((res) => {
                    const copy = res.clone();
                    caches.open(CIRVIO_CACHE).then((c) => c.put(req, copy));
                    return res;
                }).catch(() => cached);
                return cached || fetchPromise;
            })
        );
        return;
    }

    /* cross-origin (fonts, unsplash images): stale-while-revalidate */
    event.respondWith(
        caches.match(req).then((cached) => {
            const fetchPromise = fetch(req).then((res) => {
                caches.open(CIRVIO_CACHE).then((c) => c.put(req, res.clone()));
                return res;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});