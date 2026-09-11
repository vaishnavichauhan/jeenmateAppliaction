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
        COALESCE(cu.name, cu.phone_number, 'Customer') as customer_name,
        COALESCE(cu.phone_number, '') as phone_number,
        cu.profile_pic_url as avatar,
        (SELECT message FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) as last_message
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

    query += ` ORDER BY c.is_pinned DESC, c.last_message_at DESC`;
    const [rows] = await pool.execute(query, params);
    return rows;
  },

  async findById(id) {
    const query = `
      SELECT 
        c.id,
        c.customer_id,
        c.status,
        c.unread_count,
        DATE_FORMAT(c.last_message_at, '%Y-%m-%dT%H:%i:%s.000Z') as last_message_at,
        COALESCE(cu.name, cu.phone_number, 'Customer') as customer_name,
        COALESCE(cu.phone_number, '') as phone_number,
        cu.profile_pic_url as avatar,
        (SELECT message FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) as last_message
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
