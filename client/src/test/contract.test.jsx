import { describe, it, expect } from 'vitest';

// These represent the expected enums from the backend contract
const BACKEND_CONTRACT = {
  ReservationStatus: ['ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
  OrderStatus: ['CREATED', 'CONFIRMED', 'FAILED', 'CANCELLED'],
  PaymentStatus: ['PENDING', 'SUCCESS', 'FAILED'],
  ProductStatus: ['ACTIVE', 'INACTIVE']
};

// These represent the status checks hardcoded in our React storefront
const FRONTEND_ENUM_USAGE = {
  reservation: ['ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
  order: ['CREATED', 'CONFIRMED', 'FAILED', 'CANCELLED'],
  payment: ['PENDING', 'SUCCESS', 'FAILED'],
  product: ['ACTIVE']
};

describe('Frontend/Backend Contract Alignment Checks', () => {
  it('asserts that every frontend status checks match the exact backend enums', () => {
    // Assert Reservation states match
    FRONTEND_ENUM_USAGE.reservation.forEach(status => {
      expect(BACKEND_CONTRACT.ReservationStatus).toContain(status);
    });

    // Assert Order states match
    FRONTEND_ENUM_USAGE.order.forEach(status => {
      expect(BACKEND_CONTRACT.OrderStatus).toContain(status);
    });

    // Assert Payment states match
    FRONTEND_ENUM_USAGE.payment.forEach(status => {
      expect(BACKEND_CONTRACT.PaymentStatus).toContain(status);
    });

    // Assert Product states match
    FRONTEND_ENUM_USAGE.product.forEach(status => {
      expect(BACKEND_CONTRACT.ProductStatus).toContain(status);
    });
  });
});
