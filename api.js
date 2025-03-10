const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const sanitizeHtml = require('sanitize-html');
const sgMail = require('@sendgrid/mail');
const Seller = require('../models/Seller');
const Property = require('../models/Property');
const Payment = require('../models/Payment');
const { model3dQueue } = require('../index');
const { states, citiesByState } = require('../utils/locations');
require('dotenv').config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const EC2_PROCESSOR_URL = process.env.EC2_PROCESSOR_URL;

async function processTo3D(job) {
    const { propertyId, fileUrls, isVideo, retryCount } = job.data;
    try {
        const response = await axios.post(EC2_PROCESSOR_URL, {
            propertyId,
            fileUrls,
            isVideo,
        }, { timeout: 300000 }); // 5 min timeout
        const modelUrl = response.data.modelUrl;
        const property = await Property.findById(propertyId);
        property.model3d = modelUrl;
        property.model3dStatus = 'completed';
        await property.save();
    } catch (error) {
        console.error('3D processing error:', error.message);
        const property = await Property.findById(propertyId);
        if (retryCount < 2) {
            property.model3dRetryCount = retryCount + 1;
            await property.save();
            await model3dQueue.add({ propertyId, fileUrls, isVideo, retryCount: retryCount + 1 }, { delay: 60000 });
        } else {
            property.model3dStatus = 'failed';
            await property.save();
        }
    }
}

model3dQueue.process(processTo3D);

// Seller registration
router.post('/register', async (req, res) => {
    const { email, phone, password } = req.body;
    try {
        let seller = await Seller.findOne({ email });
        if (seller) return res.status(400).json({ error: 'Seller already exists' });

        seller = new Seller({
            email: sanitizeHtml(email),
            phone: sanitizeHtml(phone),
            password: await bcrypt.hash(password, await bcrypt.genSalt(10)),
            confirmationCode: Math.random().toString(36).substring(7),
        });
        await seller.save();

        const msg = {
            to: email,
            from: 'no-reply@yourdomain.com', // Update with your verified sender
            subject: 'Verify Your Account',
            text: `Your confirmation code is: ${seller.confirmationCode}`,
        };
        await sgMail.send(msg);

        res.status(201).json({ message: 'Seller registered. Check email for code.' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Resend confirmation code
router.post('/resend-code', async (req, res) => {
    const { email } = req.body;
    try {
        const seller = await Seller.findOne({ email });
        if (!seller || seller.status === 'Active') {
            return res.status(400).json({ error: 'No pending seller found' });
        }
        const msg = {
            to: email,
            from: 'no-reply@yourdomain.com',
            subject: 'Verify Your Account',
            text: `Your new confirmation code is: ${seller.confirmationCode}`,
        };
        await sgMail.send(msg);
        res.json({ message: 'Code resent. Check email.' });
    } catch (error) {
        console.error('Resend code error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify seller
router.post('/verify', async (req, res) => {
    const { email, code } = req.body;
    try {
        const seller = await Seller.findOne({ email });
        if (!seller || seller.confirmationCode !== code) {
            return res.status(400).json({ error: 'Invalid code' });
        }
        seller.status = 'Active';
        await seller.save();
        const token = jwt.sign({ _id: seller._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const seller = await Seller.findOne({ email });
        if (!seller || seller.status !== 'Active' || !(await bcrypt.compare(password, seller.password))) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ _id: seller._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create property listing
router.post('/properties', auth, async (req, res) => {
    try {
        const { propertyType, title, description, price, state, city, location, bypass3d, pictures, model3dInput, model3dVideo } = req.body;
        if (!states.includes(state) || !citiesByState[state].includes(city)) {
            return res.status(400).json({ error: 'Invalid state or city' });
        }

        const sanitizedData = {
            propertyType: sanitizeHtml(propertyType),
            title: sanitizeHtml(title),
            description: sanitizeHtml(description),
            price: Number(price),
            state: sanitizeHtml(state),
            city: sanitizeHtml(city),
            location: sanitizeHtml(location),
            seller: req.seller._id,
        };
        if (isNaN(sanitizedData.price)) throw new Error('Price must be a number');

        const property = new Property(sanitizedData);
        if (pictures) property.pictures = JSON.parse(pictures);

        if (bypass3d === 'true') {
            property.model3dStatus = 'bypassed';
        } else if (model3dInput) {
            property.model3dStatus = 'pending';
            await model3dQueue.add({
                propertyId: property._id,
                fileUrls: JSON.parse(model3dInput),
                isVideo: false,
                retryCount: 0,
            });
        } else if (model3dVideo) {
            property.model3dStatus = 'pending';
            await model3dQueue.add({
                propertyId: property._id,
                fileUrls: [model3dVideo],
                isVideo: true,
                retryCount: 0,
            });
        } else if (!bypass3d) {
            return res.status(400).json({ error: 'For 3D model, provide photos or video URLs' });
        }

        await property.save();
        res.status(201).json(property);
    } catch (error) {
        console.error('Property creation error:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
});

// Retry 3D processing
router.post('/properties/:id/retry-3d', auth, async (req, res) => {
    try {
        const { model3dInput, model3dVideo } = req.body;
        const property = await Property.findOne({ _id: req.params.id, seller: req.seller._id });
        if (!property || property.model3dStatus !== 'failed') {
            return res.status(400).json({ error: 'Cannot retry: Property not found or not failed' });
        }

        if (model3dInput) {
            property.model3dStatus = 'pending';
            property.model3dRetryCount = 0;
            await property.save();
            await model3dQueue.add({
                propertyId: property._id,
                fileUrls: JSON.parse(model3dInput),
                isVideo: false,
                retryCount: 0,
            });
        } else if (model3dVideo) {
            property.model3dStatus = 'pending';
            property.model3dRetryCount = 0;
            await property.save();
            await model3dQueue.add({
                propertyId: property._id,
                fileUrls: [model3dVideo],
                isVideo: true,
                retryCount: 0,
            });
        } else {
            return res.status(400).json({ error: 'Provide photos or video URLs to retry' });
        }

        res.json({ message: '3D processing retry queued' });
    } catch (error) {
        console.error('Retry 3D error:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
});

// Get all properties with pagination
router.get('/properties', async (req, res) => {
    try {
        const { search, type, minPrice, maxPrice, state, city, limitFeatured, page = 1, limit = 10 } = req.query;
        const query = {};
        if (search) query.$text = { $search: search };
        if (type) query.propertyType = type;
        if (minPrice) query.price = { $gte: Number(minPrice) };
        if (maxPrice) query.price = { ...query.price, $lte: Number(maxPrice) };
        if (state) query.state = state;
        if (city) query.city = city;

        let propertiesQuery = Property.find(query);
        if (limitFeatured) {
            propertiesQuery = propertiesQuery.sort({ promotionExpiry: -1 }).limit(Number(limitFeatured));
        } else {
            propertiesQuery = propertiesQuery.sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit));
        }

        const properties = await propertiesQuery;
        const total = await Property.countDocuments(query);
        res.json({ properties, total, page: Number(page), pages: Math.ceil(total / limit) });
    } catch (error) {
        console.error('Properties fetch error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get seller properties
router.get('/seller/properties', auth, async (req, res) => {
    try {
        const properties = await Property.find({ seller: req.seller._id }).sort({ createdAt: -1 });
        res.json(properties);
    } catch (error) {
        console.error('Seller properties error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Promote listings
router.post('/promote', auth, async (req, res) => {
    const { propertyIds, email } = req.body;
    try {
        const properties = await Property.find({ _id: { $in: propertyIds }, seller: req.seller._id });
        if (properties.length !== propertyIds.length) {
            return res.status(400).json({ error: 'Invalid property IDs' });
        }

        const amount = properties.length * 50000; // 500 NGN per listing
        const payment = new Payment({
            seller: req.seller._id,
            amount,
            propertyIds,
            status: 'pending',
            txRef: `tx-${Date.now()}`,
        });
        await payment.save();

        res.json({ txRef: payment.txRef, amount, email });
    } catch (error) {
        console.error('Promote error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Flutterwave webhook
router.post('/webhook/flutterwave', async (req, res) => {
    const hash = req.headers['verif-hash'];
    if (hash !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
        return res.status(401).end();
    }

    const { status, tx_ref: txRef, transaction_id: transactionId } = req.body;
    if (status === 'successful') {
        try {
            const payment = await Payment.findOne({ txRef });
            if (!payment || payment.status !== 'pending') {
                return res.status(200).end();
            }

            const response = await axios.get(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
                headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}` },
            });
            if (response.data.status === 'success' && response.data.data.amount >= payment.amount) {
                payment.status = 'completed';
                await payment.save();

                const properties = await Property.find({ _id: { $in: payment.propertyIds } });
                for (const property of properties) {
                    property.promotionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                    await property.save();
                }
            }
        } catch (error) {
            console.error('Webhook error:', error);
        }
    }
    res.status(200).end();
});

// Buyer filter endpoints
router.get('/states', async (req, res) => {
    try {
        const states = await Property.distinct('state');
        res.json(states.filter(Boolean).sort());
    } catch (error) {
        console.error('States fetch error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/cities', async (req, res) => {
    const { state } = req.query;
    try {
        const query = state ? { state } : {};
        const cities = await Property.distinct('city', query);
        res.json(cities.filter(Boolean).sort());
    } catch (error) {
        console.error('Cities fetch error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete a property listing
router.delete('/properties/:id', auth, async (req, res) => {
    try {
        const property = await Property.findOne({ _id: req.params.id, seller: req.seller._id });
        if (!property) {
            return res.status(404).json({ error: 'Property not found or you don’t own it' });
        }
        await Property.deleteOne({ _id: req.params.id });
        res.json({ message: 'Property deleted successfully' });
    } catch (error) {
        console.error('Delete property error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin delete any property listing
router.delete('/admin/properties/:id', auth, async (req, res) => {
    try {
        if (!req.seller.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const property = await Property.findById(req.params.id);
        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }
        await Property.deleteOne({ _id: req.params.id });
        res.json({ message: 'Property deleted by admin' });
    } catch (error) {
        console.error('Admin delete property error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;