const pool = require('../config/db');

const WhatsAppAccountMember = {
  async addMember(whatsappAccountId, userId, role = 'member') {
    const [result] = await pool.execute(
      `INSERT INTO whatsapp_account_members (whatsapp_account_id, user_id, role)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role = ?`,
      [whatsappAccountId, userId, role, role]
    );
    return result;
  },

  async removeMember(whatsappAccountId, userId) {
    const [result] = await pool.execute(
      'DELETE FROM whatsapp_account_members WHERE whatsapp_account_id = ? AND user_id = ?',
      [whatsappAccountId, userId]
    );
    return result.affectedRows > 0;
  },

  async getMembersByAccountId(whatsappAccountId) {
    const [rows] = await pool.execute(
      `SELECT m.*, u.name, u.email, u.role as user_role
       FROM whatsapp_account_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.whatsapp_account_id = ?
       ORDER BY u.name ASC`,
      [whatsappAccountId]
    );
    return rows;
  },

  async setMembers(whatsappAccountId, userIds, adminUserId = null) {
    // Replace member list for a team account while ensuring Admin/Creator remains
    await pool.execute(
      'DELETE FROM whatsapp_account_members WHERE whatsapp_account_id = ?',
      [whatsappAccountId]
    );

    const uniqueUserIds = Array.from(new Set(userIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0)));
    if (adminUserId && !uniqueUserIds.includes(Number(adminUserId))) {
      uniqueUserIds.push(Number(adminUserId));
    }

    for (const uId of uniqueUserIds) {
      const role = (adminUserId && Number(uId) === Number(adminUserId)) ? 'admin' : 'member';
      await pool.execute(
        `INSERT INTO whatsapp_account_members (whatsapp_account_id, user_id, role)
         VALUES (?, ?, ?)`,
        [whatsappAccountId, uId, role]
      );
    }

    return this.getMembersByAccountId(whatsappAccountId);
  },

  async isMember(whatsappAccountId, userId) {
    const [rows] = await pool.execute(
      'SELECT id FROM whatsapp_account_members WHERE whatsapp_account_id = ? AND user_id = ? LIMIT 1',
      [whatsappAccountId, userId]
    );
    return rows.length > 0;
  }
};

module.exports = WhatsAppAccountMember;
