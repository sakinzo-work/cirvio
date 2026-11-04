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
    if (pathname === '/api/products/mine') return { products: [] };
    if (pathname === '/api/products') return { products };
    if (pathname.startsWith('/api/products/')) return { product: products[0] };
    return {};
};

(async () => {
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const chromePath = process.env.CIRVIO_BROWSER_PATH || (process.platform === 'win32' && fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    const browser = await chromium.launch({ headless: true, executablePath: chromePath });
    let passed = 0;
    async function check(name, run, responder, signedIn = false) {
        const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
        await context.addInitScript(signedIn => {
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
