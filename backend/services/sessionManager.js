/**
 * WhatsApp Session Manager
 * Manages one WhatsAppService instance per user.
 * On logout → session is destroyed and session folder deleted (user must re-scan on next login).
 */

const WhatsAppService = require('./whatsappService');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');

class WhatsAppSessionManager {
  constructor() {
    // Map of userId (number) → WhatsAppService instance
    this.sessions = new Map();
  }

  /**
   * Get an existing session for a user, or create + initialize a new one.
   * @param {number} userId
   * @returns {WhatsAppService}
   */
  async getOrCreateSession(userId) {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId);
    }

    const service = new WhatsAppService(userId);
    this.sessions.set(userId, service);

    // Initialize in background (non-blocking)
    service.initialize().catch((err) => {
      console.error(`[SessionManager] Init error for user ${userId}:`, err.message);
    });

    return service;
  }

  /**
   * Get an existing session only (no auto-create).
   * Returns null if no session exists for this user.
   */
  getSession(userId) {
    return this.sessions.get(userId) || null;
  }

  /**
   * Destroy and remove a user's session completely.
   * Called on logout — deletes Chrome instance AND session folder (forces re-scan on next login).
   */
  async destroySession(userId) {
    const service = this.sessions.get(userId);
    if (service) {
      try {
        await service.destroy();
      } catch (e) {
        console.warn(`[SessionManager] Destroy error for user ${userId}:`, e.message);
      }
      this.sessions.delete(userId);
    }

    try {
      const pool = require('../config/db');
      await pool.execute('DELETE FROM whatsapp_calls WHERE user_id = ?', [userId]);
    } catch (_) {}

    // Always ensure the session folder on disk is completely erased on logout
    const sessionFolder = path.join(config.WHATSAPP_SESSION_PATH, `session-user-${userId}`);
    for (let i = 0; i < 3; i++) {
      if (!fs.existsSync(sessionFolder)) break;
      try {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
        console.log(`[SessionManager] Deleted session folder for user ${userId}`);
        break;
      } catch (err) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    console.log(`[SessionManager] Session for user ${userId} destroyed and expired.`);
  }

  /**
   * Destroy all user sessions (on server shutdown)
   */
  async destroyAll() {
    console.log(`[SessionManager] Destroying all active sessions (${this.sessions.size})...`);
    for (const [userId, service] of this.sessions.entries()) {
      try {
        if (service.client) {
          await service.client.destroy().catch(() => {});
        }
      } catch (e) {}
    }
    this.sessions.clear();
  }
}

// Singleton instance
const sessionManager = new WhatsAppSessionManager();
module.exports = sessionManager;
