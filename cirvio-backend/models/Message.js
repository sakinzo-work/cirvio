const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
    {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        recipientRole: { type: String, enum: ['admin'], default: 'admin' },
        productTitle: { type: String, default: '' },
        productImg: { type: String, default: '' },
        status: { type: String, enum: ['open', 'closed'], default: 'open' },
        readByAdminAt: { type: Date }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);
