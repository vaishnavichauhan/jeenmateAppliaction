const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const pool = require('../config/db');
const socketService = require('./socketService');
const { Conversation, Message } = require('../models');

class WhatsAppService {
  /**
   * @param {number} userId - The DB user id this session belongs to.
   */
  constructor(userId) {
    this.userId = userId;
    this.client = null;
    this.status = 'offline'; // 'offline' | 'waiting' | 'online'
    this.isConnected = false;
    this.botPhone = null;
    this.botName = null;
    this.latestQrString = null;
    this.latestQrDataUrl = null;
    this.lastUpdated = new Date().toISOString();
    this.isInitializing = false;
  }

  getExecutablePath() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }

    // Default paths on macOS
    const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(macChrome)) {
      return macChrome;
    }

    // Default paths on Linux / Docker
    const linuxPaths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];

    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }

    return undefined;
  }

  async initialize() {
    if (this.isInitializing) return;
    this.isInitializing = true;
    console.log('[WhatsApp] Initializing WhatsApp Web Client...');

    try {
      const clientId = `user-${this.userId}`;
      const sessionDir = path.join(config.WHATSAPP_SESSION_PATH, `session-${clientId}`);
      this.cleanSingletonLocks(sessionDir);

      const executablePath = this.getExecutablePath();
      console.log(`[WhatsApp:${this.userId}] Using Chrome executable: ${executablePath || 'Puppeteer default'}`);
      console.log(`[WhatsApp:${this.userId}] Session path: ${sessionDir}`);

      if (!fs.existsSync(config.WHATSAPP_SESSION_PATH)) {
        fs.mkdirSync(config.WHATSAPP_SESSION_PATH, { recursive: true });
      }

      const puppeteerOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
      };

      if (executablePath) {
        puppeteerOptions.executablePath = executablePath;
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: config.WHATSAPP_SESSION_PATH,
          clientId: `user-${this.userId}`
        }),
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-js/main/dist/wppconnect-wa.js'
        },
        puppeteer: puppeteerOptions
      });

      this.setupEventListeners();
      await this.client.initialize();
    } catch (err) {
      console.error('[WhatsApp] Initialization error:', err.message);
      this.status = 'offline';
      this.isConnected = false;
      this.broadcastCurrentStatus();
    } finally {
      this.isInitializing = false;
    }
  }

  cleanSingletonLocks(sessionDir) {
    if (fs.existsSync(sessionDir)) {
      ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
        try {
          const p = path.join(sessionDir, f);
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log(`[WhatsApp] Cleaned stale lock file: ${f}`);
          }
        } catch (_) { }
      });
    }
  }

  setupEventListeners() {
    if (!this.client) return;

    // QR Event
    this.client.on('qr', async (qr) => {
      console.log(`\n[WhatsApp:${this.userId}] QR ready — user must scan to link WhatsApp.`);
      try {
        qrcode.toString(qr, { type: 'terminal', small: true }, (err, str) => {
          if (!err && str) {
            console.log(str);
          }
        });
      } catch (_) { }

      this.status = 'waiting';
      this.isConnected = false;
      this.latestQrString = qr;
      this.lastUpdated = new Date().toISOString();

      try {
        this.latestQrDataUrl = await qrcode.toDataURL(qr, {
          width: 320,
          margin: 2,
          color: {
            dark: '#16325B',
            light: '#FFFFFF'
          }
        });
      } catch (err) {
        console.error('[WhatsApp] QR DataURL generation error:', err);
      }

      socketService.broadcastWhatsAppQR({
        qr: this.latestQrDataUrl,
        raw: this.latestQrString,
        timestamp: this.lastUpdated
      });

      this.broadcastCurrentStatus();
    });

    // Authenticated Event
    this.client.on('authenticated', async () => {
      console.log(`[WhatsApp:${this.userId}] Authenticated.`);
      this.status = 'online';
      this.isConnected = true;
      this.latestQrString = null;
      this.latestQrDataUrl = null;
      this.lastUpdated = new Date().toISOString();
      this.broadcastCurrentStatus();

      // Dismiss any 'What's new' or 'Continue' dialogs automatically
      if (this.client && this.client.pupPage) {
        try {
          await this.client.pupPage.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const continueBtn = btns.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'continue');
            if (continueBtn) continueBtn.click();
          }).catch(() => { });
        } catch (_) { }
      }
    });

    // Auth Failure Event
    this.client.on('auth_failure', (msg) => {
      console.error('[WhatsApp] Authentication failure:', msg);
      this.status = 'offline';
      this.isConnected = false;
      this.broadcastCurrentStatus();
    });

    // Ready Event
    this.client.on('ready', () => {
      console.log(`[WhatsApp:${this.userId}] Client Ready!`);
      this.status = 'online';
      this.isConnected = true;
      this.latestQrString = null;
      this.latestQrDataUrl = null;
      this.lastUpdated = new Date().toISOString();

      if (this.client.info) {
        this.botPhone = this.client.info.wid ? this.client.info.wid.user : null;
        this.botName = this.client.info.pushname || 'JeenMate WhatsApp Staff';
      }

      this.broadcastCurrentStatus();

      // Auto-sync chats for this user
      setTimeout(() => {
        this.syncChats({ cleanOld: false }).catch(err => {
          console.error(`[WhatsApp:${this.userId}] Auto-sync error:`, err.message);
        });
      }, 2000);
    });

    // Disconnected Event
    this.client.on('disconnected', async (reason) => {
      console.log(`[WhatsApp:${this.userId}] Disconnected:`, reason);
      this.status = 'offline';
      this.isConnected = false;
      this.botPhone = null;
      this.botName = null;
      this.latestQrString = null;
      this.latestQrDataUrl = null;
      this.lastUpdated = new Date().toISOString();
      await this.purgeUserWhatsAppData();
      this.broadcastCurrentStatus();
    });

    // Message Create Event (catches both incoming & outgoing messages from phone)
    this.client.on('message_create', async (msg) => {
      try {
        await this.handleIncomingMessage(msg);
      } catch (err) {
        console.error('[WhatsApp] Error handling message_create:', err);
      }
    });

    // Call Event (catches incoming, outgoing, voice & video calls)
    this.client.on('call', async (call) => {
      try {
        console.log('[WhatsApp] Live Call event:', call);
        const fromMe = !!call.fromMe;
        const targetJid = fromMe
          ? (call.to || call.peerJid || (call.id && typeof call.id === 'object' ? call.id.remote : null) || call._data?.to || call._data?.peerJid)
          : (call.from || call.peerJid || (call.id && typeof call.id === 'object' ? call.id.remote : null) || call._data?.from || call._data?.peerJid);
        if (!targetJid) return;

        const rawNumber = String(targetJid).replace('@c.us', '').replace('@lid', '').split(':')[0];
        const phoneNumber = rawNumber.startsWith('+') ? rawNumber : `+${rawNumber}`;
        const mediaType = call.isVideo ? 'video' : 'voice';
        const callType = fromMe ? 'outgoing' : 'incoming';
        const callStatus = 'unknown'; // Live event is ringing/started - status is unknown until historical sync or call completion

        let customerName = phoneNumber;
        try {
          const [cust] = await pool.execute(
            `SELECT name FROM customers 
             WHERE (REPLACE(REPLACE(phone_number, '+', ''), ' ', '') = ? OR whatsapp_jid LIKE ?) 
               AND (user_id = ? OR user_id IS NULL) 
             LIMIT 1`,
            [rawNumber, `%${rawNumber}%`, this.userId]
          );
          if (cust.length > 0 && cust[0].name) {
            customerName = cust[0].name;
          } else {
            const contact = await this.client.getContactById(targetJid);
            if (contact && (contact.name || contact.pushname)) {
              customerName = contact.name || contact.pushname;
            }
          }
        } catch (_) { }

        const safeCallId = (call.id && typeof call.id === 'string')
          ? call.id
          : ((call.id && typeof call.id === 'object' && call.id._serialized)
              ? call.id._serialized
              : ((call.id && typeof call.id === 'object' && call.id.id)
                  ? call.id.id
                  : `call_evt_${Date.now()}`));

        const rawCallJson = JSON.stringify({
          id: safeCallId,
          from: targetJid,
          timestamp: call.timestamp || Math.floor(Date.now() / 1000),
          isGroup: !!call.isGroup,
          isVideo: !!call.isVideo,
          isVideoCall: !!call.isVideo,
          fromMe: fromMe,
          raw: call
        });

        // Upsert into whatsapp_calls table
        const [existingCalls] = await pool.execute(
          'SELECT id FROM whatsapp_calls WHERE call_id = ? AND user_id = ? LIMIT 1',
          [safeCallId, this.userId]
        );

        if (existingCalls.length > 0) {
          await pool.execute(
            `UPDATE whatsapp_calls 
             SET phone_number = ?, customer_name = ?, call_type = ?, media_type = ?, raw_call = ?
             WHERE id = ?`,
            [phoneNumber, customerName, callType, mediaType, rawCallJson, existingCalls[0].id]
          );
        } else {
          await pool.execute(
            `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, raw_call, created_at, user_id, account_phone)
             VALUES (?, ?, ?, ?, ?, NULL, ?, NOW(), ?, ?)`,
            [safeCallId, phoneNumber, customerName, callType, mediaType, rawCallJson, this.userId, this.botPhone || null]
          );
        }
        console.log(`[WhatsApp:${this.userId}] Saved provisional live call log: ${callType} ${mediaType} call for ${customerName}`);

        // Insert or update provisional call message in conversation timeline & emit live Socket.IO update
        const callMsgText = mediaType === 'video'
          ? (fromMe ? '📹 Outgoing video call' : '📹 Video call')
          : (fromMe ? '📞 Outgoing voice call' : '📞 Voice call');

        try {
          const targetJidClean = String(targetJid).replace('@c.us', '').replace('@lid', '').split(':')[0];
          const [cust] = await pool.execute(
            'SELECT id FROM customers WHERE user_id = ? AND (phone_number = ? OR whatsapp_jid LIKE ?) LIMIT 1',
            [this.userId, phoneNumber, `%${targetJidClean}%`]
          );
          if (cust.length > 0) {
            const customerId = cust[0].id;
            const [conv] = await pool.execute(
              'SELECT id FROM conversations WHERE customer_id = ? AND user_id = ? LIMIT 1',
              [customerId, this.userId]
            );
            if (conv.length > 0) {
              const convId = conv[0].id;
              const nowMs = Date.now();
              const utcStr = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
              const metadataObj = {
                isCall: true,
                status: callStatus,
                callType: callType,
                mediaType: mediaType,
                duration: null,
                whatsappCallId: safeCallId
              };
              const metadataJson = JSON.stringify(metadataObj);

              // Check if provisional or exact call message already exists
              const coreCallId = (safeCallId && safeCallId.includes('_')) ? safeCallId.split('_').pop() : safeCallId;
              const [existMsg] = await pool.execute(
                `SELECT id, whatsapp_message_id, metadata FROM messages 
                 WHERE conversation_id = ? AND user_id = ? AND (
                   whatsapp_message_id = ? OR 
                   JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) = ? OR
                   (LENGTH(?) >= 8 AND (whatsapp_message_id LIKE CONCAT('%', ?, '%') OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) LIKE CONCAT('%', ?, '%')))
                 ) 
                 ORDER BY id DESC LIMIT 1`,
                [convId, this.userId, safeCallId, safeCallId, coreCallId || '', coreCallId || '', coreCallId || '']
              );

              let savedMsgId = null;
              if (existMsg.length > 0) {
                savedMsgId = existMsg[0].id;
                await pool.execute(
                  `UPDATE messages 
                   SET whatsapp_message_id = ?, message_type = 'call', message = ?, whatsapp_timestamp = ?, metadata = ?
                   WHERE id = ?`,
                  [safeCallId, callMsgText, nowMs, metadataJson, savedMsgId]
                );
              } else {
                const [insertMsg] = await pool.execute(
                  `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
                   VALUES (?, ?, ?, ?, ?, 'call', ?, 'delivered', ?, ?, ?)`,
                  [convId, customerId, fromMe ? 'outgoing' : 'incoming', callMsgText, safeCallId, nowMs, utcStr, this.userId, metadataJson]
                );
                savedMsgId = insertMsg.insertId;
              }

              await pool.execute(
                'UPDATE conversations SET last_message_at = ? WHERE id = ?',
                [utcStr, convId]
              );

              const Message = require('../models/Message');
              const Conversation = require('../models/Conversation');
              const savedMsg = await Message.findById(savedMsgId);
              const updatedConv = await Conversation.findById(convId);
              socketService.broadcastNewMessage(convId, savedMsg);
              socketService.broadcastConversationUpdate(updatedConv);
            }
          }
        } catch (chatErr) {
          console.warn(`[WhatsApp:${this.userId}] Error adding call chat message:`, chatErr.message);
        }
      } catch (err) {
        console.error('[WhatsApp] Error handling call event:', err.message);
      }
    });
  }

  async handleIncomingMessage(msg) {
    if (!msg || msg.isStatus || msg.isNotification) {
      return;
    }

    const mType = String(msg.type || 'chat').toLowerCase();
    if (mType === 'e2e_notification' || mType === 'notification_template' || mType === 'protocol' || mType === 'gp2') {
      return;
    }

    const fromMe = !!msg.fromMe;
    const targetJid = fromMe ? msg.to : msg.from;
    if (!targetJid || targetJid.includes('@g.us') || targetJid.includes('@newsletter')) {
      return;
    }

    const rawNumber = targetJid.replace('@c.us', '').replace('@lid', '');
    const phoneNumber = rawNumber.startsWith('+') ? rawNumber : `+${rawNumber}`;
    let text = msg.body || '';
    const subTypeStr = String(msg.subtype || (msg._data && msg._data.subtype) || '').toLowerCase();
    const bodyStr = String(text || (msg._data && msg._data.body) || '').toLowerCase();
    const callTypeStr = String(msg.callType || (msg._data && msg._data.callType) || '').toLowerCase();

    const isExplicitCallBody = bodyStr === '[call_log]' || bodyStr === 'call' || bodyStr === 'voice call' || bodyStr === 'video call' || bodyStr === 'missed voice call' || bodyStr === 'missed video call' || bodyStr.startsWith('📞') || bodyStr.startsWith('📹');
    const isCallLog = mType === 'call_log' || mType === 'call' || subTypeStr.includes('call_log') || subTypeStr.includes('video_call') || subTypeStr.includes('voice_call') || subTypeStr.includes('missed_call') || callTypeStr.includes('call') || !!msg.call || (subTypeStr === 'call' && isExplicitCallBody);

    const isVideoCall = isCallLog && (
      !!msg.isVideo ||
      !!msg.isVideoCall ||
      !!(msg.call && (msg.call.isVideo || msg.call.isVideoCall)) ||
      !!(msg._data && (msg._data.isVideo || msg._data.isVideoCall)) ||
      callTypeStr.includes('video') ||
      subTypeStr.includes('video') ||
      bodyStr.includes('📹') ||
      (isCallLog && bodyStr.includes('video'))
    );

    const isMissedCall = isCallLog && (
      !!msg.isMissed ||
      !!msg.isMissedCall ||
      !!(msg.call && (msg.call.isMissed || msg.call.isMissedCall)) ||
      !!(msg._data && (msg._data.isMissed || msg._data.isMissedCall)) ||
      subTypeStr.includes('missed') ||
      bodyStr.includes('missed') ||
      bodyStr.includes('no answer') ||
      bodyStr.includes('tap to call back')
    );

    const isAlbum = mType === 'album' || msg.isAlbum;

    if (isCallLog) {
      text = isVideoCall ? (isMissedCall ? '📹 Missed video call' : '📹 Video call') : (isMissedCall ? '📞 Missed voice call' : '📞 Voice call');
    } else if (isAlbum) {
      text = msg.caption || 'Album';
    } else if (mType === 'video' || msg.isVideo || (msg._data && msg._data.isVideo)) {
      text = msg.caption || (msg.body && !msg.body.startsWith('/9j/') && msg.body !== 'Images' ? msg.body : 'Video');
    } else if (mType === 'image') {
      text = msg.caption || (msg.body && !msg.body.startsWith('/9j/') ? msg.body : 'Images');
    } else if (mType === 'audio' || mType === 'ptt') {
      text = 'Voice message';
    } else if (!text && msg.hasMedia) {
      text = (mType === 'video' || msg.isVideo) ? 'Video' : 'Images';
    }

    let contactName = phoneNumber;
    try {
      const contact = fromMe ? await this.client.getContactById(targetJid) : await msg.getContact();
      if (contact && (contact.name || contact.pushname)) {
        contactName = contact.name || contact.pushname;
      }
    } catch (e) { }

    const isBadName = !contactName || contactName === phoneNumber || contactName.toLowerCase() === 'vaishnavi';
    const userId = this.userId;

    // Find or create customer in MySQL (scoped to this user)
    let customerId = null;
    const [custRows] = await pool.execute(
      'SELECT id, name FROM customers WHERE user_id = ? AND (phone_number = ? OR whatsapp_jid = ?) LIMIT 1',
      [userId, phoneNumber, targetJid]
    );

    if (custRows.length > 0) {
      customerId = custRows[0].id;
      if (!isBadName && (custRows[0].name === phoneNumber || custRows[0].name.toLowerCase() === 'vaishnavi')) {
        await pool.execute('UPDATE customers SET name = ? WHERE id = ?', [contactName, customerId]);
      }
    } else {
      const initialName = !isBadName ? contactName : phoneNumber;
      const [insertCust] = await pool.execute(
        'INSERT INTO customers (phone_number, name, whatsapp_jid, user_id) VALUES (?, ?, ?, ?)',
        [phoneNumber, initialName, targetJid, userId]
      );
      customerId = insertCust.insertId;
    }

    // Find or create conversation in MySQL (scoped to this user)
    let convId = null;
    const [convRows] = await pool.execute(
      'SELECT id, unread_count FROM conversations WHERE customer_id = ? AND user_id = ? LIMIT 1',
      [customerId, userId]
    );

    const msgTime = (msg.timestamp && typeof msg.timestamp === 'number') ? msg.timestamp * 1000 : Date.now();
    const utcStr = new Date(msgTime).toISOString().slice(0, 19).replace('T', ' ');

    const unreadIncrement = fromMe ? 0 : 1;
    if (convRows.length > 0) {
      convId = convRows[0].id;
      await pool.execute(
        'UPDATE conversations SET unread_count = unread_count + ?, last_message_at = ? WHERE id = ?',
        [unreadIncrement, utcStr, convId]
      );
    } else {
      const [insertConv] = await pool.execute(
        'INSERT INTO conversations (customer_id, status, last_message_at, unread_count, user_id) VALUES (?, "open", ?, ?, ?)',
        [customerId, utcStr, unreadIncrement, userId]
      );
      convId = insertConv.insertId;
    }

    // Insert message — guard against duplicates by whatsapp_message_id or content match
    const direction = fromMe ? 'outgoing' : 'incoming';
    const safeText = typeof text === 'string' ? text : String(text || '');
    const safeMsgId = (msg.id && msg.id._serialized) ? msg.id._serialized : (typeof msg.id === 'string' ? msg.id : null);

    // Deduplicate strictly by user_id + conversation_id + whatsapp_message_id (with deterministic fallback only if ID is missing)
    let existCheck = [];
    if (safeMsgId) {
      [existCheck] = await pool.execute(
        'SELECT id, whatsapp_message_id, message FROM messages WHERE user_id = ? AND conversation_id = ? AND whatsapp_message_id = ? LIMIT 1',
        [userId, convId, safeMsgId]
      );
    } else {
      [existCheck] = await pool.execute(
        'SELECT id, whatsapp_message_id, message FROM messages WHERE user_id = ? AND conversation_id = ? AND direction = ? AND whatsapp_timestamp = ? AND message = ? LIMIT 1',
        [userId, convId, direction, msgTime, safeText]
      );
    }

    if (existCheck.length > 0) {
      const existingMsg = existCheck[0];
      if (!existingMsg.whatsapp_message_id && safeMsgId) {
        await pool.execute('UPDATE messages SET whatsapp_message_id = ?, whatsapp_timestamp = ? WHERE id = ?', [safeMsgId, msgTime, existingMsg.id]);
      }
      if (safeText === 'Video' && existingMsg.message === 'Images') {
        await pool.execute('UPDATE messages SET message = ? WHERE id = ?', ['Video', existingMsg.id]);
      }
      return;
    }

    const [insertMsg] = await pool.execute(
      `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id)
       VALUES (?, ?, ?, ?, ?, 'text', ?, 'delivered', ?, ?)`,
      [convId, customerId, direction, safeText, safeMsgId, msgTime, utcStr, userId]
    );

    const savedMsg = await Message.findById(insertMsg.insertId);
    const updatedConv = await Conversation.findById(convId);

    // Emit live Socket.IO events
    socketService.broadcastNewMessage(convId, savedMsg);
    socketService.broadcastConversationUpdate(updatedConv);
    console.log(`[WhatsApp] ${direction === 'outgoing' ? 'Sent to' : 'Received from'} ${contactName} (${phoneNumber}): "${text}"`);
  }

  async sendMessage(phoneNumber, text) {
    if (!this.isConnected || !this.client) {
      console.warn('[WhatsApp] Client not connected. Message saved locally.');
      return { success: false, offlineSaved: true };
    }

    try {
      const sanitized = phoneNumber.replace(/[^0-9]/g, '');
      const chatId = `${sanitized}@c.us`;
      const result = await this.client.sendMessage(chatId, text);
      const rawId = result?.id ? (result.id.id || result.id._serialized || (typeof result.id === 'string' ? result.id : null)) : null;
      const cleanId = (rawId && rawId.includes('_')) ? rawId.split('_').pop() : rawId;
      return { 
        success: true, 
        messageId: cleanId || rawId,
        serializedId: result?.id?._serialized || cleanId || rawId
      };
    } catch (err) {
      console.error('[WhatsApp] Send error:', err.message);
      return { success: false, error: err.message };
    }
  }

  async refreshQr() {
    if (!this.client || !this.client.pupPage || this.isConnected) {
      return false;
    }
    try {
      console.log('[WhatsApp] Attempting to refresh QR code on page...');
      const clicked = await this.client.pupPage.evaluate(() => {
        const reloadBtn = document.querySelector('button[aria-label*="reload" i], button[aria-label*="QR" i], div[data-ref] button, [data-ref] span[role="button"]');
        if (reloadBtn) {
          reloadBtn.click();
          return true;
        }
        const canvas = document.querySelector('canvas');
        if (canvas && canvas.parentElement) {
          canvas.parentElement.click();
          return true;
        }
        return false;
      });
      if (clicked) {
        console.log('[WhatsApp] Clicked QR reload button on WhatsApp Web.');
        return true;
      }
    } catch (e) {
      console.warn('[WhatsApp] refreshQr error:', e.message);
    }
    return false;
  }

  /**
   * Purge all WhatsApp messages, conversations, calls, and customer records for THIS user only.
   */
  async purgeUserWhatsAppData() {
    console.log(`[WhatsApp:${this.userId}] Purging user WhatsApp database records...`);
    try {
      // 1. Delete all messages for this user (both by user_id and by conversation_id)
      await pool.execute(
        `DELETE FROM messages 
         WHERE user_id = ? 
            OR conversation_id IN (SELECT id FROM (SELECT id FROM conversations WHERE user_id = ?) AS c_temp)`,
        [this.userId, this.userId]
      );

      // 2. Delete all conversations for this user
      await pool.execute('DELETE FROM conversations WHERE user_id = ?', [this.userId]);

      // 3. Delete WhatsApp call logs for this user
      await pool.execute('DELETE FROM whatsapp_calls WHERE user_id = ?', [this.userId]);

      // 4. Delete WhatsApp customers created for this user
      await pool.execute('DELETE FROM customers WHERE user_id = ?', [this.userId]);

      console.log(`[WhatsApp:${this.userId}] Successfully purged WhatsApp database records.`);
    } catch (err) {
      console.error(`[WhatsApp:${this.userId}] Error purging WhatsApp DB data:`, err.message);
    }
  }

  async restart(clean = false) {
    console.log(`[WhatsApp:${this.userId}] Restarting session (clean=${clean})...`);
    try {
      if (this.client) {
        await this.client.destroy().catch(() => { });
        this.client = null;
      }

      this.status = 'offline';
      this.isConnected = false;
      this.latestQrString = null;
      this.latestQrDataUrl = null;
      this.botPhone = null;
      this.botName = null;

      const sessionFolder = path.join(config.WHATSAPP_SESSION_PATH, `session-user-${this.userId}`);
      if (clean) {
        await this.purgeUserWhatsAppData();
        if (fs.existsSync(sessionFolder)) {
          console.log(`[WhatsApp:${this.userId}] Clearing session folder:`, sessionFolder);
          fs.rmSync(sessionFolder, { recursive: true, force: true });
        }
      }

      this.broadcastCurrentStatus();
      await this.initialize();
      return { success: true, message: 'Session restarted successfully.' };
    } catch (err) {
      console.error(`[WhatsApp:${this.userId}] Restart error:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Fully destroy this session — kills Chrome and deletes session folder.
   * Called by SessionManager on user logout.
   */
  async destroy(clean = true) {
    console.log(`[WhatsApp:${this.userId}] Destroying session (clean=${clean})...`);
    try {
      if (this.client) {
        await this.client.destroy().catch(() => { });
        this.client = null;
      }
    } catch (e) { }

    if (clean) {
      await this.purgeUserWhatsAppData();
    }

    // Give Chrome 500ms to completely release file locks before deleting session folder
    await new Promise((resolve) => setTimeout(resolve, 500));

    this.status = 'offline';
    this.isConnected = false;
    this.latestQrString = null;
    this.latestQrDataUrl = null;
    this.botPhone = null;
    this.botName = null;

    // Delete session folder so user must re-scan on next login
    const sessionFolder = path.join(config.WHATSAPP_SESSION_PATH, `session-user-${this.userId}`);
    if (fs.existsSync(sessionFolder)) {
      try {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
        console.log(`[WhatsApp:${this.userId}] Session folder deleted.`);
      } catch (rmErr) {
        console.warn(`[WhatsApp:${this.userId}] Error deleting session folder:`, rmErr.message);
      }
    }
  }

  async getSafeChatList() {
    if (!this.client || !this.client.pupPage) {
      console.warn('[WhatsApp] pupPage not available for getSafeChatList');
      return [];
    }

    try {
      const rawChats = await this.client.pupPage.evaluate(async () => {
        try {
          const chatCollection = window.require ? window.require('WAWebCollections')?.Chat : null;
          const models = chatCollection?.getModelsArray ? chatCollection.getModelsArray() : (window.Store?.Chat?.models || []);
          if (!models || !models.length) return [];

          return models.map(c => {
            let lastMsgText = '';
            let lastMsgTime = c.t || 0;
            let lastMsgId = null;
            let fromMe = false;

            try {
              let msg = null;
              if (c.msgs) {
                if (typeof c.msgs.last === 'function') {
                  msg = c.msgs.last();
                } else if (Array.isArray(c.msgs.models) && c.msgs.models.length > 0) {
                  msg = c.msgs.models[c.msgs.models.length - 1];
                } else if (typeof c.msgs.getModelsArray === 'function') {
                  const arr = c.msgs.getModelsArray();
                  if (arr && arr.length > 0) msg = arr[arr.length - 1];
                } else if (Array.isArray(c.msgs._models) && c.msgs._models.length > 0) {
                  msg = c.msgs._models[c.msgs._models.length - 1];
                }
              }
              if (!msg && c.previewMessage) {
                msg = c.previewMessage;
              }
              if (!msg && c.lastMessage) {
                msg = c.lastMessage;
              }
              if (!msg && c.lastReceivedKey) {
                const msgCol = window.require ? window.require('WAWebCollections')?.Msg : null;
                const recMsg = msgCol?.get ? msgCol.get(c.lastReceivedKey._serialized || c.lastReceivedKey) : (window.Store?.Msg?.get ? window.Store.Msg.get(c.lastReceivedKey._serialized || c.lastReceivedKey) : null);
                if (recMsg) msg = recMsg;
              }
              if (!msg && window.Store?.Msg?.models) {
                const cid = c.id?._serialized || String(c.id);
                const userPart = c.id?.user;
                const mList = window.Store.Msg.models.filter(m => {
                  const r = m.id?.remote?._serialized || m.id?.remote || '';
                  return r === cid || (userPart && r.includes(userPart));
                });
                if (mList.length > 0) msg = mList[mList.length - 1];
              }
              if (msg) {
                if (msg.t) lastMsgTime = msg.t;
                lastMsgId = msg.id?._serialized || msg.id?.id || (typeof msg.id === 'string' ? msg.id : null);
                const mType = String(msg.type || '').toLowerCase();
                const b = msg.body || '';
                const subTypeStr = String(msg.subtype || (msg._data && msg._data.subtype) || '').toLowerCase();
                const bodyStr = String(b || (msg._data && msg._data.body) || '').toLowerCase();
                const callTypeStr = String(msg.callType || (msg._data && msg._data.callType) || '').toLowerCase();

                const isRevoked = !!msg.isRevoked || mType === 'revoked' || subTypeStr.includes('revoke') || bodyStr.includes('deleted this message');
                const isExplicitCallBody = bodyStr === '[call_log]' || bodyStr === 'call' || bodyStr === 'voice call' || bodyStr === 'video call' || bodyStr === 'missed voice call' || bodyStr === 'missed video call' || bodyStr.startsWith('📞') || bodyStr.startsWith('📹');
                const isCallLog = mType === 'call_log' || mType === 'call' || subTypeStr.includes('call_log') || subTypeStr.includes('video_call') || subTypeStr.includes('voice_call') || subTypeStr.includes('missed_call') || callTypeStr.includes('call') || !!msg.call || (subTypeStr === 'call' && isExplicitCallBody);

                const isVideoCall = isCallLog && (
                  !!msg.isVideo ||
                  !!msg.isVideoCall ||
                  !!(msg.call && (msg.call.isVideo || msg.call.isVideoCall)) ||
                  !!(msg._data && (msg._data.isVideo || msg._data.isVideoCall)) ||
                  callTypeStr.includes('video') ||
                  subTypeStr.includes('video') ||
                  bodyStr.includes('📹') ||
                  (isCallLog && bodyStr.includes('video'))
                );

                const isMissedCall = isCallLog && (
                  !!msg.isMissed ||
                  !!msg.isMissedCall ||
                  !!(msg.call && (msg.call.isMissed || msg.call.isMissedCall)) ||
                  !!(msg._data && (msg._data.isMissed || msg._data.isMissedCall)) ||
                  subTypeStr.includes('missed') ||
                  bodyStr.includes('missed') ||
                  bodyStr.includes('no answer') ||
                  bodyStr.includes('tap to call back')
                );

                const isAlbum = mType === 'album' || msg.isAlbum;

                if (isRevoked) {
                  const isMe = !!(msg.id?.fromMe || msg.fromMe);
                  lastMsgText = isMe ? '🚫 You deleted this message' : 'This message was deleted';
                } else if (isCallLog) {
                  lastMsgText = isVideoCall ? (isMissedCall ? '📹 Missed video call' : '📹 Video call') : (isMissedCall ? '📞 Missed voice call' : '📞 Voice call');
                } else if (isAlbum) {
                  lastMsgText = msg.caption || 'Album';
                } else if (mType === 'image' || b.startsWith('/9j/')) {
                  lastMsgText = msg.caption || (b && !b.startsWith('/9j/') ? b : '📷 Photo');
                } else if (mType === 'video') {
                  lastMsgText = msg.caption || (b && !b.startsWith('/9j/') ? b : '🎥 Video');
                } else if (mType === 'audio' || mType === 'ptt') {
                  lastMsgText = '🎤 Voice message';
                } else if (mType === 'document') {
                  lastMsgText = msg.filename ? `📄 ${msg.filename}` : '📄 Document';
                } else if (mType === 'sticker') {
                  lastMsgText = '🏷️ Sticker';
                } else if (mType === 'location') {
                  lastMsgText = '📍 Location';
                } else if (mType === 'vcard' || mType === 'multi_vcard') {
                  lastMsgText = '👤 Contact';
                } else if (mType === 'gp2') {
                  lastMsgText = 'Group update';
                } else if (mType === 'e2e_notification') {
                  lastMsgText = 'End-to-end encrypted';
                } else if (mType === 'notification_template') {
                  lastMsgText = 'Notification';
                } else if (mType && mType !== 'chat') {
                  lastMsgText = `[${mType}]`;
                } else {
                  lastMsgText = b || (msg.caption ? msg.caption : '');
                }

                fromMe = !!(msg.id?.fromMe || msg.fromMe);
                const isGroupChat = !!c.isGroup || String(c.id).includes('@g.us');
                if (isGroupChat && !fromMe && lastMsgText) {
                  let sender = msg.pushname || '';
                  if (!sender && msg.author) {
                    try {
                      const authorSerialized = typeof msg.author === 'string' ? msg.author : (msg.author._serialized || String(msg.author));
                      const contactCol = window.require ? window.require('WAWebCollections')?.Contact : null;
                      const authorContact = contactCol?.get ? contactCol.get(authorSerialized) : null;
                      sender = authorContact?.name || authorContact?.pushname || authorContact?.formattedName || '';
                    } catch (_) { }
                  }
                  if (!sender && msg.author?.user) {
                    try {
                      const contactCol = window.require ? window.require('WAWebCollections')?.Contact : null;
                      const models = contactCol?.getModelsArray ? contactCol.getModelsArray() : [];
                      const found = models.find(m => m.id?.user === msg.author.user);
                      if (found) sender = found.name || found.pushname || found.formattedName || '';
                    } catch (_) { }
                  }
                  if (!sender) {
                    sender = msg.author?.user || '';
                  }
                  if (sender) {
                    lastMsgText = `${sender}: ${lastMsgText}`;
                  }
                }

                if (msg.t) lastMsgTime = msg.t;
                if (msg.id) {
                  lastMsgId = typeof msg.id === 'string' ? msg.id : (msg.id._serialized || msg.id.id || null);
                }
              }
            } catch (_) { }

            let displayName = c.formattedTitle || c.name || '';
            if (!displayName && c.contact) {
              displayName = c.contact.name || c.contact.pushname || c.contact.formattedName || '';
            }

            const jid = c.id?._serialized || String(c.id);
            const isGroup = !!c.isGroup || jid.includes('@g.us');
            const isLid = jid.includes('@lid');

            let phoneNumber = '';
            if (isGroup) {
              phoneNumber = 'Group';
            } else if (c.contact?.phoneNumber) {
              const cp = c.contact.phoneNumber;
              if (typeof cp === 'object' && cp !== null) {
                phoneNumber = cp.user ? `+${cp.user}` : (cp._serialized ? `+${String(cp._serialized).replace(/[^0-9]/g, '')}` : '');
              } else {
                const s = String(cp);
                phoneNumber = s.startsWith('+') ? s : `+${s}`;
              }
            } else if (c.id?.user) {
              phoneNumber = isLid ? c.id.user : `+${c.id.user}`;
            }

            if (!displayName) {
              displayName = (typeof phoneNumber === 'string' && phoneNumber) ? phoneNumber : (isGroup ? 'WhatsApp Group' : 'Contact');
            }

            // Strictly use c.t as the real chat activity timestamp
            const chatTimestamp = (typeof c.t === 'number' && c.t > 0) ? c.t : (lastMsgTime || 0);

            return {
              id: jid,
              user: c.id?.user || '',
              phoneNumber: phoneNumber,
              isGroup: isGroup,
              name: displayName,
              unreadCount: c.unreadCount || 0,
              timestamp: chatTimestamp,
              lastMessage: lastMsgText,
              lastMsgId: lastMsgId,
              fromMe: fromMe,
              pinned: !!(c.pin || c.pinned)
            };
          });
        } catch (err) {
          return { evalError: err.message || String(err) };
        }
      });

      if (rawChats && rawChats.evalError) {
        console.error('[WhatsApp] Fallback evaluate returned error:', rawChats.evalError);
        return [];
      }

      if (Array.isArray(rawChats)) {
        return rawChats;
      }
    } catch (err) {
      console.error('[WhatsApp] getSafeChatList error:', err.message);
    }

    return [];
  }

  async fetchMessagesForChat(jid, limit = 60, phone = null) {
    if (!this.client || !this.client.pupPage) return [];

    try {
      const messages = await this.client.pupPage.evaluate(async ({ targetJid, maxMsgs, phoneNumber }) => {
        try {
          const searchJids = [];
          if (phoneNumber) {
            const cleanPhone = String(phoneNumber).replace(/[^0-9]/g, '');
            if (cleanPhone) searchJids.push(`${cleanPhone}@c.us`);
          }
          if (targetJid && !searchJids.includes(targetJid)) {
            searchJids.push(targetJid);
          }

          let chat = null;
          for (const sjid of searchJids) {
            if (window.WWebJS && window.WWebJS.getChat) {
              try {
                chat = await window.WWebJS.getChat(sjid, { getAsModel: false });
                if (chat) break;
              } catch (_) { }
            }
            if (!chat) {
              const chatCol = window.require ? window.require('WAWebCollections')?.Chat : null;
              chat = chatCol?.get ? chatCol.get(sjid) : null;
              if (chat) break;
            }
          }

          // Fallback for @lid JIDs: search all chats by LID user part or by phone number
          if (!chat) {
            const chatCol = window.require ? window.require('WAWebCollections')?.Chat : null;
            const allChats = chatCol?.getModelsArray ? chatCol.getModelsArray() : (window.Store?.Chat?.models || []);

            // Try matching by LID user part in the chat's id
            const lidUser = targetJid.includes('@lid') ? targetJid.split('@')[0] : null;
            if (lidUser && allChats.length > 0) {
              chat = allChats.find(c => {
                const cJid = c.id?._serialized || String(c.id);
                return cJid === targetJid || (cJid.includes(lidUser) && cJid.includes('@lid'));
              });
            }

            // Try matching by phone number strictly (10-digit national match)
            if (!chat && phoneNumber) {
              const cleanPhone = String(phoneNumber).replace(/[^0-9]/g, '');
              const phone10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
              if (phone10 && phone10.length >= 7 && allChats.length > 0) {
                chat = allChats.find(c => {
                  const cUser = String(c.id?.user || c.contact?.id?.user || '').replace(/[^0-9]/g, '');
                  if (!cUser) return false;
                  if (cUser === cleanPhone) return true;
                  const c10 = cUser.length >= 10 ? cUser.slice(-10) : cUser;
                  if (c10.length >= 10 && phone10.length >= 10) {
                    return c10 === phone10;
                  }
                  return false;
                });
              }
            }
          }

          if (!chat) return [];

          let msgs = [];
          if (chat.msgs && chat.msgs.getModelsArray) {
            msgs = [...chat.msgs.getModelsArray()];
          } else if (chat.msgs && Array.isArray(chat.msgs.models)) {
            msgs = [...chat.msgs.models];
          }

          // Load earlier messages using WAWebChatLoadMessages
          const loader = window.require ? window.require('WAWebChatLoadMessages') : null;
          if (loader && loader.loadEarlierMsgs) {
            try {
              let attempts = 0;
              while (msgs.length < maxMsgs && attempts < 8) {
                attempts++;
                const loadedMessages = await loader.loadEarlierMsgs({ chat });
                const currentModels = chat.msgs?.getModelsArray ? chat.msgs.getModelsArray() : (chat.msgs?.models || []);
                if (currentModels && currentModels.length > msgs.length) {
                  msgs = [...currentModels];
                } else if (loadedMessages && loadedMessages.length) {
                  msgs = [...loadedMessages, ...msgs];
                } else {
                  break;
                }
              }
            } catch (_) { }
          }

          if (msgs.length === 0 && window.Store?.Msg?.models) {
            const chatId = chat.id?._serialized || String(chat.id);
            const userPart = chat.id?.user;
            const storeMsgs = window.Store.Msg.models.filter(m => {
              const r = m.id?.remote?._serialized || m.id?.remote || '';
              return r === chatId || (userPart && r.includes(userPart));
            });
            if (storeMsgs.length > 0) {
              msgs = [...storeMsgs];
            }
          }

          if (msgs.length === 0) {
            const fallbackMsg = chat.lastMessage || chat.previewMessage;
            if (fallbackMsg) {
              msgs = [fallbackMsg];
            }
          }

          // Deduplicate by message id if any overlaps
          const seen = new Set();
          const uniqueMsgs = [];
          for (const m of msgs) {
            const msgTypeStr = String(m.type || 'chat').toLowerCase();
            if (msgTypeStr === 'e2e_notification' || msgTypeStr === 'protocol' || msgTypeStr === 'gp2' || msgTypeStr === 'notification_template') {
              continue;
            }

            const rawId = m.id?._serialized || m.id?.id || (typeof m.id === 'string' ? m.id : null);
            if (rawId && seen.has(rawId)) continue;
            if (rawId) seen.add(rawId);
            uniqueMsgs.push(m);
          }

          const slice = uniqueMsgs.length > maxMsgs ? uniqueMsgs.slice(-maxMsgs) : uniqueMsgs;
          return slice.map(m => {
            const isFromMe = !!(m.id?.fromMe || m.fromMe);
            let bodyText = m.body || '';
            const mType = String(m.type || 'chat').toLowerCase();
            const subTypeStr = String(m.subtype || (m._data && m._data.subtype) || '').toLowerCase();
            const bodyStr = String(bodyText || (m._data && m._data.body) || '').toLowerCase();
            const callTypeStr = String(m.callType || (m._data && m._data.callType) || '').toLowerCase();

            const isExplicitCallBody = bodyStr === '[call_log]' || bodyStr === 'call' || bodyStr === 'voice call' || bodyStr === 'video call' || bodyStr === 'missed voice call' || bodyStr === 'missed video call' || bodyStr.startsWith('📞') || bodyStr.startsWith('📹');
            const isCallLog = mType === 'call_log' || mType === 'call' || subTypeStr.includes('call_log') || subTypeStr.includes('video_call') || subTypeStr.includes('voice_call') || subTypeStr.includes('missed_call') || callTypeStr.includes('call') || !!m.call || (subTypeStr === 'call' && isExplicitCallBody);

            const isVideoCall = isCallLog && (
              !!m.isVideo ||
              !!m.isVideoCall ||
              !!(m.call && (m.call.isVideo || m.call.isVideoCall)) ||
              !!(m._data && (m._data.isVideo || m._data.isVideoCall)) ||
              callTypeStr.includes('video') ||
              subTypeStr.includes('video') ||
              bodyStr.includes('📹') ||
              (isCallLog && bodyStr.includes('video'))
            );

            // 1. Explicit missed check
            const isMissed = isCallLog && (
              !!m.isMissed ||
              !!m.isMissedCall ||
              !!(m.call && (m.call.isMissed || m.call.isMissedCall)) ||
              !!(m._data && (m._data.isMissed || m._data.isMissedCall)) ||
              m.subtype === 'missed' ||
              (m._data && m._data.subtype === 'missed') ||
              m.callResult === 1 ||
              (m._data && m._data.callResult === 1) ||
              m.webCallResult === 'MISSED' ||
              m.webCallResult === 'UNANSWERED' ||
              m.webCallResult === 'NO_ANSWER' ||
              subTypeStr.includes('missed') ||
              bodyStr.includes('missed') ||
              bodyStr.includes('no answer') ||
              bodyStr.includes('tap to call back')
            );

            // 2. Explicit rejected/declined check
            const isRejected = isCallLog && !isMissed && (
              m.subtype === 'rejected' ||
              (m._data && m._data.subtype === 'rejected') ||
              m.webCallResult === 'REJECTED' ||
              m.webCallResult === 'DECLINED' ||
              m.webCallResult === 'BUSY' ||
              subTypeStr.includes('rejected') ||
              subTypeStr.includes('declined') ||
              bodyStr.includes('declined') ||
              bodyStr.includes('rejected')
            );

            // Extract raw duration (integer seconds)
            let rawDurationSec = null;
            if (isCallLog) {
              const d = m.duration !== undefined ? m.duration : (
                m.callDuration !== undefined ? m.callDuration : (
                  m.webCallDuration !== undefined ? m.webCallDuration : (
                    m._data ? (m._data.duration !== undefined ? m._data.duration : m._data.callDuration) : null
                  )
                )
              );
              if (typeof d === 'number' && !isNaN(d) && d > 0 && d < 1e8) {
                rawDurationSec = Math.round(d);
              } else if (typeof d === 'string') {
                const match = d.match(/(\d+)/);
                if (match) {
                  const p = parseInt(match[1], 10);
                  if (p > 0) rawDurationSec = p;
                }
              }
            }

            // 3. Explicit answered/completed check
            const isExplicitAnswered = isCallLog && !isMissed && !isRejected && (
              (rawDurationSec !== null && rawDurationSec > 0) ||
              m.webCallResult === 'CONNECTED' ||
              m.webCallResult === 'ACCEPTED' ||
              m.webCallResult === 'COMPLETED' ||
              m.webCallResult === 'SUCCESS' ||
              m.subtype === 'completed' ||
              (m._data && m._data.subtype === 'completed')
            );

            let callStatus = 'unknown';
            if (isMissed) {
              callStatus = 'missed';
              rawDurationSec = null;
            } else if (isRejected) {
              callStatus = 'rejected';
              rawDurationSec = null;
            } else if (isExplicitAnswered) {
              callStatus = 'answered';
            } else {
              callStatus = 'unknown';
              rawDurationSec = null;
            }

            const isAlbum = mType === 'album' || m.isAlbum;

            if (isCallLog) {
              if (isVideoCall) {
                bodyText = callStatus === 'missed'
                  ? '📹 Missed video call'
                  : (callStatus === 'rejected' ? '📹 Declined video call' : (isFromMe ? '📹 Outgoing video call' : '📹 Video call'));
              } else {
                bodyText = callStatus === 'missed'
                  ? '📞 Missed voice call'
                  : (callStatus === 'rejected' ? '📞 Declined voice call' : (isFromMe ? '📞 Outgoing voice call' : '📞 Voice call'));
              }
            } else if (isAlbum) {
              bodyText = m.caption || 'Album';
            } else if (mType === 'video' || m.isVideo || (m._data && m._data.isVideo)) {
              bodyText = m.caption || (bodyText && !bodyText.startsWith('/9j/') && bodyText !== 'Images' ? bodyText : 'Video');
            } else if (mType === 'image' || bodyText.startsWith('/9j/')) {
              bodyText = m.caption || (bodyText && !bodyText.startsWith('/9j/') ? bodyText : 'Images');
            } else if (mType === 'audio' || mType === 'ptt') {
              bodyText = 'Voice message';
            } else if (mType === 'document') {
              bodyText = m.filename ? `📄 ${m.filename}` : (m.caption || 'Document');
            } else if (mType === 'sticker') {
              bodyText = 'Sticker';
            } else if (mType === 'location') {
              bodyText = 'Location';
            } else if (mType === 'vcard' || mType === 'multi_vcard') {
              bodyText = 'Contact';
            } else if (mType !== 'chat' && !bodyText) {
              bodyText = `[${mType}]`;
            }

            const isGroupChat = targetJid.includes('@g.us') || (phoneNumber && String(phoneNumber).startsWith('group-'));
            if (isGroupChat && !isFromMe && bodyText) {
              let sender = m.pushname || '';
              if (!sender && m.author) {
                try {
                  const authorSerialized = typeof m.author === 'string' ? m.author : (m.author._serialized || String(m.author));
                  const contactCol = window.require ? window.require('WAWebCollections')?.Contact : null;
                  const authorContact = contactCol?.get ? contactCol.get(authorSerialized) : null;
                  sender = authorContact?.name || authorContact?.pushname || authorContact?.formattedName || '';
                } catch (_) { }
              }
              if (!sender && m.author?.user) {
                try {
                  const contactCol = window.require ? window.require('WAWebCollections')?.Contact : null;
                  const models = contactCol?.getModelsArray ? contactCol.getModelsArray() : [];
                  const found = models.find(mod => mod.id?.user === m.author.user);
                  if (found) sender = found.name || found.pushname || found.formattedName || '';
                } catch (_) { }
              }
              if (!sender && m.author?.user) {
                sender = `+${m.author.user}`;
              }
              if (sender && !bodyText.startsWith(`${sender}:`)) {
                bodyText = `${sender}: ${bodyText}`;
              }
            }

            const msgId = m.id
              ? (m.id.id || m.id._serialized || m.id.$1 || (typeof m.id === 'string' ? m.id : null))
              : `msg_${m.t}_${isFromMe ? 'out' : 'in'}`;

            let metadata = null;
            if (isCallLog) {
              const waCallId = m.id
                ? (m.id._serialized || m.id.id || (typeof m.id === 'string' ? m.id : null))
                : null;
              metadata = {
                isCall: true,
                status: callStatus,
                callType: isFromMe ? 'outgoing' : 'incoming',
                mediaType: isVideoCall ? 'video' : 'voice',
                duration: rawDurationSec,
                whatsappCallId: waCallId
              };
            }

            return {
              id: msgId,
              body: bodyText,
              type: isCallLog ? 'call' : (mType || 'text'),
              timestamp: m.t || Math.floor(Date.now() / 1000),
              fromMe: isFromMe,
              status: m.ack === 3 ? 'read' : (m.ack === 2 ? 'delivered' : 'sent'),
              metadata
            };
          });
        } catch (err) {
          return [];
        }
      }, { targetJid: jid, maxMsgs: limit, phoneNumber: phone });

      return Array.isArray(messages) ? messages : [];
    } catch (e) {
      console.error('[WhatsApp] fetchMessagesForChat error:', e.message);
      return [];
    }
  }

  async syncChats(options = {}) {
    if (!this.client || !this.client.pupPage) {
      return { success: false, message: 'WhatsApp client is not ready yet. Please wait a moment.' };
    }

    try {
      console.log('[WhatsApp] Fetching safe chat list from browser session...');
      let chats = await this.getSafeChatList();

      // If safe chat list returned 0, try client.getChats() as secondary
      if (!chats || chats.length === 0) {
        try {
          const raw = await this.client.getChats();
          if (Array.isArray(raw) && raw.length > 0) {
            chats = raw.map(c => ({
              id: c.id._serialized,
              user: c.id.user,
              phoneNumber: c.isGroup ? 'Group' : `+${c.id.user}`,
              isGroup: c.isGroup,
              name: c.name || c.formattedTitle || `+${c.id.user}`,
              unreadCount: c.unreadCount || 0,
              timestamp: (typeof c.t === 'number' && c.t > 0) ? c.t : (c.timestamp || 0),
              lastMessage: c.lastMessage?.body || '',
              lastMsgId: c.lastMessage?.id?._serialized || null,
              fromMe: !!c.lastMessage?.fromMe,
              pinned: !!c.pinned
            }));
          }
        } catch (e) {
          console.warn('[WhatsApp] Standard getChats() also failed:', e.message);
        }
      }

      console.log(`[WhatsApp] Retrieved ${chats.length} real chats from session.`);
      if (chats.length === 0) {
        return { success: true, count: 0, totalChats: 0, message: 'No chats found in WhatsApp session.' };
      }

      // Sort chats by timestamp descending so the most recent WhatsApp chat is processed first
      chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const activeJids = new Set();
      let syncedCount = 0;

      for (const chat of chats) {
        if (!chat.id || chat.id.includes('@newsletter') || chat.id.includes('@broadcast')) {
          continue;
        }

        // Skip 0-message contacts (address book entries without active conversations)
        if (!chat.lastMessage && !chat.lastMsgId && (!chat.unreadCount || chat.unreadCount === 0)) {
          continue;
        }

        activeJids.add(chat.id);
        const jid = String(chat.id).slice(0, 100);
        let name = String(chat.name || 'Contact').slice(0, 100);

        // Format a unique, valid phone number string (max 30 chars)
        let phone = '';
        if (typeof chat.phoneNumber === 'object' && chat.phoneNumber !== null) {
          phone = chat.phoneNumber.user ? `+${chat.phoneNumber.user}` : (chat.phoneNumber._serialized || '');
        } else if (chat.phoneNumber && typeof chat.phoneNumber === 'string' && chat.phoneNumber !== '[object Object]') {
          phone = chat.phoneNumber;
        }

        if (!phone || phone === 'Group' || phone === '[object Object]') {
          const u = chat.user || (chat.id ? chat.id.split('@')[0] : '');
          phone = chat.isGroup ? `group-${u}` : `+${u}`;
        }
        if (!phone || phone === '[object Object]') {
          phone = jid.split('@')[0];
        }
        phone = String(phone).replace(/[^0-9+a-zA-Z_-]/g, '').slice(0, 30);

        if (name.toLowerCase() === 'vaishnavi') {
          name = phone;
        }

        const timestampSeconds = chat.timestamp || 0;
        const isoDate = timestampSeconds > 0
          ? new Date(timestampSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : '2000-01-01 00:00:00';

        // 1. Upsert Customer safely (scoped to this user)
        const userId = this.userId;
        let customerId = null;
        const isLidJid = jid.includes('@lid');
        const isGroupChat = chat.isGroup || jid.includes('@g.us');
        
        // Build the most reliable lookup: JID first, then phone, then suffix match
        let byJid;
        if (isGroupChat) {
          // For groups: match by exact phone (group-xxx) or JID
          [byJid] = await pool.execute(
            'SELECT id, phone_number, name FROM customers WHERE user_id = ? AND (whatsapp_jid = ? OR phone_number = ?) LIMIT 1',
            [userId, jid, phone]
          );
        } else {
          // For individual chats: match by JID, exact phone, or 10-digit suffix
          const cleanPhone = String(phone).replace(/[^0-9]/g, '');
          const phoneSuffix = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : '';
          
          if (phoneSuffix) {
            [byJid] = await pool.execute(
              `SELECT id, phone_number, name FROM customers WHERE user_id = ? AND (
                whatsapp_jid = ? 
                OR phone_number = ? 
                OR RIGHT(REPLACE(REPLACE(phone_number, '+', ''), '-', ''), 10) = ?
              ) LIMIT 1`,
              [userId, jid, phone, phoneSuffix]
            );
          } else {
            [byJid] = await pool.execute(
              'SELECT id, phone_number, name FROM customers WHERE user_id = ? AND (whatsapp_jid = ? OR phone_number = ?) LIMIT 1',
              [userId, jid, phone]
            );
          }
        }
        
        if (byJid.length > 0) {
          customerId = byJid[0].id;
          try {
            if (name && name !== 'Contact' && !name.startsWith('+')) {
              await pool.execute('UPDATE customers SET name = ?, whatsapp_jid = ? WHERE id = ?', [name, jid, customerId]);
            } else {
              await pool.execute('UPDATE customers SET whatsapp_jid = ? WHERE id = ?', [jid, customerId]);
            }
          } catch (_) {}
        } else {
          try {
            const [insCust] = await pool.execute(
              'INSERT INTO customers (name, phone_number, whatsapp_jid, user_id) VALUES (?, ?, ?, ?)',
              [name, phone, jid, userId]
            );
            customerId = insCust.insertId;
          } catch (dupErr) {
            const [fallback] = await pool.execute(
              'SELECT id FROM customers WHERE user_id = ? AND (whatsapp_jid = ? OR phone_number = ?) LIMIT 1',
              [userId, jid, phone]
            );
            if (fallback.length > 0) {
              customerId = fallback[0].id;
              await pool.execute('UPDATE customers SET name = ? WHERE id = ?', [name, customerId]);
            }
          }
        }
        if (!customerId) continue;

        // 2. Upsert Conversation (scoped to this user)
        let convId;
        const [existingConv] = await pool.execute(
          'SELECT id FROM conversations WHERE customer_id = ? AND user_id = ? LIMIT 1',
          [customerId, userId]
        );

        const isPinned = chat.pinned ? 1 : 0;
        const unread = chat.unreadCount || 0;

        if (existingConv.length > 0) {
          convId = existingConv[0].id;
          await pool.execute(
            'UPDATE conversations SET last_message_at = ?, unread_count = ?, is_pinned = ? WHERE id = ?',
            [isoDate, unread, isPinned, convId]
          );
        } else {
          const [insConv] = await pool.execute(
            'INSERT INTO conversations (customer_id, status, last_message_at, unread_count, is_pinned, user_id) VALUES (?, "open", ?, ?, ?, ?)',
            [customerId, isoDate, unread, isPinned, userId]
          );
          convId = insConv.insertId;
        }

        // 3. Insert last message preview if real text exists (skip e2e_notification system messages)
        const msgText = (chat.lastMessage && typeof chat.lastMessage === 'string' && chat.lastMessage.trim() && chat.lastMessage.trim() !== 'Message')
          ? chat.lastMessage.trim()
          : null;

        if (msgText && msgText !== 'End-to-end encrypted' && !msgText.includes('encryption')) {
          const safeMsgId = chat.lastMsgId ? String(chat.lastMsgId).slice(0, 191) : null;
          const direction = chat.fromMe ? 'outgoing' : 'incoming';

          let msgType = 'text';
          const lowerPreview = msgText.toLowerCase();
          if (lowerPreview.includes('photo') || lowerPreview.includes('image') || msgText.startsWith('📷')) msgType = 'image';
          else if (lowerPreview.includes('video') || msgText.startsWith('🎥')) msgType = 'video';
          else if (lowerPreview.includes('voice') || lowerPreview.includes('audio') || msgText.startsWith('🎤')) msgType = 'audio';
          else if (lowerPreview.includes('document') || msgText.startsWith('📄')) msgType = 'document';
          else if (lowerPreview.includes('call') || msgText.startsWith('📞') || msgText.startsWith('📹')) msgType = 'call';
          else if (lowerPreview.includes('sticker') || msgText.startsWith('🏷️')) msgType = 'sticker';
          else if (lowerPreview.includes('location') || msgText.startsWith('📍')) msgType = 'location';

          const waTimestampMs = timestampSeconds > 0 ? timestampSeconds * 1000 : Date.now();

          const [existingMsg] = await pool.execute(
            `SELECT id FROM messages 
             WHERE (conversation_id = ? OR customer_id = ?) AND (whatsapp_message_id = ? OR (direction = ? AND message = ?)) 
             LIMIT 1`,
            [convId, customerId, safeMsgId || '', direction, msgText]
          );

          if (existingMsg.length === 0) {
            try {
              await pool.execute(
                `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?)`,
                [convId, customerId, direction, msgText, safeMsgId, msgType, waTimestampMs, isoDate, userId]
              );
            } catch (_) { }
          }
        }

        syncedCount++;
      }

      // Clean up stale conversations from old session (scoped strictly to this user)
      if (options.cleanOld || (chats.length > 0 && !options.preserveOld)) {
        if (activeJids.size > 0) {
          const [staleCusts] = await pool.execute(
            `SELECT id FROM customers WHERE user_id = ? AND whatsapp_jid IS NOT NULL AND whatsapp_jid NOT IN (${Array.from(activeJids).map(() => '?').join(',')})`,
            [this.userId, ...Array.from(activeJids)]
          );

          if (staleCusts.length > 0) {
            const staleIds = staleCusts.map(c => c.id);
            console.log(`[WhatsApp:${this.userId}] Purging ${staleIds.length} stale conversations not in active session...`);
            for (let i = 0; i < staleIds.length; i += 50) {
              const chunk = staleIds.slice(i, i + 50);
              const placeholders = chunk.map(() => '?').join(',');
              await pool.execute(`DELETE FROM messages WHERE user_id = ? AND customer_id IN (${placeholders})`, [this.userId, ...chunk]);
              await pool.execute(`DELETE FROM conversations WHERE user_id = ? AND customer_id IN (${placeholders})`, [this.userId, ...chunk]);
              await pool.execute(`DELETE FROM customers WHERE user_id = ? AND id IN (${placeholders})`, [this.userId, ...chunk]);
            }
          }
        }
      }

      socketService.broadcastConversationUpdate({ userId: this.userId, synced: true, count: syncedCount });

      // Automatically warm up messages for ALL chats progressively in background (priority top 35 first, then remaining)
      this.progressiveWarmupAllChats(chats).catch(() => {});

      return {
        success: true,
        count: syncedCount,
        totalChats: chats.length,
        message: `Successfully synchronized ${syncedCount} chats with your WhatsApp!`
      };
    } catch (err) {
      console.error('[WhatsApp] Sync chats error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Progressively warms up message history for ALL chats in controlled background batches.
   * Priority: Top 35 active chats sync first, then remaining chats sync progressively in background.
   */
  async progressiveWarmupAllChats(chats = []) {
    if (!this.client || !this.client.pupPage || !Array.isArray(chats) || chats.length === 0) {
      socketService.broadcastWhatsAppSyncStatus({ userId: this.userId, status: 'ready', totalChats: 0, completed: 0 });
      return;
    }

    try {
      const totalChats = chats.length;
      socketService.broadcastWhatsAppSyncStatus({ userId: this.userId, status: 'syncing', totalChats, completed: 0 });

      // Phase 1: High-Priority Batch (Top 35 most active chats)
      const priorityCount = Math.min(totalChats, 35);
      const priorityChats = chats.slice(0, priorityCount);
      console.log(`[Sync:User ${this.userId}] Phase 1: Starting high-priority message warmup for top ${priorityCount} chats...`);

      let completedCount = 0;
      for (const chat of priorityChats) {
        await this.syncSingleChatMessages(chat);
        completedCount++;
      }

      console.log(`[Sync:User ${this.userId}] Phase 1 Complete: Top ${completedCount} chats synchronized.`);
      socketService.broadcastConversationUpdate({ userId: this.userId, synced: true, priorityDone: true });
      socketService.broadcastWhatsAppSyncStatus({ userId: this.userId, status: 'syncing', totalChats, completed: completedCount });

      // Phase 2: Progressive Batch for remaining chats (chunks of 10 chats)
      if (totalChats > priorityCount) {
        const remainingChats = chats.slice(priorityCount);
        console.log(`[Sync:User ${this.userId}] Phase 2: Starting progressive background sync for ${remainingChats.length} remaining chats...`);

        const CHUNK_SIZE = 10;
        for (let i = 0; i < remainingChats.length; i += CHUNK_SIZE) {
          const chunk = remainingChats.slice(i, i + CHUNK_SIZE);
          for (const chat of chunk) {
            await this.syncSingleChatMessages(chat);
            completedCount++;
          }

          // Yield to Node.js event loop to keep the process completely non-blocking
          await new Promise(r => setImmediate(r));

          // Notify frontend progress periodically
          if (completedCount % 20 === 0 || completedCount === totalChats) {
            socketService.broadcastConversationUpdate({ userId: this.userId, synced: true, backgroundChunk: true });
            socketService.broadcastWhatsAppSyncStatus({ userId: this.userId, status: 'syncing', totalChats, completed: completedCount });
          }
        }
      }

      console.log(`[Sync:User ${this.userId}] Full background sync completed for all ${completedCount} chats.`);
      socketService.broadcastConversationUpdate({ userId: this.userId, synced: true, warmupComplete: true });
      socketService.broadcastWhatsAppSyncStatus({ userId: this.userId, status: 'ready', totalChats, completed: completedCount });
    } catch (err) {
      console.warn(`[Sync:User ${this.userId}] Progressive warmup notice:`, err.message);
      socketService.broadcastWhatsAppSyncStatus({ userId: this.userId, status: 'error', error: err.message });
    }
  }

  async syncSingleChatMessages(chat) {
    if (!chat || !chat.id) return;
    try {
      const [convRows] = await pool.execute(
        `SELECT c.id, c.customer_id, cu.phone_number 
         FROM conversations c 
         JOIN customers cu ON c.customer_id = cu.id 
         WHERE (cu.whatsapp_jid = ? OR cu.phone_number = ?) AND c.user_id = ? 
         LIMIT 1`,
        [chat.id, chat.phoneNumber || '', this.userId]
      );
      if (convRows.length === 0) return;
      const convId = convRows[0].id;
      const custId = convRows[0].customer_id;
      const custPhone = convRows[0].phone_number;

      const [msgCount] = await pool.execute(
        'SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND (conversation_id = ? OR customer_id = ?)',
        [this.userId, convId, custId]
      );
      if (msgCount[0].count >= 10) return; // Already has rich history

      const liveMsgs = await this.fetchMessagesForChat(chat.id, 25, custPhone);
      if (Array.isArray(liveMsgs) && liveMsgs.length > 0) {
        let inserted = 0;
        for (const m of liveMsgs) {
          const waMs = m.timestamp > 1e11 ? m.timestamp : (m.timestamp * 1000 || Date.now());
          const iso = new Date(waMs).toISOString().slice(0, 19).replace('T', ' ');
          const dir = m.fromMe ? 'outgoing' : 'incoming';
          const safeMsgId = m.id ? String(m.id).slice(0, 191) : `wa_${m.timestamp}_${dir}`;
          const metadataJson = m.metadata ? JSON.stringify(m.metadata) : null;

          const [exist] = await pool.execute(
            'SELECT id FROM messages WHERE user_id = ? AND whatsapp_message_id = ? LIMIT 1',
            [this.userId, safeMsgId]
          );
          if (exist.length === 0) {
            await pool.execute(
              `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [convId, custId, dir, m.body || '', safeMsgId, m.type || 'text', waMs, m.status || 'delivered', iso, this.userId, metadataJson]
            );
            inserted++;
          }
        }
        if (inserted > 0) {
          // Update conversation's last_message_at accurately
          const newestWaMs = liveMsgs[liveMsgs.length - 1]?.timestamp ? (liveMsgs[liveMsgs.length - 1].timestamp * 1000) : Date.now();
          const newestIso = new Date(newestWaMs).toISOString().slice(0, 19).replace('T', ' ');
          await pool.execute('UPDATE conversations SET last_message_at = ? WHERE id = ?', [newestIso, convId]);
        }
      }
    } catch (_) {}
  }

  async syncWhatsAppCallsFromBrowser() {
    if (!this.client || !this.client.pupPage) return;

    try {
      const browserCalls = await this.client.pupPage.evaluate(async () => {
        try {
          const callCollection = window.require ? window.require('WAWebCollections')?.Call : null;
          const models = callCollection?.getModelsArray ? callCollection.getModelsArray() : (window.Store?.Call?.models || []);

          const results = [];
          if (models && models.length > 0) {
            models.forEach(c => {
              const rawPeer = c.peerJid?._serialized || (typeof c.peerJid === 'string' ? c.peerJid : '') || c.id?.remote?._serialized || (typeof c.id?.remote === 'string' ? c.id.remote : '');
              if (rawPeer) {
                const isVid = !!(
                  c.isVideo ||
                  c.isVideoCall ||
                  c.mediaType === 'video' ||
                  c.offerType === 'video' ||
                  (c._data && (c._data.isVideo || c._data.isVideoCall || c._data.mediaType === 'video' || c._data.offerType === 'video' || String(c._data.subtype || '').includes('video')))
                );

                let durSec = null;
                const d = c.duration !== undefined ? c.duration : (c.webCallDuration !== undefined ? c.webCallDuration : (c._data ? c._data.duration : null));
                if (typeof d === 'number' && !isNaN(d) && d > 0 && d < 1e8) {
                  durSec = Math.round(d);
                } else if (typeof d === 'string') {
                  const m = d.match(/(\d+)/);
                  if (m) {
                    const p = parseInt(m[1], 10);
                    if (p > 0) durSec = p;
                  }
                }

                const isMissed = !!(
                  c.isMissed ||
                  c.callResult === 1 ||
                  c.webCallResult === 'MISSED' ||
                  c.webCallResult === 'UNANSWERED' ||
                  c.webCallResult === 'NO_ANSWER'
                );

                const isRejected = !isMissed && !!(
                  c.webCallResult === 'REJECTED' ||
                  c.webCallResult === 'DECLINED' ||
                  c.webCallResult === 'BUSY'
                );

                const isAnswered = !isMissed && !isRejected && (
                  (durSec !== null && durSec > 0) ||
                  c.webCallResult === 'CONNECTED' ||
                  c.webCallResult === 'ACCEPTED' ||
                  c.webCallResult === 'COMPLETED' ||
                  c.webCallResult === 'SUCCESS'
                );

                let status = 'unknown';
                if (isMissed) {
                  status = 'missed';
                  durSec = null;
                } else if (isRejected) {
                  status = 'rejected';
                  durSec = null;
                } else if (isAnswered) {
                  status = 'answered';
                }

                const rawCallData = {
                  id: c.id?._serialized || (typeof c.id === 'string' ? c.id : null),
                  from: rawPeer,
                  timestamp: c.offerTime || c.t || Math.floor(Date.now() / 1000),
                  isGroup: false,
                  isVideo: isVid,
                  isVideoCall: isVid,
                  isGroupCall: false,
                  canHandleLocally: c.canHandleLocally !== undefined ? c.canHandleLocally : true,
                  status: status,
                  duration: durSec
                };

                results.push({
                  callId: c.id?._serialized || (typeof c.id === 'string' ? c.id : `call_${c.t}_${Math.random()}`),
                  peerJid: rawPeer,
                  isVideo: isVid,
                  outgoing: !!c.outgoing,
                  isMissed: isMissed,
                  isRejected: isRejected,
                  status: status,
                  timestamp: c.offerTime || c.t || Math.floor(Date.now() / 1000),
                  duration: durSec,
                  rawCall: rawCallData
                });
              }
            });
          }

          // Also scan Msg collection AND each chat's msgs collection for call_log messages
          const chats = window.Store?.Chat?.models || [];
          const seenMsgIds = new Set();

          const processMsg = (m, fallbackJid = '') => {
            if (!m) return;
            const msgId = m.id?._serialized || (typeof m.id === 'string' ? m.id : null);
            if (msgId && seenMsgIds.has(msgId)) return;
            if (msgId) seenMsgIds.add(msgId);

            const mType = String(m.type || (m._data && m._data.type) || '').toLowerCase();
            const subTypeStr = String(m.subtype || (m._data && m._data.subtype) || '').toLowerCase();
            const bodyStr = String(m.body || (m._data && m._data.body) || '').toLowerCase();
            const isCall = mType === 'call_log' || mType === 'call' || subTypeStr === 'call' || subTypeStr.includes('call_log') || subTypeStr.includes('video_call') || subTypeStr.includes('voice_call') || subTypeStr.includes('missed_call') || !!m.call || !!(m._data && m._data.call);

            if (isCall) {
              const isFromMe = !!(m.id?.fromMe || m.fromMe);
              const peerJid = m.id?.remote?._serialized || (typeof m.id?.remote === 'string' ? m.id.remote : '') || fallbackJid || (isFromMe ? (m.to?._serialized || m.to) : (m.from?._serialized || m.from)) || '';
              if (!peerJid || peerJid.includes('@g.us') || peerJid.includes('@newsletter') || peerJid.startsWith('group-')) return;

              const isMissed = !!(
                m.isMissed ||
                m.isMissedCall ||
                (m._data && (m._data.isMissed || m._data.isMissedCall)) ||
                m.subtype === 'missed' ||
                (m._data && m._data.subtype === 'missed') ||
                m.callResult === 1 ||
                (m._data && m._data.callResult === 1) ||
                m.webCallResult === 'MISSED' ||
                m.webCallResult === 'UNANSWERED' ||
                m.webCallResult === 'NO_ANSWER' ||
                subTypeStr.includes('missed') ||
                bodyStr.includes('missed') ||
                bodyStr.includes('no answer')
              );

              const isRejected = !isMissed && !!(
                m.subtype === 'rejected' ||
                (m._data && m._data.subtype === 'rejected') ||
                m.webCallResult === 'REJECTED' ||
                m.webCallResult === 'DECLINED' ||
                m.webCallResult === 'BUSY' ||
                subTypeStr.includes('rejected') ||
                subTypeStr.includes('declined') ||
                bodyStr.includes('declined') ||
                bodyStr.includes('rejected')
              );

              let durSec = null;
              const d = m.duration !== undefined ? m.duration : (
                m.callDuration !== undefined ? m.callDuration : (
                  m.webCallDuration !== undefined ? m.webCallDuration : (
                    m._data ? (m._data.duration !== undefined ? m._data.duration : m._data.callDuration) : null
                  )
                )
              );
              if (typeof d === 'number' && !isNaN(d) && d > 0 && d < 1e8) {
                durSec = Math.round(d);
              } else if (typeof d === 'string') {
                const numM = d.match(/(\d+)/);
                if (numM) {
                  const p = parseInt(numM[1], 10);
                  if (p > 0) durSec = p;
                }
              }

              const isAnswered = !isMissed && !isRejected && (
                (durSec !== null && durSec > 0) ||
                m.webCallResult === 'CONNECTED' ||
                m.webCallResult === 'ACCEPTED' ||
                m.webCallResult === 'COMPLETED' ||
                m.webCallResult === 'SUCCESS' ||
                m.subtype === 'completed' ||
                (m._data && m._data.subtype === 'completed')
              );

              let status = 'unknown';
              if (isMissed) {
                status = 'missed';
                durSec = null;
              } else if (isRejected) {
                status = 'rejected';
                durSec = null;
              } else if (isAnswered) {
                status = 'answered';
              }

              if (peerJid) {
                const isVidMsg = !!(
                  subTypeStr.includes('video') ||
                  bodyStr.includes('video') ||
                  bodyStr.includes('📹') ||
                  m.isVideo ||
                  m.isVideoCall ||
                  (m._data && (
                    m._data.isVideo ||
                    m._data.isVideoCall ||
                    String(m._data.subtype || '').includes('video') ||
                    String(m._data.body || '').includes('video') ||
                    String(m._data.body || '').includes('📹')
                  ))
                );
                const rawCallMsg = {
                  id: msgId || `msg_call_${m.t}`,
                  from: peerJid,
                  timestamp: m.t || Math.floor(Date.now() / 1000),
                  isGroup: false,
                  isVideo: isVidMsg,
                  isVideoCall: isVidMsg,
                  isGroupCall: false,
                  canHandleLocally: true,
                  status: status,
                  duration: durSec
                };
                results.push({
                  callId: msgId || `msg_call_${m.t}_${m.id?.id || Math.random()}`,
                  peerJid,
                  isVideo: isVidMsg,
                  outgoing: isFromMe,
                  isMissed: isMissed,
                  isRejected: isRejected,
                  status: status,
                  timestamp: m.t || Math.floor(Date.now() / 1000),
                  duration: durSec,
                  rawCall: rawCallMsg
                });
              }
            }
          };

          const msgCol = window.require ? window.require('WAWebCollections')?.Msg : null;
          const allMsgs = msgCol?.getModelsArray ? msgCol.getModelsArray() : (window.Store?.Msg?.models || []);
          allMsgs.forEach(m => processMsg(m));

          const loader = window.require ? window.require('WAWebChatLoadMessages') : null;
          for (const chat of chats) {
            if (!chat || chat.isGroup) continue;
            if (loader && loader.loadEarlierMsgs) {
              try {
                for (let i = 0; i < 4; i++) {
                  const msgsBefore = chat.msgs?.models?.length || 0;
                  await loader.loadEarlierMsgs({ chat });
                  const msgsAfter = chat.msgs?.models?.length || 0;
                  if (msgsAfter <= msgsBefore) break;
                }
              } catch (_) {}
            }
            const chatJid = chat.id?._serialized || (typeof chat.id === 'string' ? chat.id : '');
            const chatMsgs = chat.msgs?.models || [];
            chatMsgs.forEach(m => processMsg(m, chatJid));
          }

          return results;
        } catch (err) {
          return { evalError: err.message || String(err) };
        }
      });

      if (!this.botPhone && this.client?.info?.wid?.user) {
        this.botPhone = this.client.info.wid.user;
      }
      if (!this.botPhone && this.client?.pupPage) {
        try {
          const pUser = await this.client.pupPage.evaluate(() => {
            const conn = window.Store?.Conn || (window.require ? window.require('WAWebConn')?.Conn : null);
            return conn?.wid?.user || conn?.me?.user || null;
          });
          if (pUser) this.botPhone = String(pUser).replace(/[^0-9]/g, '');
        } catch (_) {}
      }

      const activeProcessedIds = [];

      if (Array.isArray(browserCalls) && browserCalls.length > 0) {
        for (const c of browserCalls) {
          if (!c.peerJid || c.peerJid.includes('@g.us') || c.peerJid.includes('@newsletter') || c.peerJid.startsWith('group-')) continue;

          const rawNumber = String(c.peerJid).replace('@c.us', '').replace('@lid', '').split(':')[0];
          let phoneNumber = rawNumber.startsWith('+') ? rawNumber : `+${rawNumber}`;
          let customerName = phoneNumber;
          const mediaType = c.isVideo ? 'video' : 'voice';
          const callType = c.isMissed ? (c.outgoing ? 'outgoing' : 'missed') : (c.outgoing ? 'outgoing' : 'incoming');
          const callId = String(c.callId).slice(0, 100);

          try {
            const [cust] = await pool.execute(
              `SELECT name, phone_number FROM customers 
               WHERE (REPLACE(REPLACE(phone_number, '+', ''), ' ', '') = ? OR whatsapp_jid LIKE ?) 
                 AND (user_id = ? OR user_id IS NULL) 
               LIMIT 1`,
              [rawNumber, `%${rawNumber}%`, this.userId]
            );
            if (cust.length > 0 && cust[0].name) {
              customerName = cust[0].name;
              if (cust[0].phone_number) {
                const cleanCustPhone = cust[0].phone_number.replace(/[^0-9]/g, '');
                phoneNumber = cleanCustPhone.startsWith('+') ? cleanCustPhone : `+${cleanCustPhone}`;
              }
            } else if (this.client) {
              const contact = await this.client.getContactById(c.peerJid);
              if (contact && (contact.name || contact.pushname)) {
                customerName = contact.name || contact.pushname;
              }
            }
          } catch (_) {}

          let tsSeconds = typeof c.timestamp === 'number' ? c.timestamp : parseInt(c.timestamp, 10);
          if (tsSeconds > 1e11) {
            tsSeconds = Math.floor(tsSeconds / 1000);
          }
          const isoDate = new Date(tsSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');

          const baseCallId = String(callId).replace(/^msg_call_\d+_/, '');

          const [exist] = await pool.execute(
            `SELECT id, duration, call_type, media_type FROM whatsapp_calls 
             WHERE user_id = ? AND (
               call_id = ? OR 
               (call_id LIKE CONCAT('%', ?, '%') AND LENGTH(?) >= 8)
             ) LIMIT 1`,
            [this.userId, callId, baseCallId, baseCallId]
          );

          const rawCallJson = c.rawCall ? JSON.stringify(c.rawCall) : null;
          const durationVal = (c.duration !== null && c.duration !== undefined && typeof c.duration === 'number') ? String(c.duration) : null;

          if (exist.length > 0) {
            const updateCols = [];
            const updateVals = [];
            if (this.botPhone) {
              updateCols.push('account_phone = ?');
              updateVals.push(this.botPhone);
            }
            if (durationVal && (!exist[0].duration || exist[0].duration === 'null')) {
              updateCols.push('duration = ?');
              updateVals.push(durationVal);
            }
            if (mediaType === 'video' && exist[0].media_type !== 'video') {
              updateCols.push('media_type = "video"');
            }
            if (callType && exist[0].call_type !== callType) {
              updateCols.push('call_type = ?');
              updateVals.push(callType);
            }
            if (rawCallJson) {
              updateCols.push('raw_call = ?');
              updateVals.push(rawCallJson);
            }
            if (updateCols.length > 0) {
              updateVals.push(exist[0].id);
              await pool.execute(`UPDATE whatsapp_calls SET ${updateCols.join(', ')} WHERE id = ?`, updateVals);
            }
            activeProcessedIds.push(exist[0].id);
          } else {
            const [insertRes] = await pool.execute(
              `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, raw_call, created_at, user_id, account_phone)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [callId, phoneNumber, customerName, callType, mediaType, durationVal, rawCallJson, isoDate, this.userId, this.botPhone || null]
            );
            if (insertRes && insertRes.insertId) {
              activeProcessedIds.push(insertRes.insertId);
            }
          }
        }

        // Purge any stale calls from previous WhatsApp connections that are NOT part of the active session
        try {
          if (activeProcessedIds.length > 0) {
            const placeholders = activeProcessedIds.map(() => '?').join(',');
            await pool.execute(
              `DELETE FROM whatsapp_calls 
               WHERE user_id = ? AND id NOT IN (${placeholders}) 
                 AND (account_phone IS NULL OR (account_phone != ? AND ? != ''))`,
              [this.userId, this.botPhone || '', this.botPhone || '']
            );
          }
        } catch (purgeErr) {
          console.warn(`[WhatsApp:${this.userId}] Error purging stale calls:`, purgeErr.message);
        }
      } else if (Array.isArray(browserCalls) && browserCalls.length === 0) {
        // If current session has 0 calls, purge old calls from previous sessions
        try {
          await pool.execute('DELETE FROM whatsapp_calls WHERE user_id = ?', [this.userId]);
        } catch (_) {}
      }
    } catch (err) {
      console.warn(`[WhatsApp:${this.userId}] syncWhatsAppCallsFromBrowser error:`, err.message);
    }
  }

  async getCallLogs(limit = 50) {
    try {
      await this.syncWhatsAppCallsFromBrowser();

      if (!this.botPhone && this.client?.info?.wid?.user) {
        this.botPhone = this.client.info.wid.user;
      }

      try {
        await pool.execute(
          `UPDATE whatsapp_calls wc
           JOIN customers c ON (
             REPLACE(REPLACE(wc.phone_number, '+', ''), ' ', '') = REPLACE(REPLACE(c.phone_number, '+', ''), ' ', '')
             OR (c.whatsapp_jid IS NOT NULL AND c.whatsapp_jid LIKE CONCAT('%', REPLACE(REPLACE(wc.phone_number, '+', ''), ' ', ''), '%'))
           ) AND (c.user_id = wc.user_id OR c.user_id IS NULL)
           SET wc.customer_name = c.name
           WHERE (wc.customer_name IS NULL OR wc.customer_name = '' OR LOWER(wc.customer_name) = 'vaishnavi' OR wc.customer_name = wc.phone_number)
             AND c.name IS NOT NULL AND c.name != ''`
        );
      } catch (_) {}

      const [rows] = await pool.execute(
        `SELECT 
          wc.id,
          wc.call_id as callId,
          COALESCE(
            (SELECT c.name FROM customers c WHERE (REPLACE(REPLACE(c.phone_number, '+', ''), ' ', '') = REPLACE(REPLACE(wc.phone_number, '+', ''), ' ', '') OR (c.whatsapp_jid IS NOT NULL AND c.whatsapp_jid LIKE CONCAT('%', REPLACE(REPLACE(wc.phone_number, '+', ''), ' ', ''), '%'))) AND (c.user_id = wc.user_id OR c.user_id IS NULL) LIMIT 1),
            IF(wc.customer_name IS NOT NULL AND wc.customer_name != '' AND LOWER(wc.customer_name) NOT IN ('vaishnavi', 'me', 'you'), wc.customer_name, NULL),
            wc.phone_number
          ) as customerName,
          wc.phone_number as phoneNumber,
          wc.call_type as callType,
          wc.media_type as mediaType,
          wc.duration,
          wc.raw_call as rawCall,
          DATE_FORMAT(wc.created_at, '%Y-%m-%dT%H:%i:%s.000Z') as timestamp
         FROM whatsapp_calls wc
         WHERE wc.user_id = ? ${this.botPhone ? 'AND (wc.account_phone = ? OR wc.account_phone IS NULL)' : ''}
         ORDER BY wc.created_at DESC, wc.id DESC
         LIMIT ${parseInt(limit, 10) || 50}`,
        this.botPhone ? [this.userId, this.botPhone] : [this.userId]
      );

      const uniqueList = [];
      for (const r of rows) {
        let rawCall = null;
        if (r.rawCall) {
          try {
            rawCall = typeof r.rawCall === 'string' ? JSON.parse(r.rawCall) : r.rawCall;
          } catch (_) {}
        }
        if (!rawCall) {
          rawCall = {
            id: r.callId || String(r.id),
            from: r.phoneNumber,
            timestamp: r.timestamp,
            isGroup: false,
            isVideo: r.mediaType === 'video',
            isVideoCall: r.mediaType === 'video',
            isGroupCall: false,
            canHandleLocally: true
          };
        }

        const isVideo = !!(
          rawCall.isVideo === true ||
          rawCall.isVideoCall === true ||
          (rawCall._data && (rawCall._data.isVideo === true || rawCall._data.isVideoCall === true)) ||
          String(rawCall.offerType || '').toLowerCase() === 'video' ||
          String(rawCall.mediaType || '').toLowerCase() === 'video' ||
          String(rawCall.subtype || rawCall._data?.subtype || '').toLowerCase().includes('video')
        );

        const mediaType = isVideo ? 'video' : 'voice';

        // Parse integer duration
        let durationSec = null;
        if (r.duration) {
          const match = String(r.duration).match(/(\d+)/);
          if (match) {
            const parsed = parseInt(match[1], 10);
            if (!isNaN(parsed) && parsed > 0) durationSec = parsed;
          }
        }

        const isMissed = r.callType === 'missed' || rawCall.isMissed || rawCall.status === 'missed';
        const isRejected = rawCall.status === 'rejected' || rawCall.isRejected;
        let callStatus = 'unknown';
        if (isMissed) {
          callStatus = 'missed';
          durationSec = null;
        } else if (isRejected) {
          callStatus = 'rejected';
          durationSec = null;
        } else if (durationSec !== null && durationSec > 0) {
          callStatus = 'answered';
        } else if (rawCall.status) {
          callStatus = rawCall.status;
        }

        const baseId = String(r.callId || '').replace(/^msg_call_\d+_/, '');
        const isDup = uniqueList.some(u => {
          const uBaseId = String(u.callId || '').replace(/^msg_call_\d+_/, '');
          return !!(baseId && uBaseId && (baseId === uBaseId || baseId.includes(uBaseId) || uBaseId.includes(baseId)));
        });

        if (!isDup) {
          uniqueList.push({
            id: String(r.id || r.callId),
            callId: r.callId,
            phoneNumber: r.phoneNumber,
            customerName: r.customerName,
            callType: isMissed ? 'missed' : (r.callType || 'incoming'),
            status: callStatus,
            mediaType: mediaType,
            timestamp: r.timestamp,
            duration: durationSec,
            isVideo: isVideo,
            isVideoCall: isVideo,
            rawCall: rawCall
          });
        }
      }

      return uniqueList;
    } catch (err) {
      console.error(`[WhatsApp:${this.userId}] Error getting call logs:`, err.message);
      return [];
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      status: this.status,
      phone: this.botPhone,
      name: this.botName,
      hasQr: !!this.latestQrDataUrl,
      lastUpdated: this.lastUpdated
    };
  }

  getQr() {
    if (this.status === 'waiting' && this.lastUpdated) {
      const ageMs = Date.now() - new Date(this.lastUpdated).getTime();
      if (ageMs > 45000) {
        this.refreshQr().catch(() => { });
      }
    }

    return {
      status: this.status,
      isConnected: this.isConnected,
      qrDataUrl: this.latestQrDataUrl,
      qrString: this.latestQrString,
      lastUpdated: this.lastUpdated
    };
  }

  broadcastCurrentStatus() {
    const statusData = this.getStatus();
    // Broadcast with userId so frontend can filter events for this user
    socketService.broadcastWhatsAppStatus({ ...statusData, userId: this.userId });
  }

  async logCallDirectly({ conversationId, phoneNumber, mediaType = 'voice', callType = 'outgoing' }) {
    try {
      const rawNumber = String(phoneNumber).replace(/[^0-9]/g, '');
      const formattedPhone = rawNumber.startsWith('+') ? rawNumber : `+${rawNumber}`;
      const mediaLabel = mediaType === 'video' ? 'video' : 'voice';
      const callStatus = callType === 'missed' ? 'missed' : 'unknown';
      const callMsgText = mediaLabel === 'video'
        ? (callType === 'missed' ? '📹 Missed video call' : (callType === 'outgoing' ? '📹 Outgoing video call' : '📹 Video call'))
        : (callType === 'missed' ? '📞 Missed voice call' : (callType === 'outgoing' ? '📞 Outgoing voice call' : '📞 Voice call'));

      let customerName = formattedPhone;
      try {
        const [cust] = await pool.execute(
          `SELECT name FROM customers 
           WHERE (REPLACE(REPLACE(phone_number, '+', ''), ' ', '') = ? OR whatsapp_jid LIKE ?) 
             AND (user_id = ? OR user_id IS NULL) 
           LIMIT 1`,
          [rawNumber, `%${rawNumber}%`, this.userId]
        );
        if (cust.length > 0 && cust[0].name) {
          customerName = cust[0].name;
        }
      } catch (_) {}

      const safeCallId = `call_manual_${Date.now()}`;
      const rawCallJson = JSON.stringify({
        id: safeCallId,
        from: formattedPhone,
        timestamp: Math.floor(Date.now() / 1000),
        isGroup: false,
        isVideo: mediaLabel === 'video',
        isVideoCall: mediaLabel === 'video',
        fromMe: callType === 'outgoing',
        status: callStatus
      });

      await pool.execute(
        `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, raw_call, created_at, user_id, account_phone)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NOW(), ?, ?)`,
        [safeCallId, formattedPhone, customerName, callType === 'missed' ? 'missed' : (callType === 'incoming' ? 'incoming' : 'outgoing'), mediaLabel, rawCallJson, this.userId, this.botPhone || null]
      );

      if (conversationId) {
        const [convRows] = await pool.execute(
          'SELECT id, customer_id FROM conversations WHERE id = ? AND user_id = ? LIMIT 1',
          [conversationId, this.userId]
        );
        if (convRows.length > 0) {
          const customerId = convRows[0].customer_id;
          const nowMs = Date.now();
          const utcStr = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
          const metadataJson = JSON.stringify({
            isCall: true,
            status: callStatus,
            callType: callType === 'incoming' ? 'incoming' : 'outgoing',
            mediaType: mediaLabel,
            duration: null,
            whatsappCallId: safeCallId
          });

          const [insertMsg] = await pool.execute(
            `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
             VALUES (?, ?, ?, ?, ?, 'call', ?, 'delivered', ?, ?, ?)`,
            [conversationId, customerId, callType === 'incoming' ? 'incoming' : 'outgoing', callMsgText, safeCallId, nowMs, utcStr, this.userId, metadataJson]
          );

          await pool.execute(
            'UPDATE conversations SET last_message_at = ? WHERE id = ?',
            [utcStr, conversationId]
          );

          const Message = require('../models/Message');
          const Conversation = require('../models/Conversation');
          const savedMsg = await Message.findById(insertMsg.insertId);
          const updatedConv = await Conversation.findById(conversationId);
          socketService.broadcastNewMessage(conversationId, savedMsg);
          socketService.broadcastConversationUpdate(updatedConv);
        }
      }
    } catch (err) {
      console.error('[WhatsAppService] logCallDirectly error:', err.message);
    }
  }
}

// Export the CLASS (not a singleton) — each user gets their own instance via sessionManager
module.exports = WhatsAppService;
