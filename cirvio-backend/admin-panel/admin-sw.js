/* Cache public application files only. Staff API responses never enter Cache Storage. */
const CACHE = 'cirvio-admin-shell-v3';
const ROOT = self.registration.scope;
const FILES = [
    'index.html', 'offline.html', 'admin.css', 'admin-mobile.css', 'admin.js',
    'data-tables.js', 'admin-pwa.js', 'admin-conversations.js', 'manifest.webmanifest',
    'cirvio-logo-header.png', 'cirvio-logo-footer.png',
    'icons/admin-panel-192.png', 'icons/admin-panel-512.png', 'icons/admin-panel-maskable-512.png',
    'icons/admin-panel-apple-touch.png', 'icons/admin-panel-32.png'
];
const SHELL = new Set(FILES.map(file => new URL(file, ROOT).href));

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...SHELL])));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('cirvio-admin-shell-') && key !== CACHE)
        .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization')) return;
    // The allowlist also excludes same-origin API routes, uploads and private downloads.
    const isHome = url.pathname === new URL(ROOT).pathname || url.pathname === new URL('index.html', ROOT).pathname;
    if (request.mode === 'navigate' && isHome) {
        event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(new URL('offline.html', ROOT).href)));
        return;
    }
    if (url.search || !SHELL.has(url.href)) return;
    event.respondWith(fetch(request).then(response => {
        if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
        }
        return response;
    }).catch(() => caches.match(request)));
});
