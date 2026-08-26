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
        deliveryAddress: { type: String, default: '' }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
