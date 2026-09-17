const { InternalMessage, User } = require('../models');
const { broadcastInternalMessage } = require('../services/socketService');

const internalChatController = {
  // Get all registered team members with latest message summary and unread count
  async getColleagues(req, res, next) {
    try {
      const currentUserId = req.user.id;
      const colleagues = await InternalMessage.getColleaguesWithSummary(currentUserId);
      return res.status(200).json({
        success: true,
        data: colleagues
      });
    } catch (err) {
      console.error('[InternalChat] getColleagues error:', err.message);
      next(err);
    }
  },

  // Get message history with a specific colleague
  async getMessages(req, res, next) {
    try {
      const currentUserId = req.user.id;
      const targetUserId = req.params.targetUserId;
      const { limit, offset } = req.query;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          message: 'targetUserId is required'
        });
      }

      const messages = await InternalMessage.getConversation(
        currentUserId,
        targetUserId,
        limit,
        offset
      );

      // Auto mark messages from target user as read
      await InternalMessage.markAsRead(currentUserId, targetUserId);

      return res.status(200).json({
        success: true,
        data: messages
      });
    } catch (err) {
      console.error('[InternalChat] getMessages error:', err.message);
      next(err);
    }
  },

  // Send a new 1-to-1 message (supports optional text and up to 5 images)
  async sendMessage(req, res, next) {
    try {
      console.log('[InternalChat] sendMessage called. Body:', req.body, 'Files count:', req.files ? req.files.length : 0);
      const senderId = req.user.id;
      const { receiver_id, message_text } = req.body;
      const files = req.files || (req.file ? [req.file] : []);

      let media_urls = null;
      if (files && files.length > 0) {
        media_urls = files.map(f => `/uploads/internal_chat/${f.filename}`);
        console.log('[InternalChat] Uploaded media_urls:', media_urls);
      }

      const text = (message_text || '').trim();

      if (!receiver_id) {
        return res.status(400).json({
          success: false,
          message: 'receiver_id is required'
        });
      }

      if (!text && (!media_urls || media_urls.length === 0)) {
        return res.status(400).json({
          success: false,
          message: 'Either message_text or at least one image is required'
        });
      }

      if (Number(receiver_id) === Number(senderId)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot send internal message to yourself'
        });
      }

      // Check receiver exists
      const receiver = await User.findById(receiver_id);
      if (!receiver) {
        return res.status(404).json({
          success: false,
          message: 'Colleague not found'
        });
      }

      const messageType = media_urls && media_urls.length > 0 ? 'image' : 'text';

      const newMsg = await InternalMessage.create({
        sender_id: senderId,
        receiver_id: Number(receiver_id),
        message_text: text,
        media_urls,
        message_type: messageType
      });

      // Broadcast in real-time via Socket.IO
      broadcastInternalMessage(senderId, Number(receiver_id), newMsg);

      return res.status(201).json({
        success: true,
        data: newMsg
      });
    } catch (err) {
      console.error('[InternalChat] sendMessage error:', err.message);
      next(err);
    }
  },

  // Mark all unread messages from a colleague as read
  async markRead(req, res, next) {
    try {
      const currentUserId = req.user.id;
      const { sender_id } = req.body;

      if (!sender_id) {
        return res.status(400).json({
          success: false,
          message: 'sender_id is required'
        });
      }

      const affected = await InternalMessage.markAsRead(currentUserId, sender_id);
      return res.status(200).json({
        success: true,
        affected
      });
    } catch (err) {
      console.error('[InternalChat] markRead error:', err.message);
      next(err);
    }
  }
};

module.exports = internalChatController;
