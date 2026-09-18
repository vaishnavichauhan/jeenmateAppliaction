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

    // --- Internal Team Chat Sockets ---
    socket.on('join_internal_chat', ({ myUserId, targetUserId }) => {
      if (myUserId && targetUserId) {
        const room = getInternalRoom(myUserId, targetUserId);
        socket.join(room);
        console.log(`[Socket] ${socket.id} joined room ${room}`);
      }
    });

    socket.on('leave_internal_chat', ({ myUserId, targetUserId }) => {
      if (myUserId && targetUserId) {
        const room = getInternalRoom(myUserId, targetUserId);
        socket.leave(room);
        console.log(`[Socket] ${socket.id} left room ${room}`);
      }
    });

    socket.on('join_user_channel', (userId) => {
      if (userId) {
        socket.join(`user_channel_${userId}`);
        console.log(`[Socket] ${socket.id} joined user_channel_${userId}`);
      }
    });

    socket.on('internal_typing_start', ({ myUserId, targetUserId, userName }) => {
      if (myUserId && targetUserId) {
        const room = getInternalRoom(myUserId, targetUserId);
        socket.to(room).emit('internal_user_typing', { senderId: myUserId, userName });
      }
    });

    socket.on('internal_typing_stop', ({ myUserId, targetUserId }) => {
      if (myUserId && targetUserId) {
        const room = getInternalRoom(myUserId, targetUserId);
        socket.to(room).emit('internal_user_stopped_typing', { senderId: myUserId });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getInternalRoom(u1, u2) {
  const [min, max] = [Number(u1), Number(u2)].sort((a, b) => a - b);
  return `internal_chat_${min}_${max}`;
}

function getIO() {
  return ioInstance;
}

function broadcastInternalMessage(senderId, receiverId, message) {
  if (!ioInstance) return;
  const room = getInternalRoom(senderId, receiverId);
  // Send to active room participants
  ioInstance.to(room).emit('new_internal_message', message);
  // Also send to personal notification channels
  ioInstance.to(`user_channel_${receiverId}`).emit('internal_inbox_update', message);
  ioInstance.to(`user_channel_${senderId}`).emit('internal_inbox_update', message);
}

function broadcastNewMessage(conversationId, message) {
  if (!ioInstance) return;
  // Emit once to all connected clients (conversation rooms & conversation list)
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

function broadcastWhatsAppSyncStatus(syncData) {
  if (!ioInstance) return;
  ioInstance.emit('whatsapp_sync_status', syncData);
}

module.exports = {
  initSocket,
  getIO,
  broadcastNewMessage,
  broadcastConversationUpdate,
  broadcastWhatsAppStatus,
  broadcastWhatsAppQR,
  broadcastWhatsAppSyncStatus,
  broadcastInternalMessage,
  getInternalRoom
};
