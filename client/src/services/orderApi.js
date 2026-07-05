import api from './api';

export const orderApi = {
  getOrders: async (userId) => {
    const params = userId ? { userId } : {};
    const response = await api.get('/orders', { params });
    return response.data;
  },
  getOrderById: async (orderId) => {
    const response = await api.get(`/orders/${orderId}`);
    return response.data;
  }
};

export default orderApi;
