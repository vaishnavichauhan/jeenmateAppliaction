const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const pool = require('../config/db');
const socketService = require('./socketService');
const { Conversation, Message } = require('../models');

class WhatsAppService {
  constructor() {
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
      const sessionDir = path.join(config.WHATSAPP_SESSION_PATH, `session-${config.WHATSAPP_CLIENT_ID}`);
      this.cleanSingletonLocks(sessionDir);

      const executablePath = this.getExecutablePath();
      console.log(`[WhatsApp] Using Chrome executable: ${executablePath || 'Puppeteer default'}`);
      console.log(`[WhatsApp] Using Session Path: ${config.WHATSAPP_SESSION_PATH}, ClientId: ${config.WHATSAPP_CLIENT_ID}`);

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
          '--disable-gpu'
        ]
      };

      if (executablePath) {
        puppeteerOptions.executablePath = executablePath;
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: config.WHATSAPP_SESSION_PATH,
          clientId: config.WHATSAPP_CLIENT_ID
        }),
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
        } catch (_) {}
      });
    }
  }

  setupEventListeners() {
    if (!this.client) return;

    // QR Event
    this.client.on('qr', async (qr) => {
      console.log('\n======================================================');
      console.log('  [WhatsApp] SCAN QR CODE TO LINK WHATSAPP:');
      console.log('  Open WhatsApp > Settings > Linked Devices > Link a Device');
      console.log('======================================================\n');
      try {
        qrcode.toString(qr, { type: 'terminal', small: true }, (err, str) => {
          if (!err && str) {
            console.log(str);
          }
        });
      } catch (_) {}

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
    this.client.on('authenticated', () => {
      console.log('[WhatsApp] Client Authenticated.');
      this.status = 'online';
      this.isConnected = true;
      this.latestQrString = null;
      this.latestQrDataUrl = null;
      this.lastUpdated = new Date().toISOString();
      this.broadcastCurrentStatus();
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
      console.log('[WhatsApp] Client is Ready!');
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

      // Trigger automatic background sync of chats
      setTimeout(() => {
        console.log('[WhatsApp] Auto-syncing chats from active session...');
        this.syncChats({ cleanOld: false }).catch(err => {
          console.error('[WhatsApp] Auto-sync error:', err.message);
        });
      }, 2000);
    });

    // Disconnected Event
    this.client.on('disconnected', (reason) => {
      console.log('[WhatsApp] Client was logged out or disconnected:', reason);
      this.status = 'offline';
      this.isConnected = false;
      this.botPhone = null;
      this.botName = null;
      this.lastUpdated = new Date().toISOString();
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
  }

  async handleIncomingMessage(msg) {
    if (!msg || msg.isStatus) {
      return;
    }

    const fromMe = !!msg.fromMe;
    const targetJid = fromMe ? msg.to : msg.from;
    if (!targetJid || targetJid.includes('@g.us') || targetJid.includes('@newsletter')) {
      return;
    }

    const rawNumber = targetJid.replace('@c.us', '').replace('@lid', '');
    const phoneNumber = rawNumber.startsWith('+') ? rawNumber : `+${rawNumber}`;
    const text = msg.body || (msg.hasMedia ? '[Media message]' : '');

    let contactName = phoneNumber;
    try {
      const contact = await msg.getContact();
      if (contact && (contact.name || contact.pushname)) {
        contactName = contact.name || contact.pushname;
      }
    } catch (e) {}

    // Find or create customer in MySQL
    let customerId = null;
    const [custRows] = await pool.execute(
      'SELECT id, name FROM customers WHERE phone_number = ? OR whatsapp_jid = ? LIMIT 1',
      [phoneNumber, targetJid]
    );

    if (custRows.length > 0) {
      customerId = custRows[0].id;
      if (custRows[0].name === phoneNumber && contactName !== phoneNumber) {
        await pool.execute('UPDATE customers SET name = ? WHERE id = ?', [contactName, customerId]);
      }
    } else {
      const [insertCust] = await pool.execute(
        'INSERT INTO customers (phone_number, name, whatsapp_jid) VALUES (?, ?, ?)',
        [phoneNumber, contactName, targetJid]
      );
      customerId = insertCust.insertId;
    }

    // Find or create conversation in MySQL
    let convId = null;
    const [convRows] = await pool.execute(
      'SELECT id, unread_count FROM conversations WHERE customer_id = ? LIMIT 1',
      [customerId]
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
        'INSERT INTO conversations (customer_id, status, last_message_at, unread_count) VALUES (?, "open", ?, ?)',
        [customerId, utcStr, unreadIncrement]
      );
      convId = insertConv.insertId;
    }

    // Insert message — guard against duplicates by whatsapp_message_id or content match
    const direction = fromMe ? 'outgoing' : 'incoming';
    const safeText = typeof text === 'string' ? text : String(text || '');
    const safeMsgId = (msg.id && msg.id._serialized) ? msg.id._serialized : (typeof msg.id === 'string' ? msg.id : null);

    // Skip if this exact WhatsApp message was already saved (or matches recent conversation message created in the last 60s)
    const [existCheck] = await pool.execute(
      `SELECT id, whatsapp_message_id FROM messages 
       WHERE conversation_id = ? AND (
         (whatsapp_message_id IS NOT NULL AND whatsapp_message_id = ?) OR 
         (direction = ? AND message = ? AND created_at >= NOW() - INTERVAL 60 SECOND)
       ) ORDER BY id DESC LIMIT 1`,
      [convId, safeMsgId || '', direction, safeText]
    );

    if (existCheck.length > 0) {
      if (!existCheck[0].whatsapp_message_id && safeMsgId) {
        await pool.execute('UPDATE messages SET whatsapp_message_id = ? WHERE id = ?', [safeMsgId, existCheck[0].id]);
      }
      console.log(`[WhatsApp] Skipping duplicate message (already saved): ${safeMsgId || safeText}`);
      return;
    }

    const [insertMsg] = await pool.execute(
      `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'text', 'delivered', ?)`,
      [convId, customerId, direction, safeText, safeMsgId, utcStr]
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
      return { success: true, messageId: result.id ? result.id._serialized : null };
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

  async restart(clean = false) {
    console.log(`[WhatsApp] Restarting session (clean=${clean})...`);
    try {
      if (this.client) {
        await this.client.destroy().catch(() => {});
        this.client = null;
      }

      this.status = 'offline';
      this.isConnected = false;
      this.latestQrString = null;
      this.latestQrDataUrl = null;
      this.botPhone = null;
      this.botName = null;

      const sessionFolder = path.join(config.WHATSAPP_SESSION_PATH, `session-${config.WHATSAPP_CLIENT_ID}`);
      if (clean && fs.existsSync(sessionFolder)) {
        console.log('[WhatsApp] Clearing session folder:', sessionFolder);
        fs.rmSync(sessionFolder, { recursive: true, force: true });
      }

      this.broadcastCurrentStatus();
      await this.initialize();
      return { success: true, message: 'Session restarted successfully.' };
    } catch (err) {
      console.error('[WhatsApp] Restart error:', err);
      return { success: false, error: err.message };
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
              if (c.msgs && c.msgs.last) {
                msg = c.msgs.last();
              }
              if (!msg && c.lastReceivedKey) {
                const msgCol = window.require ? window.require('WAWebCollections')?.Msg : null;
                msg = msgCol?.get ? msgCol.get(c.lastReceivedKey._serialized || c.lastReceivedKey) : null;
              }
              if (msg) {
                const mType = msg.type;
                const b = msg.body || '';
                if (mType === 'image' || b.startsWith('/9j/') || (b.length > 100 && /^[A-Za-z0-9+/=]+$/.test(b.slice(0, 40)))) {
                  lastMsgText = '📷 Photo';
                } else if (mType === 'video') {
                  lastMsgText = '🎥 Video';
                } else if (mType === 'audio' || mType === 'ptt') {
                  lastMsgText = '🎵 Voice message';
                } else if (mType === 'document') {
                  lastMsgText = msg.filename ? `📄 ${msg.filename}` : '📄 Document';
                } else if (mType === 'sticker') {
                  lastMsgText = '🏷️ Sticker';
                } else if (mType === 'location') {
                  lastMsgText = '📍 Location';
                } else if (mType === 'vcard' || mType === 'multi_vcard') {
                  lastMsgText = '👤 Contact';
                } else if (mType === 'call_log') {
                  lastMsgText = '📞 Call';
                } else if (mType === 'gp2') {
                  lastMsgText = 'Group update';
                } else if (mType === 'e2e_notification') {
                  lastMsgText = 'End-to-end encrypted';
                } else if (mType === 'notification_template') {
                  lastMsgText = 'Notification';
                } else if (mType && mType !== 'chat') {
                  lastMsgText = `[${mType}]`;
                } else {
                  lastMsgText = b;
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
                    } catch (_) {}
                  }
                  if (!sender && msg.author?.user) {
                    try {
                      const contactCol = window.require ? window.require('WAWebCollections')?.Contact : null;
                      const models = contactCol?.getModelsArray ? contactCol.getModelsArray() : [];
                      const found = models.find(m => m.id?.user === msg.author.user);
                      if (found) sender = found.name || found.pushname || found.formattedName || '';
                    } catch (_) {}
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
            } catch (_) {}

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

  async fetchMessagesForChat(jid, limit = 60) {
    if (!this.client || !this.client.pupPage) return [];

    try {
      const messages = await this.client.pupPage.evaluate(async ({ targetJid, maxMsgs }) => {
        try {
          let chat = null;
          if (window.WWebJS && window.WWebJS.getChat) {
            try {
              chat = await window.WWebJS.getChat(targetJid, { getAsModel: false });
            } catch (_) {}
          }
          if (!chat) {
            const chatCol = window.require ? window.require('WAWebCollections')?.Chat : null;
            chat = chatCol?.get ? chatCol.get(targetJid) : null;
          }
          if (!chat) return [];

          // Load earlier messages using WAWebChatLoadMessages
          const loader = window.require ? window.require('WAWebChatLoadMessages') : null;
          if (loader && loader.loadEarlierMsgs) {
            try {
              await loader.loadEarlierMsgs({ chat });
            } catch (_) {}
          }

          let msgs = [];
          if (chat.msgs && chat.msgs.getModelsArray) {
            msgs = chat.msgs.getModelsArray();
          } else if (chat.msgs && Array.isArray(chat.msgs.models)) {
            msgs = chat.msgs.models;
          }

          const slice = msgs.slice(-maxMsgs);
          return slice.map(m => {
            const isFromMe = !!(m.id?.fromMe || m.fromMe);
            let bodyText = m.body || '';
            const mType = m.type || 'chat';

            if (mType === 'image' || bodyText.startsWith('/9j/') || (bodyText.length > 100 && /^[A-Za-z0-9+/=]+$/.test(bodyText.slice(0, 40)))) {
              bodyText = m.caption || '📷 Photo';
            } else if (mType === 'video') {
              bodyText = m.caption || '🎥 Video';
            } else if (mType === 'audio' || mType === 'ptt') {
              bodyText = '🎵 Voice message';
            } else if (mType === 'document') {
              bodyText = m.filename ? `📄 ${m.filename}` : (m.caption || '📄 Document');
            } else if (mType === 'sticker') {
              bodyText = '🏷️ Sticker';
            } else if (mType === 'location') {
              bodyText = '📍 Location';
            } else if (mType === 'vcard') {
              bodyText = '👤 Contact';
            } else if (mType === 'call_log') {
              bodyText = '📞 Call';
            } else if (mType !== 'chat' && !bodyText) {
              bodyText = `[${mType}]`;
            }

            const msgId = m.id
              ? (m.id.id || m.id._serialized || m.id.$1 || (typeof m.id === 'string' ? m.id : null))
              : `msg_${m.t}_${isFromMe ? 'out' : 'in'}`;

            return {
              id: msgId,
              body: bodyText,
              type: mType || 'text',
              timestamp: m.t || Math.floor(Date.now() / 1000),
              fromMe: isFromMe,
              status: m.ack === 3 ? 'read' : (m.ack === 2 ? 'delivered' : 'sent')
            };
          });
        } catch (err) {
          return [];
        }
      }, { targetJid: jid, maxMsgs: limit });

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

        activeJids.add(chat.id);
        const jid = String(chat.id).slice(0, 100);
        const name = String(chat.name || 'Contact').slice(0, 100);

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

        const timestampSeconds = chat.timestamp || 0;
        const isoDate = timestampSeconds > 0
          ? new Date(timestampSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : '2000-01-01 00:00:00';

        // 1. Upsert Customer safely
        let customerId = null;
        const [byJid] = await pool.execute('SELECT id FROM customers WHERE whatsapp_jid = ? LIMIT 1', [jid]);
        if (byJid.length > 0) {
          customerId = byJid[0].id;
          try {
            await pool.execute('UPDATE customers SET name = ?, phone_number = ? WHERE id = ?', [name, phone, customerId]);
          } catch (_) {
            await pool.execute('UPDATE customers SET name = ? WHERE id = ?', [name, customerId]);
          }
        } else {
          const [byPhone] = await pool.execute('SELECT id FROM customers WHERE phone_number = ? LIMIT 1', [phone]);
          if (byPhone.length > 0) {
            customerId = byPhone[0].id;
            await pool.execute('UPDATE customers SET name = ?, whatsapp_jid = ? WHERE id = ?', [name, jid, customerId]);
          } else {
            try {
              const [insCust] = await pool.execute(
                'INSERT INTO customers (name, phone_number, whatsapp_jid) VALUES (?, ?, ?)',
                [name, phone, jid]
              );
              customerId = insCust.insertId;
            } catch (dupErr) {
              const [fallback] = await pool.execute(
                'SELECT id FROM customers WHERE whatsapp_jid = ? OR phone_number = ? LIMIT 1',
                [jid, phone]
              );
              if (fallback.length > 0) {
                customerId = fallback[0].id;
                await pool.execute('UPDATE customers SET name = ? WHERE id = ?', [name, customerId]);
              }
            }
          }
        }
        if (!customerId) continue;

        // 2. Upsert Conversation
        let convId;
        const [existingConv] = await pool.execute(
          'SELECT id FROM conversations WHERE customer_id = ? LIMIT 1',
          [customerId]
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
            'INSERT INTO conversations (customer_id, status, last_message_at, unread_count, is_pinned) VALUES (?, "open", ?, ?, ?)',
            [customerId, isoDate, unread, isPinned]
          );
          convId = insConv.insertId;
        }

        // 3. Insert or update last message preview
        if (chat.lastMessage) {
          const msgText = typeof chat.lastMessage === 'string' ? chat.lastMessage : String(chat.lastMessage);
          const safeMsgId = chat.lastMsgId ? String(chat.lastMsgId).slice(0, 191) : null;
          const [existingMsg] = await pool.execute(
            'SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
            [convId]
          );
          const direction = chat.fromMe ? 'outgoing' : 'incoming';

          if (existingMsg.length === 0) {
            try {
              await pool.execute(
                `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, status, created_at)
                 VALUES (?, ?, ?, ?, ?, 'text', 'delivered', ?)`,
                [convId, customerId, direction, msgText, safeMsgId, isoDate]
              );
            } catch (_) {}
          } else {
            try {
              await pool.execute(
                `UPDATE messages SET message = ?, direction = ?, created_at = ? WHERE id = ?`,
                [msgText, direction, isoDate, existingMsg[0].id]
              );
            } catch (_) {}
          }
        }

        syncedCount++;
      }

      // Clean up stale conversations from old session
      if (options.cleanOld || (chats.length > 0 && !options.preserveOld)) {
        if (activeJids.size > 0) {
          const [staleCusts] = await pool.execute(
            `SELECT id FROM customers WHERE whatsapp_jid IS NOT NULL AND whatsapp_jid NOT IN (${Array.from(activeJids).map(() => '?').join(',')})`,
            Array.from(activeJids)
          );

          if (staleCusts.length > 0) {
            const staleIds = staleCusts.map(c => c.id);
            console.log(`[WhatsApp] Purging ${staleIds.length} stale conversations not in active session...`);
            for (let i = 0; i < staleIds.length; i += 50) {
              const chunk = staleIds.slice(i, i + 50);
              const placeholders = chunk.map(() => '?').join(',');
              await pool.execute(`DELETE FROM messages WHERE customer_id IN (${placeholders})`, chunk);
              await pool.execute(`DELETE FROM conversations WHERE customer_id IN (${placeholders})`, chunk);
              await pool.execute(`DELETE FROM customers WHERE id IN (${placeholders})`, chunk);
            }
          }
        }
      }

      socketService.broadcastConversationUpdate({ synced: true, count: syncedCount });

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
        this.refreshQr().catch(() => {});
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
    socketService.broadcastWhatsAppStatus(statusData);
  }
}

const whatsappService = new WhatsAppService();
module.exports = whatsappService;
