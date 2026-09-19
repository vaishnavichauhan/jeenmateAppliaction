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

    try {
      await connection.query('SET SESSION sort_buffer_size = 67108864');
    } catch (_) {}
    try {
      await connection.query('SET GLOBAL sort_buffer_size = 67108864');
    } catch (_) {}

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
    try {
      await connection.execute('ALTER TABLE messages ADD INDEX idx_conv_time (conversation_id, whatsapp_timestamp)');
    } catch (e) {}
    try {
      await connection.execute("ALTER TABLE messages MODIFY COLUMN status ENUM('pending', 'sending', 'sent', 'delivered', 'read', 'failed') DEFAULT 'pending'");
    } catch (e) {}
    try {
      await connection.execute('ALTER TABLE conversations ADD COLUMN last_message_preview TEXT NULL');
    } catch (e) {}

    // Create internal_messages table if not exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS internal_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        message_text TEXT NULL,
        media_urls TEXT NULL,
        message_type VARCHAR(50) DEFAULT 'text',
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
      await connection.execute("ALTER TABLE internal_messages MODIFY COLUMN message_type VARCHAR(50) DEFAULT 'text'");
    } catch (e) {}
    try {
      await connection.execute('ALTER TABLE internal_messages MODIFY COLUMN message_text TEXT NULL');
    } catch (e) {}

    // Create whatsapp_accounts table if not exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_name VARCHAR(100) NOT NULL,
        phone_number VARCHAR(30) NULL,
        account_type ENUM('PERSONAL', 'TEAM') NOT NULL DEFAULT 'PERSONAL',
        owner_user_id INT NULL,
        created_by_user_id INT NOT NULL,
        session_id VARCHAR(100) NOT NULL UNIQUE,
        status VARCHAR(50) DEFAULT 'disconnected',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_owner (owner_user_id),
        INDEX idx_created_by (created_by_user_id),
        INDEX idx_account_type (account_type)
      );
    `);

    // Create whatsapp_account_members table if not exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_account_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        whatsapp_account_id INT NOT NULL,
        user_id INT NOT NULL,
        role ENUM('admin', 'member') DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_account_user (whatsapp_account_id, user_id),
        INDEX idx_account (whatsapp_account_id),
        INDEX idx_user (user_id)
      );
    `);

    try {
      await connection.execute('ALTER TABLE whatsapp_accounts ADD COLUMN whatsapp_name VARCHAR(100) NULL');
    } catch (e) {}

    // Add whatsapp_account_id column to existing WhatsApp data tables
    try {
      await connection.execute('ALTER TABLE customers ADD COLUMN whatsapp_account_id INT NULL');
      await connection.execute('ALTER TABLE customers ADD INDEX idx_wa_account (whatsapp_account_id)');
    } catch (e) {}

    try {
      await connection.execute('ALTER TABLE conversations ADD COLUMN whatsapp_account_id INT NULL');
      await connection.execute('ALTER TABLE conversations ADD INDEX idx_wa_account (whatsapp_account_id)');
    } catch (e) {}

    try {
      await connection.execute('ALTER TABLE messages ADD COLUMN whatsapp_account_id INT NULL');
      await connection.execute('ALTER TABLE messages ADD INDEX idx_wa_account (whatsapp_account_id)');
    } catch (e) {}

    try {
      await connection.execute('ALTER TABLE whatsapp_calls ADD COLUMN whatsapp_account_id INT NULL');
      await connection.execute('ALTER TABLE whatsapp_calls ADD INDEX idx_wa_account (whatsapp_account_id)');
    } catch (e) {}

    // Performance indexes
    const performanceIndexes = [
      'CREATE INDEX idx_msg_conv_wa_ts ON messages (conversation_id, whatsapp_timestamp, id)',
      'CREATE INDEX idx_msg_conv_created ON messages (conversation_id, created_at, id)',
      'CREATE INDEX idx_msg_acc_type ON messages (whatsapp_account_id, message_type)',
      'CREATE INDEX idx_conv_acc_pinned ON conversations (whatsapp_account_id, is_pinned, last_message_at)',
      'CREATE INDEX idx_tasks_user_status ON tasks (user_id, status)',
      'CREATE INDEX idx_tasks_assigned_status ON tasks (assigned_to_id, status)',
      'CREATE INDEX idx_calls_acc_created ON whatsapp_calls (whatsapp_account_id, created_at)',
      'CREATE INDEX idx_cust_phone_acc ON customers (phone_number, whatsapp_account_id)'
    ];
    for (const idxSql of performanceIndexes) {
      try {
        await connection.execute(idxSql);
      } catch (_) {}
    }

    // Auto-migrate legacy records: create personal accounts for existing users with data and assign whatsapp_account_id
    try {
      const [usersWithData] = await connection.execute(
        `SELECT DISTINCT user_id FROM conversations WHERE user_id IS NOT NULL AND (whatsapp_account_id IS NULL OR whatsapp_account_id = 0)
         UNION
         SELECT DISTINCT user_id FROM messages WHERE user_id IS NOT NULL AND (whatsapp_account_id IS NULL OR whatsapp_account_id = 0)`
      );

      for (const u of usersWithData) {
        if (!u.user_id) continue;
        const [existingAcc] = await connection.execute(
          'SELECT id FROM whatsapp_accounts WHERE owner_user_id = ? AND account_type = "PERSONAL" LIMIT 1',
          [u.user_id]
        );
        let accId;
        if (existingAcc.length > 0) {
          accId = existingAcc[0].id;
        } else {
          const [uRow] = await connection.execute('SELECT name FROM users WHERE id = ?', [u.user_id]);
          const uName = uRow[0]?.name || `User ${u.user_id}`;
          const sessId = `session-account-user-${u.user_id}-${Date.now()}`;
          const [ins] = await connection.execute(
            'INSERT INTO whatsapp_accounts (account_name, account_type, owner_user_id, created_by_user_id, session_id, status) VALUES (?, "PERSONAL", ?, ?, ?, "disconnected")',
            [`${uName}'s Personal WhatsApp`, u.user_id, u.user_id, sessId]
          );
          accId = ins.insertId;
        }

        if (accId) {
          await connection.execute('UPDATE conversations SET whatsapp_account_id = ? WHERE user_id = ? AND (whatsapp_account_id IS NULL OR whatsapp_account_id = 0)', [accId, u.user_id]);
          await connection.execute('UPDATE messages SET whatsapp_account_id = ? WHERE user_id = ? AND (whatsapp_account_id IS NULL OR whatsapp_account_id = 0)', [accId, u.user_id]);
          await connection.execute('UPDATE customers SET whatsapp_account_id = ? WHERE user_id = ? AND (whatsapp_account_id IS NULL OR whatsapp_account_id = 0)', [accId, u.user_id]);
          await connection.execute('UPDATE whatsapp_calls SET whatsapp_account_id = ? WHERE user_id = ? AND (whatsapp_account_id IS NULL OR whatsapp_account_id = 0)', [accId, u.user_id]);
        }
      }
    } catch (migErr) {
      console.warn('[DB] Migration note:', migErr.message);
    }

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
