const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpointHash: { type: String, required: true, unique: true },
    endpoint: { type: String, required: true, maxlength: 2048 },
    keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
    app: { type: String, enum: ['site', 'admin'], required: true }
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', schema);
