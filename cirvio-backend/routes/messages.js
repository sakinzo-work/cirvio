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

// GET /api/messages/my — threads started by this user, including admin replies.
router.get('/my', protect, async (req, res) => {
    const messages = await populateThread(Message.find({ sender: req.user._id })).lean();
    res.json({ count: messages.length, messages });
});

// POST /api/messages/:id/replies — original sender can add follow-up replies to admin.
router.post('/:id/replies', protect, async (req, res) => {
    try {
        const cleanText = String(req.body.text || '').trim();
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Valid message is required' });
        if (!cleanText) return res.status(400).json({ message: 'Reply is required' });

        const message = await Message.findOne({ _id: req.params.id, sender: req.user._id });
        if (!message) return res.status(404).json({ message: 'Message not found' });

        message.replies.push({
            sender: req.user._id,
            senderRole: 'user',
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
