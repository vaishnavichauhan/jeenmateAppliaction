import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const apiClient = axios.create({
  timeout: 15000,
});

apiClient.interceptors.request.use(
  (config) => {
    const { token, serverUrl } = useAuthStore.getState();
    config.baseURL = serverUrl;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // If sending FormData (file uploads), remove Content-Type so Axios/XHR generates multipart boundary
    if (config.data instanceof FormData || (config.data && typeof config.data.append === 'function')) {
      if (config.headers) {
        if (typeof config.headers.delete === 'function') {
          config.headers.delete('Content-Type');
          config.headers.delete('content-type');
        } else {
          delete config.headers['Content-Type'];
          delete config.headers['content-type'];
        }
      }
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
