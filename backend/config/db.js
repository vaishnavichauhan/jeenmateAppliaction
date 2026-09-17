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
        assigned_by_name VARCHAR(100) NULL,
        event_type ENUM('PhoneCall', 'WhatsappCall', 'WhatsappChat', 'JeenmateChat', 'Self') DEFAULT 'Self'
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
    try {
      await connection.execute("ALTER TABLE tasks ADD COLUMN event_type ENUM('PhoneCall', 'WhatsappCall', 'WhatsappChat', 'JeenmateChat', 'Self') DEFAULT 'Self'");
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
        user_id INT NULL,
        account_phone VARCHAR(30) NULL
      );
    `);

    try {
      await connection.execute('ALTER TABLE whatsapp_calls ADD COLUMN account_phone VARCHAR(30) NULL');
    } catch (e) {}
    try {
      await connection.execute('ALTER TABLE whatsapp_calls ADD COLUMN raw_call TEXT NULL');
    } catch (e) {}
    try {
      await connection.execute('ALTER TABLE messages ADD COLUMN metadata JSON NULL');
    } catch (e) {}
    try {
      await connection.execute("ALTER TABLE messages ADD COLUMN message_type VARCHAR(50) DEFAULT 'text'");
    } catch (e) {}

    // Create internal_messages table if not exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS internal_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        message_text TEXT NULL,
        media_urls TEXT NULL,
        message_type ENUM('text', 'image', 'media') DEFAULT 'text',
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sender_receiver (sender_id, receiver_id),
        INDEX idx_receiver_read (receiver_id, is_read)
      );
    `);

    try {
      await connection.execute('ALTER TABLE internal_messages ADD COLUMN media_urls TEXT NULL');
    } catch (e) {}
    try {
      await connection.execute("ALTER TABLE internal_messages ADD COLUMN message_type ENUM('text', 'image', 'media') DEFAULT 'text'");
    } catch (e) {}
    try {
      await connection.execute('ALTER TABLE internal_messages MODIFY COLUMN message_text TEXT NULL');
    } catch (e) {}

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
