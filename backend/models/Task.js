const pool = require('../config/db');

const Task = {
  async findAll({ status, customerId, search, userId } = {}) {
    let query = `
      SELECT 
        t.*,
        u_assign.name as assigned_to_name,
        u_assign.email as assigned_to_email
      FROM tasks t
      LEFT JOIN users u_assign ON t.assigned_to_id = u_assign.id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ` AND (
        t.user_id = ? 
        OR t.assigned_by_id = ? 
        OR t.created_by_id = ?
        OR t.assigned_to_id = ?
      )`;
      params.push(userId, userId, userId, userId);
    }

    if (status && status !== 'all') {
      query += ' AND t.status = ?';
      params.push(status);
    }

    if (customerId) {
      query += ' AND t.customer_id = ?';
      params.push(customerId);
    }

    if (search && search.trim()) {
      query += ' AND (t.customer_name LIKE ? OR t.customer_phone LIKE ? OR t.staff_note LIKE ? OR t.original_message LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY t.created_at DESC';
    const [rows] = await pool.execute(query, params);
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.execute(
      `SELECT 
        t.*,
        u_assign.name as assigned_to_name,
        u_assign.email as assigned_to_email
       FROM tasks t
       LEFT JOIN users u_assign ON t.assigned_to_id = u_assign.id
       WHERE t.id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  async getCounts(userId) {
    if (!userId) {
      const [totalRows] = await pool.execute('SELECT COUNT(*) as count FROM tasks');
      const [pendingRows] = await pool.execute("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'");
      const [assignedRows] = await pool.execute("SELECT COUNT(*) as count FROM tasks WHERE assigned_to_id IS NOT NULL AND status != 'completed'");
      const [completedRows] = await pool.execute("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'");
      return {
        total: totalRows[0]?.count || 0,
        pending: pendingRows[0]?.count || 0,
        assigned: assignedRows[0]?.count || 0,
        completed: completedRows[0]?.count || 0
      };
    }

    const [pendingRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM tasks 
       WHERE user_id = ? AND status = 'pending'`,
      [userId]
    );

    const [assignedRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM tasks 
       WHERE (
         ((assigned_by_id = ? OR (created_by_id = ? AND assigned_to_id IS NOT NULL)) AND (user_id != ? OR assigned_to_id != ?))
         OR (user_id = ? AND (
           (assigned_by_id IS NOT NULL AND assigned_by_id != ?) OR 
           (created_by_id IS NOT NULL AND created_by_id != ?)
         ))
       )
       AND assigned_to_id IS NOT NULL
       AND status != 'completed'`,
      [userId, userId, userId, userId, userId, userId, userId]
    );

    const [completedRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM tasks 
       WHERE (user_id = ? OR assigned_by_id = ? OR created_by_id = ?) 
       AND status = 'completed'`,
      [userId, userId, userId]
    );

    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM tasks 
       WHERE user_id = ? 
          OR assigned_by_id = ? 
          OR created_by_id = ?
          OR assigned_to_id = ?`,
      [userId, userId, userId, userId]
    );

    return {
      total: totalRows[0]?.count || 0,
      pending: pendingRows[0]?.count || 0,
      assigned: assignedRows[0]?.count || 0,
      completed: completedRows[0]?.count || 0
    };
  },

  async create({ id, customerId, customerName, customerPhone, originalMessage, staffNote, dueDate, status = 'pending', userId, createdByName, assignedToUserId, eventType = 'Self' }) {
    const ownerUserId = assignedToUserId || userId || null;
    const assignedId = assignedToUserId || null;
    const assignedById = assignedToUserId ? (userId || null) : null;
    const assignedByName = assignedToUserId ? (createdByName || null) : null;

    await pool.execute(
      `INSERT INTO tasks (id, customer_id, customer_name, customer_phone, original_message, staff_note, due_date, status, user_id, created_by_id, created_by_name, assigned_to_id, assigned_by_id, assigned_by_name, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customerId || null, customerName, customerPhone, originalMessage || '', staffNote || '', dueDate, status, ownerUserId, userId || null, createdByName || null, assignedId, assignedById, assignedByName, eventType || 'Self']
    );
    return this.findById(id);
  },

  async assign(id, newUserId, assignedById, assignedByName) {
    const task = await this.findById(id);
    if (!task) return null;

    await pool.execute(
      'UPDATE tasks SET user_id = ?, assigned_to_id = ?, assigned_by_id = ?, assigned_by_name = ?, updated_at = NOW() WHERE id = ?',
      [newUserId, newUserId, assignedById || null, assignedByName || null, id]
    );
    return this.findById(id);
  },

  async toggle(id) {
    const task = await this.findById(id);
    if (!task) return null;
    const newStatus = task.status === 'pending' ? 'completed' : 'pending';
    await pool.execute('UPDATE tasks SET status = ? WHERE id = ?', [newStatus, id]);
    return this.findById(id);
  },

  async delete(id) {
    const task = await this.findById(id);
    if (!task) return false;
    await pool.execute('DELETE FROM tasks WHERE id = ?', [id]);
    return true;
  }
};

module.exports = Task;
