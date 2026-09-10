const pool = require('../config/db');

const Task = {
  async findAll({ status, customerId, search } = {}) {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (customerId) {
      query += ' AND customer_id = ?';
      params.push(customerId);
    }

    if (search && search.trim()) {
      query += ' AND (customer_name LIKE ? OR customer_phone LIKE ? OR staff_note LIKE ? OR original_message LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(query, params);
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.execute('SELECT * FROM tasks WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async getCounts() {
    const [totalRows] = await pool.execute('SELECT COUNT(*) as count FROM tasks');
    const [pendingRows] = await pool.execute("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'");
    const [completedRows] = await pool.execute("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'");
    return {
      total: totalRows[0]?.count || 0,
      pending: pendingRows[0]?.count || 0,
      completed: completedRows[0]?.count || 0
    };
  },

  async create({ id, customerId, customerName, customerPhone, originalMessage, staffNote, dueDate, status = 'pending' }) {
    await pool.execute(
      `INSERT INTO tasks (id, customer_id, customer_name, customer_phone, original_message, staff_note, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customerId || null, customerName, customerPhone, originalMessage || '', staffNote || '', dueDate, status]
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
