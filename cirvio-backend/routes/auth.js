const express = require('express');
const jwt = require('jsonwebtoken');
const https = require('https');
const User = require('../models/User');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');

const router = express.Router();
const phoneOtps = new Map();

function signToken(id) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
    }
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
}

function sendUser(user) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        college: user.college,
        course: user.course,
        city: user.city,
        phone: user.phone,
        role: user.role,
        verified: user.verified,
        createdAt: user.createdAt
    };
}

function issueSession(user, res, status = 200) {
    const token = signToken(user._id);
    return res.status(status).json({ token, user: sendUser(user) });
}

function normalizePhone(phone = '') {
    return String(phone).replace(/[^\d+]/g, '');
}

function verifyGoogleToken(idToken) {
    return new Promise((resolve, reject) => {
        const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
        https.get(url, (googleRes) => {
            let body = '';
            googleRes.on('data', chunk => { body += chunk; });
            googleRes.on('end', () => {
                try {
                    const payload = JSON.parse(body);
                    if (googleRes.statusCode !== 200) return reject(new Error(payload.error_description || 'Invalid Google token'));
                    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) return reject(new Error('Google client ID mismatch'));
                    if (!payload.email_verified) return reject(new Error('Google email is not verified'));
                    resolve(payload);
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        const { college, course, city, phone } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Name, email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }
        const exists = await User.findOne({ email });
        if (exists) return res.status(409).json({ message: 'Email already registered' });

        const user = await User.create({ name, email, password, college, course, city, phone });
        return issueSession(user, res, 201);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'Email already registered' });
        }
        res.status(500).json({ message: 'Registration failed', error: err.message });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

        const user = await User.findOne({ email }).select('+password');
        if (!user || !(await user.matchPassword(password))) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        if (user.status === 'suspended') return res.status(403).json({ message: 'Account suspended' });

        return issueSession(user, res);
    } catch (err) {
        res.status(500).json({ message: 'Login failed', error: err.message });
    }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
    try {
        if (!process.env.GOOGLE_CLIENT_ID) {
            return res.status(503).json({ message: 'Google login is not configured' });
        }
        const { idToken } = req.body;
        if (!idToken) return res.status(400).json({ message: 'Google ID token is required' });

        const googleUser = await verifyGoogleToken(idToken);
        const email = googleUser.email.toLowerCase();
        let user = await User.findOne({ email });
        if (!user) {
            user = await User.create({
                name: googleUser.name || email.split('@')[0],
                email,
                password: `google:${googleUser.sub}:${process.env.JWT_SECRET}`,
                verified: true
            });
        }
        if (user.status === 'suspended') return res.status(403).json({ message: 'Account suspended' });
        return issueSession(user, res);
    } catch (err) {
        res.status(401).json({ message: 'Google login failed', error: err.message });
    }
});

// POST /api/auth/phone/start
router.post('/phone/start', async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone || phone.length < 10) return res.status(400).json({ message: 'Valid phone number required' });
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
        return res.status(503).json({ message: 'Phone OTP is not configured. Add Twilio credentials first.' });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    phoneOtps.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

    // Keep dependency-free: use Twilio REST API directly.
    const payload = new URLSearchParams({
        To: phone,
        From: process.env.TWILIO_FROM_NUMBER,
        Body: `Your CIRVIO login code is ${otp}. It expires in 5 minutes.`
    }).toString();
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const options = {
        method: 'POST',
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const twilioReq = https.request(options, twilioRes => {
        let body = '';
        twilioRes.on('data', chunk => { body += chunk; });
        twilioRes.on('end', () => {
            if (twilioRes.statusCode >= 200 && twilioRes.statusCode < 300) {
                return res.json({ message: 'OTP sent', phone });
            }
            phoneOtps.delete(phone);
            return res.status(502).json({ message: 'Could not send OTP', error: body });
        });
    });
    twilioReq.on('error', err => {
        phoneOtps.delete(phone);
        res.status(502).json({ message: 'Could not send OTP', error: err.message });
    });
    twilioReq.write(payload);
    twilioReq.end();
});

// POST /api/auth/phone/verify
router.post('/phone/verify', async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);
        const otp = String(req.body.otp || '').trim();
        const record = phoneOtps.get(phone);
        if (!record || record.expiresAt < Date.now() || record.otp !== otp) {
            return res.status(401).json({ message: 'Invalid or expired OTP' });
        }
        phoneOtps.delete(phone);

        const digits = phone.replace(/\D/g, '');
        const email = `${digits}@phone.cirvio.local`;
        let user = await User.findOne({ email });
        if (!user) {
            user = await User.create({
                name: req.body.name || `Student ${digits.slice(-4)}`,
                email,
                password: `phone:${digits}:${process.env.JWT_SECRET}`,
                phone,
                verified: true
            });
        }
        if (user.status === 'suspended') return res.status(403).json({ message: 'Account suspended' });
        return issueSession(user, res);
    } catch (err) {
        res.status(500).json({ message: 'Phone login failed', error: err.message });
    }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
    res.json({ user: sendUser(req.user) });
});

// PUT /api/auth/password
router.put('/password', protect, async (req, res) => {
    try {
        const currentPassword = String(req.body.currentPassword || '');
        const newPassword = String(req.body.newPassword || '');
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters' });
        }
        if (currentPassword === newPassword) {
            return res.status(400).json({ message: 'New password must be different from current password' });
        }

        const user = await User.findById(req.user._id).select('+password');
        if (!user || !(await user.matchPassword(currentPassword))) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }

        user.password = newPassword;
        await user.save();
        return res.json({ message: 'Password updated successfully' });
    } catch (err) {
        return res.status(500).json({ message: 'Password update failed', error: err.message });
    }
});

// DELETE /api/auth/me
router.delete('/me', protect, async (req, res) => {
    try {
        const password = String(req.body.password || '');
        if (!password) {
            return res.status(400).json({ message: 'Password is required to delete your account' });
        }

        const user = await User.findById(req.user._id).select('+password');
        if (!user || !(await user.matchPassword(password))) {
            return res.status(401).json({ message: 'Password is incorrect' });
        }

        await Product.deleteMany({ seller: user._id });
        await user.deleteOne();
        return res.json({ message: 'Account deleted successfully' });
    } catch (err) {
        return res.status(500).json({ message: 'Account deletion failed', error: err.message });
    }
});

module.exports = router;
