const assert = require('node:assert/strict');
const express = require('../cirvio-backend/node_modules/express');
const jwt = require('../cirvio-backend/node_modules/jsonwebtoken');
const User = require('../cirvio-backend/models/User');

process.env.JWT_SECRET = 'isolated-admin-session-secret';
const user = { _id: '000000000000000000000001', role: 'admin', status: 'active', name: 'Staff', email: 'staff@example.test', trustRatings: [] };
const originalFindById = User.findById;
User.findById = async id => String(id) === user._id ? user : null;
const app = express();
app.use(express.json());
app.use('/api/auth', require('../cirvio-backend/routes/auth'));
app.use((error, request, response, next) => response.status(500).json({ message: error.message }));

(async () => {
    const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
    try {
        const oldToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '10m' });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/refresh`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + oldToken }
        });
        const result = await response.json();
        assert.equal(response.status, 200);
        assert.equal(result.user.role, 'admin');
        const decoded = jwt.decode(result.token);
        assert.ok(decoded.exp - decoded.iat >= 29 * 24 * 60 * 60, 'Staff refresh returns the long-lived operations token');
        console.log('PASS Admin session refresh rotates a valid staff token for the 30-day fallback');
    } finally {
        User.findById = originalFindById;
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
