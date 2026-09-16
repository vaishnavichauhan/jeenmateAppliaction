import { create } from 'zustand';
import apiClient from '../services/api';
import { useAuthStore } from './authStore';

export interface WhatsAppSessionState {
  isConnected: boolean;
  status: 'online' | 'waiting' | 'offline';
  phone: string | null;
  name: string | null;
  qrDataUrl: string | null;
  lastUpdated: string | null;
  isLoading: boolean;
  isResetting: boolean;

  fetchStatus: () => Promise<void>;
  fetchQr: () => Promise<void>;
  regenerateQr: () => Promise<void>;
  resetSession: () => Promise<{ success: boolean; message: string }>;
  getQrPageUrl: () => string;
  resetLocalState: () => void;
}

export const useWhatsAppStore = create<WhatsAppSessionState>((set, get) => ({
  isConnected: false,
  status: 'waiting',
  phone: null,
  name: null,
  qrDataUrl: null,
  lastUpdated: null,
  isLoading: false,
  isResetting: false,

  fetchStatus: async () => {
    try {
      const res = await apiClient.get('/api/whatsapp/status');
      if (res.data && res.data.success) {
        const { isConnected, status, phone, name, lastUpdated } = res.data.data;
        set({
          isConnected: !!isConnected,
          status: status || 'offline',
          phone,
          name,
          lastUpdated,
        });
      }
    } catch (err) {
      console.log('[WhatsAppStore] Status fetch error');
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

  resetLocalState: () => {
    set({
      isConnected: false,
      status: 'waiting',
      phone: null,
      name: null,
      qrDataUrl: null,
      lastUpdated: null,
      isLoading: false,
      isResetting: false,
    });
  },
}));
