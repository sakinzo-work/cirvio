const express = require('express');
const { createHash } = require('crypto');
const PushSubscription = require('../models/PushSubscription');
const { protect } = require('../middleware/auth');
const { getVapidKeys } = require('../services/message-notifications');
const router = express.Router();
const hash = endpoint => createHash('sha256').update(endpoint).digest('hex');

function validSubscription(subscription) {
    try {
        const endpoint = new URL(subscription.endpoint);
        const host = endpoint.hostname;
        const trusted = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') || host === 'web.push.apple.com' || host.endsWith('.notify.windows.com');
        return trusted && endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && (!endpoint.port || endpoint.port === '443') && subscription.endpoint.length <= 2048
            && /^[A-Za-z0-9_-]+=*$/.test(subscription.keys?.p256dh || '') && Buffer.from(subscription.keys.p256dh, 'base64url').length === 65
            && /^[A-Za-z0-9_-]+=*$/.test(subscription.keys?.auth || '') && Buffer.from(subscription.keys.auth, 'base64url').length === 16;
    } catch { return false; }
}

router.use(protect);
router.get('/push-key', async (req, res, next) => {
    try { res.json({ publicKey: (await getVapidKeys()).publicKey }); }
    catch (error) { next(error); }
});
router.post('/subscriptions', async (req, res, next) => {
    try {
        const { subscription, app } = req.body;
        if (!['site', 'admin'].includes(app) || !validSubscription(subscription)) return res.status(400).json({ message: 'The browser notification subscription is invalid. Please enable notifications again.' });
        if (app === 'admin' && !['admin', 'employee'].includes(req.user.role)) return res.status(403).json({ message: 'Staff access required' });
        await PushSubscription.findOneAndUpdate({ endpointHash: hash(subscription.endpoint) }, { user: req.user._id, app, endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }, { upsert: true, new: true, runValidators: true });
        res.status(201).json({ enabled: true });
    } catch (error) { next(error); }
});
router.delete('/subscriptions', async (req, res, next) => {
    try {
        if (typeof req.body.endpoint !== 'string' || req.body.endpoint.length > 2048) return res.status(400).json({ message: 'A subscription endpoint is required' });
        await PushSubscription.deleteOne({ user: req.user._id, endpointHash: hash(req.body.endpoint) });
        res.json({ enabled: false });
    } catch (error) { next(error); }
});

module.exports = router;
