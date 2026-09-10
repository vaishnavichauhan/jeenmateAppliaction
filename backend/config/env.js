const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  PORT: parseInt(process.env.PORT || '5001', 10),
  JWT_SECRET: process.env.JWT_SECRET || 'supersecretjwtkey_12345',
  NODE_ENV: process.env.NODE_ENV || 'development',

  // WhatsApp Session
  WHATSAPP_SESSION_PATH: path.resolve(__dirname, '..', process.env.WHATSAPP_SESSION_PATH || './sessions'),
  WHATSAPP_CLIENT_ID: process.env.WHATSAPP_CLIENT_ID || 'support-session',

  // MySQL Database
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'whatsapp_support',
  DB_PORT: parseInt(process.env.DB_PORT || '3306', 10),

  // SQLite fallback path if MySQL is unavailable
  DB_PATH: path.join(__dirname, '..', 'data', 'jeenmate.db'),
};
