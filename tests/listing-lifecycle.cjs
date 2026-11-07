/* Actual routes and schema validation with isolated model adapters. Never uses production data. */
const assert = require('node:assert/strict');
const express = require('../cirvio-backend/node_modules/express');
const jwt = require('../cirvio-backend/node_modules/jsonwebtoken');
const Product = require('../cirvio-backend/models/Product');
const Order = require('../cirvio-backend/models/Order');
const Notification = require('../cirvio-backend/models/Notification');
const User = require('../cirvio-backend/models/User');
const push = require('../cirvio-backend/services/message-notifications');
const lifecycle = require('../cirvio-backend/services/listing-notifications');
const id = n => n.toString(16).padStart(24, '0');
const users = [
    { _id: id(1), role: 'admin', status: 'active', name: 'Staff' },
    { _id: id(2), role: 'user', status: 'active', name: 'Seller' },
    { _id: id(3), role: 'user', status: 'active', name: 'Buyer', phone: 'private-phone', email: 'private@example.test' },
    { _id: id(4), role: 'user', status: 'active', name: 'Other buyer' },
    { _id: id(5), role: 'user', status: 'active', name: 'Other seller' }
];
const products = new Map(); const orders = []; const alerts = []; const deliveries = [];
let failOrder = false; let failNotification = false; let sequence = 100;
const plain = value => value?.toObject ? value.toObject() : value;
function matches(value, filter) {
    return Object.entries(filter).every(([key, expected]) => {
        if (key === 'items.seller') return value.items.some(item => String(item.seller) === String(expected));
        const actual = value[key];
        if (expected && typeof expected === 'object' && !(expected instanceof Date) && !expected._bsontype) {
            if ('$in' in expected) return expected.$in.some(item => String(item) === String(actual));
            if ('$ne' in expected) return expected.$ne === null ? actual != null : String(actual) !== String(expected.$ne);
        }
        if (expected === null) return actual == null;
        return String(actual) === String(expected);
    });
}
function apply(document, update) {
    Object.assign(document, update.$set || {});
    Object.entries(update.$inc || {}).forEach(([key, amount]) => { document[key] = (document[key] || 0) + amount; });
    Object.keys(update.$unset || {}).forEach(key => { delete document[key]; });
}
function query(read, type) {
    let sort; let limit; let populated = false;
    async function result(lean) {
        let value = await read();
        if (Array.isArray(value)) {
            if (sort) value = [...value].sort((a, b) => (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) || String(b._id).localeCompare(String(a._id)));
            value = value.slice(0, limit);
        }
        const convert = item => {
            if (!item) return item;
            if (lean || (type === 'order' && populated)) {
                const copy = { ...plain(item) };
                if (type === 'order' && populated) copy.buyer = users.find(user => user._id === String(copy.buyer));
                return copy;
            }
            if (type === 'product') return productDocument(item);
            return item;
        };
        return Array.isArray(value) ? value.map(convert) : convert(value);
    }
    return { select() { return this; }, populate() { populated = true; return this; }, sort(value) { sort = value; return this; }, limit(value) { limit = value; return this; }, lean() { return result(true); }, then(resolve, reject) { return result(false).then(resolve, reject); } };
}
function productDocument(values) {
    const document = new Product(values);
    document.save = async () => { await document.validate(); products.set(String(document._id), document.toObject()); return document; };
    document.populate = async () => document;
    return document;
}
function listing(number, status = 'pending', seller = users[1]._id) {
    const document = new Product({ _id: id(number), title: 'Listing ' + number, category: 'School Books', condition: 'Good', location: 'Test City', price: 100, seller, status, images: [], createdAt: new Date(), ...(status === 'approved' ? { reviewViewedAt: new Date(), decidedAt: new Date() } : {}) });
    products.set(id(number), document.toObject()); return id(number);
}
User.findById = key => query(() => users.find(user => user._id === String(key)) || null);
Product.findById = key => query(() => products.get(String(key)) || null, 'product');
Product.findOne = filter => query(() => [...products.values()].find(item => matches(item, filter)) || null, 'product');
Product.findOneAndUpdate = (filter, update) => query(() => {
    const current = [...products.values()].find(item => matches(item, filter));
    if (!current) return null;
    apply(current, update); return current;
}, 'product');
Product.updateMany = async (filter, update) => products.forEach(product => { if (matches(product, filter)) apply(product, update); });
Order.create = async values => {
    if (failOrder) throw new Error('Fixture order storage failed');
    const order = new Order({ ...values, createdAt: new Date() }); await order.validate();
    orders.push(order.toObject()); return order;
};
Order.find = filter => query(() => orders.filter(order => matches(order, filter)), 'order');
Order.updateOne = async (filter, update) => orders.filter(order => matches(order, filter)).forEach(order => apply(order, update));
Notification.create = async values => {
    if (failNotification) { failNotification = false; throw new Error('Fixture notification storage failed'); }
    const notification = new Notification({ _id: id(sequence++), ...values, createdAt: values.createdAt || new Date() });
    await notification.validate();
    if (alerts.some(item => item.eventKey === notification.eventKey)) throw Object.assign(new Error('Duplicate event'), { code: 11000 });
    alerts.push(notification.toObject()); return notification;
};
Notification.find = filter => query(() => alerts.filter(item => matches(item, filter)));
Notification.countDocuments = async filter => alerts.filter(item => matches(item, filter)).length;
Notification.findOneAndUpdate = async (filter, update) => { const alert = alerts.find(item => matches(item, filter)); if (alert) apply(alert, update); return alert || null; };
Notification.updateMany = async (filter, update) => alerts.filter(item => matches(item, filter)).forEach(item => apply(item, update));
push.sendPushNotifications = async (recipients, payload, options) => { deliveries.push({ recipients, payload, options }); };
process.env.JWT_SECRET = 'isolated-listing-lifecycle-secret';
const app = express(); app.use(express.json());
app.use('/api/admin', require('../cirvio-backend/routes/admin'));
app.use('/api/products', require('../cirvio-backend/routes/products'));
app.use('/api/orders', require('../cirvio-backend/routes/orders'));
app.use('/api/notifications', require('../cirvio-backend/routes/notifications'));
app.use((error, request, response, next) => response.status(500).json({ message: error.message }));

(async () => {
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, user = users[0], body, method = 'GET') {
        const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + jwt.sign({ id: user._id }, process.env.JWT_SECRET) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { http: response.status, ...await response.json() };
    }
    const review = product => request(`/api/admin/products/${product}/review-viewed`, users[0], {}, 'PUT');
    const approve = product => request(`/api/admin/products/${product}/approve`, users[0], {}, 'PUT');
    const checkout = (items, user = users[2]) => request('/api/orders', user, { items }, 'POST');
    try {
        const product = listing(10);
        assert.equal((await request(`/api/admin/products/${product}/review-viewed`, users[2], {}, 'PUT')).http, 403);
        assert.equal((await approve(product)).http, 400);
        const viewed = await review(product); assert.equal(viewed.http, 200);
        await review(product);
        assert.equal(alerts.length, 1); assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].recipients[0], users[1]._id);
        assert.equal(deliveries[0].options.app, 'site');
        assert.equal((await approve(product)).http, 200); await approve(product); await review(product);
        assert.equal(alerts.length, 2, 'Repeated views/approvals do not create duplicate alerts');
        assert.equal(String(alerts[0].recipient), users[1]._id);
        assert.equal((await request('/api/notifications', users[2])).notifications.length, 0);
        const feed = await request('/api/notifications', users[1]);
        assert.equal(feed.unreadCount, 2); assert.ok(feed.notifications.every(item => item.link === 'status.html?listing=' + product));
        const firstId = feed.notifications[0].id;
        assert.equal((await request(`/api/notifications/${firstId}/read`, users[2], {}, 'PUT')).http, 404);
        assert.equal((await request(`/api/notifications/${firstId}/read`, users[1], {}, 'PUT')).read, true);
        assert.equal((await request('/api/notifications', users[1])).unreadCount, 1);
        await request('/api/notifications/read-all', users[1], {}, 'PUT');
        assert.equal((await request('/api/notifications', users[1])).unreadCount, 0);
        console.log('PASS Review and approval events, deduplication, owner-only history and persistent reads');

        const edited = await request('/api/products/' + product, users[1], { title: 'Revised listing' }, 'PUT');
        assert.equal(edited.http, 200); assert.equal(edited.product.reviewViewedAt, undefined);
        assert.equal(edited.product.reviewRevision, 1);
        assert.equal((await approve(product)).http, 400);
        await review(product); await approve(product);
        assert.equal(alerts.length, 4, 'A resubmitted listing gets a new review cycle');
        await request(`/api/admin/products/${product}/reject`, users[0], { reason: 'Needs changes' }, 'PUT');
        await approve(product);
        assert.equal(alerts.filter(alert => alert.status === 'approved').length, 3, 'A new decision sends a fresh alert');
        console.log('PASS Resubmission resets review evidence and preserves decision history');

        const failed = listing(11, 'approved');
        const before = alerts.length;
        assert.equal((await checkout([{ productId: failed }, { productId: id(999) }])).http, 404);
        assert.equal(products.get(failed).status, 'approved');
        assert.equal((await checkout([{ productId: failed, qty: 2 }])).http, 400);
        assert.equal((await checkout([{ productId: failed }, { productId: failed }])).http, 400);
        failOrder = true;
        assert.equal((await checkout([{ productId: failed }])).http, 500);
        failOrder = false;
        assert.equal(products.get(failed).status, 'approved'); assert.equal(products.get(failed).selectedOrder, undefined);
        assert.equal(alerts.length, before, 'Failed or invalid checkouts send no buyer alerts');
        const results = await Promise.all([checkout([{ productId: failed }]), checkout([{ productId: failed }], users[3])]);
        assert.equal(results.filter(result => result.http === 201).length, 1);
        assert.equal(orders.length, 1);
        assert.equal(alerts.filter(alert => alert.status === 'buyer-selected').length, 1);
        assert.equal(String(products.get(failed).selectedBuyer), String(orders[0].buyer));
        assert.equal((await approve(failed)).http, 409);
        assert.equal((await request('/api/products/' + failed, users[1], { title: 'Cannot edit a selected item' }, 'PUT')).http, 409);
        console.log('PASS Checkout validation, rollback, competing buyers and no false selection alerts');

        const retryProduct = listing(12, 'approved');
        failNotification = true;
        const ordered = await checkout([{ productId: retryProduct }]);
        assert.equal(ordered.http, 201, 'A notification outage must not turn a committed order into a failed checkout');
        const retryOrder = orders.find(order => String(order._id) === ordered.order._id);
        assert.equal(retryOrder.notificationPending, true);
        const deliveryCount = deliveries.length;
        await lifecycle.recordOrderEvents(retryOrder); await lifecycle.recordOrderEvents(retryOrder);
        assert.equal(retryOrder.notificationPending, false);
        assert.equal(deliveries.length, deliveryCount + 1);
        console.log('PASS Durable order notification retries are idempotent');

        orders[0].items.push({ product: id(50), seller: users[4]._id, title: 'Other seller private item', price: 900, qty: 1 });
        orders[0].adminNotes = 'Staff only'; orders[0].deliveryAddress = 'Buyer private address';
        const selling = await request('/api/orders/selling', users[1]);
        const visible = selling.orders.find(order => order._id === String(orders[0]._id));
        assert.equal(visible.items.length, 1); assert.equal(visible.totalAmount, 100);
        assert.equal(visible.deliveryAddress, undefined); assert.equal(visible.adminNotes, undefined);
        assert.equal(visible.buyer.email, undefined); assert.equal(visible.buyer.phone, undefined);
        const publicView = await request('/api/products/' + failed, null);
        assert.equal(publicView.product.selectedBuyer, undefined); assert.equal(publicView.product.selectedOrder, undefined);
        assert.equal(publicView.product.buyerSelectedAt, undefined);
        console.log('PASS Seller order details exclude other sellers and private buyer/staff fields');
        console.log('\n5 listing lifecycle groups passed. No real notifications were sent.');
    } finally {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
