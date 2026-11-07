const express = require('express');
const multer = require('multer');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');
const { taxonomy, normalizeClassification, describeClassification } = require('../services/listing-categories');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 4 },
    fileFilter: (req, file, cb) => {
        if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
            return cb(new Error('Only JPG, PNG or WEBP images are allowed'));
        }
        cb(null, true);
    }
});

function normalizeListingType(type) {
    return ['sell', 'donate', 'free'].includes(type) ? type : 'sell';
}

function listingStatusOnCreate() {
    return process.env.AUTO_APPROVE_LISTINGS === 'true' ? 'approved' : 'pending';
}

function normalizeImages(images = []) {
    if (!Array.isArray(images)) return [];
    return images
        .map((image) => String(image || '').trim())
        .filter((image) => /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image) || /^https?:\/\//i.test(image))
        .slice(0, 4);
}

function publicProduct(product) {
    const obj = product.toObject ? product.toObject() : product;
    const seller = obj.seller && typeof obj.seller === 'object'
        ? {
            _id: obj.seller._id,
            name: obj.seller.name,
            college: obj.seller.college,
            verified: obj.seller.verified,
            createdAt: obj.seller.createdAt,
            trustRatingCount: (obj.seller.trustRatings || []).length,
            trustRatingAverage: obj.seller.trustRatings?.length
                ? obj.seller.trustRatings.reduce((total, rating) => total + Number(rating.value || 0), 0) / obj.seller.trustRatings.length
                : 0
        }
        : obj.seller;
    const { location, selectedBuyer, selectedOrder, buyerSelectedAt, ...safeProduct } = obj;
    return { ...safeProduct, classificationSummary: describeClassification(obj.classification), location: '', seller };
}

router.get('/categories', (req, res) => res.json(taxonomy));

// GET /api/products  — logged-in browse grid (only approved items)
router.get('/', async (req, res) => {
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
            .populate('seller', 'name college verified createdAt trustRatings.value')
            .slice('images', 1)
            .sort({ createdAt: -1, _id: -1 })
            .lean();
        res.json({ count: products.length, products: products.map(publicProduct) });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch products', error: err.message });
    }
});

// GET /api/products/mine — listings posted by logged-in user (any status)
router.get('/mine', protect, async (req, res, next) => {
    try {
        const products = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
        res.json({ count: products.length, products });
    } catch (error) { next(error); }
});

// POST /api/products/uploads — upload listing photos before creating a product
router.post('/uploads', protect, (req, res) => {
    upload.array('images', 4)(req, res, (err) => {
        if (err) {
            return res.status(400).json({ message: err.message || 'Image upload failed' });
        }
        const files = req.files || [];
        if (!files.length) {
            return res.status(400).json({ message: 'Please select at least one image' });
        }
        const images = files.map((file) => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
        res.status(201).json({ images });
    });
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
    try {
        const product = await Product.findOne({
            _id: req.params.id,
            status: { $in: ['approved', 'sold'] }
        }).populate('seller', 'name college verified createdAt trustRatings.value');
        if (!product) return res.status(404).json({ message: 'Product not found' });
        product.views += 1;
        await product.save();
        res.json({ product: publicProduct(product) });
    } catch (err) {
        res.status(404).json({ message: 'Product not found' });
    }
});

// POST /api/products — create a new listing (goes to "pending" for admin review)
router.post('/', protect, async (req, res) => {
    try {
        const { title, category, condition, type, price, originalPrice, description, location, college, images } = req.body;
        const listingImages = normalizeImages(images);
        if (!title || !category || !condition || !location) {
            return res.status(400).json({ message: 'title, category, condition and location are required' });
        }
        if (!listingImages.length) {
            return res.status(400).json({ message: 'Please add at least one listing image' });
        }
        let classification;
        try { classification = normalizeClassification(category, req.body.classification); }
        catch (err) { return res.status(400).json({ message: err.message }); }
        const listingType = normalizeListingType(type);
        const listingPrice = listingType === 'sell' ? Number(price) || 0 : 0;
        if (listingType === 'sell' && listingPrice <= 0) {
            return res.status(400).json({ message: 'Price must be greater than 0 for sale listings' });
        }
        const product = await Product.create({
            title: String(title).trim(),
            category,
            classification,
            condition,
            type: listingType,
            price: listingPrice,
            originalPrice: Number(originalPrice) || 0,
            description: String(description || '').trim(),
            location: String(location).trim(),
            college: String(college || '').trim(),
            images: listingImages,
            seller: req.user._id,
            status: listingStatusOnCreate()
        });
        await product.populate('seller', 'name college verified');
        res.status(201).json({ product });
    } catch (err) {
        res.status(500).json({ message: 'Failed to create listing', error: err.message });
    }
});

// PUT /api/products/:id — seller can edit their own pending/rejected listing
router.put('/:id', protect, async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: 'Product not found' });
        if (String(product.seller) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not your listing' });
        }
        if (product.status === 'sold') return res.status(409).json({ message: 'A selected listing cannot be edited while its order is active' });
        if (req.body.classification !== undefined || (req.body.category !== undefined && req.body.category !== product.category)) {
            try { product.classification = normalizeClassification(req.body.category || product.category, req.body.classification); }
            catch (err) { return res.status(400).json({ message: err.message }); }
        }
        const editable = ['title', 'category', 'condition', 'price', 'originalPrice', 'description', 'location', 'college', 'images'];
        const changes = {};
        editable.forEach((f) => {
            if (req.body[f] !== undefined) changes[f] = f === 'images' ? normalizeImages(req.body[f]) : req.body[f];
        });
        if (req.body.classification !== undefined || changes.category !== undefined) changes.classification = product.classification;
        // The same atomic guard used by checkout prevents editing a listing after a buyer claims it.
        const updated = await Product.findOneAndUpdate({ _id: product._id, seller: req.user._id, status: { $ne: 'sold' } },
            { $set: { ...changes, status: 'pending', rejectReason: '' }, $inc: { reviewRevision: 1 }, $unset: { reviewViewedAt: 1, reviewViewedBy: 1, decidedAt: 1 } }, { new: true, runValidators: true });
        if (!updated) return res.status(409).json({ message: 'This listing changed during editing. Refresh before trying again.' });
        res.json({ product: updated });
    } catch (error) { next(error); }
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
