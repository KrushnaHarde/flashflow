import api from './api';

export const productApi = {
  getAllProducts: async () => {
    const response = await api.get('/products');
    return response.data;
  },
  getProductById: async (id) => {
    const response = await api.get(`/products/${id}`);
    return response.data;
  },
  getProductInventory: async (productId) => {
    const response = await api.get(`/products/${productId}/inventory`);
    return response.data;
  },
  getFlashSales: async () => {
    const response = await api.get('/sales');
    return response.data;
  },
  getFlashSaleById: async (id) => {
    const response = await api.get(`/sales/${id}`);
    return response.data;
  }
};

export default productApi;
