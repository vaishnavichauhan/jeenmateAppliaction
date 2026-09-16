const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

router.post('/login', authController.login);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.getMe);

// Get all staff members for task assignment
router.get('/users', authController.getAllUsers);

// Admin-only: create a new user
router.post('/users', authMiddleware, adminMiddleware, authController.createUser);

module.exports = router;
