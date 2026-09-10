const pool = require('../config/db');
const whatsappService = require('../services/whatsappService');

// GET /api/whatsapp/status
async function getStatus(req, res, next) {
  try {
    const status = whatsappService.getStatus();
    return res.status(200).json({
      success: true,
      data: status
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/qr
async function getQr(req, res, next) {
  try {
    const qrData = whatsappService.getQr();
    return res.status(200).json({
      success: true,
      data: qrData
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/qr-inspect
async function inspectQrPage(req, res, next) {
  try {
    if (!whatsappService.client || !whatsappService.client.pupPage) {
      return res.json({ success: false, message: 'Client or pupPage not ready' });
    }
    const info = await whatsappService.client.pupPage.evaluate(() => {
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
    const clean = req.query.clean === 'true';
    const result = await whatsappService.restart(clean);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/whatsapp/sync
async function syncChats(req, res, next) {
  try {
    const cleanOld = req.query.clean === 'true' || req.body?.clean === true;
    const result = await whatsappService.syncChats({ cleanOld });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/qr-page
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
    .content {
      padding: 32px 24px;
      text-align: center;
    }
    .qr-box {
      width: 280px;
      height: 280px;
      margin: 0 auto 24px;
      border: 2px dashed var(--border-color);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #FAFAFA;
      position: relative;
    }
    .qr-box img {
      width: 100%;
      height: 100%;
      border-radius: 14px;
      object-fit: contain;
    }
    .instructions {
      text-align: left;
      background: #F8F9FA;
      border-radius: 12px;
      padding: 16px 20px;
      font-size: 13px;
      line-height: 1.6;
      margin-bottom: 24px;
      border: 1px solid var(--border-color);
    }
    .instructions ol { padding-left: 20px; }
    .instructions li { margin-bottom: 6px; }
    .btn-group {
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
    }
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover { background: var(--primary-navy); }
    .btn-danger {
      background: #FEE2E2;
      color: var(--accent-red);
    }
    .btn-danger:hover { background: #FCA5A5; }
    .footer {
      text-align: center;
      margin-top: 18px;
      font-size: 12px;
      color: #64748B;
    }
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
      <p class="sub">Scan with staff WhatsApp to link customer portal</p>
    </div>

    <div class="content">
      <div class="qr-box" id="qrContainer">
        <div id="loadingText" style="color: #64748B; font-size: 14px;">Loading QR code...</div>
        <img id="qrImage" style="display: none;" alt="WhatsApp QR Code" />
      </div>

      <div class="instructions">
        <ol>
          <li>Open WhatsApp on the staff mobile device.</li>
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

  <div class="footer">
    jeenMate Support Portal • Real-Time WhatsApp Integration
  </div>

  <script>
    async function fetchQr(showFeedback = false) {
      try {
        const res = await fetch('/api/whatsapp/qr');
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
      if (!confirm('Are you sure you want to disconnect and clear the active WhatsApp Web session?')) {
        return;
      }
      try {
        const res = await fetch('/api/whatsapp/restart?clean=true', { method: 'POST' });
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
    if (!whatsappService.client || !whatsappService.client.pupPage) {
      return res.json({ success: false, message: 'Client or pupPage not ready' });
    }
    const sample = await whatsappService.client.pupPage.evaluate(() => {
      const col = window.require ? window.require('WAWebCollections')?.Chat : null;
      const models = col?.getModelsArray ? col.getModelsArray() : [];
      if (!models.length) return { error: 'No models found', length: 0 };

      // Return top 15 models with their properties
      const topChats = models.slice(0, 15).map(c => {
        let lastMsg = null;
        try {
          if (c.lastReceivedKey) {
            const msgCol = window.require ? window.require('WAWebCollections')?.Msg : null;
            lastMsg = msgCol?.get ? msgCol.get(c.lastReceivedKey._serialized || c.lastReceivedKey) : null;
          }
          if (!lastMsg && c.msgs && c.msgs.last) {
            lastMsg = c.msgs.last();
          }
        } catch (_) {}

        return {
          id: c.id?._serialized,
          name: c.formattedTitle || c.name || c.contact?.name || c.contact?.pushname,
          t: c.t,
          pin: c.pin || c.pinned,
          unreadCount: c.unreadCount,
          lastMsgBody: lastMsg ? lastMsg.body : null,
          lastMsgType: lastMsg ? lastMsg.type : null,
          lastMsgT: lastMsg ? lastMsg.t : null,
          allKeys: Object.keys(c).slice(0, 25)
        };
      });

      const findRaj = models.find(c => {
        const title = (c.formattedTitle || c.name || c.contact?.name || '').toLowerCase();
        return title.includes('raj');
      });

      return {
        totalChatsInBrowser: models.length,
        topChats,
        rajChat: findRaj ? {
          id: findRaj.id?._serialized,
          name: findRaj.formattedTitle || findRaj.name,
          t: findRaj.t,
          pin: findRaj.pin || findRaj.pinned,
          allKeys: Object.keys(findRaj).slice(0, 30),
          lastReceivedKey: findRaj.lastReceivedKey,
          msgsLength: findRaj.msgs ? findRaj.msgs.length : 0
        } : null
      };
    });

    const safeChats = await whatsappService.getSafeChatList();
    const findRajInSafe = safeChats.find(c => (c.name || '').toLowerCase().includes('raj') || (c.id || '').includes('273370457321715'));
    const find987 = safeChats.find(c => (c.name || '').includes('98796') || (c.id || '').includes('37414299017312'));

    return res.json({
      success: true,
      safeChatsCount: safeChats.length,
      findRajInSafe,
      find987,
      top5Safe: safeChats.slice(0, 5)
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function debugMsgs(req, res) {
  try {
    const { jid = '125949949538427@lid' } = req.query;
    
    if (!whatsappService.client || !whatsappService.client.pupPage) {
      return res.json({ success: false, error: 'No pupPage' });
    }

    const diag = await whatsappService.client.pupPage.evaluate(async (targetJid) => {
      try {
        const chatCol = window.require ? window.require('WAWebCollections')?.Chat : null;
        const chat = chatCol?.get ? chatCol.get(targetJid) : null;
        if (!chat) {
          const allChats = chatCol?.getModelsArray ? chatCol.getModelsArray() : [];
          return {
            error: 'Chat not found in chatCol',
            sampleIds: allChats.slice(0, 5).map(c => c.id?._serialized || String(c.id))
          };
        }

        const msgCol = window.require ? window.require('WAWebCollections')?.Msg : null;
        const allMsgs = msgCol?.getModelsArray ? msgCol.getModelsArray() : [];
        const msgsForChat = allMsgs.filter(m => {
          const from = m.from?._serialized || String(m.from || '');
          const to = m.to?._serialized || String(m.to || '');
          return from === targetJid || to === targetJid || (m.id && String(m.id).includes(targetJid));
        });

        let loadEarlierErr = null;
        let loadedMessagesCount = 0;
        let msgs = [];

        try {
          const chat = await window.WWebJS.getChat(targetJid, { getAsModel: false });
          if (chat) {
            msgs = chat.msgs ? (chat.msgs.getModelsArray ? chat.msgs.getModelsArray() : (chat.msgs.models || [])) : [];
            const loader = window.require ? window.require('WAWebChatLoadMessages') : null;
            if (loader && loader.loadEarlierMsgs) {
              const loaded = await loader.loadEarlierMsgs({ chat });
              loadedMessagesCount = loaded ? loaded.length : 0;
              msgs = chat.msgs ? (chat.msgs.getModelsArray ? chat.msgs.getModelsArray() : (chat.msgs.models || [])) : msgs;
            }
          }
        } catch (e) {
          loadEarlierErr = e.message || String(e);
        }

        return {
          chatFound: true,
          loadedMessagesCount,
          loadEarlierErr,
          totalMsgs: msgs.length,
          sample: msgs.slice(-5).map(m => ({
            rawId: m.id,
            idType: typeof m.id,
            idKeys: m.id ? Object.keys(m.id) : null,
            fromMe: m.fromMe || m.id?.fromMe,
            t: m.t,
            type: m.type,
            body: typeof m.body === 'string' ? m.body.slice(0, 150) : m.body
          }))
        };
      } catch (err) {
        return { evalError: err.message, stack: err.stack };
      }
    }, jid);

    return res.json({ success: true, jid, diag });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function syncChatMessages(req, res) {
  try {
    const { convId = 15 } = req.query;
    const [convRows] = await pool.execute('SELECT id, customer_id FROM conversations WHERE id = ?', [convId]);
    if (convRows.length === 0) return res.status(404).json({ success: false, message: 'Conversation not found' });
    const conversation = convRows[0];

    const [custRows] = await pool.execute('SELECT id, whatsapp_jid FROM customers WHERE id = ?', [conversation.customer_id]);
    if (custRows.length === 0 || !custRows[0].whatsapp_jid) {
      return res.status(400).json({ success: false, message: 'Customer has no whatsapp_jid' });
    }

    const jid = custRows[0].whatsapp_jid;
    const liveMsgs = await whatsappService.fetchMessagesForChat(jid, 60);

    let inserted = 0;
    for (const m of liveMsgs) {
      const iso = new Date(m.timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const dir = m.fromMe ? 'outgoing' : 'incoming';
      const safeMsgId = m.id ? String(m.id).slice(0, 191) : `wa_${m.timestamp}_${dir}`;
      if (safeMsgId) {
        const [exist] = await pool.execute('SELECT id FROM messages WHERE whatsapp_message_id = ? LIMIT 1', [safeMsgId]);
        if (exist.length === 0) {
          await pool.execute(
            `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [convId, conversation.customer_id, dir, m.body || '', safeMsgId, m.type || 'text', m.status || 'delivered', iso]
          );
          inserted++;
        }
      }
    }

    const [messages] = await pool.execute(
      'SELECT id, direction, message, created_at, whatsapp_message_id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [convId]
    );

    return res.json({
      success: true,
      convId,
      liveCount: liveMsgs.length,
      inserted,
      totalInDb: messages.length,
      messages: messages.slice(-10)
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getStatus,
  getQr,
  inspectQrPage,
  restartSession,
  syncChats,
  getQrPage,
  debugChats,
  debugMsgs,
  syncChatMessages
};
