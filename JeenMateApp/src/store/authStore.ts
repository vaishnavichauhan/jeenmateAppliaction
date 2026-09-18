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

  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  testServerConnection: (testUrl?: string) => Promise<{ success: boolean; message: string }>;
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

const DEFAULT_SERVER_URL = Platform.OS === 'android' ? 'http://192.168.1.3:5001' : 'http://localhost:5001';

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  serverUrl: DEFAULT_SERVER_URL,
  isAuthenticated: false,
  isLoading: false,
  isInitializing: true,
  isLoginSuccess: false,
  loginError: null,

  initAuth: async () => {
    try {
      set({ isInitializing: true });
      const [savedToken, savedUser, savedUrl] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.SERVER_URL),
      ]);

      let serverUrl = savedUrl || DEFAULT_SERVER_URL;
      if (serverUrl.includes('192.168.1.9')) {
        serverUrl = DEFAULT_SERVER_URL;
        await AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, serverUrl);
      }

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
    const { serverUrl } = get();
    set({ isLoading: true, isLoginSuccess: false, loginError: null });

    try {
      const response = await axios.post(
        `${serverUrl}/api/auth/login`,
        { email: email.trim(), password },
        { timeout: 8000 }
      );

      if (response.data && response.data.token) {
        const { token, user } = response.data;
        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEYS.TOKEN, token),
          AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user)),
        ]);

        set({
          token,
          user,
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
      throw new Error(response.data?.message || 'Login failed');
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.message ||
        (err.code === 'ECONNABORTED'
          ? 'Server connection timeout. Check server URL/IP.'
          : err.message || 'Unable to connect to backend.');

      // Fallback demo login for offline presentation / test if server cannot be reached
      if (email.trim().toLowerCase() === 'admin@support.com' && password === 'Admin@12345') {
        const fallbackUser: StaffUser = {
          id: 'usr_admin_001',
          email: 'admin@support.com',
          name: 'Support Admin',
          role: 'admin',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
        };
        const fallbackToken = 'demo_offline_jwt_token_jeenmate';

        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEYS.TOKEN, fallbackToken),
          AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(fallbackUser)),
        ]);

        set({
          token: fallbackToken,
          user: fallbackUser,
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

      set({
        isLoading: false,
        isLoginSuccess: false,
        loginError: errorMsg,
      });
      return false;
    }
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
    } catch (e) {}

    try {
      const { useChatStore } = require('./chatStore');
      useChatStore.setState({ conversations: [], activeConversation: null, messages: [] });
    } catch (e) {}

    try {
      const { useTaskStore } = require('./taskStore');
      useTaskStore.getState().resetTasks?.();
    } catch (e) {}

    try {
      const { useInternalChatStore } = require('./internalChatStore');
      useInternalChatStore.setState({ colleagues: [], activeColleague: null, messages: [] });
    } catch (e) {}

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

  testServerConnection: async (testUrl?: string) => {
    const targetUrl = (testUrl || get().serverUrl).trim().replace(/\/+$/, '');
    try {
      const res = await axios.get(`${targetUrl}/api/health`, { timeout: 4000 });
      if (res.status === 200) {
        return { success: true, message: 'Connected successfully to backend!' };
      }
      return { success: false, message: `Unexpected response status: ${res.status}` };
    } catch (err: any) {
      return {
        success: false,
        message: err.code === 'ECONNABORTED' ? 'Connection timed out' : err.message || 'Cannot reach server',
      };
    }
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
