const jwt = require('jsonwebtoken');
const User = require('../models/User');

/* Verifies JWT from Authorization: Bearer <token> and attaches req.user */
async function protect(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.split(' ')[1] : null;
        if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return res.status(401).json({ message: 'User no longer exists' });
        if (user.status === 'suspended') return res.status(403).json({ message: 'Account suspended' });

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Not authorized, token invalid' });
    }
}

/* Restrict to admin role — use after protect() */
function adminOnly(req, res, next) {
    if (req.user && req.user.role === 'admin') return next();
    return res.status(403).json({ message: 'Admin access only' });
}

function staffOnly(req, res, next) {
    if (req.user && ['admin', 'employee'].includes(req.user.role)) return next();
    return res.status(403).json({ message: 'CIRVIO staff access only' });
}

module.exports = { protect, adminOnly, staffOnly };
