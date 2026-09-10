const mysql = require('mysql2/promise');
const config = require('./env');

let pool = null;

try {
  pool = mysql.createPool({
    host: config.DB_HOST,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    port: config.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true
  });
  console.log(`[DB] MySQL Pool initialized: ${config.DB_USER}@${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}`);
} catch (err) {
  console.error('[DB] Failed to create MySQL pool:', err.message);
}

// Ensure tables exist in MySQL
async function initDb() {
  if (!pool) return;
  try {
    const connection = await pool.getConnection();

    // Create tasks table if not exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(64) PRIMARY KEY,
        customer_id VARCHAR(64),
        customer_name VARCHAR(100) NOT NULL,
        customer_phone VARCHAR(30) NOT NULL,
        original_message TEXT,
        staff_note TEXT,
        due_date VARCHAR(30),
        status ENUM('pending', 'completed') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // Verify admin user
    const [adminRows] = await connection.execute('SELECT id FROM users WHERE email = ?', ['admin@support.com']);
    if (adminRows.length === 0) {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync('Admin@12345', 10);
      await connection.execute(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        ['Support Admin', 'admin@support.com', hash, 'admin']
      );
      console.log('[DB] Admin user created in MySQL: admin@support.com / Admin@12345');
    }

    connection.release();
    console.log('[DB] MySQL schema ready.');
  } catch (err) {
    console.error('[DB] Schema init error:', err.message);
  }
}

initDb();

module.exports = pool;
