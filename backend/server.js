const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const os = require('os');
const config = require('./config/env');
const db = require('./config/db'); // Ensures SQLite is initialized & seeded
const routes = require('./routes');
const socketService = require('./services/socketService');
const sessionManager = require('./services/sessionManager');
const errorHandler = require('./middlewares/errorHandler');

const path = require('path');
const app = express();
const server = http.createServer(app);

// Enable CORS for mobile apps and web clients
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-whatsapp-account-id']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploaded files (chat images, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request logger
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Setup Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
socketService.initSocket(io);

// Mount API routes
app.use('/api', routes);

// Global Error Handler
app.use(errorHandler);

// Helper to get local network IP addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// Start Server
const PORT = config.PORT;
server.listen(PORT, '0.0.0.0', () => {
  const localIps = getLocalIpAddresses();
  console.log('====================================================');
  console.log(`🚀 jeenMate Backend Server Running on Port ${PORT}`);
  console.log(`📍 Local:            http://localhost:${PORT}`);
  localIps.forEach(ip => {
    console.log(`📱 LAN (Mobile App): http://${ip}:${PORT}`);
  });
  console.log(`💬 QR Web Page:     http://localhost:${PORT}/api/whatsapp/qr-page`);
  console.log(`🔑 Default Admin:    admin@support.com / Admin@12345`);
  console.log('====================================================');
});

// Graceful shutdown
async function gracefulShutdown() {
  console.log('[Server] Shutdown requested. Closing all user WhatsApp sessions...');
  try {
    await sessionManager.destroyAll();
  } catch (e) {}
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason?.message || reason);
});
