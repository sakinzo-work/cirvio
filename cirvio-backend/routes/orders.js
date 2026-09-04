const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { protect } = require('../middleware/auth');

const router = express.Router();

function safeSellingOrder(order) {
    const obj = order.toObject ? order.toObject() : order;
    const buyer = obj.buyer && typeof obj.buyer === 'object'
        ? {
            _id: obj.buyer._id,
            name: obj.buyer.name,
            college: obj.buyer.college
        }
        : obj.buyer;
    const { deliveryAddress, ...safeOrder } = obj;
    return { ...safeOrder, buyer };
}

// POST /api/orders — checkout the cart. Body: { items: [{ productId, qty }], deliveryAddress }
router.post('/', protect, async (req, res) => {
    try {
        const { items, deliveryAddress } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const orderItems = [];
        let totalAmount = 0;

        for (const line of items) {
            const product = await Product.findById(line.productId);
            if (!product) return res.status(404).json({ message: `Product ${line.productId} not found` });
            if (product.status !== 'approved') {
                return res.status(400).json({ message: `"${product.title}" is not available for purchase` });
            }
            if (String(product.seller) === String(req.user._id)) {
                return res.status(400).json({ message: `You can't buy your own listing "${product.title}"` });
            }
            const qty = Number(line.qty) || 1;
            orderItems.push({
                product: product._id,
                seller: product.seller,
                title: product.title,
                price: product.price,
                qty,
                img: product.images && product.images[0] ? product.images[0] : ''
            });
            totalAmount += product.price * qty;

            // single-copy items (books/notes) — mark sold so it leaves the browse grid
            product.status = 'sold';
            await product.save();
        }

        const order = await Order.create({
            buyer: req.user._id,
            items: orderItems,
            totalAmount,
            deliveryAddress: deliveryAddress || ''
        });

        res.status(201).json({ order });
    } catch (err) {
        res.status(500).json({ message: 'Failed to place order', error: err.message });
    }
});

// GET /api/orders/my — orders I placed (as buyer)
router.get('/my', protect, async (req, res) => {
    const orders = await Order.find({ buyer: req.user._id })
        .populate('items.seller', 'name college')
        .sort({ createdAt: -1 });
    res.json({ count: orders.length, orders });
});

// GET /api/orders/selling — orders that include items I'm selling
router.get('/selling', protect, async (req, res) => {
    const orders = await Order.find({ 'items.seller': req.user._id })
        .populate('buyer', 'name college')
        .sort({ createdAt: -1 });
    res.json({ count: orders.length, orders: orders.map(safeSellingOrder) });
});

module.exports = router;
