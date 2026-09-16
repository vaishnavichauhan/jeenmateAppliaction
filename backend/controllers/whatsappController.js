const pool = require('../config/db');
const sessionManager = require('../services/sessionManager');

/**
 * Helper: get the WhatsApp session for the authenticated user.
 * Auto-creates and initializes if not yet started.
 */
async function getUserSession(req) {
  const userId = req.user.id;
  return sessionManager.getOrCreateSession(userId);
}

// GET /api/whatsapp/status
async function getStatus(req, res, next) {
  try {
    const userId = req.user.id;
    const service = sessionManager.getSession(userId);
    if (!service) {
      return res.status(200).json({
        success: true,
        data: {
          isConnected: false,
          status: 'offline',
          phone: null,
          name: null,
          hasQr: false,
          lastUpdated: new Date().toISOString()
        }
      });
    }
    return res.status(200).json({
      success: true,
      data: service.getStatus()
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/qr
async function getQr(req, res, next) {
  try {
    const service = await getUserSession(req);
    return res.status(200).json({
      success: true,
      data: service.getQr()
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/call-logs
async function getCallLogs(req, res, next) {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit, 10) || 50;

    const service = await getUserSession(req);
    const isConnected = !!(service && service.isConnected);

    if (isConnected) {
      const callLogs = await service.getCallLogs(limit);
      return res.status(200).json({
        success: true,
        isConnected: true,
        data: callLogs
      });
    }

    return res.status(200).json({
      success: true,
      isConnected: false,
      data: []
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/qr-inspect
async function inspectQrPage(req, res, next) {
  try {
    const service = await getUserSession(req);
    if (!service.client || !service.client.pupPage) {
      return res.json({ success: false, message: 'Client or pupPage not ready' });
    }
    const info = await service.client.pupPage.evaluate(() => {
      const qrCanvas = document.querySelector('canvas');
      const qrContainer = document.querySelector('[data-ref]');
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.innerText,
        className: b.className,
        role: b.getAttribute('role')
      }));
      const bodyText = document.body.innerText.slice(0, 500);
      return {
        title: document.title,
        hasCanvas: !!qrCanvas,
        qrContainerRef: qrContainer ? qrContainer.getAttribute('data-ref') : null,
        buttons,
        bodyText
      };
    });
    return res.json({ success: true, info });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
}

// POST /api/whatsapp/restart
async function restartSession(req, res, next) {
  try {
    const service = await getUserSession(req);
    const clean = req.query.clean === 'true';
    const result = await service.restart(clean);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/whatsapp/sync
async function syncChats(req, res, next) {
  try {
    const service = await getUserSession(req);
    const cleanOld = req.query.clean === 'true' || req.body?.clean === true;
    const result = await service.syncChats({ cleanOld });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/qr-page (HTML page for browser scanning)
function getQrPage(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>jeenMate WhatsApp Session Link</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #1A3B71;
      --primary-navy: #16325B;
      --deep-navy: #0B192C;
      --dark-navy: #070F1E;
      --accent-red: #E11D48;
      --accent-lime: #E8FE26;
      --bg-linen: #F5F4F0;
      --border-color: #E6E4DC;
      --text-dark: #0F172A;
      --bg-white: #FFFFFF;
      --wa-green: #00A884;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background-color: var(--bg-linen);
      color: var(--text-dark);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      background: var(--bg-white);
      max-width: 520px;
      width: 100%;
      border-radius: 20px;
      border: 1px solid var(--border-color);
      box-shadow: 0 20px 40px -15px rgba(11, 25, 44, 0.08);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, var(--deep-navy), var(--primary-navy));
      padding: 28px 24px;
      color: white;
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .badge.waiting { background: rgba(232, 254, 38, 0.18); color: var(--accent-lime); }
    .badge.online { background: rgba(0, 168, 132, 0.2); color: #25D366; }
    .badge.offline { background: rgba(225, 29, 72, 0.2); color: #FF6B8B; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
    p.sub { font-size: 14px; opacity: 0.85; }
    .content { padding: 32px 24px; text-align: center; }
    .qr-box {
      width: 280px; height: 280px; margin: 0 auto 24px;
      border: 2px dashed var(--border-color); border-radius: 16px;
      display: flex; align-items: center; justify-content: center;
      background: #FAFAFA; position: relative;
    }
    .qr-box img { width: 100%; height: 100%; border-radius: 14px; object-fit: contain; }
    .instructions {
      text-align: left; background: #F8F9FA; border-radius: 12px;
      padding: 16px 20px; font-size: 13px; line-height: 1.6;
      margin-bottom: 24px; border: 1px solid var(--border-color);
    }
    .instructions ol { padding-left: 20px; }
    .instructions li { margin-bottom: 6px; }
    .btn-group { display: flex; gap: 12px; }
    button {
      flex: 1; padding: 12px 18px; border-radius: 10px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      border: none; transition: all 0.2s ease;
    }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: var(--primary-navy); }
    .btn-danger { background: #FEE2E2; color: var(--accent-red); }
    .btn-danger:hover { background: #FCA5A5; }
    .footer { text-align: center; margin-top: 18px; font-size: 12px; color: #64748B; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div id="statusBadge" class="badge waiting">
        <span class="dot"></span>
        <span id="statusText">Checking WhatsApp...</span>
      </div>
      <h1>jeenMate WhatsApp Link</h1>
      <p class="sub">Scan with your personal WhatsApp to link your session</p>
    </div>
    <div class="content">
      <div class="qr-box" id="qrContainer">
        <div id="loadingText" style="color: #64748B; font-size: 14px;">Loading QR code...<br><small style="margin-top:8px;display:block">Please log in from the mobile app first.</small></div>
        <img id="qrImage" style="display: none;" alt="WhatsApp QR Code" />
      </div>
      <div class="instructions">
        <ol>
          <li>Log in to the jeenMate mobile app first.</li>
          <li>Open WhatsApp on your personal device.</li>
          <li>Tap <strong>Settings</strong> or <strong>Menu (⋮)</strong> &gt; <strong>Linked Devices</strong>.</li>
          <li>Tap <strong>Link a Device</strong> and point your camera at this QR code.</li>
        </ol>
      </div>
      <div class="btn-group">
        <button class="btn-primary" onclick="fetchQr(true)">Refresh QR</button>
        <button class="btn-danger" onclick="resetSession()">Reset Session</button>
      </div>
    </div>
  </div>
  <div class="footer">jeenMate Support Portal • Per-User WhatsApp Sessions</div>
  <script>
    // NOTE: This page requires a token query param to identify the user.
    // Usage: /api/whatsapp/qr-page?token=<jwt_token>
    const token = new URLSearchParams(window.location.search).get('token') || '';
    const headers = token ? { 'Authorization': 'Bearer ' + token } : {};

    async function fetchQr(showFeedback = false) {
      try {
        const res = await fetch('/api/whatsapp/qr', { headers });
        if (res.status === 401) {
          document.getElementById('loadingText').textContent = 'Please log in from the mobile app first to get your QR code.';
          return;
        }
        const json = await res.json();
        const data = json.data;
        const badge = document.getElementById('statusBadge');
        const statusText = document.getElementById('statusText');
        const qrImage = document.getElementById('qrImage');
        const loadingText = document.getElementById('loadingText');
        if (data.isConnected) {
          badge.className = 'badge online';
          statusText.textContent = 'Connected';
          loadingText.style.display = 'block';
          loadingText.innerHTML = '<b style="color: #00A884;">WhatsApp Connected!</b><br>Phone: ' + (data.phone || 'Active');
          qrImage.style.display = 'none';
        } else if (data.qrDataUrl) {
          badge.className = 'badge waiting';
          statusText.textContent = 'Waiting for Scan';
          qrImage.src = data.qrDataUrl;
          qrImage.style.display = 'block';
          loadingText.style.display = 'none';
        } else {
          badge.className = 'badge offline';
          statusText.textContent = data.status || 'Starting...';
          loadingText.style.display = 'block';
          loadingText.textContent = 'Generating QR code, please wait...';
          qrImage.style.display = 'none';
        }
      } catch (err) {
        console.error('Error fetching QR:', err);
      }
    }
    async function resetSession() {
      if (!confirm('Are you sure you want to disconnect and clear your WhatsApp session?')) return;
      try {
        const res = await fetch('/api/whatsapp/restart?clean=true', { method: 'POST', headers });
        const json = await res.json();
        alert(json.message || 'Session reset initiated.');
        fetchQr();
      } catch (err) {
        alert('Failed to reset session: ' + err.message);
      }
    }
    fetchQr();
    setInterval(fetchQr, 3000);
  </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

async function debugChats(req, res, next) {
  try {
    const service = await getUserSession(req);
    if (!service.client || !service.client.pupPage) {
      return res.json({ success: false, message: 'Client or pupPage not ready' });
    }
    const safeChats = await service.getSafeChatList();
    return res.json({ success: true, safeChatsCount: safeChats.length, top5Safe: safeChats.slice(0, 5) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function debugMsgs(req, res) {
  try {
    const service = await getUserSession(req);
    const { jid = '' } = req.query;
    if (!service.client || !service.client.pupPage) {
      return res.json({ success: false, error: 'No pupPage' });
    }

    const diag = await service.client.pupPage.evaluate(async (targetJid) => {
      try {
        let chat = null;
        if (window.WWebJS && window.WWebJS.getChat) {
          try {
            chat = await window.WWebJS.getChat(targetJid, { getAsModel: false });
          } catch (e) {
            return { error: 'getChat failed: ' + e.message };
          }
        }
        if (!chat) {
          const chatCol = window.require ? window.require('WAWebCollections')?.Chat : null;
          chat = chatCol?.get ? chatCol.get(targetJid) : null;
        }
        if (!chat) {
          return { error: 'Chat not found in collection for JID ' + targetJid };
        }

        const initialMsgsCount = chat.msgs?.models?.length || (chat.msgs?.getModelsArray ? chat.msgs.getModelsArray().length : 0);

        let loaderError = null;
        let loadedResults = [];
        const loader = window.require ? window.require('WAWebChatLoadMessages') : null;
        if (loader && loader.loadEarlierMsgs) {
          try {
            for (let i = 0; i < 3; i++) {
              const res = await loader.loadEarlierMsgs({ chat });
              loadedResults.push({ loop: i, resCount: res?.length || 0 });
              if (!res || !res.length) break;
            }
          } catch (le) {
            loaderError = le.message || String(le);
          }
        }

        const finalMsgsCount = chat.msgs?.models?.length || (chat.msgs?.getModelsArray ? chat.msgs.getModelsArray().length : 0);
        const models = chat.msgs?.getModelsArray ? chat.msgs.getModelsArray() : (chat.msgs?.models || []);

        return {
          foundChat: true,
          chatId: chat.id?._serialized,
          initialMsgsCount,
          finalMsgsCount,
          hasLoader: !!loader,
          loaderError,
          loadedResults,
          firstMsg: models[0] ? { id: models[0].id?._serialized, body: models[0].body?.slice(0, 50), t: models[0].t } : null,
          lastMsg: models[models.length - 1] ? { id: models[models.length - 1].id?._serialized, body: models[models.length - 1].body?.slice(0, 50), t: models[models.length - 1].t } : null
        };
      } catch (err) {
        return { error: err.message };
      }
    }, jid);

    return res.json({ success: true, jid, diag });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function syncChatMessages(req, res) {
  try {
    const service = await getUserSession(req);
    const userId = req.user.id;
    const { convId = 1 } = req.query;
    const [convRows] = await pool.execute('SELECT id, customer_id FROM conversations WHERE id = ? AND user_id = ?', [convId, userId]);
    if (convRows.length === 0) return res.status(404).json({ success: false, message: 'Conversation not found for this user' });
    const conversation = convRows[0];
    const [custRows] = await pool.execute('SELECT id, whatsapp_jid FROM customers WHERE id = ?', [conversation.customer_id]);
    if (custRows.length === 0 || !custRows[0].whatsapp_jid) {
      return res.status(400).json({ success: false, message: 'Customer has no whatsapp_jid' });
    }
    const jid = custRows[0].whatsapp_jid;
    const liveMsgs = await service.fetchMessagesForChat(jid, 60);
    let inserted = 0;
    for (const m of liveMsgs) {
      const iso = new Date(m.timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const dir = m.fromMe ? 'outgoing' : 'incoming';
      const safeMsgId = m.id ? String(m.id).slice(0, 191) : `wa_${m.timestamp}_${dir}`;
      if (safeMsgId) {
        const [exist] = await pool.execute('SELECT id FROM messages WHERE whatsapp_message_id = ? AND user_id = ? LIMIT 1', [safeMsgId, userId]);
        if (exist.length === 0) {
          await pool.execute(
            `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, status, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [convId, conversation.customer_id, dir, m.body || '', safeMsgId, m.type || 'text', m.status || 'delivered', iso, userId]
          );
          inserted++;
        }
      }
    }
    return res.json({ success: true, convId, liveCount: liveMsgs.length, inserted });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/whatsapp/log-call
async function logCall(req, res) {
  try {
    const userId = req.user.id;
    const { conversationId, phoneNumber, mediaType = 'voice', callType = 'outgoing' } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'phoneNumber is required' });
    }

    const service = sessionManager.getSession(userId);
    if (service) {
      await service.logCallDirectly({ conversationId, phoneNumber, mediaType, callType });
    } else {
      const rawNumber = String(phoneNumber).replace(/[^0-9]/g, '');
      const formattedPhone = rawNumber.startsWith('+') ? rawNumber : `+${rawNumber}`;
      const mediaLabel = mediaType === 'video' ? 'video' : 'voice';
      const callMsgText = mediaLabel === 'video'
        ? (callType === 'missed' ? '📹 Missed video call' : (callType === 'outgoing' ? '📹 Outgoing video call' : '📹 Video call'))
        : (callType === 'missed' ? '📞 Missed voice call' : (callType === 'outgoing' ? '📞 Outgoing voice call' : '📞 Voice call'));

      await pool.execute(
        `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, created_at, user_id)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
        [`call_manual_${Date.now()}`, formattedPhone, 'Customer', callType, mediaLabel, userId]
      );

      if (conversationId) {
        const [convRows] = await pool.execute(
          'SELECT customer_id FROM conversations WHERE id = ? AND user_id = ? LIMIT 1',
          [conversationId, userId]
        );
        if (convRows.length > 0) {
          const customerId = convRows[0].customer_id;
          const utcStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
          await pool.execute(
            `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, status, created_at, user_id)
             VALUES (?, ?, 'outgoing', ?, ?, 'text', 'delivered', ?, ?)`,
            [conversationId, customerId, callMsgText, `call_${Date.now()}`, utcStr, userId]
          );
          await pool.execute(
            'UPDATE conversations SET last_message_at = ? WHERE id = ?',
            [utcStr, conversationId]
          );
        }
      }
    }

    return res.status(200).json({ success: true, message: 'Call logged successfully' });
  } catch (err) {
    console.error('[WhatsAppController] logCall error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getStatus,
  getQr,
  getCallLogs,
  inspectQrPage,
  restartSession,
  syncChats,
  getQrPage,
  debugChats,
  debugMsgs,
  syncChatMessages,
  logCall
};
