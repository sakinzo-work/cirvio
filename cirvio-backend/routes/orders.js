const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { protect } = require('../middleware/auth');
const mongoose = require('mongoose');
const listingNotifications = require('../services/listing-notifications');
const { createOtp, readOtp } = require('../services/order-otp');
const { calculateDelivery } = require('../services/delivery-pricing');

const router = express.Router();

function orderObject(order) { return order.toObject ? order.toObject() : order; }
function positiveWeight(value) {
    const weight = Number(value);
    return Number.isFinite(weight) && weight >= 0.05 && weight <= 50 ? weight : 0.5;
}
function cityForProduct(product) { return String(product.deliveryCity || product.location || '').trim(); }
function requestedDelivery(body = {}) {
    const delivery = body.delivery && typeof body.delivery === 'object' ? body.delivery : {};
    return {
        address: String(delivery.address ?? body.deliveryAddress ?? '').trim(),
        city: String(delivery.city ?? '').trim(),
        distanceKm: delivery.distanceKm
    };
}
function priceQuote(orderItems, delivery) {
    return calculateDelivery({
        subtotal: orderItems.reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 1), 0),
        shipmentWeightKg: orderItems.reduce((total, item) => total + positiveWeight(item.shippingWeightKg) * Number(item.qty || 1), 0),
        deliveryCity: delivery.city,
        originCities: orderItems.map(item => item.sourceCity),
        distanceKm: delivery.distanceKm
    });
}

async function collectOrderItems(items, buyerId) {
    if (!Array.isArray(items) || items.length === 0) throw Object.assign(new Error('Cart is empty'), { status: 400 });
    if (items.length > 50) throw Object.assign(new Error('An order can contain at most 50 listings'), { status: 400 });
    const orderItems = [];
    const seen = new Set();
    for (const line of items) {
        if (!line?.productId || !mongoose.Types.ObjectId.isValid(line.productId)) throw Object.assign(new Error('Choose a valid listing'), { status: 400 });
        const key = String(line.productId);
        if (seen.has(key)) throw Object.assign(new Error('Each listing can appear only once in an order'), { status: 400 });
        seen.add(key);
        if (line.qty !== undefined && Number(line.qty) !== 1) throw Object.assign(new Error('Each listing has one available copy'), { status: 400 });
        const product = await Product.findById(line.productId);
        if (!product) throw Object.assign(new Error(`Product ${line.productId} not found`), { status: 404 });
        if (product.status !== 'approved') throw Object.assign(new Error(`"${product.title}" is not available for purchase`), { status: 400 });
        if (product.type === 'rent') throw Object.assign(new Error(`"${product.title}" is available for rent. Contact the owner to arrange the rental.`), { status: 400 });
        if (String(product.seller) === String(buyerId)) throw Object.assign(new Error(`You can't buy your own listing "${product.title}"`), { status: 400 });
        orderItems.push({
            product: product._id,
            seller: product.seller,
            title: product.title,
            price: product.price,
            qty: 1,
            img: product.images && product.images[0] ? product.images[0] : '',
            shippingWeightKg: positiveWeight(product.shippingWeightKg),
            sourceCity: cityForProduct(product)
        });
    }
    return orderItems;
}

function otpState(order, stage, { revealCode = false } = {}) {
    const prefix = stage === 'pickup' ? 'pickupOtp' : 'deliveryOtp';
    const hash = order[`${prefix}Hash`];
    const expiresAt = order[`${prefix}ExpiresAt`];
    const verifiedAt = order[`${prefix}VerifiedAt`];
    const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
    const state = {
        required: Boolean(hash), verified: Boolean(verifiedAt), verifiedAt: verifiedAt || null,
        expiresAt: expiresAt || null, expired,
        attemptsRemaining: hash ? Math.max(0, 5 - Number(order[`${prefix}Attempts`] || 0)) : 0
    };
    if (revealCode && state.required && !state.verified && !state.expired) state.code = readOtp(order[`${prefix}Cipher`]);
    return state;
}

function safeSellingOrder(order, sellerId) {
    const obj = orderObject(order);
    const buyer = obj.buyer && typeof obj.buyer === 'object' ? { _id: obj.buyer._id, name: obj.buyer.name, college: obj.buyer.college } : obj.buyer;
    const items = obj.items.filter(item => String(item.seller?._id || item.seller) === String(sellerId));
    return {
        _id: obj._id, buyer, items, totalAmount: items.reduce((total, item) => total + item.price * item.qty, 0), status: obj.status,
        paymentStatus: obj.paymentStatus, dispatchStatus: obj.dispatchStatus, dispatchMode: obj.dispatchMode,
        trackingId: obj.trackingId, dispatchPartner: obj.dispatchPartner, createdAt: obj.createdAt, updatedAt: obj.updatedAt,
        pickupOtp: otpState(obj, 'pickup', { revealCode: true })
    };
}

function safeBuyerOrder(order) {
    const obj = orderObject(order);
    const { pickupOtpHash, pickupOtpCipher, pickupOtpAttempts, deliveryOtpHash, deliveryOtpCipher, deliveryOtpAttempts, ...safe } = obj;
    return { ...safe, pickupOtp: otpState(obj, 'pickup'), deliveryOtp: otpState(obj, 'delivery', { revealCode: true }) };
}

// POST /api/orders/quote — server-side delivery preview. Product price and weight are always read from the database.
router.post('/quote', protect, async (req, res, next) => {
    try {
        const orderItems = await collectOrderItems(req.body.items, req.user._id);
        const delivery = requestedDelivery(req.body);
        const quote = priceQuote(orderItems, delivery);
        const subtotal = orderItems.reduce((total, item) => total + item.price * item.qty, 0);
        res.json({ subtotal, delivery: quote, grandTotal: Number.isFinite(quote.finalFee) ? subtotal + quote.finalFee : null });
    } catch (error) {
        if (error.status || /delivery|shipment weight/i.test(error.message || '')) return res.status(error.status || 400).json({ message: error.message });
        next(error);
    }
});

// POST /api/orders — checkout the cart. Body: { items, delivery: { address, city, distanceKm } }
router.post('/', protect, async (req, res) => {
    const orderId = new mongoose.Types.ObjectId();
    const reserved = [];
    let committed = false;
    async function release() {
        if (committed || !reserved.length) return;
        await Product.updateMany({ _id: { $in: reserved }, selectedOrder: orderId, status: 'sold' },
            { $set: { status: 'approved' }, $unset: { selectedOrder: 1, selectedBuyer: 1, buyerSelectedAt: 1 } });
    }
    try {
        const orderItems = await collectOrderItems(req.body.items, req.user._id);
        const deliveryInput = requestedDelivery(req.body);
        if (!deliveryInput.address) return res.status(400).json({ message: 'Enter the delivery address before placing the order' });
        const delivery = priceQuote(orderItems, deliveryInput);
        const totalAmount = orderItems.reduce((total, item) => total + item.price * item.qty, 0);

        // Validate the entire cart before reserving. Only one buyer can claim each single-copy listing.
        for (const item of orderItems) {
            const product = await Product.findOneAndUpdate({ _id: item.product, status: 'approved', type: { $ne: 'rent' }, price: item.price, title: item.title, seller: item.seller },
                { $set: { status: 'sold', selectedOrder: orderId, selectedBuyer: req.user._id, buyerSelectedAt: new Date() } }, { new: true });
            if (!product) {
                await release();
                return res.status(409).json({ message: `"${item.title}" was just selected by another buyer. Please refresh your cart.` });
            }
            reserved.push(item.product);
        }

        const pickupOtp = createOtp();
        const deliveryOtp = createOtp();
        const order = await Order.create({
            _id: orderId, buyer: req.user._id, notificationPending: true, items: orderItems, totalAmount,
            grandTotal: Number.isFinite(delivery.finalFee) ? totalAmount + delivery.finalFee : null,
            delivery, paymentStatus: 'pending', paymentMode: 'manual', dispatchStatus: 'not-dispatched', dispatchMode: 'pending',
            deliveryAddress: deliveryInput.address,
            pickupOtpHash: pickupOtp.hash, pickupOtpCipher: pickupOtp.cipher, pickupOtpExpiresAt: pickupOtp.expiresAt,
            deliveryOtpHash: deliveryOtp.hash, deliveryOtpCipher: deliveryOtp.cipher, deliveryOtpExpiresAt: deliveryOtp.expiresAt
        });
        committed = true;
        try { await listingNotifications.recordOrderEvents(order); } catch { console.warn('Seller notifications will retry after checkout'); }
        res.status(201).json({ order: safeBuyerOrder(order) });
    } catch (err) {
        try { await release(); } catch { console.error('Could not release an incomplete checkout reservation'); }
        if (err.status || /delivery|shipment weight/i.test(err.message || '')) return res.status(err.status || 400).json({ message: err.message });
        res.status(500).json({ message: 'Failed to place order', error: err.message });
    }
});

router.get('/my', protect, async (req, res, next) => {
    try {
        const orders = await Order.find({ buyer: req.user._id }).select('+pickupOtpHash +pickupOtpCipher +deliveryOtpHash +deliveryOtpCipher').populate('items.seller', 'name college').sort({ createdAt: -1 });
        res.json({ count: orders.length, orders: orders.map(safeBuyerOrder) });
    } catch (error) { next(error); }
});

router.get('/selling', protect, async (req, res, next) => {
    try {
        const orders = await Order.find({ 'items.seller': req.user._id }).select('+pickupOtpHash +pickupOtpCipher +deliveryOtpHash +deliveryOtpCipher').populate('buyer', 'name college').sort({ createdAt: -1 });
        res.json({ count: orders.length, orders: orders.map(order => safeSellingOrder(order, req.user._id)) });
    } catch (error) { next(error); }
});

module.exports = router;
