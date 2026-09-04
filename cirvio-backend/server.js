const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');

const app = express();

connectDB();

app.set('trust proxy', 1);

app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);

// serve the admin panel (static HTML/CSS/JS) at /admin
app.use('/admin', express.static(path.join(__dirname, 'admin-panel')));

app.get('/', (req, res) => res.send('CIRVIO API is running ✅'));
app.get('/api/health', (req, res) => res.json({ ok: true, message: 'CIRVIO API is running' }));

app.use((req, res) => res.status(404).json({ message: 'Route not found' }));
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => console.log(`🚀 CIRVIO server running on port ${PORT}`));

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. CIRVIO backend may already be running.`);
        console.error(`Open http://127.0.0.1:${PORT}/api/health to check it, or stop the existing node process before starting again.`);
        process.exit(1);
    }
    throw err;
});
