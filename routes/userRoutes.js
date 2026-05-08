const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Register/Create User
router.post('/register', async (req, res) => {
    try {
        const { name, email, phoneNumber } = req.body;

        // Validation
        if (!name || !email || !phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required: name, email, phoneNumber'
            });
        }

        // Check if user exists
        let user = await User.findOne({ email });

        if (user) {
            // Update existing user
            user.name = name;
            user.phoneNumber = phoneNumber;
            user.isActive = true;
            await user.save();
        } else {
            // Create new user
            user = new User({
                name,
                email,
                phoneNumber
            });
            await user.save();
        }

        res.status(200).json({
            success: true,
            message: 'User registered successfully',
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Error registering user',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get User by ID
router.get('/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching user'
        });
    }
});

// Update user socket ID
router.patch('/:id/socket', async (req, res) => {
    try {
        const { socketId } = req.body;
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { socketId },
            { new: true }
        );

        res.status(200).json({
            success: true,
            user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error updating socket ID'
        });
    }
});

module.exports = router;