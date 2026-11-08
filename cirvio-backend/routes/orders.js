const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { protect } = require('../middleware/auth');
const mongoose = require('mongoose');
const listingNotifications = require('../services/listing-notifications');

const router = express.Router();

function safeSellingOrder(order, sellerId) {
    const obj = order.toObject ? order.toObject() : order;
    const buyer = obj.buyer && typeof obj.buyer === 'object'
        ? {
            _id: obj.buyer._id,
            name: obj.buyer.name,
            college: obj.buyer.college
        }
        : obj.buyer;
    const items = obj.items.filter(item => String(item.seller) === String(sellerId));
    return { _id: obj._id, buyer, items, totalAmount: items.reduce((total, item) => total + item.price * item.qty, 0), status: obj.status,
        paymentStatus: obj.paymentStatus, dispatchStatus: obj.dispatchStatus, dispatchMode: obj.dispatchMode,
        trackingId: obj.trackingId, dispatchPartner: obj.dispatchPartner, createdAt: obj.createdAt, updatedAt: obj.updatedAt };
}

// POST /api/orders — checkout the cart. Body: { items: [{ productId, qty }], deliveryAddress }
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
        const { items, deliveryAddress } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }
        if (items.length > 50) return res.status(400).json({ message: 'An order can contain at most 50 listings' });

        const orderItems = [];
        let totalAmount = 0;

        const seen = new Set();
        for (const line of items) {
            if (!line?.productId || !mongoose.Types.ObjectId.isValid(line.productId)) return res.status(400).json({ message: 'Choose a valid listing' });
            const key = String(line.productId);
            if (seen.has(key)) return res.status(400).json({ message: 'Each listing can appear only once in an order' });
            seen.add(key);
            if (line.qty !== undefined && Number(line.qty) !== 1) return res.status(400).json({ message: 'Each listing has one available copy' });
            const product = await Product.findById(line.productId);
            if (!product) return res.status(404).json({ message: `Product ${line.productId} not found` });
            if (product.status !== 'approved') {
                return res.status(400).json({ message: `"${product.title}" is not available for purchase` });
            }
            if (product.type === 'rent') {
                return res.status(400).json({ message: `"${product.title}" is available for rent. Contact the owner to arrange the rental.` });
            }
            if (String(product.seller) === String(req.user._id)) {
                return res.status(400).json({ message: `You can't buy your own listing "${product.title}"` });
            }
            const qty = 1;
            orderItems.push({
                product: product._id,
                seller: product.seller,
                title: product.title,
                price: product.price,
                qty,
                img: product.images && product.images[0] ? product.images[0] : ''
            });
            totalAmount += product.price * qty;

        }

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

        const order = await Order.create({
            _id: orderId,
            buyer: req.user._id,
            notificationPending: true,
            items: orderItems,
            totalAmount,
            paymentStatus: 'pending',
            paymentMode: 'manual',
            dispatchStatus: 'not-dispatched',
            dispatchMode: 'pending',
            deliveryAddress: deliveryAddress || ''
        });
        committed = true;
        try { await listingNotifications.recordOrderEvents(order); }
        catch { console.warn('Seller notifications will retry after checkout'); }
        res.status(201).json({ order });
    } catch (err) {
        try { await release(); } catch { console.error('Could not release an incomplete checkout reservation'); }
        res.status(500).json({ message: 'Failed to place order', error: err.message });
    }
});

// GET /api/orders/my — orders I placed (as buyer)
router.get('/my', protect, async (req, res, next) => {
    try {
        const orders = await Order.find({ buyer: req.user._id })
            .populate('items.seller', 'name college')
            .sort({ createdAt: -1 });
        res.json({ count: orders.length, orders });
    } catch (error) { next(error); }
});

// GET /api/orders/selling — orders that include items I'm selling
router.get('/selling', protect, async (req, res, next) => {
    try {
        const orders = await Order.find({ 'items.seller': req.user._id })
            .populate('buyer', 'name college')
            .sort({ createdAt: -1 });
        res.json({ count: orders.length, orders: orders.map(order => safeSellingOrder(order, req.user._id)) });
    } catch (error) { next(error); }
});

module.exports = router;
