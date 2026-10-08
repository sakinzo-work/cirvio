const express = require('express');
const jwt = require('jsonwebtoken');
const https = require('https');
const User = require('../models/User');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');

const router = express.Router();
const phoneOtps = new Map();
let firebaseCertCache = { expiresAt: 0, certs: null };

function signToken(id) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
    }
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
}

function sendUser(user) {
    const ratings = Array.isArray(user.trustRatings) ? user.trustRatings : [];
    const ratingTotal = ratings.reduce((sum, rating) => sum + Number(rating.value || 0), 0);
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        college: user.college,
        course: user.course,
        city: user.city,
        phone: user.phone,
        photo: user.photo,
        authProvider: user.authProvider,
        passwordSet: user.passwordSet !== false,
        role: user.role,
        verified: user.verified,
        trustRatingAverage: ratings.length ? ratingTotal / ratings.length : 0,
        trustRatingCount: ratings.length,
        createdAt: user.createdAt
    };
}

function sendPublicUser(user, viewerId = '') {
    const safe = sendUser(user);
    const ratings = Array.isArray(user.trustRatings) ? user.trustRatings : [];
    const ownRating = ratings.find((rating) => String(rating.user) === String(viewerId));
    return {
        id: safe.id,
        name: safe.name,
        college: safe.college,
        course: safe.course,
        city: safe.city,
        photo: safe.photo,
        verified: safe.verified,
        trustRatingAverage: safe.trustRatingAverage,
        trustRatingCount: safe.trustRatingCount,
        myTrustRating: ownRating ? ownRating.value : 0,
        createdAt: safe.createdAt
    };
}

function issueSession(user, res, status = 200, extra = {}) {
    const token = signToken(user._id);
    return res.status(status).json({ token, user: sendUser(user), ...extra });
}

function allowedGoogleAudiences() {
    return String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function firebaseProjectId() {
    return process.env.FIREBASE_PROJECT_ID || 'cirvio';
}

function normalizePhone(phone = '') {
    return String(phone).replace(/[^\d+]/g, '');
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (googleRes) => {
            let body = '';
            googleRes.on('data', chunk => { body += chunk; });
            googleRes.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (googleRes.statusCode < 200 || googleRes.statusCode >= 300) {
                        return reject(new Error(data.error_description || data.error || 'Token verification failed'));
                    }
                    resolve(data);
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

async function getFirebaseCerts() {
    if (firebaseCertCache.certs && firebaseCertCache.expiresAt > Date.now()) return firebaseCertCache.certs;
    const certs = await getJson('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    firebaseCertCache = { certs, expiresAt: Date.now() + 55 * 60 * 1000 };
    return certs;
}

async function verifyFirebaseToken(idToken) {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded?.header?.kid) throw new Error('Invalid Firebase token');
    const certs = await getFirebaseCerts();
    const cert = certs[decoded.header.kid];
    if (!cert) throw new Error('Firebase certificate not found');
    const projectId = firebaseProjectId();
    const payload = jwt.verify(idToken, cert, {
        algorithms: ['RS256'],
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`
    });
    if (!payload.email) throw new Error('Firebase account has no email');
    return {
        email: payload.email,
        email_verified: payload.email_verified !== false,
        name: payload.name || payload.email.split('@')[0],
        picture: payload.picture || '',
        sub: payload.user_id || payload.sub
    };
}

async function verifyGoogleToken(idToken) {
    const decoded = jwt.decode(idToken);
    if (decoded?.iss === `https://securetoken.google.com/${firebaseProjectId()}`) {
        return verifyFirebaseToken(idToken);
    }

    const payload = await getJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    const audiences = allowedGoogleAudiences();
    if (audiences.length && !audiences.includes(payload.aud)) {
        throw new Error('Google client ID mismatch');
    }
    if (!payload.email_verified) throw new Error('Google email is not verified');
    return payload;
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
        user.passwordSet = true;
        user.authProvider = 'password';
        await user.save();
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
        const { idToken } = req.body;
        if (!idToken) return res.status(400).json({ message: 'Google ID token is required' });

        const googleUser = await verifyGoogleToken(idToken);
        const email = googleUser.email.toLowerCase();
        let user = await User.findOne({ email });
        let isNewGoogleUser = false;
        if (!user) {
            isNewGoogleUser = true;
            user = await User.create({
                name: googleUser.name || email.split('@')[0],
                email,
                password: `google:${googleUser.sub}:${process.env.JWT_SECRET}`,
                photo: googleUser.picture || '',
                authProvider: 'google',
                passwordSet: false,
                verified: true
            });
        } else {
            let changed = false;
            if (!user.verified && googleUser.email_verified) {
                user.verified = true;
                changed = true;
            }
            if (!user.photo && googleUser.picture) {
                user.photo = googleUser.picture;
                changed = true;
            }
            if (!user.authProvider) {
                user.authProvider = 'password';
                changed = true;
            }
            if (user.passwordSet === undefined) {
                user.passwordSet = true;
                changed = true;
            }
            if (changed) await user.save();
        }
        if (user.status === 'suspended') return res.status(403).json({ message: 'Account suspended' });
        return issueSession(user, res, 200, {
            isNewUser: isNewGoogleUser,
            needsPasswordSetup: user.passwordSet === false
        });
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
                authProvider: 'phone',
                passwordSet: false,
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

// GET /api/auth/users/:id - public student profile
router.get('/users/:id', protect, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user || user.status !== 'active') return res.status(404).json({ message: 'User not found' });
        res.json({ user: sendPublicUser(user, req.user._id) });
    } catch (err) {
        res.status(404).json({ message: 'User not found' });
    }
});

// POST /api/auth/users/:id/rating - rate a public profile once per logged-in user
router.post('/users/:id/rating', protect, async (req, res) => {
    try {
        const value = Number(req.body.value);
        if (!Number.isInteger(value) || value < 1 || value > 5) {
            return res.status(400).json({ message: 'Rating must be between 1 and 5' });
        }
        const user = await User.findById(req.params.id);
        if (!user || user.status !== 'active') return res.status(404).json({ message: 'User not found' });
        if (String(user._id) === String(req.user._id)) {
            return res.status(400).json({ message: 'You cannot rate your own profile' });
        }
        const existing = (user.trustRatings || []).find((rating) => String(rating.user) === String(req.user._id));
        if (existing) {
            existing.value = value;
            existing.updatedAt = new Date();
        } else {
            user.trustRatings.push({ user: req.user._id, value });
        }
        await user.save();
        res.json({ user: sendPublicUser(user, req.user._id) });
    } catch (err) {
        res.status(500).json({ message: 'Could not save rating', error: err.message });
    }
});

// PUT /api/auth/me — update own profile fields, including profile photo.
router.put('/me', protect, async (req, res) => {
    try {
        const editable = ['name', 'college', 'course', 'city', 'phone', 'photo'];
        const updates = {};
        editable.forEach((field) => {
            if (req.body[field] !== undefined) updates[field] = String(req.body[field] || '').trim();
        });
        if (updates.photo && updates.photo.length > 1500000) {
            return res.status(400).json({ message: 'Profile photo is too large' });
        }
        const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
        res.json({ user: sendUser(user) });
    } catch (err) {
        res.status(500).json({ message: 'Profile update failed', error: err.message });
    }
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

// PUT /api/auth/password/setup - Google/phone users can add their first password
router.put('/password/setup', protect, async (req, res) => {
    try {
        const newPassword = String(req.body.newPassword || '');
        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        const user = await User.findById(req.user._id).select('+password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.passwordSet !== false) {
            return res.status(400).json({ message: 'Password is already set. Use change password instead.' });
        }

        user.password = newPassword;
        user.passwordSet = true;
        if (!user.authProvider || user.authProvider === 'phone') user.authProvider = 'password';
        await user.save();
        return res.json({ message: 'Password set successfully', user: sendUser(user) });
    } catch (err) {
        return res.status(500).json({ message: 'Password setup failed', error: err.message });
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
