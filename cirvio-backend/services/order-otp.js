const crypto = require('crypto');

const OTP_LENGTH = 6;
const OTP_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function secretKey() {
    // ORDER_OTP_SECRET should be set in production. JWT_SECRET keeps existing deployments working safely.
    return crypto.createHash('sha256').update(String(process.env.ORDER_OTP_SECRET || process.env.JWT_SECRET || 'cirvio-local-order-otp-development-key')).digest();
}

function createOtp() {
    const code = String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        code,
        hash: crypto.createHmac('sha256', secretKey()).update(code).digest('hex'),
        cipher: [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.'),
        expiresAt: new Date(Date.now() + OTP_TTL_MS)
    };
}

function readOtp(ciphertext) {
    try {
        const [ivText, tagText, encryptedText] = String(ciphertext || '').split('.');
        if (!ivText || !tagText || !encryptedText) return '';
        const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivText, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        return '';
    }
}

function matchesOtp(code, hash) {
    const received = crypto.createHmac('sha256', secretKey()).update(String(code || '')).digest();
    const expected = Buffer.from(String(hash || ''), 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

module.exports = { createOtp, readOtp, matchesOtp, MAX_ATTEMPTS };
