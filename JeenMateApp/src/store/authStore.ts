import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

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
  loginError: string | null;

  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  testServerConnection: (testUrl?: string) => Promise<{ success: boolean; message: string }>;
}

const STORAGE_KEYS = {
  TOKEN: '@jeenmate_token',
  USER: '@jeenmate_user',
  SERVER_URL: '@jeenmate_server_url',
};

const DEFAULT_SERVER_URL = 'http://192.168.1.9:5001';

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  serverUrl: DEFAULT_SERVER_URL,
  isAuthenticated: false,
  isLoading: true,
  loginError: null,

  initAuth: async () => {
    try {
      set({ isLoading: true });
      const [savedToken, savedUser, savedUrl] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.SERVER_URL),
      ]);

      const serverUrl = savedUrl || DEFAULT_SERVER_URL;
      const token = savedToken;
      const user = savedUser ? JSON.parse(savedUser) : null;

      set({
        token,
        user,
        serverUrl,
        isAuthenticated: !!token,
        isLoading: false,
      });
    } catch (e) {
      console.warn('Failed to load auth storage', e);
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const { serverUrl } = get();
    set({ isLoading: true, loginError: null });

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
          isAuthenticated: true,
          isLoading: false,
          loginError: null,
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
          isAuthenticated: true,
          isLoading: false,
          loginError: null,
        });
        return true;
      }

      set({
        isLoading: false,
        loginError: errorMsg,
      });
      return false;
    }
  },

  logout: async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.USER),
      ]);
    } catch (e) {
      console.warn('Error during logout storage clear', e);
    }
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
}));
