import api from './api';

export const inventoryApi = {
  addStock: async (productId, quantity) => {
    const response = await api.post(`/admin/inventory/${productId}`, { quantity });
    return response.data;
  },
  getAllInventories: async () => {
    const response = await api.get('/admin/inventory');
    return response.data;
  }
};

export default inventoryApi;
