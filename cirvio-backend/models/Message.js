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
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: function () { return this.conversationType !== 'direct'; } },
        conversationType: { type: String, enum: ['product', 'direct'], default: 'product' },
        conversationKey: { type: String },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        senderRole: { type: String, enum: ['buyer', 'seller', 'admin', 'employee'], default: 'buyer' },
        text: { type: String, default: '', required: function () { return this.conversationType !== 'direct'; }, trim: true, maxlength: 2000 },
        recipientRole: { type: String, enum: ['admin'], default: 'admin' },
        productTitle: { type: String, default: '' },
        productImg: { type: String, default: '' },
        status: { type: String, enum: ['open', 'closed'], default: 'open' },
        readByAdminAt: { type: Date },
        replies: { type: [replySchema], default: [] }
    },
    { timestamps: true }
);

// One staff conversation per user/context, including simultaneous opens from different devices.
messageSchema.index({ conversationKey: 1 }, { unique: true, partialFilterExpression: { conversationKey: { $type: 'string' } } });

messageSchema.pre('validate', function normalizeLegacyReplyRoles(next) {
    if (Array.isArray(this.replies)) {
        this.replies.forEach((reply) => {
            if (reply.senderRole === 'user') reply.senderRole = 'buyer';
        });
    }
    next();
});

module.exports = mongoose.model('Message', messageSchema);
