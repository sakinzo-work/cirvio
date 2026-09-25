const mongoose = require('mongoose');

/* One order can hold items from multiple sellers (like a cart checkout).
   Each item snapshots product + seller + price so admin can always see
   "kis user ne kiska product khareeda" even if the product is edited later. */
const orderItemSchema = new mongoose.Schema(
    {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        title: { type: String, required: true },
        price: { type: Number, required: true },
        qty: { type: Number, default: 1, min: 1 },
        img: { type: String, default: '' }
    },
    { _id: false }
);

const orderSchema = new mongoose.Schema(
    {
        buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        items: { type: [orderItemSchema], required: true },
        totalAmount: { type: Number, required: true },
        status: {
            type: String,
            enum: ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'],
            default: 'placed'
        },
        paymentStatus: {
            type: String,
            enum: ['pending', 'collected', 'failed', 'refunded'],
            default: 'pending'
        },
        paymentMode: {
            type: String,
            enum: ['manual', 'cash', 'upi', 'bank-transfer', 'other'],
            default: 'manual'
        },
        paymentReference: { type: String, default: '', trim: true },
        dispatchStatus: {
            type: String,
            enum: ['not-dispatched', 'packed', 'picked-up', 'in-transit', 'delivered', 'returned'],
            default: 'not-dispatched'
        },
        dispatchMode: {
            type: String,
            enum: ['pending', 'cirvio-runner', 'seller-drop', 'buyer-pickup', 'courier', 'other'],
            default: 'pending'
        },
        trackingId: { type: String, default: '', trim: true },
        dispatchPartner: { type: String, default: '', trim: true },
        dispatchDate: { type: Date },
        deliveredAt: { type: Date },
        adminNotes: { type: String, default: '', trim: true, maxlength: 3000 },
        lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        deliveryAddress: { type: String, default: '', trim: true }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
