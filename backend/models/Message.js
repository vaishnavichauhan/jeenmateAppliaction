const pool = require('../config/db');

function formatMessageRow(row) {
  if (!row) return null;
  let parsedMetadata = null;
  if (row.metadata) {
    if (typeof row.metadata === 'object') {
      parsedMetadata = row.metadata;
    } else if (typeof row.metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(row.metadata);
      } catch (_) {
        parsedMetadata = null;
      }
    }
  }
  return {
    ...row,
    message_type: row.message_type || 'text',
    metadata: parsedMetadata
  };
}

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
      let beforeEpoch = 0;
      let safeBefore = null;

      if (typeof before === 'number' || /^\d{10,13}$/.test(String(before).trim())) {
        beforeEpoch = Number(before);
        if (beforeEpoch < 1e11) beforeEpoch *= 1000;
        safeBefore = new Date(beforeEpoch).toISOString().slice(0, 19).replace('T', ' ');
      } else {
        const d = new Date(before);
        beforeEpoch = !isNaN(d.getTime()) ? d.getTime() : 0;
        safeBefore = String(before).replace('T', ' ').replace('Z', '').slice(0, 19);
      }

      const [rows] = await pool.execute(
        `SELECT * FROM (
          SELECT 
            id,
            conversation_id,
            CASE WHEN direction = 'outgoing' THEN 'staff' ELSE 'customer' END as sender,
            message as text,
            DATE_FORMAT(CONVERT_TZ(created_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') as timestamp,
            whatsapp_timestamp,
            status,
            whatsapp_message_id,
            message_type,
            metadata,
            created_at
          FROM messages
          WHERE conversation_id = ?
            AND (
              (${beforeEpoch} > 0 AND whatsapp_timestamp IS NOT NULL AND whatsapp_timestamp < ${beforeEpoch})
              OR (whatsapp_timestamp IS NULL AND created_at < ?)
            )
          ORDER BY COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) DESC, id DESC
          LIMIT ${parsedLimit}
        ) sub
        ORDER BY COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) ASC, id ASC`,
        [conversationId, safeBefore]
      );

      let hasMore = false;
      if (rows.length > 0) {
        const oldestWaTime = rows[0].whatsapp_timestamp;
        const oldestCreated = rows[0].created_at;
        const [olderCount] = await pool.execute(
          `SELECT COUNT(*) as cnt FROM messages 
           WHERE conversation_id = ? 
             AND (
               (? IS NOT NULL AND whatsapp_timestamp < ?)
               OR (whatsapp_timestamp IS NULL AND created_at < ?)
             )`,
          [conversationId, oldestWaTime, oldestWaTime, oldestCreated]
        );
        hasMore = (olderCount[0]?.cnt || 0) > 0;
      }

      return {
        messages: rows.map(formatMessageRow),
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
          DATE_FORMAT(CONVERT_TZ(created_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') as timestamp,
          whatsapp_timestamp,
          status,
          whatsapp_message_id,
          message_type,
          metadata,
          created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) DESC, id DESC
        LIMIT ${parsedLimit}
      ) sub
      ORDER BY COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) ASC, id ASC`,
      [conversationId]
    );

    let hasMore = false;
    if (rows.length > 0) {
      const oldestWaTime = rows[0].whatsapp_timestamp;
      const oldestCreated = rows[0].created_at;
      const [olderCount] = await pool.execute(
        `SELECT COUNT(*) as cnt FROM messages 
         WHERE conversation_id = ? 
           AND (
             (? IS NOT NULL AND whatsapp_timestamp < ?)
             OR (whatsapp_timestamp IS NULL AND created_at < ?)
           )`,
        [conversationId, oldestWaTime, oldestWaTime, oldestCreated]
      );
      hasMore = (olderCount[0]?.cnt || 0) > 0;
    }

    return {
      messages: rows.map(formatMessageRow),
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
        whatsapp_timestamp,
        status,
        whatsapp_message_id,
        message_type,
        metadata
       FROM messages
       WHERE id = ?`,
      [id]
    );
    return formatMessageRow(rows[0]) || null;
  },

  async create({ conversationId, customerId = null, sender, text, status = 'sent', whatsappMessageId = null, messageType = 'text', metadata = null, userId = null }) {
    const direction = sender === 'staff' ? 'outgoing' : 'incoming';
    const nowMs = Date.now();
    const nowUtc = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
    const metadataJson = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

    const [result] = await pool.execute(
      `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [conversationId, customerId, direction, text, whatsappMessageId, messageType, nowMs, status, nowUtc, userId, metadataJson]
    );

    await pool.execute(
      'UPDATE conversations SET last_message_at = ? WHERE id = ?',
      [nowUtc, conversationId]
    );

    return this.findById(result.insertId);
  }
};

module.exports = Message;
