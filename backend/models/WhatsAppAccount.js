const pool = require('../config/db');

const WhatsAppAccount = {
  async create({ accountName, accountType = 'PERSONAL', ownerUserId = null, createdByUserId, sessionId, status = 'disconnected' }) {
    const [result] = await pool.execute(
      `INSERT INTO whatsapp_accounts (account_name, account_type, owner_user_id, created_by_user_id, session_id, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [accountName, accountType, ownerUserId, createdByUserId, sessionId, status]
    );
    return this.findById(result.insertId);
  },

  async findById(id) {
    const [rows] = await pool.execute(
      `SELECT a.*, u.name as owner_name, c.name as creator_name
       FROM whatsapp_accounts a
       LEFT JOIN users u ON a.owner_user_id = u.id
       LEFT JOIN users c ON a.created_by_user_id = c.id
       WHERE a.id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  async findBySessionId(sessionId) {
    const [rows] = await pool.execute(
      'SELECT * FROM whatsapp_accounts WHERE session_id = ?',
      [sessionId]
    );
    return rows[0] || null;
  },

  /**
   * Find all accounts accessible by a specific user:
   * - Personal accounts owned by this user
   * - Team accounts where this user is an authorized member (or creator if admin)
   */
  async findAccessibleByUser(userId, userRole = 'user') {
    if (userRole === 'admin') {
      // Admin sees their own personal accounts AND all team accounts
      const [rows] = await pool.execute(
        `SELECT DISTINCT a.*, 
           u.name as owner_name, 
           c.name as creator_name,
           (SELECT COUNT(*) FROM whatsapp_account_members m WHERE m.whatsapp_account_id = a.id) as member_count
         FROM whatsapp_accounts a
         LEFT JOIN users u ON a.owner_user_id = u.id
         LEFT JOIN users c ON a.created_by_user_id = c.id
         WHERE (a.account_type = 'PERSONAL' AND a.owner_user_id = ?)
            OR a.account_type = 'TEAM'
         ORDER BY a.account_type DESC, a.created_at ASC`,
        [userId]
      );
      return rows;
    }

    // Normal user: sees their own personal accounts + team accounts where they are a member
    const [rows] = await pool.execute(
      `SELECT DISTINCT a.*, 
         u.name as owner_name, 
         c.name as creator_name,
         (SELECT COUNT(*) FROM whatsapp_account_members m WHERE m.whatsapp_account_id = a.id) as member_count
       FROM whatsapp_accounts a
       LEFT JOIN users u ON a.owner_user_id = u.id
       LEFT JOIN users c ON a.created_by_user_id = c.id
       LEFT JOIN whatsapp_account_members mem ON a.id = mem.whatsapp_account_id
       WHERE (a.account_type = 'PERSONAL' AND a.owner_user_id = ?)
          OR (a.account_type = 'TEAM' AND mem.user_id = ?)
       ORDER BY a.account_type DESC, a.created_at ASC`,
      [userId, userId]
    );
    return rows;
  },

  async updateStatus(id, { status, phoneNumber = null }) {
    if (phoneNumber) {
      await pool.execute(
        'UPDATE whatsapp_accounts SET status = ?, phone_number = ? WHERE id = ?',
        [status, phoneNumber, id]
      );
    } else {
      await pool.execute(
        'UPDATE whatsapp_accounts SET status = ? WHERE id = ?',
        [status, id]
      );
    }
    return this.findById(id);
  },

  async clearPhoneNumber(id) {
    await pool.execute(
      'UPDATE whatsapp_accounts SET phone_number = NULL, status = "disconnected" WHERE id = ?',
      [id]
    );
  },

  async deleteById(id) {
    await pool.execute('DELETE FROM whatsapp_account_members WHERE whatsapp_account_id = ?', [id]);
    await pool.execute('DELETE FROM messages WHERE whatsapp_account_id = ?', [id]);
    await pool.execute('DELETE FROM conversations WHERE whatsapp_account_id = ?', [id]);
    await pool.execute('DELETE FROM customers WHERE whatsapp_account_id = ?', [id]);
    await pool.execute('DELETE FROM whatsapp_calls WHERE whatsapp_account_id = ?', [id]);
    const [res] = await pool.execute('DELETE FROM whatsapp_accounts WHERE id = ?', [id]);
    return res.affectedRows > 0;
  }
};

module.exports = WhatsAppAccount;
