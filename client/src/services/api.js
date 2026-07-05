import axios from 'axios';
import { toast } from 'react-toastify';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let requestInterceptorId = null;
let responseInterceptorId = null;

// Configure dynamic interceptor attachment to link to React AuthContext
export const setupInterceptors = (getAccessToken, refreshAuthToken, logout) => {
  // Eject previous interceptors if they exist
  if (requestInterceptorId !== null) {
    api.interceptors.request.eject(requestInterceptorId);
  }
  if (responseInterceptorId !== null) {
    api.interceptors.response.eject(responseInterceptorId);
  }

  // Request Interceptor: Attach JWT token
  requestInterceptorId = api.interceptors.request.use(
    (config) => {
      const token = getAccessToken();
      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response Interceptor: Handle global errors and 401 JWT refreshes
  responseInterceptorId = api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      
      // Auto token refresh on 401 Unauthorized
      if (error.response?.status === 401 && !originalRequest.url?.includes('/auth/refresh') && !originalRequest._retry) {
        // Prevent infinite loops
        originalRequest._retry = true;
        try {
          const newToken = await refreshAuthToken();
          if (newToken) {
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            return api(originalRequest);
          }
        } catch (refreshErr) {
          console.error('Refresh token failed in interceptor:', refreshErr);
        }
        logout();
        toast.error('Session expired. Please log in again.');
        return Promise.reject(error);
      }

      // User-friendly toast error mapping
      if (error.response) {
        const { status, data } = error.response;
        
        if (status === 403) {
          toast.error(data?.message || 'Access Denied: You do not have permissions.');
        } else if (status === 404) {
          toast.error(data?.message || 'Requested resource not found.');
        } else if (status >= 500) {
          toast.error(data?.message || 'Internal Server Error. Please try again later.');
        } else if (status === 400) {
          // If the error message is present, display it, otherwise show a default bad request msg
          toast.error(data?.message || 'Invalid request parameters.');
        }
      } else if (error.request) {
        toast.error('Network failure. Cannot reach server.');
      } else {
        toast.error('An unexpected error occurred.');
      }

      return Promise.reject(error);
    }
  );
};

export default api;
