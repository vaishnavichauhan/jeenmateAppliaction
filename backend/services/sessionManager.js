/**
 * Multi-WhatsApp Session Manager
 * Manages independent WhatsAppService instances per WhatsApp Account (Personal or Team).
 * Supports simultaneous multi-session connections, individual disconnects, and clean deletion.
 */

const WhatsAppService = require('./whatsappService');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const pool = require('../config/db');

class WhatsAppSessionManager {
  constructor() {
    // Map of whatsappAccountId (number) → WhatsAppService instance
    this.sessions = new Map();
  }

  /**
   * Get an existing session for a WhatsApp Account, or create + initialize a new one.
   * @param {number} whatsappAccountId
   * @param {object} accountObj (optional)
   * @returns {Promise<WhatsAppService>}
   */
  async getOrCreateSession(whatsappAccountId, accountObj = null) {
    const accId = Number(whatsappAccountId);
    if (this.sessions.has(accId)) {
      return this.sessions.get(accId);
    }

    let account = accountObj;
    if (!account) {
      const [rows] = await pool.execute(
        'SELECT * FROM whatsapp_accounts WHERE id = ?',
        [accId]
      );
      account = rows[0] || null;
    }

    if (!account) {
      throw new Error(`WhatsApp Account #${accId} not found in database.`);
    }

    const service = new WhatsAppService(account);
    this.sessions.set(accId, service);

    // Initialize in background (non-blocking)
    service.initialize().catch((err) => {
      console.error(`[SessionManager] Init error for WhatsApp Account ${accId}:`, err.message);
    });

    return service;
  }

  /**
   * Get an existing active session only (no auto-create).
   * @param {number} whatsappAccountId
   * @returns {WhatsAppService | null}
   */
  getSession(whatsappAccountId) {
    const accId = Number(whatsappAccountId);
    return this.sessions.get(accId) || null;
  }

  /**
   * Disconnect or Delete a WhatsApp account session.
   * - If deleteAccount === false (Disconnect):
   *     Stops WhatsApp client, deletes session folder, clears account's WhatsApp data from DB,
   *     sets account status to 'disconnected', clears phone_number, but PRESERVES the account & members.
   * - If deleteAccount === true (Delete):
   *     Stops client, deletes session folder, completely deletes the account row and its members.
   */
  async destroySession(whatsappAccountId, { cleanData = true, deleteAccount = false } = {}) {
    const accId = Number(whatsappAccountId);
    const service = this.sessions.get(accId);

    if (service) {
      try {
        await service.destroy(cleanData);
      } catch (e) {
        console.warn(`[SessionManager] Destroy error for WhatsApp Account ${accId}:`, e.message);
      }
      this.sessions.delete(accId);
    }

    if (cleanData) {
      try {
        await pool.execute('DELETE FROM messages WHERE whatsapp_account_id = ?', [accId]);
        await pool.execute('DELETE FROM conversations WHERE whatsapp_account_id = ?', [accId]);
        await pool.execute('DELETE FROM whatsapp_calls WHERE whatsapp_account_id = ?', [accId]);
        await pool.execute('DELETE FROM customers WHERE whatsapp_account_id = ?', [accId]);
      } catch (dbErr) {
        console.warn(`[SessionManager] DB clean error for Account ${accId}:`, dbErr.message);
      }
    }

    if (deleteAccount) {
      try {
        await pool.execute('DELETE FROM whatsapp_account_members WHERE whatsapp_account_id = ?', [accId]);
        await pool.execute('DELETE FROM whatsapp_accounts WHERE id = ?', [accId]);
      } catch (delErr) {
        console.warn(`[SessionManager] Account delete error for Account ${accId}:`, delErr.message);
      }
    } else {
      // Just disconnected: reset account state in DB so it can be re-linked with a new QR
      try {
        await pool.execute(
          'UPDATE whatsapp_accounts SET status = "disconnected", phone_number = NULL, whatsapp_name = NULL WHERE id = ?',
          [accId]
        );
      } catch (_) {}
    }

    // Erase session directory for this account
    const sessionFolder = path.join(config.WHATSAPP_SESSION_PATH, `session-account-${accId}`);
    for (let i = 0; i < 3; i++) {
      if (!fs.existsSync(sessionFolder)) break;
      try {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
        console.log(`[SessionManager] Deleted session folder for Account ${accId}`);
        break;
      } catch (err) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    console.log(`[SessionManager] Session for Account ${accId} destroyed (deleteAccount=${deleteAccount}).`);
  }

  /**
   * Restart an account session and generate fresh QR
   */
  async restartSession(whatsappAccountId, clean = true) {
    const accId = Number(whatsappAccountId);
    await this.destroySession(accId, { cleanData: clean, deleteAccount: false });
    return this.getOrCreateSession(accId);
  }

  /**
   * Get QR status
   */
  async getStatus(whatsappAccountId) {
    const accId = Number(whatsappAccountId);
    const service = this.sessions.get(accId);
    if (service) {
      return service.getStatus();
    }
    const [rows] = await pool.execute('SELECT status, phone_number, whatsapp_name FROM whatsapp_accounts WHERE id = ?', [accId]);
    const acc = rows[0];
    return {
      status: acc ? acc.status : 'disconnected',
      isConnected: acc?.status === 'online',
      phone: acc?.phone_number || null,
      name: acc?.whatsapp_name || null,
      accountId: accId,
    };
  }

  async getQr(whatsappAccountId) {
    const accId = Number(whatsappAccountId);
    const service = await this.getOrCreateSession(accId);
    return service.getQr();
  }

  /**
   * Automatically restore sessions for accounts marked online or configured
   */
  async autoRestoreSessions() {
    try {
      const [rows] = await pool.execute(
        "SELECT * FROM whatsapp_accounts WHERE status = 'online' OR phone_number IS NOT NULL"
      );
      if (rows.length > 0) {
        console.log(`[SessionManager] Auto-restoring ${rows.length} active WhatsApp session(s)...`);
        for (const account of rows) {
          this.getOrCreateSession(account.id, account).catch((err) => {
            console.warn(`[SessionManager] Auto-restore error for Account ${account.id}:`, err.message);
          });
        }
      }
    } catch (err) {
      console.warn('[SessionManager] Auto-restore query failed:', err.message);
    }
  }

  /**
   * Destroy all active sessions on server shutdown
   */
  async destroyAll() {
    console.log(`[SessionManager] Destroying all active sessions (${this.sessions.size})...`);
    for (const [accId, service] of this.sessions.entries()) {
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
