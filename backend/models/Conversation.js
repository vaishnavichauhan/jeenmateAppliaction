const pool = require('../config/db');

const Conversation = {
  async findAll({ search, userId } = {}) {
    let query = `
      SELECT 
        c.id,
        c.customer_id,
        c.status,
        c.unread_count,
        COALESCE(
          (
            SELECT DATE_FORMAT(CONVERT_TZ(FROM_UNIXTIME(COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000) / 1000), @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z')
            FROM messages m 
            WHERE (m.conversation_id = c.id OR (c.customer_id IS NOT NULL AND m.customer_id = c.customer_id))
            ORDER BY COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000) DESC, m.id DESC
            LIMIT 1
          ),
          DATE_FORMAT(CONVERT_TZ(c.last_message_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z'),
          DATE_FORMAT(CONVERT_TZ(c.created_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z')
        ) as last_message_at,
        COALESCE(
          (
            SELECT COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000)
            FROM messages m 
            WHERE (m.conversation_id = c.id OR (c.customer_id IS NOT NULL AND m.customer_id = c.customer_id))
            ORDER BY COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000) DESC, m.id DESC
            LIMIT 1
          ),
          UNIX_TIMESTAMP(COALESCE(c.last_message_at, c.created_at)) * 1000
        ) as effective_last_time,
        c.is_pinned,
        COALESCE(NULLIF(cu.name, ''), cu.phone_number, 'Customer') as customer_name,
        COALESCE(cu.phone_number, '') as phone_number,
        cu.profile_pic_url as avatar,
        (
          SELECT 
            CASE 
              WHEN m.message = '[revoked]' THEN '🚫 You deleted this message' 
              WHEN m.message_type = 'image' OR m.message IN ('Image', 'Images') THEN '📷 Photo'
              WHEN m.message_type = 'video' OR m.message = 'Video' THEN '🎥 Video'
              WHEN m.message_type = 'audio' OR m.message_type = 'voice' OR m.message = 'Voice message' THEN '🎤 Voice message'
              WHEN m.message_type = 'document' OR m.message = 'Document' THEN '📄 Document'
              WHEN m.message_type = 'call' OR m.message IN ('Call', 'Voice call', 'Video call', '[call_log]') THEN '📞 Call'
              WHEN m.message_type = 'location' OR m.message = 'Location' THEN '📍 Location'
              WHEN m.message_type = 'sticker' OR m.message = 'Sticker' THEN '🏷️ Sticker'
              WHEN m.message IS NOT NULL AND TRIM(m.message) != '' THEN m.message
              ELSE NULL
            END 
          FROM messages m 
          WHERE (m.conversation_id = c.id OR (c.customer_id IS NOT NULL AND m.customer_id = c.customer_id))
          ORDER BY COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000) DESC, m.id DESC 
          LIMIT 1
        ) as last_message
      FROM conversations c
      LEFT JOIN customers cu ON c.customer_id = cu.id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ` AND c.user_id = ?`;
      params.push(userId);
    }

    if (search && search.trim()) {
      query += ` AND (cu.name LIKE ? OR cu.phone_number LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    query += ` ORDER BY c.is_pinned DESC, effective_last_time DESC, c.id DESC`;
    const [rows] = await pool.execute(query, params);

    // Deduplicate by clean customer phone number to ensure 1 conversation per contact
    const uniqueRows = [];
    const seenPhones = new Set();

    for (const row of rows) {
      const rawPhone = String(row.phone_number || '').replace(/[^0-9]/g, '');
      const isGroup = String(row.phone_number || '').startsWith('group-');
      const phoneKey = isGroup
        ? row.phone_number
        : (rawPhone.length >= 10 ? rawPhone.slice(-10) : (rawPhone ? `phone_${rawPhone}` : `conv_${row.id}`));

      if (!seenPhones.has(phoneKey)) {
        seenPhones.add(phoneKey);
        uniqueRows.push(row);
      }
    }

    return uniqueRows;
  },

  async findById(id) {
    const query = `
      SELECT 
        c.id,
        c.customer_id,
        c.status,
        c.unread_count,
        COALESCE(
          (
            SELECT DATE_FORMAT(CONVERT_TZ(FROM_UNIXTIME(COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000) / 1000), @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z')
            FROM messages m 
            WHERE (m.conversation_id = c.id OR (c.customer_id IS NOT NULL AND m.customer_id = c.customer_id))
            ORDER BY COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000) DESC, m.id DESC
            LIMIT 1
          ),
          DATE_FORMAT(CONVERT_TZ(c.last_message_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z'),
          DATE_FORMAT(CONVERT_TZ(c.created_at, @@session.time_zone, '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z')
        ) as last_message_at,
        c.is_pinned,
        COALESCE(NULLIF(cu.name, ''), cu.phone_number, 'Customer') as customer_name,
        COALESCE(cu.phone_number, '') as phone_number,
        cu.profile_pic_url as avatar,
        (
          SELECT 
            CASE 
              WHEN m.message = '[revoked]' THEN '🚫 You deleted this message' 
              WHEN m.message_type = 'image' OR m.message IN ('Image', 'Images') THEN '📷 Photo'
              WHEN m.message_type = 'video' OR m.message = 'Video' THEN '🎥 Video'
              WHEN m.message_type = 'audio' OR m.message_type = 'voice' OR m.message = 'Voice message' THEN '🎤 Voice message'
              WHEN m.message_type = 'document' OR m.message = 'Document' THEN '📄 Document'
              WHEN m.message_type = 'call' OR m.message IN ('Call', 'Voice call', 'Video call', '[call_log]') THEN '📞 Call'
              WHEN m.message_type = 'location' OR m.message = 'Location' THEN '📍 Location'
              WHEN m.message_type = 'sticker' OR m.message = 'Sticker' THEN '🏷️ Sticker'
              WHEN m.message IS NOT NULL AND TRIM(m.message) != '' THEN m.message
              ELSE NULL
            END 
          FROM messages m 
          WHERE (m.conversation_id = c.id OR (c.customer_id IS NOT NULL AND m.customer_id = c.customer_id))
          ORDER BY COALESCE(m.whatsapp_timestamp, UNIX_TIMESTAMP(m.created_at) * 1000) DESC, m.id DESC 
          LIMIT 1
        ) as last_message
      FROM conversations c
      LEFT JOIN customers cu ON c.customer_id = cu.id
      WHERE c.id = ?
    `;
    const [rows] = await pool.execute(query, [id]);
    return rows[0] || null;
  },

  async resetUnread(id) {
    await pool.execute('UPDATE conversations SET unread_count = 0 WHERE id = ?', [id]);
    return this.findById(id);
  }
};

module.exports = Conversation;
