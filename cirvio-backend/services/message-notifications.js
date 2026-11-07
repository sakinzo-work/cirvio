const webpush = require('web-push');
const AppSetting = require('../models/AppSetting');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const Product = require('../models/Product');
let vapidPromise;

async function getVapidKeys() {
    if (!vapidPromise) vapidPromise = (async () => {
        if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
        // Persist keys in MongoDB so app restarts and multiple server instances use the same identity.
        const existing = await AppSetting.findOne({ key: 'webPushVapid' }).lean();
        if (existing?.value?.publicKey && existing.value.privateKey) return existing.value;
        const generated = webpush.generateVAPIDKeys();
        let setting;
        try {
            setting = await AppSetting.findOneAndUpdate({ key: 'webPushVapid' }, { $setOnInsert: { value: generated } }, { upsert: true, new: true });
        } catch (error) {
            if (error.code !== 11000) throw error;
            setting = await AppSetting.findOne({ key: 'webPushVapid' });
        }
        if (!setting?.value?.publicKey || !setting.value.privateKey) throw new Error('Notification setup is unavailable');
        return setting.value;
    })().catch(error => { vapidPromise = null; throw error; });
    return vapidPromise;
}

async function notifyMessage(message, actor) {
    const recipients = new Set([String(message.sender)]);
    if (message.conversationType !== 'direct' && message.product) {
        const product = await Product.findById(message.product).select('seller').lean();
        if (product?.seller) recipients.add(String(product.seller));
    }
    if (!['admin', 'employee'].includes(actor.role)) {
        const staff = await User.find({ role: { $in: ['admin', 'employee'] }, status: 'active' }).select('_id').lean();
        staff.forEach(user => recipients.add(String(user._id)));
    }
    recipients.delete(String(actor._id));
    return sendPushNotifications([...recipients], { title: 'CIRVIO · New message', body: 'You have a new message. Tap to open the conversation.', threadId: String(message._id), tag: `cirvio-message-${message._id}` });
}

async function sendPushNotifications(recipientIds, payload, { app } = {}) {
    const recipients = new Set(recipientIds.map(String));
    const subscriptions = await PushSubscription.find({ user: { $in: [...recipients] } }).lean();
    if (!subscriptions.length) return;
    const keys = await getVapidKeys();
    // Recheck account status/role so a suspended or demoted account receives no staff alerts.
    const allowedUsers = await User.find({ _id: { $in: [...recipients] }, status: 'active' }).select('_id role').lean();
    const roles = new Map(allowedUsers.map(user => [String(user._id), user.role]));
    await Promise.allSettled(subscriptions.filter(subscription => (!app || subscription.app === app) && roles.has(String(subscription.user)) && (subscription.app !== 'admin' || ['admin', 'employee'].includes(roles.get(String(subscription.user))))).map(async subscription => {
        try {
            await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, JSON.stringify(payload), { TTL: 86400, urgency: 'high', timeout: 5000, vapidDetails: { subject: process.env.VAPID_SUBJECT || 'https://cirvio.onrender.com', ...keys } });
        } catch (error) {
            if ([404, 410].includes(error.statusCode)) await PushSubscription.deleteOne({ _id: subscription._id });
            else console.warn('Message push delivery failed:', error.statusCode || 'unavailable');
        }
    }));
}

function queueMessageNotification(message, actor) {
    notifyMessage(message, actor).catch(() => console.warn('Message notification could not be delivered'));
}

module.exports = { getVapidKeys, notifyMessage, queueMessageNotification, sendPushNotifications };
