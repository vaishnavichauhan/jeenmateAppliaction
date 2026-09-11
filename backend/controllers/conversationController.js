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
    const { limit = 100 } = req.query;

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
    const [custRows] = await pool.execute('SELECT id, whatsapp_jid FROM customers WHERE id = ?', [conversation.customer_id]);
    const userSession = sessionManager.getSession(req.user?.id);
    if (custRows.length > 0 && custRows[0].whatsapp_jid && userSession && userSession.client && userSession.client.pupPage) {
      const jid = custRows[0].whatsapp_jid;
      try {
        const liveMsgs = await userSession.fetchMessagesForChat(jid, 40);
        if (liveMsgs.length > 0) {
          for (const m of liveMsgs) {
            const iso = new Date(m.timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ');
            const dir = m.fromMe ? 'outgoing' : 'incoming';
            const safeMsgId = m.id ? String(m.id).slice(0, 191) : `wa_${m.timestamp}_${dir}`;
            const safeBody = m.body || '';

            const [exist] = await pool.execute(
              `SELECT id, whatsapp_message_id FROM messages 
               WHERE conversation_id = ? AND (whatsapp_message_id = ? OR (direction = ? AND message = ?)) 
               LIMIT 1`,
              [id, safeMsgId, dir, safeBody]
            );
            if (exist.length > 0) {
              if (!exist[0].whatsapp_message_id && safeMsgId) {
                await pool.execute('UPDATE messages SET whatsapp_message_id = ? WHERE id = ?', [safeMsgId, exist[0].id]);
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

    const messages = await Message.findByConversationId(id, limit);

    return res.status(200).json({
      success: true,
      conversation,
      data: messages
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
