/* Isolated API, delivery and worker checks: no real accounts, database or push service. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('../cirvio-backend/node_modules/express');
const jwt = require('../cirvio-backend/node_modules/jsonwebtoken');
const webpush = require('../cirvio-backend/node_modules/web-push');
const User = require('../cirvio-backend/models/User');
const Product = require('../cirvio-backend/models/Product');
const Subscription = require('../cirvio-backend/models/PushSubscription');
const Setting = require('../cirvio-backend/models/AppSetting');
const { taxonomy, normalizeClassification, describeClassification } = require('../cirvio-backend/services/listing-categories');
const notifications = require('../cirvio-backend/services/message-notifications');
const id = n => String(n).padStart(24, '0');
const users = [{ _id: id(1), role: 'admin', status: 'active' }, { _id: id(2), role: 'user', status: 'active' }, { _id: id(3), role: 'user', status: 'active' }, { _id: id(4), role: 'employee', status: 'active' }, { _id: id(5), role: 'employee', status: 'suspended' }];
const query = value => ({ select() { return this; }, populate() { return this; }, async lean() { return value; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const subscriptions = [];
let storedKeys;
let createdProduct;
const sent = [];
User.findById = key => query(users.find(user => user._id === String(key)) || null);
User.find = filter => query(users.filter(user => (!filter.status || user.status === filter.status) && (!filter.role || filter.role.$in.includes(user.role)) && (!filter._id || filter._id.$in.includes(user._id))));
Product.findById = key => query(key === id(10) ? { _id: id(10), seller: id(3) } : createdProduct || null);
Product.create = async values => {
    createdProduct = new Product({ _id: id(20), ...values });
    await createdProduct.validate();
    createdProduct.populate = async () => createdProduct;
    createdProduct.save = async () => { await createdProduct.validate(); return createdProduct; };
    return createdProduct;
};
Setting.findOne = () => query(storedKeys ? { value: storedKeys } : null);
Setting.findOneAndUpdate = async (_filter, update) => { storedKeys ||= update.$setOnInsert.value; return { value: storedKeys }; };
Subscription.findOneAndUpdate = async (filter, update) => {
    let current = subscriptions.find(item => item.endpointHash === filter.endpointHash);
    if (!current) { current = { _id: id(100 + subscriptions.length), ...filter }; subscriptions.push(current); }
    Object.assign(current, update); return current;
};
Subscription.find = filter => query(subscriptions.filter(item => filter.user.$in.includes(String(item.user))));
Subscription.deleteOne = async filter => {
    const index = subscriptions.findIndex(item => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value)));
    if (index >= 0) subscriptions.splice(index, 1);
};
webpush.sendNotification = async (subscription, payload, options) => {
    if (subscription.endpoint.endsWith('/expired')) throw Object.assign(new Error('Expired'), { statusCode: 410 });
    assert.ok(options.vapidDetails.privateKey);
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
};
process.env.JWT_SECRET = 'isolated-notifications-test';
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
const app = express(); app.use(express.json());
app.use('/api/products', require('../cirvio-backend/routes/products'));
app.use('/api/notifications', require('../cirvio-backend/routes/notifications'));
app.use((error, request, response, next) => response.status(500).json({ message: error.message }));

(async () => {
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, user = users[1], body, method) {
        const response = await fetch(base + route, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + jwt.sign({ id: user._id }, process.env.JWT_SECRET) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, ...await response.json() };
    }
    const subscription = suffix => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/' + suffix, keys: { p256dh: webpush.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 2).toString('base64url') } });
    try {
        const catalog = await request('/api/products/categories', null);
        assert.equal(describeClassification(null), '', 'Legacy listings can lack category metadata');
        assert.equal(catalog.categories.length, taxonomy.categories.length);
        for (const className of taxonomy.levels.school.classes) assert.equal(normalizeClassification('School Books', { className }).className, className);
        assert.throws(() => normalizeClassification('School Books', { className: 'Class 12' }), /stream/);
        assert.equal(normalizeClassification('School Books', { className: 'Class 10', stream: 'Commerce' }).stream, undefined);
        for (const stream of taxonomy.streams.filter(stream => stream !== 'Other')) assert.equal(normalizeClassification('School Books', { className: 'Class 12', stream }).stream, stream);
        for (const [level, stage] of Object.entries(taxonomy.levels).filter(([, stage]) => stage.courses)) {
            const course = stage.courses[0];
            assert.equal(normalizeClassification('College Books', { level, course: course.name, year: '1' }).level, level);
            assert.throws(() => normalizeClassification('College Books', { level, course: course.name, year: String(course.years + 1) }), /year/);
        }
        assert.throws(() => normalizeClassification('College Books', { level: 'masters', course: 'B.Com.', year: '1' }), /course/);
        assert.throws(() => normalizeClassification('Calculators', {}), /type/);
        assert.throws(() => normalizeClassification('Other Study Items', { itemType: 'Other' }), /Describe/);
        assert.equal(normalizeClassification('Calculators', { itemType: 'Scientific calculator', stream: 'Commerce' }).stream, undefined);
        const details = { className: 'Class 12', stream: 'Science (PCM)', board: 'CBSE / NCERT' };
        const body = { title: 'Physics', category: 'School Books', classification: details, condition: 'Good', type: 'sell', price: 100, location: 'Test City', images: ['data:image/png;base64,ZmFrZQ=='] };
        assert.equal((await request('/api/products', users[1], { ...body, classification: {} })).status, 400);
        const saved = await request('/api/products', users[1], body);
        assert.equal(saved.status, 201);
        assert.equal(saved.product.classification.stream, 'Science (PCM)');
        assert.match(describeClassification(saved.product.classification), /Class 12.*Science/);
        assert.equal((await request('/api/products/' + id(20), users[1], { category: 'Calculators', classification: { itemType: 'Scientific calculator' } }, 'PUT')).status, 200);
        assert.equal(createdProduct.classification.className, undefined, 'Changing category clears stale education data');
        console.log('PASS Taxonomy, category validation, persistence and category changes');

        assert.equal((await request('/api/notifications/push-key', null)).status, 401);
        const key = await request('/api/notifications/push-key');
        assert.ok(key.publicKey);
        assert.equal(key.privateKey, undefined);
        assert.equal((await request('/api/notifications/push-key')).publicKey, key.publicKey, 'VAPID identity persists');
        const privateAddress = { ...subscription('invalid'), endpoint: 'https://127.0.0.1/private' };
        assert.equal((await request('/api/notifications/subscriptions', users[1], { app: 'site', subscription: privateAddress })).status, 400);
        assert.equal((await request('/api/notifications/subscriptions', users[1], { app: 'admin', subscription: subscription('denied') })).status, 403);
        for (let index = 0; index < users.length; index++) {
            const user = users[index];
            if (user.status === 'suspended') continue;
            const result = await request('/api/notifications/subscriptions', user, { app: ['admin', 'employee'].includes(user.role) ? 'admin' : 'site', subscription: subscription(user._id) });
            assert.equal(result.status, 201);
        }
        const count = subscriptions.length;
        assert.equal((await request('/api/notifications/subscriptions', users[1], { endpoint: subscriptions[0].endpoint }, 'DELETE')).status, 200);
        assert.equal(subscriptions.length, count, 'A user cannot remove another account’s subscription');
        console.log('PASS Push setup, public-only keys, safe endpoints and subscription ownership');

        const thread = { _id: id(30), sender: users[1]._id, product: id(10), conversationType: 'product' };
        await notifications.notifyMessage(thread, users[1]);
        assert.deepEqual(sent.map(item => item.endpoint.split('/').pop()).sort(), [users[0]._id, users[2]._id, users[3]._id].sort());
        assert.ok(sent.every(item => item.payload.threadId === id(30) && !item.payload.body.includes('Physics')));
        sent.length = 0;
        await notifications.notifyMessage({ ...thread, conversationType: 'direct' }, users[0]);
        assert.deepEqual(sent.map(item => item.endpoint.split('/').pop()), [users[1]._id], 'A private staff reply only alerts its recipient');
        sent.length = 0;
        await notifications.notifyMessage({ ...thread, conversationType: 'direct' }, users[1]);
        assert.deepEqual(sent.map(item => item.endpoint.split('/').pop()).sort(), [users[0]._id, users[3]._id].sort(), 'User replies alert active staff only');
        await request('/api/notifications/subscriptions', users[1], { app: 'site', subscription: subscription('expired') });
        await notifications.notifyMessage({ ...thread, conversationType: 'direct' }, users[0]);
        assert.equal(subscriptions.some(item => item.endpoint.endsWith('/expired')), false);
        console.log('PASS Correct push recipients, actor exclusion, private threads and expired subscription cleanup');

        for (const [file, scope] of [['../cirvio-frontend/sw.js', 'https://site.example.test/'], ['../cirvio-backend/admin-panel/admin-sw.js', 'https://admin.example.test/panel/']]) {
            const events = {}; const alerts = []; const opened = [];
            vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
                URL,
                self: { addEventListener(name, callback) { events[name] = callback; }, registration: { scope, async showNotification(title, options) { alerts.push({ title, ...options }); } }, clients: { async matchAll() { return []; }, async openWindow(url) { opened.push(url); } } }
            });
            let work;
            events.push({ data: { json: () => ({ threadId: id(30), url: 'https://evil.example.test/' }) }, waitUntil(promise) { work = promise; } });
            await work;
            assert.equal(alerts.length, 1);
            assert.ok(alerts[0].data.url.startsWith(scope));
            assert.ok(alerts[0].data.url.includes('thread=' + id(30)));
            events.notificationclick({ notification: { ...alerts[0], close() {} }, waitUntil(promise) { work = promise; } });
            await work;
            assert.deepEqual(opened, [alerts[0].data.url]);
        }
        console.log('PASS Site/admin worker notifications open the correct chat safely');
        console.log('\n4 category and notification groups passed. No real push was sent.');
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
