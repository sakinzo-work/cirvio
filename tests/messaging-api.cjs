/* Real Express routes and Mongoose validation with an isolated in-memory model adapter. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('../cirvio-backend/node_modules/express');
const jwt = require('../cirvio-backend/node_modules/jsonwebtoken');
const Message = require('../cirvio-backend/models/Message');
const User = require('../cirvio-backend/models/User');
const Product = require('../cirvio-backend/models/Product');
require('../cirvio-backend/services/message-notifications').queueMessageNotification = () => {};
const id = number => number.toString(16).padStart(24, '0');
const users = [
    { _id: id(1), name: 'Admin', role: 'admin', status: 'active' },
    { _id: id(2), name: 'Employee', role: 'employee', status: 'active' },
    { _id: id(3), name: 'Seller', role: 'user', status: 'active' },
    { _id: id(4), name: 'Buyer', role: 'user', status: 'active' },
    { _id: id(5), name: 'Other user', role: 'user', status: 'active' },
    { _id: id(6), name: 'Literal .* user', role: 'user', status: 'active' }
];
const product = { _id: id(10), title: 'A real listing context', images: [], seller: id(3) };
const messages = [];
let sequence = 100;
function matches(value, filter) {
    return Object.entries(filter).every(([key, expected]) => {
        if (key === '$or') return expected.some(option => matches(value, option));
        const actual = value[key];
        if (expected && typeof expected === 'object') {
            if ('$ne' in expected) return String(actual) !== String(expected.$ne);
            if ('$in' in expected) return expected.$in.some(item => String(item) === String(actual));
            if ('$regex' in expected) return new RegExp(expected.$regex, expected.$options).test(actual || '');
        }
        return String(actual) === String(expected);
    });
}
function plain(value) { return value?.toObject ? value.toObject() : structuredClone(value); }
function populated(value) {
    if (!value) return null;
    const result = plain(value);
    if (result.sender) result.sender = users.find(user => user._id === String(result.sender));
    if (result.product) result.product = { ...product, seller: users[2] };
    result.replies = (result.replies || []).map(reply => ({ ...reply, sender: users.find(user => user._id === String(reply.sender)) }));
    return result;
}
function query(read, mayPopulate = false) {
    let populate = false;
    let maximum;
    const result = {
        select() { return this; }, sort() { return this; },
        limit(value) { maximum = value; return this; },
        populate() { populate = true; return this; },
        async lean() {
            let value = await read();
            if (Array.isArray(value)) value = value.slice(0, maximum).map(item => mayPopulate && populate ? populated(item) : plain(item));
            else value = mayPopulate && populate ? populated(value) : plain(value);
            return value;
        },
        then(resolve, reject) { return Promise.resolve().then(read).then(resolve, reject); }
    };
    return result;
}
const originals = { userId: User.findById, userFind: User.find, productId: Product.findById, productFind: Product.find, messageFind: Message.find, messageId: Message.findById, messageOne: Message.findOne, create: Message.create };
User.findById = value => query(() => users.find(user => user._id === String(value)) || null);
User.find = filter => query(() => users.filter(user => matches(user, filter)));
Product.findById = value => query(() => String(value) === product._id ? product : null);
Product.find = filter => query(() => matches(product, filter) ? [product] : []);
Message.find = filter => query(() => messages.filter(message => matches(message, filter)), true);
Message.findById = value => query(() => messages.find(message => String(message._id) === String(value)) || null, true);
Message.findOne = filter => query(() => messages.find(message => matches(message, filter)) || null, true);
Message.create = async values => {
    // Simulate the unique MongoDB index even when two opens both saw no conversation.
    if (values.conversationKey && messages.some(message => message.conversationKey === values.conversationKey)) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
    const document = new Message({ _id: id(sequence++), ...values, createdAt: new Date(), updatedAt: new Date() });
    await document.validate();
    if (values.conversationKey && messages.some(message => message.conversationKey === values.conversationKey)) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
    document.save = async () => { await document.validate(); document.updatedAt = new Date(); return document; };
    document.deleteOne = async () => { messages.splice(messages.indexOf(document), 1); };
    messages.push(document);
    return document;
};
process.env.JWT_SECRET = 'isolated-messaging-test-secret';
const app = express();
app.use(express.json());
app.use('/api/admin', require('../cirvio-backend/routes/admin'));
app.use('/api/messages', require('../cirvio-backend/routes/messages'));
app.use((error, request, response, next) => response.status(500).json({ message: error.message }));

(async () => {
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, user = users[0], body, method) {
        const response = await fetch(base + route, {
            method: method || (body ? 'POST' : 'GET'),
            headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + jwt.sign({ id: user._id }, process.env.JWT_SECRET) } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        return { status: response.status, ...await response.json() };
    }
    try {
        const workerEvents = {};
        const deletedCaches = [];
        const siteOrigin = 'https://cirvio.example.test';
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cirvio-frontend/sw.js'), 'utf8'), {
            URL,
            location: { origin: siteOrigin },
            self: { addEventListener(name, listener) { workerEvents[name] = listener; }, clients: { async claim() {} } },
            caches: { async keys() { return ['cirvio-cache-v13', 'cirvio-cache-v14', 'cirvio-admin-shell-v5', 'unrelated-app']; }, async delete(key) { deletedCaches.push(key); } }
        });
        let activation;
        workerEvents.activate({ waitUntil(promise) { activation = promise; } });
        await activation;
        assert.deepEqual(deletedCaches, ['cirvio-cache-v13'], 'Website updates preserve admin and unrelated caches');
        for (const [url, headers] of [
            [siteOrigin + '/api/messages/my', {}],
            ['https://api.example.test/api/messages/my', {}],
            [siteOrigin + '/private-data', { Authorization: 'Bearer fixture' }]
        ]) {
            let intercepted = false;
            workerEvents.fetch({ request: new Request(url, { headers }), respondWith() { intercepted = true; } });
            assert.equal(intercepted, false, 'Private API reads bypass PWA cache');
        }
        console.log('PASS Website PWA bypasses private data and preserves the admin cache');

        assert.equal((await request('/api/admin/message-recipients', null)).status, 401);
        assert.equal((await request('/api/admin/message-recipients', users[3])).status, 403);
        assert.equal((await request('/api/admin/messages/conversations', users[3], { userId: users[2]._id })).status, 403);
        const found = await request('/api/admin/message-recipients?q=' + encodeURIComponent('.*'), users[1]);
        assert.deepEqual(found.users.map(user => user._id), [users[5]._id], 'Search treats regex characters literally');
        assert.equal((await request('/api/admin/message-recipients')).users.some(user => user._id === users[0]._id), false);
        console.log('PASS Staff-only recipient search and literal queries');

        assert.equal((await request('/api/admin/messages/conversations', users[0], { userId: 'bad' })).status, 400);
        assert.equal((await request('/api/admin/messages/conversations', users[0], { userId: id(999) })).status, 404);
        assert.equal((await request('/api/admin/messages/conversations', users[0], { userId: users[0]._id })).status, 400);
        assert.equal((await request('/api/admin/messages/conversations', users[0], { productId: 'bad' })).status, 400);
        assert.equal((await request('/api/admin/messages/conversations', users[0], { productId: id(999) })).status, 404);
        assert.equal((await request('/api/admin/messages/conversations', users[0], { productId: product._id, userId: users[4]._id })).status, 400);
        const parallel = await Promise.all(Array.from({ length: 4 }, () => request('/api/admin/messages/conversations', users[0], { userId: users[3]._id })));
        assert.ok(parallel.every(result => [200, 201].includes(result.status)));
        assert.equal(new Set(parallel.map(result => result.message._id)).size, 1, 'Concurrent opens reuse one conversation');
        const direct = parallel[0].message;
        assert.equal(direct.product, undefined);
        assert.equal(direct.text, '');
        assert.equal(direct.replies.length, 0);
        assert.equal((await request(`/api/admin/messages/${direct._id}/reply`, users[1], { text: 'Hello from CIRVIO' })).message.replies[0].senderRole, 'employee');
        assert.equal((await request('/api/messages/my', users[3])).messages[0]._id, direct._id);
        assert.equal((await request(`/api/messages/${direct._id}/replies`, users[3], { text: 'Thank you' })).status, 201);
        assert.equal((await request(`/api/messages/${direct._id}/replies`, users[4], { text: 'Intrusion' })).status, 403);
        console.log('PASS Direct conversations, concurrent opens and two-way replies');

        const listing = (await request('/api/admin/messages/conversations', users[1], { productId: product._id })).message;
        assert.equal(listing.sender._id, users[2]._id);
        assert.equal(listing.product._id, product._id);
        assert.equal((await request('/api/admin/messages/conversations', users[0], { productId: product._id })).message._id, listing._id);
        assert.equal((await request(`/api/messages/${listing._id}/replies`, users[2], { text: 'Seller reply' })).message.replies[0].senderRole, 'seller');
        // A product-linked private chat addressed to the buyer must never leak to its seller.
        const privateBuyer = await Message.create({ sender: users[3]._id, product: product._id, conversationType: 'direct', text: '' });
        const group = await Message.create({ sender: users[3]._id, product: product._id, text: 'Legacy product enquiry' });
        const sellerInbox = (await request('/api/messages/my', users[2])).messages.map(message => message._id);
        assert.ok(sellerInbox.includes(listing._id));
        assert.ok(sellerInbox.includes(String(group._id)), 'Legacy group access preserved');
        assert.ok(!sellerInbox.includes(direct._id));
        assert.ok(!sellerInbox.includes(String(privateBuyer._id)), 'Seller cannot see another recipient’s private product chat');
        assert.equal((await request(`/api/messages/${privateBuyer._id}/replies`, users[2], { text: 'Intrusion' })).status, 403);
        assert.equal((await request(`/api/messages/${privateBuyer._id}`, users[2], undefined, 'DELETE')).status, 403);
        assert.equal((await request(`/api/messages/${group._id}/replies`, users[2], { text: 'Group seller reply' })).status, 201);
        console.log('PASS Listing context, participant isolation and legacy group compatibility');

        for (const text of ['', ' ', 'x'.repeat(2001)]) {
            assert.equal((await request(`/api/admin/messages/${direct._id}/reply`, users[0], { text })).status, 400);
            assert.equal((await request(`/api/messages/${direct._id}/replies`, users[3], { text })).status, 400);
        }
        assert.equal((await request('/api/admin/messages/bad/reply', users[0], { text: 'Hello' })).status, 400);
        assert.equal((await request('/api/messages', users[3], { productId: product._id, text: 'x'.repeat(2001) })).status, 400);
        assert.ok(Message.schema.indexes().some(([fields, options]) => fields.conversationKey === 1 && options.unique && options.partialFilterExpression));
        await assert.rejects(new Message({ sender: users[3]._id, text: 'Missing product' }).validate());
        console.log('PASS Message validation and unique conversation index');
        console.log('\n5 messaging API and cache groups passed. No production data was used.');
    } finally {
        Object.assign(User, { findById: originals.userId, find: originals.userFind });
        Object.assign(Product, { findById: originals.productId, find: originals.productFind });
        Object.assign(Message, { find: originals.messageFind, findById: originals.messageId, findOne: originals.messageOne, create: originals.create });
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
