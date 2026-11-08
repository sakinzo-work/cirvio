/* ============================================================
   CIRVIO — service worker
   App-shell precache + runtime caching so the site installs as a
   PWA and keeps working (mostly) offline.
============================================================ */
const CIRVIO_CACHE = 'cirvio-cache-v18';

const APP_SHELL = [
    './',
    'index.html',
    'login.html',
    'explore.html',
    'product.html',
    'sell.html',
    'profile.html',
    'messages.html',
    'my-listings.html',
    'saved.html',
    'legal.html',
    'status.html',
    'offline.html',
    'styles.css',
    'config.js',
    'api.js',
    'common.js',
    'sell-categories.js',
    'seo.js',
    'manifest.json',
    'cirvio-logo-header.png',
    'cirvio-logo-footer.png',
    'cirvio-app-icon.png',
    'cirvio-app-icon-source.jpeg',
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
    'apple-touch-icon.png'
];

self.addEventListener('push', event => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { /* Show a generic alert for an invalid payload. */ }
    const listingTitles = { viewed: 'CIRVIO viewed your listing', approved: 'Your listing is approved', rejected: 'Your listing needs changes', 'buyer-selected': 'A buyer selected your listing' };
    if (payload.kind === 'listing' && /^[a-f\d]{24}$/i.test(payload.productId || '') && listingTitles[payload.status]) {
        const target = new URL('status.html', self.registration.scope);
        target.searchParams.set('listing', payload.productId);
        const notificationId = /^[a-f\d]{24}$/i.test(payload.notificationId || '') ? payload.notificationId : '';
        if (notificationId) target.searchParams.set('notification', notificationId);
        event.waitUntil(self.registration.showNotification(listingTitles[payload.status], {
            body: String(payload.body || 'Open Listing Status to see the update.').slice(0, 500),
            icon: new URL('icon-192.png', self.registration.scope).href,
            tag: `cirvio-listing-${notificationId || `${payload.productId}-${payload.status}`}`,
            data: { kind: 'listing', url: target.href, productId: payload.productId, notificationId }
        }));
        return;
    }
    const threadId = /^[a-f\d]{24}$/i.test(payload.threadId || '') ? payload.threadId : '';
    const target = new URL('messages.html', self.registration.scope);
    if (threadId) target.searchParams.set('thread', threadId);
    event.waitUntil(self.registration.showNotification('CIRVIO · New message', { body: 'You have a new message. Tap to open the conversation.', icon: new URL('icon-192.png', self.registration.scope).href, badge: new URL('icon-192.png', self.registration.scope).href, tag: `cirvio-message-${threadId || 'inbox'}`, data: { url: target.href, threadId } }));
});
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || 'messages.html', self.registration.scope);
    const scope = new URL(self.registration.scope);
    if (target.origin !== scope.origin || !target.pathname.startsWith(scope.pathname) || !['messages.html', 'status.html'].includes(target.pathname.split('/').pop())) return;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
        const existing = clients.find(client => new URL(client.url).origin === target.origin && new URL(client.url).pathname === target.pathname);
        if (existing) {
            existing.postMessage(event.notification.data?.kind === 'listing'
                ? { type: 'OPEN_LISTING_STATUS', productId: event.notification.data.productId, notificationId: event.notification.data.notificationId }
                : { type: 'OPEN_MESSAGE', threadId: event.notification.data?.threadId });
            return existing.focus();
        }
        return self.clients.openWindow(target.href);
    }));
});

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
            Promise.all(keys.filter((k) => k.startsWith('cirvio-cache-') && k !== CIRVIO_CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // Conversations and authenticated data always use the network, including cross-origin API calls.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || req.headers.has('authorization')) return;

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

    /* same-origin code assets: network-first so deployments are not hidden by old cache */
    if (url.origin === location.origin && /\.(?:html|js|css)$/i.test(url.pathname)) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CIRVIO_CACHE).then((c) => c.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req))
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
