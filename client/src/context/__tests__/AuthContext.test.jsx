import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import api from '../../services/api';
import authApi from '../../services/authApi';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../services/authApi');

describe('AuthContext Interceptor Registration Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('ejects the previous interceptor when a new one is set up', async () => {
    authApi.refresh.mockResolvedValue({ accessToken: 'first-token' });

    const spyUse = vi.spyOn(api.interceptors.request, 'use');
    const spyEject = vi.spyOn(api.interceptors.request, 'eject');

    const TestComponent = () => {
      const { setAccessToken } = useAuth();
      useEffect(() => {
        // Trigger a token update
        setAccessToken('new-token-1');
        setTimeout(() => {
          setAccessToken('new-token-2');
        }, 10);
      }, []);
      return <div>Test</div>;
    };

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      // Eject should have been called at least once when the token changed from null -> new-token-1 -> new-token-2
      expect(spyEject).toHaveBeenCalled();
    });

    // The current number of active request interceptors should not leak
    expect(spyUse.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(spyEject.mock.calls.length).toBe(spyUse.mock.calls.length - 1);
  });
});
