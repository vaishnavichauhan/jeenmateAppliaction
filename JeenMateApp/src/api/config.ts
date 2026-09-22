/**
 * api/config.ts
 *
 * Single source of truth for the backend base URL and every API endpoint
 * used across the JeenMate app.
 *
 * Usage:
 *   import { API_ENDPOINTS } from '../api/config';
 *   apiClient.get(API_ENDPOINTS.TASKS.LIST);
 *   apiClient.get(API_ENDPOINTS.WHATSAPP.QR(accountId));
 */

import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

export const DEFAULT_SERVER_URL =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:5001'
    : 'http://localhost:5001';

// ---------------------------------------------------------------------------
// Endpoint map
// ---------------------------------------------------------------------------

export const API_ENDPOINTS = {
  // ── Auth ─────────────────────────────────────────────────────────────────
  AUTH: {
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    USERS: '/api/auth/users',
  },

  // ── Conversations (WhatsApp customer chats) ──────────────────────────────
  CONVERSATIONS: {
    LIST: '/api/conversations',
    MESSAGES: (conversationId: string) =>
      `/api/conversations/${conversationId}/messages`,
  },

  // ── WhatsApp Accounts ────────────────────────────────────────────────────
  WHATSAPP: {
    ACCOUNTS: '/api/whatsapp/accounts',
    ACCOUNT: (accountId: string) => `/api/whatsapp/accounts/${accountId}`,
    QR: (accountId: string) => `/api/whatsapp/accounts/${accountId}/qr`,
    DISCONNECT: (accountId: string) =>
      `/api/whatsapp/accounts/${accountId}/disconnect`,
    RESTART: (accountId: string) =>
      `/api/whatsapp/accounts/${accountId}/restart?clean=true`,
    SYNC: (accountId?: string) =>
      accountId
        ? `/api/whatsapp/accounts/${accountId}/sync`
        : '/api/whatsapp/sync',
    MEMBERS: (accountId: string) =>
      `/api/whatsapp/accounts/${accountId}/members`,
    LOG_CALL: '/api/whatsapp/log-call',
    CALL_LOGS: (accountId: string) =>
      `/api/whatsapp/accounts/${accountId}/call-logs`,
  },

  // ── Tasks ────────────────────────────────────────────────────────────────
  TASKS: {
    LIST: '/api/tasks',
    CREATE: '/api/tasks',
    ASSIGN: (taskId: string) => `/api/tasks/${taskId}/assign`,
    TOGGLE: (taskId: string) => `/api/tasks/${taskId}/toggle`,
    DELETE: (taskId: string) => `/api/tasks/${taskId}`,
  },

  // ── Internal Staff Chat ──────────────────────────────────────────────────
  INTERNAL_CHAT: {
    USERS: '/api/internal-chat/users',
    MESSAGES: '/api/internal-chat/messages',
    THREAD: (colleagueId: string) =>
      `/api/internal-chat/messages/${colleagueId}`,
  },
} as const;
