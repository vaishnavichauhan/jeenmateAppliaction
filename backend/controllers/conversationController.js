const pool = require('../config/db');
const { Conversation, Message } = require('../models');
const sessionManager = require('../services/sessionManager');
const socketService = require('../services/socketService');

// GET /api/conversations
async function getConversations(req, res, next) {
  try {
    const { search } = req.query;
    const userId = req.user ? req.user.id : null;
    const conversations = await Conversation.findAll({ search, userId });

    return res.status(200).json({
      success: true,
      count: conversations.length,
      data: conversations
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/conversations/:id/messages
async function getMessages(req, res, next) {
  try {
    const { id } = req.params;
    const { limit = 30, before, mode } = req.query;

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Reset unread count
    await Conversation.resetUnread(id);

    // Sync latest messages for this conversation from WhatsApp Web if available
    const [custRows] = await pool.execute('SELECT id, whatsapp_jid, phone_number FROM customers WHERE id = ?', [conversation.customer_id]);
    const targetJid = custRows[0]?.whatsapp_jid || (custRows[0]?.phone_number ? `${custRows[0].phone_number.replace(/[^0-9]/g, '')}@c.us` : null);
    const userSession = sessionManager.getSession(req.user?.id);
    if (custRows.length > 0 && targetJid && userSession && userSession.client && userSession.client.pupPage) {
      try {
        const fetchLimit = before ? 100 : 60;
        const customerPhone = custRows[0].phone_number || null;
        const liveMsgs = await userSession.fetchMessagesForChat(targetJid, fetchLimit, customerPhone);
        if (liveMsgs.length > 0) {
          for (const m of liveMsgs) {
            const iso = new Date(m.timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ');
            const dir = m.fromMe ? 'outgoing' : 'incoming';
            const safeMsgId = m.id ? String(m.id).slice(0, 191) : `wa_${m.timestamp}_${dir}`;
            const safeBody = m.body || '';

            const [exist] = await pool.execute(
              `SELECT id, whatsapp_message_id, message FROM messages 
               WHERE conversation_id = ? AND (
                 (whatsapp_message_id IS NOT NULL AND whatsapp_message_id = ?) OR 
                 (direction = ? AND ABS(TIMESTAMPDIFF(SECOND, created_at, ?)) <= 15)
               ) 
               LIMIT 1`,
              [id, safeMsgId, dir, iso]
            );
            if (exist.length > 0) {
              const existingMsg = exist[0];
              if (!existingMsg.whatsapp_message_id && safeMsgId) {
                await pool.execute('UPDATE messages SET whatsapp_message_id = ? WHERE id = ?', [safeMsgId, existingMsg.id]);
              }
              if (safeBody && safeBody !== existingMsg.message && !(existingMsg.message === 'Video' && safeBody === 'Images')) {
                await pool.execute('UPDATE messages SET message = ? WHERE id = ?', [safeBody, existingMsg.id]);
              }
            } else {
              await pool.execute(
                `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, conversation.customer_id, dir, safeBody, safeMsgId, m.type || 'text', m.status || 'delivered', iso]
              );
            }
          }
        }
      } catch (liveErr) {
        console.warn('[Conversation] Live messages sync warning:', liveErr.message);
      }
    }

    const result = await Message.findByConversationId(id, { limit, before, mode });

    // If WhatsApp Web is connected, more historical messages can always be fetched from WhatsApp
    const hasLiveSession = !!(userSession && userSession.client && userSession.client.pupPage);
    const finalHasMore = result.hasMore || hasLiveSession;

    return res.status(200).json({
      success: true,
      conversation,
      data: result.messages,
      hasMore: finalHasMore,
      oldestTimestamp: result.oldestTimestamp
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/:id/messages
async function sendMessage(req, res, next) {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message text cannot be empty'
      });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // 1. Save staff reply to database first
    const savedMessage = await Message.create({
      conversationId: id,
      customerId: conversation.customer_id,
      sender: 'staff',
      text: text.trim(),
      status: 'sent'
    });

    const updatedConversation = await Conversation.findById(id);

    // 2. Emit live Socket.IO events to connected clients
    socketService.broadcastNewMessage(id, savedMessage);
    socketService.broadcastConversationUpdate(updatedConversation);

    // 3. Send ONCE via WhatsApp Web client if connected for this user
    const userSession = sessionManager.getSession(req.user?.id);
    if (userSession && userSession.isConnected) {
      userSession.sendMessage(conversation.phone_number, text.trim())
        .then((waResult) => {
          if (waResult && waResult.success && waResult.messageId) {
            pool.execute('UPDATE messages SET whatsapp_message_id = ? WHERE id = ?', [waResult.messageId, savedMessage.id]);
          }
        })
        .catch((err) => {
          console.error('[WhatsApp Send Error]', err.message);
        });
    }

    return res.status(201).json({
      success: true,
      data: savedMessage
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/conversations/:id/read
async function markAsRead(req, res, next) {
  try {
    const { id } = req.params;
    const conversation = await Conversation.resetUnread(id);

    if (conversation) {
      socketService.broadcastConversationUpdate(conversation);
    }

    return res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead
};
