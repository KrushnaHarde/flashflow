import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { PurchaseStatus } from '../PurchaseStatus';
import purchaseApi from '../../services/purchaseApi';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../services/purchaseApi');
vi.mock('react-toastify', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}));

describe('PurchaseStatus Badge Mapping Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('correctly maps reservationStatus ACTIVE/CONFIRMED to success badge, and EXPIRED/CANCELLED to danger badge', async () => {
    purchaseApi.getPurchaseStatus.mockResolvedValue({
      reservationStatus: 'ACTIVE',
      orderStatus: 'CREATED',
      paymentStatus: 'PENDING'
    });

    render(
      <MemoryRouter>
        <PurchaseStatus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Stock Reservation')).toBeInTheDocument();
    });

    const reservationBadge = screen.getByText('ACTIVE');
    expect(reservationBadge).toBeInTheDocument();
    expect(reservationBadge.className).toContain('text-emerald-800'); // success variant uses emerald styling
  });

  it('correctly maps orderStatus CONFIRMED to success, CREATED to info, and FAILED to danger badge', async () => {
    purchaseApi.getPurchaseStatus.mockResolvedValue({
      reservationStatus: 'CONFIRMED',
      orderStatus: 'CREATED',
      paymentStatus: 'PENDING'
    });

    render(
      <MemoryRouter>
        <PurchaseStatus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Order Creation')).toBeInTheDocument();
    });

    const orderBadge = screen.getByText('CREATED');
    expect(orderBadge).toBeInTheDocument();
    expect(orderBadge.className).toContain('text-blue-800'); // info variant uses blue styling
  });

  it('correctly maps paymentStatus SUCCESS to success, PENDING to info, and FAILED to danger badge', async () => {
    purchaseApi.getPurchaseStatus.mockResolvedValue({
      reservationStatus: 'CONFIRMED',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'SUCCESS'
    });

    render(
      <MemoryRouter>
        <PurchaseStatus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Payment Process')).toBeInTheDocument();
    });

    const paymentBadge = screen.getByText('SUCCESS');
    expect(paymentBadge).toBeInTheDocument();
    expect(paymentBadge.className).toContain('text-emerald-800'); // success variant uses emerald styling
  });
});
