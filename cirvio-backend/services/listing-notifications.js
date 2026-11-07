const Notification = require('../models/Notification');
const push = require('./message-notifications');
const Order = require('../models/Order');

async function recordListingEvent(product, status, { order, occurredAt } = {}) {
    const productId = product._id || product.product;
    const recipient = product.seller?._id || product.seller;
    if (!productId || !recipient) throw new Error('Listing notification needs a seller and listing');
    const title = String(product.title || 'Your listing').slice(0, 150);
    const copy = {
        viewed: ['CIRVIO viewed your listing', `CIRVIO has viewed the photos and details of "${title}".`],
        approved: ['Your listing is approved', `"${title}" is approved and live on CIRVIO.`],
        rejected: ['Your listing needs changes', `"${title}" needs changes. Open Listing Status to see the review feedback.`],
        'buyer-selected': ['A buyer selected your listing', `A buyer placed an order for "${title}". Payment and fulfilment are awaiting confirmation.`]
    }[status];
    if (!copy || (status === 'buyer-selected' && !order)) throw new Error('Invalid listing notification event');
    const eventKey = status === 'buyer-selected'
        ? `order:${order._id || order}:${productId}:buyer-selected`
        : `listing:${productId}:review:${Number(product.reviewRevision) || 0}:${status}${status === 'viewed' ? '' : `:decision:${Number(product.decisionRevision) || 0}`}`;
    let notification;
    try {
        notification = await Notification.create({ recipient, eventKey, product: productId, order: order?._id || order, status, title: copy[0], text: copy[1], ...(occurredAt ? { createdAt: occurredAt } : {}) });
    } catch (error) {
        if (error.code === 11000) return null;
        throw error;
    }
    // Notification history is durable before attempting device delivery.
    push.sendPushNotifications([String(recipient)], {
        kind: 'listing', status, productId: String(productId), notificationId: String(notification._id),
        title: notification.title, body: notification.text, tag: eventKey
    }, { app: 'site' }).catch(() => console.warn('Listing push delivery is unavailable'));
    return notification;
}

async function recordOrderEvents(order) {
    const results = await Promise.allSettled(order.items.map(item => recordListingEvent({ _id: item.product, seller: item.seller, title: item.title }, 'buyer-selected', { order, occurredAt: order.createdAt })));
    if (results.some(result => result.status === 'rejected')) return false;
    await Order.updateOne({ _id: order._id }, { $set: { notificationPending: false } });
    return true;
}

let retrying = false;
function startNotificationRetries() {
    const timer = setInterval(async () => {
        if (retrying) return;
        retrying = true;
        try {
            const pending = await Order.find({ notificationPending: true }).sort({ createdAt: 1 }).limit(20).lean();
            for (const order of pending) await recordOrderEvents(order);
        } catch { console.warn('Order notification retry is waiting for the database'); }
        finally { retrying = false; }
    }, 30000);
    timer.unref();
}

module.exports = { recordListingEvent, recordOrderEvents, startNotificationRetries };
