const pool = require('../config/db');

const formatMessageRow = (row) => {
  if (!row) return null;
  let parsedMedia = null;
  if (row.media_urls) {
    if (Array.isArray(row.media_urls)) {
      parsedMedia = row.media_urls;
    } else {
      try {
        parsedMedia = JSON.parse(row.media_urls);
      } catch (e) {
        parsedMedia = [row.media_urls];
      }
    }
  }
  return {
    ...row,
    media_urls: parsedMedia,
    message_type: row.message_type || (parsedMedia && parsedMedia.length > 0 ? 'image' : 'text')
  };
};

const InternalMessage = {
  async create({ sender_id, receiver_id, message_text = '', media_urls = null, message_type = 'text' }) {
    const text = (message_text || '').trim();
    let mediaStr = null;
    if (media_urls) {
      mediaStr = Array.isArray(media_urls) ? JSON.stringify(media_urls) : String(media_urls);
    }
    const msgType = media_urls && (!message_type || message_type === 'text') ? 'image' : message_type;

    const [result] = await pool.execute(
      'INSERT INTO internal_messages (sender_id, receiver_id, message_text, media_urls, message_type) VALUES (?, ?, ?, ?, ?)',
      [Number(sender_id), Number(receiver_id), text, mediaStr, msgType]
    );
    const [rows] = await pool.execute(
      `SELECT m.*, 
              s.name AS sender_name,
              r.name AS receiver_name
       FROM internal_messages m
       JOIN users s ON m.sender_id = s.id
       JOIN users r ON m.receiver_id = r.id
       WHERE m.id = ?`,
      [result.insertId]
    );
    return formatMessageRow(rows[0]);
  },

  async getConversation(user1_id, user2_id, limit = 100, offset = 0) {
    const u1 = Number(user1_id);
    const u2 = Number(user2_id);
    const lim = Number(limit) || 100;
    const off = Number(offset) || 0;

    const [rows] = await pool.query(
      `SELECT m.*, 
              s.name AS sender_name,
              r.name AS receiver_name
       FROM internal_messages m
       JOIN users s ON m.sender_id = s.id
       JOIN users r ON m.receiver_id = r.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?)
          OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC
       LIMIT ? OFFSET ?`,
      [u1, u2, u2, u1, lim, off]
    );
    return rows.map(formatMessageRow);
  },

  async getColleaguesWithSummary(currentUserId) {
    const me = Number(currentUserId);
    const [rows] = await pool.execute(
      `SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role,
        (
          SELECT 
            CASE 
              WHEN (m.message_text IS NULL OR TRIM(m.message_text) = '') AND m.media_urls IS NOT NULL THEN '📷 Photo'
              ELSE m.message_text 
            END
          FROM internal_messages m 
          WHERE (m.sender_id = u.id AND m.receiver_id = ?) 
             OR (m.sender_id = ? AND m.receiver_id = u.id)
          ORDER BY m.created_at DESC 
          LIMIT 1
        ) AS last_message,
        (
          SELECT m.created_at 
          FROM internal_messages m 
          WHERE (m.sender_id = u.id AND m.receiver_id = ?) 
             OR (m.sender_id = ? AND m.receiver_id = u.id)
          ORDER BY m.created_at DESC 
          LIMIT 1
        ) AS last_message_time,
        (
          SELECT COUNT(*) 
          FROM internal_messages m 
          WHERE m.sender_id = u.id 
            AND m.receiver_id = ? 
            AND m.is_read = 0
        ) AS unread_count
      FROM users u
      WHERE u.id != ?
      ORDER BY 
        (last_message_time IS NOT NULL) DESC,
        last_message_time DESC,
        u.name ASC`,
      [me, me, me, me, me, me]
    );
    return rows;
  },

  async markAsRead(currentUserId, otherUserId) {
    const me = Number(currentUserId);
    const other = Number(otherUserId);
    const [result] = await pool.execute(
      'UPDATE internal_messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0',
      [me, other]
    );
    return result.affectedRows;
  }
};

module.exports = InternalMessage;
