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
  refresh: async (csrfToken) => {
    const response = await api.post('/api/v1/auth/refresh', {}, {
      headers: {
        'X-CSRF-Token': csrfToken
      }
    });
    return response.data;
  },
  logout: async (csrfToken) => {
    const response = await api.post('/api/v1/auth/logout', {}, {
      headers: {
        'X-CSRF-Token': csrfToken
      }
    });
    return response.data;
  },
  getMe: async () => {
    const response = await api.get('/api/v1/auth/me');
    return response.data;
  }
};

export default authApi;
