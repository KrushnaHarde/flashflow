import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminFlashSales } from '../AdminFlashSales';
import adminApi from '../../services/adminApi';
import productApi from '../../services/productApi';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { toast } from 'react-toastify';

vi.mock('../../services/adminApi');
vi.mock('../../services/productApi');
vi.mock('react-toastify', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  }
}));

describe('AdminFlashSales Component Form Tests', () => {
  const mockProducts = [
    { productId: 'p1', name: 'Product A', price: 10.0 },
    { productId: 'p2', name: 'Product B', price: 20.0 }
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    productApi.getFlashSales.mockResolvedValue([]);
    productApi.getAllProducts.mockResolvedValue(mockProducts);
  });

  it('validates empty inputs and triggers corresponding toast errors', async () => {
    render(
      <MemoryRouter>
        <AdminFlashSales />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Schedule New Flash Sale')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /schedule sale window/i });
    fireEvent.click(submitBtn);

    // Toast error should be called for empty name
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Please enter a sale name.');
    });
  });

  it('triggers payload submission with correct formatted shape', async () => {
    adminApi.createFlashSale.mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <AdminFlashSales />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Product A')).toBeInTheDocument();
    });

    // Fill form
    fireEvent.change(screen.getByLabelText('Sale Name'), { target: { value: 'Winter Deal' } });
    fireEvent.change(screen.getByLabelText('Start Date & Time'), { target: { value: '2026-12-01T10:00' } });
    fireEvent.change(screen.getByLabelText('End Date & Time (Optional)'), { target: { value: '2026-12-01T12:00' } });

    // Select Product A
    const checkbox = screen.getByLabelText(/Product A/i);
    fireEvent.click(checkbox);

    const submitBtn = screen.getByRole('button', { name: /schedule sale window/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(adminApi.createFlashSale).toHaveBeenCalledTimes(1);
    });

    const payload = adminApi.createFlashSale.mock.calls[0][0];
    expect(payload.name).toBe('Winter Deal');
    expect(payload.productIds).toContain('p1');

    expect(payload.startTime).toBe('2026-12-01T10:00:00');
    expect(payload.endTime).toBe('2026-12-01T12:00:00');
  });
});
