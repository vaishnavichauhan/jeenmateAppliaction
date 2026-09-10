const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversationController');
const authMiddleware = require('../middlewares/authMiddleware');

// Note: For convenience in mobile dev & internal support staff, authMiddleware is applied
router.get('/', authMiddleware, conversationController.getConversations);
router.get('/:id/messages', authMiddleware, conversationController.getMessages);
router.post('/:id/messages', authMiddleware, conversationController.sendMessage);
router.patch('/:id/read', authMiddleware, conversationController.markAsRead);

module.exports = router;
