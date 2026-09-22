const pool = require('../config/db');
const sessionManager = require('../services/sessionManager');
const { WhatsAppAccount, WhatsAppAccountMember } = require('../models');

/**
 * Access Control Helper:
 * Verifies that the authenticated user has permission to view or manage a specific WhatsApp account.
 */
async function verifyAccountAccess(req, accountId, requireAdmin = false) {
  const userId = req.user.id;
  const userRole = req.user.role;
  const accId = Number(accountId);

  if (isNaN(accId) || accId <= 0) {
    return { error: { status: 400, message: 'Invalid WhatsApp Account ID' } };
  }

  const account = await WhatsAppAccount.findById(accId);
  if (!account) {
    return { error: { status: 404, message: 'WhatsApp Account not found' } };
  }

  if (account.account_type === 'PERSONAL') {
    if (Number(account.owner_user_id) !== Number(userId)) {
      return { error: { status: 403, message: 'Forbidden: You do not have access to this Personal WhatsApp account.' } };
    }
  } else if (account.account_type === 'TEAM') {
    if (requireAdmin && userRole !== 'admin') {
      return { error: { status: 403, message: 'Forbidden: Only Admins can perform this action on Team WhatsApp accounts.' } };
    }
    if (userRole !== 'admin') {
      const isMember = await WhatsAppAccountMember.isMember(accId, userId);
      if (!isMember) {
        return { error: { status: 403, message: 'Forbidden: You are not an assigned member of this Team WhatsApp account.' } };
      }
    }
  }

  return { account };
}

// -----------------------------------------------------------------------------
// ACCOUNT MANAGEMENT APIS
// -----------------------------------------------------------------------------

// GET /api/whatsapp/accounts - List all accessible WhatsApp accounts for the logged-in user
async function getAccounts(req, res, next) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const accounts = await WhatsAppAccount.findAccessibleByUser(userId, userRole);

    // Enrich accounts with live connection statuses & members for team accounts
    const enriched = await Promise.all(accounts.map(async acc => {
      const activeSession = sessionManager.getSession(acc.id);
      const isLive = activeSession ? activeSession.isConnected : (acc.status === 'online');
      let members = [];
      if (acc.account_type === 'TEAM') {
        members = await WhatsAppAccountMember.getMembersByAccountId(acc.id);
      }
      return {
        ...acc,
        whatsapp_name: activeSession?.botName || acc.whatsapp_name || null,
        is_connected: isLive,
        status: isLive ? 'online' : (activeSession ? activeSession.status : acc.status),
        members
      };
    }));

    return res.status(200).json({
      success: true,
      data: enriched
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/whatsapp/accounts - Create a new WhatsApp account (Personal by anyone, Team by Admin only)
async function createAccount(req, res, next) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { account_name, account_type = 'PERSONAL' } = req.body;

    if (!account_name || !account_name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required'
      });
    }

    const type = String(account_type).toUpperCase();
    if (type !== 'PERSONAL' && type !== 'TEAM') {
      return res.status(400).json({
        success: false,
        message: 'Invalid account type. Must be PERSONAL or TEAM.'
      });
    }

    if (type === 'TEAM' && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Admins can create Team WhatsApp accounts.'
      });
    }

    const sessionId = `session-account-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newAccount = await WhatsAppAccount.create({
      accountName: account_name.trim(),
      accountType: type,
      ownerUserId: type === 'PERSONAL' ? userId : null,
      createdByUserId: userId,
      sessionId,
      status: 'disconnected'
    });

    // If Team account, automatically add Admin as an explicit member with role='admin'
    if (type === 'TEAM') {
      await WhatsAppAccountMember.addMember(newAccount.id, userId, 'admin');
    }

    return res.status(201).json({
      success: true,
      message: `${type === 'TEAM' ? 'Team' : 'Personal'} WhatsApp account created successfully`,
      data: newAccount
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/accounts/:id - Get single WhatsApp account details
async function getAccountDetails(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    let members = [];
    if (account.account_type === 'TEAM') {
      members = await WhatsAppAccountMember.getMembersByAccountId(account.id);
    }

    const activeSession = sessionManager.getSession(account.id);
    return res.status(200).json({
      success: true,
      data: {
        ...account,
        is_connected: activeSession ? activeSession.isConnected : (account.status === 'online'),
        members
      }
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/whatsapp/accounts/:id - Permanently delete WhatsApp account and all its data
async function deleteAccount(req, res, next) {
  try {
    const requireAdmin = true;
    const { account, error } = await verifyAccountAccess(req, req.params.id, requireAdmin);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    // Destroy session and delete database record
    await sessionManager.destroySession(account.id, { cleanData: true, deleteAccount: true });

    return res.status(200).json({
      success: true,
      message: 'WhatsApp account and all associated data permanently deleted.'
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/whatsapp/accounts/:id/disconnect - Disconnect WhatsApp session (preserves account & members)
async function disconnectAccount(req, res, next) {
  try {
    const requireAdmin = true;
    const { account, error } = await verifyAccountAccess(req, req.params.id, requireAdmin);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    // Disconnect active session & clean WhatsApp message history from DB, but preserve account & members
    await sessionManager.destroySession(account.id, { cleanData: true, deleteAccount: false });

    return res.status(200).json({
      success: true,
      message: 'WhatsApp session disconnected. Account preserved for new QR scan.'
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/accounts/:id/members - List members of a Team WhatsApp account
async function getAccountMembers(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    if (account.account_type !== 'TEAM') {
      return res.status(400).json({
        success: false,
        message: 'Member management is only applicable to Team WhatsApp accounts.'
      });
    }

    const members = await WhatsAppAccountMember.getMembersByAccountId(account.id);
    return res.status(200).json({
      success: true,
      data: members
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/whatsapp/accounts/:id/members - Update members of a Team WhatsApp account (Admin only)
async function updateAccountMembers(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id, true); // requireAdmin = true
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    if (account.account_type !== 'TEAM') {
      return res.status(400).json({
        success: false,
        message: 'Member management is only applicable to Team WhatsApp accounts.'
      });
    }

    const { user_ids = [] } = req.body;
    if (!Array.isArray(user_ids)) {
      return res.status(400).json({
        success: false,
        message: 'user_ids must be an array of user IDs'
      });
    }

    // Update member list, guaranteeing Admin/Creator remains an explicit member
    const updatedMembers = await WhatsAppAccountMember.setMembers(account.id, user_ids, req.user.id);

    return res.status(200).json({
      success: true,
      message: 'Team WhatsApp access updated successfully',
      data: updatedMembers
    });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// SCOPED SESSION & MESSAGING APIS
// -----------------------------------------------------------------------------

// GET /api/whatsapp/accounts/:id/status
async function getAccountStatus(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const status = await sessionManager.getStatus(account.id);
    return res.status(200).json({
      success: true,
      data: {
        ...status,
        accountId: account.id,
        accountName: account.account_name,
        accountType: account.account_type
      }
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/accounts/:id/qr
async function getAccountQr(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    // For Team accounts, only Admin can request/generate the QR code
    if (account.account_type === 'TEAM' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Admins can view or scan QR for Team WhatsApp accounts.'
      });
    }

    const qr = await sessionManager.getQr(account.id);
    return res.status(200).json({
      success: true,
      data: {
        ...qr,
        accountId: account.id,
        accountName: account.account_name,
        accountType: account.account_type
      }
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/whatsapp/accounts/:id/restart
async function restartAccountSession(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    if (account.account_type === 'TEAM' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Admins can restart Team WhatsApp accounts.'
      });
    }

    const clean = req.query.clean === 'true';
    const service = await sessionManager.restartSession(account.id, clean);
    return res.status(200).json({
      success: true,
      message: 'WhatsApp session restarted successfully.',
      data: service.getStatus()
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/whatsapp/accounts/:id/sync
async function syncAccountChats(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const service = sessionManager.getSession(account.id);
    if (!service || !service.isConnected) {
      return res.status(200).json({
        success: false,
        message: 'WhatsApp session is offline or disconnected.'
      });
    }

    const cleanOld = req.query.clean === 'true' || req.body?.clean === true;
    const result = await service.syncChats({ cleanOld });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/whatsapp/accounts/:id/call-logs (Personal WhatsApp accounts only)
async function getAccountCallLogs(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    if (account.account_type === 'TEAM') {
      return res.status(200).json({
        success: true,
        isConnected: false,
        disabled: true,
        message: 'Call functionality is disabled on Team WhatsApp accounts.',
        data: []
      });
    }

    const limit = parseInt(req.query.limit, 10) || 100;
    const service = sessionManager.getSession(account.id);
    const isConnected = !!(service && service.isConnected);

    let callLogs = [];
    if (service && service.isConnected) {
      callLogs = await service.getCallLogs(limit);
    } else {
      // Fallback: Query saved database call records for this account / phone number
      const phoneForQuery = (account && account.phone_number) ? String(account.phone_number).replace(/[^0-9]/g, '') : null;
      const queryParams = phoneForQuery
        ? [account.id, phoneForQuery, phoneForQuery]
        : [account.id];
      const whereClause = phoneForQuery
        ? 'WHERE (wc.whatsapp_account_id = ? OR (wc.account_phone IS NOT NULL AND REPLACE(REPLACE(wc.account_phone, "+", ""), " ", "") = ?) OR (wc.whatsapp_account_id IN (SELECT id FROM whatsapp_accounts WHERE REPLACE(REPLACE(phone_number, "+", ""), " ", "") = ?))) AND wc.phone_number NOT LIKE "group-%" AND wc.phone_number NOT LIKE "%@g.us" AND wc.phone_number NOT LIKE "%@newsletter"'
        : 'WHERE wc.whatsapp_account_id = ? AND wc.phone_number NOT LIKE "group-%" AND wc.phone_number NOT LIKE "%@g.us" AND wc.phone_number NOT LIKE "%@newsletter"';

      const [rows] = await pool.execute(
        `SELECT 
          wc.id,
          wc.call_id as callId,
          COALESCE(
            (SELECT c.name FROM customers c WHERE (REPLACE(REPLACE(c.phone_number, '+', ''), ' ', '') = REPLACE(REPLACE(wc.phone_number, '+', ''), ' ', '') OR (c.whatsapp_jid IS NOT NULL AND c.whatsapp_jid LIKE CONCAT('%', REPLACE(REPLACE(wc.phone_number, '+', ''), ' ', ''), '%'))) AND (c.whatsapp_account_id = wc.whatsapp_account_id OR c.whatsapp_account_id IS NULL) LIMIT 1),
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
         ${whereClause}
         ORDER BY wc.created_at DESC, wc.id DESC
         LIMIT ${limit}`,
        queryParams
      );

      for (const r of rows) {
        let rawCall = null;
        if (r.rawCall) {
          try {
            rawCall = typeof r.rawCall === 'string' ? JSON.parse(r.rawCall) : r.rawCall;
          } catch (_) { }
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

        let durationSec = null;
        if (r.duration && r.duration !== 'null' && r.duration !== 'undefined') {
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

        callLogs.push({
          id: String(r.id),
          callId: r.callId || `call_${r.id}`,
          phoneNumber: r.phoneNumber,
          customerName: r.customerName || r.phoneNumber,
          callType: r.callType || 'incoming',
          status: callStatus,
          mediaType: r.mediaType || 'voice',
          timestamp: r.timestamp,
          duration: durationSec,
          isVideo: r.mediaType === 'video',
          isVideoCall: r.mediaType === 'video',
          rawCall: rawCall
        });
      }
    }

    return res.status(200).json({
      success: true,
      isConnected: isConnected || callLogs.length > 0,
      data: callLogs
    });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// BACKWARD COMPATIBILITY ENDPOINTS (Auto-resolves to user's first accessible account)
// -----------------------------------------------------------------------------
async function getDefaultAccount(req) {
  const userId = req.user.id;
  const userRole = req.user.role;
  const accounts = await WhatsAppAccount.findAccessibleByUser(userId, userRole);
  if (accounts.length === 0) {
    // Auto-create personal account for user
    const sessionId = `session-account-user-${userId}-${Date.now()}`;
    return WhatsAppAccount.create({
      accountName: `${req.user.name || 'Personal'} WhatsApp`,
      accountType: 'PERSONAL',
      ownerUserId: userId,
      createdByUserId: userId,
      sessionId
    });
  }
  return accounts[0];
}

async function getStatus(req, res, next) {
  try {
    const account = await getDefaultAccount(req);
    req.params.id = account.id;
    return getAccountStatus(req, res, next);
  } catch (err) {
    next(err);
  }
}

async function getQr(req, res, next) {
  try {
    const account = await getDefaultAccount(req);
    req.params.id = account.id;
    return getAccountQr(req, res, next);
  } catch (err) {
    next(err);
  }
}

async function getCallLogs(req, res, next) {
  try {
    const account = await getDefaultAccount(req);
    req.params.id = account.id;
    return getAccountCallLogs(req, res, next);
  } catch (err) {
    next(err);
  }
}

async function restartSession(req, res, next) {
  try {
    const account = await getDefaultAccount(req);
    req.params.id = account.id;
    return restartAccountSession(req, res, next);
  } catch (err) {
    next(err);
  }
}

async function syncChats(req, res, next) {
  try {
    const account = await getDefaultAccount(req);
    req.params.id = account.id;
    return syncAccountChats(req, res, next);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/whatsapp/accounts/:id/qr-viewer
 * Returns a browser-friendly HTML page displaying the QR code full-screen.
 * Supports ?token= query param so the link can be opened directly in Chrome.
 */
async function getAccountQrViewer(req, res, next) {
  try {
    const { account, error } = await verifyAccountAccess(req, req.params.id);
    if (error) {
      return res.status(error.status).send(`
        <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fef3c7">
          <div style="text-align:center;padding:32px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12)">
            <div style="font-size:48px;margin-bottom:12px">🔒</div>
            <h2 style="color:#DC2626;margin:0 0 8px">Access Denied</h2>
            <p style="color:#6B7280;margin:0">${error.message}</p>
          </div>
        </body></html>
      `);
    }

    if (account.account_type === 'TEAM' && req.user.role !== 'admin') {
      return res.status(403).send(`
        <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fef3c7">
          <div style="text-align:center;padding:32px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12)">
            <div style="font-size:48px;margin-bottom:12px">🚫</div>
            <h2 style="color:#DC2626;margin:0 0 8px">Forbidden</h2>
            <p style="color:#6B7280;margin:0">Only Admins can view QR for Team WhatsApp accounts.</p>
          </div>
        </body></html>
      `);
    }

    const qr = await sessionManager.getQr(account.id);
    const qrDataUrl = qr && qr.qrDataUrl;

    if (!qrDataUrl) {
      return res.status(404).send(`
        <html>
        <head><meta charset="UTF-8"><meta http-equiv="refresh" content="5"><title>Waiting for QR...</title></head>
        <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#EFF6FF">
          <div style="text-align:center;padding:40px;background:white;border-radius:20px;box-shadow:0 4px 24px rgba(0,0,0,.12);max-width:360px">
            <div style="font-size:52px;margin-bottom:16px">⏳</div>
            <h2 style="color:#1E3A5F;margin:0 0 10px">QR Not Ready Yet</h2>
            <p style="color:#6B7280;margin:0 0 18px">The QR code is being generated. This page will refresh in 5 seconds.</p>
            <p style="color:#9CA3AF;font-size:13px">Make sure the session is started in the JeenMate app first.</p>
          </div>
        </body></html>
      `);
    }

    const accountLabel = account.account_name || 'WhatsApp';
    const token = req.query.token || '';
    const refreshUrl = `/api/whatsapp/accounts/${account.id}/qr-viewer?token=${token}`;

    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Scan WhatsApp QR — ${accountLabel}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #EFF6FF 0%, #E0F2FE 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }
          .card {
            background: #fff;
            border-radius: 24px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.12);
            padding: 36px 32px;
            max-width: 420px;
            width: 100%;
            text-align: center;
          }
          .logo-row { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 8px; }
          .app-name { font-size: 22px; font-weight: 800; color: #1E3A5F; }
          .subtitle { font-size: 14px; color: #6B7280; margin-bottom: 24px; }
          .qr-frame {
            border: 3px solid #DBEAFE;
            border-radius: 16px;
            padding: 12px;
            background: #F8FAFF;
            display: inline-block;
            margin-bottom: 20px;
          }
          .qr-frame img { display: block; width: 240px; height: 240px; border-radius: 8px; }
          .steps {
            background: #F8FAFF;
            border-radius: 12px;
            padding: 16px 20px;
            text-align: left;
            margin-bottom: 20px;
          }
          .steps h3 { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 10px; }
          .steps p { font-size: 13px; color: #4B5563; margin-bottom: 6px; }
          .steps p:last-child { margin-bottom: 0; }
          .refresh-btn {
            display: inline-block;
            padding: 10px 24px;
            background: #1E3A5F;
            color: white;
            font-weight: 700;
            font-size: 14px;
            border-radius: 10px;
            text-decoration: none;
            cursor: pointer;
          }
          .expiry { font-size: 12px; color: #F59E0B; margin-top: 14px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo-row">
            <span style="font-size:28px">📱</span>
            <span class="app-name">jeenMate</span>
          </div>
          <p class="subtitle">Scan to link <strong>${accountLabel}</strong></p>

          <div class="qr-frame">
            <img src="${qrDataUrl}" alt="WhatsApp QR Code" />
          </div>

          <div class="steps">
            <h3>How to scan:</h3>
            <p>1️⃣ Open <strong>WhatsApp</strong> on your phone</p>
            <p>2️⃣ Tap <strong>Menu (⋮)</strong> → <strong>Linked Devices</strong></p>
            <p>3️⃣ Tap <strong>Link a Device</strong></p>
            <p>4️⃣ Point your camera at the QR code above</p>
          </div>

          <a class="refresh-btn" href="${refreshUrl}">🔄 Refresh QR Code</a>
          <p class="expiry">⏱ QR code expires in ~75 seconds. Refresh if expired.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  verifyAccountAccess,
  getAccounts,
  createAccount,
  getAccountDetails,
  deleteAccount,
  disconnectAccount,
  getAccountMembers,
  updateAccountMembers,
  getAccountStatus,
  getAccountQr,
  getAccountQrViewer,
  restartAccountSession,
  syncAccountChats,
  getAccountCallLogs,
  getStatus,
  getQr,
  getCallLogs,
  restartSession,
  syncChats
};
