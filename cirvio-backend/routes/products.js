const express = require('express');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/products  — logged-in browse grid (only approved items)
router.get('/', protect, async (req, res) => {
    try {
        const { q, category, type, minPrice, maxPrice, city } = req.query;
        const filter = { status: 'approved' };
        if (q) filter.$text = { $search: q };
        if (category) filter.category = category;
        if (type) filter.type = type;
        if (city) filter.location = new RegExp(city, 'i');
        if (minPrice || maxPrice) {
            filter.price = {};
            if (minPrice) filter.price.$gte = Number(minPrice);
            if (maxPrice) filter.price.$lte = Number(maxPrice);
        }
        const products = await Product.find(filter)
            .populate('seller', 'name college city verified')
            .sort({ createdAt: -1 });
        res.json({ count: products.length, products });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch products', error: err.message });
    }
});

// GET /api/products/mine — listings posted by logged-in user (any status)
router.get('/mine', protect, async (req, res) => {
    const products = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
    res.json({ count: products.length, products });
});

// GET /api/products/:id
router.get('/:id', protect, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id).populate('seller', 'name college city phone verified');
        if (!product) return res.status(404).json({ message: 'Product not found' });
        product.views += 1;
        await product.save();
        res.json({ product });
    } catch (err) {
        res.status(404).json({ message: 'Product not found' });
    }
});

// POST /api/products — create a new listing (goes to "pending" for admin review)
router.post('/', protect, async (req, res) => {
    try {
        const { title, category, condition, type, price, originalPrice, description, location, college, images } = req.body;
        if (!title || !category || !condition || !location) {
            return res.status(400).json({ message: 'title, category, condition and location are required' });
        }
        const product = await Product.create({
            title,
            category,
            condition,
            type: type === 'donate' ? 'donate' : 'sell',
            price: type === 'donate' ? 0 : Number(price) || 0,
            originalPrice: Number(originalPrice) || 0,
            description,
            location,
            college,
            images: Array.isArray(images) ? images : [],
            seller: req.user._id,
            status: 'pending'
        });
        res.status(201).json({ product });
    } catch (err) {
        res.status(500).json({ message: 'Failed to create listing', error: err.message });
    }
});

// PUT /api/products/:id — seller can edit their own pending/rejected listing
router.put('/:id', protect, async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (String(product.seller) !== String(req.user._id)) {
        return res.status(403).json({ message: 'Not your listing' });
    }
    const editable = ['title', 'category', 'condition', 'price', 'originalPrice', 'description', 'location', 'college', 'images'];
    editable.forEach((f) => {
        if (req.body[f] !== undefined) product[f] = req.body[f];
    });
    // any edit sends it back for re-review
    product.status = 'pending';
    product.rejectReason = '';
    await product.save();
    res.json({ product });
});

// DELETE /api/products/:id — seller removes own listing
router.delete('/:id', protect, async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (String(product.seller) !== String(req.user._id) && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Not your listing' });
    }
    await product.deleteOne();
    res.json({ message: 'Listing deleted' });
});

module.exports = router;
