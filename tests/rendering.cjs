/* Browser regression checks use fixtures only: no database or real accounts.
   Run with Playwright available: node tests/rendering.cjs
   Optional: CIRVIO_BROWSER_PATH points to an installed Chromium browser. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('../cirvio-backend/node_modules/express');
const { chromium } = require('playwright');
const Product = require('../cirvio-backend/models/Product');

const root = path.resolve(__dirname, '..');
const app = express();
app.use('/admin', express.static(path.join(root, 'cirvio-backend/admin-panel')));
app.use(express.static(path.join(root, 'cirvio-frontend')));
app.use('/fixture-products', require('../cirvio-backend/routes/products'));
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#ded9c4"/></svg>');
const user = { _id: 'staff1', id: 'staff1', name: 'Test Staff', email: 'staff@example.test', role: 'admin', status: 'active', city: 'Bengaluru', createdAt: '2025-03-01', trustRatingAverage: 4.2, trustRatingCount: 5 };
const products = Array.from({ length: 61 }, (_, index) => ({
    _id: 'p' + index, title: index === 0 ? 'Book "quoted" <b>literal</b> & notes' : 'Book ' + index,
    category: index % 2 ? 'Notes' : 'School Books', condition: 'Good', type: index === 1 ? 'free' : 'sell',
    price: index === 1 ? 0 : 100 + index, originalPrice: 300, description: 'Fixture description',
    images: [image], seller: { _id: 'seller1', name: 'Seller & Co', email: 'seller@example.test' },
    college: index % 2 ? 'College B' : 'College A',
    status: index % 2 ? 'pending' : 'approved', createdAt: '2026-10-01T10:00:00Z', reviewViewedAt: null
}));
const users = Array.from({ length: 61 }, (_, index) => ({
    _id: 'u' + index, name: 'Person ' + index, email: `person${index}@example.test`, role: index % 2 ? 'employee' : 'user',
    college: 'Test College', city: 'Mumbai', status: 'active', listingsCount: index, ordersCount: 0, createdAt: '2026-10-01'
}));
const messages = [{ _id: 'm1', sender: users[0], product: products[0], text: 'Is this available?', replies: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
const purchases = products.map((product, index) => ({
    orderId: 'o' + index, title: product.title, product, buyer: users[0], seller: users[1], price: 100, qty: 1,
    date: '2026-10-01', paymentStatus: 'pending', dispatchStatus: 'not-dispatched', orderStatus: 'placed'
}));
const stats = { totalUsers: 61, totalProducts: 61, pendingProducts: 30, approvedProducts: 31, soldProducts: 0, totalOrders: 61, totalRevenue: 0 };
const defaults = pathname => {
    if (pathname === '/api/auth/me') return { user };
    if (pathname === '/api/admin/stats') return stats;
    if (pathname === '/api/admin/users') return { users };
    if (pathname === '/api/admin/products') return { products };
    if (pathname === '/api/admin/purchases') return { purchases };
    if (pathname === '/api/admin/messages') return { messages };
    if (pathname === '/api/admin/site-media') return { media: {} };
    if (pathname === '/api/admin/client-origins') return { origins: [], envOrigins: [] };
    if (pathname === '/api/messages/my') return { messages: [] };
    if (pathname === '/api/notifications') return { notifications: [], unreadCount: 0 };
    if (pathname === '/api/orders/selling') return { orders: [] };
    if (pathname === '/api/products/mine') return { products: [] };
    if (pathname === '/api/products') return { products };
    if (pathname === '/api/products/categories') return require('../cirvio-backend/services/listing-categories').taxonomy;
    if (pathname.startsWith('/api/products/')) return { product: products[0] };
    return {};
};

async function mockPush(page, { permission = 'default', nextPermission = 'granted', subscribed = false, showPrompt = false, supported = true } = {}) {
    await page.addInitScript(options => {
        localStorage.setItem('cirvio_api_base', location.origin);
        if (options.showPrompt) localStorage.removeItem('cirvio_push_prompt_site_v1');
        const initial = { permission: options.permission, nextPermission: options.nextPermission, permissionRequests: 0, subscribed: options.subscribed, unsubscribed: 0 };
        const state = window.pushFixture = JSON.parse(sessionStorage.getItem('fixture_push') || 'null') || initial;
        const save = () => sessionStorage.setItem('fixture_push', JSON.stringify(state));
        Object.defineProperty(window, 'Notification', { configurable: true, value: { get permission() { return state.permission; }, async requestPermission() { state.permissionRequests++; state.permission = state.nextPermission; save(); return state.permission; } } });
        Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} });
        if (!options.supported) delete window.PushManager;
        const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'fixture', auth: 'fixture' } }; }, async unsubscribe() { state.subscribed = false; state.unsubscribed++; save(); return true; } };
        const registration = { active: {}, async update() {}, addEventListener() {}, pushManager: { async getSubscription() { return state.subscribed ? subscription : null; }, async subscribe(options) { if (!options.userVisibleOnly || options.applicationServerKey.length !== 65) throw new Error('Invalid push options'); state.subscribed = true; save(); return subscription; } } };
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { async getRegistration() { return registration; }, async register() { return registration; }, addEventListener() {} } });
    }, { permission, nextPermission, subscribed, showPrompt, supported });
}

(async () => {
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const chromePath = process.env.CIRVIO_BROWSER_PATH || (process.platform === 'win32' && fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    const browser = await chromium.launch({ headless: true, executablePath: chromePath });
    let passed = 0;
    async function check(name, run, responder, signedIn = false) {
        if (process.env.RENDER_TEST_FILTER && !name.toLowerCase().includes(process.env.RENDER_TEST_FILTER.toLowerCase())) return;
        const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
        await context.addInitScript(signedIn => {
            if (!sessionStorage.getItem('fixture_prompt_seeded')) {
                localStorage.setItem('cirvio_push_prompt_site_v1', JSON.stringify({ until: Date.now() + 86400000 }));
                sessionStorage.setItem('fixture_prompt_seeded', 'true');
            }
            if (signedIn) {
                localStorage.setItem('cirvio_admin_token', 'fixture-token');
                localStorage.setItem('cirvio_token', 'fixture-token');
            }
        }, signedIn);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/api/')) {
                let reply = responder ? await responder(url.pathname, route) : undefined;
                if (reply === 'handled') return;
                reply = reply || { body: defaults(url.pathname) };
                return route.fulfill({ status: reply.status || 200, contentType: reply.contentType || 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body) });
            }
            if (url.origin !== base) return route.abort();
            return route.continue();
        });
        try {
            await run(page, base);
            assert.deepEqual(errors, [], 'No uncaught browser errors');
            console.log('PASS ' + name);
            passed++;
        } finally { await context.close(); }
    }
    try {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await check('Homepage loading, real counts, escaping, load more and search', async (page, base) => {
            await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
            await page.locator('#productGrid .data-skeleton').first().waitFor();
            assert.equal(await page.locator('#productGrid').getAttribute('aria-busy'), 'true');
            assert.equal(await page.locator('#productGrid').innerText().then(text => text.includes('No listings')), false);
            release();
            await page.waitForFunction(() => document.querySelectorAll('#productGrid .p-card').length === 8);
            assert.equal(await page.locator('#productGrid .p-title').first().innerText(), products[0].title);
            assert.equal(await page.locator('#productGrid .p-title b').count(), 0);
            assert.equal(await page.locator('[data-category-count="School Books"]').innerText(), '31 items');
            if (process.env.CIRVIO_SCREENSHOT_DIR) {
                await page.locator('#productGrid').scrollIntoViewIfNeeded();
                await page.waitForFunction(() => getComputedStyle(document.getElementById('productGrid')).opacity === '1');
                await page.screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, 'website.png') });
            }
            await page.locator('#loadMoreBtn').click();
            assert.equal(await page.locator('#productGrid .p-card').count(), 12);
            await page.locator('#searchInput').fill('Book 60');
            await page.locator('#searchInput').press('Enter');
            await page.waitForFunction(() => document.querySelectorAll('#productGrid .p-card').length === 1);
            assert.match(await page.locator('.data-result-count').innerText(), /1 of 1/);
        }, async pathname => { if (pathname === '/api/products') { await gate; return { body: { products } }; } });

        let attempts = 0;
        await check('Homepage failure and retry', async (page, base) => {
            await page.goto(base + '/index.html');
            await page.locator('#productGrid .data-retry').waitFor();
            assert.match(await page.locator('#productGrid').innerText(), /Fixture server failure/);
            await page.locator('#productGrid .data-retry').click();
            await page.waitForFunction(() => document.querySelectorAll('#productGrid .p-card').length === 8);
        }, pathname => pathname === '/api/products' && ++attempts === 1 ? { status: 503, body: { message: 'Fixture server failure' } } : undefined);

        await check('Explore categories, literal search attributes and free filter', async (page, base) => {
            await page.goto(base + '/explore.html');
            await page.locator('#exploreSections .p-card').first().waitFor();
            assert.equal(await page.locator('#cat-school-books .p-card').count(), 31);
            assert.match(await page.locator('#cat-school-books .es-head-text').innerText(), /31 listings available/);
            await page.locator('#exploreSearchInput').fill('"quoted"');
            assert.equal(await page.locator('#cat-school-books .p-card:visible').count(), 1);
            await page.locator('#exploreSearchInput').fill('');
            await page.locator('[data-filter="free"]').click();
            assert.equal(await page.locator('#cat-free-donations .p-card:visible').count(), 1);
        });

        let productAttempts = 0;
        await check('Product failure retries without losing detail controls', async (page, base) => {
            await page.goto(base + '/product.html?id=p0');
            await page.locator('.data-retry').waitFor();
            await page.locator('.data-retry').click();
            await page.locator('#pdTitle').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#pdTitle').innerText(), products[0].title);
            await page.locator('#pdOfferBtn').click();
            assert.equal(await page.locator('#offerPanel').evaluate(el => el.classList.contains('open')), true);
        }, pathname => pathname === '/api/products/p0' && ++productAttempts === 1 ? { status: 503, body: { message: 'Try later' } } : undefined);

        await check('Missing product clears skeleton and shows unavailable state', async (page, base) => {
            await page.goto(base + '/product.html');
            await page.getByText('Listing unavailable', { exact: true }).waitFor();
            assert.equal(await page.locator('.data-skeleton').count(), 0);
        });

        let relatedRelease;
        const relatedGate = new Promise(resolve => { relatedRelease = resolve; });
        await check('Product detail does not wait for recommendations', async (page, base) => {
            await page.goto(base + '/product.html?id=p0', { waitUntil: 'domcontentloaded' });
            await page.locator('#pdTitle').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#pdTitle').innerText(), products[0].title);
            relatedRelease();
        }, async pathname => { if (pathname === '/api/products') { await relatedGate; return { body: { products } }; } });

        await check('Admin paginates, searches all rows, exports all matches and preserves drafts', async (page, base) => {
            await page.goto(base + '/admin/');
            await page.waitForFunction(() => document.querySelector('#statUsers').textContent === '61');
            await page.locator('.nav-btn[data-tab="users"]').click();
            await page.waitForFunction(() => document.querySelectorAll('#usersTable tbody tr').length === 25);
            const footer = page.locator('#tab-users .data-pagination');
            await footer.locator('[data-page-next]').click();
            assert.match(await page.locator('#usersTable tbody tr').first().innerText(), /Person 25/);
            await page.locator('#usersSearchInput').fill('person60@example.test');
            await page.waitForFunction(() => document.querySelectorAll('#usersTable tbody tr').length === 1);
            assert.match(await page.locator('#usersTable tbody').innerText(), /Person 60/);
            await page.locator('#usersSearchInput').fill('not-a-real-user');
            await page.getByText('No results match your search. Try another search term.').waitFor();
            await page.locator('#usersSearchInput').fill('');
            const downloadPromise = page.waitForEvent('download');
            await page.locator('[data-export-table="usersTable"]').click();
            const download = await downloadPromise;
            const csv = fs.readFileSync(await download.path(), 'utf8');
            assert.equal(csv.split('\n').length, 62);
            await page.locator('#tab-users .table-toolbar select').selectOption('10');
            assert.equal(await page.locator('#usersTable tbody tr').count(), 10);
            if (process.env.CIRVIO_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, 'admin.png') });
            await page.locator('.nav-btn[data-tab="messages"]').click();
            await page.locator('#sideReplyText').fill('Keep this unsent draft');
            await page.evaluate(() => loadMessages({ notify: true }));
            assert.equal(await page.locator('#sideReplyText').inputValue(), 'Keep this unsent draft');
            await page.evaluate(() => renderMessageSidePanel('m1'));
            assert.equal(await page.locator('#sideReplyText').inputValue(), 'Keep this unsent draft');
            await page.evaluate(async () => {
                const original = window.fetch;
                window.fetch = async (url, options) => String(url).endsWith('/api/admin/messages')
                    ? new Response(JSON.stringify({ messages: [{ ...ADMIN_MESSAGES.get('m1'), replies: [{ senderRole: 'buyer', text: 'Another question', createdAt: '2026-10-02' }] }] }))
                    : original(url, options);
                try { await loadMessages({ notify: true }); }
                finally { window.fetch = original; }
            });
            assert.equal(await page.locator('#sideReplyText').inputValue(), 'Keep this unsent draft');
            await page.evaluate(async () => {
                const original = window.fetch;
                const resolveRequests = [];
                window.fetch = () => new Promise(resolve => resolveRequests.push(resolve));
                try {
                    const older = loadStats();
                    const newer = loadStats();
                    resolveRequests[1](new Response(JSON.stringify({ totalUsers: 202 })));
                    await newer;
                    resolveRequests[0](new Response(JSON.stringify({ totalUsers: 101 })));
                    await older;
                } finally { window.fetch = original; }
            });
            assert.equal(await page.locator('#statUsers').innerText(), '202');
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('#mobileMenuBtn').click();
            await page.locator('.nav-btn[data-tab="users"]').click();
            assert.equal(await page.locator('#usersTable tbody tr').count(), 10);
        }, undefined, true);

        let statsAttempts = 0;
        await check('An admin section can fail and recover independently', async (page, base) => {
            await page.goto(base + '/admin/');
            await page.locator('#data-feedback-statGrid .soft-btn').waitFor();
            await page.locator('#latestListingsTable tbody tr').first().waitFor();
            await page.locator('#data-feedback-statGrid .soft-btn').click();
            await page.waitForFunction(() => document.querySelector('#statUsers').textContent === '61');
        }, pathname => pathname === '/api/admin/stats' && ++statsAttempts === 1 ? { status: 503, body: { message: 'Stats unavailable' } } : undefined, true);

        await check('Saved listings show an empty state after loading', async (page, base) => {
            await page.goto(base + '/saved.html');
            await page.locator('#savedEmpty').waitFor({ state: 'visible' });
            assert.equal(await page.locator('.data-skeleton').count(), 0);
            assert.equal(await page.locator('#savedGrid').getAttribute('aria-busy'), 'false');
        }, undefined, true);

        await check('Product values normalize safely and repeated reads share a request', async (page, base) => {
            await page.goto(base + '/index.html');
            const values = await page.evaluate(async () => {
                const product = normalizeCirvioProduct({ price: '150', originalPrice: '300', seller: { _id: 'id1', name: 'Original Seller' }, images: null, createdAt: 'bad-date' });
                const listing = cirvioProductToListing(product);
                const invalid = normalizeCirvioProduct({ price: 'invalid', originalPrice: Infinity });
                const original = window.fetch;
                let count = 0;
                window.fetch = async () => { count++; return new Response(JSON.stringify({ products: [] })); };
                try { await Promise.all([CirvioAPI.getProducts('?fixture=1'), CirvioAPI.getProducts('?fixture=1')]); }
                finally { window.fetch = original; }
                return { price: product.price, orig: product.orig, seller: listing.seller, image: product.img, invalidPrice: invalid.price, invalidOrig: invalid.orig, count };
            });
            assert.equal(values.price, 150);
            assert.equal(values.orig, 300);
            assert.equal(values.seller, 'Original Seller');
            assert.match(values.image, /^data:image\/svg\+xml/);
            assert.equal(values.invalidPrice, 0);
            assert.equal(values.invalidOrig, 0);
            assert.equal(values.count, 1);
        });

        await check('Marketplace totals and college filtering come from listings', async (page, base) => {
            await page.goto(base + '/index.html');
            await page.waitForFunction(() => document.getElementById('heroListingCount').textContent === '61');
            assert.equal(await page.locator('#heroCampusCount').innerText(), '2');
            assert.equal(await page.locator('#heroDonationCount').innerText(), '1');
            if (process.env.CIRVIO_SCREENSHOT_DIR) {
                await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-copy')).opacity === '1');
                await page.screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, 'homepage-summary.png') });
            }
            assert.equal(await page.locator('#collegeSelect option').count(), 3);
            assert.match(await page.locator('#collegeList').innerText(), /College A.*31 listings/s);
            await page.locator('#collegeSelect').selectOption('College B');
            await page.locator('#browseCampusBtn').click();
            assert.match(await page.locator('.data-result-count').innerText(), /of 30 listings at College B/);
            assert.equal(await page.locator('#testimonials, #nlForm').count(), 0);
            await page.locator('#searchInput').fill('quoted');
            await page.locator('#searchInput').focus();
            assert.equal(await page.locator('#searchSuggest .sg-item').innerText(), products[0].title);
            assert.equal(await page.locator('#productGrid .p-seller svg').count(), 0);
        });

        await check('An empty marketplace contains no demo records or invented totals', async (page, base) => {
            await page.goto(base + '/index.html');
            await page.waitForFunction(() => document.getElementById('heroListingCount').textContent === '0');
            assert.equal(await page.locator('#heroCampusCount').innerText(), '0');
            assert.equal(await page.locator('#heroDonationCount').innerText(), '0');
            assert.equal(await page.locator('#productGrid .p-card').count(), 0);
            assert.equal(await page.locator('#collegeSelect option').count(), 1);
            assert.match(await page.locator('#collegeList').innerText(), /No colleges are listed yet/);
            assert.equal(await page.locator('[data-header-location]').innerText(), 'All locations');
        }, pathname => pathname === '/api/products' ? { body: { products: [] } } : undefined);

        await check('Seller badges, ratings and membership dates use API metadata', async (page, base) => {
            await page.goto(base + '/product.html?id=p0');
            await page.locator('#pdTitle').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#sellerRating').innerText(), '4.3 · 7 ratings');
            assert.match(await page.locator('#sellerSince').innerText(), /Mar 2025/);
            assert.equal(await page.locator('#sellerVerified').isVisible(), true);
        }, pathname => pathname === '/api/products/p0' ? { body: { product: { ...products[0], seller: { ...products[0].seller, verified: true, createdAt: '2025-03-01', trustRatingAverage: 4.3, trustRatingCount: 7 } } } } : undefined);

        await check('Missing seller metadata never invents reviews or verification', async (page, base) => {
            await page.goto(base + '/product.html?id=p0');
            await page.locator('#pdTitle').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#sellerRating').innerText(), 'No ratings yet');
            assert.equal(await page.locator('#sellerSince').isVisible(), false);
            assert.equal(await page.locator('#sellerVerified').isVisible(), false);
        });

        await check('Own profile uses account ratings, join date, city and sold listings', async (page, base) => {
            await page.goto(base + '/profile.html');
            await page.waitForFunction(() => document.getElementById('trustAverage').textContent === '4.2');
            assert.match(await page.locator('#joinedBadge').innerText(), /Mar 2025/);
            assert.equal(await page.locator('[data-header-location]').innerText(), 'Bengaluru');
            assert.equal(await page.locator('#trustStars button:not(:disabled)').count(), 0);
            assert.equal(await page.locator('#statSold').innerText(), '1');
        }, pathname => pathname === '/api/products/mine' ? { body: { products: [{ ...products[0], status: 'sold' }] } } : undefined, true);

        await check('An unavailable public profile never displays the viewer account data', async (page, base) => {
            await page.goto(base + '/profile.html?user=missing');
            await page.getByText('Profile unavailable', { exact: true }).waitFor();
            assert.equal(await page.locator('.profile-stats').isVisible(), false);
            assert.equal(await page.locator('#trustAverage').innerText(), '—');
            assert.equal(await page.locator('#trustStars button:not(:disabled)').count(), 0);
        }, pathname => pathname === '/api/auth/users/missing' ? { status: 404, body: { message: 'User not found' } } : undefined, true);

        const lifecycleProduct = { ...products[0], _id: '000000000000000000000777', status: 'sold', reviewViewedAt: '2026-11-07T08:00:00Z', decidedAt: '2026-11-07T09:00:00Z', buyerSelectedAt: '2026-11-07T10:00:00Z', seller: user };
        const lifecycleOrder = { _id: '000000000000000000000778', buyer: { name: 'Buyer <b>name</b>' }, items: [{ product: lifecycleProduct._id, seller: user._id, title: lifecycleProduct.title, price: 100, qty: 1 }], status: 'placed', paymentStatus: 'pending', dispatchStatus: 'not-dispatched', createdAt: '2026-11-07T10:00:00Z' };
        const lifecycleAlerts = ['viewed', 'approved', 'buyer-selected'].map((status, index) => ({ id: '00000000000000000000078' + index, backendId: '00000000000000000000078' + index, type: 'listing', status, productId: lifecycleProduct._id, title: ['CIRVIO viewed your listing', 'Your listing is approved', 'A buyer selected your listing'][index], text: lifecycleProduct.title, link: 'status.html?listing=' + lifecycleProduct._id, read: false, createdAt: '2026-11-07T10:0' + index + ':00Z' }));
        await check('Seller notifications persist and show viewed, approved and buyer-selected milestones', async (page, base) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto(base + '/index.html');
            await page.waitForFunction(() => CirvioStore.getNotifications().filter(item => item.type === 'listing').length === 3);
            await page.locator('button[aria-label="Notifications"]').first().click();
            assert.equal(await page.locator('#npList .np-item').count(), 3);
            await page.getByText('A buyer selected your listing', { exact: true }).click();
            await page.locator('.buyer-selection-details').waitFor();
            assert.equal(await page.locator('#sumSelected').innerText(), '1');
            assert.match(await page.locator('.buyer-selection-details').innerText(), /Buyer <b>name<\/b>/);
            assert.equal(await page.locator('.buyer-selection-details b').count(), 0);
            assert.match(await page.locator('.buyer-selection-details').innerText(), /pending/);
            assert.equal(await page.locator('.listing-milestones .tracker-step.done').count(), 4);
            assert.equal(await page.locator('.status-badge.rejected').count(), 0, 'A selected listing is never labeled rejected');
            assert.equal(await page.locator('.notification-highlight').count(), 1);
            if (process.env.CIRVIO_SCREENSHOT_DIR) await page.locator('.approval-card').screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, 'listing-lifecycle-mobile.png') });
            assert.equal(await page.evaluate(() => CirvioStore.getMessages().length), 0, 'Listing updates do not manufacture chat messages');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.reload();
            await page.locator('.buyer-selection-details').waitFor();
            await page.locator('button[aria-label="Notifications"]').first().click();
            await page.locator('#npMarkRead').click();
            await page.waitForFunction(() => CirvioStore.getNotifications().every(notification => notification.read));
            assert.equal(lifecycleAlerts.filter(alert => !alert.read).length, 0);
            assert.equal(await page.locator('#npList .np-item').count(), 3, 'Refreshing does not duplicate stored events');
        }, (pathname, route) => {
            if (pathname === '/api/notifications') return { body: { notifications: lifecycleAlerts, unreadCount: lifecycleAlerts.filter(item => !item.read).length } };
            if (pathname === '/api/notifications/read-all') { lifecycleAlerts.forEach(item => { item.read = true; }); return { body: { unreadCount: 0 } }; }
            if (pathname.endsWith('/read') && pathname.startsWith('/api/notifications/')) { const alert = lifecycleAlerts.find(item => pathname.includes(item.id)); if (alert) alert.read = true; return { body: { read: true } }; }
            if (pathname === '/api/products/mine') return { body: { products: [lifecycleProduct] } };
            if (pathname === '/api/orders/selling') return { body: { orders: [lifecycleOrder] } };
        }, true);

        let failBuyerStatus = true;
        await check('Buyer status retries and a listing push focuses its exact card', async (page, base) => {
            await page.goto(base + '/status.html?listing=' + lifecycleProduct._id);
            await page.locator('#retryListingStatus').waitFor({ state: 'visible' });
            assert.equal(await page.locator('.status-badge.rejected').count(), 0);
            assert.equal(await page.locator('.buyer-selection-details').count(), 0);
            failBuyerStatus = false;
            await page.locator('#retryListingStatus').click();
            await page.locator('.buyer-selection-details').waitFor();
            await page.evaluate(id => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OPEN_LISTING_STATUS', productId: id } })), lifecycleProduct._id);
            await page.locator('.notification-highlight').waitFor();
            assert.equal(await page.locator('.notification-highlight').getAttribute('data-id'), lifecycleProduct._id);
        }, pathname => {
            if (pathname === '/api/products/mine') return { body: { products: [lifecycleProduct] } };
            if (pathname === '/api/orders/selling') return failBuyerStatus ? { status: 503, body: { message: 'Buyer details unavailable' } } : { body: { orders: [lifecycleOrder] } };
        }, true);

        let checkoutCount = 0;
        let failCheckout = true;
        await check('Single-copy cart avoids duplicate checkout and keeps items after failure', async (page, base) => {
            await page.goto(base + '/index.html');
            await page.evaluate(() => { CirvioCart.add({ id: 'book-in-cart', title: 'One book', price: 100 }); CirvioCart.add({ id: 'book-in-cart', title: 'One book', price: 100 }); CirvioCart.open(); });
            assert.equal(await page.evaluate(() => CirvioStore.getCart()[0].qty), 1);
            await page.locator('#cdPlaceBtn').click();
            await page.getByText('Checkout failed', { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => CirvioStore.getCart().length), 1);
            failCheckout = false;
            await page.locator('#cdPlaceBtn').click();
            await page.evaluate(() => cartPlaceOrder());
            await page.locator('#cdSuccess').waitFor({ state: 'visible' });
            assert.equal(checkoutCount, 2, 'One failed attempt and one successful request');
            assert.equal(await page.evaluate(() => CirvioStore.getCart().length), 0);
        }, async (pathname, route) => {
            if (pathname !== '/api/orders') return;
            checkoutCount++;
            assert.equal(route.request().postDataJSON().items[0].qty, 1);
            if (failCheckout) return { status: 503, body: { message: 'Checkout failed' } };
            await new Promise(resolve => setTimeout(resolve, 400));
            return { body: { order: { _id: '000000000000000000000779' } } };
        }, true);

        await check('School classes, streams, higher education and general item categories work on a phone', async (page, base) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto(base + '/sell.html');
            await page.waitForFunction(() => !document.getElementById('itemCategory').disabled);
            await page.locator('#itemCategory').selectOption('School Books');
            for (const label of ['Nursery', 'LKG', 'UKG', 'Class 10', 'Class 11', 'Class 12']) assert.ok(await page.locator('#classification-className option').filter({ hasText: label }).count());
            await page.locator('#classification-className').selectOption('Class 12');
            assert.equal(await page.locator('#classification-stream').isVisible(), true);
            assert.equal(await page.evaluate(() => SellCategories.validate()), false);
            await page.locator('#classification-stream').selectOption('Commerce');
            assert.equal(await page.evaluate(() => SellCategories.validate()), true);
            await page.locator('#classification-className').selectOption('Class 10');
            assert.equal(await page.locator('#classification-stream').isVisible(), false);
            assert.equal((await page.evaluate(() => SellCategories.value())).stream, undefined);
            await page.locator('#itemCategory').selectOption('College Books');
            await page.locator('#classification-level').selectOption('undergraduate');
            await page.locator('#classification-course').selectOption('B.Com.');
            await page.locator('#classification-year').selectOption('3');
            assert.match(await page.locator('#classificationSummary').innerText(), /B.Com.*Year 3/);
            await page.locator('#classification-level').selectOption('masters');
            assert.equal(await page.locator('#classification-course').inputValue(), '');
            await page.locator('#classification-course').selectOption('M.Sc.');
            await page.locator('#classification-year').selectOption('2');
            assert.equal(await page.evaluate(() => SellCategories.validate()), true);
            await page.locator('#itemCategory').selectOption('Calculators');
            await page.locator('#classification-itemType').selectOption('Scientific calculator');
            const classification = await page.evaluate(() => SellCategories.value());
            assert.deepEqual(classification, { itemType: 'Scientific calculator' });
            await page.locator('#itemTitle').fill('Calculator');
            await page.locator('#saveDraftBtn').click();
            assert.equal(await page.evaluate(() => CirvioStore.getListings()[0].classification.itemType), 'Scientific calculator');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }, undefined, true);

        let published;
        await check('Class and stream survive listing confirmation, upload and saved records', async (page, base) => {
            await page.goto(base + '/sell.html');
            await page.waitForFunction(() => !document.getElementById('itemCategory').disabled);
            await page.locator('#itemTitle').fill('Physics <b>book</b>');
            await page.locator('#itemCategory').selectOption('School Books');
            await page.locator('#classification-className').selectOption('Class 12');
            await page.locator('#classification-stream').selectOption('Science (PCM)');
            await page.locator('#classification-board').selectOption('CBSE / NCERT');
            await page.locator('#itemCondition').selectOption('Good');
            await page.locator('#itemPrice').fill('100');
            await page.locator('#itemDesc').fill('Physics textbook');
            await page.locator('#itemLoc').fill('Test City');
            await page.locator('#fileInput').setInputFiles({ name: 'book.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lGAAAAAASUVORK5CYII=', 'base64') });
            await page.waitForFunction(() => photos.length === 1);
            assert.equal(await page.locator('#previewCard .p-title').innerText(), 'Physics <b>book</b>');
            assert.equal(await page.locator('#previewCard b').count(), 0);
            await page.locator('#submitBtn').click();
            await page.locator('#publishConfirmBtn').click();
            await page.locator('#successView').waitFor({ state: 'visible' });
            assert.equal(published.classification.className, 'Class 12');
            assert.equal(published.classification.stream, 'Science (PCM)');
            assert.equal(await page.evaluate(() => CirvioStore.getListings()[0].classification.board), 'CBSE / NCERT');
        }, (pathname, route) => {
            if (pathname === '/api/products' && route.request().method() === 'POST') {
                published = route.request().postDataJSON();
                return { body: { product: { ...published, _id: '000000000000000000000555', status: 'pending', seller: user } } };
            }
        }, true);

        const noticeThread = { _id: '000000000000000000000222', conversationType: 'direct', sender: user, text: '', replies: [{ _id: 'a', senderRole: 'admin', sender: { _id: 'other-staff' }, text: 'First message', createdAt: '2026-11-07' }, { _id: 'b', senderRole: 'admin', sender: { _id: 'other-staff' }, text: 'Second message', createdAt: '2026-11-07' }] };
        await check('Every incoming message produces one notification and opens its chat', async (page, base) => {
            await page.addInitScript(profile => localStorage.setItem('cirvio_profile', JSON.stringify(profile)), user);
            await page.goto(base + '/index.html');
            await page.waitForFunction(() => CirvioStore.getNotifications().filter(item => item.type === 'message').length === 2);
            await page.evaluate(() => CirvioMessages.sync({ notify: true }));
            assert.equal(await page.evaluate(() => CirvioStore.getNotifications().filter(item => item.type === 'message').length), 2);
            await page.locator('button[aria-label="Notifications"]').first().click();
            assert.equal(await page.locator('#npList .np-item').count(), 2);
            assert.match(await page.locator('#npList a').first().getAttribute('href'), /messages.html\?thread=000000000000000000000222/);
            await page.locator('#npList a').first().click();
            await page.locator('#chatRoom').waitFor({ state: 'visible' });
            assert.equal(await page.evaluate(() => CirvioStore.getNotifications().filter(item => !item.read).length), 0);
        }, pathname => pathname === '/api/messages/my' ? { body: { messages: [noticeThread] } } : undefined, true);

        const pushPublicKey = require('../cirvio-backend/node_modules/web-push').generateVAPIDKeys().publicKey;
        const pushRequests = [];
        let rejectPushSubscription = false;
        await check('Push alerts require a click, handle denied permission and can be disabled', async (page, base) => {
            await mockPush(page, { permission: 'denied', nextPermission: 'denied' });
            await page.goto(base + '/index.html');
            await page.waitForFunction(() => !!window.CirvioPush);
            assert.equal(await page.evaluate(() => pushFixture.permissionRequests), 0, 'No automatic permission prompt');
            await page.evaluate(() => { localStorage.removeItem('cirvio_push_prompt_site_v1'); maybeShowWebsitePushPrompt(); });
            assert.equal(await page.locator('#notificationEnablePrompt').isVisible(), false, 'Blocked permission does not trigger another popup');
            await page.locator('button[aria-label="Notifications"]').first().click();
            await page.getByRole('link', { name: 'Notification settings', exact: true }).click();
            await page.waitForFunction(() => !!window.CirvioPush && !CirvioPush.state().busy);
            assert.equal(await page.locator('#panel-settings #enableMessageNotifications').count(), 1);
            await page.locator('#enableMessageNotifications').click();
            await page.waitForFunction(() => document.getElementById('pushNotificationStatus').textContent.includes('blocked'));
            await page.evaluate(() => { pushFixture.permission = 'granted'; });
            rejectPushSubscription = true;
            await page.locator('#enableMessageNotifications').click();
            await page.locator('#pushNotificationStatus').filter({ hasText: 'Notification save failed' }).waitFor();
            assert.equal(await page.evaluate(() => pushFixture.subscribed), false, 'Failed setup removes the unregistered subscription');
            rejectPushSubscription = false;
            await page.locator('#enableMessageNotifications').click();
            await page.getByRole('button', { name: 'Disable notifications', exact: true }).waitFor();
            assert.equal(pushRequests.filter(request => request.method === 'POST').at(-1).body.app, 'site');
            await page.locator('#enableMessageNotifications').click();
            await page.getByRole('button', { name: 'Enable notifications', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => pushFixture.subscribed), false);
            assert.ok(pushRequests.some(request => request.method === 'DELETE'));
        }, (pathname, route) => {
            if (pathname === '/api/notifications/push-key') return { body: { publicKey: pushPublicKey } };
            if (pathname === '/api/notifications/subscriptions') {
                pushRequests.push({ method: route.request().method(), body: route.request().postDataJSON() });
                return rejectPushSubscription ? { status: 503, body: { message: 'Notification save failed' } } : { body: { enabled: route.request().method() === 'POST' } };
            }
        }, true);

        const promptRequests = [];
        const pushReply = (pathname, route) => {
            if (pathname === '/api/notifications/push-key') return { body: { publicKey: pushPublicKey } };
            if (pathname === '/api/notifications/subscriptions') {
                promptRequests.push({ method: route.request().method(), app: route.request().postDataJSON().app });
                return { body: { enabled: route.request().method() === 'POST' } };
            }
        };
        await check('Notification prompt enables on click, fits phones and respects dismissal and opt-out', async (page, base) => {
            await mockPush(page);
            await page.goto(base + '/index.html');
            await page.waitForFunction(() => !!window.CirvioPush && !CirvioPush.state().busy);
            await page.evaluate(() => { localStorage.removeItem('cirvio_push_prompt_site_v1'); maybeShowWebsitePushPrompt(); });
            const prompt = page.getByRole('dialog', { name: 'Stay updated with CIRVIO' });
            await prompt.waitFor();
            assert.equal(await page.evaluate(() => pushFixture.permissionRequests), 0);
            for (const width of [320, 390, 768]) {
                await page.setViewportSize({ width, height: 844 });
                const box = await prompt.boundingBox();
                assert.ok(box.x >= 0 && box.x + box.width <= width, 'Prompt stays inside phone viewport');
                assert.ok(await prompt.locator('[data-push-enable]').evaluate(button => button.getBoundingClientRect().height >= 48));
            }
            if (process.env.CIRVIO_SCREENSHOT_DIR) {
                await page.setViewportSize({ width: 390, height: 844 });
                await page.screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, 'notification-prompt-mobile.png') });
            }
            await prompt.getByRole('button', { name: 'Not now' }).click();
            await page.evaluate(() => maybeShowWebsitePushPrompt());
            assert.equal(await prompt.isVisible(), false, 'Dismissed prompt is not immediately repeated');
            assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('cirvio_push_prompt_site_v1')).until > Date.now()));
            await page.evaluate(() => localStorage.removeItem('cirvio_push_prompt_site_v1'));
            await page.reload();
            await prompt.waitFor(); // The normal visit timer opens the prompt.
            const before = promptRequests.length;
            await prompt.locator('[data-push-enable]').evaluate(button => { button.click(); button.click(); });
            await page.waitForFunction(() => CirvioPush.state().enabled && !CirvioPush.state().busy);
            assert.equal(await prompt.isVisible(), false);
            assert.equal(await page.evaluate(() => pushFixture.permissionRequests), 1);
            assert.equal(promptRequests.slice(before).filter(request => request.method === 'POST').length, 1, 'Only one setup request after repeated clicks');
            await page.goto(base + '/profile.html#notifications');
            await page.getByRole('button', { name: 'Disable notifications', exact: true }).waitFor();
            await page.locator('#enableMessageNotifications').click();
            await page.getByRole('button', { name: 'Enable notifications', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cirvio_push_prompt_site_v1')).off), true);
            await page.goto(base + '/index.html');
            await page.waitForFunction(() => !!window.CirvioPush && !CirvioPush.state().busy);
            await page.evaluate(() => maybeShowWebsitePushPrompt());
            assert.equal(await page.locator('#notificationEnablePrompt').isVisible(), false, 'Opted-out users are not prompted on another page');
        }, pushReply, true);

        await check('Notification prompt guides guests to sign in without requesting browser permission', async (page, base) => {
            await mockPush(page, { showPrompt: true });
            await page.goto(base + '/index.html');
            const prompt = page.getByRole('dialog', { name: 'Stay updated with CIRVIO' });
            await prompt.waitFor();
            await page.keyboard.press('Escape');
            assert.equal(await prompt.isVisible(), false);
            await page.evaluate(() => { localStorage.removeItem('cirvio_push_prompt_site_v1'); maybeShowWebsitePushPrompt(); });
            await prompt.getByRole('button', { name: 'Sign in to enable' }).click();
            await page.waitForURL('**/login.html?next=index.html');
            assert.equal(await page.evaluate(() => pushFixture.permissionRequests), 0);
            assert.equal(await page.locator('#notificationEnablePrompt').count(), 0, 'Login has no competing notification popup');
        });

        await check('Notification settings explain unsupported browsers without showing an enable prompt', async (page, base) => {
            await mockPush(page, { supported: false, showPrompt: true });
            await page.goto(base + '/profile.html#notifications');
            await page.waitForFunction(() => !!window.CirvioPush && !CirvioPush.state().busy);
            assert.equal(await page.locator('#enableMessageNotifications').isDisabled(), true);
            assert.match(await page.locator('#pushNotificationStatus').innerText(), /Home Screen/);
            await page.evaluate(() => maybeShowWebsitePushPrompt());
            assert.equal(await page.locator('#notificationEnablePrompt').isVisible(), false);
        }, undefined, true);

        await check('Admin notification enable control lives in staff Settings and uses the admin subscription', async (page, base) => {
            await mockPush(page);
            await page.setViewportSize({ width: 320, height: 844 });
            await page.goto(base + '/admin/#messages');
            await page.locator('#tab-messages [data-jump-tab="settings"]').click();
            await page.locator('#tab-settings.active #enableAdminNotifications').waitFor();
            await page.waitForFunction(() => !!window.CirvioPush && !CirvioPush.state().busy);
            assert.equal(await page.locator('#tab-messages #enableAdminNotifications').count(), 0);
            assert.equal(await page.evaluate(() => pushFixture.permissionRequests), 0);
            await page.locator('#enableAdminNotifications').click();
            await page.getByRole('button', { name: 'Disable notifications', exact: true }).waitFor();
            assert.equal(promptRequests.at(-1).app, 'admin');
            await page.locator('#enableAdminNotifications').click();
            await page.getByRole('button', { name: 'Enable notifications', exact: true }).waitFor();
        }, pushReply, true);

        const directId = '000000000000000000000123';
        const directThread = { _id: directId, conversationType: 'direct', sender: user, text: '', createdAt: '2026-11-07', updatedAt: '2026-11-07', replies: [{ _id: 'first', sender: { _id: 'other-staff' }, senderRole: 'admin', text: 'Hello from CIRVIO support', createdAt: '2026-11-07' }] };
        let failDirectReply = true;
        let directReplyCount = 0;
        await check('Users receive private admin chats and can reply without a product', async (page, base) => {
            await page.addInitScript(profile => localStorage.setItem('cirvio_profile', JSON.stringify(profile)), user);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto(base + '/messages.html?thread=' + directId);
            await page.locator('#chatRoom').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#chatProductTitle').innerText(), 'CIRVIO Admin');
            assert.match(await page.locator('#chatParties').innerText(), /You and CIRVIO Admin/);
            assert.equal(await page.locator('.chat-message').count(), 1, 'No empty root bubble');
            assert.equal(await page.locator('.chat-message strong').innerText(), 'CIRVIO Admin');
            await page.locator('#chatInput').fill('Thank you for contacting me');
            await page.locator('#chatSendBtn').click();
            await page.getByText('Please try again', { exact: true }).waitFor();
            assert.equal(await page.locator('#chatInput').inputValue(), 'Thank you for contacting me');
            failDirectReply = false;
            await page.locator('#chatSendBtn').click();
            await page.waitForFunction(() => !document.getElementById('chatSendBtn').disabled);
            assert.equal(await page.locator('.chat-message.mine p').innerText(), 'Thank you for contacting me');
            assert.equal(await page.locator('#chatInput').inputValue(), '');
            assert.equal(directReplyCount, 2);
            await page.evaluate(() => CirvioAPI.setSession('different-user-token', { id: 'different-user', name: 'Different User' }));
            assert.equal(await page.evaluate(() => localStorage.getItem('cirvio_messages')), null, 'Account switching clears private messages');
        }, async (pathname, route) => {
            if (pathname === '/api/messages/my') return { body: { messages: [directThread] } };
            if (pathname === `/api/messages/${directId}/replies`) {
                directReplyCount++;
                assert.equal(route.request().postDataJSON().text, 'Thank you for contacting me');
                if (failDirectReply) return { status: 503, body: { message: 'Please try again' } };
                directThread.replies.push({ _id: 'reply', sender: { _id: user.id }, senderRole: 'buyer', text: route.request().postDataJSON().text, createdAt: '2026-11-07T10:00:00Z' });
                return { body: { message: directThread } };
            }
        }, true);

        await check('Public listing API returns seller summaries without private contact or rating entries', async (_page, base) => {
            const original = Product.find;
            Product.find = () => ({
                populate() { return this; }, slice() { return this; }, sort() { return this; },
                async lean() {
                    return [{ ...products[0], location: 'Private pickup address', seller: {
                        _id: 'seller1', name: 'Real Seller', college: 'College A', verified: true,
                        email: 'private@example.test', phone: 'private-phone', createdAt: '2025-03-01',
                        trustRatings: [{ user: 'private-rater1', value: 4 }, { user: 'private-rater2', value: 5 }]
                    } }];
                }
            });
            try {
                const response = await fetch(base + '/fixture-products');
                assert.equal(response.status, 200);
                const { products: [product] } = await response.json();
                assert.equal(product.seller.trustRatingAverage, 4.5);
                assert.equal(product.seller.trustRatingCount, 2);
                assert.equal(product.seller.verified, true);
                assert.equal(product.seller.email, undefined);
                assert.equal(product.seller.phone, undefined);
                assert.equal(product.seller.trustRatings, undefined);
                assert.equal(product.location, '');
            } finally { Product.find = original; }
        });

        console.log(`\n${passed} rendering and API checks passed.`);
    } finally {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
