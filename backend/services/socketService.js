let ioInstance = null;

function initSocket(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Join conversation room for real-time messaging
    socket.on('join_conversation', (conversationId) => {
      if (conversationId) {
        socket.join(`conv_${conversationId}`);
        console.log(`[Socket] Socket ${socket.id} joined room conv_${conversationId}`);
      }
    });

    // Leave conversation room
    socket.on('leave_conversation', (conversationId) => {
      if (conversationId) {
        socket.leave(`conv_${conversationId}`);
        console.log(`[Socket] Socket ${socket.id} left room conv_${conversationId}`);
      }
    });

    // Handle typing indicators
    socket.on('typing_start', ({ conversationId, staffName }) => {
      socket.to(`conv_${conversationId}`).emit('customer_typing', { conversationId, staffName });
    });

    socket.on('typing_stop', ({ conversationId }) => {
      socket.to(`conv_${conversationId}`).emit('customer_stopped_typing', { conversationId });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  return ioInstance;
}

function broadcastNewMessage(conversationId, message) {
  if (!ioInstance) return;
  // Emit to specific conversation room
  ioInstance.to(`conv_${conversationId}`).emit('new_message', { conversationId, message });
  // Also emit globally for conversation list previews
  ioInstance.emit('new_message', { conversationId, message });
}

function broadcastConversationUpdate(conversation) {
  if (!ioInstance) return;
  ioInstance.emit('conversation_updated', conversation);
}

function broadcastWhatsAppStatus(statusData) {
  if (!ioInstance) return;
  ioInstance.emit('whatsapp_status', statusData);
}

function broadcastWhatsAppQR(qrData) {
  if (!ioInstance) return;
  ioInstance.emit('whatsapp_qr', qrData);
}

module.exports = {
  initSocket,
  getIO,
  broadcastNewMessage,
  broadcastConversationUpdate,
  broadcastWhatsAppStatus,
  broadcastWhatsAppQR
};
