const express = require('express');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');

const router = express.Router();

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

        const message = await Message.create({
            sender: req.user._id,
            product: product._id,
            text: cleanText,
            recipientRole: 'admin',
            productTitle: product.title,
            productImg: product.images && product.images[0] ? product.images[0] : ''
        });

        res.status(201).json({ message });
    } catch (err) {
        res.status(500).json({ message: 'Failed to send message', error: err.message });
    }
});

module.exports = router;
