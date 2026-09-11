const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const authMiddleware = require('../middlewares/authMiddleware');

// All WhatsApp routes require authentication (so we know WHICH user's session to use)
router.use(authMiddleware);

// Status & QR endpoints
router.get('/status', whatsappController.getStatus);
router.get('/qr', whatsappController.getQr);
router.get('/call-logs', whatsappController.getCallLogs);
router.get('/qr-inspect', whatsappController.inspectQrPage);
router.get('/qr-page', whatsappController.getQrPage);  // HTML page (token in query string)
router.get('/debug-chats', whatsappController.debugChats);
router.get('/debug-msgs', whatsappController.debugMsgs);
router.get('/sync-chat-messages', whatsappController.syncChatMessages);
router.post('/restart', whatsappController.restartSession);
router.post('/sync', whatsappController.syncChats);

module.exports = router;
