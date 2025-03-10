const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
    propertyType: String,
    title: String,
    description: String,
    price: Number,
    state: String,
    city: String,
    location: String,
    pictures: [String],
    model3d: String,
    model3dStatus: { type: String, enum: ['pending', 'completed', 'failed', 'bypassed'], default: 'bypassed' },
    model3dRetryCount: { type: Number, default: 0 },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
    promotionExpiry: Date,
    createdAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

propertySchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Property', propertySchema);