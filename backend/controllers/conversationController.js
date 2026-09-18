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

    const userId = req.user ? req.user.id : null;
    const conversation = await Conversation.findById(id, userId);
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
    const userSession = sessionManager.getSession(userId);
    if (custRows.length > 0 && targetJid && userSession && userSession.client && userSession.client.pupPage) {
      try {
        const fetchLimit = before ? 100 : 60;
        const customerPhone = custRows[0].phone_number || null;
        const liveMsgs = await userSession.fetchMessagesForChat(targetJid, fetchLimit, customerPhone);
        
        let insertedCount = 0;
        let updatedCount = 0;
        let duplicateCount = 0;

        if (liveMsgs.length > 0) {
          for (const m of liveMsgs) {
            const waMs = m.timestamp > 1e11 ? m.timestamp : (m.timestamp * 1000 || Date.now());
            const iso = new Date(waMs).toISOString().slice(0, 19).replace('T', ' ');
            const dir = m.fromMe ? 'outgoing' : 'incoming';
            const safeMsgId = m.id ? String(m.id).slice(0, 191) : `wa_${m.timestamp}_${dir}`;
            const safeBody = m.body || '';
            const isCall = m.type === 'call' || !!(m.metadata && m.metadata.isCall);

            if (isCall) {
              const callMetadata = m.metadata || {
                isCall: true,
                status: 'unknown',
                callType: dir,
                mediaType: 'voice',
                duration: null,
                whatsappCallId: safeMsgId
              };
              const metadataJson = JSON.stringify(callMetadata);
              const waCallId = callMetadata.whatsappCallId || safeMsgId;
              const coreCallId = (waCallId && waCallId.includes('_')) ? waCallId.split('_').pop() : waCallId;

              // Match existing call message by stable call ID
              let existingMsg = null;
              if (waCallId) {
                const [existByCallId] = await pool.execute(
                  `SELECT id, whatsapp_message_id, message, message_type, metadata FROM messages 
                   WHERE conversation_id = ? AND user_id = ? AND (
                     whatsapp_message_id = ? OR 
                     JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) = ? OR
                     (LENGTH(?) >= 8 AND (whatsapp_message_id LIKE CONCAT('%', ?, '%') OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) LIKE CONCAT('%', ?, '%')))
                   ) 
                   LIMIT 1`,
                  [id, userId, waCallId, waCallId, coreCallId || '', coreCallId || '', coreCallId || '']
                );
                if (existByCallId.length > 0) {
                  existingMsg = existByCallId[0];
                }
              }

              // Fallback ONLY if no ID matched: exact scoped match by (user, conversation, direction, exact whatsapp_timestamp)
              if (!existingMsg && waMs && waMs > 0) {
                const [existByExactEpoch] = await pool.execute(
                  `SELECT id, whatsapp_message_id, message, message_type, metadata FROM messages 
                   WHERE conversation_id = ? AND user_id = ? AND direction = ? AND message_type = 'call' AND whatsapp_timestamp = ?
                   LIMIT 1`,
                  [id, userId, dir, waMs]
                );
                if (existByExactEpoch.length > 0) {
                  existingMsg = existByExactEpoch[0];
                }
              }

              if (existingMsg) {
                await pool.execute(
                  `UPDATE messages 
                   SET message = ?, message_type = 'call', whatsapp_message_id = ?, whatsapp_timestamp = ?, status = ?, metadata = ?
                   WHERE id = ?`,
                  [safeBody, safeMsgId, waMs, m.status || 'delivered', metadataJson, existingMsg.id]
                );
                updatedCount++;
              } else {
                await pool.execute(
                  `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
                   VALUES (?, ?, ?, ?, ?, 'call', ?, ?, ?, ?, ?)`,
                  [id, conversation.customer_id, dir, safeBody, safeMsgId, waMs, m.status || 'delivered', iso, userId, metadataJson]
                );
                insertedCount++;
              }

              // Also record in whatsapp_calls table for the Calls tab
              try {
                const dbCallType = callMetadata.status === 'missed' ? 'missed' : (callMetadata.callType || 'incoming');
                const durationVal = callMetadata.duration ? `${callMetadata.duration}s` : (m.duration ? `${m.duration}s` : null);
                await pool.execute(
                  `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, user_id, created_at, raw_call)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE 
                     customer_name = VALUES(customer_name),
                     call_type = VALUES(call_type),
                     media_type = VALUES(media_type),
                     duration = COALESCE(VALUES(duration), duration),
                     raw_call = VALUES(raw_call)`,
                  [
                    waCallId,
                    customerPhone || targetJid.split('@')[0],
                    conversation.customer_name || 'Customer',
                    dbCallType,
                    callMetadata.mediaType || 'voice',
                    durationVal,
                    userId,
                    iso,
                    JSON.stringify(m.rawCall || callMetadata)
                  ]
                );
                await pool.execute(
                  `UPDATE whatsapp_calls 
                   SET call_type = ?, media_type = ?, duration = COALESCE(?, duration)
                   WHERE user_id = ? AND (
                     call_id = ? OR 
                     (LENGTH(?) >= 8 AND call_id LIKE CONCAT('%', ?, '%'))
                   )`,
                  [dbCallType, callMetadata.mediaType || 'voice', durationVal, userId, waCallId, coreCallId || '', coreCallId || '']
                );
              } catch (_) {}

            } else {
              // Normal message sync logic - match strictly by user_id + conversation_id + whatsapp_message_id
              let exist = [];
              const coreMsgId = (safeMsgId && safeMsgId.includes('_')) ? safeMsgId.split('_').pop() : safeMsgId;

              if (safeMsgId) {
                [exist] = await pool.execute(
                  `SELECT id, whatsapp_message_id, message FROM messages 
                   WHERE user_id = ? AND conversation_id = ? AND (
                     whatsapp_message_id = ? OR 
                     whatsapp_message_id = ? OR 
                     (LENGTH(?) >= 8 AND whatsapp_message_id LIKE CONCAT('%', ?, '%'))
                   )
                   LIMIT 1`,
                  [userId, id, safeMsgId, coreMsgId || '', coreMsgId || '', coreMsgId || '']
                );
              }

              // If not matched by ID, check for pending outgoing staff message with matching text sent within 10 mins
              if (exist.length === 0 && dir === 'outgoing' && safeBody) {
                const tenMinsAgoMs = waMs - (10 * 60 * 1000);
                const tenMinsAfterMs = waMs + (10 * 60 * 1000);
                [exist] = await pool.execute(
                  `SELECT id, whatsapp_message_id, message FROM messages 
                   WHERE user_id = ? AND conversation_id = ? AND direction = 'outgoing' AND message = ?
                     AND (
                       (whatsapp_timestamp IS NOT NULL AND whatsapp_timestamp BETWEEN ? AND ?)
                       OR (whatsapp_message_id IS NULL AND created_at >= (NOW() - INTERVAL 10 MINUTE))
                     )
                   ORDER BY id DESC LIMIT 1`,
                  [userId, id, safeBody, tenMinsAgoMs, tenMinsAfterMs]
                );
              }

              // Fallback for incoming messages: match by exact timestamp and body
              if (exist.length === 0 && dir === 'incoming' && waMs && waMs > 0 && safeBody) {
                [exist] = await pool.execute(
                  `SELECT id, whatsapp_message_id, message FROM messages 
                   WHERE user_id = ? AND conversation_id = ? AND direction = 'incoming' AND whatsapp_timestamp = ? AND message = ?
                   LIMIT 1`,
                  [userId, id, waMs, safeBody]
                );
              }

              if (exist.length > 0) {
                const existingMsg = exist[0];
                let changed = false;
                if (!existingMsg.whatsapp_message_id && safeMsgId) {
                  await pool.execute('UPDATE messages SET whatsapp_message_id = ?, whatsapp_timestamp = ? WHERE id = ?', [safeMsgId, waMs, existingMsg.id]);
                  changed = true;
                }
                if (safeBody && safeBody !== existingMsg.message && !(existingMsg.message === 'Video' && safeBody === 'Images')) {
                  await pool.execute('UPDATE messages SET message = ? WHERE id = ?', [safeBody, existingMsg.id]);
                  changed = true;
                }
                if (changed) {
                  updatedCount++;
                } else {
                  duplicateCount++;
                }
              } else {
                await pool.execute(
                  `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                  [id, conversation.customer_id, dir, safeBody, safeMsgId, m.type || 'text', waMs, m.status || 'delivered', iso, userId]
                );
                insertedCount++;
              }
            }
          }

          console.log(`[Sync:User ${userId}] Chat: ${targetJid} | Conv: ${id} | Fetched: ${liveMsgs.length} | Inserted: ${insertedCount} | Updated: ${updatedCount} | Dups: ${duplicateCount}`);
        }
      } catch (liveErr) {
        console.warn('[Conversation] Live messages sync warning:', liveErr.message);
      }
    }

    // Link any customer messages to this conversation
    if (conversation.customer_id) {
      await pool.execute(
        'UPDATE messages SET conversation_id = ? WHERE user_id = ? AND customer_id = ? AND (conversation_id IS NULL OR conversation_id = 0)',
        [id, userId, conversation.customer_id]
      );
      await pool.execute(
        'UPDATE conversations SET last_message_at = (SELECT MAX(created_at) FROM messages WHERE conversation_id = ?) WHERE id = ? AND user_id = ?',
        [id, id, userId]
      );
    }

    const updatedConv = await Conversation.findById(id);
    const result = await Message.findByConversationId(id, { limit, before, mode });

    // If WhatsApp Web is connected, more historical messages can potentially be fetched if we found messages
    const hasLiveSession = !!(userSession && userSession.client && userSession.client.pupPage);
    const finalHasMore = (result.messages && result.messages.length > 0) ? (result.hasMore || hasLiveSession) : false;

    return res.status(200).json({
      success: true,
      conversation: updatedConv || conversation,
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
    const userId = req.user ? req.user.id : null;
    const savedMessage = await Message.create({
      conversationId: id,
      customerId: conversation.customer_id,
      sender: 'staff',
      text: text.trim(),
      status: 'sent',
      userId: userId
    });

    const updatedConversation = await Conversation.findById(id, userId);

    // 2. Emit live Socket.IO events to connected clients
    socketService.broadcastNewMessage(id, savedMessage);
    socketService.broadcastConversationUpdate(updatedConversation);

    // 3. Send ONCE via WhatsApp Web client if connected for this user
    const userSession = sessionManager.getSession(userId);
    if (userSession && userSession.isConnected) {
      userSession.sendMessage(conversation.phone_number, text.trim())
        .then(async (waResult) => {
          if (waResult && waResult.success && waResult.messageId) {
            await pool.execute('UPDATE messages SET whatsapp_message_id = ? WHERE id = ?', [waResult.messageId, savedMessage.id]);
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
