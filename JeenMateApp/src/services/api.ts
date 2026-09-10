import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const apiClient = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config) => {
    const { token, serverUrl } = useAuthStore.getState();
    config.baseURL = serverUrl;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Auto-logout when server returns 401 (expired/invalid token)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const { token } = useAuthStore.getState();
      // Only logout if we actually had a token (don't loop on login page)
      if (token) {
        console.warn('[API] 401 Unauthorized — token expired. Logging out...');
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
