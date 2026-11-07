/* Cache public application files only. Staff API responses never enter Cache Storage. */
const CACHE = 'cirvio-admin-shell-v6';
const ROOT = self.registration.scope;
const FILES = [
    'index.html', 'offline.html', 'admin.css', 'admin-mobile.css', 'admin.js',
    'data-tables.js', 'admin-pwa.js', 'admin-conversations.js', 'push-client.js', 'manifest.webmanifest',
    'cirvio-logo-header.png', 'cirvio-logo-footer.png',
    'icons/admin-panel-192.png', 'icons/admin-panel-512.png', 'icons/admin-panel-maskable-512.png',
    'icons/admin-panel-apple-touch.png', 'icons/admin-panel-32.png'
];
const SHELL = new Set(FILES.map(file => new URL(file, ROOT).href));

self.addEventListener('push', event => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { /* Show a generic alert for an invalid payload. */ }
    const threadId = /^[a-f\d]{24}$/i.test(payload.threadId || '') ? payload.threadId : '';
    const target = new URL('./', ROOT);
    if (threadId) target.searchParams.set('thread', threadId);
    target.hash = 'messages';
    event.waitUntil(self.registration.showNotification('CIRVIO · New message', { body: 'You have a new message. Tap to open the conversation.', icon: new URL('icons/admin-panel-192.png', ROOT).href, badge: new URL('icons/admin-panel-192.png', ROOT).href, tag: `cirvio-message-${threadId || 'inbox'}`, data: { url: target.href, threadId } }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || './#messages', ROOT);
    if (!target.href.startsWith(ROOT)) return;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
        const existing = clients.find(client => client.url.startsWith(ROOT));
        if (existing) { existing.postMessage({ type: 'OPEN_MESSAGE', threadId: event.notification.data?.threadId }); return existing.focus(); }
        return self.clients.openWindow(target.href);
    }));
});

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
