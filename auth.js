const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const seller = await require('../models/Seller').findById(decoded._id);
        if (!seller || seller.status !== 'Active') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.seller = { _id: seller._id, isAdmin: seller.isAdmin }; // Include isAdmin
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};