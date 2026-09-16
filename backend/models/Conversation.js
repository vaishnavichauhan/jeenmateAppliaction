const pool = require('../config/db');

const Conversation = {
  async findAll({ search, userId } = {}) {
    let query = `
      SELECT 
        c.id,
        c.customer_id,
        c.status,
        c.unread_count,
        DATE_FORMAT(c.last_message_at, '%Y-%m-%dT%H:%i:%s.000Z') as last_message_at,
        c.is_pinned,
        COALESCE(NULLIF(cu.name, ''), cu.phone_number, 'Customer') as customer_name,
        COALESCE(cu.phone_number, '') as phone_number,
        cu.profile_pic_url as avatar,
        (
          SELECT 
            CASE 
              WHEN m.message = '[revoked]' THEN '🚫 You deleted this message' 
              ELSE m.message 
            END 
          FROM messages m 
          WHERE m.conversation_id = c.id 
            AND m.message IS NOT NULL 
            AND m.message != '' 
          ORDER BY m.created_at DESC, m.id DESC 
          LIMIT 1
        ) as last_message
      FROM conversations c
      LEFT JOIN customers cu ON c.customer_id = cu.id
      WHERE 1=1
        AND (
          EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
          OR c.unread_count > 0
        )
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

    query += ` ORDER BY c.is_pinned DESC, c.last_message_at DESC`;
    const [rows] = await pool.execute(query, params);

    // Deduplicate by clean customer phone number to ensure 1 conversation per contact
    const uniqueRows = [];
    const seenPhones = new Set();

    for (const row of rows) {
      const rawPhone = String(row.phone_number || '').replace(/[^0-9]/g, '');
      const isGroup = String(row.phone_number || '').startsWith('group-');
      const phoneKey = isGroup
        ? row.phone_number
        : (rawPhone.length >= 10 ? rawPhone.slice(-10) : (rawPhone || `id_${row.customer_id}`));

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
        DATE_FORMAT(c.last_message_at, '%Y-%m-%dT%H:%i:%s.000Z') as last_message_at,
        COALESCE(NULLIF(cu.name, ''), cu.phone_number, 'Customer') as customer_name,
        COALESCE(cu.phone_number, '') as phone_number,
        cu.profile_pic_url as avatar,
        (
          SELECT 
            CASE 
              WHEN m.message = '[revoked]' THEN '🚫 You deleted this message' 
              ELSE m.message 
            END 
          FROM messages m 
          WHERE m.conversation_id = c.id 
            AND m.message IS NOT NULL 
            AND m.message != '' 
          ORDER BY m.created_at DESC, m.id DESC 
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
