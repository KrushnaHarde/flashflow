import api from './api';

export const adminApi = {
  getAdminOrders: async () => {
    const response = await api.get('/admin/orders');
    return response.data;
  },
  getAdminReservations: async () => {
    const response = await api.get('/admin/reservations');
    return response.data;
  },
  createProduct: async (productData) => {
    const response = await api.post('/admin/products', productData);
    return response.data;
  },
  updateProduct: async (id, productData) => {
    const response = await api.put(`/admin/products/${id}`, productData);
    return response.data;
  },
  activateProduct: async (id) => {
    const response = await api.patch(`/admin/products/${id}/activate`);
    return response.data;
  },
  deactivateProduct: async (id) => {
    const response = await api.patch(`/admin/products/${id}/deactivate`);
    return response.data;
  },
  createFlashSale: async (saleData) => {
    const response = await api.post('/admin/sales', saleData);
    return response.data;
  },
  updateFlashSale: async (id, saleData) => {
    const response = await api.put(`/admin/sales/${id}`, saleData);
    return response.data;
  },
  deleteFlashSale: async (id) => {
    const response = await api.delete(`/admin/sales/${id}`);
    return response.data;
  }
};

export default adminApi;
