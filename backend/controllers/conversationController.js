const pool = require('../config/db');
const { Conversation, Message, WhatsAppAccount, WhatsAppAccountMember } = require('../models');
const sessionManager = require('../services/sessionManager');
const socketService = require('../services/socketService');

/**
 * Access verification helper for WhatsApp conversations
 */
async function verifyConversationAccountAccess(userId, userRole, accountId) {
  if (!accountId) return true; // Legacy fallback
  const accId = Number(accountId);

  const [rows] = await pool.execute('SELECT * FROM whatsapp_accounts WHERE id = ?', [accId]);
  if (rows.length === 0) return false;
  const account = rows[0];

  if (account.account_type === 'PERSONAL') {
    return Number(account.owner_user_id) === Number(userId);
  } else if (account.account_type === 'TEAM') {
    if (userRole === 'admin') return true;
    const isMember = await WhatsAppAccountMember.isMember(accId, userId);
    return isMember;
  }
  return false;
}

// GET /api/conversations
async function getConversations(req, res, next) {
  try {
    const { search } = req.query;
    const userId = req.user ? req.user.id : null;
    const userRole = req.user ? req.user.role : 'user';

    let accountId = req.query.accountId || req.headers['x-whatsapp-account-id'];
    if (!accountId && req.params.accountId) {
      accountId = req.params.accountId;
    }

    if (accountId) {
      const hasAccess = await verifyConversationAccountAccess(userId, userRole, accountId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have access to conversations for this WhatsApp account.'
        });
      }
      const conversations = await Conversation.findAll({ search, whatsappAccountId: Number(accountId) });
      return res.status(200).json({
        success: true,
        count: conversations.length,
        data: conversations
      });
    }

    // Default: find accessible accounts for user and fetch
    const accessibleAccounts = await WhatsAppAccount.findAccessibleByUser(userId, userRole);
    if (accessibleAccounts.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }

    const defaultAccId = accessibleAccounts[0].id;
    const conversations = await Conversation.findAll({ search, whatsappAccountId: defaultAccId });

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
    const userRole = req.user ? req.user.role : 'user';

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const accountId = conversation.whatsapp_account_id;
    if (accountId) {
      const hasAccess = await verifyConversationAccountAccess(userId, userRole, accountId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have access to this conversation.'
        });
      }
    }

    // Reset unread count
    await Conversation.resetUnread(id);

    // Sync latest messages for this conversation from WhatsApp Web if session is connected
    const [custRows] = await pool.execute('SELECT id, whatsapp_jid, phone_number FROM customers WHERE id = ?', [conversation.customer_id]);
    const targetJid = custRows[0]?.whatsapp_jid || (custRows[0]?.phone_number ? `${custRows[0].phone_number.replace(/[^0-9]/g, '')}@c.us` : null);
    
    let accountSession = null;
    let isTeamAccount = false;
    if (accountId) {
      accountSession = sessionManager.getSession(accountId);
      const acc = await WhatsAppAccount.findById(accountId);
      isTeamAccount = acc?.account_type === 'TEAM';
    } else {
      accountSession = sessionManager.getSession(userId);
    }

    // Helper to sync live WhatsApp messages in background or when empty
    const syncLiveMessages = async () => {
      if (custRows.length > 0 && targetJid && accountSession && accountSession.client && accountSession.client.pupPage) {
        try {
          const fetchLimit = before ? 100 : 60;
          const customerPhone = custRows[0].phone_number || null;
          const liveMsgs = await accountSession.fetchMessagesForChat(targetJid, fetchLimit, customerPhone);
          
          let insertedCount = 0;
          let updatedCount = 0;

          if (liveMsgs.length > 0) {
            for (const m of liveMsgs) {
              const waMs = m.timestamp > 1e11 ? m.timestamp : (m.timestamp * 1000 || Date.now());
              const iso = new Date(waMs).toISOString().slice(0, 19).replace('T', ' ');
              const dir = m.fromMe ? 'outgoing' : 'incoming';
              const safeMsgId = m.id ? String(m.id).slice(0, 191) : `wa_${m.timestamp}_${dir}`;
              const safeBody = m.body || '';
              const isCall = m.type === 'call' || !!(m.metadata && m.metadata.isCall);

              if (isCall && isTeamAccount) continue;

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

                let existingMsg = null;
                if (waCallId) {
                  const [existByCallId] = await pool.execute(
                    `SELECT id, whatsapp_message_id, message, message_type, metadata FROM messages 
                     WHERE conversation_id = ? AND (whatsapp_account_id = ? OR user_id = ?) AND (
                       whatsapp_message_id = ? OR 
                       JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) = ? OR
                       (LENGTH(?) >= 8 AND (whatsapp_message_id LIKE CONCAT('%', ?, '%') OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) LIKE CONCAT('%', ?, '%')))
                     ) 
                     LIMIT 1`,
                    [id, accountId || 0, userId, waCallId, waCallId, coreCallId || '', coreCallId || '', coreCallId || '']
                  );
                  if (existByCallId.length > 0) existingMsg = existByCallId[0];
                }

                if (!existingMsg && waMs && waMs > 0) {
                  const [existByExactEpoch] = await pool.execute(
                    `SELECT id, whatsapp_message_id, message, message_type, metadata FROM messages 
                     WHERE conversation_id = ? AND (whatsapp_account_id = ? OR user_id = ?) AND direction = ? AND message_type = 'call' AND whatsapp_timestamp = ?
                     LIMIT 1`,
                    [id, accountId || 0, userId, dir, waMs]
                  );
                  if (existByExactEpoch.length > 0) existingMsg = existByExactEpoch[0];
                }

                if (existingMsg) {
                  await pool.execute(
                    `UPDATE messages 
                     SET message = ?, message_type = 'call', whatsapp_message_id = COALESCE(whatsapp_message_id, ?), whatsapp_timestamp = ?, status = ?, created_at = ?, metadata = ?
                     WHERE id = ?`,
                    [safeBody, safeMsgId, waMs, m.status || 'delivered', iso, metadataJson, existingMsg.id]
                  );
                  updatedCount++;
                } else {
                  await pool.execute(
                    `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, whatsapp_account_id, metadata)
                     VALUES (?, ?, ?, ?, ?, 'call', ?, ?, ?, ?, ?, ?)`,
                    [id, conversation.customer_id, dir, safeBody, safeMsgId, waMs, m.status || 'delivered', iso, userId, accountId, metadataJson]
                  );
                  insertedCount++;
                }

                try {
                  const dbCallType = callMetadata.status === 'missed' ? 'missed' : (callMetadata.callType || 'incoming');
                  const durationVal = callMetadata.duration ? `${callMetadata.duration}s` : (m.duration ? `${m.duration}s` : null);
                  await pool.execute(
                    `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, user_id, whatsapp_account_id, created_at, raw_call)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                      accountId,
                      iso,
                      JSON.stringify(m.rawCall || callMetadata)
                    ]
                  );
                } catch (_) {}
              } else {
                let exist = [];
                const coreMsgId = (safeMsgId && safeMsgId.includes('_')) ? safeMsgId.split('_').pop() : safeMsgId;

                if (safeMsgId) {
                  [exist] = await pool.execute(
                    `SELECT id, whatsapp_message_id, message, whatsapp_timestamp FROM messages 
                     WHERE conversation_id = ? AND (whatsapp_account_id = ? OR user_id = ?) AND (
                       whatsapp_message_id = ? OR 
                       whatsapp_message_id = ? OR 
                       (LENGTH(?) >= 8 AND whatsapp_message_id LIKE CONCAT('%', ?, '%'))
                     )
                     LIMIT 1`,
                    [id, accountId || 0, userId, safeMsgId, coreMsgId || '', coreMsgId || '', coreMsgId || '']
                  );
                }

                if (exist.length === 0 && dir === 'outgoing' && safeBody) {
                  const tenMinsAgoMs = waMs - (10 * 60 * 1000);
                  const tenMinsAfterMs = waMs + (10 * 60 * 1000);
                  [exist] = await pool.execute(
                    `SELECT id, whatsapp_message_id, message, whatsapp_timestamp FROM messages 
                     WHERE conversation_id = ? AND (whatsapp_account_id = ? OR user_id = ?) AND direction = 'outgoing' AND message = ?
                       AND (
                         (whatsapp_timestamp IS NOT NULL AND whatsapp_timestamp BETWEEN ? AND ?)
                         OR (whatsapp_message_id IS NULL AND created_at >= (NOW() - INTERVAL 10 MINUTE))
                       )
                     ORDER BY id DESC LIMIT 1`,
                    [id, accountId || 0, userId, safeBody, tenMinsAgoMs, tenMinsAfterMs]
                  );
                }

                if (exist.length === 0 && dir === 'incoming' && waMs && waMs > 0 && safeBody) {
                  [exist] = await pool.execute(
                    `SELECT id, whatsapp_message_id, message, whatsapp_timestamp FROM messages 
                     WHERE conversation_id = ? AND (whatsapp_account_id = ? OR user_id = ?) AND direction = 'incoming' AND whatsapp_timestamp = ? AND message = ?
                     LIMIT 1`,
                    [id, accountId || 0, userId, waMs, safeBody]
                  );
                }

                const metadataJson = m.metadata ? JSON.stringify(m.metadata) : null;

                if (exist.length > 0) {
                  await pool.execute(
                    `UPDATE messages 
                     SET message = ?, 
                         message_type = ?, 
                         whatsapp_message_id = COALESCE(whatsapp_message_id, ?), 
                         whatsapp_timestamp = ?, 
                         status = ?, 
                         created_at = ?,
                         metadata = COALESCE(?, metadata)
                     WHERE id = ?`,
                    [
                      safeBody, 
                      m.type || 'text', 
                      safeMsgId, 
                      waMs, 
                      m.status || 'delivered', 
                      iso, 
                      metadataJson,
                      exist[0].id
                    ]
                  );
                  updatedCount++;
                } else {
                  await pool.execute(
                    `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, whatsapp_account_id, metadata)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, conversation.customer_id, dir, safeBody, safeMsgId, m.type || 'text', waMs, m.status || 'delivered', iso, userId, accountId, metadataJson]
                  );
                  insertedCount++;
                }
              }
            }
          }

          if (insertedCount > 0) {
            socketService.notifyConversationUpdated({ id: conversation.id, whatsapp_account_id: accountId });
          }
        } catch (liveErr) {
          console.warn('[Conversation] Live messages sync warning:', liveErr.message);
        }
      }
    };

    // 1. Fetch existing messages from database immediately
    const result = await Message.findByConversationId(id, { limit, before, mode });

    // 2. If messages exist in DB, respond immediately (< 10ms) and sync in background
    if (result.messages && result.messages.length > 0) {
      const hasLiveSession = !!(accountSession && accountSession.client && accountSession.client.pupPage);
      const finalHasMore = result.hasMore || hasLiveSession;

      // Trigger background sync without blocking HTTP response
      setImmediate(() => {
        syncLiveMessages().catch(() => {});
      });

      return res.status(200).json({
        success: true,
        conversation: conversation,
        data: result.messages,
        hasMore: finalHasMore,
        oldestTimestamp: result.oldestTimestamp
      });
    }

    // 3. If DB is empty, run sync first then return
    await syncLiveMessages();
    const updatedConv = await Conversation.findById(id);
    const freshResult = await Message.findByConversationId(id, { limit, before, mode });
    const hasLiveSession = !!(accountSession && accountSession.client && accountSession.client.pupPage);

    return res.status(200).json({
      success: true,
      conversation: updatedConv || conversation,
      data: freshResult.messages,
      hasMore: (freshResult.messages && freshResult.messages.length > 0) ? (freshResult.hasMore || hasLiveSession) : false,
      oldestTimestamp: freshResult.oldestTimestamp
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
    const userId = req.user ? req.user.id : null;
    const userRole = req.user ? req.user.role : 'user';

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

    const accountId = conversation.whatsapp_account_id;
    if (accountId) {
      const hasAccess = await verifyConversationAccountAccess(userId, userRole, accountId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to send messages in this conversation.'
        });
      }
    }

    // 1. Save staff reply to database first
    const savedMessage = await Message.create({
      conversationId: id,
      customerId: conversation.customer_id,
      sender: 'staff',
      text: text.trim(),
      status: 'sent',
      userId: userId,
      whatsappAccountId: accountId
    });

    const updatedConversation = await Conversation.findById(id);

    // 2. Emit live Socket.IO events to connected clients scoped to account
    socketService.broadcastNewMessage(id, savedMessage, accountId);
    socketService.broadcastConversationUpdate(updatedConversation, accountId);

    // 3. Send ONCE via WhatsApp Web client if connected for this account
    let accountSession = null;
    if (accountId) {
      accountSession = sessionManager.getSession(accountId);
    } else {
      accountSession = sessionManager.getSession(userId);
    }

    if (accountSession && accountSession.isConnected) {
      accountSession.sendMessage(conversation.phone_number, text.trim())
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
      socketService.broadcastConversationUpdate(conversation, conversation.whatsapp_account_id);
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
