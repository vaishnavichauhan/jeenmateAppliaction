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

    const service = await sessionManager.getOrCreateSession(account.id, account);
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
    const service = await sessionManager.getOrCreateSession(account.id, account);
    const isConnected = !!(service && service.isConnected) || account.status === 'online';

    const callLogs = service ? await service.getCallLogs(limit) : [];

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
  restartAccountSession,
  syncAccountChats,
  getAccountCallLogs,
  getStatus,
  getQr,
  getCallLogs,
  restartSession,
  syncChats
};
