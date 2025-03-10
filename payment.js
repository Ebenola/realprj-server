const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
    amount: Number,
    propertyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }],
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    txRef: String,
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Payment', paymentSchema);