import api from './api';

export const purchaseApi = {
  purchase: async (purchaseData) => {
    // Send POST /purchase with Idempotency-Key header and request body
    const { userId, productId, quantity, idempotencyKey } = purchaseData;
    const response = await api.post('/purchase', 
      { userId, productId, quantity, idempotencyKey },
      {
        headers: {
          'Idempotency-Key': idempotencyKey
        }
      }
    );
    return response.data;
  },

  getPurchaseStatus: async (reservationId) => {
    // Poll status: GET /purchase/{reservationId}/status
    const response = await api.get(`/purchase/${reservationId}/status`);
    return response.data;
  }
};

export default purchaseApi;
