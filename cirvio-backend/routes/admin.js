const express = require('express');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AppSetting = require('../models/AppSetting');
const Message = require('../models/Message');
const { protect, adminOnly, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(protect, staffOnly); // every route below is CIRVIO staff-only
const requireAdmin = [adminOnly];

function splitOrigins(value = '') {
    return String(value)
        .split(',')
        .map(origin => origin.trim().replace(/\/$/, ''))
        .filter(Boolean);
}

function normalizeOrigins(origins) {
    return [...new Set((Array.isArray(origins) ? origins : splitOrigins(origins)).map(origin => String(origin).trim().replace(/\/$/, '')).filter(Boolean))];
}

// GET /api/admin/client-origins — frontend URLs allowed by CORS
router.get('/client-origins', async (req, res) => {
    const envOrigins = splitOrigins(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '*');
    const setting = await AppSetting.findOne({ key: 'allowedOrigins' }).lean();
    const origins = Array.isArray(setting?.value?.origins) ? setting.value.origins : [];
    res.json({ envOrigins, origins });
});

// PUT /api/admin/client-origins   body: { origins: ["https://..."] }
router.put('/client-origins', requireAdmin, async (req, res) => {
    const origins = normalizeOrigins(req.body.origins);
    const invalid = origins.find(origin => {
        try {
            const url = new URL(origin);
            return !['http:', 'https:'].includes(url.protocol);
        } catch (e) {
            return true;
        }
    });
    if (invalid) return res.status(400).json({ message: `Invalid URL: ${invalid}` });

    const setting = await AppSetting.findOneAndUpdate(
        { key: 'allowedOrigins' },
        { value: { origins } },
        { new: true, upsert: true }
    );
    res.json({ origins: setting.value.origins });
});

// POST /api/admin/employees — admin creates a CIRVIO employee login
router.post('/employees', requireAdmin, async (req, res) => {
    const { name, email, password, phone, city } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (String(password).length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'Email already exists' });

    const employee = await User.create({
        name,
        email,
        password,
        phone,
        city,
        role: 'employee',
        verified: true
    });
    res.status(201).json({
        employee: {
            id: employee._id,
            name: employee.name,
            email: employee.email,
            role: employee.role,
            status: employee.status
        }
    });
});

// PUT /api/admin/employees/:id/password — admin resets employee password
router.put('/employees/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.body;
    if (!password || String(password).length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const employee = await User.findOne({ _id: req.params.id, role: 'employee' }).select('+password');
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    employee.password = password;
    await employee.save();
    res.json({ message: 'Employee password updated' });
});

// GET /api/admin/stats — top dashboard cards
router.get('/stats', async (req, res) => {
    const [totalUsers, totalProducts, pendingProducts, approvedProducts, soldProducts, totalOrders, revenueAgg] =
        await Promise.all([
            User.countDocuments(),
            Product.countDocuments(),
            Product.countDocuments({ status: 'pending' }),
            Product.countDocuments({ status: 'approved' }),
            Product.countDocuments({ status: 'sold' }),
            Order.countDocuments(),
            Order.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }])
        ]);

    res.json({
        totalUsers,
        totalProducts,
        pendingProducts,
        approvedProducts,
        soldProducts,
        totalOrders,
        totalRevenue: revenueAgg[0] ? revenueAgg[0].total : 0
    });
});

// GET /api/admin/users — every user + how many listings & orders they have
router.get('/users', async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    const [listingCounts, orderCounts] = await Promise.all([
        Product.aggregate([{ $group: { _id: '$seller', count: { $sum: 1 } } }]),
        Order.aggregate([{ $group: { _id: '$buyer', count: { $sum: 1 } } }])
    ]);
    const listingMap = Object.fromEntries(listingCounts.map((l) => [String(l._id), l.count]));
    const orderMap = Object.fromEntries(orderCounts.map((o) => [String(o._id), o.count]));

    const result = users.map((u) => ({
        ...u,
        listingsCount: listingMap[String(u._id)] || 0,
        ordersCount: orderMap[String(u._id)] || 0
    }));
    res.json({ count: result.length, users: result });
});

// PUT /api/admin/users/:id/status — suspend or reactivate a user
router.put('/users/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body; // 'active' | 'suspended'
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', requireAdmin, async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted' });
});

// GET /api/admin/products — every listing, seller populated, optional ?status=pending
router.get('/products', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const products = await Product.find(filter)
        .populate('seller', 'name email college city')
        .sort({ createdAt: -1 });
    res.json({ count: products.length, products });
});

// PUT /api/admin/products/:id/review-viewed — mark photos/details as seen by staff
router.put('/products/:id/review-viewed', async (req, res) => {
    const product = await Product.findByIdAndUpdate(
        req.params.id,
        { reviewViewedAt: new Date(), reviewViewedBy: req.user._id },
        { new: true }
    ).populate('seller', 'name email college city');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ product });
});

// PUT /api/admin/products/:id/approve
router.put('/products/:id/approve', async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (!product.reviewViewedAt) {
        return res.status(400).json({ message: 'View listing images/details before approving this product' });
    }
    product.status = 'approved';
    product.decidedAt = new Date();
    product.rejectReason = '';
    await product.save();
    res.json({ product });
});

// PUT /api/admin/products/:id/reject   body: { reason }
router.put('/products/:id/reject', async (req, res) => {
    const { reason } = req.body;
    const product = await Product.findByIdAndUpdate(
        req.params.id,
        { status: 'rejected', decidedAt: new Date(), rejectReason: reason || 'Does not meet CIRVIO guidelines' },
        { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ product });
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', requireAdmin, async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
});

// GET /api/admin/orders — full orders, buyer + item.seller + item.product populated
router.get('/orders', async (req, res) => {
    const orders = await Order.find()
        .populate('buyer', 'name email college city phone')
        .populate('items.seller', 'name email college city phone')
        .populate('items.product', 'title category images')
        .sort({ createdAt: -1 });
    res.json({ count: orders.length, orders });
});

// GET /api/admin/purchases — flattened rows: buyer + product + seller paired,
// exactly what the dashboard "who bought what from whom" table needs.
router.get('/purchases', async (req, res) => {
    const orders = await Order.find()
        .populate('buyer', 'name email college city phone')
        .populate('items.seller', 'name email college city phone')
        .populate('items.product', 'title category images status')
        .sort({ createdAt: -1 })
        .lean();

    const rows = [];
    orders.forEach((order) => {
        order.items.forEach((item) => {
            rows.push({
                orderId: order._id,
                orderStatus: order.status,
                date: order.createdAt,
                buyer: order.buyer,
                seller: item.seller,
                product: item.product,
                title: item.title,
                price: item.price,
                qty: item.qty
            });
        });
    });
    res.json({ count: rows.length, purchases: rows });
});

// GET /api/admin/messages — product-related messages sent to CIRVIO admins.
router.get('/messages', async (req, res) => {
    const messages = await Message.find({ recipientRole: 'admin' })
        .populate('sender', 'name email college city phone')
        .populate({
            path: 'product',
            select: 'title category location images seller',
            populate: { path: 'seller', select: 'name email college city phone' }
        })
        .sort({ createdAt: -1 })
        .lean();

    res.json({ count: messages.length, messages });
});

// PUT /api/admin/orders/:id/status   body: { status }
router.put('/orders/:id/status', async (req, res) => {
    const { status } = req.body;
    const allowed = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json({ order });
});

module.exports = router;
