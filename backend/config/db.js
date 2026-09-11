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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        user_id INT NULL,
        created_by_id INT NULL,
        created_by_name VARCHAR(100) NULL,
        assigned_to_id INT NULL,
        assigned_by_id INT NULL,
        assigned_by_name VARCHAR(100) NULL
      );
    `);

    try {
      await connection.execute('ALTER TABLE tasks ADD COLUMN assigned_to_id INT NULL');
    } catch (e) {}
    try {
      await connection.execute('ALTER TABLE tasks ADD COLUMN assigned_by_id INT NULL');
    } catch (e) {}
    try {
      await connection.execute('ALTER TABLE tasks ADD COLUMN assigned_by_name VARCHAR(100) NULL');
    } catch (e) {}

    // Create whatsapp_calls table if not exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        call_id VARCHAR(100),
        phone_number VARCHAR(30) NOT NULL,
        customer_name VARCHAR(100),
        call_type ENUM('incoming', 'outgoing', 'missed') DEFAULT 'incoming',
        media_type ENUM('voice', 'video') DEFAULT 'voice',
        duration VARCHAR(30),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INT NULL
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
