const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const authMiddleware = require('../middlewares/authMiddleware');

// All WhatsApp routes require authentication
router.use(authMiddleware);

// --- Multi-Account Management Routes ---
router.get('/accounts', whatsappController.getAccounts);
router.post('/accounts', whatsappController.createAccount);
router.get('/accounts/:id', whatsappController.getAccountDetails);
router.delete('/accounts/:id', whatsappController.deleteAccount);
router.post('/accounts/:id/disconnect', whatsappController.disconnectAccount);
router.get('/accounts/:id/members', whatsappController.getAccountMembers);
router.post('/accounts/:id/members', whatsappController.updateAccountMembers);

// --- Scoped WhatsApp Account Session Routes ---
router.get('/accounts/:id/status', whatsappController.getAccountStatus);
router.get('/accounts/:id/qr', whatsappController.getAccountQr);
router.post('/accounts/:id/restart', whatsappController.restartAccountSession);
router.post('/accounts/:id/sync', whatsappController.syncAccountChats);
router.get('/accounts/:id/call-logs', whatsappController.getAccountCallLogs);

// --- Backward-Compatibility Legacy Routes ---
router.get('/status', whatsappController.getStatus);
router.get('/qr', whatsappController.getQr);
router.get('/call-logs', whatsappController.getCallLogs);
router.post('/restart', whatsappController.restartSession);
router.post('/sync', whatsappController.syncChats);

module.exports = router;
