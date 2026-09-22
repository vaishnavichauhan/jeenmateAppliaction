import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';
import { useAuthStore } from './authStore';
import { useChatStore } from './chatStore';
import { getSocket } from '../services/socket';

const STORAGE_KEY_SELECTED_ACCOUNT = '@jeenmate_selected_wa_account_v2';
const STORAGE_KEY_ACCOUNTS_CACHE = '@jeenmate_wa_accounts_cache_v2';

export interface WhatsAppAccount {
  id: number;
  account_name: string;
  whatsapp_name?: string | null;
  phone_number: string | null;
  account_type: 'PERSONAL' | 'TEAM';
  owner_user_id: number | null;
  owner_name?: string;
  created_by_user_id: number;
  creator_name?: string;
  session_id: string;
  status: 'online' | 'waiting' | 'offline' | 'disconnected';
  is_connected?: boolean;
  member_count?: number;
  members?: Array<{ id: number; user_id: number; name: string; email: string; user_role: string; role: string }>;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppMultiAccountState {
  accounts: WhatsAppAccount[];
  selectedAccountId: number | null;
  selectedAccount: WhatsAppAccount | null;
  qrCodes: Record<number, string | null>;
  activeQrAccount: WhatsAppAccount | null;
  isLoading: boolean;
  isFetchingAccounts: boolean;
  hasLoadedAccounts: boolean;
  isPerformingAction: boolean;

  fetchAccounts: () => Promise<void>;
  selectAccount: (account: WhatsAppAccount | null) => Promise<void>;
  createAccount: (name: string, type: 'PERSONAL' | 'TEAM') => Promise<{ success: boolean; message: string; data?: WhatsAppAccount }>;
  deleteAccount: (accountId: number) => Promise<{ success: boolean; message: string }>;
  disconnectAccount: (accountId: number) => Promise<{ success: boolean; message: string }>;
  fetchAccountQr: (accountId: number) => Promise<{ qrDataUrl: string | null; status: string }>;
  restartAccount: (accountId: number) => Promise<{ success: boolean; message: string }>;
  syncAccountChats: (accountId: number) => Promise<{ success: boolean; message: string }>;
  updateAccountMembers: (accountId: number, userIds: number[]) => Promise<{ success: boolean; message: string }>;
  setActiveQrAccount: (account: WhatsAppAccount | null) => void;
  setupSocketListeners: () => void;
  resetLocalState: () => void;
}

export const useWhatsAppStore = create<WhatsAppMultiAccountState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  selectedAccount: null,
  qrCodes: {},
  activeQrAccount: null,
  isLoading: false,
  isFetchingAccounts: false,
  hasLoadedAccounts: false,
  isPerformingAction: false,

  fetchAccounts: async () => {
    // 1. Load from cache immediately if in-memory list is empty
    if (get().accounts.length === 0) {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY_ACCOUNTS_CACHE);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0 && get().accounts.length === 0) {
            set({ accounts: parsed, hasLoadedAccounts: true });
          }
        }
      } catch (_) {}
    }

    try {
      set({ isFetchingAccounts: true });
      const res = await apiClient.get('/api/whatsapp/accounts');
      if (res.data && res.data.success) {
        const accountsList: WhatsAppAccount[] = res.data.data || [];
        set({ accounts: accountsList, isFetchingAccounts: false, hasLoadedAccounts: true });
        await AsyncStorage.setItem(STORAGE_KEY_ACCOUNTS_CACHE, JSON.stringify(accountsList));

        // Auto-select first account if nothing selected or previous selection was deleted
        const currentSelectedId = get().selectedAccountId;
        let active = accountsList.find(a => a.id === currentSelectedId);
        if (!active && accountsList.length > 0) {
          active = accountsList[0];
        }

        if (active) {
          const current = get().selectedAccount;
          if (
            currentSelectedId !== active.id ||
            !current ||
            current.status !== active.status ||
            current.phone_number !== active.phone_number ||
            current.whatsapp_name !== active.whatsapp_name ||
            current.is_connected !== active.is_connected
          ) {
            set({ selectedAccountId: active.id, selectedAccount: active });
            await AsyncStorage.setItem(STORAGE_KEY_SELECTED_ACCOUNT, JSON.stringify(active.id));
          }
        }
      }
    } catch (err) {
      console.log('[WhatsAppStore] Failed to fetch accounts, loading cache');
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY_ACCOUNTS_CACHE);
        if (cached) {
          set({ accounts: JSON.parse(cached), hasLoadedAccounts: true });
        }
      } catch (_) {}
    } finally {
      set({ isFetchingAccounts: false, hasLoadedAccounts: true });
    }
  },

  selectAccount: async (account: WhatsAppAccount | null) => {
    if (!account) {
      set({ selectedAccount: null, selectedAccountId: null });
      await AsyncStorage.removeItem(STORAGE_KEY_SELECTED_ACCOUNT);
      await useChatStore.getState().resetChatState();
      return;
    }

    const prevId = get().selectedAccountId;
    set({ selectedAccount: account, selectedAccountId: account.id });
    await AsyncStorage.setItem(STORAGE_KEY_SELECTED_ACCOUNT, JSON.stringify(account.id));

    // If switched to a different account, purge current messages & conversations from view and fetch new account's chats
    if (prevId !== account.id) {
      const chatStore = useChatStore.getState();
      chatStore.clearMessages();
      useChatStore.setState({ conversations: [], isLoading: true });
      await chatStore.fetchConversations(account.id);

      // Join new account's socket room
      const socket = getSocket();
      if (prevId) socket.emit('leave_whatsapp_account', prevId);
      socket.emit('join_whatsapp_account', account.id);
    }
  },

  createAccount: async (name: string, type: 'PERSONAL' | 'TEAM') => {
    set({ isPerformingAction: true });
    try {
      const res = await apiClient.post('/api/whatsapp/accounts', {
        account_name: name.trim(),
        account_type: type,
      });
      if (res.data && res.data.success) {
        await get().fetchAccounts();
        const created = res.data.data;
        if (created) {
          await get().selectAccount(created);
        }
        return { success: true, message: res.data.message || 'Account created', data: created };
      }
      return { success: false, message: res.data?.message || 'Failed to create account' };
    } catch (err: any) {
      return { success: false, message: err.response?.data?.message || err.message || 'Error creating account' };
    } finally {
      set({ isPerformingAction: false });
    }
  },

  deleteAccount: async (accountId: number) => {
    set({ isPerformingAction: true });
    try {
      const res = await apiClient.delete(`/api/whatsapp/accounts/${accountId}`);
      if (res.data && res.data.success) {
        if (get().selectedAccountId === accountId) {
          await get().selectAccount(null);
        }
        await get().fetchAccounts();
        return { success: true, message: res.data.message || 'Account deleted successfully' };
      }
      return { success: false, message: res.data?.message || 'Failed to delete account' };
    } catch (err: any) {
      return { success: false, message: err.response?.data?.message || err.message || 'Error deleting account' };
    } finally {
      set({ isPerformingAction: false });
    }
  },

  disconnectAccount: async (accountId: number) => {
    set({ isPerformingAction: true });
    try {
      const res = await apiClient.post(`/api/whatsapp/accounts/${accountId}/disconnect`);
      if (res.data && res.data.success) {
        if (get().selectedAccountId === accountId) {
          await useChatStore.getState().resetChatState();
        }
        await get().fetchAccounts();
        return { success: true, message: res.data.message || 'Account disconnected' };
      }
      return { success: false, message: res.data?.message || 'Failed to disconnect' };
    } catch (err: any) {
      return { success: false, message: err.response?.data?.message || err.message || 'Error disconnecting' };
    } finally {
      set({ isPerformingAction: false });
    }
  },

  fetchAccountQr: async (accountId: number) => {
    try {
      const res = await apiClient.get(`/api/whatsapp/accounts/${accountId}/qr`);
      if (res.data && res.data.success) {
        const qr = res.data.data.qrDataUrl || null;
        set((state) => ({
          qrCodes: { ...state.qrCodes, [accountId]: qr },
        }));
        return { qrDataUrl: qr, status: res.data.data.status || 'waiting' };
      }
    } catch (err: any) {
      console.log(`[WhatsAppStore] Fetch QR error for account ${accountId}`);
    }
    return { qrDataUrl: null, status: 'offline' };
  },

  restartAccount: async (accountId: number) => {
    set({ isPerformingAction: true });
    try {
      const res = await apiClient.post(`/api/whatsapp/accounts/${accountId}/restart?clean=true`);
      await get().fetchAccounts();
      return { success: true, message: res.data?.message || 'Session restarted' };
    } catch (err: any) {
      return { success: false, message: err.response?.data?.message || err.message || 'Restart failed' };
    } finally {
      set({ isPerformingAction: false });
    }
  },

  syncAccountChats: async (accountId: number) => {
    try {
      const res = await apiClient.post(`/api/whatsapp/accounts/${accountId}/sync`);
      if (res.data && res.data.success) {
        await useChatStore.getState().fetchConversations(accountId);
        return { success: true, message: res.data.message || 'Chats synced successfully!' };
      }
      return { success: false, message: res.data?.message || 'Sync failed' };
    } catch (err: any) {
      return { success: false, message: err.response?.data?.message || 'Sync failed' };
    }
  },

  updateAccountMembers: async (accountId: number, userIds: number[]) => {
    set({ isPerformingAction: true });
    try {
      const res = await apiClient.post(`/api/whatsapp/accounts/${accountId}/members`, {
        user_ids: userIds,
      });
      if (res.data && res.data.success) {
        await get().fetchAccounts();
        return { success: true, message: res.data.message || 'Members updated successfully' };
      }
      return { success: false, message: res.data?.message || 'Failed to update members' };
    } catch (err: any) {
      return { success: false, message: err.response?.data?.message || err.message || 'Error updating members' };
    } finally {
      set({ isPerformingAction: false });
    }
  },

  setActiveQrAccount: (account: WhatsAppAccount | null) => {
    set({ activeQrAccount: account });
  },

  setupSocketListeners: () => {
    const socket = getSocket();

    // Listen for live status changes per account
    socket.off('whatsapp_status');
    socket.on('whatsapp_status', (data: any) => {
      if (data && data.accountId) {
        const accId = Number(data.accountId);
        const isConn = Boolean(data.isConnected ?? (data.status === 'online'));

        // When the event indicates isConnected === false for the currently selected account, immediately reset chat state
        if (!isConn && get().selectedAccountId === accId) {
          useChatStore.getState().resetChatState().catch(() => {});
        }

        set((state) => ({
          accounts: state.accounts.map((acc) =>
            acc.id === accId
              ? {
                  ...acc,
                  status: data.status || (isConn ? 'online' : 'offline'),
                  is_connected: isConn,
                  phone_number: data.phone !== undefined ? data.phone : acc.phone_number,
                  whatsapp_name: data.name !== undefined ? data.name : acc.whatsapp_name,
                }
              : acc
          ),
          selectedAccount:
            state.selectedAccountId === accId && state.selectedAccount
              ? {
                  ...state.selectedAccount,
                  status: data.status || (isConn ? 'online' : 'offline'),
                  is_connected: isConn,
                  phone_number: data.phone !== undefined ? data.phone : state.selectedAccount.phone_number,
                  whatsapp_name: data.name !== undefined ? data.name : state.selectedAccount.whatsapp_name,
                }
              : state.selectedAccount,
        }));
      }
    });

    // Listen for live QR updates per account
    socket.off('whatsapp_qr');
    socket.on('whatsapp_qr', (qrData: any) => {
      if (qrData && qrData.accountId && qrData.qr) {
        const accId = Number(qrData.accountId);
        set((state) => ({
          qrCodes: { ...state.qrCodes, [accId]: qrData.qr },
        }));
      }
    });
  },

  resetLocalState: () => {
    set({
      accounts: [],
      selectedAccountId: null,
      selectedAccount: null,
      qrCodes: {},
      activeQrAccount: null,
      isLoading: false,
      isFetchingAccounts: false,
      hasLoadedAccounts: false,
      isPerformingAction: false,
    });
    AsyncStorage.removeItem(STORAGE_KEY_ACCOUNTS_CACHE).catch(() => {});
    AsyncStorage.removeItem(STORAGE_KEY_SELECTED_ACCOUNT).catch(() => {});
  },
}));
