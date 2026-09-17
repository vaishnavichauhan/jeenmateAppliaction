const express = require('express');
const router = express.Router();
const internalChatController = require('../controllers/internalChatController');
const authMiddleware = require('../middlewares/authMiddleware');
const { uploadInternalChatImages } = require('../middlewares/uploadMiddleware');

// All internal chat endpoints require authentication
router.use(authMiddleware);

router.get('/users', internalChatController.getColleagues);
router.get('/messages/:targetUserId', internalChatController.getMessages);
router.post('/messages', uploadInternalChatImages.array('images', 5), internalChatController.sendMessage);
router.post('/mark-read', internalChatController.markRead);

module.exports = router;
