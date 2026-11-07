const Message = require('../models/Message');

// Both sides use the same unique key, including simultaneous opens on different devices.
async function openDirectConversation({ userId, actor, product }) {
    const conversationKey = product ? `listing:${product._id}:${userId}` : `direct:${userId}`;
    let message = await Message.findOne({ conversationKey });
    if (message) return { message, created: false };
    try {
        message = await Message.create({
            conversationKey, conversationType: 'direct', sender: userId,
            createdBy: actor._id, senderRole: ['admin', 'employee'].includes(actor.role) ? actor.role : 'buyer', text: '',
            ...(product ? { product: product._id, productTitle: product.title, productImg: product.images?.[0] || '' } : {})
        });
        return { message, created: true };
    } catch (error) {
        if (error.code !== 11000) throw error;
        message = await Message.findOne({ conversationKey });
        if (!message) throw error;
        return { message, created: false };
    }
}

module.exports = { openDirectConversation };
