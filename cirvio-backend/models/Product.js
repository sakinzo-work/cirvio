const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        category: { type: String, required: true }, // books / notes / calculators / stationery ...
        condition: { type: String, required: true }, // new / like-new / good / fair
        type: { type: String, enum: ['sell', 'donate'], default: 'sell' },
        price: { type: Number, default: 0, min: 0 },
        originalPrice: { type: Number, default: 0, min: 0 },
        description: { type: String, default: '' },
        location: { type: String, required: true },
        college: { type: String, default: '' },
        images: [{ type: String }], // uploaded file URLs

        seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'sold'],
            default: 'pending'
        },
        rejectReason: { type: String, default: '' },
        decidedAt: { type: Date },

        views: { type: Number, default: 0 }
    },
    { timestamps: true }
);

productSchema.index({ title: 'text', description: 'text', category: 'text' });

module.exports = mongoose.model('Product', productSchema);
