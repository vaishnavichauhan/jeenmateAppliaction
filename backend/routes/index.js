const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const conversationRoutes = require('./conversationRoutes');
const taskRoutes = require('./taskRoutes');
const whatsappRoutes = require('./whatsappRoutes');
const internalChatRoutes = require('./internalChatRoutes');

router.use('/auth', authRoutes);
router.use('/conversations', conversationRoutes);
router.use('/tasks', taskRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/internal-chat', internalChatRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'jeenMate-backend',
    time: new Date().toISOString()
  });
});

module.exports = router;
