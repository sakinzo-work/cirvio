const express = require('express');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');

const router = express.Router();

function populateThread(query) {
    return query
        .populate('sender', 'name college')
        .populate('replies.sender', 'name')
        .populate('product', 'title category images seller')
        .sort({ updatedAt: -1 });
}

async function canAccessThread(message, user) {
    if (!message || !user) return false;
    if (String(message.sender) === String(user._id)) return true;
    if (['admin', 'employee'].includes(user.role)) return true;
    const product = await Product.findById(message.product).select('seller').lean();
    return product && String(product.seller) === String(user._id);
}

// POST /api/messages — users can only message CIRVIO admin about a product.
router.post('/', protect, async (req, res) => {
    try {
        const { productId, text } = req.body;
        const cleanText = String(text || '').trim();
        if (!productId) return res.status(400).json({ message: 'Product is required' });
        if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ message: 'Valid product is required' });
        if (!cleanText) return res.status(400).json({ message: 'Message is required' });

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ message: 'Product not found' });

        let message = await Message.create({
            sender: req.user._id,
            product: product._id,
            text: cleanText,
            recipientRole: 'admin',
            productTitle: product.title,
            productImg: product.images && product.images[0] ? product.images[0] : ''
        });
        message = await populateThread(Message.findById(message._id));

        res.status(201).json({ message });
    } catch (err) {
        res.status(500).json({ message: 'Failed to send message', error: err.message });
    }
});

// GET /api/messages/my — group threads where this user is buyer or seller.
router.get('/my', protect, async (req, res) => {
    const sellingProducts = await Product.find({ seller: req.user._id }).select('_id').lean();
    const productIds = sellingProducts.map((p) => p._id);
    const messages = await populateThread(Message.find({
        $or: [
            { sender: req.user._id },
            { product: { $in: productIds } }
        ]
    })).lean();
    res.json({ count: messages.length, messages });
});

// POST /api/messages/:id/replies — buyer/seller can reply in their product group thread.
router.post('/:id/replies', protect, async (req, res) => {
    try {
        const cleanText = String(req.body.text || '').trim();
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Valid message is required' });
        if (!cleanText) return res.status(400).json({ message: 'Reply is required' });

        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Message not found' });
        if (!(await canAccessThread(message, req.user))) {
            return res.status(403).json({ message: 'Not allowed in this chat' });
        }
        const product = await Product.findById(message.product).select('seller').lean();
        const senderRole = product && String(product.seller) === String(req.user._id) ? 'seller' : 'buyer';

        message.replies.push({
            sender: req.user._id,
            senderRole,
            text: cleanText
        });
        await message.save();
        const updated = await populateThread(Message.findById(message._id));
        res.status(201).json({ message: updated });
    } catch (err) {
        res.status(500).json({ message: 'Failed to send reply', error: err.message });
    }
});

module.exports = router;
