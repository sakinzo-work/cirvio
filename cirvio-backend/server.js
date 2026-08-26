require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const AppSetting = require('./models/AppSetting');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');

const app = express();
function splitOrigins(value = '') {
    return String(value)
        .split(',')
        .map(origin => origin.trim().replace(/\/$/, ''))
        .filter(Boolean);
}

const envAllowedOrigins = splitOrigins(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '*');
let cachedAdminOrigins = [];
let cachedAdminOriginsAt = 0;

async function getAdminOrigins() {
    if (Date.now() - cachedAdminOriginsAt < 1000) return cachedAdminOrigins;
    const setting = await AppSetting.findOne({ key: 'allowedOrigins' }).lean().catch(() => null);
    cachedAdminOrigins = Array.isArray(setting?.value?.origins) ? setting.value.origins : [];
    cachedAdminOriginsAt = Date.now();
    return cachedAdminOrigins;
}

function isLocalDevOrigin(origin) {
    try {
        const { hostname } = new URL(origin);
        return ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname);
    } catch (e) {
        return false;
    }
}

connectDB();

app.use(cors({
    async origin(origin, callback) {
        try {
            if (!origin) return callback(null, true);
            const cleanOrigin = origin.replace(/\/$/, '');
            const adminOrigins = await getAdminOrigins();
            const allowedOrigins = [...envAllowedOrigins, ...adminOrigins];
            if (allowedOrigins.includes('*') || allowedOrigins.includes(cleanOrigin) || isLocalDevOrigin(cleanOrigin)) {
                return callback(null, true);
            }
            return callback(new Error(`Origin ${cleanOrigin} is not allowed by CORS`));
        } catch (err) {
            return callback(err);
        }
    }
}));
app.use(express.json({ limit: '5mb' }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
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
app.listen(PORT, () => console.log(`🚀 CIRVIO server running on port ${PORT}`));
