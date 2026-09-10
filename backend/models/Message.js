const pool = require('../config/db');

const Message = {
  async findByConversationId(conversationId, limit = 100) {
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
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ${parseInt(limit, 10) || 100}`,
      [conversationId]
    );
    return rows;
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
