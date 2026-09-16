const pool = require('../config/db');

const Message = {
  async findByConversationId(conversationId, options = {}) {
    let limit = 30;
    let before = null;
    let mode = null;

    if (typeof options === 'number' || typeof options === 'string') {
      limit = parseInt(options, 10) || 30;
    } else if (options && typeof options === 'object') {
      if (options.limit) limit = parseInt(options.limit, 10) || 30;
      if (options.before) before = options.before;
      if (options.mode) mode = options.mode;
    }

    const parsedLimit = Math.max(1, Math.min(limit, 100));

    // Case 1: Fetch older messages before a specific timestamp
    if (before) {
      const safeBefore = String(before).includes('T')
        ? String(before).replace('T', ' ').slice(0, 19)
        : String(before);

      const [rows] = await pool.execute(
        `SELECT * FROM (
          SELECT 
            id,
            conversation_id,
            CASE WHEN direction = 'outgoing' THEN 'staff' ELSE 'customer' END as sender,
            message as text,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.000Z') as timestamp,
            status,
            whatsapp_message_id,
            created_at
          FROM messages
          WHERE conversation_id = ? AND created_at < ?
          ORDER BY created_at DESC, id DESC
          LIMIT ${parsedLimit}
        ) sub
        ORDER BY created_at ASC, id ASC`,
        [conversationId, safeBefore]
      );

      let hasMore = false;
      if (rows.length > 0) {
        const oldestCreated = rows[0].created_at;
        const [olderCount] = await pool.execute(
          'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND created_at < ?',
          [conversationId, oldestCreated]
        );
        hasMore = (olderCount[0]?.cnt || 0) > 0;
      }

      return {
        messages: rows,
        hasMore,
        oldestTimestamp: rows[0]?.timestamp || null,
      };
    }

    // Case 2: Initial load or default — fetch the latest `parsedLimit` messages
    const [rows] = await pool.execute(
      `SELECT * FROM (
        SELECT 
          id,
          conversation_id,
          CASE WHEN direction = 'outgoing' THEN 'staff' ELSE 'customer' END as sender,
          message as text,
          DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.000Z') as timestamp,
          status,
          whatsapp_message_id,
          created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ${parsedLimit}
      ) sub
      ORDER BY created_at ASC, id ASC`,
      [conversationId]
    );

    let hasMore = false;
    if (rows.length > 0) {
      const oldestCreated = rows[0].created_at;
      const [olderCount] = await pool.execute(
        'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND created_at < ?',
        [conversationId, oldestCreated]
      );
      hasMore = (olderCount[0]?.cnt || 0) > 0;
    }

    return {
      messages: rows,
      hasMore,
      oldestTimestamp: rows[0]?.timestamp || null,
    };
  },

  async findById(id) {
    const [rows] = await pool.execute(
      `SELECT 
        id,
        conversation_id,
        CASE WHEN direction = 'outgoing' THEN 'staff' ELSE 'customer' END as sender,
        message as text,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.000Z') as timestamp,
        status,
        whatsapp_message_id
       FROM messages
       WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  async create({ conversationId, customerId = null, sender, text, status = 'sent', whatsappMessageId = null }) {
    const direction = sender === 'staff' ? 'outgoing' : 'incoming';
    const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const [result] = await pool.execute(
      `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'text', ?, ?)`,
      [conversationId, customerId, direction, text, whatsappMessageId, status, nowUtc]
    );

    await pool.execute(
      'UPDATE conversations SET last_message_at = ? WHERE id = ?',
      [nowUtc, conversationId]
    );

    return this.findById(result.insertId);
  }
};

module.exports = Message;
