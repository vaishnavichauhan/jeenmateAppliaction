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

    let convIds = [conversationId];
    let custIds = [];
    try {
      const [convRow] = await pool.execute(
        `SELECT c.id, c.customer_id, cu.phone_number, cu.whatsapp_jid, c.whatsapp_account_id
         FROM conversations c 
         LEFT JOIN customers cu ON c.customer_id = cu.id 
         WHERE c.id = ? LIMIT 1`,
        [conversationId]
      );
      if (convRow.length > 0) {
        const custId = convRow[0].customer_id;
        if (custId) custIds.push(custId);
        const phone = convRow[0].phone_number;
        const jid = convRow[0].whatsapp_jid;
        const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
        const phoneSuffix = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : '';

        const [relatedConvs] = await pool.execute(
          `SELECT c.id, c.customer_id FROM conversations c 
           LEFT JOIN customers cu ON c.customer_id = cu.id 
           WHERE c.id = ? OR c.customer_id = ? 
              OR (cu.phone_number IS NOT NULL AND cu.phone_number = ?)
              OR (cu.whatsapp_jid IS NOT NULL AND cu.whatsapp_jid = ?)
              OR (LENGTH(?) >= 10 AND cu.phone_number LIKE CONCAT('%', ?))`,
          [conversationId, custId || 0, phone || '', jid || '', phoneSuffix || '', phoneSuffix || '']
        );
        if (relatedConvs.length > 0) {
          convIds = Array.from(new Set(relatedConvs.map(r => r.id)));
          relatedConvs.forEach(r => {
            if (r.customer_id) custIds.push(r.customer_id);
          });
          custIds = Array.from(new Set(custIds));
        }
      }
    } catch (_) {}

    const convPlaceholders = convIds.map(() => '?').join(',');
    const custClause = custIds.length > 0 ? `OR customer_id IN (${custIds.map(() => '?').join(',')})` : '';
    const matchParams = [...convIds, ...custIds];

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
        `SELECT 
           m.id,
           m.conversation_id,
           CASE WHEN m.direction = 'outgoing' THEN 'staff' ELSE 'customer' END as sender,
           m.message as text,
           DATE_FORMAT(CONVERT_TZ(m.created_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') as timestamp,
           m.whatsapp_timestamp,
           m.status,
           m.whatsapp_message_id,
           m.message_type,
           m.metadata,
           m.created_at
         FROM (
           SELECT id, COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) as sort_time
           FROM messages
           WHERE (conversation_id IN (${convPlaceholders}) ${custClause})
             AND (
               (${beforeEpoch} > 0 AND whatsapp_timestamp IS NOT NULL AND whatsapp_timestamp < ${beforeEpoch})
               OR (whatsapp_timestamp IS NULL AND created_at < ?)
             )
           ORDER BY COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) DESC, id DESC
           LIMIT ${parsedLimit}
         ) ids
         JOIN messages m ON m.id = ids.id
         ORDER BY ids.sort_time ASC, m.id ASC`,
        [...matchParams, safeBefore]
      );

      let hasMore = false;
      if (rows.length > 0) {
        const oldestWaTime = rows[0].whatsapp_timestamp;
        const oldestCreated = rows[0].created_at;
        const [olderCount] = await pool.execute(
          `SELECT id FROM messages 
           WHERE (conversation_id IN (${convPlaceholders}) ${custClause}) 
             AND (
               (? IS NOT NULL AND whatsapp_timestamp < ?)
               OR (whatsapp_timestamp IS NULL AND created_at < ?)
             )
           LIMIT 1`,
          [...matchParams, oldestWaTime, oldestWaTime, oldestCreated]
        );
        hasMore = (olderCount.length || 0) > 0;
      }

      return {
        messages: rows.map(formatMessageRow),
        hasMore,
        oldestTimestamp: rows[0]?.timestamp || null,
      };
    }

    // Case 2: Initial load or default — fetch the latest `parsedLimit` messages
    const [rows] = await pool.execute(
      `SELECT 
         m.id,
         m.conversation_id,
         CASE WHEN m.direction = 'outgoing' THEN 'staff' ELSE 'customer' END as sender,
         m.message as text,
         DATE_FORMAT(CONVERT_TZ(m.created_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') as timestamp,
         m.whatsapp_timestamp,
         m.status,
         m.whatsapp_message_id,
         m.message_type,
         m.metadata,
         m.created_at
       FROM (
         SELECT id, COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) as sort_time
         FROM messages
         WHERE (conversation_id IN (${convPlaceholders}) ${custClause})
         ORDER BY COALESCE(whatsapp_timestamp, UNIX_TIMESTAMP(created_at) * 1000) DESC, id DESC
         LIMIT ${parsedLimit}
       ) ids
       JOIN messages m ON m.id = ids.id
       ORDER BY ids.sort_time ASC, m.id ASC`,
      [...matchParams]
    );

    let hasMore = false;
    if (rows.length > 0) {
      const oldestWaTime = rows[0].whatsapp_timestamp;
      const oldestCreated = rows[0].created_at;
      const [olderCount] = await pool.execute(
        `SELECT id FROM messages 
         WHERE (conversation_id IN (${convPlaceholders}) ${custClause}) 
           AND (
             (? IS NOT NULL AND whatsapp_timestamp < ?)
             OR (whatsapp_timestamp IS NULL AND created_at < ?)
           )
         LIMIT 1`,
        [...matchParams, oldestWaTime, oldestWaTime, oldestCreated]
      );
      hasMore = (olderCount.length || 0) > 0;
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

  async create({ conversationId, customerId = null, sender, text, status = 'sent', whatsappMessageId = null, messageType = 'text', metadata = null, userId = null, whatsappAccountId = null }) {
    const direction = sender === 'staff' ? 'outgoing' : 'incoming';
    const nowMs = Date.now();
    const nowUtc = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
    const metadataJson = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

    const [result] = await pool.execute(
      `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, whatsapp_account_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [conversationId, customerId, direction, text, whatsappMessageId, messageType, nowMs, status, nowUtc, userId, whatsappAccountId, metadataJson]
    );

    await pool.execute(
      'UPDATE conversations SET last_message_at = ? WHERE id = ?',
      [nowUtc, conversationId]
    );

    return this.findById(result.insertId);
  }
};

module.exports = Message;
