import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProductDetails } from '../ProductDetails';
import productApi from '../../services/productApi';
import purchaseApi from '../../services/purchaseApi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AuthContext } from '../../context/AuthContext';

vi.mock('../../services/productApi');
vi.mock('../../services/purchaseApi');
vi.mock('react-toastify', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }
}));

const mockUser = { userId: '11111111-1111-1111-1111-111111111111', name: 'Tester', role: 'USER' };

describe('ProductDetails Component Tests', () => {
  const mockProduct = {
    productId: '22222222-2222-2222-2222-222222222222',
    name: 'Awesome Flash Product',
    price: 99.99,
    status: 'ACTIVE',
    description: 'Great deals!',
    coverImg: '',
  };

  const mockInventory = {
    productId: '22222222-2222-2222-2222-222222222222',
    availableStock: 5,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    productApi.getProductById.mockResolvedValue(mockProduct);
    productApi.getProductInventory.mockResolvedValue(mockInventory);
    productApi.getFlashSales.mockResolvedValue([]);
  });

  const renderComponent = () => {
    return render(
      <AuthContext.Provider value={{ user: mockUser }}>
        <MemoryRouter initialEntries={['/products/22222222-2222-2222-2222-222222222222']}>
          <Routes>
            <Route path="/products/:id" element={<ProductDetails />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    );
  };

  it('renders details and purchase button is active when stock is available', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Awesome Flash Product')).toBeInTheDocument();
    });

    const buyButton = screen.getByRole('button', { name: /buy now/i });
    expect(buyButton).toBeInTheDocument();
    expect(buyButton).not.toBeDisabled();
  });

  it('disables the buy button and shows loading state during checkout submission', async () => {
    let resolvePurchase;
    const purchasePromise = new Promise((resolve) => {
      resolvePurchase = resolve;
    });
    purchaseApi.purchase.mockReturnValue(purchasePromise);

    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Awesome Flash Product')).toBeInTheDocument();
    });

    const buyButton = screen.getByRole('button', { name: /buy now/i });
    fireEvent.click(buyButton);

    // Button should be disabled during purchase loading
    await waitFor(() => {
      expect(buyButton).toBeDisabled();
    });

    resolvePurchase({ reservationId: 'res-id', status: 'ACTIVE' });
  });

  it('generates a unique idempotency key and includes it in the purchase API payload', async () => {
    purchaseApi.purchase.mockResolvedValue({ reservationId: 'res-id', status: 'ACTIVE' });

    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Awesome Flash Product')).toBeInTheDocument();
    });

    const buyButton = screen.getByRole('button', { name: /buy now/i });
    fireEvent.click(buyButton);

    await waitFor(() => {
      expect(purchaseApi.purchase).toHaveBeenCalledTimes(1);
    });

    const calledPayload = purchaseApi.purchase.mock.calls[0][0];
    expect(calledPayload.idempotencyKey).toBeDefined();
    expect(calledPayload.idempotencyKey.length).toBeGreaterThan(10);
    expect(calledPayload.productId).toBe(mockProduct.productId);
    expect(calledPayload.userId).toBe(mockUser.userId);
  });
});
