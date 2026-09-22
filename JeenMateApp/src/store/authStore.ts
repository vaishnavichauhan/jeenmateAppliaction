import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Platform } from 'react-native';

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar?: string;
}

interface AuthState {
  token: string | null;
  user: StaffUser | null;
  serverUrl: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  isLoginSuccess: boolean;
  loginError: string | null;

  clearLoginError: () => void;
  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  createUser: (
    name: string,
    email: string,
    password: string,
    role: string
  ) => Promise<{ success: boolean; message?: string }>;
}

const STORAGE_KEYS = {
  TOKEN: '@jeenmate_token',
  USER: '@jeenmate_user',
  SERVER_URL: '@jeenmate_server_url',
};

const DEFAULT_SERVER_URL = Platform.OS === 'android' ? 'http://10.0.2.2:5001' : 'http://localhost:5001';

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  serverUrl: DEFAULT_SERVER_URL,
  isAuthenticated: false,
  isLoading: false,
  isInitializing: true,
  isLoginSuccess: false,
  loginError: null,

  clearLoginError: () => set({ loginError: null }),

  initAuth: async () => {
    try {
      set({ isInitializing: true });
      const [savedToken, savedUser, savedUrl] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.SERVER_URL),
      ]);

      let serverUrl = savedUrl || DEFAULT_SERVER_URL;

      const token = savedToken;
      const user = savedUser ? JSON.parse(savedUser) : null;

      set({
        token,
        user,
        serverUrl,
        isAuthenticated: !!token,
        isInitializing: false,
        isLoading: false,
        isLoginSuccess: false,
      });
    } catch (e) {
      console.warn('Failed to load auth storage', e);
      set({ isInitializing: false, isLoading: false, isLoginSuccess: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, isLoginSuccess: false, loginError: null });

    const currentUrl = get().serverUrl || DEFAULT_SERVER_URL;
    const candidates = Array.from(
      new Set([
        currentUrl,
        'http://192.168.1.14:5001',
        DEFAULT_SERVER_URL,
        Platform.OS === 'android' ? 'http://10.0.2.2:5001' : 'http://localhost:5001',
        'http://192.168.1.2:5001',
        'http://localhost:5001',
      ])
    );

    let lastError: any = null;
    let successfulUrl: string | null = null;
    let authData: any = null;

    for (const candidate of candidates) {
      try {
        const cleanBase = candidate.replace(/\/+$/, '');
        const response = await axios.post(
          `${cleanBase}/api/auth/login`,
          { email: email.trim(), password },
          { timeout: 5000 }
        );

        if (response.data && response.data.token) {
          authData = response.data;
          successfulUrl = cleanBase;
          break;
        }
      } catch (err: any) {
        lastError = err;
        // If the server responded with 400 or 401 (invalid credentials), the server is online and reachable!
        if (err.response?.status === 400 || err.response?.status === 401) {
          successfulUrl = candidate.replace(/\/+$/, '');
          break;
        }
      }
    }

    if (successfulUrl && authData) {
      const { token, user } = authData;
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.TOKEN, token),
        AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user)),
        AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, successfulUrl),
      ]);

      set({
        token,
        user,
        serverUrl: successfulUrl,
        isLoading: false,
        isLoginSuccess: true,
        loginError: null,
      });

      // Show "Sign In Successful" state for 700ms before navigating to home
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 700);
      });

      set({
        isAuthenticated: true,
        isLoginSuccess: false,
      });
      return true;
    }

    const errorMsg =
      lastError?.response?.data?.message ||
      (lastError?.code === 'ECONNABORTED'
        ? 'Server connection timeout. Check server URL/IP.'
        : lastError?.message || 'Unable to connect to backend.');

    set({
      isLoading: false,
      isLoginSuccess: false,
      loginError: errorMsg,
    });
    return false;
  },

  logout: async () => {
    const { token, serverUrl } = get();

    // 1. Tell backend to destroy and expire the WhatsApp session for this user
    if (token) {
      try {
        await axios.post(
          `${serverUrl}/api/auth/logout`,
          {},
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000,
          }
        );
      } catch (err: any) {
        console.log('[AuthStore] Backend logout notification error:', err?.message);
      }
    }

    // 2. Clear local storage caches
    try {
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.USER),
        AsyncStorage.removeItem('@jeenmate_conversations_cache_v2'),
        AsyncStorage.removeItem('@jeenmate_tasks_cache'),
      ]);
    } catch (e) {
      console.warn('Error during logout storage clear', e);
    }

    // 3. Reset local WhatsApp and Chat stores
    try {
      const { useWhatsAppStore } = require('./whatsappStore');
      useWhatsAppStore.getState().resetLocalState?.();
    } catch (e) { }

    try {
      const { useChatStore } = require('./chatStore');
      useChatStore.setState({ conversations: [], activeConversation: null, messages: [] });
    } catch (e) { }

    try {
      const { useTaskStore } = require('./taskStore');
      useTaskStore.getState().resetTasks?.();
    } catch (e) { }

    try {
      const { useInternalChatStore } = require('./internalChatStore');
      useInternalChatStore.setState({ colleagues: [], activeColleague: null, messages: [] });
    } catch (e) { }

    set({
      token: null,
      user: null,
      isAuthenticated: false,
    });
  },

  setServerUrl: async (url: string) => {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    await AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, cleanUrl);
    set({ serverUrl: cleanUrl });
  },

  createUser: async (name, email, password, role) => {
    const { serverUrl, token } = get();

    // Offline fallback — demo mode
    if (token === 'demo_offline_jwt_token_jeenmate') {
      return {
        success: false,
        message: 'Cannot create users in offline demo mode. Please connect to the backend server.',
      };
    }

    try {
      const response = await axios.post(
        `${serverUrl}/api/auth/users`,
        { name, email, password, role },
        {
          timeout: 8000,
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (response.data && response.data.success) {
        return { success: true, message: response.data.message };
      }
      return { success: false, message: response.data?.message || 'User creation failed.' };
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        (err.code === 'ECONNABORTED' ? 'Request timed out.' : err.message || 'Unable to connect.');
      return { success: false, message: msg };
    }
  },
}));
