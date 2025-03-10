const mongoose = require('mongoose');

const sellerSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Active'], default: 'Pending' },
    confirmationCode: String,
	isAdmin: { type: Boolean, default: false }
});

module.exports = mongoose.model('Seller', sellerSchema);