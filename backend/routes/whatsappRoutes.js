const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// Status & QR endpoints
router.get('/status', whatsappController.getStatus);
router.get('/qr', whatsappController.getQr);
router.get('/qr-inspect', whatsappController.inspectQrPage);
router.get('/qr-page', whatsappController.getQrPage);
router.get('/debug-chats', whatsappController.debugChats);
router.get('/debug-msgs', whatsappController.debugMsgs);
router.get('/sync-chat-messages', whatsappController.syncChatMessages);
router.post('/restart', whatsappController.restartSession);
router.post('/sync', whatsappController.syncChats);

module.exports = router;
