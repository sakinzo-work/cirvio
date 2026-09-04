const mongoose = require('mongoose');

const replySchema = new mongoose.Schema(
    {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        senderRole: { type: String, enum: ['buyer', 'seller', 'admin', 'employee'], required: true },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        readByUserAt: { type: Date },
        readByAdminAt: { type: Date }
    },
    { timestamps: true }
);

const messageSchema = new mongoose.Schema(
    {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        recipientRole: { type: String, enum: ['admin'], default: 'admin' },
        productTitle: { type: String, default: '' },
        productImg: { type: String, default: '' },
        status: { type: String, enum: ['open', 'closed'], default: 'open' },
        readByAdminAt: { type: Date },
        replies: { type: [replySchema], default: [] }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);
