const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const conversationController = require('../controllers/conversationController');
const authMiddleware = require('../middlewares/authMiddleware');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    const safeName = `media_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 64 * 1024 * 1024 } // 64MB limit
});

// Note: For convenience in mobile dev & internal support staff, authMiddleware is applied
router.get('/', authMiddleware, conversationController.getConversations);
router.get('/:id/messages', authMiddleware, conversationController.getMessages);
router.post('/:id/messages', authMiddleware, upload.single('file'), conversationController.sendMessage);
router.patch('/:id/read', authMiddleware, conversationController.markAsRead);

module.exports = router;
