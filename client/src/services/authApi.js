import api from './api';

export const authApi = {
  login: async (email, password) => {
    const response = await api.post('/api/v1/auth/login', { email, password });
    return response.data;
  },
  register: async (name, email, password) => {
    const response = await api.post('/api/v1/auth/register', { name, email, password });
    return response.data;
  },
  refresh: async (refreshToken) => {
    const response = await api.post('/api/v1/auth/refresh', { refreshToken });
    return response.data;
  },
  logout: async (refreshToken) => {
    const response = await api.post('/api/v1/auth/logout', { refreshToken });
    return response.data;
  },
  getMe: async () => {
    const response = await api.get('/api/v1/auth/me');
    return response.data;
  }
};

export default authApi;
