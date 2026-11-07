const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventKey: { type: String, required: true, unique: true },
    type: { type: String, enum: ['listing'], default: 'listing' },
    status: { type: String, enum: ['viewed', 'approved', 'rejected', 'buyer-selected'], required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    title: { type: String, required: true, maxlength: 100 },
    text: { type: String, required: true, maxlength: 500 },
    readAt: { type: Date, default: null }
}, { timestamps: true });

schema.index({ recipient: 1, createdAt: -1, _id: -1 });
schema.index({ recipient: 1, readAt: 1 });
module.exports = mongoose.model('Notification', schema);
