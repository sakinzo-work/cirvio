/* Isolated mobile + PWA integration checks. No database or production account is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('../cirvio-backend/node_modules/express');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '../cirvio-backend/admin-panel');
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#d5d9c8"/></svg>');
const fixtureUser = { id: 'staff', _id: 'staff', name: 'Test Administrator', email: 'admin@example.test', role: 'admin', status: 'active' };
const products = Array.from({ length: 23 }, (_, index) => ({ _id: 'p' + index, title: 'Listing ' + index + ' with a long description for a student marketplace', category: 'Books', type: 'sell', price: 150, images: [image], condition: 'Good', status: 'pending', createdAt: '2026-10-01', seller: { _id: 'seller', name: 'Test Seller', email: 'seller@example.test' } }));
const users = Array.from({ length: 23 }, (_, index) => ({ _id: 'u' + index, name: 'Student ' + index, email: 'student' + index + '@example.test', role: index === 1 ? 'employee' : 'user', status: 'active', listingsCount: 1, ordersCount: 0, college: 'Test College', city: 'Mumbai', createdAt: '2026-10-01' }));
const initialMessages = [
    { _id: 'm1', sender: users[0], product: products[0], text: 'Can I collect this book?', createdAt: '2026-10-01', updatedAt: '2026-10-03', replies: [{ senderRole: 'admin', text: 'Yes, we can arrange it.', createdAt: '2026-10-02' }, { senderRole: 'buyer', text: 'What time is available?', createdAt: '2026-10-03' }] },
    { _id: 'm2', sender: users[2], product: products[1], text: 'Is this available?', createdAt: '2026-10-01', updatedAt: '2026-10-02', replies: [{ senderRole: 'admin', text: 'Yes.', createdAt: '2026-10-02' }] },
    { _id: 'm3', sender: users[3], product: products[2], text: 'I would like to buy this.', createdAt: '2026-10-01', updatedAt: '2026-10-01', replies: [] }
];
const purchases = products.map((product, index) => ({ orderId: 'order' + index, title: product.title, product, buyer: users[0], seller: users[1], qty: 1, price: 150, date: '2026-10-01', paymentStatus: 'pending', orderStatus: 'placed', dispatchStatus: 'not-dispatched' }));
let state;
function reset() { state = { user: { ...fixtureUser }, messages: structuredClone(initialMessages), purchases: structuredClone(purchases), replyCount: 0, replyDelay: 0, failReply: false, savedOrder: null }; }
reset();
const app = express();
app.use(express.json());
app.use((request, response, next) => {
    // A real transport failure also covers service-worker-owned fetches on older browser drivers.
    if (state.dropNavigations && /^\/(admin|panel)\/(index\.html)?$/.test(request.path)) { request.socket.destroy(); return; }
    next();
});
app.use('/admin', express.static(directory));
app.use('/panel', express.static(directory));
app.use('/api', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const route = request.path;
    if (route === '/auth/me') { if (request.method === 'PUT') Object.assign(state.user, request.body); return response.json({ user: state.user }); }
    if (route === '/auth/login') return response.json({ user: state.user, token: 'fixture-token' });
    if (route === '/admin/stats') return response.json({ totalUsers: 23, totalProducts: 23, pendingProducts: 23, approvedProducts: 0, soldProducts: 0, totalOrders: 23, totalRevenue: 0 });
    if (route === '/admin/users') return response.json({ users });
    if (route === '/admin/products') return response.json({ products });
    if (route === '/admin/purchases') return response.json({ purchases: state.purchases });
    if (route === '/admin/messages') return response.json({ messages: state.messages });
    if (route === '/admin/message-recipients') {
        if (state.failSearch) return response.status(503).json({ message: 'Could not load users. Try again.' });
        const search = String(request.query.q || '').toLowerCase();
        if (search === 'student 1') await new Promise(resolve => setTimeout(resolve, 450));
        return response.json({ users: users.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(search)) });
    }
    if (route === '/admin/messages/conversations') {
        state.openCount = (state.openCount || 0) + 1;
        if (state.failOpen) return response.status(503).json({ message: 'Could not open chat. Try again.' });
        const product = products.find(product => product._id === request.body.productId);
        const sender = product?.seller || users.find(user => user._id === request.body.userId);
        const key = product ? `listing:${product._id}` : `direct:${sender._id}`;
        let message = state.messages.find(message => message.conversationKey === key);
        if (!message) {
            message = { _id: key, conversationKey: key, conversationType: 'direct', sender, product: product || null, text: '', replies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            state.messages.push(message);
        }
        return response.json({ message });
    }
    if (route === '/admin/site-media') return response.json({ media: {} });
    if (route === '/admin/client-origins') return response.json({ origins: [], envOrigins: [] });
    const reply = route.match(/^\/admin\/messages\/([^/]+)\/reply$/);
    if (reply) {
        state.replyCount++;
        if (state.failReply) return response.status(503).json({ message: 'Message not sent. Try again.' });
        if (state.replyDelay) await new Promise(resolve => setTimeout(resolve, state.replyDelay));
        const message = state.messages.find(item => item._id === reply[1]);
        message.replies.push({ senderRole: 'admin', text: request.body.text, createdAt: new Date().toISOString() });
        message.updatedAt = new Date().toISOString();
        return response.json({ message });
    }
    const review = route.match(/^\/admin\/products\/([^/]+)\/review-viewed$/);
    if (review) return response.json({ product: { ...products.find(item => item._id === review[1]), reviewViewedAt: new Date().toISOString() } });
    const operation = route.match(/^\/admin\/orders\/([^/]+)\/operations$/);
    if (operation) { state.savedOrder = request.body; const order = state.purchases.find(item => item.orderId === operation[1]); Object.assign(order, request.body, { orderStatus: request.body.status }); return response.json({ order }); }
    response.status(404).json({ message: 'Fixture route not found' });
});

(async () => {
    const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const launchOptions = { headless: true, executablePath: process.env.CIRVIO_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined) };
    const browser = await chromium.launch(launchOptions);
    let passed = 0;
    async function check(name, run, options = {}) {
        if (process.env.ADMIN_TEST_FILTER && !name.toLowerCase().includes(process.env.ADMIN_TEST_FILTER.toLowerCase())) return;
        reset();
        const contextOptions = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: options.pwa ? 'allow' : 'block', ...options.context };
        const tempRoot = fs.realpathSync(os.tmpdir());
        const profile = options.pwa ? fs.mkdtempSync(path.join(tempRoot, 'cirvio-admin-pwa-')) : null;
        const context = profile ? await chromium.launchPersistentContext(profile, { ...launchOptions, ...contextOptions }) : await browser.newContext(contextOptions);
        if (options.manualInstall) await context.addInitScript(() => {
            // Chromium still emits this event under an iPhone user agent; Safari does not.
            window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true });
        });
        await context.addInitScript(signedIn => {
            window.CIRVIO_API_BASE = location.origin;
            localStorage.setItem('cirvio_admin_api_base', location.origin);
            if (signedIn) localStorage.setItem('cirvio_admin_token', 'fixture-token');
        }, options.signedIn !== false);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await run(page, context);
            assert.deepEqual(errors, [], 'No uncaught browser exceptions');
            console.log('PASS ' + name); passed++;
        } catch (error) {
            if (process.env.ADMIN_TEST_FILTER) console.error('Page at failure:', page.url(), (await page.locator('body').innerText()).slice(0, 800));
            throw error;
        } finally {
            await context.close();
            if (profile) {
                const resolved = path.resolve(profile);
                assert.equal(path.dirname(resolved), path.resolve(tempRoot));
                assert.ok(path.basename(resolved).startsWith('cirvio-admin-pwa-'));
                fs.rmSync(resolved, { recursive: true, force: true });
            }
        }
    }
    async function boot(page, suffix = '/admin/') {
        await page.goto(base + suffix);
        await page.waitForFunction(() => document.getElementById('statUsers').textContent === '23');
    }
    async function navigate(page, tab) {
        if (page.viewportSize().width <= 780) await page.locator('#mobileMenuBtn').click();
        await page.locator(`.nav-btn[data-tab="${tab}"]`).click();
        await page.locator('#tab-' + tab).waitFor({ state: 'visible' });
        assert.equal(await page.locator('#mobileMenuBtn').getAttribute('aria-expanded'), 'false');
    }
    async function noOverflow(page) {
        const widths = await page.evaluate(() => ({ window: innerWidth, body: document.documentElement.scrollWidth, main: document.querySelector('.main').clientWidth, content: document.querySelector('.main').scrollWidth }));
        assert.ok(widths.body <= widths.window + 1, 'No page overflow: ' + JSON.stringify(widths));
        assert.ok(widths.content <= widths.main + 1, 'No section overflow: ' + JSON.stringify(widths));
    }
    try {
        for (const width of [320, 390, 768, 1280]) await check(`Every admin section fits ${width}px and navigation works`, async page => {
            await boot(page);
            await noOverflow(page);
            for (const tab of ['users', 'listings', 'purchases', 'settings', 'employees', 'dashboard']) {
                await navigate(page, tab);
                await page.waitForFunction(() => !document.querySelector('.tab-panel.active [aria-busy="true"]'));
                await noOverflow(page);
            }
            if (width <= 780) {
                await navigate(page, 'users');
                assert.equal(await page.locator('#usersTable tbody tr').count(), 10);
                assert.equal(await page.locator('#usersTable tbody tr').first().locator('td').nth(1).getAttribute('data-label'), 'Email');
                if (process.env.CIRVIO_SCREENSHOT_DIR && width === 390) await page.screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, 'admin-mobile-users.png') });
            }
        }, { context: { viewport: { width, height: 844 }, isMobile: width <= 780 } });

        for (const width of [320, 1280]) await check(`Start a user conversation, retry and reuse it at ${width}px`, async page => {
            await boot(page); await navigate(page, 'messages');
            await page.locator('[data-message-filter="needs-reply"]').click();
            await page.locator('#messagesSearchInput').fill('hide-every-thread');
            state.failSearch = true;
            await page.locator('#newMessageBtn').click();
            await page.locator('#retryMessageRecipients').waitFor({ state: 'visible' });
            state.failSearch = false;
            await page.locator('#retryMessageRecipients').click();
            await page.locator('#messageRecipientList button').first().waitFor();
            await page.locator('#messageRecipientSearch').fill('student 1');
            await page.waitForRequest(request => request.url().includes('message-recipients?q=student%201'));
            await page.locator('#messageRecipientSearch').fill('student4@');
            await page.locator('#messageRecipientList button').waitFor();
            assert.equal(await page.locator('#messageRecipientList button').count(), 1);
            if (process.env.CIRVIO_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, `admin-new-message-${width}.png`) });
            state.failOpen = true;
            await page.locator('#messageRecipientList button').click();
            await page.getByText('Could not open chat. Try again.', { exact: true }).waitFor();
            assert.equal(await page.locator('#messageRecipientList strong').innerText(), 'Student 4', 'Opening failures preserve the recipient card');
            assert.equal(await page.locator('#messageRecipientSearch').inputValue(), 'student4@');
            state.failOpen = false;
            await page.locator('#messageRecipientList button').click();
            await page.locator('#newMessageDialog').waitFor({ state: 'hidden' });
            await page.locator('#sideReplyText').waitFor({ state: 'visible' });
            assert.match(await page.locator('.chat-contact').innerText(), /Student 4/);
            assert.equal(await page.locator('.reply-bubble').count(), 0, 'No fabricated empty opening message');
            assert.equal(await page.locator('[data-message-filter="all"]').getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('#messagesSearchInput').inputValue(), '');
            await page.locator('#sideReplyText').fill('Hello, how can we help?');
            await page.locator('#sideReplySend').click();
            await page.locator('.reply-bubble.from-admin').waitFor();
            await navigate(page, 'users');
            await page.locator('#usersTable [data-message-user="u4"]').click();
            await page.locator('#sideReplyText').waitFor({ state: 'visible' });
            assert.equal(await page.locator('.reply-bubble.from-admin').innerText().then(text => text.includes('Hello, how can we help?')), true);
            assert.equal(state.messages.filter(message => message.conversationKey === 'direct:u4').length, 1);
            await noOverflow(page);
        }, { context: { viewport: { width, height: 844 }, isMobile: width <= 780 } });

        await check('Listing actions and review open the same seller conversation on a phone', async page => {
            await boot(page); await navigate(page, 'listings');
            await page.locator('#listingsTable [data-message-listing="p0"]').click();
            await page.locator('#sideReplyText').waitFor({ state: 'visible' });
            assert.match(await page.locator('.chat-contact').innerText(), /Test Seller/);
            assert.match(await page.locator('.chat-topic').innerText(), /Listing 0/);
            assert.equal(await page.evaluate(() => activeMessageId), 'listing:p0');
            await page.locator('#sideReplyText').fill('Please add a clearer photo.');
            await navigate(page, 'listings');
            await page.locator('#listingsTable tbody tr').first().getByRole('button', { name: 'View Images' }).click();
            await page.locator('#imageModalDetail [data-message-listing="p0"]').click();
            await page.locator('#listingImageModal').waitFor({ state: 'hidden' });
            await page.locator('#sideReplyText').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#sideReplyText').inputValue(), 'Please add a clearer photo.');
            assert.equal(await page.locator('.main').evaluate(element => element.inert), false);
            assert.equal(state.messages.filter(message => message.conversationKey === 'listing:p0').length, 1);
            await noOverflow(page);
        });

        await check('Phone inbox, reply filters, Back and drafts work', async page => {
            await boot(page);
            await navigate(page, 'messages');
            await page.locator('.message-thread').first().waitFor();
            assert.equal(await page.locator('.message-inbox').isVisible(), true);
            assert.equal(await page.locator('#messageSidePanel').isVisible(), false);
            await page.locator('[data-message-filter="needs-reply"]').click();
            assert.equal(await page.locator('.message-thread:visible').count(), 2);
            await page.locator('#messagesSearchInput').fill('student0');
            assert.equal(await page.locator('.message-thread:visible').count(), 1);
            await page.locator('#messagesSearchInput').fill('not-in-this-inbox');
            assert.equal(await page.locator('#messageSearchEmpty').isVisible(), true);
            await page.locator('#messagesSearchInput').fill('');
            await page.locator('.message-thread[data-message-id="m1"]').click();
            await page.locator('#sideReplyText').fill('An unsent draft\n' + 'LongText'.repeat(24));
            await noOverflow(page);
            await page.locator('#messageBackBtn').click();
            await page.locator('.message-inbox').waitFor({ state: 'visible' });
            await page.locator('.message-thread[data-message-id="m1"]').click();
            assert.match(await page.locator('#sideReplyText').inputValue(), /An unsent draft/);
            await page.setViewportSize({ width: 390, height: 500 });
            await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--app-height') === '500px');
            const composer = await page.locator('#sideReplyText').boundingBox();
            assert.ok(composer.y + composer.height <= 500, 'Composer stays inside the resized viewport');
            if (process.env.CIRVIO_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CIRVIO_SCREENSHOT_DIR, 'admin-mobile-chat.png') });
        });

        await check('Failed sends preserve drafts; double sends and thread switching are safe', async page => {
            await boot(page); await navigate(page, 'messages');
            await page.locator('.message-thread[data-message-id="m1"]').click();
            await page.locator('#sideReplyText').fill('Please arrange pickup.');
            state.failReply = true;
            await page.locator('#sideReplySend').click();
            await page.getByText('Message not sent. Try again.', { exact: true }).waitFor();
            assert.equal(await page.locator('#sideReplyText').inputValue(), 'Please arrange pickup.');
            state.failReply = false; state.replyDelay = 700; state.replyCount = 0;
            await page.locator('#sideReplySend').click();
            assert.equal(await page.locator('#sideReplySend').isDisabled(), true);
            await page.evaluate(() => sendSidePanelReply());
            await page.locator('#messageBackBtn').click();
            await page.locator('.message-thread[data-message-id="m2"]').click();
            await page.locator('#sideReplyText').fill('Draft for the other conversation');
            await page.waitForFunction(() => !pendingReplies.size);
            assert.equal(state.replyCount, 1);
            assert.equal(await page.evaluate(() => activeMessageId), 'm2');
            assert.equal(await page.locator('#sideReplyText').inputValue(), 'Draft for the other conversation');
        });

        await check('Listing review and order update dialogs work on a phone', async page => {
            await boot(page); await navigate(page, 'listings');
            await page.locator('#listingsTable tbody tr').first().getByRole('button', { name: 'View Images' }).click();
            await page.locator('#listingImageModal').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#listingImageModal [role="dialog"]').getAttribute('aria-modal'), 'true');
            await page.keyboard.press('Escape');
            await page.locator('#listingImageModal').waitFor({ state: 'hidden' });
            await navigate(page, 'purchases');
            await page.locator('#purchasesTable tbody tr').first().getByRole('button', { name: 'Update', exact: true }).click();
            await page.locator('#opsPaymentStatus').selectOption('collected');
            await page.locator('#opsPaymentReference').fill('UPI-test-reference');
            await page.locator('#opsAdminNotes').fill('Collected at pickup');
            await page.locator('#opsSave').click();
            await page.locator('#orderOpsModal').waitFor({ state: 'hidden' });
            assert.equal(state.savedOrder.paymentStatus, 'collected');
            assert.equal(state.savedOrder.adminNotes, 'Collected at pickup');
            await noOverflow(page);
        });

        await check('Menu keyboard access, theme and login layout work', async page => {
            await boot(page);
            await page.locator('#mobileMenuBtn').click();
            assert.equal(await page.locator('.main').evaluate(el => el.inert), true);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#mobileMenuBtn').getAttribute('aria-expanded'), 'false');
            await page.locator('#themeToggleBtn').click();
            assert.equal(await page.locator('body').getAttribute('data-theme'), 'light');
            await page.reload();
            await page.waitForFunction(() => !document.getElementById('adminApp').classList.contains('hidden'));
            assert.equal(await page.locator('body').getAttribute('data-theme'), 'light');
            await noOverflow(page);
        });

        await check('Staff permissions remain enforced in the mobile menu', async page => {
            state.user.role = 'employee';
            await boot(page);
            await page.locator('#mobileMenuBtn').click();
            assert.equal(await page.locator('.nav-btn[data-tab="employees"]').isVisible(), false);
            await page.locator('.nav-btn[data-tab="listings"]').click();
            await page.locator('#listingsTable tbody tr').first().waitFor();
            assert.equal(await page.locator('#listingsTable .btn-delete').count(), 0);
            await navigate(page, 'settings');
            assert.equal(await page.locator('.admin-settings-card').isVisible(), false);
        });

        await check('Notification links and worker messages open the right admin conversation', async page => {
            await page.goto(base + '/admin/?thread=m1#messages');
            await page.locator('#sideReplyText').waitFor({ state: 'visible' });
            assert.equal(await page.evaluate(() => activeMessageId), 'm1');
            await page.locator('#sideReplyText').fill('Keep this draft when opening another alert');
            await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OPEN_MESSAGE', threadId: 'm2' } })));
            await page.waitForFunction(() => activeMessageId === 'm2');
            await page.locator('#messageBackBtn').click();
            await page.locator('.message-thread[data-message-id="m1"]').click();
            assert.equal(await page.locator('#sideReplyText').inputValue(), 'Keep this draft when opening another alert');
        });

        await check('Manifest, real service worker, offline recovery and private-cache exclusion', async (page, context) => {
            await boot(page);
            await page.evaluate(() => navigator.serviceWorker.ready);
            await page.waitForFunction(() => !!navigator.serviceWorker.controller);
            const cdp = await context.newCDPSession(page);
            const manifest = await cdp.send('Page.getAppManifest');
            assert.deepEqual(manifest.errors, []);
            const parsed = JSON.parse(manifest.data);
            assert.equal(parsed.name, 'CIRVIO Admin');
            assert.equal(parsed.display, 'standalone');
            for (const icon of parsed.icons) {
                const file = fs.readFileSync(path.join(directory, icon.src));
                const [width, height] = icon.sizes.split('x').map(Number);
                assert.equal(file.readUInt32BE(16), width); assert.equal(file.readUInt32BE(20), height);
            }
            const installability = await cdp.send('Page.getInstallabilityErrors');
            assert.deepEqual(installability.installabilityErrors, []);
            const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(item => item.url)))).flat());
            assert.ok(cached.length >= 10);
            assert.ok(cached.every(url => !url.includes('/api/') && !url.includes('/uploads/')));
            state.dropNavigations = true;
            await context.setOffline(true);
            await page.locator('#adminConnectionStatus').waitFor({ state: 'visible' });
            assert.equal(await page.evaluate(() => localStorage.getItem('cirvio_admin_token')), 'fixture-token');
            await page.goto(base + '/admin/');
            await page.getByRole('heading', { name: 'You’re offline' }).waitFor();
            assert.equal(await page.evaluate(() => fetch('/api/admin/stats').then(() => false).catch(() => true)), true);
            state.dropNavigations = false;
            await context.setOffline(false);
            await page.waitForFunction(() => document.getElementById('statUsers')?.textContent === '23');
        }, { pwa: true });

        await check('Install button uses the browser prompt and hides after installation', async page => {
            await boot(page);
            await page.evaluate(() => {
                const event = new Event('beforeinstallprompt', { cancelable: true });
                event.prompt = async () => { window.installPromptCalled = true; };
                event.userChoice = Promise.resolve({ outcome: 'accepted' });
                window.dispatchEvent(event);
            });
            await page.locator('#installAdminBtn').click();
            assert.equal(await page.evaluate(() => window.installPromptCalled), true);
            await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
            assert.equal(await page.locator('#installAdminBtn').isVisible(), false);
        });

        await check('iPhone install help and alternate deployment scope work', async page => {
            await boot(page, '/panel/');
            await page.locator('#installAdminBtn').click();
            await page.locator('#adminInstallHelp').waitFor({ state: 'visible' });
            assert.match(await page.locator('#installHelpSteps').innerText(), /In Safari, tap Share/);
            await page.getByRole('button', { name: 'Got it' }).click();
            await page.evaluate(() => navigator.serviceWorker.ready);
            assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope), base + '/panel/');
        }, { pwa: true, manualInstall: true, context: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' } });

        await check('Login page stays usable at 320px', async page => {
            await page.goto(base + '/admin/');
            await page.locator('#loginEmail').fill('staff@example.test');
            await page.locator('#loginPassword').fill('fixture-password');
            await page.locator('#toggleLoginPassword').click();
            assert.equal(await page.locator('#loginPassword').getAttribute('type'), 'text');
            await page.locator('#toggleLoginPassword').click();
            assert.equal(await page.locator('#loginPassword').getAttribute('type'), 'password');
            await page.setViewportSize({ width: 320, height: 350 });
            await page.getByRole('button', { name: 'Login', exact: true }).scrollIntoViewIfNeeded();
            const loginButton = await page.getByRole('button', { name: 'Login', exact: true }).boundingBox();
            assert.ok(loginButton.y >= 0 && loginButton.y + loginButton.height <= 350, 'Login remains reachable when the viewport is shortened');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            await page.getByRole('button', { name: 'Login', exact: true }).click();
            await page.waitForFunction(() => document.getElementById('statUsers').textContent === '23');
        }, { signedIn: false, context: { viewport: { width: 320, height: 650 } } });

        console.log(`\n${passed} admin mobile and PWA checks passed.`);
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
