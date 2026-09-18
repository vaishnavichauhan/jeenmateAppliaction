import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';
import { useAuthStore } from './authStore';
import { useChatStore } from './chatStore';
import { getSocket } from '../services/socket';

const STORAGE_KEY_WA_STATUS = '@jeenmate_wa_status';

export interface WhatsAppSessionState {
  isConnected: boolean;
  status: 'online' | 'waiting' | 'offline';
  phone: string | null;
  name: string | null;
  qrDataUrl: string | null;
  lastUpdated: string | null;
  isLoading: boolean;
  isCheckingStatus: boolean;
  hasCheckedStatus: boolean;
  isResetting: boolean;

  fetchStatus: () => Promise<void>;
  fetchQr: () => Promise<void>;
  regenerateQr: () => Promise<void>;
  resetSession: () => Promise<{ success: boolean; message: string }>;
  getQrPageUrl: () => string;
  resetLocalState: () => void;
  setupSocketListeners: () => void;
}

export const useWhatsAppStore = create<WhatsAppSessionState>((set, get) => ({
  isConnected: false,
  status: 'waiting',
  phone: null,
  name: null,
  qrDataUrl: null,
  lastUpdated: null,
  isLoading: false,
  isCheckingStatus: true,
  hasCheckedStatus: false,
  isResetting: false,

  fetchStatus: async () => {
    // Check cache first on initial load to quickly load last known state
    if (!get().hasCheckedStatus) {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY_WA_STATUS);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.isConnected === 'boolean') {
            set({
              isConnected: parsed.isConnected,
              status: parsed.status || (parsed.isConnected ? 'online' : 'offline'),
              phone: parsed.phone || null,
              name: parsed.name || null,
            });
          }
        }
      } catch (e) {}
    }

    try {
      if (!get().hasCheckedStatus) {
        set({ isCheckingStatus: true });
      }
      const res = await apiClient.get('/api/whatsapp/status');
      if (res.data && res.data.success) {
        const { isConnected, status, phone, name, lastUpdated } = res.data.data;
        const connected = !!isConnected;
        set({
          isConnected: connected,
          status: status || (connected ? 'online' : 'offline'),
          phone: phone || null,
          name: name || null,
          lastUpdated: lastUpdated || null,
          hasCheckedStatus: true,
          isCheckingStatus: false,
        });
        await AsyncStorage.setItem(
          STORAGE_KEY_WA_STATUS,
          JSON.stringify({ isConnected: connected, status, phone, name })
        );
      }
    } catch (err) {
      console.log('[WhatsAppStore] Status fetch error');
    } finally {
      set({ hasCheckedStatus: true, isCheckingStatus: false });
    }
  },

  fetchQr: async () => {
    try {
      set({ isLoading: true });
      const res = await apiClient.get('/api/whatsapp/qr');
      if (res.data && res.data.success) {
        const { isConnected, status, qrDataUrl, lastUpdated } = res.data.data;
        set({
          isConnected: !!isConnected,
          status: status || 'offline',
          qrDataUrl: qrDataUrl || null,
          lastUpdated,
          isLoading: false,
        });
      }
    } catch (err) {
      set({ isLoading: false });
    }
  },

  regenerateQr: async () => {
    try {
      set({ isLoading: true, qrDataUrl: null });
      await apiClient.post('/api/whatsapp/restart?clean=true');
      set({ isConnected: false, status: 'waiting' });
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(() => resolve(null), 1200));
        await get().fetchQr();
        if (get().qrDataUrl) break;
      }
    } catch (e) {
      console.log('[WhatsAppStore] Regenerate QR error');
    } finally {
      set({ isLoading: false });
    }
  },

  resetSession: async () => {
    set({ isResetting: true });
    try {
      const res = await apiClient.post('/api/whatsapp/restart?clean=true');
      set({
        isConnected: false,
        status: 'waiting',
        phone: null,
        name: null,
        qrDataUrl: null,
        isResetting: false,
      });
      await AsyncStorage.removeItem(STORAGE_KEY_WA_STATUS);
      // Purge local chat state and cache when session is reset
      await useChatStore.getState().resetChatState();
      return { success: true, message: res.data?.message || 'Session reset successfully' };
    } catch (err: any) {
      set({ isResetting: false });
      return { success: false, message: err.response?.data?.message || err.message || 'Failed to reset session' };
    }
  },

  getQrPageUrl: () => {
    const { serverUrl, token } = useAuthStore.getState();
    return `${serverUrl}/api/whatsapp/qr-page?token=${encodeURIComponent(token || '')}`;
  },

  setupSocketListeners: () => {
    const socket = getSocket();
    socket.off('whatsapp_status');
    socket.on('whatsapp_status', (statusData: any) => {
      if (statusData) {
        const connected = Boolean(statusData.isConnected ?? (statusData.status === 'online'));
        set({
          isConnected: connected,
          status: statusData.status || (connected ? 'online' : 'offline'),
          phone: statusData.phone ?? get().phone,
          name: statusData.name ?? get().name,
          qrDataUrl: connected ? null : (statusData.qrDataUrl ?? get().qrDataUrl),
          lastUpdated: statusData.lastUpdated ?? get().lastUpdated,
          hasCheckedStatus: true,
          isCheckingStatus: false,
        });
        AsyncStorage.setItem(
          STORAGE_KEY_WA_STATUS,
          JSON.stringify({
            isConnected: connected,
            status: statusData.status,
            phone: statusData.phone,
            name: statusData.name,
          })
        ).catch(() => {});
      }
    });

    socket.off('whatsapp_qr');
    socket.on('whatsapp_qr', (qrData: any) => {
      if (qrData?.qrDataUrl && !get().isConnected) {
        set({
          qrDataUrl: qrData.qrDataUrl,
          status: 'waiting',
          isLoading: false,
        });
      }
    });
  },

  resetLocalState: () => {
    set({
      isConnected: false,
      status: 'waiting',
      phone: null,
      name: null,
      qrDataUrl: null,
      lastUpdated: null,
      isLoading: false,
      isCheckingStatus: true,
      hasCheckedStatus: false,
      isResetting: false,
    });
    AsyncStorage.removeItem(STORAGE_KEY_WA_STATUS).catch(() => {});
    useChatStore.getState().resetChatState().catch(() => {});
  },
}));
