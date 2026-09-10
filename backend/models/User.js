const pool = require('../config/db');

const User = {
  async findByEmail(email) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await pool.execute('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async create({ name, email, password, role = 'agent' }) {
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email.trim().toLowerCase(), password, role]
    );
    return this.findById(result.insertId);
  }
};

module.exports = User;
